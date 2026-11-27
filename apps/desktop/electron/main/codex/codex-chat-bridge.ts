/** Codex owns linked histories and execution. This adapter keeps no second transcript. */
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { nativeJsonRpcWebSocketTransport, type ClientTransport } from "@pi-desktop/racp";
import { IPC, type AgentEvent, type SessionDetail, type SessionSummary, type SessionThinkingLevel, type UiMessage,
  type ToolPermissionRequest, type AskToolRequest } from "@pi-desktop/shared";
import { makeRemoteApprovalRequestId, makeRemoteSessionId, parseRemoteApprovalRequestId,
  parseRemoteSessionId, sessionIdForCall, type BackendRouter, type RemoteBackend } from "../remote/backend-router";

const HOST = "codex-shared";
type Native = Record<string, any>;
type Pending = { id: string | number; method: string; params: Native; outward: string };
type Waiter = { resolve(value: any): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> };
type Options = {
  router: BackendRouter;
  emit(channel: string, value: unknown): void;
  runtimeDirectory?: string;
  readPiSession?: (id: string) => Promise<{ session: SessionDetail } | null>;
  isPiSessionBusy?: (id: string) => boolean;
};
let active: CodexChatBridge | null = null;
export const getCodexChatBridge = () => active;
export const setCodexChatBridge = (value: CodexChatBridge | null) => { active = value; };
const unavailable = (message = "Start Codex with the shared-chat connection enabled") =>
  Object.assign(new Error(message), { errorCode: "AGENT_UNAVAILABLE" });
const unsupported = () => Object.assign(new Error("This action is unavailable for a linked Codex chat"),
  { errorCode: "CAPABILITY_UNAVAILABLE" });
const millis = (value: unknown, fallback = Date.now()) =>
  typeof value === "number" ? (value < 10_000_000_000 ? value * 1000 : value) : fallback;

export function nativeItemToMessage(entry: Native, fallback = Date.now()): UiMessage {
  const item = entry.item ?? entry;
  const kind = String(item.type ?? "");
  const base: UiMessage = {
    id: String(item.id), turnId: entry.turnId, role: "assistant", content: "",
    createdAt: new Date(millis(entry.startedAtMs, fallback)).toISOString(),
    status: item.status === "inProgress" ? "streaming" : "complete",
  };
  if (kind === "userMessage") {
    base.role = "user";
    base.content = (item.content ?? []).filter((part: Native) => part.type === "text")
      .map((part: Native) => part.text ?? "").join("\n");
    const images = (item.content ?? []).filter((part: Native) => /image/i.test(part.type ?? ""));
    if (images.length) base.content += `${base.content ? "\n\n" : ""}[${images.length} image attachment${images.length === 1 ? "" : "s"} in this shared chat]`;
  } else if (kind === "agentMessage") {
    base.content = item.text ?? (item.content ?? []).map((part: Native) => part.text ?? "").join("");
  } else if (kind === "reasoning") {
    base.thinking = [...(item.summary ?? []), ...(item.content ?? [])]
      .map(part => typeof part === "string" ? part : part.text ?? "").join("\n");
  } else if (kind === "plan") {
    base.content = item.text ?? "";
  } else {
    base.role = "tool";
    base.toolCallId = String(item.id);
    base.toolName = item.tool ?? item.name ?? kind;
    base.toolArgs = item.arguments ?? item.command ?? item.changes;
    base.toolResult = item.result ?? item.aggregatedOutput ?? item.output ?? item;
    base.toolStatus = item.status === "failed" ? "error" :
      item.status === "inProgress" ? "running" : "success";
    base.content = typeof base.toolResult === "string" ? base.toolResult : JSON.stringify(base.toolResult);
  }
  return base;
}

