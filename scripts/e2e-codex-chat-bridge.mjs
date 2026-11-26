// The actual native Codex owner + local model fixture are supplied by the Python harness.
// This exercises Main's real adapter and router, without either user's live app.
import assert from "node:assert/strict";
import { register } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
register(pathToFileURL(join(root, "apps/desktop/test/helpers/ts-import-hooks.mjs")));
const { IPC } = await import("@pi-desktop/shared");
const { nativeJsonRpcWebSocketTransport } = await import("@pi-desktop/racp");
const { CodexChatBridge } = await import("../apps/desktop/electron/main/codex/codex-chat-bridge.ts");
const { createBackendRouter, makeRemoteSessionId } = await import("../apps/desktop/electron/main/remote/backend-router.ts");

const runtime = process.env.CODEX_PI_SYNC_RUNTIME;
assert(runtime, "Explicit isolated runtime is required");
const config = JSON.parse(await readFile(join(runtime, "bridge.json"), "utf8"));
assert.equal(config.testFixture, true, "Refusing to run against a non-fixture installation");
const metadata = JSON.parse(await readFile(join(runtime, "connection.json"), "utf8"));
const token = (await readFile(metadata.tokenFile, "utf8")).trim();
const wire = await nativeJsonRpcWebSocketTransport({ url: metadata.url, token })();
let counter = 0;
const replies = new Map(), notices = [];
wire.onMessage(frame => {
  const value = JSON.parse(frame);
  if (value.method) { notices.push(value); return; }
  const waiter = replies.get(value.id);
  if (!waiter) return;
  replies.delete(value.id); clearTimeout(waiter.timer);
  value.error ? waiter.reject(new Error(value.error.message)) : waiter.resolve(value.result);
});
wire.onError(() => {});
const request = (method, params) => new Promise((resolve, reject) => {
  const id = `native-desktop-fixture-${++counter}`;
  const timer = setTimeout(() => { replies.delete(id); reject(new Error("Native fixture deadline exceeded")); }, 25000);
  replies.set(id, { resolve, reject, timer });
  wire.send(JSON.stringify({ id, method, params }));
});
const events = [];
const eventWaiters = [];
const emit = (channel, value) => {
  events.push({ channel, value });
  for (const waiter of [...eventWaiters]) if (waiter.predicate(channel, value)) {
    clearTimeout(waiter.timer); eventWaiters.splice(eventWaiters.indexOf(waiter), 1); waiter.resolve();
  }
};
const waitEvent = predicate => new Promise((resolve, reject) => {
  if (events.some(event => predicate(event.channel, event.value))) return resolve();
  const waiter = { predicate, resolve, timer: setTimeout(() => reject(new Error("Pi event deadline exceeded")), 25000) };
  eventWaiters.push(waiter);
});
const router = createBackendRouter();
const piId = randomUUID();
const stamp = new Date().toISOString();
const original = { id: piId, title: "Original Pi fixture", projectPath: config.codexHome,
  createdAt: stamp, updatedAt: stamp, messageCount: 2, mode: "agent", permissionMode: "inherit", thinkingLevel: "off",
  messages: [
    { id: "historical-user", role: "user", content: "Original Pi historical question", createdAt: stamp },
    { id: "historical-answer", role: "assistant", content: "Original Pi historical answer", createdAt: stamp },
  ] };
let sourceBusy = false;
let bridge = new CodexChatBridge({ router, emit, runtimeDirectory: runtime,
  isPiSessionBusy: id => id === piId && sourceBusy,
  readPiSession: async id => id === piId ? { session: original } : null });
