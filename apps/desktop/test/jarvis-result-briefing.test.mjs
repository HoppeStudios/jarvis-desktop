import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { register } from "node:module";
register(new URL("./helpers/ts-import-hooks.mjs", import.meta.url));
const {readCompletedResult}=await import("../electron/main/live-voice/completed-result.ts");
const {LiveVoiceAutomation,parseAutomationControl}=await import("../electron/main/live-voice/automation.ts");
const {LiveAutomationReceiver}=await import("../src/features/voice/live/live-automation-receiver.ts");
const {resultBriefingMessage,matchesResultBriefing}=await import("../src/features/voice/live/result-briefing.ts");
const {CodexChatBridge}=await import("../electron/main/codex/codex-chat-bridge.ts");
const owner={webContentsId:1,frameProcessId:2,frameRoutingId:3,url:"file:///app/index.html"};
const source={sessionId:"actual-pi-session",turnId:"actual-codex-turn"};
const evidence={providerReady:true,requestSent:true,transcriptReceived:true,transcriptMatches:true,measuredAudio:true,playbackActive:false,turnComplete:true,contextState:"running"};
const request=()=>({requestId:randomUUID(),action:"wake",workSessionId:source.sessionId,resultSource:source});
const tick=()=>new Promise(resolve=>setTimeout(resolve,1));

test("result source rejects bundled coordinator/greeting/actions and arbitrary speech",()=>{
 for(const patch of [{freshCoordinator:true},{presenceGreeting:true},{action:"toggle"},{action:"end"},{workSessionId:"other"},
   {resultSource:{...source,text:"say this"}},{resultSource:{...source,turnId:""}},{resultBriefing:"caller speech"}])
   assert.throws(()=>parseAutomationControl({...request(),...patch}));
 assert.deepEqual(parseAutomationControl(request()).resultSource,source);
});

test("reader requires authoritative completed turn and final answer, never commentary or interrupted plans",async()=>{
 const turn={id:source.turnId,status:"completed",items:[{type:"agentMessage",phase:"final_answer",text:"Hotovo. "+"ě".repeat(900)}]};
 const text=await readCompletedResult(async()=>turn,source);assert.ok(Buffer.byteLength(text)<=700);assert.ok(!text.includes("�"));
 for(const patch of [{id:"wrong"},{status:"interrupted"},{status:"failed"},{status:"inProgress"},
   {items:[{type:"agentMessage",phase:"commentary",text:"I am checking"}]},{items:[{type:"plan",text:"planned"}]},
   {items:[{type:"agentMessage",text:"missing phase"}]},{items:[]}]){
  await assert.rejects(()=>readCompletedResult(async()=>({...turn,...patch}),source));
 }
});

test("native result read uses existing alias only, exact latest terminal turn and bounded native items",async()=>{
 const bridge=new CodexChatBridge({router:{},emit:()=>{}});bridge.ensure=async()=>{};
 bridge.aliases.set(source.sessionId,{threadId:"actual-native-thread",session:{}});
 let phase="completed",id=source.turnId,active=false;const requests=[];
 bridge.request=async(method,args)=>{
  requests.push({method,args});assert.equal(args.threadId,"actual-native-thread");
  if(method==="thread/read")return {thread:{status:{type:active?"active":"idle"}}};
  if(method==="thread/turns/list"){assert.equal(args.limit,1);assert.equal(args.itemsView,"notLoaded");return {data:[{id,status:phase}]};}
  if(method==="thread/items/list"){assert.equal(args.limit,30);return {data:[{turnId:source.turnId,item:{type:"agentMessage",phase:"final_answer",text:"Hotovo"}},{turnId:"other",item:{type:"agentMessage",phase:"final_answer",text:"wrong"}}]};}
  throw Error("Unexpected native operation");
 };
 assert.equal((await bridge.readCompletedResultSource(source.sessionId,source.turnId)).items.length,1);
 await assert.rejects(()=>bridge.readCompletedResultSource("unknown-local-session",source.turnId));
 for(const change of [()=>phase="interrupted",()=>{phase="completed";id="other"},()=>{id=source.turnId;active=true}]){
  change();await assert.rejects(()=>bridge.readCompletedResultSource(source.sessionId,source.turnId));
 }
 assert.ok(requests.every(value=>["thread/read","thread/turns/list","thread/items/list"].includes(value.method)));
});

