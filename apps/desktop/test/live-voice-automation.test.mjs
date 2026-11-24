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
