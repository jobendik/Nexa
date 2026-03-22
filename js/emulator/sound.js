// SoundGenerator - Web Audio API sound output (runs on main thread)
var SoundGenerator = class {
  constructor() {
    this.channels = [
      { kind: "tone", frequency: 0, control: 0, enabled: false, waveform: 0, volume: 0 },
      { kind: "tone", frequency: 0, control: 0, enabled: false, waveform: 0, volume: 0 },
      { kind: "tone", frequency: 0, control: 0, enabled: false, waveform: 0, volume: 0 },
      { kind: "noise", frequency: 0, control: 0, enabled: false, waveform: 0, volume: 0 }
    ];
    this.audioCtx = null;
    this.masterGain = null;
    this.masterLimiter = null;
    this.sources = [null, null, null, null];
    this.gains = [null, null, null, null];
    this.panners = [null, null, null, null];
    this.sourceModes = [-1, -1, -1, -1];
    this.noiseBuffers = null;
  }
  read(offset) {
    if (offset < 0 || offset >= 8) return 0;
    const ch = offset >> 1 & 3;
    const reg = offset & 1;
    if (reg === 0) return this.channels[ch].frequency;
    return this.channels[ch].control;
  }
  write(offset, value) {
    if (offset < 0 || offset >= 8) return;
    const ch = offset >> 1 & 3;
    const reg = offset & 1;
    if (reg === 0) {
      this.channels[ch].frequency = value & 65535;
      this.updateChannel(ch);
    } else {
      this.channels[ch].control = value;
      this.channels[ch].enabled = !!(value & 8);
      this.channels[ch].waveform = value >> 8 & 3;
      this.channels[ch].volume = value >> 4 & 15;
      this.updateChannel(ch);
    }
  }
  ensureAudio() {
    if (this.audioCtx) {
      if (this.audioCtx.state === "suspended") this.audioCtx.resume().catch(() => {});
      return true;
    }
    try {
      const AudioCtor = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!AudioCtor) return false;
      this.audioCtx = new AudioCtor();
      this.masterGain = this.audioCtx.createGain();
      this.masterGain.gain.setValueAtTime(0.22, this.audioCtx.currentTime);
      this.masterLimiter = this.audioCtx.createDynamicsCompressor();
      this.masterLimiter.threshold.setValueAtTime(-18, this.audioCtx.currentTime);
      this.masterLimiter.knee.setValueAtTime(12, this.audioCtx.currentTime);
      this.masterLimiter.ratio.setValueAtTime(8, this.audioCtx.currentTime);
      this.masterLimiter.attack.setValueAtTime(0.003, this.audioCtx.currentTime);
      this.masterLimiter.release.setValueAtTime(0.12, this.audioCtx.currentTime);
      this.masterGain.connect(this.masterLimiter);
      this.masterLimiter.connect(this.audioCtx.destination);
      this.noiseBuffers = [
        this.createNoiseBuffer(4096, 0.0),
        this.createNoiseBuffer(127, 0.25),
        this.createNoiseBuffer(31, 0.55),
        this.createNoiseBuffer(7, 0.85)
      ];
      if (this.audioCtx.state === "suspended") this.audioCtx.resume().catch(() => {});
      return true;
    } catch {
      return false;
    }
  }
  connectChannelNode(source, gain, ch) {
    if (!this.panners[ch]) {
      if (typeof this.audioCtx.createStereoPanner === "function") {
        this.panners[ch] = this.audioCtx.createStereoPanner();
      } else {
        this.panners[ch] = this.audioCtx.createGain();
      }
      this.panners[ch].connect(this.masterGain);
    }
    const panNode = this.panners[ch];
    if (panNode.pan) {
      const panPositions = [-0.75, -0.25, 0.25, 0.75];
      panNode.pan.setValueAtTime(panPositions[ch], this.audioCtx.currentTime);
    }
    source.connect(gain);
    gain.connect(panNode);
  }
  createNoiseBuffer(length, blend) {
    const buffer = this.audioCtx.createBuffer(1, length, this.audioCtx.sampleRate);
    const data = buffer.getChannelData(0);
    let sample = 0;
    for (let i = 0; i < length; i++) {
      const next = Math.random() * 2 - 1;
      sample = (sample * blend) + (next * (1 - blend));
      data[i] = sample;
    }
    return buffer;
  }
  updateChannel(ch) {
    const state = this.channels[ch];
    if (!state.enabled || state.frequency === 0) {
      this.stopChannel(ch);
      return;
    }
    if (!this.ensureAudio()) return;
    if (state.kind === "noise") {
      this.updateNoiseChannel(ch, state);
      return;
    }
    const freq = Math.max(20, Math.min(2e4, 1e6 / state.frequency));
    if (!this.sources[ch]) {
      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();
      this.connectChannelNode(osc, gain, ch);
      this.sources[ch] = osc;
      this.gains[ch] = gain;
      osc.start();
    }
    const osc = this.sources[ch];
    const gain = this.gains[ch];
    const waveTypes = ["square", "triangle", "sawtooth", "sawtooth"];
    osc.type = waveTypes[state.waveform & 3];
    osc.frequency.setValueAtTime(freq, this.audioCtx.currentTime);
    gain.gain.setValueAtTime(state.volume / 80, this.audioCtx.currentTime);
  }
  updateNoiseChannel(ch, state) {
    const mode = state.waveform & 3;
    if (!this.sources[ch] || this.sourceModes[ch] !== mode) {
      this.stopChannel(ch);
      const source = this.audioCtx.createBufferSource();
      const gain = this.audioCtx.createGain();
      source.buffer = this.noiseBuffers[mode];
      source.loop = true;
      this.connectChannelNode(source, gain, ch);
      source.start();
      this.sources[ch] = source;
      this.gains[ch] = gain;
      this.sourceModes[ch] = mode;
    }
    const source = this.sources[ch];
    const gain = this.gains[ch];
    const playbackRate = Math.max(0.05, Math.min(32, 2048 / Math.max(1, state.frequency)));
    source.playbackRate.setValueAtTime(playbackRate, this.audioCtx.currentTime);
    gain.gain.setValueAtTime(state.volume / 90, this.audioCtx.currentTime);
  }
  stopChannel(ch) {
    if (this.sources[ch]) {
      try {
        this.sources[ch].stop();
      } catch {}
      this.sources[ch].disconnect?.();
      this.gains[ch]?.disconnect?.();
      this.sources[ch] = null;
      this.gains[ch] = null;
      this.sourceModes[ch] = -1;
    }
  }
  destroy() {
    this.stopChannel(0);
    this.stopChannel(1);
    this.stopChannel(2);
    this.stopChannel(3);
    for (let ch = 0; ch < this.panners.length; ch++) {
      this.panners[ch]?.disconnect?.();
      this.panners[ch] = null;
    }
    this.masterGain?.disconnect?.();
    this.masterLimiter?.disconnect?.();
    this.audioCtx?.close();
    this.audioCtx = null;
  }
};
