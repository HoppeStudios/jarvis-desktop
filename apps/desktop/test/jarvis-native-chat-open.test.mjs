import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";
register(new URL("./helpers/ts-import-hooks.mjs",import.meta.url));
const {CodexChatBridge}=await import("../electron/main/codex/codex-chat-bridge.ts");
const {IPC}=await import("@pi-desktop/shared");
const {createMcpControlController,mcpControlRendererEvent}=await import("../electron/main/mcp-control.ts");
const {findSessionMetadata}=await import("../electron/main/mcp-session-find.ts");

function fixture(alias=false){
 const bridge=new CodexChatBridge({router:{},emit:()=>{}});bridge.ensure=async()=>{};
 const thread={id:"native-thread",name:"Jednoduchý protokol",cwd:"C:/Research",createdAt:1,updatedAt:2};
 bridge.threads.set(thread.id,thread);bridge.subscribe=async id=>{assert.equal(id,thread.id);return thread};
 if(alias)bridge.aliases.set("pi-view",{threadId:thread.id,session:{projectPath:"C:/Research"}});
 const requests=[];bridge.request=async(method,params)=>{
  requests.push({method,params});assert.equal(method,"thread/items/list");assert.equal(params.limit,1);
  return {data:[],nextCursor:null};
 };
 return {bridge,thread,requests};
}

test("opening an original native chat returns the normal bounded detail that drives real renderer selection",async()=>{
 const {bridge,requests}=fixture(),events=[];
 const controller=createMcpControlController({channels:{sessionOpen:IPC.invoke.sessionOpen},invoke:(channel,args)=>bridge.invoke(channel,args),
  onOperationComplete:(op,result,args)=>events.push(mcpControlRendererEvent(op,result,args))});
 const id="remote:codex-shared:native-thread";
 const opened=await controller.invoke({operation:"session/open",args:[id]});
 assert.equal(opened.session.id,id);assert.equal(opened.requestedSessionId,id);assert.deepEqual(opened.session.messages,[]);
 assert.equal(events[0].selectSessionId,id);assert.equal(events[0].projectPath,"C:/Research");assert.equal(requests.length,1);
 assert.deepEqual(opened.session.nativeOwner,{hostKey:"codex-shared",sessionId:"native-thread",viewId:id});
});

test("a bound original opens its verified canonical Pi view with an explicit requested identity receipt",async()=>{
 const {bridge}=fixture(true);const original="remote:codex-shared:native-thread";
 const opened=await bridge.invoke(IPC.invoke.sessionOpen,[original]);
 assert.equal(opened.session.id,"pi-view");assert.equal(opened.requestedSessionId,original);
 assert.equal(opened.session.nativeOwner.viewId,"pi-view");
 assert.equal(mcpControlRendererEvent({id:"session/open"},opened,[original]).selectSessionId,"pi-view");
});

test("verified linked views remain discoverable as Codex owners and deduplicate by owner, never by title",()=>{
 const {bridge,thread}=fixture(true);
 bridge.aliases.set("another-view",{threadId:thread.id,session:{projectPath:"C:/Research"}});
 bridge.aliases.set("unbound-import",{session:{id:"unbound-import",title:thread.name,projectPath:"C:/Research"}});
 const inventory={sessions:bridge.summaries()};
 const scoped=findSessionMetadata(inventory,{query:thread.name,owner:"codex"},{});
 assert.equal(scoped.status,"matched");assert.equal(scoped.match.id,"pi-view");assert.equal(scoped.candidates.length,1);
 assert.equal(findSessionMetadata(inventory,{query:thread.name},{}).status,"ambiguous");
 const archived=findSessionMetadata(inventory,{query:thread.name,owner:"codex"},{sessionMeta:{"pi-view":{archived:true}}});
 assert.equal(archived.match.id,"another-view");
});

test("an unsupported target never produces a navigation receipt",async()=>{
 const {bridge,requests}=fixture();
 await assert.rejects(()=>bridge.invoke(IPC.invoke.sessionOpen,["unknown-local-session"]));assert.equal(requests.length,0);
});
