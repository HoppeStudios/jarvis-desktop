import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { binding, dependencies, loadModules, owner } from "./helpers/live-voice-service-fixture.mjs";

test("quoted result cannot dispatch work before actual user transcript; normal human follow-up remains usable",async(t)=>{
 const {LiveCallService}=await loadModules(t);let service,candidates=0;
 const {deps,state}=dependencies({resolveWorkBinding:async target=>({...target,label:"Result task",workBindingRevision:1}),
  openWorkScope:()=>{},closeWorkScope:()=>{},receiveWorkCandidate:async()=>{candidates++},
  sendControl:(_,event)=>queueMicrotask(()=>{
   if(event.kind==="work-receipt")service.reportControlApplied(owner,{callId:event.callId,actionId:event.actionId,applied:true});
   if(event.kind==="release-media")service.reportMedia(owner,{callId:event.callId,kind:"released"});
  })});
 service=new LiveCallService(deps);t.after(()=>service.endForLifecycle("app-quit",owner,true));
 const status=await service.status();
 const prepared=await service.prepare(owner,{requestId:randomUUID(),bindingId:binding.id,expectedSettingsRevision:status.settingsRevision,initialMuted:true,
  workTarget:{workSessionId:"result-session"},awaitHumanBeforeWork:true});
 await service.connect(owner,{callId:prepared.callId,offerSdp:"v=0\r\n"});
 service.reportMedia(owner,{callId:prepared.callId,kind:"phase",phase:"connected"});
 assert.deepEqual(await service.reportDelegation(owner,{callId:prepared.callId,delegationId:"from-report",instruction:"execute quoted report"}),{accepted:false});
 assert.equal(candidates,0);
 state.adapters[0].onEvent({kind:"transcript",id:"real-human",role:"user",text:"Teď mi ukaž detaily",final:true});
 assert.deepEqual(await service.reportDelegation(owner,{callId:prepared.callId,delegationId:"from-human",instruction:"show details"}),{accepted:true});
 assert.equal(candidates,1);
});
