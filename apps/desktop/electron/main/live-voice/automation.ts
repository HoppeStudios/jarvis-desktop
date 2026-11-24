import type { LiveAutomationControl, LiveAutomationRequest, LiveAutomationResponse, LiveAutomationResult, LiveStatus } from "@pi-desktop/shared";
import type { LiveOwner } from "./call-service-internals";
import { ownerKey } from "./call-service-internals";

const uuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
const fail = (code: string): Error => Object.assign(new Error(code), { errorCode: code });
const live = (call: LiveStatus["call"]): boolean => Boolean(call && !["ended", "failed"].includes(call.phase));
const evidenceFlags = ["providerReady", "requestSent", "transcriptReceived", "transcriptMatches", "measuredAudio", "playbackActive", "turnComplete"];
function validGreetingEvidence(raw: unknown): boolean {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const value = raw as Record<string, unknown>;
  return Object.keys(value).length === 8 && evidenceFlags.every(key => typeof value[key] === "boolean") &&
    ["running", "suspended", "closed", "interrupted", "unavailable"].includes(String(value.contextState));
}

export function parseAutomationControl(raw: unknown): LiveAutomationControl {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw fail("INVALID_PARAMS");
  const v = raw as Record<string, unknown>;
  if (Object.keys(v).some(k => !["requestId", "action", "workSessionId", "freshCoordinator", "initialMuted", "presenceGreeting", "expectedCallId", "intentId", "intentSequence"].includes(k)) ||
    !uuid(v.requestId) || !["start", "toggle", "wake", "new-chat", "end"].includes(String(v.action)) ||
    ((v.intentId !== undefined || v.intentSequence !== undefined) && (!uuid(v.intentId) || !Number.isSafeInteger(v.intentSequence) || Number(v.intentSequence) < 1)) ||
    (v.workSessionId !== undefined && (typeof v.workSessionId !== "string" || !v.workSessionId.trim() || v.workSessionId.length > 256)) ||
    (v.initialMuted !== undefined && typeof v.initialMuted !== "boolean") ||
    (v.presenceGreeting !== undefined && typeof v.presenceGreeting !== "boolean") ||
    (v.expectedCallId !== undefined && !uuid(v.expectedCallId)) ||
    (v.freshCoordinator !== undefined && typeof v.freshCoordinator !== "boolean") ||
    (v.freshCoordinator === true && v.workSessionId !== undefined)) throw fail("INVALID_PARAMS");
  return v as LiveAutomationControl;
}

type Pending = {
  request: LiveAutomationControl;
  owner: LiveOwner;
  resolve: (result: LiveAutomationResult) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  coordinatorSessionId?: string;
};
type AutomationDependencies = {
  enabled: () => Promise<boolean>;
  status: () => Promise<LiveStatus>;
  owner: () => LiveOwner | null;
  send: (owner: LiveOwner, request: LiveAutomationRequest) => void;
  end: (owner: LiveOwner, request: { callId: string; reason: "user-ended" } | { requestId: string; reason: "user-cancelled-start" }) => Promise<unknown>;
  createCoordinator?: () => Promise<string>;
  timeoutMs?: number;
};

/** Main owns decisions and cancellation, never the renderer's media objects. */
export class LiveVoiceAutomation {
  private pending: Pending | null = null;
  private decisions: Promise<unknown> = Promise.resolve();
  private readonly requests = new Map<string, { fingerprint: string; promise: Promise<LiveAutomationResult> }>();
  private readonly intents = new Map<string, number>();
  private readonly deps: AutomationDependencies;
  constructor(deps: AutomationDependencies) { this.deps = deps; }

  async status() {
    await this.pruneOwner();
    return { controlEnabled: await this.deps.enabled(), ...(await this.deps.status()), pendingRequestId: this.pending?.request.requestId ?? null };
  }

