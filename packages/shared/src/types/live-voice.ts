/** Public, secret-free contracts for the app-owned real-time voice feature. */
export type SessionCleanupRequest = {
  requestId: string;
  sessionId: string;
  phase: "observe" | "prepare" | "commit" | "release";
  deleted?: boolean;
};
export type SessionCleanupResponse = Pick<SessionCleanupRequest, "requestId" | "sessionId" | "phase"> & { ready: boolean };
import type { SessionSource } from "./sessions.js";
export type LiveGreetingEvidence = {
  providerReady: boolean; requestSent: boolean; transcriptReceived: boolean;
  transcriptMatches: boolean; measuredAudio: boolean; playbackActive: boolean;
  turnComplete: boolean; contextState: "running" | "suspended" | "closed" | "interrupted" | "unavailable";
};

/** Authenticated local control; media still belongs to the real main renderer. */
export type LiveCallInput = { kind: "virtual-cable"; label: string };
export type LiveAutomationControl = {
  requestId: string;
  action: "start" | "toggle" | "wake" | "new-chat" | "end";
  /** Ordered desired-state commands from one persistent wake listener. */
  intentId?: string;
  intentSequence?: number;
  workSessionId?: string;
  /** Main reads this completed native turn; callers cannot supply speech text. */
  resultSource?: { sessionId: string; turnId: string };
  /** Create an independent coordinator; never reuse the selected draft. */
  freshCoordinator?: boolean;
  initialMuted?: boolean;
  /** Fixed presence invitation after a verified connection; never arbitrary speech. */
  presenceGreeting?: boolean;
  /** Automatic invitation deadline, 5–60 seconds after verified playback receipt. */
  presenceTimeoutSeconds?: number;
  expectedCallId?: string;
  /** Cancel only the start request belonging to this same intent owner. */
  expectedRequestId?: string;
  /** Call-local capture selection; never changes the saved default. */
  input?: LiveCallInput;
  /** Timeout of a verified automatic invitation, not manual End. */
  cleanupUnanswered?: boolean;
};
export type LiveAutomationRequest = {
  requestId: string;
  input?: LiveCallInput;
  action: "start" | "cancel";
  workSessionId?: string;
  initialMuted?: boolean;
  presenceGreeting?: boolean;
  /** Bounded, verified result data supplied only by Main. */
  resultBriefing?: string;
};
export type LiveAutomationResponse = {
  requestId: string;
  callId?: string;
  cancelled?: boolean;
  errorCode?: string;
  greetingPlayed?: boolean;
  greetingFinishedAt?: number;
  greetingEvidence?: LiveGreetingEvidence;
  resultBriefingPlayed?: boolean;
  resultBriefingFinishedAt?: number;
  resultBriefingEvidence?: LiveGreetingEvidence;
};
export type LiveAutomationResult = {
  requestId: string;
  state: "connected" | "ended" | "cancelled" | "already-ended" | "already-on" | "superseded";
  callId?: string;
  muted?: boolean;
  playbackBlocked?: boolean;
  coordinatorSessionId?: string;
  coordinatorCleanup?: "deleted" | "deferred";
  /** Positive timeout-retry evidence, never a generic refusal or emptiness proof. */
  invitationDeadlinePending?: true;
  greetingPlayed?: boolean;
  greetingFinishedAt?: number;
  greetingEvidence?: LiveGreetingEvidence;
  resultBriefingPlayed?: boolean;
  resultBriefingFinishedAt?: number;
  resultBriefingEvidence?: LiveGreetingEvidence;
};

export const LIVE_ADAPTER_IDS = [
  "codex-live",
  "gemini-live",
  "openai-realtime",
] as const;

export type LiveAdapterId = (typeof LIVE_ADAPTER_IDS)[number];
export type LiveRealtimeWireProfile = "realtime-ga" | "realtime-compat-v1";

/** Main-owned, call-scoped work target. It carries no authority by itself. */
export type LiveWorkBinding = {
  workSessionId: string;
  workBindingRevision: number;
  label: string;
  sessionSource?: SessionSource;
  contextEnabled: boolean;
};

export type LiveWorkSelectionOption = {
  selectionRef: string;
  kind: "project" | "session";
  action: "none" | "open" | "select" | "create";
  sessionSource?: SessionSource;
  label: string;
  duplicateLabel?: boolean;
};

export type LiveWorkFeedback = {
  feedbackId: string;
  callId: string;
  workBindingRevision: number;
  operationId?: string;
  kind: "receipt" | "admission" | "clarification" | "status" | "result" | "interaction-required";
  delivery: "context-only" | "speak-when-idle";
  content: string;
};

export type LiveBinding =
  | {
      id: string;
      adapterId: "codex-live";
      providerId: string;
      voice: string;
    }
  | {
      id: string;
      adapterId: "gemini-live";
      providerId: string;
      modelId: string;
      voice: string;
    }
  | {
      id: string;
      adapterId: "openai-realtime";
      providerId: string;
      modelId: string;
      voice: string;
      wireProfile: LiveRealtimeWireProfile;
    };

