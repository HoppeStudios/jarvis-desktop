/** The user-requested seven-day inactivity policy; never deletes session data. */
export const CHAT_INACTIVITY_MS = 7 * 24 * 60 * 60 * 1000;
export function inactiveSessionIds(
  sessions: readonly { id: string; updatedAt: string }[],
  meta: Record<string, { archived?: boolean; restoredAt?: number }>,
  protectedIds: ReadonlySet<string>,
  now = Date.now(),
): string[] {
  return sessions.filter(session => {
    if (meta[session.id]?.archived || protectedIds.has(session.id)) return false;
    const updated = Date.parse(session.updatedAt);
    const restored = meta[session.id]?.restoredAt;
    const activity = Math.max(updated, typeof restored === "number" && Number.isFinite(restored) ? restored : 0);
    return Number.isFinite(activity) && activity > 0 && activity < now - CHAT_INACTIVITY_MS;
  }).map(session => session.id);
}