/** Scoped adapter plugged into the same router as the existing paired-host backends. */
export class CodexChatBridge implements RemoteBackend {
  private readonly options: Options;
  private readonly runtime: string;
  private transport: ClientTransport | null = null;
  private connecting: Promise<void> | null = null;
  private refreshTask: Promise<void> | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private closed = false;
  private enabled = false;
  private generation = 0;
  private sequence = 0;
  private waiters = new Map<string | number, Waiter>();
  private threads = new Map<string, Native>();
  private configurations = new Map<string, Pick<SessionSummary, "modelId" | "thinkingLevel" | "fastMode">>();
  private running = new Map<string, string>();
  private subscribed = new Set<string>();
  private messages = new Map<string, Map<string, UiMessage>>();
  private pending = new Map<string, Pending>();
  private optimistic = new Map<string, string>();
  private admissions = new Set<string>();
  private aliases = new Map<string, { threadId?: string; session: SessionSummary }>();
  private bindings = new Map<string, string>();
  private linking = new Map<string, Promise<string>>();
  private allListed = false;
  private nextHistoryCursor = 2 ** 47;
  private historyCursors = new Map<number, { threadId: string; cursor: string }>();

  private outward(threadId: string): string {
    for (const [id, alias] of this.aliases) if (alias.threadId === threadId) return id;
    return makeRemoteSessionId(HOST, threadId);
  }

  ownsPiSession(id: string): boolean { return this.aliases.has(id); }

  registerPiSession(session: SessionSummary): void {
    if (!this.enabled || session.readOnlyReason || session.capabilities?.canPrompt === false || session.source === "remote" || session.source === "codex" || session.scheduledRun || this.options.isPiSessionBusy?.(session.id)) return;
    // Voice coordinators retain their selected Pi Live runtime and account.
    if (session.projectPath?.replaceAll("\\", "/").endsWith("/.pi-desktop/jarvis/workspace")) return;
    const existing = this.aliases.get(session.id);
    this.aliases.set(session.id, { threadId: existing?.threadId ?? this.bindings.get(session.id), session });
    this.options.router.registerBackend(session.id, this);
  }

  async prepareCall(channel: string, args: readonly unknown[]): Promise<void> {
    if (!this.handles(channel) || !this.options.readPiSession) return;
    const first = args[0] as any;
    const id = typeof first === "string" ? first : first?.sessionId ?? first?.id;
    if (typeof id !== "string" || id.startsWith("remote:") || this.aliases.has(id)) return;
    // A fresh installation is opt-in. No config means existing local behavior.
    let config: Native;
    try { config = JSON.parse(await readFile(join(this.runtime, "bridge.json"), "utf8")); }
    catch { return; }
    if (config.syncEnabled !== true || this.options.isPiSessionBusy?.(id)) return;
    this.enabled = true;
    const detail = await this.options.readPiSession(id);
    if (detail?.session) this.registerPiSession(detail.session);
  }

