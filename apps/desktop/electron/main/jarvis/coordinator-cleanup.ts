import { randomUUID } from "node:crypto";
import type { WebContents } from "electron";
import type { SessionCleanupRequest, SessionCleanupResponse } from "@pi-desktop/shared";
import type { LiveOwner } from "../live-voice/call-service-internals";
import { ownerKey } from "../live-voice/call-service-internals";

/** IPC registers before the first window; attach lazily, and detach on replacement. */
export function createCleanupDocumentWatcher(
  getContents: () => Pick<WebContents, "on" | "off" | "once"> | null,
  invalidate: () => void,
): () => void {
  let contents: ReturnType<typeof getContents> = null;
  const onNavigation = (_event: unknown, _url: string, inPlace: boolean, mainFrame: boolean) => {
    if (mainFrame && !inPlace) invalidate();
  };
  const onGone = () => invalidate();
  const detach = () => {
    contents?.off("did-start-navigation", onNavigation);
    contents?.off("render-process-gone", onGone);
    contents?.off("destroyed", onDestroyed);
  };
  const onDestroyed = () => { invalidate(); detach(); contents = null; };
  return () => {
    const next = getContents();
    if (contents === next) return;
    if (contents) { invalidate(); detach(); }
    contents = next;
    contents?.on("did-start-navigation", onNavigation);
    contents?.on("render-process-gone", onGone);
    contents?.once("destroyed", onDestroyed);
  };
}

type Phase = SessionCleanupRequest["phase"];
const sameOwner = (a: LiveOwner, b: LiveOwner) => ownerKey(a) === ownerKey(b) && a.url === b.url;

/** Nonces are Main-issued, single-use, phase- and document-bound. */
export class RendererCleanupProbe {
  private generation = 0;
  get revision(): number { return this.generation; }
  invalidate(): void {
    this.generation++;
    for (const pending of [...this.pending.values()]) pending.resolve(false);
  }
  private readonly pending = new Map<string, { owner: LiveOwner; request: SessionCleanupRequest;
    resolve: (ready: boolean) => void; timer: ReturnType<typeof setTimeout> }>();
  private readonly send: (owner: LiveOwner, request: SessionCleanupRequest) => void;
  private readonly timeoutMs: number;
  constructor(send: (owner: LiveOwner, request: SessionCleanupRequest) => void, timeoutMs = 2_000) {
    this.send = send; this.timeoutMs = timeoutMs;
  }
  ask(owner: LiveOwner, request: SessionCleanupRequest): Promise<boolean> {
    const key = request.requestId + ":" + request.phase;
    if (this.pending.has(key)) return Promise.resolve(false);
    return new Promise(resolve => {
      const finish = (ready: boolean) => {
        const pending = this.pending.get(key);
        if (!pending) return;
        clearTimeout(pending.timer); this.pending.delete(key); resolve(ready);
      };
      const timer = setTimeout(() => finish(false), this.timeoutMs);
      this.pending.set(key, { owner, request, resolve: finish, timer });
      try { this.send(owner, request); } catch { finish(false); }
    });
  }
  complete(owner: LiveOwner, raw: unknown): { accepted: boolean } {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { accepted: false };
    const response = raw as SessionCleanupResponse;
    if (Object.keys(raw).some(key => !["requestId", "sessionId", "phase", "ready"].includes(key)) ||
        typeof response.requestId !== "string" || typeof response.sessionId !== "string" ||
        typeof response.phase !== "string" || typeof response.ready !== "boolean") return { accepted: false };
    const pending = this.pending.get(response.requestId + ":" + response.phase);
    if (!pending || !sameOwner(owner, pending.owner) || pending.request.sessionId !== response.sessionId) return { accepted: false };
    pending.resolve(response.ready);
    return { accepted: true };
  }
}

type Host = { call: <T>(method: string, params: unknown) => Promise<T> };
type Dependencies = {
  probe: RendererCleanupProbe;
  refreshOwner?: () => void;
  host: () => Host | null;
  acquireSessionOperation: (id: string) => Promise<() => void>;
  isBusy: (id: string) => boolean;
  drain: (id: string) => Promise<void>;
  forget: (id: string) => void;
  warn: () => void;
};

/** Owns only fresh automatic coordinators, never generic session deletion. */
export class JarvisCoordinatorCleanup {
  private readonly owned = new Map<string, { capability: string; host: Host; owner: LiveOwner; revision: number }>();
  private readonly deps: Dependencies;
  constructor(deps: Dependencies) { this.deps = deps; }

  async observe(owner: LiveOwner, id: string): Promise<void> {
    this.deps.refreshOwner?.();
    const host = this.deps.host();
    if (!host) return;
    if (this.owned.size >= 64) this.owned.delete(this.owned.keys().next().value!);
    const revision = this.deps.probe.revision;
    const requestId = randomUUID();
    if (!await this.deps.probe.ask(owner, { requestId, sessionId: id, phase: "observe" })) return;
    const capability = randomUUID();
    try {
      const result = await host.call<{ ok: boolean }>("jarvis.coordinator.arm", { id, capability });
      if (result.ok && host === this.deps.host() && revision === this.deps.probe.revision) this.owned.set(id, { capability, host, owner, revision });
    } catch { this.deps.warn(); } // Uncertain cleanup eligibility never blocks a voice start.
  }

  async cleanup(owner: LiveOwner, id: string, verifyCall: () => Promise<boolean>): Promise<"deleted" | "deferred"> {
    this.deps.refreshOwner?.();
    const owned = this.owned.get(id);
    if (!owned || !sameOwner(owner, owned.owner) || owned.host !== this.deps.host() || owned.revision !== this.deps.probe.revision) return "deferred";
    this.owned.delete(id); // A failed/uncertain attempt is never retried automatically.
    const requestId = randomUUID();
    let deleted = false;
    let outcomeKnown = true;
    const releaseOperation = await this.deps.acquireSessionOperation(id);
    const ask = (phase: Phase) => this.deps.probe.ask(owner, { requestId, sessionId: id, phase,
      ...(phase === "release" && outcomeKnown ? { deleted } : {}) });
    try {
      if (this.deps.isBusy(id) || !await verifyCall()) return "deferred";
      await this.deps.drain(id);
      if (!await ask("prepare") || this.deps.isBusy(id) || !await verifyCall()) return "deferred";
      if (!await ask("commit") || this.deps.isBusy(id) || !await verifyCall() || owned.host !== this.deps.host() || owned.revision !== this.deps.probe.revision) return "deferred";
      // No normal agent admission can pass the session operation until this
      // finishes. Renderer navigation to this target is reserved as well.
      outcomeKnown = false;
      const result = await owned.host.call<{ ok: boolean }>("jarvis.coordinator.deleteEmpty", { id, capability: owned.capability });
      if (typeof result.ok !== "boolean") throw new Error("unknown cleanup result");
      outcomeKnown = true;
      deleted = result.ok;
      if (deleted) this.deps.forget(id);
      return deleted ? "deleted" : "deferred";
    } catch {
      this.deps.warn(); // Secret-free metadata; no queue/draft/conversation payload.
      return "deferred";
    } finally {
      // A lost acknowledgement must not unlock navigation on an uncertain
      // deletion. The renderer retains its reservation until release or reload.
      await ask("release");
      releaseOperation();
    }
  }
}
