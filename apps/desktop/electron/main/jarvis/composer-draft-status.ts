import { randomUUID } from "node:crypto";
import type { ComposerDraftCounts, ComposerDraftStatus } from "@pi-desktop/shared";
import type { LiveOwner } from "../live-voice/call-service-internals";
import { ownerKey } from "../live-voice/call-service-internals";

const unavailable = (): ComposerDraftStatus => ({ known: false, empty: false });
const counts = ["cachedDrafts", "liveDrafts", "busyEditors", "unknownEditors"] as const;

/** A fresh, document/owner-bound observation. It grants no restart authority. */
export class ComposerDraftStatusProbe {
  private readonly pending = new Map<string, { owner: LiveOwner; finish: (value: ComposerDraftStatus) => void }>();
  private readonly send: (owner: LiveOwner, request: { requestId: string }) => void;
  private readonly timeoutMs: number;
  constructor(send: (owner: LiveOwner, request: { requestId: string }) => void, timeoutMs = 2_000) {
    this.send = send; this.timeoutMs = timeoutMs;
  }

  invalidate(): void { for (const item of [...this.pending.values()]) item.finish(unavailable()); }

  read(owner: LiveOwner | null): Promise<ComposerDraftStatus> {
    if (!owner || this.pending.size >= 4) return Promise.resolve(unavailable());
    const requestId = randomUUID();
    return new Promise(resolve => {
      const timer = setTimeout(() => finish(unavailable()), this.timeoutMs);
      const finish = (value: ComposerDraftStatus) => {
        if (!this.pending.delete(requestId)) return;
        clearTimeout(timer); resolve(value);
      };
      this.pending.set(requestId, { owner, finish });
      try { this.send(owner, { requestId }); } catch { finish(unavailable()); }
    });
  }

  complete(owner: LiveOwner, raw: unknown): { accepted: boolean } {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { accepted: false };
    const response = raw as Record<string, unknown>;
    if (Object.keys(response).some(key => !["requestId", "pendingPrefill", ...counts].includes(key)) ||
        typeof response.requestId !== "string" || typeof response.pendingPrefill !== "boolean" ||
        counts.some(key => !Number.isSafeInteger(response[key]) || (response[key] as number) < 0 || (response[key] as number) > 1_000_000)) return { accepted: false };
    const pending = this.pending.get(response.requestId);
    if (!pending || ownerKey(owner) !== ownerKey(pending.owner) || owner.url !== pending.owner.url) return { accepted: false };
    const metadata = Object.fromEntries([...counts, "pendingPrefill"].map(key => [key, response[key]])) as ComposerDraftCounts;
    pending.finish({ ...metadata, known: true, empty: counts.every(key => response[key] === 0) && !response.pendingPrefill,
      observedAt: new Date().toISOString() });
    return { accepted: true };
  }
}
