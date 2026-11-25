import type { SessionCapabilities, SessionSummary } from "@pi-desktop/shared";

export function isRemoteSession(session?: Pick<SessionSummary, "id" | "source"> | null): boolean {
  return session?.source === "remote" || session?.source === "codex" || session?.id?.startsWith("remote:") === true;
}

/** Missing capabilities preserve local behavior, but never grant remote local access. */
export function sessionAllows(
  session: Pick<SessionSummary, "id" | "source" | "capabilities"> | undefined,
  capability: keyof SessionCapabilities,
): boolean {
  if (isRemoteSession(session)) {
    return ["canPrompt", "canStop", "canRefresh", "canReadWorkspace", ...(session?.source === "codex" ? ["canSteer"] : [])].includes(capability)
      && session?.capabilities?.[capability] === true;
  }
  return session?.capabilities?.[capability] !== false;
}

/** A remote path is display data, not an Electron workspace activation target. */
export function safeSessionSummary<T extends SessionSummary>(session: T): T {
  // This source is produced only by the authenticated same-machine Codex adapter.
  // Its validated local workspace may retain the user's existing project grouping.
  if (session.source === "codex") return session;
  if (!isRemoteSession(session)) return session;
  const { projectPath: _localPath, ...safe } = session;
  return { ...safe, source: "remote" } as T;
}
