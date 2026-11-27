import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
register(new URL("./helpers/ts-import-hooks.mjs", import.meta.url));
const {shouldStartLocalControl}=await import("../electron/main/bootstrap/local-control-opt-in.ts");
const {McpControlServer}=await import("../electron/main/mcp-control.ts");

test("ordinary launch retains the user's persistent Jarvis control opt-in",()=>{
 assert.equal(shouldStartLocalControl(undefined,true),true);
 for(const unset of [undefined,null,false,"true",1,{}])assert.equal(shouldStartLocalControl(undefined,unset),false);
});
test("persisted opt-in starts the real authenticated loopback server without a launch flag",async(t)=>{
 const dataDir=await mkdtemp(join(tmpdir(),"jarvis-opt-in-"));
 const persisted={jarvisEnabled:true};assert.equal(shouldStartLocalControl(undefined,persisted.jarvisEnabled),true);
 const server=new McpControlServer({dataDir,port:0,version:"fixture",channels:{appGetVersion:"fixture/version"},invoke:async()=>({version:"fixture"})});
 t.after(()=>server.stop());const info=await server.start();
 assert.match(info.url,/^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
 const before=JSON.parse(await readFile(join(dataDir,"mcp-control.json"),"utf8"));assert.equal(before.active,true);
 const body={jsonrpc:"2.0",id:1,method:"initialize",params:{protocolVersion:"2025-03-26",capabilities:{},clientInfo:{name:"fixture",version:"1"}}};
 const denied=await fetch(info.url,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
 assert.equal(denied.status,401);
 const accepted=await fetch(info.url,{method:"POST",headers:{Authorization:`Bearer ${info.token}`,"Content-Type":"application/json","Accept":"application/json, text/event-stream"},body:JSON.stringify(body)});
 assert.equal(accepted.status,200);assert.equal((await accepted.json()).result.serverInfo.name,"pi-desktop");
 await server.stop();assert.equal(JSON.parse(await readFile(join(dataDir,"mcp-control.json"),"utf8")).active,false);
});
test("explicit launch opt-out and other invalid flags stay closed; opt-in retains non-Jarvis use",()=>{
 for(const flag of ["0","false","","yes"])assert.equal(shouldStartLocalControl(flag,true),false);
 assert.equal(shouldStartLocalControl("1",false),true);
 assert.equal(shouldStartLocalControl("1",undefined),true);
});
