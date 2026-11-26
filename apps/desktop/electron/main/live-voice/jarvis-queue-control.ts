import { randomUUID } from 'node:crypto';
import type { LiveControlEvent } from '@pi-desktop/shared';
import type { LiveOwner, Slot } from './call-service-internals';

/** One native context append after a genuine user turn; never a supplied answer. */
export function dispatchJarvisQueueContext(slot: Slot, deps: {
  current: () => Slot | null;
  send: (owner: LiveOwner, event: LiveControlEvent) => void;
  publish: (slot: Slot) => void;
}): void {
  const context=slot.jarvisQueueContext;
  if (!context || slot.jarvisQueueDispatched || !slot.userTurnCount || slot.phase !== 'connected' ||
      slot.binding?.adapterId !== 'codex-live' || slot.abort.signal.aborted || deps.current() !== slot) return;
  slot.jarvisQueueDispatched=true;
  const actionId=randomUUID();
  const complete=(status:'sent'|'not-sent'|'unknown')=>{
    if(deps.current()!==slot || slot.abort.signal.aborted)return;
    context.delivery=status;deps.publish(slot);
  };
  const timer=setTimeout(()=>{
    if(slot.pendingControls.delete(actionId))complete('unknown');
  },5000);
  slot.pendingControls.set(actionId,{timer,kind:'session-context',resolve:result=>complete(result.status)});
  try { deps.send(slot.owner,{callId:slot.callId,kind:'session-context',actionId,content:context.content}); }
  catch { clearTimeout(timer);slot.pendingControls.delete(actionId);complete('not-sent'); }
}