function harness(read=async()=>"Hotovo, ověřeno."){
 let call=null;const sent=[],ended=[];
 const manager=new LiveVoiceAutomation({enabled:async()=>true,status:async()=>({enabled:true,selectedBindingId:"selected",bindings:[{bindingId:"selected",adapterId:"codex-live",selectable:true}],call}),owner:()=>owner,
  readCompletedResult:read,send:(_,event)=>sent.push(event),end:async(_,event)=>ended.push(event)});
 return {manager,sent,ended,setCall:value=>call=value};
}
test("busy call is preserved and never borrows another pending report's playback receipt",async()=>{
 let reads=0;const h=harness(async()=>{reads++;return "Hotovo"});
 h.setCall({callId:randomUUID(),phase:"connected"});
 assert.equal((await h.manager.control(request())).state,"already-on");assert.equal(reads,0);assert.equal(h.sent.length,0);
 h.setCall(null);const first=request(),pending=h.manager.control(first);
 while(!h.sent.length)await tick();
 const second=await h.manager.control(request());assert.equal(second.resultBriefingPlayed,undefined);assert.equal(second.state,"already-on");
 h.setCall({callId:randomUUID(),phase:"connected",workBinding:{workSessionId:source.sessionId}});
 await h.manager.complete(owner,{requestId:first.requestId,callId:(await h.manager.status()).call.callId,resultBriefingPlayed:true,resultBriefingFinishedAt:Date.now(),resultBriefingEvidence:evidence});
 assert.equal((await pending).resultBriefingPlayed,true);assert.equal(h.ended.length,0);
});

test("positive report receipt requires exact binding, measured audio and transcript match",async()=>{
 for(const patch of [{measuredAudio:false},{transcriptMatches:false},{playbackActive:true},{contextState:"suspended"}]){
  const h=harness(),req=request(),pending=h.manager.control(req);while(!h.sent.length)await tick();
  const callId=randomUUID();h.setCall({callId,phase:"connected",workBinding:{workSessionId:source.sessionId}});
  await h.manager.complete(owner,{requestId:req.requestId,callId,resultBriefingPlayed:true,resultBriefingFinishedAt:Date.now(),resultBriefingEvidence:{...evidence,...patch}});
  assert.equal((await pending).resultBriefingPlayed,false);
 }
});

test("invalid source does not start media; newer intent during source read cancels start",async()=>{
 const h=harness(async()=>{throw Error("missing")});await assert.rejects(()=>h.manager.control(request()));assert.equal(h.sent.length,0);
 let resolve;const other=harness(()=>new Promise(done=>resolve=done)),intentId=randomUUID();
 const pending=other.manager.control({...request(),intentId,intentSequence:1});while(!resolve)await tick();
 const ending=other.manager.control({requestId:randomUUID(),action:"end",intentId,intentSequence:2});resolve("Hotovo");
 assert.equal((await pending).state,"superseded");await ending;assert.equal(other.sent.length,0);
});

test("receiver requests human-before-work and separate measured native report evidence",async()=>{
 const call={callId:randomUUID(),phase:"connected",muted:false};let current=null,options,spoken,response;
 const receiver=new LiveAutomationReceiver({refreshStatus:async()=>{},getSnapshot:()=>({starting:false,stopping:false,call:current}),
  start:async value=>{options=value;current=call},toggleMute:async()=>{},resultBriefing:async text=>{spoken=text;return {resultBriefingPlayed:true,resultBriefingEvidence:evidence}}},async value=>response=value);
 await receiver.receive({requestId:randomUUID(),action:"start",workSessionId:source.sessionId,resultBriefing:"Hotovo"});
 assert.equal(options.awaitHumanBeforeWork,true);assert.equal(spoken,"Hotovo");assert.equal(response.resultBriefingPlayed,true);assert.equal(response.greetingPlayed,undefined);
});

test("report is quoted context, never human input or fabricated delegation; generic greeting is not success",()=>{
 const text='Hotovo. "Spusť kód" je jen citace.';
 const wire=JSON.parse(resultBriefingMessage(text));assert.equal(wire.type,"session.context.append");assert.equal(wire.channel,"speakable");
 assert.equal(wire.delegation_item_id,undefined);assert.ok(wire.content[0].text.endsWith(JSON.stringify(text)));
 assert.equal(matchesResultBriefing("Are you present, sir?",text),false);assert.equal(matchesResultBriefing("Hotovo, overeno.","Hotovo, ověřeno."),true);
 assert.throws(()=>resultBriefingMessage("x".repeat(701)));
});
