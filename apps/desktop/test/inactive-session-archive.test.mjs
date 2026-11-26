import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";
register(new URL("./helpers/ts-import-hooks.mjs", import.meta.url));
const { inactiveSessionIds, CHAT_INACTIVITY_MS } = await import("../src/lib/inactive-session-archive.ts");
const { sessionListPage, sessionListQuery } = await import("../electron/main/mcp-session-page.ts");
const now = Date.parse("2026-11-26T12:00:00Z");
const session = (id, age) => ({ id, title: id, updatedAt: new Date(now - age).toISOString() });

test("strict four-week threshold and invalid timestamps preserve recent/unknown chats", () => {
  const sessions = [session("old", CHAT_INACTIVITY_MS + 1), session("boundary", CHAT_INACTIVITY_MS),
    session("recent", 8 * 24 * 60 * 60 * 1000), session("three-weeks", 21 * 24 * 60 * 60 * 1000), { id: "unknown", updatedAt: "invalid" }];
  assert.deepEqual(inactiveSessionIds(sessions, {}, new Set(), now), ["old"]);
});
test("running, selected, voice and draft protections leave their histories untouched", () => {
  const ids = ["running", "selected", "voice", "draft", "idle"];
  assert.deepEqual(inactiveSessionIds(ids.map(id => session(id, CHAT_INACTIVITY_MS * 2)), {}, new Set(ids.slice(0, 4)), now), ["idle"]);
});
test("existing archives are idempotent and a manual restore grants a fresh inactivity window", () => {
  const sessions = [session("archived", CHAT_INACTIVITY_MS * 2), session("restored", CHAT_INACTIVITY_MS * 2)];
  const meta = { archived: { archived: true }, restored: { restoredAt: now } };
  assert.deepEqual(inactiveSessionIds(sessions, meta, new Set(), now), []);
  assert.deepEqual(inactiveSessionIds(sessions, meta, new Set(), now + CHAT_INACTIVITY_MS + 1), ["restored"]);
});
test("MCP excludes the native archive flags without dropping identities or modifying input", () => {
  const input = { sessions: [{ id: "a" }, { id: "b" }, { id: "c", archived: true }], runningSessionIds: ["a"] };
  const original = JSON.stringify(input);
  const result = sessionListPage(input, {}, { sessionMeta: { b: { archived: true } } });
  assert.deepEqual(result.sessions.map(s => s.id), ["a"]);
  assert.equal(result.total, 1);
  assert.equal(result.nextOffset, null);
  assert.equal(JSON.stringify(input), original);
  assert.deepEqual(sessionListPage(input, { includeArchived: true }, {}).sessions.map(s => s.id), ["a", "b", "c"]);
});
test("bounded pages and explicit archived title search remain accessible", () => {
  const input = { sessions: Array.from({ length: 145 }, (_, i) => ({ id: String(i), title: i === 144 ? "Jednoduchý protokol" : "task" })) };
  const first = sessionListPage(input, {}, {});
  assert.equal(first.sessions.length, 50);
  assert.equal(first.nextOffset, 50);
  const last = sessionListPage(input, { offset: 100, limit: 50 }, {});
  assert.equal(last.sessions.length, 45);
  assert.equal(last.nextOffset, null);
  const found = sessionListPage(input, { includeArchived: true, search: "jednoduchy" }, { sessionMeta: { "144": { archived: true } } });
  assert.equal(found.sessions[0].id, "144");
  assert.equal(found.sessions[0].archived, true);
});
test("MCP query rejects malformed/unbounded input before forwarding", () => {
  for (const args of [[null], [{ limit: 101 }], [{ offset: -1 }], [{ includeArchived: "yes" }], [{ arbitrary: true }], [{ search: "x".repeat(201) }]]) {
    assert.throws(() => sessionListQuery(args), { code: "INVALID_PARAMS" });
  }
  assert.deepEqual(sessionListQuery([]), {});
});