export type LiveVoiceSettings = {
  enabled: boolean;
  selectedBindingId?: string;
  bindings: LiveBinding[];
};

export function validateLiveVoiceSettings(value: unknown): LiveVoiceSettings {
  const invalid = (): never => {
    throw Object.assign(new Error("liveVoice settings are invalid"), {
      errorCode: "INVALID_PARAMS",
    });
  };
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some((key) => !["enabled", "selectedBindingId", "bindings"].includes(key))) return invalid();
  if (typeof input.enabled !== "boolean" || !Array.isArray(input.bindings) || input.bindings.length > 12) return invalid();

  const cleanId = (item: unknown, maxLength = 256): string => {
    if (typeof item !== "string" || !item.trim() || item.trim() !== item || item.length > maxLength) return invalid();
    return item;
  };
  const allowedKeys: Record<string, string[]> = {
    "codex-live": ["id", "adapterId", "providerId", "voice"],
    "gemini-live": ["id", "adapterId", "providerId", "modelId", "voice"],
    "openai-realtime": ["id", "adapterId", "providerId", "modelId", "voice", "wireProfile"],
  };
  const bindings: LiveBinding[] = input.bindings.map((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return invalid();
    const item = raw as Record<string, unknown>;
    if (typeof item.adapterId !== "string" || !Object.hasOwn(allowedKeys, item.adapterId)) return invalid();
    if (Object.keys(item).some((key) => !allowedKeys[item.adapterId as string].includes(key))) return invalid();
    const id = cleanId(item.id);
    const providerId = cleanId(item.providerId);
    const voice = cleanId(item.voice, 64);
    if (item.adapterId === "codex-live") return { id, adapterId: "codex-live", providerId, voice };
    const modelId = cleanId(item.modelId);
    if (item.adapterId === "gemini-live") return { id, adapterId: "gemini-live", providerId, modelId, voice };
    if (item.wireProfile !== "realtime-ga" && item.wireProfile !== "realtime-compat-v1") return invalid();
    return { id, adapterId: "openai-realtime", providerId, modelId, voice, wireProfile: item.wireProfile };
  });
  const ids = new Set<string>();
  for (const binding of bindings) {
    if (ids.has(binding.id)) return invalid();
    ids.add(binding.id);
  }
  let selectedBindingId: string | undefined;
  if (input.selectedBindingId !== undefined) {
    selectedBindingId = cleanId(input.selectedBindingId);
    if (!ids.has(selectedBindingId)) return invalid();
  }
  return {
    enabled: input.enabled,
    ...(selectedBindingId ? { selectedBindingId } : {}),
    bindings,
  };
}

export type LivePhase =
  | "idle"
  | "preparing"
  | "acquiring-mic"
  | "negotiating"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "closing"
  | "ended"
  | "failed";

export type LiveEndReason =
  | "user-ended"
  | "user-cancelled-start"
  | "window-hidden"
  | "window-navigated"
  | "renderer-gone"
  | "app-suspended"
  | "app-quit"
  | "provider-invalidated"
  | "disabled"
  | "timeout"
  | "network-error"
  | "protocol-error"
  | "audio-backpressure"
  | "media-release-unconfirmed";

export type LiveError = {
  code: string;
  stage?: string;
  retriable: boolean;
};

export type LiveTranscriptSegment = {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  final: boolean;
  timestamp: number;
};

export type LiveCallView = {
  callId: string;
  revision: number;
  bindingId: string;
  adapterId: LiveAdapterId;
  phase: LivePhase;
  muted: boolean;
  /** Sticky call-local presence markers; mouse activity never updates these. */
  lastUserSpeechAt?: number;
  lastUserTurnAt?: number;
  userTurnCount?: number;
  microphoneActive: boolean;
  userSpeaking: boolean;
  assistantSpeaking: boolean;
  connectedAt?: string;
  playbackBlocked?: boolean;
  mediaRelease?: "pending" | "confirmed" | "unconfirmed";
  error?: LiveError;
  notice?: LiveError;
  workBinding?: LiveWorkBinding;
  workOperations?: LiveWorkOperationView[];
  jarvisQueue?: { state: "ready" | "unavailable"; delivery: "pending" | "sent" | "not-sent" | "unknown" };
};

export type LiveWorkStopOperationResult = {
  status: "requested" | "already-terminal" | "stale-target" | "unsupported" | "unknown";
  message?: string;
};

export type LiveWorkCancelQueuedOperationResult = {
  status: "canceled" | "already-delivered" | "not-found" | "unsupported" | "unknown" | "stale-target";
};

export type LiveWorkOperationControlRequest = { callId: string; operationId: string };

