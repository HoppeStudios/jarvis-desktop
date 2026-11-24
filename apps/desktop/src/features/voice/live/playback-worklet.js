// Monitor a copy of the remote WebRTC stream on the audio clock. The HTML audio
// element remains the sole audible output; this branch emits silence and flags.
class PiLivePlaybackMonitor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.threshold = options.processorOptions.threshold;
    this.windowSize = Math.max(128, Math.round(sampleRate * 0.04));
    this.energy = 0;
    this.samples = 0;
    this.stopped = false;
    this.port.onmessage = event => { if (event.data?.kind === "stop") this.stopped = true; };
  }
  process(inputs, outputs) {
    for (const channels of outputs) for (const channel of channels) channel.fill(0);
    if (this.stopped) return false;
    for (const channel of inputs[0] ?? []) for (const sample of channel) {
      if (Number.isFinite(sample)) this.energy += sample * sample;
      this.samples++;
    }
    if (this.samples >= this.windowSize) {
      this.port.postMessage({ kind: "playback-signal", active: Math.sqrt(this.energy / this.samples) >= this.threshold });
      this.energy = 0;
      this.samples = 0;
    }
    return true;
  }
}
registerProcessor("pi-live-playback-monitor", PiLivePlaybackMonitor);
