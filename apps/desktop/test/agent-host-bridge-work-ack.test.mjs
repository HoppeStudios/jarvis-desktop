import assert from "node:assert/strict";
import test from "node:test";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { IPC } from "@pi-desktop/shared";

const here = dirname(fileURLToPath(import.meta.url));

test("AgentHost work controls require explicit structured acknowledgements", async (t) => {
  const server = await createServer({
    root: dirname(here),
    configFile: false,
    server: { middlewareMode: true, hmr: false, ws: false },
    appType: "custom",
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  t.after(() => server.close());
  const { createAgentHostBridge } = await server.ssrLoadModule("/electron/main/agent-host-bridge.ts");
  let response;
  const bridge = createAgentHostBridge({
    channels: IPC.invoke,
    getHost: () => null,
    log: () => undefined,
    async invoke() { return response; },
  });

  const steer = { sessionId: "session-a", expectedTurnId: "turn-1", content: "Add a check", userMessageId: "message-1", voiceOrigin: { callId: "call-1", operationId: "op-1" } };
  response = undefined;
  assert.equal(await bridge.steerWorkSession(steer), false);
  response = {};
  assert.equal(await bridge.steerWorkSession(steer), false);
  response = { accepted: false };
  assert.equal(await bridge.steerWorkSession(steer), false);
  response = { accepted: true };
  assert.equal(await bridge.steerWorkSession(steer), true);

  response = undefined;
  assert.deepEqual(await bridge.stopWorkSession({ sessionId: "session-a", expectedTurnId: "turn-1", urgency: "graceful" }), { status: "stale-target" });
  response = {};
  assert.deepEqual(await bridge.stopWorkSession({ sessionId: "session-a", expectedTurnId: "turn-1", urgency: "graceful" }), { status: "stale-target" });
  response = { requested: true };
  assert.deepEqual(await bridge.stopWorkSession({ sessionId: "session-a", expectedTurnId: "turn-1", urgency: "graceful" }), { status: "requested" });

  response = {};
  assert.deepEqual(await bridge.stopWorkSession({ sessionId: "session-a", expectedTurnId: "turn-1", urgency: "immediate" }), { status: "stale-target" });
  response = { aborted: true };
  assert.deepEqual(await bridge.stopWorkSession({ sessionId: "session-a", expectedTurnId: "turn-1", urgency: "immediate" }), { status: "requested" });
});

test("question receipt callbacks follow actual native success and preserve pending input on refusal",async t=>{
 const server=await createServer({root:dirname(here),configFile:false,server:{middlewareMode:true,hmr:false,ws:false},appType:"custom",optimizeDeps:{noDiscovery:true,include:[]}});
 t.after(()=>server.close());
 const {createAgentHostBridge}=await server.ssrLoadModule("/electron/main/agent-host-bridge.ts");
 const answers=[];let ack={ok:false},calls=0;
 const bridge=createAgentHostBridge({channels:IPC.invoke,getHost:()=>null,log:()=>{},
  invoke:async(channel)=>{assert.equal(channel,IPC.invoke.askToolResolve);calls++;return ack;},
  onInputResolved:(request,resolution)=>answers.push({request,resolution})});
 const sessionId="11111111-2222-4333-8444-555555555555",requestId="question-one";
 const request={sessionId,requestId,toolCallId:"call-one",questions:[{question:"Choose?",options:["A","B"]}]};
 const emit=event=>bridge.ingest({sessionId,turnId:"turn-one",ts:Date.now(),event});
 emit({type:"agent_start"});emit({type:"asktool_request",request});
 assert.equal(bridge.openAsk(sessionId).requestId,requestId);
 await assert.rejects(bridge.resolveAskByRequestId({sessionId,requestId,answers:[["A"]]}));
 assert.equal(answers.length,0);assert.equal(bridge.openAsk(sessionId).requestId,requestId);
 ack={ok:true};await bridge.resolveAskByRequestId({sessionId,requestId,answers:[["A"]]});
 assert.equal(answers.length,1);assert.equal(answers[0].request,request);assert.deepEqual(answers[0].resolution.answers,[["A"]]);assert.equal(bridge.openAsk(sessionId),null);
 assert.equal(await bridge.resolveAskByRequestId({sessionId,requestId,answers:[["A"]]}),null);assert.equal(answers.length,1);assert.equal(calls,2);
 const next={...request,requestId:"question-two"};emit({type:"asktool_request",request:next});
 const open=bridge.openAsk(sessionId);await bridge.resolveOpenAsk({sessionId,inputId:open.inputId,answers:[["B"]]});
 assert.equal(answers.length,2);assert.equal(answers[1].request.requestId,"question-two");assert.equal(bridge.openAsk(sessionId),null);
});
