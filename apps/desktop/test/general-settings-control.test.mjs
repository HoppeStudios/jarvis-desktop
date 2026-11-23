import assert from "node:assert/strict";
import test from "node:test";
import { register, registerHooks } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const here=dirname(fileURLToPath(import.meta.url));
register(pathToFileURL(join(here,"helpers/ts-import-hooks.mjs")));
registerHooks({resolve(specifier,context,next){
 if(specifier==="../network-proxy" && context.parentURL?.endsWith("/ipc/settings-ipc.ts")) return {url:"data:text/javascript,export const currentSystemProxyRelayUrl=()=>undefined;",shortCircuit:true};
 return next(specifier,context);
}});
const { validateGeneralSettingsPatch }=await import("../electron/main/general-settings.ts");
const { registerSettingsIpc }=await import("../electron/main/ipc/settings-ipc.ts");
const { createMcpControlController, mcpControlRendererEvent }=await import("../electron/main/mcp-control.ts");

test("local general settings reject secret, voice, network and unknown writes",()=>{
  for(const patch of [{},{secretValue:"fixture"},{liveVoice:{}},{networkPolicy:{}},{defaultPermissionMode:"bypass"},{defaultModelId:"  model"},{codemodeEnabled:1},{defaultMode:"unknown"}]) {
    assert.throws(()=>validateGeneralSettingsPatch(patch));
  }
  assert.deepEqual(validateGeneralSettingsPatch({defaultModelId:"gpt-6.1-sol",defaultPermissionMode:"auto",updatePreference:"manual"}),{defaultModelId:"gpt-6.1-sol",defaultPermissionMode:"auto",updatePreference:"manual"});
});

function harness(refuse=false) {
 const handlers=new Map();const calls=[];let saved={defaultMode:"agent",liveVoice:{enabled:true,bindings:[]}};
 registerSettingsIpc({registrar:{handle:(channel,fn)=>handlers.set(channel,fn)},getHost:()=>({call:async(method,params)=>{
   calls.push(method);if(method==="settings.get")return saved;
   if(method==="settings.set"){saved={...saved,...params};return saved;}
   throw Error("Unexpected host request");
 }}),getSidecar:()=>null,dataDir:"fixture",normalizeSettings:v=>v,validateSettingsWrite:v=>v,
 testNetworkProxy:async()=>{},applyNetworkProxyFromAppSettings:async()=>{},currentNetworkProxy:()=>null,
 applyApplicationMenuSettings:()=>{},applyDeveloperMode:()=>{},applyPreventScreenSleep:()=>{},applyKeepAwakeWhileRunning:()=>{},applyUpdatePreference:()=>{},resolveEffectiveCommandShell:async()=>{},
 liveCallService:{beginSettingsWrite:()=>{calls.push("voice-guard");if(refuse)throw Error("call guard refused");return()=>calls.push("release");},settingsWritten:async()=>calls.push("voice-written")}});
 return {handlers,calls};
}

test("MCP general preferences preserve live voice settings and normal guard ordering",async()=>{
 const {handlers,calls}=harness();
 const controller=createMcpControlController({channels:{settingsSet:"pi-desktop/settings/set",settingsConfigureGeneral:"pi-desktop/settings/configureGeneral"},invoke:(channel,args)=>handlers.get(channel)(...args)});
 assert.deepEqual(controller.operations.map(op=>op.id),["settings/configureGeneral"]);
 await assert.rejects(()=>controller.invoke({operation:"settings/configureGeneral",args:[{defaultModelId:"gpt-6.1-sol",secretValue:"fixture"}],confirm:true}));
 assert.deepEqual(calls,[]);
 await assert.rejects(()=>controller.invoke({operation:"settings/configureGeneral",args:[{defaultPermissionMode:"auto"}]}),e=>e.code==="CONFIRMATION_REQUIRED");
 const value=await controller.invoke({operation:"settings/configureGeneral",args:[{defaultModelId:"gpt-6.1-sol",defaultPermissionMode:"auto"}],confirm:true});
 assert.equal(value.defaultModelId,"gpt-6.1-sol");assert.equal(value.defaultPermissionMode,"auto");assert.equal(value.liveVoice.enabled,true);
 assert.deepEqual(calls,["settings.get","voice-guard","settings.set","voice-written","release","settings.get"]);
 assert.deepEqual(mcpControlRendererEvent(controller.operations[0],value,[]),{reason:"mcp.settings"});
});

test("a live-call settings refusal prevents writes and is returned unchanged",async()=>{
 const {handlers,calls}=harness(true);
 await assert.rejects(()=>handlers.get("pi-desktop/settings/configureGeneral")({defaultModelId:"gpt-6.1-sol"}),/call guard refused/);
 assert.deepEqual(calls,["settings.get","voice-guard"]);
});
