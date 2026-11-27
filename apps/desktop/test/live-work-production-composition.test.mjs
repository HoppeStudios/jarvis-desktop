import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { IPC } from "@pi-desktop/shared";
import { codexDelegationFeedback, codexWorkFeedbackMessage, parseCodexMessage } from "@pi-desktop/voice-runtime/live";
import { createProductionWorkHarness, settleUntil, WORK_INSTRUCTION, WORK_RESULT, WORK_SESSION_ID } from "./helpers/live-work-production.mjs";

const callId = "live-work-production-call";

test("a clear ordinal resolves the bound native ask once and delivery refusal never becomes acceptance", async t => {
  const server=await createServer({root:fileURLToPath(new URL('..',import.meta.url)),configFile:false,resolve:{alias:{'@pi-desktop/host-runtime':fileURLToPath(new URL('../../../packages/host-runtime/src/index.ts',import.meta.url))}},server:{middlewareMode:true,hmr:false,ws:false},appType:'custom',optimizeDeps:{noDiscovery:true,include:[]}});
  t.after(()=>server.close());
  const {createLiveWorkBridge}=await server.ssrLoadModule('/electron/main/live-voice/work-bridge.ts');
  const updates=[],resolved=[];let refuse=false;
  const backend={agentHost:{workSnapshot:async()=>({sessionId:'worker',mode:'agent',state:'waiting-input',activeTurnId:'worker-turn',queue:[]})},
    openAsk:()=>({inputId:'actual-input',turnId:'worker-turn',questions:[{question:'Which content?',options:['Přepis mého povelu','Dosavadní historie chatu']}]}),
    onSessionEvent:()=>()=>{},observeWorkTarget:()=> 'worker-turn',
    resolveOpenAsk:async request=>{if(refuse)throw new Error('native resolution refused');resolved.push(request);}};
  const bridge=createLiveWorkBridge({getHost:()=>({call:async method=>method==='session.list'?{sessions:[{id:'worker',source:'desktop',mode:'agent'}]}:{}}),getAgentHostBridge:()=>backend,vendorOAuth:{},navigateSession:async()=>{},resolveCompletionProvider:async()=>{throw new Error('an explicit single-question ordinal needs no model round trip');},onOperation:(_call,update)=>updates.push(update)});
  t.after(()=>bridge.closeCall('ordinal-call'));
  bridge.openCall({callId:'ordinal-call',workSessionId:'worker',workBindingRevision:1,label:'worker',sessionSource:'desktop',contextEnabled:false},null);
  const receive=id=>bridge.receiveCandidate({callId:'ordinal-call',workSessionId:'worker',workBindingRevision:1,providerRequestId:id,instruction:'beru první možnost'},async()=>({status:'sent',deliveryId:id}));
  await receive('ordinal-1');
  assert.deepEqual(resolved,[{sessionId:'worker',inputId:'actual-input',answers:[['Přepis mého povelu']]}]);
  assert.equal(updates.at(-1).operation.admission,'accepted');
  refuse=true;await receive('ordinal-2');
  assert.equal(resolved.length,1);
  assert.equal(updates.at(-1).operation.admission,'rejected');
  assert.match(updates.at(-1).operation.summary,/could not be delivered/);
});

test("spoken chat creation reaches the existing AgentHost with its full workspace request", async (t) => {
  const server = await createServer({
    root: fileURLToPath(new URL("..", import.meta.url)), configFile: false,
    resolve: { alias: { "@pi-desktop/host-runtime": fileURLToPath(new URL("../../../packages/host-runtime/src/index.ts", import.meta.url)) } },
    server: { middlewareMode: true, hmr: false, ws: false }, appType: "custom", optimizeDeps: { noDiscovery: true, include: [] },
  });
  t.after(() => server.close());
  const fixture = await createProductionWorkHarness(t, server, { intent: { kind: "create-session", title: "Výzkum" } });
  fixture.openCall("create-call");
  const request = { callId: "create-call", workBindingRevision: 3, workSessionId: WORK_SESSION_ID,
    providerRequestId: "create-request", instruction: "Vytvoř nový chat Výzkum ve workspace Omega. Nezapínej další hovor." };
  const receipt = async () => ({ status: "sent", deliveryId: "create-receipt" });
  await fixture.bridge.receiveCandidate(request, receipt);
  await fixture.bridge.receiveCandidate(request, receipt);
  assert.equal(fixture.prompts.length, 1);
  assert.equal(fixture.prompts[0].content, request.instruction);
  assert.equal(fixture.persistedMessages[0].content, request.instruction);
  assert.equal(fixture.updates.at(-1).operation.workSessionId, WORK_SESSION_ID);
  assert.equal(fixture.updates.at(-1).operation.execution, "running");
  assert.equal(fixture.updates.at(-1).operation.selections, undefined);
});

