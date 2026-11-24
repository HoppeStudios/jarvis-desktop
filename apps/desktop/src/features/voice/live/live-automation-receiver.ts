import type { LiveAutomationRequest, LiveAutomationResponse, LiveCallView } from "@pi-desktop/shared";

type Controller = {
  refreshStatus: () => Promise<void>;
  getSnapshot: () => { starting: boolean; stopping: boolean; call: LiveCallView | null };
  start: (options: { requestId: string; signal: AbortSignal; workTarget?: { workSessionId: string } }) => Promise<void>;
  toggleMute: () => Promise<void>;
  presenceGreeting?: () => Promise<{ greetingPlayed: boolean; greetingFinishedAt?: number }>;
};

/** Handles only Main's trusted event. No desktop input or foreground operation. */
export class LiveAutomationReceiver {
  private readonly pending = new Map<string, AbortController>();
  private readonly cancelled = new Set<string>();
  private readonly controller: Controller;
  private readonly respond: (response: LiveAutomationResponse) => Promise<unknown>;
  constructor(controller: Controller, respond: (response: LiveAutomationResponse) => Promise<unknown>) {
    this.controller = controller; this.respond = respond;
  }
  async receive(request: LiveAutomationRequest): Promise<void> {
    if (request.action === "cancel") {
      this.cancelled.add(request.requestId);
      if (this.cancelled.size > 128) this.cancelled.delete(this.cancelled.values().next().value!);
      this.pending.get(request.requestId)?.abort();
      return;
    }
    const abort = new AbortController();
    this.pending.set(request.requestId, abort);
    let response: LiveAutomationResponse = { requestId: request.requestId };
    try {
      if (this.cancelled.has(request.requestId)) abort.abort();
      await this.controller.refreshStatus();
      if (abort.signal.aborted) throw Object.assign(new Error("cancelled"), { code: "LIVE_STALE_CALL" });
      const before = this.controller.getSnapshot();
      if (before.starting || before.stopping || before.call && !["ended", "failed"].includes(before.call.phase)) throw Object.assign(new Error("busy"), { code: "LIVE_ALREADY_ACTIVE" });
      await this.controller.start({ requestId: request.requestId, signal: abort.signal, ...(request.workSessionId ? { workTarget: { workSessionId: request.workSessionId } } : {}) });
      if (abort.signal.aborted) throw Object.assign(new Error("cancelled"), { code: "LIVE_STALE_CALL" });
      if (request.initialMuted === false && this.controller.getSnapshot().call?.muted) await this.controller.toggleMute();
      if (request.presenceGreeting) Object.assign(response, await this.controller.presenceGreeting?.() ?? { greetingPlayed: false });
      if (abort.signal.aborted) throw Object.assign(new Error("cancelled"), { code: "LIVE_STALE_CALL" });
      const call = this.controller.getSnapshot().call;
      if (!call || call.phase !== "connected") throw Object.assign(new Error("not connected"), { code: "LIVE_STALE_CALL" });
      response.callId = call.callId;
    } catch (error) {
      const code = (error as { code?: string; errorCode?: string })?.code ?? (error as { errorCode?: string })?.errorCode;
      response = abort.signal.aborted ? { requestId: request.requestId, cancelled: true }
        : { requestId: request.requestId, errorCode: typeof code === "string" && /^LIVE_[A-Z0-9_]{1,70}$/.test(code) ? code : "LIVE_CALL_ACTION_FAILED" };
    } finally {
      this.pending.delete(request.requestId);
      await this.respond(response).catch(() => undefined);
    }
  }
}
