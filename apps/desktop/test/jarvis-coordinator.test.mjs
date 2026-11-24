import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { register } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
register(pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), "helpers/ts-import-hooks.mjs")));
const { createJarvisCoordinator } = await import("../electron/main/jarvis/coordinator.ts");

test("coordinator is independent, preserves instructions and uses selected account without changing voice", async()=>{
 const dataDir=await mkdtemp(join(tmpdir(),"jarvis-coordinator-"));const calls=[];
 const settings={liveVoice:{enabled:true,selectedBindingId:"chosen",bindings:[{id:"chosen",adapterId:"codex-live",providerId:"my-account",voice:"cove"}]}};
 const input={dataDir,settings:async()=>structuredClone(settings),createChannel:"create",configureChannel:"configure",
  invoke:async(channel,args)=>{calls.push({channel,args});return{session:{id:"coordinator"}};}};
 try{
  assert.equal(await createJarvisCoordinator(input),"coordinator");
  const created=calls[0].args[0];assert.equal(created.providerId,"my-account");assert.equal(created.fastMode,true);
  assert.equal(created.thinkingLevel,"low");assert.equal(created.modelId,"gpt-6.1-sol");
  assert.equal(calls[1].args[1].permissionMode,"auto");assert.equal(settings.liveVoice.bindings[0].voice,"cove");
  const path=join(dataDir,"jarvis","workspace","AGENTS.md");assert.match(await readFile(path,"utf8"),/actual user reply/);
  await writeFile(path,"user customization");await createJarvisCoordinator(input);
  assert.equal(await readFile(path,"utf8"),"user customization");
 }finally{await rm(dataDir,{recursive:true,force:true});}
});

test("coordinator refuses a missing/non-Codex selected binding before creating a chat",async()=>{
 let calls=0;
 await assert.rejects(createJarvisCoordinator({dataDir:"unused",settings:async()=>({liveVoice:{enabled:true,bindings:[]}}),invoke:async()=>{calls++;},createChannel:"create",configureChannel:"configure"}),{errorCode:"LIVE_BINDING_UNAVAILABLE"});
 assert.equal(calls,0);
});
