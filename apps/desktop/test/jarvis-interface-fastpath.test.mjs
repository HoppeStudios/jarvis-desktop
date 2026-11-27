import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
register(new URL("./helpers/ts-import-hooks.mjs",import.meta.url));
const {sessionFindQuery,findSessionMetadata}=await import("../electron/main/mcp-session-find.ts");
const {shouldStartMcpControl}=await import("../electron/main/mcp-startup-policy.ts");
const {createMcpControlController,McpControlServer}=await import("../electron/main/mcp-control.ts");
const sessions=[
 {id:"pi-real",title:"Jednoduchý protokol",projectPath:"C:/Projects/Research",source:"desktop",content:"private transcript",apiKey:"secret"},
 {id:"remote:codex-shared:native-real",title:"Jarvis voice control",projectPath:"C:/Projects/Jarvis",source:"codex",remoteHostKey:"codex-shared"},
 {id:"archive",title:"Starší protokol",source:"desktop"},
];
const prefs={sessionMeta:{archive:{archived:true}}};
const find=(query,extra={},rows=sessions)=>findSessionMetadata({sessions:rows,runningSessionIds:["not-live-proof"]},sessionFindQuery([{query,...extra}]),prefs);

test("ordinary starts honor persisted explicit Jarvis opt-in while environment denial wins",()=>{
 assert.equal(shouldStartMcpControl(undefined,true),true);
 for(const missing of [false,undefined,null,"true",1])assert.equal(shouldStartMcpControl(undefined,missing),false);
 assert.equal(shouldStartMcpControl("0",true),false);assert.equal(shouldStartMcpControl("disabled",true),false);
 assert.equal(shouldStartMcpControl("1",false),true);
});

test("approximate spoken names resolve actual IDs without transcript, model, secret or activity data",()=>{
 for(const query of ["jednoduchy protokol","protokol jednoduchej","jednoduchi protokol","JEDNODUCHÝ PROTOKOL"]){
  const result=find(query);assert.equal(result.status,"matched",query);assert.equal(result.match.id,"pi-real");
  assert.equal(JSON.stringify(result).includes("private transcript"),false);assert.equal(JSON.stringify(result).includes("apiKey"),false);
  assert.equal(result.runningSessionIds,undefined);
 }
 const linked=find("jarvis voice");assert.equal(linked.match.id,"remote:codex-shared:native-real");assert.equal(linked.match.source,"codex");
});

test("ambiguous names preserve host namespaces and never pick an arbitrary chat",()=>{
 const duplicates=[{id:"pi-a",title:"Jarvis"},{id:"remote:codex-shared:b",title:"Jarvis"}];
 const result=find("jarvis",{},duplicates);assert.equal(result.status,"ambiguous");assert.equal(result.match,undefined);
 assert.equal(result.candidates.length,2);
 assert.equal(find("jarvis",{project:"research"}).status,"not-found");
 assert.equal(find("voice",{project:"jarvis"}).match.id,"remote:codex-shared:native-real");
});

test("archive visibility, deduplication, no-match and bounded results remain explicit",()=>{
 assert.equal(find("starsi protokol").status,"not-found");
 assert.equal(find("starsi protokol",{includeArchived:true}).match.archived,true);
 assert.equal(find("jednoduchy protokol",{},[...sessions,sessions[0]]).status,"matched");
 assert.equal(find("unrelated settings").status,"not-found");
 assert.equal(find("jarvis",{limit:1},Array.from({length:20},(_,i)=>({id:String(i),title:"Jarvis"}))).candidates.length,1);
});

test("query validation is closed before native reads",()=>{
 for(const q of [{query:""},{query:"?"},{query:"a"},{query:"x".repeat(201)},{query:"jarvis",limit:9},
  {query:"jarvis",includeArchived:"true"},{query:"jarvis",project:""},{query:"jarvis",open:true}])assert.throws(()=>sessionFindQuery([q]));
 assert.throws(()=>sessionFindQuery([]));assert.throws(()=>sessionFindQuery([{query:"jarvis"},{}]));
});

test("one native inventory read replaces paginated approximate title lookup without messages or writes",async()=>{
 const calls=[];const controller=createMcpControlController({channels:{sessionList:"native-list"},readSidebarPreferences:()=>prefs,
  invoke:async(channel,args)=>{calls.push({channel,args});return {sessions}}});
 assert.equal(controller.operations.find(op=>op.id==="session/find").risk,"read");
 const result=await controller.invoke({operation:"session/find",args:[{query:"jednoduchi protokol"}]});
 assert.equal(result.match.id,"pi-real");assert.deepEqual(calls,[{channel:"native-list",args:[]}]);
 await assert.rejects(()=>controller.invoke({operation:"session/find",args:[{query:"",open:true}]}));assert.equal(calls.length,1);
 const noNative=createMcpControlController({channels:{},invoke:async()=>{throw Error("no")}});
 assert.equal(noNative.operations.some(op=>op.id==="session/find"),false);
});

test("authenticated HTTP MCP exposes and executes the named find tool with one inventory read",async(t)=>{
 const directory=await mkdtemp(join(tmpdir(),"jarvis-find-fixture-"));let reads=0;
 const server=new McpControlServer({dataDir:directory,port:0,channels:{sessionList:"native-list"},invoke:async()=>{reads++;return {sessions}}});
 t.after(async()=>{await server.stop();await rm(directory,{recursive:true,force:true})});
 const info=await server.start();let sequence=0,sessionId;
 const rpc=async(method,params)=>{
  const response=await fetch(info.url,{method:"POST",headers:{Authorization:`Bearer ${info.token}`,"Content-Type":"application/json",...(sessionId?{"Mcp-Session-Id":sessionId}:{})},body:JSON.stringify({jsonrpc:"2.0",id:++sequence,method,params})});
  if(response.headers.get("mcp-session-id"))sessionId=response.headers.get("mcp-session-id");
  assert.equal(response.status,200);return (await response.json()).result;
 };
 await rpc("initialize",{protocolVersion:"2025-06-18"});
 const catalog=await rpc("tools/list",{});assert.ok(catalog.tools.some(tool=>tool.name==="pi_session_find"));
 const result=await rpc("tools/call",{name:"pi_session_find",arguments:{query:"jednoduchi protokol"}});
 assert.notEqual(result.isError,true);assert.equal(result.structuredContent.match.id,"pi-real");assert.equal(reads,1);
});
