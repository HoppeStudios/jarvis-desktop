import type {AgentEventEnvelope} from "@pi-desktop/shared";

/** A failed capture must not lose the native question. Only its card waits. */
export function deliverCapturedEvent(envelope: AgentEventEnvelope, input: {
  ingest: (envelope: AgentEventEnvelope)=>void;
  capture?: (envelope: AgentEventEnvelope)=>Promise<void>|undefined;
  deliver: (envelope: AgentEventEnvelope)=>void;
}): Promise<void> | undefined {
  input.ingest(envelope);
  let capture:Promise<void>|undefined;
  try{capture=input.capture?.(envelope);}catch{input.deliver(envelope);return;}
  if(envelope.event.type==="asktool_request" && capture) {
    return capture.then(()=>input.deliver(envelope),()=>input.deliver(envelope));
  }
  input.deliver(envelope);
  void capture?.catch(()=>undefined);
}