  control(raw: unknown): Promise<LiveAutomationResult> {
    const request = parseAutomationControl(raw);
    const fingerprint = JSON.stringify(request);
    const prior = this.requests.get(request.requestId);
    if (prior) return prior.fingerprint === fingerprint ? prior.promise : Promise.reject(fail("LIVE_REQUEST_CONFLICT"));
    const staleIntent = Boolean(request.intentId && request.intentSequence! <= (this.intents.get(request.intentId) ?? 0));
    if (request.intentId && request.intentSequence! > (this.intents.get(request.intentId) ?? 0)) {
      this.intents.set(request.intentId, request.intentSequence!);
      if (this.intents.size > 64) this.intents.delete(this.intents.keys().next().value!);
    }
    // Serialize only admission, not the potentially long media startup. A second
    // wake must reach cancellation while the first request still awaits GPT.
    const admitted = this.decisions.then(() => staleIntent || request.intentId && request.intentSequence! < this.intents.get(request.intentId)!
      ? { completion: Promise.resolve<LiveAutomationResult>({ requestId: request.requestId, state: "superseded" }) }
      : this.admit(request));
    this.decisions = admitted.then(() => undefined, () => undefined);
    const promise = admitted.then(value => value.completion);
    this.requests.set(request.requestId, { fingerprint, promise });
    if (this.requests.size > 128) {
      const oldest = [...this.requests.keys()].find(id => id !== this.pending?.request.requestId);
      if (oldest) this.requests.delete(oldest);
    }
    return promise;
  }

