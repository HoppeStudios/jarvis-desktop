export type PresenceGreetingResult = { greetingPlayed: boolean; greetingFinishedAt?: number };
type State = { connected: boolean; playbackBlocked: boolean; transcriptMatches: boolean;
  measuredAudio: boolean; playbackActive: boolean; turnComplete: boolean };

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
  const initial = input.state();
  if (input.signal.aborted || !initial.connected || initial.playbackBlocked) return { greetingPlayed: false };
  input.send();
  const deadline = now() + (input.timeoutMs ?? 12_000);
  while (!input.signal.aborted && now() < deadline) {
    const state = input.state();
    if (!state.connected || state.playbackBlocked) break;
    if (state.transcriptMatches && state.measuredAudio && !state.playbackActive && state.turnComplete) {
      return { greetingPlayed: true, greetingFinishedAt: now() };
    }
    await wait();
  }
  return { greetingPlayed: false };
}
