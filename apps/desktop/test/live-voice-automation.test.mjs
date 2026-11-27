import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { register } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
register(pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), "helpers/ts-import-hooks.mjs")));
const {LiveVoiceAutomation,parseAutomationControl}=await import("../electron/main/live-voice/automation.ts");
const {LiveAutomationReceiver}=await import("../src/features/voice/live/live-automation-receiver.ts");
const owner={webContentsId:1,frameProcessId:2,frameRoutingId:3,url:"file:///app/index.html"};
const connected=()=>({callId:randomUUID(),phase:"connected",muted:true,mediaRelease:"pending"});
function harness(extra={}){
 const state={enabled:true,owner,call:null,sent:[],ended:[]};
 const manager=new LiveVoiceAutomation({enabled:async()=>state.enabled,status:async()=>({enabled:true,settingsRevision:1,bindings:[],call:state.call}),owner:()=>state.owner,
  send:(identity,request)=>state.sent.push({identity,request}),end:async(identity,request)=>{state.ended.push({identity,request});if(state.call)state.call={...state.call,phase:"ended",mediaRelease:"confirmed"};},...extra});
 return {state,manager};
}
async function waitFor(predicate){for(let i=0;i<100&&!predicate();i++)await new Promise(r=>setTimeout(r,1));assert.ok(predicate());}

const greetingEvidence = { providerReady:true, requestSent:true, transcriptReceived:true, transcriptMatches:true,
 measuredAudio:true, playbackActive:false, turnComplete:true, contextState:"running" };
async function invitation(extra = {}, requestExtra = {}, elapsed = 10001) {
 let cleanups = 0, observed = 0, now = 0;
 const h = harness({now:()=>now,createCoordinator:async()=>"coordinator", observeCoordinator:async()=>{observed++;},
  cleanupCoordinator:async(owner,id,verify)=>{assert.equal(id,"coordinator");assert.equal(await verify(),true);cleanups++;return "deleted";}, ...extra});
 const request = {requestId:randomUUID(),action:"wake",freshCoordinator:true,presenceGreeting:true,...requestExtra};
 const started = h.manager.control(request);
 await waitFor(()=>h.state.sent.length===1);
 h.state.call={...connected(), userSpeaking:false, userTurnCount:0, workBinding:{workSessionId:"coordinator"}};
 await h.manager.complete(owner,{requestId:request.requestId,callId:h.state.call.callId,
  greetingPlayed:true,greetingFinishedAt:Date.now(),greetingEvidence});
 await started;
 now = elapsed;
 return {...h, cleanups:()=>cleanups,observed:()=>observed};
}

test("verified automatic timeout ends its exact call then deletes only its owned coordinator",async()=>{
 const h=await invitation();
 const result=await h.manager.control({requestId:randomUUID(),action:"end",expectedCallId:h.state.call.callId,cleanupUnanswered:true});
 assert.equal(result.coordinatorCleanup,"deleted");assert.equal(h.observed(),1);assert.equal(h.cleanups(),1);
 assert.equal(h.state.call.mediaRelease,"confirmed");
});

test("Main refuses premature automatic timeout without ending the call",async()=>{
 const h=await invitation({}, {}, 9999);
 const result=await h.manager.control({requestId:randomUUID(),action:"end",expectedCallId:h.state.call.callId,cleanupUnanswered:true});
 assert.equal(result.state,"already-on");assert.equal(result.coordinatorCleanup,"deferred");
 assert.equal(result.invitationDeadlinePending,true);
 assert.equal(h.state.ended.length,0);assert.equal(h.cleanups(),0);
});

test("deadline refusal and pending receipt use one monotonic clock sample",async()=>{
 let advance=false,reads=0;
 const h=await invitation({now:()=>advance ? (reads++===0 ? 9999 : 10001) : 0});
 advance=true;
 const result=await h.manager.control({requestId:randomUUID(),action:"end",expectedCallId:h.state.call.callId,cleanupUnanswered:true});
 assert.equal(result.invitationDeadlinePending,true);assert.equal(h.state.ended.length,0);
});

