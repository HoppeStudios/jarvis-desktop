import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
register(pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), "helpers/ts-import-hooks.mjs")));
const {jarvisSessionPolicy}=await import("../electron/main/jarvis/execution-policy.ts");
test("Jarvis persists Fast and one model while retaining effort, account and permission boundaries",()=>{
 const defaults={jarvisEnabled:true,defaultProviderId:"default"};
 assert.deepEqual(jarvisSessionPolicy({},defaults),{providerId:"default",modelId:"gpt-6.1-sol",thinkingLevel:"medium",fastMode:true});
 const result=jarvisSessionPolicy({modelId:"other",thinkingLevel:"high",fastMode:false,providerId:"selected-live-account",permissionMode:"ask"},defaults);
 assert.equal(result.modelId,"gpt-6.1-sol");assert.equal(result.fastMode,true);assert.equal(result.thinkingLevel,"high");
 assert.equal(result.providerId,"selected-live-account");assert.equal(result.permissionMode,"ask");
 const config=jarvisSessionPolicy({mode:"agent",fastMode:false},defaults,false);
 assert.equal(Object.hasOwn(config,"providerId"),false);assert.equal(Object.hasOwn(config,"thinkingLevel"),false);
 const existing={modelId:"other",fastMode:false};assert.equal(jarvisSessionPolicy(existing,{jarvisEnabled:false}),existing);
});