  constructor(options: Options) {
    this.options = options;
    this.runtime = options.runtimeDirectory ?? process.env.CODEX_PI_SYNC_RUNTIME ??
      join(process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"), "CodexPiChatSync", "runtime");
  }

  async start(): Promise<void> {
    if (this.timer) return;
    try {
      const config = JSON.parse(await readFile(join(this.runtime, "bridge.json"), "utf8"));
      if (config.schemaVersion !== 1 || config.syncEnabled !== true) return;
    } catch { return; }
    this.enabled = true;
    void this.refresh().catch(() => undefined);
    this.timer = setInterval(() => void this.refresh().catch(() => undefined), 2500);
    this.timer.unref?.();
  }

  close(): void {
    this.closed = true;
    this.generation += 1;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.transport?.close();
    this.transport = null;
    for (const waiter of this.waiters.values()) { clearTimeout(waiter.timer); waiter.reject(unavailable()); }
    this.waiters.clear();
    // The native owner and any ongoing Codex work outlive this client.
  }

  summaries(): SessionSummary[] {
    const linked = new Set([...this.aliases.values()].flatMap(value => value.threadId ? [value.threadId] : []));
    const aliases: SessionSummary[] = [...this.aliases.entries()].map(([id, alias]) => ({
      ...(alias.threadId && this.threads.has(alias.threadId) ? this.summary(this.threads.get(alias.threadId)!) : alias.session),
      id, source: "codex" as const, remoteHostKey: HOST, remoteHostLabel: "Codex",
      nativeOwner: alias.threadId ? { hostKey: HOST, sessionId: alias.threadId, viewId: this.outward(alias.threadId) } : undefined,
      capabilities: { canPrompt: true, canStop: true, canRefresh: true, canConfigureModel: false,
        canAttach: false, canSteer: true, canEditMessages: false, canUseLocalTools: false,
        canUseTerminal: false, canReadWorkspace: false },
    }));
    return [...aliases, ...[...this.threads.values()].filter(thread => !linked.has(thread.id)).map(thread => this.summary(thread))];
  }

  runningSessionIds(): string[] {
    return [...this.running.keys()].map(id => this.outward(id));
  }

  private summary(thread: Native): SessionSummary {
    const cwd = typeof thread.cwd === "string" ? thread.cwd.replace(/^\\\\\?\\/, "") : undefined;
    const localPath = cwd && (process.platform === "win32" ? /^(?:[a-z]:[\\/]|\\\\)/i.test(cwd) : cwd.startsWith("/")) ? cwd : undefined;
    const pi = [...this.aliases.values()].find(value => value.threadId === thread.id)?.session;
    return {
      id: makeRemoteSessionId(HOST, thread.id), source: "codex", remoteHostKey: HOST, projectPath: pi?.projectPath ?? localPath,
      nativeOwner: { hostKey: HOST, sessionId: thread.id, viewId: this.outward(thread.id) },
      remoteHostLabel: "Codex", remoteWorkspaceLabel: thread.cwd,
      title: thread.name || thread.preview || "Codex chat", messageCount: this.messages.get(thread.id)?.size ?? 0,
      mode: "agent", thinkingLevel: "omit", permissionMode: "inherit",
      ...this.configurations.get(thread.id),
      capabilities: { canPrompt: Boolean(this.transport) && thread.canAcceptDirectInput !== false, canStop: Boolean(this.transport),
        canRefresh: true, canConfigureModel: false, canAttach: false, canSteer: true,
        canEditMessages: false, canUseLocalTools: false, canUseTerminal: false, canReadWorkspace: false },
      createdAt: new Date(millis(thread.createdAt)).toISOString(),
      updatedAt: new Date(millis(thread.updatedAt)).toISOString(),
      ...(!this.transport ? { readOnlyReason: "CODEX_OWNER_DISCONNECTED" } : {}),
    };
  }

  private async ensure(): Promise<void> {
    if (this.closed) throw unavailable();
    if (this.transport) return;
    if (this.connecting) return this.connecting;
    const task = this.connect();
    this.connecting = task;
    try { await task; } finally { if (this.connecting === task) this.connecting = null; }
  }

  private async connect(): Promise<void> {
    const metadata = JSON.parse(await readFile(join(this.runtime, "connection.json"), "utf8"));
    const url = new URL(metadata.url);
    if (metadata.schemaVersion !== 1 || url.protocol !== "ws:" || url.hostname !== "127.0.0.1" ||
      !url.port || url.username || url.password || url.search || url.hash || (url.pathname && url.pathname !== "/") ||
      resolve(metadata.tokenFile) !== resolve(this.runtime, "owner.capability")) throw unavailable("Invalid shared Codex owner metadata");
    const token = (await readFile(metadata.tokenFile, "utf8")).trim();
    if (token.length < 32) throw unavailable("Invalid shared Codex capability");
    const transport = await nativeJsonRpcWebSocketTransport({ url: url.href, token, connectTimeoutMs: 5000 })();
    if (this.closed) { transport.close(); throw unavailable(); }
    this.transport = transport;
    const generation = ++this.generation;
    transport.onMessage(frame => { if (generation === this.generation) this.receive(frame); });
    transport.onError(() => undefined);
    transport.onClose(() => {
      if (generation !== this.generation) return;
      this.transport = null;
      this.subscribed.clear();
      this.historyCursors.clear();
      this.pending.clear();
      for (const waiter of this.waiters.values()) { clearTimeout(waiter.timer); waiter.reject(unavailable("Codex disconnected; the request was not retried")); }
      this.waiters.clear();
      this.options.emit(IPC.event.sessionsChanged, { reason: "codex.disconnected" });
    });
    try {
      await this.request("initialize", { clientInfo: { name: "pi-desktop-shared-chat", version: "1.0.0" },
        capabilities: { experimentalApi: true } });
      transport.send(JSON.stringify({ method: "initialized", params: {} }));
      try {
        const registry = JSON.parse(await readFile(join(this.runtime, "links.json"), "utf8"));
        for (const record of Object.values(registry.links ?? {}) as Native[]) {
          if (record.state === "linked" && record.origin?.kind === "pi-desktop") {
            this.bindings.set(record.origin.sessionId, record.threadId);
            if (this.aliases.has(record.origin.sessionId)) this.aliases.get(record.origin.sessionId)!.threadId = record.threadId;
          }
        }
      } catch { /* No migrations have been performed yet. */ }
    } catch (error) { transport.close(); this.transport = null; throw error; }
    for (const id of this.messages.keys()) await this.subscribe(id);
  }

  private request(method: string, params: Native = {}): Promise<any> {
    const transport = this.transport;
    if (!transport) return Promise.reject(unavailable());
    const id = `pi-${this.generation}-${++this.sequence}`;
    return new Promise((resolveResult, reject) => {
      const timer = setTimeout(() => {
        this.waiters.delete(id);
        reject(unavailable("Codex response timed out; the request was not retried"));
      }, 30_000);
      this.waiters.set(id, { resolve: resolveResult, reject, timer });
      try { transport.send(JSON.stringify({ id, method, params })); }
      catch { clearTimeout(timer); this.waiters.delete(id); reject(unavailable()); }
    });
  }

  async refresh(): Promise<void> {
    if (this.refreshTask) return this.refreshTask;
    const task = (async () => {
      await this.ensure();
      let changed = false;
      let cursor: string | undefined;
      do {
      const page = await this.request("thread/list", { limit: 100, sortDirection: "desc", archived: false,
        ...(cursor ? { cursor } : {}) });
      for (const thread of page.data ?? []) {
        if (!this.threads.has(thread.id) || this.threads.get(thread.id)?.updatedAt !== thread.updatedAt ||
          this.threads.get(thread.id)?.name !== thread.name) changed = true;
        this.threads.set(thread.id, thread);
        this.options.router.registerBackend(makeRemoteSessionId(HOST, thread.id), this);
        if (thread.status?.type === "active" && !this.running.has(thread.id)) {
          const turns = await this.request("thread/turns/list", { threadId: thread.id, limit: 1, sortDirection: "desc" });
          const turn = turns.data?.find((value: Native) => value.status === "inProgress");
          if (turn) this.running.set(thread.id, turn.id);
        } else if (thread.status?.type === "idle") this.running.delete(thread.id);
      }
      cursor = !this.allListed ? page.nextCursor ?? undefined : undefined;
      } while (cursor);
      this.allListed = true;
      if (changed) this.options.emit(IPC.event.sessionsChanged, { reason: "codex.catalog" });
    })();
    this.refreshTask = task;
    try { await task; } finally { if (this.refreshTask === task) this.refreshTask = null; }
  }

  private async subscribe(threadId: string): Promise<Native> {
    if (!this.subscribed.has(threadId)) {
      const value = await this.request("thread/resume", { threadId, excludeTurns: true });
      this.threads.set(threadId, value.thread);
      const effort = value.reasoningEffort === "none" ? "off" : value.reasoningEffort;
      this.configurations.set(threadId, {
        modelId: value.model,
        thinkingLevel: ["off", "minimal", "low", "medium", "high", "xhigh", "max"].includes(effort)
          ? effort as SessionThinkingLevel : "omit",
        ...(value.serviceTier ? { fastMode: value.serviceTier === "priority" } : {}),
      });
      this.subscribed.add(threadId);
      const status = value.thread.status;
      if (status?.type === "active") {
        const turns = await this.request("thread/turns/list", { threadId, limit: 1, sortDirection: "desc" });
        const turn = turns.data?.find((candidate: Native) => candidate.status === "inProgress");
        if (turn) this.running.set(threadId, turn.id);
      }
    }
    return this.threads.get(threadId)!;
  }

  private emit(threadId: string, event: AgentEvent, turnId?: string): void {
    this.options.emit(IPC.event.agentMessage, { sessionId: this.outward(threadId),
      turnId: turnId ?? this.running.get(threadId), ts: Date.now(), event });
  }

  private receive(frame: string): void {
    let value: Native;
    try { value = JSON.parse(frame); } catch { return; }
    if (value.method && value.id !== undefined) { void this.interactive(value); return; }
    if (value.id !== undefined) {
      const waiter = this.waiters.get(value.id);
      if (!waiter) return;
      clearTimeout(waiter.timer); this.waiters.delete(value.id);
      if (value.error) waiter.reject(Object.assign(new Error(value.error.message ?? "Codex rejected the request"), { errorCode: "CODEX_REQUEST_REJECTED" }));
      else waiter.resolve(value.result);
      return;
    }
    const params = value.params ?? {};
    const id = params.threadId ?? params.thread?.id;
    if (!id) return;
    if (value.method === "thread/started") {
      this.threads.set(id, params.thread);
      this.options.router.registerBackend(makeRemoteSessionId(HOST, id), this);
      this.options.emit(IPC.event.sessionsChanged, { reason: "codex.created" });
    } else if (value.method === "turn/started") {
      this.running.set(id, params.turn.id);
      this.emit(id, { type: "agent_start" }, params.turn.id);
      this.emit(id, { type: "turn_start" }, params.turn.id);
    } else if (value.method === "turn/completed") {
      this.running.delete(id);
      this.emit(id, { type: "turn_end" }, params.turn.id);
      this.emit(id, { type: "agent_end", messageIds: [] }, params.turn.id);
      this.options.emit(IPC.event.sessionsChanged, { reason: "codex.turn", sessionId: this.outward(id) });
    } else if (value.method === "item/started" || value.method === "item/completed") {
      const message = nativeItemToMessage({ item: params.item, turnId: params.turnId, startedAtMs: params.startedAtMs });
      if (value.method === "item/started") message.status = "streaming";
      const messages = this.messages.get(id) ?? new Map<string, UiMessage>();
      messages.set(message.id, message); this.messages.set(id, messages);
      const optimistic = params.item?.type === "userMessage" ? this.optimistic.get(id) : undefined;
      if (optimistic) {
        this.optimistic.delete(id);
        this.emit(id, { type: "user_message_persisted", optimisticMessageId: optimistic, message }, params.turnId);
      } else this.emit(id, { type: value.method === "item/started" ? "message_start" : "message_end", message }, params.turnId);
    } else if (value.method === "item/agentMessage/delta" || value.method === "item/reasoning/textDelta" || value.method === "item/reasoning/summaryTextDelta") {
      const messages = this.messages.get(id) ?? new Map<string, UiMessage>();
      const message = messages.get(params.itemId) ?? { id: params.itemId, role: "assistant", content: "",
        turnId: params.turnId, createdAt: new Date().toISOString(), status: "streaming" } as UiMessage;
      const thinking = value.method !== "item/agentMessage/delta";
      if (thinking) message.thinking = (message.thinking ?? "") + params.delta;
      else message.content += params.delta;
      messages.set(message.id, message); this.messages.set(id, messages);
      this.emit(id, { type: "message_update", message: { ...message } }, params.turnId);
    } else if (value.method === "thread/name/updated" || value.method === "thread/status/changed") {
      if (this.threads.has(id) && params.threadName) this.threads.get(id)!.name = params.threadName;
      this.options.emit(IPC.event.sessionsChanged, { reason: "codex.metadata" });
    }
  }

  private async interactive(value: Native): Promise<void> {
    const params = value.params ?? {};
    const sessionId = this.outward(params.threadId ?? "unknown");
    const outward = makeRemoteApprovalRequestId(makeRemoteSessionId(HOST, params.threadId ?? "unknown"), String(value.id));
    const pending: Pending = { id: value.id, method: value.method, params, outward };
    if (value.method === "item/commandExecution/requestApproval" || value.method === "item/fileChange/requestApproval") {
      this.pending.set(outward, pending);
      const request: ToolPermissionRequest = { requestId: outward, sessionId, toolCallId: params.itemId,
        toolName: value.method.includes("commandExecution") ? "Codex command" : "Codex file change",
        argsPreview: { command: params.command, cwd: params.cwd, reason: params.reason },
        risk: "high", reason: params.reason ?? "Codex requires your approval" };
      this.emit(params.threadId, { type: "tool_permission_request", request }, params.turnId);
    } else if (value.method === "item/tool/requestUserInput") {
      this.pending.set(outward, pending);
      const request: AskToolRequest = { requestId: outward, sessionId, toolCallId: params.itemId,
        questions: (params.questions ?? []).map((question: Native) => ({ question: question.question,
          header: question.header, options: question.options, multiSelect: false })) };
      this.emit(params.threadId, { type: "asktool_request", request }, params.turnId);
    } else if (value.method === "item/tool/call") {
      await this.forwardDesktopTool(value);
    } else {
      this.transport?.send(JSON.stringify({ id: value.id, error: { code: -32601,
        message: "This native request is not supported by the Pi shared-chat client" } }));
    }
  }

  private async forwardDesktopTool(value: Native): Promise<void> {
    try {
      const metadata = JSON.parse(await readFile(join(this.runtime, "desktop-client.json"), "utf8"));
      const endpoint = new URL(metadata.url);
      if (endpoint.protocol !== "http:" || endpoint.hostname !== "127.0.0.1" ||
        !endpoint.port || endpoint.username || endpoint.password || endpoint.search || endpoint.hash ||
        endpoint.pathname !== "/desktop-tool") throw unavailable();
      const token = (await readFile(join(this.runtime, "owner.capability"), "utf8")).trim();
      const response = await fetch(endpoint, { method: "POST", redirect: "error",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(value) });
      if (!response.ok) throw unavailable();
      const result = await response.json();
      this.transport?.send(JSON.stringify({ id: value.id, ...(result.error ? { error: result.error } : { result: result.result }) }));
    } catch {
      this.transport?.send(JSON.stringify({ id: value.id, result: { success: false,
        contentItems: [{ type: "inputText", text: "Open Codex Desktop to use this Desktop-owned tool. No operation was retried." }] } }));
    }
  }

  handles(channel: string): boolean {
    return new Set<string>([IPC.invoke.sessionGet, IPC.invoke.sessionRename, IPC.invoke.agentPrompt,
      IPC.invoke.agentGetStatus, IPC.invoke.agentStop, IPC.invoke.agentAbort, IPC.invoke.agentSteer,
      IPC.invoke.agentQueueList, IPC.invoke.pendingInteractive, IPC.invoke.toolResolvePermission,
      IPC.invoke.askToolResolve, IPC.invoke.sessionOpen]).has(channel);
  }

  private async threadForPi(id: string): Promise<string> {
    const existing = this.aliases.get(id);
    if (existing?.threadId) return existing.threadId;
    const pending = this.linking.get(id);
    if (pending) return pending;
    const task = (async () => {
      const detail = await this.options.readPiSession?.(id);
      if (!detail?.session || !this.aliases.has(id)) throw unavailable("Pi history could not be read safely");
      if (this.options.isPiSessionBusy?.(id) || detail.session.readOnlyReason ||
        detail.session.capabilities?.canPrompt === false || detail.session.scheduledRun) {
        throw unavailable("Pi still owns active or protected work in this chat; linking is deferred");
      }
      const configPath = join(this.runtime, "bridge.json");
      const config = JSON.parse(await readFile(configPath, "utf8"));
      if (config.syncEnabled !== true || !config.pythonExecutable || !config.pythonLibrary) throw unavailable();
      const value = await new Promise<Native>((resolveResult, reject) => {
        const child = spawn(config.pythonExecutable, ["-m", "codex_pi_sync.import_cli", "--bridge-config", configPath],
          { windowsHide: true, env: { ...process.env, PYTHONPATH: config.pythonLibrary }, stdio: ["pipe", "pipe", "ignore"] });
        let output = "";
        const timer = setTimeout(() => { child.kill(); reject(unavailable("Pi history linking timed out; it was not retried")); }, 120_000);
        child.stdout.on("data", data => { if (output.length < 64_000) output += data.toString(); });
        child.on("error", () => { clearTimeout(timer); reject(unavailable()); });
        child.on("close", code => {
          clearTimeout(timer);
          if (code !== 0) { reject(unavailable("Pi history linking is incomplete; its original history is preserved")); return; }
          try { resolveResult(JSON.parse(output)); } catch { reject(unavailable()); }
        });
        child.stdin.on("error", () => undefined);
        child.stdin.end(JSON.stringify({ origin: { kind: "pi-desktop", sessionId: id },
          session: detail.session, messages: detail.session.messages }));
      });
      if (value.origin?.kind !== "pi-desktop" || value.origin.sessionId !== id || value.state !== "linked" ||
        typeof value.threadId !== "string" || !/^[a-f0-9-]{36}$/i.test(value.threadId)) throw unavailable();
      this.aliases.get(id)!.threadId = value.threadId;
      this.bindings.set(id, value.threadId);
      this.options.router.registerBackend(makeRemoteSessionId(HOST, value.threadId), this);
      await this.subscribe(value.threadId);
      this.options.emit(IPC.event.sessionsChanged, { reason: "codex.linked", sessionId: id });
      return value.threadId;
    })();
    this.linking.set(id, task);
    try { return await task; } finally { if (this.linking.get(id) === task) this.linking.delete(id); }
  }

  /** Read only an already-bound latest terminal result, without creating links. */
  async readCompletedResultSource(sessionId: string, turnId: string): Promise<Native> {
    await this.ensure();
    const parsed = parseRemoteSessionId(sessionId);
    const threadId = this.aliases.get(sessionId)?.threadId ?? (parsed?.hostKey === HOST ? parsed.hostSessionId : undefined);
    if (!threadId) throw unsupported();
    const state = await this.request("thread/read", { threadId, includeTurns: false });
    if (state.thread?.status?.type === "active") throw unavailable("Result task is still working");
    const turns = await this.request("thread/turns/list", { threadId, limit: 1, sortDirection: "desc", itemsView: "notLoaded" });
    const turn = turns.data?.[0];
    if (turn?.id !== turnId || turn.status !== "completed") throw unavailable("No completed result for this turn");
    const entries = await this.request("thread/items/list", { threadId, limit: 30, sortDirection: "desc" });
    return { id: turn.id, status: turn.status, items: (entries.data ?? []).filter((entry: Native) => entry.turnId === turnId).map((entry: Native) => entry.item) };
  }

  async invoke(channel: string, args: readonly unknown[]): Promise<unknown> {
    await this.ensure();
    const first = args[0] as any;
    const rawId = typeof first === "string" ? first : first?.sessionId ?? first?.id;
    const id = this.aliases.has(rawId) ? rawId : sessionIdForCall(args);
    const parsed = id ? parseRemoteSessionId(id) : null;
    if (!id || (!this.aliases.has(id) && parsed?.hostKey !== HOST)) throw unsupported();
    const threadId = this.aliases.has(id) ? await this.threadForPi(id) : parsed!.hostSessionId;
    const input = typeof args[0] === "object" && args[0] ? args[0] as Native : {};
    if (channel === IPC.invoke.sessionGet) {
      const thread = await this.subscribe(threadId);
      const limit = Math.min(500, Math.max(1, Number(input.messageLimit) || 100));
      let cursor: string | undefined;
      if (input.messageBefore !== undefined) {
        const saved = this.historyCursors.get(input.messageBefore);
        if (!saved || saved.threadId !== threadId) throw unavailable("History cursor expired; reopen the chat");
        cursor = saved.cursor;
      }
      const result = await this.request("thread/items/list", { threadId, limit, sortDirection: "desc", ...(cursor ? { cursor } : {}) });
      const messages = result.data.slice().reverse().map((entry: Native) => nativeItemToMessage(entry, millis(thread.createdAt)));
      const cache = cursor ? this.messages.get(threadId) ?? new Map<string, UiMessage>() : new Map<string, UiMessage>();
      for (const message of messages) cache.set(message.id, message);
      this.messages.set(threadId, cache);
      let messageStart = 0;
      if (result.nextCursor && messages.length) {
        messageStart = this.nextHistoryCursor--;
        this.historyCursors.set(messageStart, { threadId, cursor: result.nextCursor });
        while (this.historyCursors.size > 1024) this.historyCursors.delete(this.historyCursors.keys().next().value!);
      }
      const session: SessionDetail = { ...this.summary(thread), id: this.outward(threadId), messageCount: cache.size,
        messages, messageStart, hasMoreBefore: Boolean(result.nextCursor), hasMoreAfter: false };
      return { session };
    }
    if (channel === IPC.invoke.sessionRename) {
      await this.request("thread/name/set", { threadId, name: args[1] });
      this.threads.get(threadId)!.name = args[1];
      this.options.emit(IPC.event.sessionsChanged, { reason: "codex.renamed" });
      return { ok: true };
    }
    if (channel === IPC.invoke.agentPrompt) {
      if (this.admissions.has(threadId)) throw unavailable("A submission is already being admitted for this chat");
      this.admissions.add(threadId);
      try {
        const state = await this.request("thread/read", { threadId, includeTurns: false });
        if (state.thread.status?.type === "active") throw unavailable("This chat is already working; use steering or wait for it to finish");
        await this.subscribe(threadId);
        if (input.startGoal || input.truncateFromMessageId || input.truncateBefore !== undefined || input.sessionMessageId) throw unsupported();
        const nativeInput: Native[] = [{ type: "text", text: input.content }];
        for (const attachment of input.attachments ?? []) {
          if (attachment.kind === "image") nativeInput.push({ type: "localImage", path: attachment.path });
          else nativeInput.push({ type: "text", text: `Attached file reference: ${attachment.path}` });
        }
        if (input.messageId) this.optimistic.set(threadId, input.messageId);
        const result = await this.request("turn/start", { threadId, input: nativeInput });
        return { accepted: true, turnId: result.turn.id };
      } finally { this.admissions.delete(threadId); }
    }
    if (channel === IPC.invoke.agentGetStatus) {
      const state = await this.request("thread/read", { threadId, includeTurns: false });
      return { status: { sessionId: this.outward(threadId), isRunning: state.thread.status?.type === "active",
        currentTurnId: this.running.get(threadId),
        pendingToolConfirmations: [...this.pending.values()].filter(value => value.params.threadId === threadId).length } };
    }
    if (channel === IPC.invoke.agentQueueList) return { entries: [] };
    if (channel === IPC.invoke.sessionOpen) {
      // The gateway selects the actual returned view. A bare OK never reaches
      // mcpControlRendererEvent and therefore cannot navigate the renderer.
      const detail = await this.invoke(IPC.invoke.sessionGet, [{ sessionId: id, messageLimit: 1 }]) as { session: SessionDetail };
      return { ...detail, requestedSessionId: id };
    }
    if (channel === IPC.invoke.agentStop || channel === IPC.invoke.agentAbort) {
      const current = this.running.get(threadId);
      const turnId = input.turnId && input.turnId !== current ? undefined : current;
      if (turnId) await this.request("turn/interrupt", { threadId, turnId });
      return channel === IPC.invoke.agentAbort ? { aborted: Boolean(turnId) } : { requested: Boolean(turnId) };
    }
    if (channel === IPC.invoke.agentSteer) {
      const turnId = this.running.get(threadId);
      if (!turnId || input.expectedTurnId !== turnId) throw unavailable("The exact target turn is no longer running");
      if (typeof input.content !== "string" || !input.content.trim()) throw unsupported();
      await this.request("turn/steer", { threadId, expectedTurnId: turnId,
        input: [{ type: "text", text: input.content }] });
      return { accepted: true, turnId };
    }
    if (channel === IPC.invoke.pendingInteractive) {
      const requests = [...this.pending.values()].filter(value => value.params.threadId === threadId);
      return { asks: requests.filter(value => value.method === "item/tool/requestUserInput").map(value => ({
        requestId: value.outward, sessionId: id, toolCallId: value.params.itemId,
        questions: value.params.questions })), permissions: requests.filter(value => value.method.includes("requestApproval")).map(value => ({
          requestId: value.outward, sessionId: id, toolCallId: value.params.itemId,
          toolName: value.method, argsPreview: value.params, risk: "high", reason: value.params.reason ?? "Codex requires approval" })) };
    }
    if (channel === IPC.invoke.toolResolvePermission || channel === IPC.invoke.askToolResolve) {
      const pending = this.pending.get(input.requestId);
      if (!pending || pending.params.threadId !== threadId || !parseRemoteApprovalRequestId(input.requestId)) throw unsupported();
      let result: Native;
      if (channel === IPC.invoke.askToolResolve) {
        if (pending.method !== "item/tool/requestUserInput") throw unsupported();
        result = { answers: Object.fromEntries(pending.params.questions.map((question: Native, index: number) =>
          [question.id, { answers: input.answers[index] ?? [] }])) };
      } else {
        if (!pending.method.includes("requestApproval")) throw unsupported();
        // Session-wide and permanent grants are intentionally not synthesized.
        if (!["deny", "allow-once", "allow-session"].includes(input.decision)) throw unsupported();
        result = { decision: input.decision === "deny" ? "decline" : "accept" };
      }
      this.transport!.send(JSON.stringify({ id: pending.id, result }));
      this.pending.delete(input.requestId);
      return { ok: true };
    }
    throw unsupported();
  }
}
