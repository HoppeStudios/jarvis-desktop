import assert from "node:assert/strict";
import test from "node:test";
import {randomUUID} from "node:crypto";
import {register} from "node:module";
import {dirname,join} from "node:path";
import {fileURLToPath,pathToFileURL} from "node:url";
register(pathToFileURL(join(dirname(fileURLToPath(import.meta.url)),"helpers/ts-import-hooks.mjs")));
const {JarvisInboxProducer,finalReplyExcerpt}=await import("../electron/main/jarvis/inbox-producer.ts");
const {createJarvisInboxProducer}=await import("../electron/main/jarvis/inbox-producer-port.ts");
const {deliverCapturedEvent}=await import("../electron/main/runtime/captured-event-delivery.ts");
const sessionId=randomUUID(),turnId=randomUUID();
const event=(body,extra={})=>({sessionId,turnId,ts:Date.now(),event:body,...extra});
const ask=()=>({sessionId,requestId:randomUUID(),toolCallId:randomUUID(),questions:[{question:"Choose a route",options:["A",{label:"B",description:"details"}]},{question:"Continue?",options:[]}]});
function harness(extra={}) {
 const calls=[],failures=[],items=new Map();
 const producer=new JarvisInboxProducer({enabled:async()=>true,call:async(tool,args)=>{
  calls.push({tool,args});
  if(tool==="queue_question") {
   const item={id:randomUUID(),revision:1,state:"pending",origin:args.origin,sourceRequestId:args.callId,questions:args.questions.map(q=>({...q,answered:false}))};items.set(args.callId,item);return{id:item.id};
  }
  if(tool==="queue_update")return{id:randomUUID()};
  if(tool==="find_source_item")return{item:items.get(args.callId)??null};
  if(tool==="record_answer") {
   const item=[...items.values()].find(i=>i.id===args.id);assert.equal(item.revision,args.expectedRevision);
   item.revision++;for(const q of item.questions)if(args.questionIds.includes(q.id))q.answered=true;
   return item;
  }
  throw Error("Unexpected tool");
 },failure:metadata=>failures.push(metadata),...extra});
 return{producer,calls,failures,items};
}

test("native question is authoritative first; its card follows durable capture, even when capture fails",async()=>{
 const sequence=[];let release;const waiting=new Promise(r=>release=r);
 const e=event({type:"asktool_request",request:ask()});
 const pending=deliverCapturedEvent(e,{ingest:()=>sequence.push("pending-input"),capture:()=>{sequence.push("capture");return waiting;},deliver:()=>sequence.push("card")});
 assert.deepEqual(sequence,["pending-input","capture"]);release();await pending;assert.equal(sequence.at(-1),"card");
 let delivered=0;await deliverCapturedEvent(e,{ingest:()=>{},capture:async()=>{throw Error("refused");},deliver:()=>delivered++});assert.equal(delivered,1);
 const stream=deliverCapturedEvent(event({type:"turn_start"}),{ingest:()=>{},capture:()=>new Promise(()=>{}),deliver:()=>delivered++});assert.equal(stream,undefined);assert.equal(delivered,2);
});

test("capture uses exact managed origin/request and actual ordered questions",async()=>{
 const h=harness(),request=ask();await h.producer.observe(event({type:"asktool_request",request}));
 assert.deepEqual(h.calls[0].args,{origin:{kind:"pi-desktop",sessionId},callId:request.requestId,questions:[{id:"0",question:"Choose a route",options:["A","B"]},{id:"1",question:"Continue?",options:[]}]});
 assert.equal(h.failures.length,0);
 await h.producer.observe(event({type:"asktool_request",request:{...request,sessionId:randomUUID()}}));assert.equal(h.calls.length,1);
});

test("only completed root reply becomes a source-turn report; no history, permissions, children or reasoning",async()=>{
 const h=harness();await h.producer.observe(event({type:"agent_end",messageIds:[]}));assert.equal(h.calls.length,0);
 h.producer.observe(event({type:"agent_start"}));
 h.producer.observe(event({type:"message_end",message:{id:"child",role:"assistant",content:"Child reply",status:"complete"}},{parentToolCallId:"delegate"}));
 h.producer.observe(event({type:"tool_permission_request",request:{secret:"never retain"}}));
 h.producer.observe(event({type:"message_end",message:{id:"stream",role:"assistant",content:"Partial",status:"streaming"}}));
 h.producer.observe(event({type:"message_end",message:{id:"final",role:"assistant",content:"Implemented the change. Build still blocked.",thinking:"private reasoning",status:"complete"}}));
 await h.producer.observe(event({type:"agent_end",messageIds:["final"]}));
 assert.equal(h.calls.length,1);assert.equal(h.calls[0].args.sourceKey,"turn:"+turnId);assert.equal(h.calls[0].args.text,"Implemented the change. Build still blocked.");
 await h.producer.observe(event({type:"agent_end",messageIds:["final"]}));assert.equal(h.calls.length,1);
});

