import type { LiveWireEvent } from "@pi-desktop/voice-runtime/live";
import type { LiveTranscriptSegment } from "@pi-desktop/shared";

type Transcript = Extract<LiveWireEvent, { kind: "transcript" }>;
/** Keep frameless chunks in one row and replace them with the authoritative final. */
export class CodexTranscriptAssembler {
  private sequence = 0;
  private active: Partial<Record<"user" | "assistant", string>> = {};
  private partial = new Map<string, string>();

  push(event: Transcript, timestamp: number): LiveTranscriptSegment {
    const fallback = event.id === "codex-input" || event.id === "codex-output";
    const id = fallback ? this.active[event.role] ?? (this.active[event.role] = `${event.id}:${++this.sequence}`) : event.id;
    const text = (event.delta ? this.partial.get(id) ?? "" : "") + event.text;
    if (new TextEncoder().encode(text).byteLength > 64 * 1024) {
      throw Object.assign(new Error("Transcript exceeded the call limit"), { code: "LIVE_PROTOCOL_ERROR" });
    }
    if (event.final) {
      this.partial.delete(id);
      if (fallback) delete this.active[event.role];
    } else {
      this.partial.set(id, text);
      while (this.partial.size > 40) this.partial.delete(this.partial.keys().next().value!);
    }
    return { id, role: event.role, text, final: event.final, timestamp };
  }
}
