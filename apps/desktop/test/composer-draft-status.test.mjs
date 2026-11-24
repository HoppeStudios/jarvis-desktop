import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";
register(new URL("./helpers/ts-import-hooks.mjs", import.meta.url));
const { ComposerDraftStatusProbe } = await import("../electron/main/jarvis/composer-draft-status.ts");
const { inspectComposerDrafts, writeComposerDraft, resetComposerDraftCache, registerLiveComposerDraft } =
  await import("../src/lib/composer-draft-cache.ts");
const owner = { webContentsId: 1, frameProcessId: 2, frameRoutingId: 3, url: "file:///fixture/index.html" };
const empty = { cachedDrafts: 0, liveDrafts: 0, busyEditors: 0, unknownEditors: 0, pendingPrefill: false };

test.afterEach(() => resetComposerDraftCache());

test("inactive drafts, whitespace and attachment-only slots stay visible as counts", () => {
  writeComposerDraft("inactive", { text: "PRIVATE_FIXTURE", fileReferences: [] });
  writeComposerDraft("space", { text: " ", fileReferences: [] });
  writeComposerDraft("attachment", { text: "", fileReferences: [{ path: "PRIVATE_PATH", name: "fixture" }] });
  writeComposerDraft("empty", { text: "", fileReferences: [] });
  assert.deepEqual(inspectComposerDrafts(), { cachedDrafts: 3, liveDrafts: 0, busyEditors: 0, unknownEditors: 0 });
  assert.doesNotMatch(JSON.stringify(inspectComposerDrafts()), /PRIVATE|inactive|attachment/);
});

test("lazy live editors report content, focus/composition, absence and unreadability", () => {
  const releases = [
    registerLiveComposerDraft(() => ["empty"], () => "empty"),
    registerLiveComposerDraft(() => ["typed"], () => "nonempty"),
    registerLiveComposerDraft(() => ["ime"], () => "busy"),
    registerLiveComposerDraft(() => ["unknown"]),
    registerLiveComposerDraft(() => ["broken"], () => { throw new Error("fixture unavailable"); }),
  ];
  try { assert.deepEqual(inspectComposerDrafts(), { cachedDrafts: 0, liveDrafts: 1, busyEditors: 1, unknownEditors: 2 }); }
  finally { releases.forEach(release => release()); }
  assert.deepEqual(inspectComposerDrafts(), { cachedDrafts: 0, liveDrafts: 0, busyEditors: 0, unknownEditors: 0 });
});

test("a fresh main-owned nonce accepts only bounded metadata from its owner", async () => {
  let request;
  const probe = new ComposerDraftStatusProbe((_owner, value) => { request = value; });
  const pending = probe.read(owner);
  assert.equal(probe.complete({ ...owner, frameRoutingId: 9 }, { ...request, ...empty }).accepted, false);
  assert.equal(probe.complete(owner, { ...request, ...empty, text: "PRIVATE_FIXTURE" }).accepted, false);
  assert.equal(probe.complete(owner, { ...request, ...empty, cachedDrafts: -1 }).accepted, false);
  assert.equal(probe.complete(owner, { ...request, ...empty, liveDrafts: 1.5 }).accepted, false);
  assert.equal(probe.complete(owner, { ...request, ...empty, busyEditors: 1_000_001 }).accepted, false);
  assert.equal(probe.complete(owner, { ...request, ...empty }).accepted, true);
  const status = await pending;
  assert.equal(status.known, true); assert.equal(status.empty, true);
  assert(Number.isFinite(Date.parse(status.observedAt)));
  assert.equal(probe.complete(owner, { ...request, ...empty }).accepted, false, "single use");
});

for (const field of ["cachedDrafts", "liveDrafts", "busyEditors", "unknownEditors", "pendingPrefill"]) {
  test(`a ${field} observation never authorizes an empty result`, async () => {
    let probe;
    probe = new ComposerDraftStatusProbe((identity, request) => probe.complete(identity,
      { ...request, ...empty, [field]: field === "pendingPrefill" ? true : 1 }));
    const status = await probe.read(owner);
    assert.equal(status.known, true); assert.equal(status.empty, false);
  });
}

test("timeout, missing owner, navigation and bounded pending requests fail closed", async () => {
  let late;
  const probe = new ComposerDraftStatusProbe((_owner, request) => { late = request; }, 10);
  assert.deepEqual(await probe.read(null), { known: false, empty: false });
  assert.deepEqual(await probe.read(owner), { known: false, empty: false });
  assert.equal(probe.complete(owner, { ...late, ...empty }).accepted, false);
  const requests = Array.from({ length: 4 }, () => probe.read(owner));
  assert.deepEqual(await probe.read(owner), { known: false, empty: false });
  probe.invalidate();
  assert((await Promise.all(requests)).every(status => !status.known && !status.empty));
  assert.equal(probe.complete(owner, { ...late, ...empty }).accepted, false);
});