test("manual wakes and manual end never gain cleanup authority",async()=>{
 for(const start of [{presenceGreeting:false},{freshCoordinator:false}]){
  const h=await invitation({},start);
  const result=await h.manager.control({requestId:randomUUID(),action:"end",expectedCallId:h.state.call.callId,cleanupUnanswered:true});
  assert.equal(result.coordinatorCleanup,"deferred");assert.equal(h.cleanups(),0);
 }
 const h=await invitation();
 await h.manager.control({requestId:randomUUID(),action:"end",expectedCallId:h.state.call.callId});
 assert.equal(h.cleanups(),0);
});

test("actual turns, sticky speech, missing presence state and delegated work preserve coordinator",async()=>{
 for(const change of [{userTurnCount:1},{lastUserSpeechAt:1},{lastUserTurnAt:1},{userSpeaking:true},
  {userTurnCount:undefined},{workOperations:[{operationId:"work"}]},{workBinding:{workSessionId:"different"}}]){
  const h=await invitation();Object.assign(h.state.call,change);
  const result=await h.manager.control({requestId:randomUUID(),action:"end",expectedCallId:h.state.call.callId,cleanupUnanswered:true});
  assert.equal(result.coordinatorCleanup,"deferred",JSON.stringify(change));assert.equal(h.cleanups(),0);
 }
});

test("an already ended or closing call is not adopted as a timeout-owned end",async()=>{
 for(const phase of ["ended","closing"]){
  const h=await invitation();h.state.call.phase=phase;h.state.call.mediaRelease="confirmed";
  const result=await h.manager.control({requestId:randomUUID(),action:"end",expectedCallId:h.state.call.callId,cleanupUnanswered:true});
  assert.equal(result.coordinatorCleanup,"deferred");assert.equal(h.cleanups(),0);
 }
});

test("a greeting receipt without complete measured evidence cannot authorize cleanup",async()=>{
 for(const patch of [{measuredAudio:false},{transcriptMatches:false},{turnComplete:false},{contextState:"suspended"},{playbackActive:true}]) {
  let cleaned=false;
  const h=harness({now:()=>20000,createCoordinator:async()=>"coordinator",cleanupCoordinator:async()=>{cleaned=true;return "deleted";}});
  const requestId=randomUUID();const started=h.manager.control({requestId,action:"wake",freshCoordinator:true,presenceGreeting:true});
  await waitFor(()=>h.state.sent.length===1);
  h.state.call={...connected(),userSpeaking:false,userTurnCount:0,workBinding:{workSessionId:"coordinator"}};
  await h.manager.complete(owner,{requestId,callId:h.state.call.callId,greetingPlayed:true,greetingFinishedAt:Date.now(),greetingEvidence:{...greetingEvidence,...patch}});
  await started;
  const result=await h.manager.control({requestId:randomUUID(),action:"end",expectedCallId:h.state.call.callId,cleanupUnanswered:true});
  assert.equal(result.coordinatorCleanup,"deferred");assert.equal(cleaned,false);
 }
});

test("unconfirmed release and a missing call never prove no user input",async()=>{
 for(const replacement of [null,{...connected(),phase:"ended",mediaRelease:"unconfirmed"}]){
  const h=await invitation();const callId=h.state.call.callId;
  h.state.call=replacement && {...replacement,callId};
  if(replacement) await assert.rejects(h.manager.control({requestId:randomUUID(),action:"end",expectedCallId:callId,cleanupUnanswered:true}),{errorCode:"LIVE_MEDIA_RELEASE_UNCONFIRMED"});
  else await assert.rejects(h.manager.control({requestId:randomUUID(),action:"end",expectedCallId:callId,cleanupUnanswered:true}),{errorCode:"LIVE_STALE_CALL"});
  assert.equal(h.cleanups(),0);
 }
});

