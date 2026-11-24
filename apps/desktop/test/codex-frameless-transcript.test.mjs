import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
register(pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), "helpers/ts-import-hooks.mjs")));
const {CodexTranscriptAssembler}=await import("../src/features/voice/live/codex-transcript.ts");
const {parseCodexMessage}=await import("../../../packages/voice-runtime/src/live/protocol.ts");
test("real frameless chunks become one final row, and the next spoken answer gets a new identity",()=>{
 const assembler=new CodexTranscriptAssembler();const rows=[];
 for(const raw of [
  {type:"input_transcript.added",item:{text:"Já? "}}, {type:"input_transcript.added",item:{text:"What"}},
  {type:"turn.done",turn:{role:"user",transcript:"Já? What"}},
  {type:"input_transcript.added",item:{text:"Ano"}}, {type:"turn.done",turn:{role:"user",transcript:"Ano"}},
 ])for(const event of parseCodexMessage(raw))if(event.kind==="transcript")rows.push(assembler.push(event,100));
 assert.equal(rows[0].id,rows[1].id);assert.equal(rows[1].text,"Já? What");assert.equal(rows[2].text,"Já? What");
 assert.equal(rows[2].id,rows[0].id);assert.equal(rows[2].final,true);assert.notEqual(rows[2].id,rows[4].id);
 assert.equal(rows.filter(r=>r.final).length,2);
});
test("identified retransmissions keep their final identity and cumulative chunks remain bounded",()=>{
 const a=new CodexTranscriptAssembler();const event={kind:"transcript",id:"provider-id",role:"user",final:true,text:"Answer"};
 assert.equal(a.push(event,1).id,a.push(event,2).id);
 const delta={...event,id:"codex-output",role:"assistant",final:false,delta:true,text:"x".repeat(40_000)};
 a.push(delta,3);assert.throws(()=>a.push(delta,4),{code:"LIVE_PROTOCOL_ERROR"});
});
