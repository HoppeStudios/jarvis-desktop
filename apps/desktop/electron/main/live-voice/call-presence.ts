import type { Slot } from "./call-service-internals";

/** Presence survives a short speech event and later idle status polls. */
export function noteUserSpeech(slot: Slot, now: number): void {
  slot.lastUserSpeechAt = now;
}
export function noteUserTurn(slot: Slot, itemId: string, now: number): void {
  const ids = slot.userTurnIds ??= new Set();
  if (ids.has(itemId)) return;
  ids.add(itemId);
  if (ids.size > 200) ids.delete(ids.values().next().value!);
  slot.lastUserTurnAt = now;
  slot.userTurnCount = (slot.userTurnCount ?? 0) + 1;
}