test("voice controls reject arbitrary context, invalid IDs and unknown actions",()=>{
 for(const value of [{requestId:"no",action:"start"},{requestId:randomUUID(),action:"execute"},{requestId:randomUUID(),action:"start",instructions:"run arbitrary text"}])assert.throws(()=>parseAutomationControl(value));
});

test("a retried start is dispatched once and only Main-verified connection is reported",async()=>{
 const {state,manager}=harness();const input={requestId:randomUUID(),action:"start",workSessionId:"work",initialMuted:false};
 const start=manager.control(input);const repeated=manager.control(input);await waitFor(()=>state.sent.length===1);
 state.call={...connected(),muted:false};await manager.complete(owner,{requestId:input.requestId,callId:state.call.callId});
 assert.equal((await start).state,"connected");assert.deepEqual(await repeated,await start);assert.equal(state.sent.length,1);
 await assert.rejects(manager.control({...input,action:"end"}),{errorCode:"LIVE_REQUEST_CONFLICT"});
});

test("two rapid distinct wake toggles cancel startup without waiting for the provider",async()=>{
 const {state,manager}=harness();const first=manager.control({requestId:randomUUID(),action:"toggle"});
 const second=manager.control({requestId:randomUUID(),action:"toggle"});
 assert.equal((await second).state,"ended");assert.equal((await first).state,"cancelled");
 assert.deepEqual(state.sent.map(e=>e.request.action),["start","cancel"]);assert.ok(state.ended[0].request.requestId);
});

test("late completion after cancellation cannot revive or stop a newer call",async()=>{
 const {state,manager}=harness();const id=randomUUID();const first=manager.control({requestId:id,action:"start"});await waitFor(()=>state.sent.length);
 await manager.control({requestId:randomUUID(),action:"end"});await first;
 state.call=connected();const count=state.ended.length;
 assert.equal((await manager.complete(owner,{requestId:id,callId:state.call.callId})).accepted,false);assert.equal(state.ended.length,count);
});

test("expected call identity protects another call and disabled control still permits ending",async()=>{
 const {state,manager}=harness();state.enabled=false;state.call=connected();
 await assert.rejects(manager.control({requestId:randomUUID(),action:"end",expectedCallId:randomUUID()}),{errorCode:"LIVE_STALE_CALL"});
 assert.equal(state.ended.length,0);assert.equal((await manager.control({requestId:randomUUID(),action:"end",expectedCallId:state.call.callId})).state,"ended");
 await assert.rejects(manager.control({requestId:randomUUID(),action:"start"}),{errorCode:"LIVE_AUTOMATION_DISABLED"});
});

test("renderer identity mismatch is refused and startup timeout cancels the exact request",async()=>{
 const {state,manager}=harness({timeoutMs:30});const id=randomUUID();const started=manager.control({requestId:id,action:"start"});const rejection=assert.rejects(started,{errorCode:"LIVE_TIMEOUT"});
 await waitFor(()=>state.sent.length);await assert.rejects(manager.complete({...owner,frameRoutingId:99},{requestId:id}),{errorCode:"LIVE_INVALID_OWNER"});
 await rejection;assert.equal(state.ended[0].request.requestId,id);
});

test("lost renderer is pruned with a cancellation tombstone, even if sending fails",async()=>{
 const {state,manager}=harness();const id=randomUUID();const start=manager.control({requestId:id,action:"start"});const rejected=assert.rejects(start,{errorCode:"LIVE_INVALID_OWNER"});
 await waitFor(()=>state.sent.length);state.owner=null;await manager.status();await rejected;assert.equal(state.ended[0].request.requestId,id);
});

