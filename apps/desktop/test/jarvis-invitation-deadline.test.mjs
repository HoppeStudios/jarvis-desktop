import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { register } from "node:module";
import { fileURLToPath } from "node:url";
register(new URL("./helpers/ts-import-hooks.mjs", import.meta.url));
const { LiveVoiceAutomation } = await import("../electron/main/live-voice/automation.ts");
const pwsh = process.env.PI_JARVIS_PWSH || "pwsh";
const available = spawnSync(pwsh, ["-NoProfile", "-NonInteractive", "-Command", "$PSVersionTable.PSVersion.Major"], { encoding:"utf8", windowsHide:true });
const skip = available.error?.code === "ENOENT" ? "PowerShell 7 is required for the Windows listener contract" : false;
const script = fileURLToPath(new URL("../../../integrations/jarvis/wake/test-invitation.ps1", import.meta.url));
function fold(operation, data) {
  const result = spawnSync(pwsh, ["-NoProfile", "-NonInteractive", "-File", script, "-Fold"], {
    input:JSON.stringify({operation,...data}), encoding:"utf8", windowsHide:true, timeout:10000,
  });
  assert.equal(result.status,0,result.stderr || result.error?.message);
  return JSON.parse(result.stdout);
}
const owner={webContentsId:1,frameProcessId:2,frameRoutingId:3,url:"file:///fixture/index.html"};
const evidence={providerReady:true,requestSent:true,transcriptReceived:true,transcriptMatches:true,measuredAudio:true,
  playbackActive:false,turnComplete:true,contextState:"running"};
async function setup() {
  let now=0,call=null,ends=0,dispatch;
  const dispatched=new Promise(resolve=>{dispatch=resolve;});
  const intentId=randomUUID();
  const manager=new LiveVoiceAutomation({now:()=>now,enabled:async()=>true,owner:()=>owner,
    status:async()=>({enabled:true,settingsRevision:1,bindings:[],call}),createCoordinator:async()=>"coordinator",
    observeCoordinator:async()=>{},send:()=>dispatch(),
    end:async()=>{ends++;call={...call,phase:"ended",mediaRelease:"confirmed"};}});
  const request={requestId:randomUUID(),action:"wake",freshCoordinator:true,presenceGreeting:true,intentId,intentSequence:1};
  const started=manager.control(request);await dispatched;
  call={callId:randomUUID(),phase:"connected",userSpeaking:false,userTurnCount:0,mediaRelease:"pending",workBinding:{workSessionId:"coordinator"}};
  const receivedAt=Date.now(),finishedAt=receivedAt-200;
  await manager.complete(owner,{requestId:request.requestId,callId:call.callId,greetingPlayed:true,greetingFinishedAt:finishedAt,greetingEvidence:evidence});
  const result=await started;
  const common={intentId,paused:false,lastSpeech:"2000-01-01T00:00:00Z"};
  const invitation=fold("create",{request,result,now:new Date(receivedAt).toISOString(),timeoutSeconds:10});
  const end=sequence=>({requestId:randomUUID(),action:"end",expectedCallId:call.callId,cleanupUnanswered:true,intentId,intentSequence:sequence});
  const wall=offset=>new Date(receivedAt+offset).toISOString();
  return {manager,invitation,common,end,wall,call:()=>call,ends:()=>ends,clock:value=>{now=value;},finishedAt};
}

test("actual Main pending deadline survives PowerShell receipt and eventually ends once after expiry",{skip,timeout:30000},async()=>{
  const h=await setup();
  const first=fold("poll",{...h.common,invitation:h.invitation,call:h.call(),intentSequence:1,pollSequence:1,pollStarted:h.wall(1),now:h.wall(9999),voicePending:false});
  assert.equal(first.sendEnd,true);
  const end1=h.end(2);
  const inFlight=fold("attempt",{invitation:first.invitation,request:end1});
  const duplicate=fold("poll",{...h.common,invitation:inFlight,call:h.call(),intentSequence:2,pollSequence:2,pollStarted:h.wall(2),now:h.wall(9999),voicePending:false});
  assert.equal(duplicate.sendEnd,false);
  h.clock(9999);
  const premature=await h.manager.control(end1);
  assert.equal(premature.state,"already-on");assert.equal(premature.invitationDeadlinePending,true);assert.equal(h.ends(),0);
  const retained=fold("receipt",{...h.common,invitation:inFlight,request:end1,response:{ok:true,result:premature},intentSequence:2,now:h.wall(9999)});
  assert.equal(new Date(retained.finished).getTime(),h.finishedAt);
  assert.equal(retained.inFlightRequestId,null);
  const stale=fold("poll",{...h.common,invitation:retained,call:h.call(),intentSequence:2,pollSequence:2,pollStarted:h.wall(9998),now:h.wall(10001),voicePending:false});
  assert.equal(stale.sendEnd,false);
  const next=fold("poll",{...h.common,invitation:retained,call:h.call(),intentSequence:2,pollSequence:2,pollStarted:h.wall(10001),now:h.wall(10002),voicePending:false});
  assert.equal(next.sendEnd,true);
  const end2=h.end(3);
  const retrying=fold("attempt",{invitation:next.invitation,request:end2});
  h.clock(10002);
  const ended=await h.manager.control(end2);
  assert.equal(ended.state,"ended");assert.equal(h.ends(),1);assert.equal(h.call().mediaRelease,"confirmed");
  const done=fold("receipt",{...h.common,invitation:retrying,request:end2,response:{ok:true,result:ended},intentSequence:3,now:h.wall(10003)});
  assert.equal(done,null);
});

test("actual Main speech refusal is not mistaken for a pending deadline",{skip,timeout:15000},async()=>{
  const h=await setup();const request=h.end(2);
  const pending=fold("attempt",{invitation:h.invitation,request});
  h.call().userTurnCount=1;h.clock(9999);
  const result=await h.manager.control(request);
  assert.equal(result.state,"already-on");assert.equal(result.invitationDeadlinePending,undefined);
  const state=fold("receipt",{...h.common,invitation:pending,request,response:{ok:true,result},intentSequence:2,now:h.wall(9999)});
  assert.equal(state,null);assert.equal(h.ends(),0);
});

test("actual PowerShell listener state and dispatch regression suite",{skip,timeout:15000},()=>{
  const result=spawnSync(pwsh,["-NoProfile","-NonInteractive","-File",script],{encoding:"utf8",windowsHide:true,timeout:12000});
  assert.equal(result.status,0,result.stderr || result.error?.message);
  assert.equal(result.stdout.split(/\r?\n/).filter(line=>line.startsWith("PASS ")).length,7);
});
