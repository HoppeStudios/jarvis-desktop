import type {AgentEventEnvelope, AskToolRequest, AskToolResolution} from "@pi-desktop/shared";

type QueueItem = {
  id: string; revision: number; state: string; origin?: {kind: string; sessionId?: string};
  sourceRequestId?: string;
  questions: Array<{id: string; question: string; options: string[]; answered: boolean}>;
};
type Dependencies = {
  enabled: (sessionId: string) => Promise<boolean>;
  call: (tool: string, args: Record<string, unknown>, scope: string) => Promise<unknown>;
  failure: (metadata: {sessionId: string; operation: string}) => void;
};
const SESSION = /^(?:import-pi-)?[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const ITEM=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const origin = (sessionId: string) => ({kind: "pi-desktop", sessionId});
const scoped = (sessionId: string, key: string) => `jarvis-capture:${sessionId}:${key}`;

export function inboxResult(raw: unknown): Record<string, any> {
  const result=raw as Record<string, any> | null;
  if(!result || result.isError === true) throw new Error("Jarvis Inbox rejected capture");
  if(result.structuredContent && typeof result.structuredContent === "object") return result.structuredContent;
  if(Array.isArray(result.content)) {
    const text=result.content.find((v: any)=>v?.type==="text" && typeof v.text==="string")?.text;
    if(typeof text!=="string") throw new Error("Jarvis Inbox returned no result");
    const parsed=JSON.parse(text);
    if(!parsed || typeof parsed!=="object" || Array.isArray(parsed)) throw new Error("Invalid Inbox result");
    return parsed;
  }
  return result;
}

export function nativeQuestions(request: AskToolRequest): Array<{id: string; question: string; options: string[]}> {
  if(!SESSION.test(request.sessionId) || !request.requestId?.trim() || request.requestId.length>200 ||
    !Array.isArray(request.questions) || request.questions.length<1 || request.questions.length>10) throw new Error("Invalid native question identity");
  return request.questions.map((q,index)=>{
    if(typeof q.question!=="string" || !q.question.trim() || q.question.length>2500 || !Array.isArray(q.options) || q.options.length>10) throw new Error("Native question exceeds the queue contract");
    const options=q.options.map(option=>{
      const label=typeof option==="string" ? option : option.label;
      if(typeof label!=="string" || label.length>400) throw new Error("Invalid native option");
      return label;
    });
    return {id:String(index),question:q.question.trim(),options};
  });
}

export function finalReplyExcerpt(text: string): string {
  const clean=text.trim();
  if(clean.length<=2500) return clean;
  // Preserve both the outcome at the front and limitations at the end. This is
  // explicitly an excerpt of the agent's own reply, never another model summary.
  return "Final reply excerpt:\n"+clean.slice(0,1550)+"\n[... abridged; open the source chat for the full reply ...]\n"+clean.slice(-800);
}

/** Observes actual managed events; never imports history or supplies human input. */
export class JarvisInboxProducer {
  private turns=new Map<string,{lastReply?: string}>();
  private chains=new Map<string,Promise<void>>();
  private completedOperations=0;
  private failures=0;
  private readonly deps: Dependencies;
  constructor(deps: Dependencies) {this.deps=deps;}

  status() {return {pending:this.chains.size,completedOperations:this.completedOperations,failures:this.failures};}
  async drain() {await Promise.all([...this.chains.values()]);}

  observe(envelope: AgentEventEnvelope): Promise<void> | undefined {
    if(!SESSION.test(envelope.sessionId) || !envelope.turnId || envelope.turnId.length>190) return;
    const event=envelope.event, key=`${envelope.sessionId}:${envelope.turnId}`;
    // Nested ask requests still belong to their verified real chat. Delegate
    // lifecycle/text must not close or overwrite its parent's final report.
    if(event.type==="asktool_request") {
      if(event.request.sessionId!==envelope.sessionId) return;
      return this.captureQuestion(event.request);
    }
    if(envelope.parentToolCallId) return;
    if(event.type==="agent_start") {
      if(this.turns.size>=256) this.turns.delete(this.turns.keys().next().value!);
      this.turns.set(key,{});return;
    }
    const turn=this.turns.get(key);
    if(!turn) return; // No historical/replayed completion without a live start.
    if(event.type==="message_end" && event.message.role==="assistant" &&
      event.message.status==="complete" && !event.message.parentToolCallId && event.message.content.trim()) {
      turn.lastReply=finalReplyExcerpt(event.message.content);return;
    }
    if(event.type!=="agent_end" && event.type!=="error") return;
    this.turns.delete(key);
    const code=event.type==="error" && /^[A-Z0-9_.-]{1,80}$/i.test(event.error.code) ? event.error.code : "UNKNOWN";
    const text=event.type==="error"
      ? `The source turn stopped with error ${code}. Open its chat for details; task completion is unverified.`
      : turn.lastReply;
    if(!text || /^\s*<heartbeat>[\s\S]*<decision>\s*DONT_NOTIFY\s*<\/decision>/.test(text)) return;
    return this.run(envelope.sessionId,`turn:${envelope.turnId}`,"queue_update",async()=>{
      const receipt=inboxResult(await this.deps.call("queue_update",{origin:origin(envelope.sessionId),kind:"turn_finished",sourceKey:`turn:${envelope.turnId}`,text},scoped(envelope.sessionId,envelope.turnId!)));
      if(!ITEM.test(receipt.id??""))throw new Error("Missing durable queue receipt");
    });
  }

  captureQuestion(request: AskToolRequest): Promise<void> {
    return this.run(request.sessionId,`ask:${request.requestId}`,"queue_question",async()=>{
      const questions=nativeQuestions(request);
      const receipt=inboxResult(await this.deps.call("queue_question",{origin:origin(request.sessionId),callId:request.requestId,questions},scoped(request.sessionId,request.requestId)));
      if(!ITEM.test(receipt.id??""))throw new Error("Missing durable queue receipt");
    });
  }

  recordNativeAnswer(request: AskToolRequest,resolution: AskToolResolution): Promise<void> {
    return this.run(request.sessionId,`ask:${request.requestId}`,"record_answer",async()=>{
      if(resolution.sessionId!==request.sessionId || resolution.requestId!==request.requestId || resolution.answers.length!==request.questions.length) throw new Error("Native answer identity mismatch");
      const expected=nativeQuestions(request);
      const response=inboxResult(await this.deps.call("find_source_item",{origin:origin(request.sessionId),callId:request.requestId},scoped(request.sessionId,request.requestId)));
      const item=response.item as QueueItem | null;
      if(!item || item.state!=="pending") return;
      if(item.origin?.kind!=="pi-desktop" || item.origin.sessionId!==request.sessionId || item.sourceRequestId!==request.requestId ||
        item.questions.length!==expected.length || item.questions.some((q,i)=>q.question!==expected[i].question || JSON.stringify(q.options)!==JSON.stringify(expected[i].options))) throw new Error("Queued question changed; keep concurrent edits");
      const answered=item.questions.flatMap((q,i)=>{
        const reply=resolution.answers[i];
        // Null can also be cancellation: never turn silence/abort into a reply.
        return !q.answered && Array.isArray(reply) && reply.length && reply.every(s=>typeof s==="string" && s.trim()) ? [{id:q.id,answer:reply}] : [];
      });
      if(!answered.length) return;
      const saved=inboxResult(await this.deps.call("record_answer",{id:item.id,origin:origin(request.sessionId),expectedRevision:item.revision,
        questionIds:answered.map(q=>q.id),answer:JSON.stringify(answered),receipt:`pi-desktop:ask:${request.requestId}`},scoped(request.sessionId,request.requestId)));
      if(saved.id!==item.id || !Array.isArray(saved.questions) || answered.some(q=>!saved.questions.some((entry:any)=>entry.id===q.id&&entry.answered===true)))throw new Error("Missing answer recording receipt");
    });
  }

  private run(sessionId: string,key: string,operation: string,body: ()=>Promise<void>): Promise<void> {
    if(!SESSION.test(sessionId)) return Promise.resolve();
    const identity=`${sessionId}:${key}`;
    const previous=this.chains.get(identity)??Promise.resolve();
    const pending=previous.then(async()=>{
      if(!await this.deps.enabled(sessionId)) return;
      await body();this.completedOperations++;
    }).catch(()=>{this.failures++;try{this.deps.failure({sessionId,operation});}catch{/* Diagnostics must not break native delivery. */}});
    this.chains.set(identity,pending);
    void pending.finally(()=>{if(this.chains.get(identity)===pending)this.chains.delete(identity);});
    return pending;
  }
}
