import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
function guard(){let Processor;vm.runInNewContext(readFileSync(new URL('../src/features/voice/live/interruption-worklet.js',import.meta.url),'utf8'),{AudioWorkletProcessor:class{port={};},sampleRate:48000,registerProcessor:(_name,type)=>Processor=type});const p=new Processor();p.port.onmessage({data:{kind:'muted',active:false}});return p;}
function frame(p,value){const out=new Float32Array(128);p.process([[new Float32Array(128).fill(value)]],[[out]]);return [...out];}
function control(p,kind,active){p.port.onmessage({data:{kind,active}});}
test('idle input is immediate, but short speech/noise does not interrupt assistant playback',()=>{const p=guard();assert.ok(frame(p,.1).every(x=>x>.09));control(p,'speaking',true);for(let i=0;i<20;i++)assert.ok(frame(p,.1).every(x=>x===0));for(let i=0;i<40;i++)assert.ok(frame(p,0).every(x=>x===0));});
test('sustained speech is admitted with its buffered onset and tail preserved',()=>{const p=guard();control(p,'speaking',true);const output=[];for(let i=0;i<120;i++)output.push(...frame(p,i<10?.11:.22));control(p,'speaking',false);for(let i=0;i<200;i++)output.push(...frame(p,0));const voice=output.filter(x=>x>.05);assert.equal(voice.length,120*128);assert.ok(voice[0]<.12);assert.ok(voice.at(-1)>.21);});
test('native mute and stop discard buffered speech and never replay it',()=>{const p=guard();control(p,'speaking',true);for(let i=0;i<30;i++)frame(p,.2);control(p,'muted',true);for(let i=0;i<120;i++)assert.ok(frame(p,.2).every(x=>x===0));control(p,'muted',false);control(p,'speaking',false);assert.ok(frame(p,0).every(x=>x===0));control(p,'stop',true);const out=new Float32Array(128).fill(1);assert.equal(p.process([[out]],[[out]]),false);assert.ok(out.every(x=>x===0));});
