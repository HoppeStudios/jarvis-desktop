// Local duplex protection only. No recording, ASR, network or provider settings.
class PiLiveInterruptionGuard extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(Math.ceil(sampleRate * 0.6));
    this.speaking = false; this.muted = true; this.stopped = false;
    this.reset();
    this.port.onmessage = ({data}) => {
      if (data?.kind === 'speaking') this.speaking = data.active === true;
      if (data?.kind === 'muted') { this.muted = data.active === true; if (this.muted) this.reset(); }
      if (data?.kind === 'stop') { this.stopped = true; this.reset(); }
    };
  }
  reset() { this.read = 0; this.count = 0; this.voiced = 0; this.elapsed = 0; this.quiet = 0; this.admitted = false; this.buffer.fill(0); }
  process(inputs, outputs) {
    const out = outputs[0]?.[0];
    if (!out) return !this.stopped;
    out.fill(0);
    if (this.stopped) return false;
    if (this.muted) { this.reset(); return true; }
    const input = inputs[0]?.[0];
    if (!input) return true;
    let energy = 0;
    for (const value of input) if (Number.isFinite(value)) energy += value * value;
    const voiced = Math.sqrt(energy / input.length) >= 0.015;
    this.quiet = voiced ? 0 : this.quiet + input.length;
    if (!this.speaking && !this.admitted) {
      this.reset(); out.set(input.subarray(0,out.length)); return true;
    }
    if (!this.admitted && !voiced && (!this.count || this.quiet > sampleRate * 0.08)) {
      this.reset(); return true;
    }
    this.elapsed += input.length;
    if (voiced) this.voiced += input.length;
    for (const value of input) {
      if (this.count === this.buffer.length) { this.read = (this.read + 1) % this.buffer.length; this.count--; }
      this.buffer[(this.read + this.count) % this.buffer.length] = Number.isFinite(value) ? value : 0;
      this.count++;
    }
    if (this.voiced >= sampleRate * 0.16 && this.elapsed >= sampleRate * 0.24) this.admitted = true;
    if (this.admitted) {
      for (let i=0;i<out.length && this.count;i++) {
        out[i] = this.buffer[this.read]; this.buffer[this.read] = 0;
        this.read = (this.read + 1) % this.buffer.length; this.count--;
      }
      // Preserve admitted speech tails across the end of assistant playback.
      if (this.quiet > sampleRate * 0.45) this.reset();
    }
    return true;
  }
}
registerProcessor('pi-live-interruption-guard', PiLiveInterruptionGuard);
