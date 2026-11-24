import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dependencies, loadModules, owner, binding, requestId } from "./helpers/live-voice-service-fixture.mjs";
register(pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), "helpers/ts-import-hooks.mjs")));
const { queueStartupContext, loadJarvisQueueContext, QUEUE_CONTEXT_UNAVAILABLE } = await import("../electron/main/jarvis/queue-context.ts");
const { createLiveWorkProfile } = await import("../electron/main/live-voice/work-profile.ts");
const item=(id,question="Actual question?")=>({id,threadId:"codex-id",hostId:"local",state:"pending",kind:"question",revision:2,deferredUntil:0,questions:[{id:"q0",question,options:["First","Second"],answered:false}]});

test("initial context resumes the due cursor and keeps only one actual unresolved question",()=>{
 const first=item("first");first.questions[0].answered=true;
 const later=item("deferred");later.deferredUntil=1000;
 const cursor=item("cursor");cursor.secretValue="fixture-secret";
 const raw={items:[first,later,item("other"),cursor],total:4,nextOffset:null,cursor:{itemId:"cursor",questionId:"q0"}};
 const text=queueStartupContext({content:[{type:"text",text:JSON.stringify(raw)}]},500);
 const snapshot=JSON.parse(text.slice(text.indexOf("\n")+1));
 assert.equal(snapshot.item.id,"cursor");assert.equal(snapshot.item.revision,2);
 assert.deepEqual(snapshot.item.question,{id:"q0",text:"Actual question?",options:["First","Second"]});
 assert.equal(snapshot.totalPending,4);assert.equal(snapshot.dueOnThisPage,2);
 assert.equal(snapshot.item.origin.kind,"codex");assert.equal(text.includes("fixture-secret"),false);
});

test("empty, unavailable and oversized snapshots are explicit and do not invent questions",()=>{
 assert.match(queueStartupContext({items:[],total:0,nextOffset:null}),/"item":null/);
 assert.equal(queueStartupContext({isError:true}),QUEUE_CONTEXT_UNAVAILABLE);
 const huge=item("huge","🙂".repeat(10000));
 assert.match(queueStartupContext({items:[huge],total:1}),/oversized-item/);
 assert.equal(queueStartupContext({items:[item("broken")],total:-1}),QUEUE_CONTEXT_UNAVAILABLE);
});

test("disabled startup makes no read; timeout aborts only its own read without changing queue state",async()=>{
 let reads=0,cancels=0,signal;
 assert.equal(await loadJarvisQueueContext({enabled:false,signal:new AbortController().signal,read:async()=>{reads++;},cancel:()=>{cancels++;}}),undefined);
 const result=await loadJarvisQueueContext({enabled:true,signal:new AbortController().signal,timeoutMs:5,read:(s)=>{reads++;signal=s;return new Promise(()=>{});},cancel:()=>{cancels++;}});
 assert.equal(result,QUEUE_CONTEXT_UNAVAILABLE);assert.equal(reads,1);assert.equal(cancels,1);assert.equal(signal.aborted,true);
});

test("ending startup cancels the read and prevents a late context delivery",async()=>{
 const abort=new AbortController();let release,cancels=0;
 const pending=loadJarvisQueueContext({enabled:true,signal:abort.signal,read:()=>new Promise(resolve=>{release=resolve;}),cancel:()=>{cancels++;}});
 abort.abort();await assert.rejects(pending,{errorCode:"LIVE_STALE_CALL"});
 release({items:[item("late")],total:1});assert.equal(cancels,1);
});

test("Jarvis identity and actual snapshot enter the provider profile; ordinary profiles stay unchanged",()=>{
 const plain=createLiveWorkProfile();assert.equal(plain.instructions.includes("You are Jarvis"),false);
 const profile=createLiveWorkProfile(undefined,false,"snapshot-marker");
 assert.match(profile.instructions,/You are Jarvis/);assert.match(profile.instructions,/Presence is not consent/);
 assert.match(profile.startupContext,/snapshot-marker/);
});

test("real call-service startup loads queue context before constructing its adapter",async(t)=>{
 const {LiveCallService}=await loadModules(t);const sequence=[];
 const {deps,state}=dependencies({openWorkScope:()=>{},receiveWorkCandidate:async()=>{},loadWorkStartupContext:async()=>{sequence.push("queue");return "saved-queue-marker";}});
 const original=deps.createAdapter;deps.createAdapter=(context)=>{sequence.push("adapter");return original(context);};
 const service=new LiveCallService(deps);const status=await service.status();
 const prepared=await service.prepare(owner,{requestId,bindingId:binding.id,expectedSettingsRevision:status.settingsRevision,initialMuted:true});
 t.after(async()=>{const ending=service.end(owner,{callId:prepared.callId,reason:"user-ended"});try{service.reportMedia(owner,{callId:prepared.callId,kind:"released"});}catch{}await ending;});
 await service.connect(owner,{callId:prepared.callId,offerSdp:"v=0\r\n"});
 assert.deepEqual(sequence,["queue","adapter"]);assert.match(state.adapters[0].workProfile.startupContext,/saved-queue-marker/);
});
