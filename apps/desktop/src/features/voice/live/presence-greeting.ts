import type { LiveGreetingEvidence } from "@pi-desktop/shared";
export type PresenceGreetingResult = { greetingPlayed: boolean; greetingFinishedAt?: number; greetingEvidence: LiveGreetingEvidence };
type State = Omit<LiveGreetingEvidence, "requestSent"> & { connected: boolean; playbackBlocked: boolean };

/** A bounded capability probe: a sent event alone is never successful playback. */
export async function playPresenceGreeting(input: {
  signal: AbortSignal;
  state: () => State;
  send: () => void;
  timeoutMs?: number;
  now?: () => number;
  wait?: () => Promise<void>;
}): Promise<PresenceGreetingResult> {
  const now = input.now ?? Date.now;
  const wait = input.wait ?? (() => new Promise(resolve => setTimeout(resolve, 40)));
  const deadline = now() + (input.timeoutMs ?? 12_000);
  let sent = false;
  const result = (played: boolean): PresenceGreetingResult => {
    const { connected: _connected, playbackBlocked: _blocked, ...evidence } = input.state();
    return { greetingPlayed: played, greetingEvidence: { ...evidence, requestSent: sent },
      ...(played ? { greetingFinishedAt: now() } : {}) };
  };
  while (!input.signal.aborted && now() < deadline) {
    const state = input.state();
    if (!state.connected || state.playbackBlocked) return result(false);
    if (state.providerReady) { input.send(); sent = true; break; }
    await wait();
  }
  while (!input.signal.aborted && now() < deadline) {
    const state = input.state();
    if (!state.connected || state.playbackBlocked) break;
    if (state.transcriptMatches && state.measuredAudio && !state.playbackActive && state.turnComplete) {
      return result(true);
    }
    await wait();
  }
  return result(false);
}