test("renderer cancellation before status resolves never requests microphone/media",async()=>{
 let release,starts=0;const responses=[];
 const receiver=new LiveAutomationReceiver({refreshStatus:()=>new Promise(r=>{release=r;}),getSnapshot:()=>({starting:false,stopping:false,call:null}),start:async()=>{starts++;},toggleMute:async()=>{}},async r=>responses.push(r));
 const id=randomUUID();const start=receiver.receive({requestId:id,action:"start"});await receiver.receive({requestId:id,action:"cancel"});release();await start;
 assert.equal(starts,0);assert.equal(responses[0].cancelled,true);
});

test("renderer uses the requested work target, starts muted and unmutes only on explicit wake input",async()=>{
 let call=null,options,mutes=0;const responses=[];
 const receiver=new LiveAutomationReceiver({refreshStatus:async()=>{},getSnapshot:()=>({starting:false,stopping:false,call}),start:async v=>{options=v;call=connected();},toggleMute:async()=>{mutes++;call.muted=false;}},async r=>responses.push(r));
 const id=randomUUID();await receiver.receive({requestId:id,action:"start",workSessionId:"work",initialMuted:false});
 assert.equal(options.requestId,id);assert.equal(options.workTarget.workSessionId,"work");assert.equal(mutes,1);assert.equal(responses[0].callId,call.callId);
});

test("renderer refuses an already active user call rather than adopting or unmuting it",async()=>{
 let starts=0,mutes=0;const responses=[];
 const receiver=new LiveAutomationReceiver({refreshStatus:async()=>{},getSnapshot:()=>({starting:false,stopping:false,call:connected()}),start:async()=>{starts++;},toggleMute:async()=>{mutes++;}},async r=>responses.push(r));
 await receiver.receive({requestId:randomUUID(),action:"start",initialMuted:false});assert.equal(starts,0);assert.equal(mutes,0);assert.equal(responses[0].errorCode,"LIVE_ALREADY_ACTIVE");
});

test("fresh coordinator creates once on activation and never on retry or toggle off",async()=>{
 let created=0;const {state,manager}=harness({createCoordinator:async()=>{created++;return "new-coordinator";}});
 const input={requestId:randomUUID(),action:"toggle",freshCoordinator:true};
 const first=manager.control(input),retry=manager.control(input);
 await waitFor(()=>state.sent.length===1);
 assert.equal(state.sent[0].request.workSessionId,"new-coordinator");
 state.call=connected();await manager.complete(owner,{requestId:input.requestId,callId:state.call.callId});
 assert.equal((await first).coordinatorSessionId,"new-coordinator");assert.deepEqual(await retry,await first);
 await manager.control({requestId:randomUUID(),action:"toggle",freshCoordinator:true});
 assert.equal(created,1);
 assert.throws(()=>parseAutomationControl({...input,workSessionId:"other"}));
});

test("presence greeting runs only after real connection and reports verified playback separately",async()=>{
 let call=null;const order=[],responses=[];
 const receiver=new LiveAutomationReceiver({refreshStatus:async()=>{},getSnapshot:()=>({starting:false,stopping:false,call}),
  start:async()=>{order.push("connect");call=connected();},toggleMute:async()=>{},
  presenceGreeting:async()=>{assert.equal(call.phase,"connected");order.push("greet");return{greetingPlayed:true,greetingFinishedAt:12345};}},async r=>responses.push(r));
 await receiver.receive({requestId:randomUUID(),action:"start",presenceGreeting:true});
 assert.deepEqual(order,["connect","greet"]);assert.equal(responses[0].greetingPlayed,true);assert.equal(responses[0].greetingFinishedAt,12345);
});

test("cancelled fresh startup retains only its actual coordinator identity for guarded cleanup",async()=>{
 const {state,manager}=harness({createCoordinator:async()=>"owned-empty-coordinator"});
 const first=manager.control({requestId:randomUUID(),action:"wake",freshCoordinator:true});
 await waitFor(()=>state.sent.length===1);
 await manager.control({requestId:randomUUID(),action:"end"});
 assert.equal((await first).state,"cancelled");
 assert.equal((await first).coordinatorSessionId,"owned-empty-coordinator");
});

