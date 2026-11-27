import assert from 'node:assert/strict';
import test from 'node:test';
import {register} from 'node:module';
import {dirname,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
register(pathToFileURL(join(dirname(fileURLToPath(import.meta.url)),'helpers/ts-import-hooks.mjs')));
const {spokenWorkContext}=await import('../electron/main/live-voice/spoken-work-context.ts');
const base={callId:'call',workSessionId:'same-worker',operationId:'operation',providerRequestId:'old',instruction:'Změň velikost okna, zachovej soubory a nic neodesílej.',admission:'accepted',execution:'completed',resultState:'available',resultSummary:'Window updated; files preserved.'};
const context=operations=>spokenWorkContext({callId:'call',workSessionId:'same-worker',providerRequestId:'current',operations});
test('follow-up sees the full prior request and verified result only for its same call and work chat',()=>{
 const entries=context([base,{...base,callId:'other'},{...base,workSessionId:'unrelated'},{...base,admission:'rejected'},{...base,providerRequestId:'current'}]);
 assert.equal(entries.length,1);assert.equal(entries[0].request,base.instruction);assert.equal(entries[0].result,base.resultSummary);
});
test('conversation, pending results and rejected work do not become execution context',()=>{
 assert.deepEqual(context([{...base,execution:'not-started'},{...base,admission:'unknown'}]),[]);
 assert.equal(context([{...base,resultState:'pending'}])[0].result,undefined);
});
test('multibyte history is bounded without truncating requests or inventing omitted text',()=>{
 const entry=context([{...base,instruction:'Žluťoučký kůň '.repeat(600)}])[0];
 assert.equal(entry.request,undefined);assert.equal(entry.requestOmitted,true);
 assert.ok(Buffer.byteLength(JSON.stringify(context(Array.from({length:8},(_,i)=>({...base,operationId:String(i),instruction:'č'.repeat(800)})))))<=3074);
 assert.equal(base.instruction,'Změň velikost okna, zachovej soubory a nic neodesílej.');
});
