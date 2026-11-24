import type { SessionCleanupRequest, SessionCleanupResponse } from "@pi-desktop/shared";
import { hasComposerDraftHistory, hasLiveComposerDraft, readComposerDraft, readComposerDraftRevision } from "./composer-draft-cache";

export type SessionCleanupState = {
  activeSessionId?: string | null;
  selectingSessionId?: string;
  retainedSessionIds: readonly string[];
  composerPrefill: { sessionId: string } | null;
  navStack?: readonly { sessionId?: string }[];
};
let current: SessionCleanupReadiness | null = null;
export function installSessionCleanupReadiness(readiness: SessionCleanupReadiness): () => void {
  current = readiness;
  return () => { if (current === readiness) current = null; };
}
export function noteSessionCleanupUserPresence(id?: string): void {
  current?.noteUserPresence(id);
}
export function admitSessionCleanupSelection(id: string): boolean | Promise<boolean> {
  return current?.admitSelection(id) ?? true;
}

type Observation = { revision: number; touched: boolean };
type Lease = { requestId: string; sessionId: string; committed: boolean;
  settled: Promise<boolean>; release: (deleted: boolean) => void };

/** Renderer-only metadata, never draft text or attachment paths over IPC.
 * A mounted editor is always unsafe, even if its lazy cache is empty.
 */
export class SessionCleanupReadiness {
  private readonly observed = new Map<string, Observation>();
  private readonly deleted = new Set<string>();
  private lease: Lease | null = null;
  private readonly state: () => SessionCleanupState;
  constructor(state: () => SessionCleanupState) { this.state = state; }

  noteUserPresence(id?: string): void {
    for (const [sessionId, observation] of this.observed) {
      if (!id || id === sessionId) observation.touched = true;
    }
  }

  noteState(): void {
    const state = this.state();
    for (const [id, observation] of this.observed) {
      if (state.activeSessionId === id || state.selectingSessionId === id ||
          state.retainedSessionIds.includes(id) || state.composerPrefill?.sessionId === id ||
          state.navStack?.some(entry => entry.sessionId === id)) observation.touched = true;
    }
  }

  private ready(id: string): boolean {
    this.noteState();
    const observation = this.observed.get(id);
    const draft = readComposerDraft(id);
    return Boolean(observation && !observation.touched && !this.deleted.has(id) &&
      observation.revision === readComposerDraftRevision(id) && !hasLiveComposerDraft(id) &&
      (!draft || draft.text === "" && draft.fileReferences.length === 0));
  }

  receive(request: SessionCleanupRequest): SessionCleanupResponse {
    const { requestId, sessionId, phase } = request;
    let ready = false;
    if (phase === "observe") {
      if (this.observed.size >= 64) {
        const oldest = [...this.observed.keys()].find(id => id !== this.lease?.sessionId);
        if (oldest) this.observed.delete(oldest);
      }
      if (!this.observed.has(sessionId) && !this.deleted.has(sessionId) && !hasComposerDraftHistory(sessionId)) {
        this.observed.set(sessionId, { revision: readComposerDraftRevision(sessionId), touched: false });
        ready = this.ready(sessionId);
        if (!ready) this.observed.delete(sessionId);
      }
    } else if (phase === "prepare") {
      if (!this.lease && this.ready(sessionId)) {
        let release!: (deleted: boolean) => void;
        const settled = new Promise<boolean>(resolve => { release = resolve; });
        this.lease = { requestId, sessionId, committed: false, settled, release };
        ready = true;
      }
    } else if (this.lease?.requestId === requestId && this.lease.sessionId === sessionId) {
      if (phase === "commit" && !this.lease.committed && this.ready(sessionId)) {
        // Navigation after this point waits for the already admitted deletion.
        this.lease.committed = true;
        ready = true;
      } else if (phase === "release" && typeof request.deleted === "boolean") {
        const deleted = request.deleted === true;
        if (deleted) {
          this.deleted.add(sessionId);
          if (this.deleted.size > 128) this.deleted.delete(this.deleted.values().next().value!);
        }
        this.lease.release(deleted);
        this.lease = null;
        this.observed.delete(sessionId);
        ready = true;
      }
    }
    return { requestId, sessionId, phase, ready };
  }

  /** Selection before commit cancels cleanup; after commit it is serialized.
   * No editor is mounted and no user input is admitted to a deleting session.
   */
  admitSelection(id: string): boolean | Promise<boolean> {
    const observation = this.observed.get(id);
    if (observation) observation.touched = true;
    const lease = this.lease;
    if (lease?.sessionId === id && lease.committed) return lease.settled.then(deleted => !deleted);
    return !this.deleted.has(id);
  }
}