test("production Live WorkBridge reaches AgentHost admission, explicit queue, and exact terminal result", async (t) => {
  const server = await createServer({
    root: fileURLToPath(new URL("..", import.meta.url)),
    configFile: false,
    resolve: { alias: { "@pi-desktop/host-runtime": fileURLToPath(new URL("../../../packages/host-runtime/src/index.ts", import.meta.url)) } },
    server: { middlewareMode: true, hmr: false, ws: false },
    appType: "custom",
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  t.after(() => server.close());
  const fixture = await createProductionWorkHarness(t, server, { progressBeforeFinal: true });
  const { bridge, agentHostBridge, prompts, persistedMessages, updates, invocationLog } = fixture;
  fixture.openCall(callId);

  async function receive(id, instruction, deliverReceipt = async () => ({ status: "sent", deliveryId: id })) {
    const [event] = parseCodexMessage({
      type: "delegation.created",
      item: { type: "delegation", target: "client", id, content: [{ type: "input_text", text: instruction }] },
    });
    assert.equal(event.kind, "delegation");
    await bridge.receiveCandidate({
      callId, workBindingRevision: 3, workSessionId: WORK_SESSION_ID,
      providerRequestId: event.delegationId, instruction: event.instruction,
    }, deliverReceipt);
  }
  const receiptWire = [];
  await receive("codex-production-request-1", WORK_INSTRUCTION, async (receipt) => {
    receiptWire.push(codexDelegationFeedback("codex-production-request-1", {
      operationId: receipt.operationId, status: "received",
    }));
    return { status: "sent", deliveryId: "codex-receipt-1" };
  });
  assert.equal(prompts.length, 1, "ordinary idle submit reaches the real AgentHost runtime port exactly once");
  assert.equal(prompts[0].content, WORK_INSTRUCTION);
  assert.equal(prompts[0].voiceOrigin.callId, callId);
  assert.equal(typeof prompts[0].messageId, "string");
  assert.equal(persistedMessages[0].id, prompts[0].messageId);
  assert.equal(persistedMessages[0].content, WORK_INSTRUCTION);
  assert.deepEqual(persistedMessages[0].voiceOrigin, prompts[0].voiceOrigin);
  assert.equal(receiptWire.length, 1);
  assert.equal(JSON.parse(receiptWire[0]).type, "delegation.context.append");
  assert.equal(updates.at(-1).operation.execution, "running");

  await receive("codex-production-request-busy", "Add logging to the login flow.");
  assert.equal(prompts.length, 1, "an ordinary submit never silently falls back to Host queue when busy");
  assert.equal(updates.at(-1).operation.admission, "rejected");

  await receive("codex-production-request-queue", "Queue this as an independent follow-up.");
  const queued = agentHostBridge.agentHost.queueEntries(WORK_SESSION_ID);
  assert.equal(queued.length, 1, "explicit independent work is admitted through AgentHost queue");
  assert.equal(queued[0].content, "Queue this as an independent follow-up.");
  assert.equal(queued[0].userMessageId, updates.at(-1).operation.userMessageId);
  assert.equal(queued[0].voiceOrigin.callId, callId);

  fixture.endTurn();
  await settleUntil(() => fixture.results.size === 1 && prompts.length === 2, "terminal result and queued work arrive");
  const terminal = [...fixture.results.values()][0];
  assert.equal(terminal.execution, "completed");
  assert.equal(terminal.resultState, "available");
  assert.equal(terminal.resultSummary, WORK_RESULT);
  assert.ok(fixture.historyReadsAfterTerminal >= 2, "progress-only history is retried until the final answer persists");
  assert.equal(updates.some((update) => update.operation.resultSummary === "I will inspect the login flow."), false);
  assert.equal(prompts[1].voiceOrigin.callId, callId);
  assert.equal(agentHostBridge.agentHost.queueEntries(WORK_SESSION_ID).length, 0);
  const resultWire = codexWorkFeedbackMessage("codex-production-request-1", {
    feedbackId: "codex-production-result-1", callId, workBindingRevision: 3,
    operationId: terminal.operationId, kind: "result", delivery: "speak-when-idle", content: terminal.resultSummary,
  });
  assert.match(JSON.parse(resultWire).content[0].text, /The login flow correctly rejects expired credentials/u);
  assert.equal(invocationLog.filter((item) => item.channel === IPC.invoke.agentPrompt).length, 2);
});

test('queue replies keep the real question identity in classifier context and the actual worker prompt',async(t)=>{
 const server=await createServer({root:fileURLToPath(new URL('..',import.meta.url)),configFile:false,resolve:{alias:{'@pi-desktop/host-runtime':fileURLToPath(new URL('../../../packages/host-runtime/src/index.ts',import.meta.url))}},server:{middlewareMode:true,hmr:false,ws:false},appType:'custom',optimizeDeps:{noDiscovery:true,include:[]}});
 t.after(()=>server.close());let classified;
 const fixture=await createProductionWorkHarness(t,server,{onClassifierInput:context=>classified=context});
 fixture.openCall('queue-call');
 const item={id:'fixture-queue-item',revision:2,kind:'question',origin:{kind:'codex',threadId:'source-chat',hostId:'local'},question:{id:'0',text:'Which label?',options:['Orion','Vega']}};
 await fixture.bridge.receiveCandidate({callId:'queue-call',workBindingRevision:3,workSessionId:WORK_SESSION_ID,providerRequestId:'actual-reply',instruction:'Orion',queueContext:JSON.stringify(item)},async()=>({status:'sent',deliveryId:'queue-receipt'}));
 assert.deepEqual(JSON.parse(classified.messages[0].content).queuedItem,item);
 assert.match(classified.systemPrompt,/Never use respond-input for an external queued item/);
 assert.equal(fixture.prompts.length,1);
 assert.match(fixture.prompts[0].content,/"Orion"/);
 assert.match(fixture.prompts[0].content,/fixture-queue-item/);
 assert.match(fixture.prompts[0].content,/source-chat/);
 assert.match(fixture.prompts[0].content,/read the current revision/);
});
