import { useEffect } from "react";
import { useAppStore } from "../stores/app-store";
import { preferencesFromState } from "../stores/helpers/store-helpers";
import { inactiveSessionIds } from "../lib/inactive-session-archive";
import { readComposerDraft } from "../lib/composer-draft-cache";
import { saveSidebarPreferences, sidebarPersistenceReady } from "../lib/sidebar-preferences";
import { getLiveCallController } from "../features/voice/live/live-call-controller";
import { api } from "../lib/api";

/** Reuse the native archive view and its existing durable preferences. */
export function useInactiveChatArchive(): void {
  useEffect(() => {
    let stopped = false, pending = false, lastSweep = 0;
    const sweep = async () => {
      if (stopped || pending || !sidebarPersistenceReady() || Date.now() - lastSweep < 10 * 60 * 60 * 1000) return;
      const live = getLiveCallController().getSnapshot();
      if (live.starting || live.stopping) return;
      pending = true;
      try {
        const inventory = await api.listSessions();
        if (stopped) return;
        const latestLive = getLiveCallController().getSnapshot();
        if (latestLive.starting || latestLive.stopping) return;
        const state = useAppStore.getState();
        const protectedIds = new Set([...(inventory.runningSessionIds ?? []), ...Object.keys(state.runningSessions).filter(id => state.runningSessions[id])]);
        if (state.activeSessionId) protectedIds.add(state.activeSessionId);
        const currentCall = getLiveCallController().getSnapshot().call;
        if (currentCall && currentCall.phase !== "ended" && currentCall.phase !== "failed" && currentCall.workBinding) {
          protectedIds.add(currentCall.workBinding.workSessionId);
        }
        for (const session of state.sessions) {
          const draft = readComposerDraft(session.id);
          if (draft && (draft.text.trim() || draft.fileReferences.length)) protectedIds.add(session.id);
        }
        const ids = new Set(inactiveSessionIds(inventory.sessions, state.sessionMeta, protectedIds));
        if (ids.size) {
          const sessionMeta = { ...state.sessionMeta };
          for (const id of ids) sessionMeta[id] = { ...sessionMeta[id], archived: true };
          useAppStore.setState({ sessionMeta, sessions: state.sessions.map(session => ids.has(session.id) ? { ...session, archived: true } : session) });
          saveSidebarPreferences(preferencesFromState(useAppStore.getState()));
        }
        lastSweep = Date.now();
      } catch { /* Unknown inventory is preserved; a later tick retries. */ }
      finally { pending = false; }
    };
    // A short tick lets native sidebar recovery finish first; full sweeps are
    // limited to once per ten hours, including after sleep/resume.
    const timer = setInterval(() => { void sweep(); }, 60_000);
    const initial = setTimeout(() => { void sweep(); }, 5_000);
    return () => { stopped = true; clearInterval(timer); clearTimeout(initial); };
  }, []);
}
