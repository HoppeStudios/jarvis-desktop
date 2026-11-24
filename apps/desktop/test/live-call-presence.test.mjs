import assert from "node:assert/strict";
import test from "node:test";
import {binding,dependencies,loadModules,owner,otherOwner,requestId} from "./helpers/live-voice-service-fixture.mjs";
test("short speech and final user turns survive idle polls without exposing transcript text",async(t)=>{
 const {LiveCallService}=await loadModules(t);let now=100;
 const {deps}=dependencies({now:()=>now});const service=new LiveCallService(deps);const status=await service.status();
 const prepared=await service.prepare(owner,{requestId,bindingId:binding.id,expectedSettingsRevision:status.settingsRevision,initialMuted:true});
 t.after(async()=>{const ending=service.end(owner,{callId:prepared.callId,reason:"user-ended"});try{service.reportMedia(owner,{callId:prepared.callId,kind:"released"});}catch{}await ending;});
 await service.connect(owner,{callId:prepared.callId,offerSdp:"v=0\r\n"});
 service.reportMedia(owner,{callId:prepared.callId,kind:"activity",userSpeaking:true});now=200;
 service.reportMedia(owner,{callId:prepared.callId,kind:"activity",userSpeaking:false});
 service.reportUserTurn(owner,{callId:prepared.callId,itemId:"actual-final-user-turn"});
 now=300;service.reportUserTurn(owner,{callId:prepared.callId,itemId:"actual-final-user-turn"});
 const view=(await service.status()).call;
 assert.equal(view.userSpeaking,false);assert.equal(view.lastUserSpeechAt,100);assert.equal(view.lastUserTurnAt,200);assert.equal(view.userTurnCount,1);
 assert.equal("transcript" in view,false);
 assert.throws(()=>service.reportUserTurn(otherOwner,{callId:prepared.callId,itemId:"wrong-owner"}),{errorCode:"LIVE_INVALID_OWNER"});
});
