import { ASSET_VERSION } from "./config.js?v=20260901-12";

export class AudioManager {
  constructor(audioMap, chipmunkRate) {
    this.audioMap = audioMap;
    this.chipmunkRate = chipmunkRate;
    this.context = null;
    this.tracks = new Set();
    this.stream = null;
    this.recording = null;
    this.vadFrame = 0;
    this.vadStop = null;
  }

  async contextReady() {
    if (!this.context) {
      const Context = window.AudioContext || window.webkitAudioContext;
      if (!Context) throw new Error("Web Audio API is not supported");
      this.context = new Context();
    }
    if (this.context.state === "suspended") await this.context.resume();
    return this.context;
  }

  async getStream() {
    const isLive = this.stream?.getAudioTracks().some((track) => track.readyState === "live");
    if (!isLive) {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false,
      });
    }
    return this.stream;
  }

  async playMapped(videoName) {
    const sound = this.audioMap[videoName];
    if (!sound) return null;
    const audio = new Audio(`assets/${sound}?v=${ASSET_VERSION}`);
    audio.preload = "auto";
    this.tracks.add(audio);
    audio.play().catch(() => {});
    audio.onended = () => this.tracks.delete(audio);
    return audio;
  }

  // This resolves immediately with a recording handle. The result promise resolves only after stopRecording().
  async startRecording() {
    if (!window.MediaRecorder) throw new Error("MediaRecorder is not supported in this browser");
    if (this.recording) await this.stopRecording();

    const stream = await this.getStream();
    if (!stream.getAudioTracks().some((track) => track.readyState === "live")) throw new Error("Microphone track is inactive");

    const chunks = [];
    const supportedMime = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find((type) => MediaRecorder.isTypeSupported?.(type));
    const recorder = supportedMime ? new MediaRecorder(stream, { mimeType: supportedMime }) : new MediaRecorder(stream);
    let resolveResult;
    const result = new Promise((resolve) => { resolveResult = resolve; });
    const finish = () => {
      recorder.removeEventListener("stop", finish);
      recorder.removeEventListener("error", fail);
      resolveResult(chunks.length ? new Blob(chunks, { type: recorder.mimeType || "audio/webm" }) : null);
    };
    const fail = (event) => { console.warn("MediaRecorder error", event.error); finish(); };

    recorder.addEventListener("dataavailable", (event) => { if (event.data.size > 0) chunks.push(event.data); });
    recorder.addEventListener("stop", finish);
    recorder.addEventListener("error", fail);
    recorder.start(250);
    this.recording = { recorder, result };
    return this.recording;
  }

  async stopRecording() {
    const current = this.recording;
    if (!current) return null;
    this.recording = null;
    if (current.recorder.state !== "inactive") current.recorder.stop();
    return current.result;
  }

  async createChipmunkClip(blob) {
    if (!blob) return null;
    const context = await this.contextReady();
    const buffer = await context.decodeAudioData(await blob.arrayBuffer());
    const trimmed = this.trimTrailingSilence(buffer);
    // Raise pitch by simple, clean resampling (the classic Tom/Ben effect).
    // Avoid granular time-stretching: its overlapping grains caused the
    // metallic/robotic sound. The clip is then padded or trimmed to cp.mp4.
    const rate = this.chipmunkRate;
    const pitched = this.resampleBuffer(trimmed, rate);
    const processed = pitched;
    return {
      durationMs: Math.ceil(processed.duration * 1000),
      play: () => {
        const source = context.createBufferSource();
        source.buffer = processed;
        source.playbackRate.value = 1;
        source.connect(context.destination);
        this.tracks.add(source);
        source.onended = () => this.tracks.delete(source);
        source.start();
        return source;
      },
    };
  }

  resampleBuffer(buffer, rate) {
    const length = Math.max(1, Math.round(buffer.length / rate));
    const output = this.context.createBuffer(buffer.numberOfChannels, length, buffer.sampleRate);
    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
      const input = buffer.getChannelData(channel);
      const out = output.getChannelData(channel);
      for (let i = 0; i < length; i++) {
        const position = i * rate;
        const left = Math.floor(position);
        const fraction = position - left;
        const a = input[Math.min(left, input.length - 1)] || 0;
        const b = input[Math.min(left + 1, input.length - 1)] || a;
        out[i] = a + (b - a) * fraction;
      }
    }
    return output;
  }

  fitBufferLength(buffer, targetLength) {
    if (buffer.length === targetLength) return buffer;
    const output = this.context.createBuffer(buffer.numberOfChannels, targetLength, buffer.sampleRate);
    const copyLength = Math.min(buffer.length, targetLength);
    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
      output.copyToChannel(buffer.getChannelData(channel).subarray(0, copyLength), channel, 0);
    }
    return output;
  }

  trimTrailingSilence(buffer, threshold = 0.012, paddingMs = 35) {
    const channels = buffer.numberOfChannels;
    const sampleRate = buffer.sampleRate;
    const block = 256;
    let lastActive = 0;
    for (let offset = 0; offset < buffer.length; offset += block) {
      const end = Math.min(buffer.length, offset + block);
      let peak = 0;
      for (let channel = 0; channel < channels; channel++) {
        const data = buffer.getChannelData(channel);
        for (let i = offset; i < end; i += 2) peak = Math.max(peak, Math.abs(data[i]));
      }
      if (peak >= threshold) lastActive = end;
    }
    const keep = Math.max(1, Math.min(buffer.length, lastActive + Math.floor(sampleRate * paddingMs / 1000)));
    if (keep >= buffer.length) return buffer;
    const trimmed = this.context.createBuffer(channels, keep, sampleRate);
    for (let channel = 0; channel < channels; channel++) trimmed.copyToChannel(buffer.getChannelData(channel).subarray(0, keep), channel);
    return trimmed;
  }

  async listenForSpeech({ threshold, speechEndMs, minSpeechMs }, onEnded, onActivity = () => {}) {
    const context = await this.contextReady();
    const source = context.createMediaStreamSource(await this.getStream());
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    source.connect(analyser);
    const samples = new Uint8Array(analyser.fftSize);
    let spokeAt = 0, silentAt = 0, stopped = false;
    const stop = () => {
      if (stopped) return;
      stopped = true;
      cancelAnimationFrame(this.vadFrame);
      source.disconnect();
      if (this.vadStop === stop) this.vadStop = null;
    };
    const tick = () => {
      if (stopped) return;
      analyser.getByteTimeDomainData(samples);
      let sum = 0;
      for (const sample of samples) { const value = (sample - 128) / 128; sum += value * value; }
      const level = Math.sqrt(sum / samples.length);
      const now = performance.now();
      if (level >= threshold) { if (!spokeAt) { spokeAt = now; onActivity(); } silentAt = 0; }
      else if (spokeAt && !silentAt) silentAt = now;
      if (spokeAt && now - spokeAt >= minSpeechMs && silentAt && now - silentAt >= speechEndMs) { stop(); onEnded({ hadSpeech: true }); return; }
      this.vadFrame = requestAnimationFrame(tick);
    };
    this.vadStop?.();
    this.vadStop = stop;
    tick();
    return stop;
  }

  stopAll({ releaseMic = false } = {}) {
    this.vadStop?.();
    this.vadStop = null;
    cancelAnimationFrame(this.vadFrame);
    this.vadFrame = 0;
    this.stopRecording();
    for (const track of this.tracks) {
      try { track.stop?.(); track.pause?.(); track.currentTime = 0; } catch (_) {}
    }
    this.tracks.clear();
    if (releaseMic && this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }
  }
}
