// Local audio engine: MP3 import (file picker + drag & drop handled by UI),
// playback transport and real-time DSP. NOTHING is uploaded — everything is
// processed in the browser via the Web Audio API.
//
// Analysis graph:
//   <audio> ──► MediaElementSource ─► sourceBus ─┬─► masterGain ─► destination
//   testTone ─► testGain ────────┘               ├─► lp1 ─► lp2 ─► bassAnalyser   (drive tap, 24 dB/oct)
//                                                └─► fullAnalyser                 (spectrum / RMS metering)
//
// The cone drive signal is the *actual low-frequency content* of the audio:
// we read the time-domain output of the cascaded low-pass, DC-block it, and
// normalize it with an automatic-gain stage. The RAW SAMPLES are handed to
// physics.ts (one mechanical step per audio sample — true dot-to-dot motion).
// A short-window mean is kept only for the level meters, and the punch
// envelope is metering-only (it never drives the cone).

export interface AudioFrame {
  drive: number;      // signed short-window mean, roughly −1.2..1.2 after AGC (meters only)
  rms: number;        // full-band RMS 0..1
  peak: number;       // full-band peak 0..1
  bass: number;       // band energy 0..1 (20 Hz..hfCutoff)
  mid: number;        // band energy (hfCutoff..2 kHz)
  high: number;       // band energy (2 kHz..16 kHz)
  spectrum: Uint8Array; // 0..255 per bin (log-mapped by the UI)
  playing: boolean;
  driveSamples: Float32Array | null; // AGC-normalized low-passed waveform (physics input)
  driveSampleRate: number;           // sample rate of driveSamples
}

