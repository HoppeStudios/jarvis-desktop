#!/usr/bin/env node
/** Real Host stdio/persistence + Main admission + renderer readiness.
 * Media and greeting evidence are fixtures: no Electron, accounts or calls.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { register } from "node:module";
import { Host, resolveHostBinary } from "./e2e/host.mjs";
register(new URL("../apps/desktop/test/helpers/ts-import-hooks.mjs", import.meta.url));
const { LiveVoiceAutomation } = await import("../apps/desktop/electron/main/live-voice/automation.ts");
const { JarvisCoordinatorCleanup, RendererCleanupProbe } = await import("../apps/desktop/electron/main/jarvis/coordinator-cleanup.ts");
const { SessionCleanupReadiness } = await import("../apps/desktop/src/lib/session-cleanup-readiness.ts");
const { createSessionCoordination } = await import("../apps/desktop/electron/main/runtime/session-coordination.ts");
const { writeComposerDraft, registerLiveComposerDraft } = await import("../apps/desktop/src/lib/composer-draft-cache.ts");
const temp = await mkdtemp(join(process.env.PI_SCRATCH_DIR || tmpdir(), "jarvis-cleanup-e2e-"));
const host = new Host(resolveHostBinary(), join(temp, "data"), { quiet: true });
const owner = { webContentsId:1, frameProcessId:2, frameRoutingId:3, url:"file:///fixture/index.html" };
const greetingEvidence = { providerReady:true, requestSent:true, transcriptReceived:true, transcriptMatches:true,
  measuredAudio:true, playbackActive:false, turnComplete:true, contextState:"running" };
try {
  await host.start();
  const unrelated = (await host.call("session.create", { title:"Unrelated fixture history" })).session.id;
  await host.call("session.appendMessage", { sessionId:unrelated, message:{ id:randomUUID(), role:"user",
    content:"Public test fixture, not a captured conversation", createdAt:new Date().toISOString(), status:"complete" } });
  for (const scenario of ["empty", "manual", "speech", "cached-draft", "live-editor", "selected", "active-turn", "queued-input", "partial-user"] ) {
    let call = null, sent, created, now = 0;
    const state = { activeSessionId:unrelated, retainedSessionIds:[], composerPrefill:null };
    const renderer = new SessionCleanupReadiness(() => state);
    let probe;
    probe = new RendererCleanupProbe((identity, request) => probe.complete(identity, renderer.receive(request)));
    const turns = new Map();
    const coordination = createSessionCoordination({ activeTurns:turns, getMainWindow:()=>null, getViewingSessionId:()=>null });
    const cleanup = new JarvisCoordinatorCleanup({ probe, host:()=>host, acquireSessionOperation:coordination.acquireSessionOperation,
      isBusy:coordination.isSessionBusy, drain:async()=>{}, forget:()=>{}, warn:()=>{} });
    let sentResolve;
    const dispatched = new Promise(resolve=>{sentResolve=resolve;});
    const manager = new LiveVoiceAutomation({ now:()=>now, enabled:async()=>true,
      status:async()=>({enabled:true, settingsRevision:1, bindings:[], call}), owner:()=>owner,
      send:(_identity,request)=>{sent=request;sentResolve();},
      end:async()=>{call={...call, phase:"ended", mediaRelease:"confirmed"};},
      createCoordinator:async()=>{created=(await host.call("session.create",{title:"Jarvis",mode:"agent"})).session.id;return created;},
      observeCoordinator:(identity,id)=>cleanup.observe(identity,id),
      cleanupCoordinator:(identity,id,verify)=>cleanup.cleanup(identity,id,verify),
    });
    const requestId = randomUUID();
    const started = manager.control({ requestId, action:"wake", freshCoordinator:true, presenceGreeting:scenario!=="manual" });
    await dispatched;
    assert.equal(sent.workSessionId,created);
    call={ callId:randomUUID(), phase:"connected", muted:false, userSpeaking:false, userTurnCount:0,
      mediaRelease:"pending", workBinding:{workSessionId:created} };
    await manager.complete(owner,{requestId,callId:call.callId,greetingPlayed:true,greetingFinishedAt:Date.now(),greetingEvidence});
    await started;
    now = 10001; // Controlled timeout clock; no real call or human input.
    let unregister;
    if(scenario==="speech")call.lastUserSpeechAt=Date.now();
    if(scenario==="cached-draft")writeComposerDraft(created,{text:"Unsent fixture",fileReferences:[]});
    if(scenario==="live-editor")unregister=registerLiveComposerDraft(()=>[created]);
    if(scenario==="selected")state.activeSessionId=created;
    if(scenario==="partial-user")renderer.noteUserPresence(created);
    if(scenario==="active-turn"){
      turns.set(created,"fixture-turn");
      await host.call("session.beginTurn",{sessionId:created});
    }
    if(scenario==="queued-input")await host.call("session.queuePush",{sessionId:created,principal:"fixture",inputHash:"fixture",content:"Queued fixture",permissionMode:"ask"});
    const result=await manager.control({requestId:randomUUID(),action:"end",expectedCallId:call.callId,cleanupUnanswered:true});
    assert.equal(result.coordinatorCleanup,scenario==="empty"?"deleted":"deferred",scenario);
    const persisted=await host.call("session.get",{id:created});
    assert.equal(Boolean(persisted.session),scenario!=="empty",scenario);
    unregister?.();
    console.log("PASS " + scenario);
  }
  await host.restart();
  const history=await host.call("session.get",{id:unrelated});
  assert.equal(history.session.messages.length,1);
  console.log("PASS unrelated history survives cleanup and Host restart");
} finally {
  await host.stop();
  await rm(temp,{recursive:true,force:true});
}