test("real answer waits for capture and records only nonempty answered questions; null is not completion",async()=>{
 const h=harness(),request=ask();const capture=h.producer.captureQuestion(request);
 const answer=h.producer.recordNativeAnswer(request,{sessionId,requestId:request.requestId,answers:[["B"],null]});
 await Promise.all([capture,answer]);
 assert.deepEqual(h.calls.map(c=>c.tool),["queue_question","find_source_item","record_answer"]);
 const item=h.items.get(request.requestId);assert.equal(item.questions[0].answered,true);assert.equal(item.questions[1].answered,false);
 assert.equal(h.calls.at(-1).args.receipt,"pi-desktop:ask:"+request.requestId);
 const before=h.calls.length;await h.producer.recordNativeAnswer(request,{sessionId,requestId:request.requestId,answers:[null,null]});assert.equal(h.calls.length,before+1);
});

test("concurrent wording edits and mismatched answers remain pending",async()=>{
 const h=harness(),request=ask();await h.producer.captureQuestion(request);
 h.items.get(request.requestId).questions[0].question="User edited this question";
 await h.producer.recordNativeAnswer(request,{sessionId,requestId:request.requestId,answers:[["A"],["yes"]]});
 assert.equal(h.calls.filter(c=>c.tool==="record_answer").length,0);assert.equal(h.failures.length,1);
 await h.producer.recordNativeAnswer(request,{sessionId:randomUUID(),requestId:request.requestId,answers:[["A"],["yes"]]});assert.equal(h.failures.length,2);
});

test("bounded excerpts retain both outcome and limitations; provider diagnostics are excluded",async()=>{
 const text="Outcome verified. "+"x".repeat(4000)+" Final limitation: not deployed.";
 const clipped=finalReplyExcerpt(text);assert(clipped.length<=2500);assert(clipped.includes("Outcome verified"));assert(clipped.endsWith("not deployed."));
 const h=harness();h.producer.observe(event({type:"agent_start"}));await h.producer.observe(event({type:"error",error:{code:"AUTH_FAILED",message:"sensitive diagnostic",details:{token:"secret"}}}));
 assert(!JSON.stringify(h.calls).includes("secret"));assert(!JSON.stringify(h.calls).includes("sensitive diagnostic"));assert(h.calls[0].args.text.includes("AUTH_FAILED"));
});

test("disabled capture does not write or mark work complete",async()=>{
 const h=harness({enabled:async()=>false});await h.producer.captureQuestion(ask());assert.equal(h.calls.length,0);
});

test("port uses the registered global Inbox and never retries a refusal",async()=>{
 let calls=0;const lookups=[];const project=new Map([[sessionId,"/work/task"]]);
 const producer=createJarvisInboxProducer({dataDir:"/profile",sessionProjects:project,settings:async()=>({jarvisEnabled:true,jarvisQueueEnabled:true}),refreshUserMcp:async p=>lookups.push(p),
  userMcp:{toolsForProject:async(p,id)=>{assert.equal(p,null);assert.equal(id,"Jarvis-Inbox");return[{serverId:id,toolName:"queue_question",fullName:"registered-inbox"}];},callTool:async(name,args,p)=>{calls++;assert.equal(name,"registered-inbox");assert.equal(p,null);return{isError:true,content:[{type:"text",text:"refused"}]};},cancelSessionCalls:()=>{}},failure:()=>{}});
 await producer.captureQuestion(ask());assert.equal(calls,1);assert.equal(producer.status().failures,1);assert.deepEqual(lookups,[null]);
 project.set(sessionId,join("/profile","jarvis","workspace"));await producer.captureQuestion(ask());assert.equal(calls,1);
});

test("expired startup lookup cannot dispatch a late mutation",async()=>{
 let release,calls=0,cancelled=0;const blocked=new Promise(r=>release=r);
 const producer=createJarvisInboxProducer({dataDir:"/profile",sessionProjects:new Map([[sessionId,null]]),settings:async()=>({jarvisEnabled:true,jarvisQueueEnabled:true}),refreshUserMcp:async()=>blocked,timeoutMs:10,
  userMcp:{toolsForProject:async()=>[],callTool:async()=>{calls++;},cancelSessionCalls:()=>cancelled++},failure:()=>{}});
 await producer.captureQuestion(ask());release();await new Promise(r=>setTimeout(r,5));assert.equal(calls,0);assert.equal(cancelled,1);
});
