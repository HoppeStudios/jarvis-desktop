import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
register(pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), "helpers/ts-import-hooks.mjs")));
const {playPresenceGreeting}=await import("../src/features/voice/live/presence-greeting.ts");
const idle=()=>({connected:true,providerReady:true,playbackBlocked:false,transcriptReceived:false,transcriptMatches:false,measuredAudio:false,playbackActive:false,turnComplete:false,contextState:"running"});

test("greeting requires its transcript, measured remote audio, completed turn and playback drain",async()=>{
 const state=idle();let now=100,sends=0,step=0;
 const result=await playPresenceGreeting({signal:new AbortController().signal,state:()=>state,send:()=>sends++,now:()=>now,wait:async()=>{
  step++;now+=20;
  if(step===1)state.transcriptMatches=true;
  if(step===2){state.measuredAudio=true;state.playbackActive=true;}
  if(step===3)state.turnComplete=true;
  if(step===4)state.playbackActive=false;
 }});
 assert.equal(sends,1);assert.equal(result.greetingPlayed,true);assert.equal(result.greetingFinishedAt,180);
});
test("a sent request, transcript or conservative suspended-context activity never proves played audio",async()=>{
 const state={...idle(),transcriptMatches:true,turnComplete:true,playbackActive:true};let now=0;
 const result=await playPresenceGreeting({signal:new AbortController().signal,state:()=>state,send:()=>{},timeoutMs:50,now:()=>now,wait:async()=>{now+=10;}});
 assert.equal(result.greetingPlayed,false);assert.equal(result.greetingEvidence.measuredAudio,false);
});
test("disconnected or blocked media never sends a greeting or changes browser activation policy",async()=>{
 for(const patch of [{connected:false},{playbackBlocked:true}]){
  let sends=0;const state={...idle(),...patch};
  assert.equal((await playPresenceGreeting({signal:new AbortController().signal,state:()=>state,send:()=>sends++})).greetingPlayed,false);assert.equal(sends,0);
 }
});
test("a connected peer is not provider readiness; wait for session.started before sending context",async()=>{
 const state={...idle(),providerReady:false};let now=0,sends=0;
 const result=await playPresenceGreeting({signal:new AbortController().signal,state:()=>state,send:()=>{assert.equal(state.providerReady,true);sends++;},timeoutMs:30,now:()=>now,wait:async()=>{now+=10;state.providerReady=true;}});
 assert.equal(sends,1);assert.equal(result.greetingEvidence.requestSent,true);
});
test("a second wake/call end cancels greeting observation without waiting for timeout",async()=>{
 const abort=new AbortController();let waits=0;
 const result=await playPresenceGreeting({signal:abort.signal,state:idle,send:()=>{},wait:async()=>{waits++;abort.abort();}});
 assert.equal(waits,1);assert.equal(result.greetingPlayed,false);
});