export type LiveWorkOperationView = {
  operationId: string;
  workSessionId?: string;
  workSessionLabel?: string;
  sessionSource?: SessionSource;
  admission: "received" | "reviewing" | "dispatching" | "accepted" | "rejected" | "unknown" | "withdrawn";
  execution: "not-started" | "queued" | "running" | "waiting-permission" | "waiting-input" | "unknown" | "completed" | "failed" | "interrupted" | "canceled";
  failureCode?: "classifier-invalid" | "classifier-timeout" | "caller-withdrawn" | "receipt-undelivered" | "scope-changed" | "host-rejected" | "dispatch-unknown";
  summary?: string;
  resultSummary?: string;
  resultState?: "pending" | "available" | "unavailable";
  turnId?: string;
  targetTurnId?: string;
  queueEntryId?: string;
  selections?: LiveWorkSelectionOption[];
  feedbackStatus?: "pending" | "sent" | "context-only" | "undelivered";
};

export type LiveBindingReadiness = {
  bindingId: string;
  adapterId: LiveAdapterId;
  configured: boolean;
  credentialsPresent: boolean;
  selectable: boolean;
  reason?:
    | "disabled"
    | "missing-provider"
    | "missing-credentials"
    | "wrong-auth-kind"
    | "unsupported-adapter"
    | "invalid-settings";
  providerLabel?: string;
};

export type LiveStatus = {
  enabled: boolean;
  settingsRevision: number;
  selectedBindingId?: string;
  bindings: LiveBindingReadiness[];
  call: LiveCallView | null;
};

export type LivePrepareRequest = {
  requestId: string;
  bindingId: string;
  expectedSettingsRevision: number;
  initialMuted: boolean;
  /** Current Composer session, when present; Main revalidates it against the live catalog. */
  workTarget?: { workSessionId: string };
  /** Independent, call-scoped consent to share bounded text from the current work session. */
  shareSelectedSessionContext?: boolean;
  /** Result data cannot authorize work before an actual human transcript. */
  awaitHumanBeforeWork?: boolean;
};

export type LivePreparedCall = {
  callId: string;
  requestId: string;
  bindingId: string;
  adapterId: LiveAdapterId;
  inputSampleRate: 16000 | 24000;
  outputSampleRate: 24000;
  initialMuted: boolean;
  revision: number;
} & (
  | { mediaKind: "webrtc" }
  | { mediaKind: "pcm"; portNonce: string }
);

export type LiveConnectRequest = {
  callId: string;
  /** Present only for the Codex WebRTC adapter. */
  offerSdp?: string;
};

export type LiveConnectResult = {
  answerSdp?: string;
  revision: number;
};

export type LiveMediaReport =
  | { callId: string; kind: "microphone-active"; active: boolean }
  | { callId: string; kind: "phase"; phase: "connecting" | "connected" }
  | { callId: string; kind: "activity"; userSpeaking?: boolean; assistantSpeaking?: boolean }
  | { callId: string; kind: "playback-activity"; active: boolean; ready: boolean }
  | { callId: string; kind: "playback-blocked"; blocked: boolean }
  | { callId: string; kind: "released" };

export type LiveEndRequest =
  | { callId: string; reason: LiveEndReason; errorCode?: string }
  | { requestId: string; reason: "user-cancelled-start" };

export type LiveDelegationRequest = {
  callId: string;
  delegationId: string;
  instruction: string;
};

export type LiveProviderReceipt =
  | { status: "received"; operationId: string; providerRequestId: string; execution: "not_started" }
  | { status: "rejected"; providerRequestId: string; code: string };

export type LivePortEvent = {
  callId: string;
  nonce: string;
};

export type LivePlaybackCursor = {
  itemId: string;
  contentIndex: number;
  playedSamples: number;
  sampleRate: 24000;
};

export type LiveControlEvent =
  | { callId: string; kind: "release-media" }
  | { callId: string; kind: "session-context"; actionId: string; content: string }
  | { callId: string; kind: "reject-delegation"; actionId: string; delegationId: string; reason: "EXECUTION_NOT_CONNECTED" }
  | { callId: string; kind: "work-receipt"; actionId: string; delegationId: string; receipt: LiveProviderReceipt }
  | { callId: string; kind: "work-navigation"; actionId: string; sessionId: string }
  | { callId: string; kind: "work-feedback"; actionId: string; delegationId: string; feedback: LiveWorkFeedback }
  | { callId: string; kind: "playback-reset"; playbackEpoch: number };

export type LiveTranscriptEvent = {
  callId: string;
  segment: LiveTranscriptSegment;
};

/**
 * The call actions a docked Live Voice widget can ask for. The widget window
 * owns no media and is not the Live Voice call owner, so every action travels
 * to the main window (the owner frame) and runs there.
 */
export type LiveVoiceWidgetAction = "cancel" | "mute" | "resume" | "end" | "details" | "settings";
