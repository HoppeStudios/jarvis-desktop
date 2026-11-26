import assert from 'node:assert/strict';
import test from 'node:test';
import {register} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {dirname,join} from 'node:path';
register(pathToFileURL(join(dirname(fileURLToPath(import.meta.url)),'helpers/ts-import-hooks.mjs')));
const {CodexChatBridge}=await import('../electron/main/codex/codex-chat-bridge.ts');
const {createMcpControlController}=await import('../electron/main/mcp-control.ts');
const {IPC}=await import('@pi-desktop/shared');
const threadId='11111111-1111-4111-8111-111111111111';
const sessionId=`remote:codex-shared:${threadId}`;
test('linked steering sends only actual input to the exact live turn',async()=>{
 const bridge=new CodexChatBridge({router:{},emit(){}});const requests=[];
 bridge.ensure=async()=>{};bridge.running.set(threadId,'turn-current');
 bridge.request=async(method,args)=>{requests.push({method,args});return {};};
 for(const expectedTurnId of [undefined,'turn-old'])await assert.rejects(bridge.invoke(IPC.invoke.agentSteer,[{sessionId,expectedTurnId,content:'Vega'}]));
 assert.equal(requests.length,0);
 assert.deepEqual(await bridge.invoke(IPC.invoke.agentSteer,[{sessionId,expectedTurnId:'turn-current',content:'Vega'}]),{accepted:true,turnId:'turn-current'});
 assert.deepEqual(requests,[{method:'turn/steer',args:{threadId,expectedTurnId:'turn-current',input:[{type:'text',text:'Vega'}]}}]);
});
test('MCP exposes guarded steering through the existing IPC handler without expanding approval controls',async()=>{
 const calls=[];const controller=createMcpControlController({channels:{agentSteer:'guarded-steer'},invoke:async(channel,args)=>{calls.push({channel,args});return {accepted:true};}});
 const request={sessionId,expectedTurnId:'turn-current',content:'Vega'};
 assert.deepEqual(controller.operations.map(o=>[o.id,o.risk]),[['agent/steer','write']]);
 await controller.invoke({operation:'agent/steer',args:[request]});
 assert.deepEqual(calls,[{channel:'guarded-steer',args:[request]}]);
});