test("a greeting protocol failure preserves the actual renderer error rather than reporting a stale call",async()=>{
 let call=null,code;const responses=[];
 const receiver=new LiveAutomationReceiver({refreshStatus:async()=>{},getSnapshot:()=>({starting:false,stopping:false,call,errorCode:code}),
  start:async()=>{call=connected();},toggleMute:async()=>{},presenceGreeting:async()=>{code="LIVE_PROTOCOL_ERROR";call.phase="ended";return{greetingPlayed:false};}},async r=>responses.push(r));
 await receiver.receive({requestId:randomUUID(),action:"start",presenceGreeting:true});
 assert.equal(responses[0].errorCode,"LIVE_PROTOCOL_ERROR");
});

test("out-of-order desired-state workers cannot turn voice back on after a newer end",async()=>{
 const {state,manager}=harness();const intentId=randomUUID();
 assert.equal((await manager.control({requestId:randomUUID(),action:"end",intentId,intentSequence:2})).state,"already-ended");
 assert.equal((await manager.control({requestId:randomUUID(),action:"wake",intentId,intentSequence:1})).state,"superseded");
 assert.equal((await manager.control({requestId:randomUUID(),action:"wake",intentId,intentSequence:2})).state,"superseded");
 assert.equal(state.sent.length,0);
});
test("ordered end cancels an admitted wake while its provider startup is still pending",async()=>{
 const {state,manager}=harness();const intentId=randomUUID();
 const on=manager.control({requestId:randomUUID(),action:"wake",intentId,intentSequence:1});await waitFor(()=>state.sent.length===1);
 assert.equal((await manager.control({requestId:randomUUID(),action:"end",intentId,intentSequence:2})).state,"ended");
 assert.equal((await on).state,"cancelled");assert.deepEqual(state.sent.map(x=>x.request.action),["start","cancel"]);
});
test("ensure-on preserves an existing manual call and explicit new-chat waits for its release",async()=>{
 const {state,manager}=harness();state.call=connected();const old=state.call.callId;
 const ensured=await manager.control({requestId:randomUUID(),action:"wake"});assert.equal(ensured.state,"already-on");assert.equal(ensured.callId,old);
 assert.equal(state.sent.length,0);assert.equal(state.ended.length,0);
 const requestId=randomUUID();const started=manager.control({requestId,action:"new-chat"});await waitFor(()=>state.sent.length===1);
 assert.equal(state.ended[0].request.callId,old);state.call=connected();await manager.complete(owner,{requestId,callId:state.call.callId});
 assert.equal((await started).state,"connected");
});


test("phone start forwards call-local input and rejects malformed selectors",async()=>{
 const {state,manager}=harness();const requestId=randomUUID(), intentId=randomUUID();
 const input={kind:"virtual-cable",label:"CABLE Output (VB-Audio Virtual Cable)"};
 const promise=manager.control({requestId,action:"start",intentId,intentSequence:1,input});
 await waitFor(()=>state.sent.length===1);assert.deepEqual(state.sent[0].request.input,input);
 state.call=connected();await manager.complete(owner,{requestId,callId:state.call.callId});await promise;
 for(const patch of [{input:{...input,label:""}},{input:{...input,extra:true}},{action:"end",input}])
  assert.throws(()=>parseAutomationControl({requestId:randomUUID(),action:"start",...patch}));
});

