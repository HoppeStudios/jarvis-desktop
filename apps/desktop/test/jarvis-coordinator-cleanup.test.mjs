import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import { register } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
register(pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), "helpers/ts-import-hooks.mjs")));
const { RendererCleanupProbe, JarvisCoordinatorCleanup, createCleanupDocumentWatcher } = await import("../electron/main/jarvis/coordinator-cleanup.ts");
const { SessionCleanupReadiness } = await import("../src/lib/session-cleanup-readiness.ts");
const { createSessionCoordination } = await import("../electron/main/runtime/session-coordination.ts");
const { writeComposerDraft, resetComposerDraftCache } = await import("../src/lib/composer-draft-cache.ts");
const owner={webContentsId:1,frameProcessId:2,frameRoutingId:3,url:"file:///app/index.html"};

function harness({beforeResponse=()=>{},hostDelete=async()=>true}={}) {
 resetComposerDraftCache();
 const state={activeSessionId:"unrelated",retainedSessionIds:[],composerPrefill:null};
 const renderer=new SessionCleanupReadiness(()=>state);
 const turns=new Map();
 const coordination=createSessionCoordination({activeTurns:turns,getMainWindow:()=>null,getViewingSessionId:()=>null});
 const calls=[],forgotten=[],warnings=[];
 let probe;
 probe=new RendererCleanupProbe((identity,request)=>{
  const reply=renderer.receive(request);
  beforeResponse(request,renderer,state);
  probe.complete(identity,reply);
 });
 const host={call:async(method,params)=>{calls.push({method,params});return {ok:method.endsWith("arm") || await hostDelete()};}};
 const cleanup=new JarvisCoordinatorCleanup({probe,host:()=>host,acquireSessionOperation:coordination.acquireSessionOperation,
  isBusy:coordination.isSessionBusy,drain:async()=>{},forget:id=>forgotten.push(id),warn:()=>warnings.push(true)});
 return {state,renderer,cleanup,turns,coordination,calls,forgotten,warnings};
}

test("document watcher attaches after startup and detaches replaced/destroyed windows",()=>{
 let contents=null,invalidations=0;
 const refresh=createCleanupDocumentWatcher(()=>contents,()=>invalidations++);
 refresh();contents=new EventEmitter();refresh();
 contents.emit("did-start-navigation",{},"file:///same",false,false);
 contents.emit("did-start-navigation",{},"file:///same",true,true);
 assert.equal(invalidations,0);
 contents.emit("did-start-navigation",{},"file:///same",false,true);
 assert.equal(invalidations,1);
 const previous=contents;contents=new EventEmitter();refresh();
 assert.equal(invalidations,2);assert.equal(previous.listenerCount("did-start-navigation"),0);
 contents.emit("render-process-gone");assert.equal(invalidations,3);
 contents.emit("destroyed");assert.equal(invalidations,4);
 assert.equal(contents.listenerCount("did-start-navigation"),0);
});

test("real renderer readiness and session operation delete only owned idle metadata",async()=>{
 const h=harness();
 await h.cleanup.observe(owner,"owned");
 assert.equal(await h.cleanup.cleanup(owner,"unrelated",async()=>true),"deferred");
 assert.equal(await h.cleanup.cleanup(owner,"owned",async()=>true),"deleted");
 assert.deepEqual(h.forgotten,["owned"]);assert.equal(h.state.activeSessionId,"unrelated");
 assert.deepEqual(h.calls.map(c=>c.method),["jarvis.coordinator.arm","jarvis.coordinator.deleteEmpty"]);
 assert.equal(await h.cleanup.cleanup(owner,"owned",async()=>true),"deferred");
});