const FFT_SIZE = 2048;

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private el: HTMLAudioElement;
  private srcNode: MediaElementAudioSourceNode | null = null;
  private sourceBus: GainNode | null = null;
  private master: GainNode | null = null;
  private lp1: BiquadFilterNode | null = null;
  private lp2: BiquadFilterNode | null = null;
  private bassAnalyser: AnalyserNode | null = null;
  private fullAnalyser: AnalyserNode | null = null;

  private driveBuf = new Float32Array(FFT_SIZE);
  private driveNorm = new Float32Array(FFT_SIZE);
  private timeBuf = new Float32Array(FFT_SIZE);
  private specBuf = new Uint8Array(FFT_SIZE / 2);

  private testOsc: OscillatorNode | null = null;
  private testOsc2: OscillatorNode | null = null;
  private testGain: GainNode | null = null;
  private testLfo: OscillatorNode | null = null;

  private refLevel = 0.05;      // AGC reference
  private envFast = 0;          // punch envelope
  private envSlow = 0;
  private objectUrl: string | null = null;

  onStateChange: (() => void) | null = null;

  constructor() {
    this.el = new Audio();
    this.el.preload = 'metadata';
    this.el.crossOrigin = 'anonymous';
    this.el.addEventListener('ended', () => this.onStateChange?.());
    this.el.addEventListener('play', () => this.onStateChange?.());
    this.el.addEventListener('pause', () => this.onStateChange?.());
    this.el.addEventListener('error', () => this.onStateChange?.());
  }

  // ------------------------------------------------------------ context
  private ensureContext(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const AC: typeof AudioContext = window.AudioContext ?? (window as any).webkitAudioContext;
    this.ctx = new AC();
    this.sourceBus = this.ctx.createGain();
    this.master = this.ctx.createGain();
    this.lp1 = this.ctx.createBiquadFilter();
    this.lp1.type = 'lowpass';
    this.lp1.Q.value = 0.71;
    this.lp2 = this.ctx.createBiquadFilter();
    this.lp2.type = 'lowpass';
    this.lp2.Q.value = 0.71;
    this.bassAnalyser = this.ctx.createAnalyser();
    this.bassAnalyser.fftSize = FFT_SIZE;
    this.bassAnalyser.smoothingTimeConstant = 0;
    this.fullAnalyser = this.ctx.createAnalyser();
    this.fullAnalyser.fftSize = FFT_SIZE;
    this.fullAnalyser.smoothingTimeConstant = 0.55;

    this.srcNode = this.ctx.createMediaElementSource(this.el);
    this.srcNode.connect(this.sourceBus);
    this.testGain = this.ctx.createGain();
    this.testGain.gain.value = 0;
    this.testGain.connect(this.sourceBus);

    this.sourceBus.connect(this.master);
    this.master.connect(this.ctx.destination);
    this.sourceBus.connect(this.lp1);
    this.lp1.connect(this.lp2);
    this.lp2.connect(this.bassAnalyser);
    this.sourceBus.connect(this.fullAnalyser);
  }

  // ------------------------------------------------------------ file
  async loadFile(file: File): Promise<{ name: string; duration: number }> {
    const okType = file.type.startsWith('audio/') || /\.(mp3|m4a|aac|wav|ogg|oga|flac|webm|mp4)$/i.test(file.name);
    if (!okType) throw new Error(`"${file.name}" is not an audio file. Please pick an MP3 (or WAV/M4A/OGG/FLAC).`);
    if (file.size > 500 * 1024 * 1024) throw new Error('File is larger than 500 MB — please use a smaller file.');

    this.ensureContext();
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = URL.createObjectURL(file);

    await new Promise<void>((resolve, reject) => {
      const done = () => { cleanup(); resolve(); };
      const fail = () => { cleanup(); reject(new Error(`Could not decode "${file.name}". The file may be corrupted or in an unsupported format.`)); };
      const timer = window.setTimeout(fail, 20000);
      const cleanup = () => {
        this.el.removeEventListener('loadedmetadata', done);
        this.el.removeEventListener('error', fail);
        window.clearTimeout(timer);
      };
      this.el.addEventListener('loadedmetadata', done);
      this.el.addEventListener('error', fail);
      this.el.src = this.objectUrl!;
      this.el.load();
    });
    if (!isFinite(this.el.duration) || this.el.duration <= 0) {
      throw new Error(`"${file.name}" has no readable duration — it may be corrupted.`);
    }
    this.onStateChange?.();
    return { name: file.name, duration: this.el.duration };
  }

  // ------------------------------------------------------------ transport
  async play(): Promise<void> {
    this.ensureContext();
    await this.ctx!.resume();
    await this.el.play();
  }
  pause(): void { this.el.pause(); }
  restart(): void { this.el.currentTime = 0; void this.play(); }
  seek(t: number): void {
    if (isFinite(t) && isFinite(this.el.duration)) {
      this.el.currentTime = Math.min(Math.max(0, t), this.el.duration - 0.01);
    }
  }
  setVolume(v: number): void {
    // master gain (keeps analysis alive even at 0 volume)
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02);
  }
  setMuted(m: boolean): void {
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 1, this.ctx.currentTime, 0.02);
  }
  setGain(g: number): void { this.setVolume(g); }
  setLfCutoff(hz: number): void {
    if (this.lp1 && this.lp2 && this.ctx) {
      this.lp1.frequency.setTargetAtTime(hz, this.ctx.currentTime, 0.03);
      this.lp2.frequency.setTargetAtTime(hz, this.ctx.currentTime, 0.03);
    }
  }

  // ------------------------------------------------------------ test tone
  startTestTone(): void {
    this.ensureContext();
    if (this.ctx!.state === 'suspended') void this.ctx!.resume(); // user-gesture handler: resume must happen here (iOS/Safari)
    if (this.testOsc) return;
    const ctx = this.ctx!;
    this.testOsc = ctx.createOscillator();
    this.testOsc.type = 'sine';
    this.testOsc.frequency.value = 45;
    this.testOsc2 = ctx.createOscillator();
    this.testOsc2.type = 'sine';
    this.testOsc2.frequency.value = 62;
    this.testGain!.gain.value = 0.0;
    this.testLfo = ctx.createOscillator();
    this.testLfo.frequency.value = 0.28;
    const lfoAmt = ctx.createGain();
    lfoAmt.gain.value = 0.32;
    this.testLfo.connect(lfoAmt);
    lfoAmt.connect(this.testGain!.gain);
    this.testGain!.gain.setTargetAtTime(0.5, ctx.currentTime, 0.1);
    this.testOsc.connect(this.testGain!);
    this.testOsc2.connect(this.testGain!);
    this.testOsc.start();
    this.testOsc2.start();
    this.testLfo.start();
    this.onStateChange?.();
  }
  stopTestTone(): void {
    if (!this.testOsc) return;
    const t = this.ctx!.currentTime;
    this.testGain!.gain.setTargetAtTime(0, t, 0.05);
    const oscs = [this.testOsc, this.testOsc2, this.testLfo];
    this.testOsc = this.testOsc2 = this.testLfo = null;
    window.setTimeout(() => oscs.forEach((o) => { try { o?.stop(); } catch { /* already stopped */ } }), 300);
    this.onStateChange?.();
  }
  get testToneActive(): boolean { return !!this.testOsc; }

  // ------------------------------------------------------------ per-frame
  frame(dt: number, hfCutoffHz: number): AudioFrame {
    const playing = !this.el.paused && !this.el.ended && (!!this.el.src);
    const testActive = this.testToneActive;
    let drive = 0, rms = 0, peak = 0, bass = 0, mid = 0, high = 0;
    let hasDrive = false;
    let driveRate = 0;

    if (this.ctx && (playing || testActive)) {
      // low-passed bass tap: DC-block, AGC-normalize, hand RAW samples to physics
      if (this.bassAnalyser) {
        this.bassAnalyser.getFloatTimeDomainData(this.driveBuf);
        // DC blocker: subtract the chunk mean (real amps have no DC path)
        let mean = 0;
        for (let i = 0; i < this.driveBuf.length; i++) mean += this.driveBuf[i];
        mean /= this.driveBuf.length;
        // AGC reference: chunk peak with slow decay → track-independent scaling
        let peakAbs = 0;
        for (let i = 0; i < this.driveBuf.length; i++) {
          const a = Math.abs(this.driveBuf[i] - mean);
          if (a > peakAbs) peakAbs = a;
        }
        this.refLevel = Math.max(peakAbs, this.refLevel - this.refLevel * dt * 0.25, 0.02);
        const inv = 1 / this.refLevel;
        for (let i = 0; i < this.driveBuf.length; i++) {
          const s = (this.driveBuf[i] - mean) * inv;
          this.driveNorm[i] = s > 1.4 ? 1.4 : s < -1.4 ? -1.4 : s;
        }
        // scalar drive (meters only): short recent mean, phase-aware
        const N = 256; // ≈5.3 ms at 48 kHz
        let s = 0;
        for (let i = this.driveBuf.length - N; i < this.driveBuf.length; i++) s += this.driveNorm[i];
        drive = s / N;
        // punch envelope (metering only — never drives the cone)
        const a = Math.abs(drive);
        this.envFast = Math.max(a, this.envFast - dt * 7);
        this.envSlow = Math.max(a, this.envSlow - dt * 1.6);
        driveRate = this.ctx.sampleRate;
        hasDrive = true;
      }
      // full-band metering
      if (this.fullAnalyser) {
        this.fullAnalyser.getFloatTimeDomainData(this.timeBuf);
        let sum = 0, pk = 0;
        for (let i = 0; i < this.timeBuf.length; i++) { const v = this.timeBuf[i]; sum += v * v; pk = Math.max(pk, Math.abs(v)); }
        rms = Math.sqrt(sum / this.timeBuf.length);
        peak = pk;
        this.fullAnalyser.getByteFrequencyData(this.specBuf);
        const nyq = this.ctx!.sampleRate / 2;
        const binHz = nyq / this.specBuf.length;
        const band = (f0: number, f1: number) => {
          let sum = 0, n = 0;
          for (let b = Math.floor(f0 / binHz); b <= Math.min(this.specBuf.length - 1, Math.ceil(f1 / binHz)); b++) { sum += this.specBuf[b]; n++; }
          return n ? (sum / n) / 255 : 0;
        };
        bass = band(20, hfCutoffHz);
        mid = band(hfCutoffHz, 2000);
        high = band(2000, 16000);
      }
    } else {
      this.envFast = Math.max(0, this.envFast - dt * 5);
      this.envSlow = Math.max(0, this.envSlow - dt * 2);
    }

    return {
      drive, rms, peak, bass, mid, high, spectrum: this.specBuf, playing,
      driveSamples: hasDrive ? this.driveNorm : null,
      driveSampleRate: driveRate
    };
  }

  /** Punch factor 0..1 for visual emphasis. */
  get punch(): number { return Math.min(1, this.envFast * 0.7 + this.envSlow * 0.5); }

  // ------------------------------------------------------------ state
  get sampleRate(): number { return this.ctx?.sampleRate ?? 0; }
  get currentTime(): number { return this.el.currentTime || 0; }
  get duration(): number { return isFinite(this.el.duration) ? this.el.duration : 0; }
  get paused(): boolean { return this.el.paused; }
  get fileName(): string { return this.el.src ? this.fileNameFromSrc : ''; }
  get hasSource(): boolean { return !!this.el.src; }

  private get fileNameFromSrc(): string {
    return (this.el as any).__fileName ?? '';
  }
  set fileName(v: string) { (this.el as any).__fileName = v; }

  dispose(): void {
    this.stopTestTone();
    this.el.pause();
    this.el.removeAttribute('src');
    this.el.load();
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    void this.ctx?.close();
  }
}