test("request-scoped phone cancel cannot end another caller or newer call",async()=>{
 const h=harness();const requestId=randomUUID(),intentId=randomUUID();
 const started=h.manager.control({requestId,action:"start",intentId,intentSequence:1});
 await waitFor(()=>h.state.sent.length===1);
 await assert.rejects(h.manager.control({requestId:randomUUID(),action:"end",intentId:randomUUID(),intentSequence:1,expectedRequestId:requestId}),{errorCode:"LIVE_STALE_CALL"});
 assert.equal(h.state.ended.length,0);
 h.state.call=connected();const callId=h.state.call.callId;
 await h.manager.complete(owner,{requestId,callId});await started;
 h.state.call=connected();
 await assert.rejects(h.manager.control({requestId:randomUUID(),action:"end",intentId,intentSequence:2,expectedRequestId:requestId}),{errorCode:"LIVE_STALE_CALL"});
 assert.equal(h.state.ended.length,0);
 h.state.call={...connected(),callId};
 assert.equal((await h.manager.control({requestId:randomUUID(),action:"end",intentId,intentSequence:3,expectedRequestId:requestId})).state,"ended");
 assert.equal(h.state.ended[0].request.callId,callId);
});

test("phone cancels only its own pending start and rejects late completion",async()=>{
 const h=harness();const requestId=randomUUID(),intentId=randomUUID();
 const started=h.manager.control({requestId,action:"start",intentId,intentSequence:1});await waitFor(()=>h.state.sent.length===1);
 const result=await h.manager.control({requestId:randomUUID(),action:"end",intentId,intentSequence:2,expectedRequestId:requestId});
 assert.equal(result.state,"cancelled");assert.equal((await started).state,"cancelled");
 assert.equal(h.state.ended[0].request.requestId,requestId);
 assert.equal((await h.manager.complete(owner,{requestId,callId:randomUUID()})).accepted,false);
});

test("phone input resolves one exact capture device without touching default microphone",async()=>{
 const {requestCallMicrophone}=await import("../src/features/voice/live/call-input.ts");
 const label="CABLE Output (VB-Audio Virtual Cable)",input={kind:"virtual-cable",label};let captures=0;
 const device={kind:"audioinput",label,deviceId:"cable-1"};
 for(const [devices,code] of [[[],"A0_L0_C0"],[[{...device,label:""}],"A1_L0_C0"],[[{...device,label:"Physical mic"}],"A1_L1_C0"],[[device,{...device,deviceId:"cable-2"}],"A2_L2_C2"],[[{...device,deviceId:"default"}],"A1_L1_C0"]]){
  await assert.rejects(requestCallMicrophone({enumerateDevices:async()=>devices,getUserMedia:async()=>{captures++;}},input),{errorCode:`LIVE_INPUT_ENUM_${code}`});
 }
 const stream={};assert.equal(await requestCallMicrophone({enumerateDevices:async()=>[device],getUserMedia:async constraints=>{captures++;assert.equal(constraints.audio.deviceId.exact,"cable-1");return stream;}},input),stream);
 assert.equal(captures,1);
});

test("phone device discovery waits for Main reservation and never captures after rejected prepare",async()=>{
 const {requestCallMicrophone}=await import("../src/features/voice/live/call-input.ts");
 const input={kind:"virtual-cable",label:"CABLE Output (VB-Audio Virtual Cable)"};
 let grant;const reserved=new Promise(resolve=>{grant=resolve;});let enumerations=0,captures=0;
 const stream={};const media={enumerateDevices:async()=>{enumerations++;return[{kind:"audioinput",label:input.label,deviceId:"owned-cable"}];},getUserMedia:async constraints=>{captures++;assert.equal(constraints.audio.deviceId.exact,"owned-cable");return stream;}};
 const pending=requestCallMicrophone(media,input,reserved);await Promise.resolve();assert.equal(enumerations,0);assert.equal(captures,0);
 grant();assert.equal(await pending,stream);assert.equal(enumerations,1);assert.equal(captures,1);
 const refused=Object.assign(new Error("prepare refused"),{code:"LIVE_STALE_CALL"});
 await assert.rejects(requestCallMicrophone(media,input,Promise.reject(refused)),error=>error===refused);
 assert.equal(enumerations,1);assert.equal(captures,1);
});