test("cached drafts, active work and selection during prepare block the Host delete",async()=>{
 for(const change of [h=>writeComposerDraft("owned",{text:"unsent",fileReferences:[]}),
  h=>h.turns.set("owned","active"),h=>{h.state.selectingSessionId="owned";}]){
  const h=harness();await h.cleanup.observe(owner,"owned");change(h);
  assert.equal(await h.cleanup.cleanup(owner,"owned",async()=>true),"deferred");
  assert.equal(h.calls.length,1);assert.deepEqual(h.forgotten,[]);
 }
 const h=harness({beforeResponse:request=>{if(request.phase==="prepare")void h.renderer.admitSelection("owned");}});
 await h.cleanup.observe(owner,"owned");
 assert.equal(await h.cleanup.cleanup(owner,"owned",async()=>true),"deferred");
 assert.equal(h.calls.length,1);
});

test("agent admission wins before cleanup's operation; active turn is checked after acquisition",async()=>{
 const h=harness();await h.cleanup.observe(owner,"owned");
 const release=await h.coordination.acquireSessionOperation("owned");
 const pending=h.cleanup.cleanup(owner,"owned",async()=>true);
 h.turns.set("owned","admitted");release();
 assert.equal(await pending,"deferred");assert.equal(h.calls.length,1);
});

test("cleanup holds the real session operation through the Host acknowledgement",async()=>{
 let entered,finish;
 const enteredPromise=new Promise(r=>{entered=r;});
 const ack=new Promise(r=>{finish=r;});
 const h=harness({hostDelete:async()=>{entered();return ack;}});
 await h.cleanup.observe(owner,"owned");
 const pending=h.cleanup.cleanup(owner,"owned",async()=>true);await enteredPromise;
 let admitted=false;
 const agent=h.coordination.acquireSessionOperation("owned").then(release=>{admitted=true;release();});
 await Promise.resolve();assert.equal(admitted,false);
 finish(true);assert.equal(await pending,"deleted");await agent;assert.equal(admitted,true);
});

test("presence changing across awaits or renderer rejection defers without deleting",async()=>{
 for(const failureAt of [1,2,3]){
  const h=harness();await h.cleanup.observe(owner,"owned");let checks=0;
  assert.equal(await h.cleanup.cleanup(owner,"owned",async()=>++checks<failureAt),"deferred");
  assert.equal(h.calls.length,1);
 }
});

test("unknown, stale, wrong-phase and wrong-document readiness acknowledgements are refused",async()=>{
 let request;const probe=new RendererCleanupProbe((identity,value)=>{request=value;},1000);
 const pending=probe.ask(owner,{requestId:"nonce",sessionId:"owned",phase:"prepare"});
 const reply={...request,ready:true};
 for(const invalid of [{...reply,requestId:"stale"},{...reply,phase:"commit"},{...reply,sessionId:"other"},{...reply,ready:"yes"}])
  assert.equal(probe.complete(owner,invalid).accepted,false);
 assert.equal(probe.complete({...owner,frameRoutingId:99},reply).accepted,false);
 assert.equal(probe.complete({...owner,url:"file:///other.html"},reply).accepted,false);
 assert.equal(probe.complete(owner,reply).accepted,true);assert.equal(await pending,true);
 assert.equal(probe.complete(owner,reply).accepted,false);
});

test("renderer navigation invalidates even a same-URL prior document acknowledgement",async()=>{
 const h=harness();await h.cleanup.observe(owner,"owned");
 // Use the production broker's navigation generation, not caller data.
 let request;const probe=new RendererCleanupProbe((_owner,value)=>{request=value;});
 const pending=probe.ask(owner,{requestId:"old-document",sessionId:"owned",phase:"prepare"});
 probe.invalidate();
 assert.equal(await pending,false);
 assert.equal(probe.complete(owner,{...request,ready:true}).accepted,false);
});

test("Host refusal releases the renderer and retains unrelated history",async()=>{
 const h=harness({hostDelete:async()=>false});await h.cleanup.observe(owner,"owned");
 assert.equal(await h.cleanup.cleanup(owner,"owned",async()=>true),"deferred");
 assert.equal(await h.renderer.admitSelection("owned"),true);
 assert.equal(h.state.activeSessionId,"unrelated");assert.deepEqual(h.forgotten,[]);
});