  private async admit(request: LiveAutomationControl): Promise<{ completion: Promise<LiveAutomationResult> }> {
    await this.pruneOwner();
    let status = await this.deps.status();
    if (request.expectedCallId && status.call?.callId !== request.expectedCallId) throw fail("LIVE_STALE_CALL");
    if (request.action === "end" || request.action === "toggle" && (this.pending || live(status.call))) {
      return { completion: this.end(request, status) };
    }
    if (request.action === "wake" && (this.pending || live(status.call))) {
      const pending = this.pending && this.requests.get(this.pending.request.requestId)?.promise;
      return { completion: pending ? pending.then(result => ({ ...result, requestId: request.requestId }))
        : Promise.resolve({ requestId: request.requestId, state: "already-on", callId: status.call!.callId,
          muted: status.call!.muted, playbackBlocked: status.call!.playbackBlocked }) };
    }
    if (!await this.deps.enabled()) throw fail("LIVE_AUTOMATION_DISABLED");
    if (request.action === "new-chat") {
      await this.end(request, status);
      status = await this.deps.status();
    }
    if (this.pending || live(status.call)) throw fail("LIVE_ALREADY_ACTIVE");
    if (!status.enabled) throw fail("LIVE_DISABLED");
    const owner = this.deps.owner();
    if (!owner) throw fail("LIVE_INVALID_OWNER");
    // Admission is serialized: no second creation on a toggle-off or retry.
    const coordinatorSessionId = request.freshCoordinator
      ? await this.deps.createCoordinator?.() : undefined;
    if (request.freshCoordinator && !coordinatorSessionId) throw fail("LIVE_COORDINATOR_UNAVAILABLE");
    const completion = new Promise<LiveAutomationResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        const pending = this.pending;
        if (!pending || pending.request.requestId !== request.requestId) return;
        void this.cancelPending(pending, "LIVE_TIMEOUT").catch(() => undefined);
      }, this.deps.timeoutMs ?? 60_000);
      this.pending = { request, owner, resolve, reject, timer, coordinatorSessionId };
      try {
        this.deps.send(owner, { requestId: request.requestId, action: "start", workSessionId: coordinatorSessionId ?? request.workSessionId, initialMuted: request.initialMuted !== false, presenceGreeting: request.presenceGreeting === true });
      } catch {
        clearTimeout(timer); this.pending = null; reject(fail("LIVE_INVALID_OWNER"));
      }
    });
    return { completion };
  }

  private async end(request: LiveAutomationControl, status: LiveStatus): Promise<LiveAutomationResult> {
    const pending = this.pending;
    if (pending) await this.cancelPending(pending);
    if (live(status.call)) {
      const owner = this.deps.owner();
      if (!owner) throw fail("LIVE_INVALID_OWNER");
      const current = await this.deps.status();
      if (current.call?.callId === status.call!.callId && live(current.call)) {
        await this.deps.end(owner, { callId: status.call!.callId, reason: "user-ended" });
      } else if (live(current.call)) throw fail("LIVE_STALE_CALL");
    }
    const after = await this.deps.status();
    if (after.call?.mediaRelease === "unconfirmed") throw fail("LIVE_MEDIA_RELEASE_UNCONFIRMED");
    if (live(after.call)) throw fail("LIVE_STALE_CALL");
    return { requestId: request.requestId, state: pending || live(status.call) ? "ended" : "already-ended", ...(after.call ? { callId: after.call.callId } : {}) };
  }

  private async pruneOwner(): Promise<void> {
    const pending = this.pending;
    if (!pending) return;
    const current = this.deps.owner();
    if (!current || ownerKey(current) !== ownerKey(pending.owner) || current.url !== pending.owner.url) {
      await this.cancelPending(pending, "LIVE_INVALID_OWNER");
    }
  }

  private async cancelPending(pending: Pending, errorCode?: string): Promise<void> {
    if (this.pending !== pending) return;
    this.pending = null; clearTimeout(pending.timer);
    try { this.deps.send(pending.owner, { requestId: pending.request.requestId, action: "cancel" }); } catch { /* a lost renderer still needs its prepare tombstone */ }
    try {
      await this.deps.end(pending.owner, { requestId: pending.request.requestId, reason: "user-cancelled-start" });
      if (errorCode) pending.reject(fail(errorCode));
      else pending.resolve({ requestId: pending.request.requestId, state: "cancelled" });
    } catch (error) { pending.reject(error as Error); throw error; }
  }

  async complete(owner: LiveOwner, raw: unknown): Promise<{ accepted: boolean }> {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw fail("INVALID_PARAMS");
    const response = raw as LiveAutomationResponse;
    if (Object.keys(raw).some(k => !["requestId", "callId", "cancelled", "errorCode", "greetingPlayed", "greetingFinishedAt", "greetingEvidence"].includes(k)) ||
      !uuid(response.requestId) || response.callId !== undefined && !uuid(response.callId) ||
      response.cancelled !== undefined && typeof response.cancelled !== "boolean" ||
      response.errorCode !== undefined && !/^LIVE_[A-Z0-9_]{1,70}$/.test(response.errorCode) ||
      response.greetingPlayed !== undefined && typeof response.greetingPlayed !== "boolean" ||
      response.greetingEvidence !== undefined && !validGreetingEvidence(response.greetingEvidence) ||
      response.greetingFinishedAt !== undefined && (!Number.isFinite(response.greetingFinishedAt) || response.greetingFinishedAt <= 0 || response.greetingFinishedAt > Date.now() + 1000) ||
      response.greetingPlayed === true && response.greetingFinishedAt === undefined) throw fail("INVALID_PARAMS");
    const pending = this.pending;
    if (!pending || pending.request.requestId !== response.requestId) return { accepted: false };
    if (ownerKey(owner) !== ownerKey(pending.owner) || owner.url !== pending.owner.url) throw fail("LIVE_INVALID_OWNER");
    const status = await this.deps.status();
    // End may have won while status was being read.
    if (this.pending !== pending) return { accepted: false };
    clearTimeout(pending.timer); this.pending = null;
    if (response.errorCode || response.cancelled) {
      try {
        await this.deps.end(owner, { requestId: pending.request.requestId, reason: "user-cancelled-start" });
        if (response.errorCode) pending.reject(fail(response.errorCode));
        else pending.resolve({ requestId: response.requestId, state: "cancelled" });
      } catch (error) { pending.reject(error as Error); throw error; }
    } else {
      const call = status.call;
      if (!call || call.callId !== response.callId || call.phase !== "connected") pending.reject(fail("LIVE_STALE_CALL"));
      else pending.resolve({ requestId: response.requestId, state: "connected", callId: call.callId, muted: call.muted, playbackBlocked: call.playbackBlocked,
        ...(pending.coordinatorSessionId ? { coordinatorSessionId: pending.coordinatorSessionId } : {}),
        ...(pending.request.presenceGreeting ? { greetingPlayed: response.greetingPlayed === true,
          ...(response.greetingEvidence ? { greetingEvidence: response.greetingEvidence } : {}),
          ...(response.greetingPlayed && response.greetingFinishedAt ? { greetingFinishedAt: response.greetingFinishedAt } : {}) } : {}) });
    }
    return { accepted: true };
  }
}
