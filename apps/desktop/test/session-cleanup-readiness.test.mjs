import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
register(pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), "helpers/ts-import-hooks.mjs")));
const { SessionCleanupReadiness } = await import("../src/lib/session-cleanup-readiness.ts");
const drafts = await import("../src/lib/composer-draft-cache.ts");

function harness() {
 drafts.resetComposerDraftCache();
 const state = { activeSessionId: "other", selectingSessionId: undefined, retainedSessionIds: [], composerPrefill: null };
 const readiness = new SessionCleanupReadiness(() => state);
 const request = (phase, requestId = "lease") => ({ phase, requestId, sessionId: "owned" });
 return { state, readiness, request };
}

test("only an observed fresh unselected empty coordinator can reserve cleanup", () => {
 const { readiness, request } = harness();
 assert.equal(readiness.receive(request("prepare")).ready, false);
 assert.equal(readiness.receive(request("observe")).ready, true);
 assert.equal(readiness.receive(request("prepare")).ready, true);
 assert.equal(readiness.receive(request("commit")).ready, true);
 assert.equal(readiness.receive(request("commit", "stale")).ready, false);
 readiness.receive({ ...request("release"), deleted: true });
 assert.equal(readiness.receive(request("prepare")).ready, false);
});

test("prior adoption, cached empty editor state and partial speech disqualify cleanup", () => {
 for (const prepare of [h=>drafts.writeComposerDraft("owned",{text:"",fileReferences:[]}),
  h=>{h.state.navStack=[{sessionId:"owned"}];}]) {
  const h=harness();prepare(h);
  assert.equal(h.readiness.receive(h.request("observe")).ready,false);
 }
 const h=harness();h.readiness.receive(h.request("observe"));
 h.readiness.noteUserPresence("owned");
 assert.equal(h.readiness.receive(h.request("prepare")).ready,false);
});

test("unknown deletion outcome retains reservation rather than admitting input",async()=>{
 const h=harness();h.readiness.receive(h.request("observe"));h.readiness.receive(h.request("prepare"));h.readiness.receive(h.request("commit"));
 assert.equal(h.readiness.receive(h.request("release")).ready,false);
 let settled=false;
 const selecting=Promise.resolve(h.readiness.admitSelection("owned")).then(value=>{settled=true;return value;});
 await Promise.resolve();assert.equal(settled,false);
 h.readiness.receive({...h.request("release"),deleted:false});
 assert.equal(await selecting,true);
});

test("cached text, whitespace and attachments are never empty", () => {
 for (const snapshot of [{ text: "draft", fileReferences: [] }, { text: " ", fileReferences: [] },
  { text: "", fileReferences: [{ path: "fixture.txt", name: "fixture.txt" }] }]) {
  const { readiness, request } = harness();
  readiness.receive(request("observe"));
  drafts.writeComposerDraft("owned", snapshot);
  assert.equal(readiness.receive(request("prepare")).ready, false);
 }
});

test("current editor ownership preserves uncached live drafts, including transitions", () => {
 const { readiness, request } = harness();
 readiness.receive(request("observe"));
 const unregister = drafts.registerLiveComposerDraft(() => ["owned", "other"]);
 assert.equal(drafts.readComposerDraft("owned"), undefined);
 assert.equal(readiness.receive(request("prepare")).ready, false);
 unregister();
});

test("selection or an edit between prepare and commit invalidates the acknowledgement", () => {
 for (const change of [h => { h.state.selectingSessionId = "owned"; }, h => { h.state.activeSessionId = "owned"; },
  () => drafts.markComposerDraftEdited("owned"), h => { h.state.composerPrefill = { sessionId: "owned" }; }]) {
  const h = harness();
  h.readiness.receive(h.request("observe"));
  assert.equal(h.readiness.receive(h.request("prepare")).ready, true);
  change(h);
  assert.equal(h.readiness.receive(h.request("commit")).ready, false);
 }
});

test("navigation cancels preparation; committed deletion serializes later navigation", async () => {
 const h = harness();
 h.readiness.receive(h.request("observe"));
 h.readiness.receive(h.request("prepare"));
 assert.equal(await h.readiness.admitSelection("owned"), true);
 assert.equal(h.readiness.receive(h.request("commit")).ready, false);
 const next = harness();
 next.readiness.receive(next.request("observe"));
 next.readiness.receive(next.request("prepare"));
 next.readiness.receive(next.request("commit"));
 let settled = false;
 const selection = next.readiness.admitSelection("owned").then(value => { settled = true; return value; });
 await Promise.resolve();
 assert.equal(settled, false);
 next.readiness.receive({ ...next.request("release"), deleted: true });
 assert.equal(await selection, false);
 assert.equal(await next.readiness.admitSelection("other"), true);
});

test("failed deletion releases navigation without erasing draft or history state", async () => {
 const h = harness();
 h.readiness.receive(h.request("observe"));
 h.readiness.receive(h.request("prepare"));
 h.readiness.receive(h.request("commit"));
 const selection = h.readiness.admitSelection("owned");
 h.readiness.receive({ ...h.request("release"), deleted: false });
 assert.equal(await selection, true);
 assert.equal(h.state.activeSessionId, "other");
});
