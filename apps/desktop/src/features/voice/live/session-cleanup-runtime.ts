import { IPC, type SessionCleanupRequest } from "@pi-desktop/shared";
import { invoke, subscribe } from "./live-voice-api";
import { SessionCleanupReadiness, installSessionCleanupReadiness } from "../../../lib/session-cleanup-readiness";
import { useAppStore } from "../../../stores/app-store";
import { inspectComposerDrafts } from "../../../lib/composer-draft-cache";

/** Lifetime is the real main renderer, not a React view or the floating widget. */
export function installSessionCleanupRuntime(mediaSettled: () => boolean): () => void {
  const readiness = new SessionCleanupReadiness(useAppStore.getState);
  const uninstall = installSessionCleanupReadiness(readiness);
  const unsubscribeState = useAppStore.subscribe(() => readiness.noteState());
  const unsubscribeDraftStatus = subscribe(IPC.event.composerDraftStatusRequest, (request: { requestId: string }) => {
    const pendingPrefill = Boolean(useAppStore.getState().composerPrefill);
    void invoke(IPC.invoke.appComposerDraftStatusResponse, { requestId: request.requestId,
      ...inspectComposerDrafts(), pendingPrefill }).catch(() => console.warn("Composer status acknowledgement unavailable"));
  });
  const unsubscribeRequest = subscribe(IPC.event.sessionCleanupRequest, (request: SessionCleanupRequest) => {
    const response = readiness.receive(request);
    if ((request.phase === "prepare" || request.phase === "commit") && !mediaSettled()) response.ready = false;
    // Refresh only list metadata, never submit or clear the selected composer.
    if (request.phase === "release" && request.deleted && response.ready) {
      void useAppStore.getState().refreshSessions().catch(() => console.warn("Session cleanup list refresh deferred"));
    }
    void invoke(IPC.invoke.sessionCleanupResponse, response).catch(() => console.warn("Session cleanup acknowledgement unavailable"));
  });
  return () => { unsubscribeRequest(); unsubscribeDraftStatus(); unsubscribeState(); uninstall(); };
}
