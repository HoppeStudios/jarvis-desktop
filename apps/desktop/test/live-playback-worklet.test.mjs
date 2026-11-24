import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";

test("audio-clock monitoring detects remote speech and drain without UI frames or duplicated output",()=>{
 const messages=[];let Processor;
 const context=vm.createContext({sampleRate:48000,AudioWorkletProcessor:class{constructor(){this.port={postMessage:m=>messages.push(m),onmessage:null};}},
  registerProcessor:(name,constructor)=>{assert.equal(name,"pi-live-playback-monitor");Processor=constructor;}});
 vm.runInContext(readFileSync(new URL("../src/features/voice/live/playback-worklet.js",import.meta.url),"utf8"),context);
 const processor=new Processor({processorOptions:{threshold:0.004}});
 const output=new Float32Array(128).fill(1);
 for(let i=0;i<30;i++)processor.process([[new Float32Array(128).fill(0.1)]],[[output]]);
 assert.ok(messages.some(m=>m.active===true));assert.ok(output.every(x=>x===0),"monitor must never replay the remote audio");
 for(let i=0;i<45;i++)processor.process([[new Float32Array(128)]],[[output]]);
 assert.equal(messages.at(-1).active,false,"audio drain uses processed samples, not animation frames");
 assert.ok(messages.every(m=>Object.keys(m).sort().join()=== "active,kind"),"only flags cross the port, no audio samples");
 processor.port.onmessage({data:{kind:"stop"}});assert.equal(processor.process([],[[output]]),false);
});
