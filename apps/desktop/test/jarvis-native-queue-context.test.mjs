import assert from 'node:assert/strict';
import test from 'node:test';
import {register} from 'node:module';
import {dependencies,loadModules,owner,binding,requestId} from './helpers/live-voice-service-fixture.mjs';
register(new URL('./helpers/ts-import-hooks.mjs',import.meta.url));
const {queueStartupContext}=await import('../electron/main/jarvis/queue-context.ts');
const {sendJarvisSessionContext}=await import('../src/features/voice/live/jarvis-session-context.ts');
const snapshot=queueStartupContext({items:[{id:'item',revision:1,kind:'question',state:'pending',threadId:'source',questions:[{id:'0',question:'Which label?',options:['Orion','Vega'],answered:false}]}],total:1,nextOffset:null});
test('real call service sends native queue continuation once after genuine presence and records local delivery',async(t)=>{
 const {LiveCallService}=await loadModules(t);
 const {deps,state}=dependencies({openWorkScope(){},receiveWorkCandidate:async()=>{},loadWorkStartupContext:async()=>snapshot});
 const s=new LiveCallService(deps);const status=await s.status();
 const prepared=await s.prepare(owner,{requestId,bindingId:binding.id,expectedSettingsRevision:status.settingsRevision,initialMuted:true});
 t.after(async()=>{const ending=s.end(owner,{callId:prepared.callId,reason:'user-ended'});try{s.reportMedia(owner,{callId:prepared.callId,kind:'released'});}catch{}await ending;});
 await s.connect(owner,{callId:prepared.callId,offerSdp:'v=0\r\n'});
 s.reportMedia(owner,{callId:prepared.callId,kind:'phase',phase:'connected'});
 state.adapters[0].onEvent({kind:'transcript',role:'assistant',text:'Are you present, sir?',final:true,id:'greeting'});
 assert.equal(state.controls.filter(x=>x.kind==='session-context').length,0,'assistant greeting is not human presence');
 state.adapters[0].onEvent({kind:'transcript',role:'user',text:'I am here',final:false,id:'actual-user-1'});
 state.adapters[0].onEvent({kind:'transcript',role:'user',text:'I am here',final:true,id:'actual-user-1'});
 const events=state.controls.filter(x=>x.kind==='session-context');assert.equal(events.length,1);
 assert.match(events[0].content,/Which label/);assert.match(events[0].content,/not a human message or answer/);
 s.reportControlApplied(owner,{callId:prepared.callId,actionId:events[0].actionId,applied:true});
 assert.equal((await s.status()).call.jarvisQueue.delivery,'sent');
});
test('renderer context append is bounded, call-bound and idempotent; it never supplies a human turn',()=>{
 const wire=[];const input={callId:'call',currentCallId:'call',adapterId:'codex-live',actionId:'action',content:snapshot,channel:{readyState:'open',send:v=>wire.push(JSON.parse(v))},completed:new Set()};
 assert.equal(sendJarvisSessionContext({...input,currentCallId:'other'}),false);
 assert.equal(sendJarvisSessionContext({...input,content:'x'.repeat(50*1024)}),false);
 assert.equal(sendJarvisSessionContext(input),true);assert.equal(sendJarvisSessionContext(input),true);
 assert.equal(wire.length,1);assert.equal(wire[0].type,'session.context.append');assert.equal(wire[0].channel,'speakable');
 assert.equal(wire[0].role,undefined);
});

test('failed native context delivery stays diagnostic and does not end the call or answer anything',async()=>{
 const {dispatchJarvisQueueContext}=await import('../electron/main/live-voice/jarvis-queue-control.ts');
 const slot={callId:'call',owner:{},phase:'connected',userTurnCount:1,binding:{adapterId:'codex-live'},abort:new AbortController(),pendingControls:new Map(),jarvisQueueContext:{content:'Host snapshot',state:'ready',delivery:'pending'}};
 let published=0;dispatchJarvisQueueContext(slot,{current:()=>slot,publish:()=>published++,send:()=>{throw new Error('closed channel');}});
 assert.equal(slot.jarvisQueueContext.delivery,'not-sent');assert.equal(slot.phase,'connected');assert.equal(slot.pendingControls.size,0);assert.equal(published,1);
});


test('native briefing is compact while the complete source identity stays in Main',async()=>{
 const {jarvisQueueContinuation}=await import('../electron/main/jarvis/queue-context.ts');
 const q={id:'item-long',revision:2,kind:'question',state:'pending',origin:{kind:'codex',threadId:'real-source',hostId:'local'},questions:[{id:'0',question:'Which label should the automatic invitation test use?',options:['Atlas','Lyra'],answered:false}]};
 const context=jarvisQueueContinuation(queueStartupContext({items:[q],total:1,nextOffset:null}));
 assert.ok(Buffer.byteLength(context.content)<=1024);assert.match(context.content,/Atlas/);assert.match(context.content,/Lyra/);
 assert.equal(JSON.parse(context.replyContext).origin.threadId,'real-source');assert.doesNotMatch(context.content,/real-source/);
 q.questions[0].question='Žádná volba nesmí být potichu zkrácena. '.repeat(100);
 const long=jarvisQueueContinuation(queueStartupContext({items:[q],total:1,nextOffset:null}));
 assert.ok(Buffer.byteLength(long.content)<=1024);assert.match(long.content,/fetch and brief/);assert.doesNotMatch(long.content,/Žádná/);
});