try {
  await request("initialize", { clientInfo: { name: "native-desktop-fixture", version: "1" }, capabilities: { experimentalApi: true } });
  wire.send(JSON.stringify({ method: "initialized", params: {} }));
  const thread = (await request("thread/start", { cwd: config.codexHome })).thread;
  await request("thread/inject_items", { threadId: thread.id, items: [{ type: "message", role: "user",
    content: [{ type: "input_text", text: "Synthetic initial fixture context" }] }] });
  await bridge.start();
  await bridge.refresh();
  const id = makeRemoteSessionId("codex-shared", thread.id);
  await bridge.invoke(IPC.invoke.sessionGet, [{ id }]);
  const started = await request("turn/start", { threadId: thread.id, input: [{ type: "text", text: "Start in Codex" }] });
  await waitEvent((channel, value) => channel === IPC.event.agentMessage && value.turnId === started.turn.id && value.event.type === "agent_end");
  const next = await bridge.invoke(IPC.invoke.agentPrompt, [{ sessionId: id, content: "Continue in Pi", messageId: randomUUID() }]);
  await waitEvent((channel, value) => channel === IPC.event.agentMessage && value.turnId === next.turnId && value.event.type === "agent_end");
  const detail = (await bridge.invoke(IPC.invoke.sessionGet, [{ id }])).session;
  assert.equal(detail.messages.length, 4);
  assert.equal(detail.modelId, "gpt-6.1-sol", "Pi displays the native owner's actual model");
  const status = await bridge.invoke(IPC.invoke.agentGetStatus, [id]);
  assert.equal(status.status.isRunning, false, "Status retains the public response envelope");
  bridge.registerPiSession({ ...original, id: "readonly-fixture", capabilities: { canPrompt: false } });
  assert.equal(bridge.ownsPiSession("readonly-fixture"), false, "Native continuation refusals are preserved");
  assert(detail.messages.some(message => message.content === "Start in Codex"));
  assert(detail.messages.some(message => message.content === "Continue in Pi"));
  assert(detail.messages.some(message => message.content === "Fixture reply 2"));
  assert(events.some(event => event.value.event?.type === "message_update"), "Real streaming update reached Pi");
  assert(notices.some(notice => notice.method === "turn/completed" && notice.params.turn.id === next.turnId), "Codex observed Pi's turn");

  bridge.registerPiSession(original);
  sourceBusy = true;
  await assert.rejects(() => bridge.invoke(IPC.invoke.sessionGet, [{ id: piId }]), /linking is deferred/);
  sourceBusy = false;
  const routed = await router.route(IPC.invoke.sessionGet, [{ id: piId }]);
  assert.equal(routed.remote, true);
  assert.equal(routed.value.session.id, piId, "The actual Pi sidebar identity is retained");
  assert.equal(routed.value.session.messages.length, 2);
  const migrated = await bridge.invoke(IPC.invoke.agentPrompt, [{ sessionId: piId, content: "Continue imported Pi chat", messageId: randomUUID() }]);
  await waitEvent((channel, value) => channel === IPC.event.agentMessage && value.turnId === migrated.turnId && value.event.type === "agent_end");
  const registry = JSON.parse(await readFile(join(runtime, "links.json"), "utf8"));
  const binding = registry.links[`pi-desktop:${piId}`];
  assert.equal(binding.origin.kind, "pi-desktop");
  assert.notEqual(binding.threadId, piId, "Pi identities are never passed off as Codex IDs");
  assert.equal(binding.state, "linked");
  const nativeImported = await request("thread/items/list", { threadId: binding.threadId, limit: 50, sortDirection: "asc" });
  assert(JSON.stringify(nativeImported).includes("Original Pi historical answer"));
  assert(JSON.stringify(nativeImported).includes("Continue imported Pi chat"));

  bridge.close();
  bridge = new CodexChatBridge({ router, emit, runtimeDirectory: runtime,
    readPiSession: async id => id === piId ? { session: original } : null });
  await bridge.start();
  bridge.registerPiSession(original);
  await bridge.refresh();
  const restored = (await bridge.invoke(IPC.invoke.sessionGet, [{ id: piId }])).session;
  assert.equal(restored.messages.length, 4);
  assert.equal(JSON.parse(await readFile(join(runtime, "links.json"), "utf8")).links[`pi-desktop:${piId}`].threadId, binding.threadId);
  console.log(JSON.stringify({ passed: true, codexToPi: true, piToCodex: true, streaming: true,
    existingPiHistory: true, stablePiIdentity: true, reconnectWithoutDuplicateImport: true, liveModelRequests: 0 }));
} finally {
  bridge.close(); wire.close();
  for (const waiter of eventWaiters) clearTimeout(waiter.timer);
  for (const waiter of replies.values()) clearTimeout(waiter.timer);
}
