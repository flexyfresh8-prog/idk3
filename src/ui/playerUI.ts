// Bottom transport bar: file import, drag & drop, play/pause/restart/seek,
// volume, mute, spectrum + level meters. Handles browser autoplay policy by
// creating/resuming the AudioContext only inside user gestures.
// v2: SVG transport icons, spectrum with peak-hold caps + gradient bars.
import type { AudioEngine } from '../audio/audioEngine';
import { paintRange } from './paintRange';

const SVG_PLAY = '<svg viewBox="0 0 24 24" class="ic" aria-hidden="true"><path d="M8 5.5v13a1 1 0 0 0 1.55.83l10-6.5a1 1 0 0 0 0-1.66l-10-6.5A1 1 0 0 0 8 5.5Z" fill="currentColor"/></svg>';
const SVG_PAUSE = '<svg viewBox="0 0 24 24" class="ic" aria-hidden="true"><rect x="6" y="4.5" width="4.2" height="15" rx="1.2" fill="currentColor"/><rect x="13.8" y="4.5" width="4.2" height="15" rx="1.2" fill="currentColor"/></svg>';
const SVG_VOL = '<svg viewBox="0 0 24 24" class="ic" aria-hidden="true"><path d="M4 9.5v5a1 1 0 0 0 1 1h2.6l3.9 3.2a.9.9 0 0 0 1.5-.7V6a.9.9 0 0 0-1.5-.7L7.6 8.5H5a1 1 0 0 0-1 1Z" fill="currentColor"/><path d="M15.5 9a4.2 4.2 0 0 1 0 6M17.8 6.6a7.6 7.6 0 0 1 0 10.8" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round"/></svg>';
const SVG_MUTED = '<svg viewBox="0 0 24 24" class="ic" aria-hidden="true"><path d="M4 9.5v5a1 1 0 0 0 1 1h2.6l3.9 3.2a.9.9 0 0 0 1.5-.7V6a.9.9 0 0 0-1.5-.7L7.6 8.5H5a1 1 0 0 0-1 1Z" fill="currentColor"/><path d="m15.5 9.5 5 5m0-5-5 5" stroke="currentColor" stroke-width="1.9" fill="none" stroke-linecap="round"/></svg>';

export class PlayerUI {
  private seekDrag = false;
  private fileInput: HTMLInputElement;
  private peaks: number[] = [];   // spectrum peak-hold caps
  private peakAge: number[] = [];

  constructor(
    private engine: AudioEngine,
    private ui: {
      fileChip: HTMLElement;
      playBtn: HTMLButtonElement;
      restartBtn: HTMLButtonElement;
      seek: HTMLInputElement;
      time: HTMLElement;
      volume: HTMLInputElement;
      muteBtn: HTMLButtonElement;
      importBtn: HTMLButtonElement;
      testBtn: HTMLButtonElement;
      spectrum: HTMLCanvasElement;
      bassBar: HTMLElement; midBar: HTMLElement; highBar: HTMLElement;
      excursionOut: HTMLElement;
      dropOverlay: HTMLElement;
      toast: (msg: string, kind?: 'info' | 'error') => void;
    }
  ) {
    this.fileInput = document.createElement('input');
    this.fileInput.type = 'file';
    this.fileInput.accept = 'audio/*,.mp3,.m4a,.wav,.ogg,.flac';
    this.fileInput.style.display = 'none';
    document.body.appendChild(this.fileInput);

    // transport icon defaults
    this.ui.playBtn.innerHTML = SVG_PLAY;
    this.ui.muteBtn.innerHTML = SVG_VOL;

    this.wire();
    this.drawSpectrum(null, 0);
  }

  private wire(): void {
    const u = this.ui;

    u.importBtn.addEventListener('click', () => this.fileInput.click());
    this.fileInput.addEventListener('change', () => {
      const f = this.fileInput.files?.[0];
      if (f) void this.loadFile(f);
      this.fileInput.value = '';
    });

    // drag & drop (desktop + touch-pen)
    const ov = u.dropOverlay;
    let dragDepth = 0;
    window.addEventListener('dragenter', (e) => { e.preventDefault(); dragDepth++; ov.classList.add('show'); });
    window.addEventListener('dragover', (e) => e.preventDefault());
    window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; ov.classList.remove('show'); } });
    window.addEventListener('drop', (e) => {
      e.preventDefault();
      dragDepth = 0;
      ov.classList.remove('show');
      const f = e.dataTransfer?.files?.[0];
      if (f) void this.loadFile(f);
    });

    u.playBtn.addEventListener('click', () => {
      if (!this.engine.hasSource) { u.toast('Import an MP3 first — or use the bass test tone.', 'info'); return; }
      if (this.engine.paused) void this.engine.play(); else this.engine.pause();
    });
    u.restartBtn.addEventListener('click', () => {
      if (!this.engine.hasSource) return;
      this.engine.restart();
    });

    u.seek.addEventListener('input', () => {
      this.seekDrag = true;
      u.time.textContent = `${fmt(parseFloat(u.seek.value))} / ${fmt(this.engine.duration)}`;
    });
    u.seek.addEventListener('change', () => {
      this.engine.seek(parseFloat(u.seek.value));
      this.seekDrag = false;
    });

    u.volume.addEventListener('input', () => {
      const v = parseFloat(u.volume.value);
      this.engine.setVolume(v);
      u.muteBtn.classList.toggle('active', v === 0);
      u.muteBtn.innerHTML = v === 0 ? SVG_MUTED : SVG_VOL;
    });
    u.muteBtn.addEventListener('click', () => {
      const muted = u.muteBtn.classList.contains('active');
      u.muteBtn.classList.toggle('active', !muted);
      if (muted) {
        this.engine.setVolume(parseFloat(u.volume.value));
        u.muteBtn.innerHTML = SVG_VOL;
      } else {
        this.engine.setMuted(true);
        u.muteBtn.innerHTML = SVG_MUTED;
      }
    });

    u.testBtn.addEventListener('click', () => {
      if (this.engine.testToneActive) {
        this.engine.stopTestTone();
        u.testBtn.classList.remove('active');
        u.testBtn.innerHTML = `${IC_WAVE}<span class="btn-txt">Bass test tone</span>`;
      } else {
        this.engine.startTestTone();
        u.testBtn.classList.add('active');
        u.testBtn.innerHTML = `${IC_STOP}<span class="btn-txt">Stop test tone</span>`;
      }
    });

    // paint all range fills once + keep them painted on any input
    document.querySelectorAll<HTMLInputElement>('input[type="range"]').forEach(paintRange);
    document.addEventListener('input', (e) => {
      const t = e.target as HTMLInputElement;
      if (t && t.type === 'range') paintRange(t);
    });

    this.engine.onStateChange = () => this.syncPlayState();
  }

  async loadFile(f: File): Promise<void> {
    const u = this.ui;
    u.fileChip.textContent = `Loading ${f.name}…`;
    try {
      const { name, duration } = await this.engine.loadFile(f);
      this.engine.fileName = name;
      u.fileChip.textContent = name;
      u.seek.max = String(duration);
      u.seek.value = '0';
      paintRange(u.seek);
      u.time.textContent = `0:00 / ${fmt(duration)}`;
      u.toast(`Loaded ${name} — press play. Files never leave your device.`, 'info');
      // auto-play inside the same user gesture chain (import click / drop)
      void this.engine.play();
      this.syncPlayState();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error while loading the file.';
      u.fileChip.textContent = 'No file loaded';
      u.toast(msg, 'error');
    }
  }

  syncPlayState(): void {
    const playing = !this.engine.paused && this.engine.hasSource;
    this.ui.playBtn.innerHTML = playing ? SVG_PAUSE : SVG_PLAY;
    this.ui.playBtn.setAttribute('aria-label', playing ? 'Pause' : 'Play');
  }

  /** Called every animation frame. */
  frame(): void {
    const u = this.ui;
    if (this.engine.hasSource) {
      if (!this.seekDrag) {
        u.seek.value = String(this.engine.currentTime);
        paintRange(u.seek);
      }
      if (!this.seekDrag) {
        u.time.textContent = `${fmt(this.engine.currentTime)} / ${fmt(this.engine.duration)}`;
      }
    }
  }

  /** v2 spectrum: log-spaced gradient bars + falling peak-hold caps. */
  drawSpectrum(spectrum: Uint8Array | null, sampleRate: number): void {
    const canvas = this.ui.spectrum;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    // baseline grid
    ctx.strokeStyle = 'rgba(148,163,184,0.08)';
    ctx.lineWidth = 1;
    for (let gy = 1; gy <= 3; gy++) {
      const y = Math.round((gy / 4) * h) + 0.5;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }

    if (!spectrum || !sampleRate) return;
    const nyq = sampleRate / 2;
    const bins = spectrum.length;
    const bars = 44;
    const fMin = 30, fMax = 16000;
    const bw = w / bars;

    if (this.peaks.length !== bars) {
      this.peaks = new Array(bars).fill(0);
      this.peakAge = new Array(bars).fill(0);
    }

    for (let i = 0; i < bars; i++) {
      // log-spaced band for each bar
      const f0 = fMin * Math.pow(fMax / fMin, i / bars);
      const f1 = fMin * Math.pow(fMax / fMin, (i + 1) / bars);
      const b0 = Math.max(0, Math.floor(f0 / nyq * bins));
      const b1 = Math.max(b0 + 1, Math.min(bins - 1, Math.ceil(f1 / nyq * bins)));
      let sum = 0;
      for (let b = b0; b <= b1; b++) sum += spectrum[b];
      const v = (sum / (b1 - b0 + 1)) / 255;
      const bh = Math.max(2, v * (h - 4));
      const x = i * bw;

      // bar: cyan → violet → rose across the spectrum
      const t = i / (bars - 1);
      const hue = 188 + t * 85;      // 188 (cyan) → 273 (violet)
      const light = 52 + v * 24;
      ctx.fillStyle = `hsl(${hue} 88% ${light}%)`;
      ctx.shadowColor = `hsla(${hue}, 90%, 60%, 0.55)`;
      ctx.shadowBlur = 6;
      roundRect(ctx, x + 1.5, h - bh, bw - 3, bh, 2);
      ctx.fill();
      ctx.shadowBlur = 0;

      // peak-hold cap: rises instantly, falls after a beat
      if (v * h > this.peaks[i]) { this.peaks[i] = bh; this.peakAge[i] = 0; }
      else if (++this.peakAge[i] > 22) this.peaks[i] = Math.max(0, this.peaks[i] - 0.8);
      const py = h - this.peaks[i] - 2.5;
      if (this.peaks[i] > 3) {
        ctx.fillStyle = `hsla(${hue}, 90%, 75%, 0.85)`;
        ctx.fillRect(x + 1.5, py, bw - 3, 1.6);
      }
    }
  }

  setLevels(bass: number, mid: number, high: number, excursionMM: number): void {
    this.ui.bassBar.style.width = `${Math.min(100, bass * 130)}%`;
    this.ui.midBar.style.width = `${Math.min(100, mid * 130)}%`;
    this.ui.highBar.style.width = `${Math.min(100, high * 130)}%`;
    this.ui.excursionOut.textContent = `${excursionMM >= 0 ? '+' : ''}${excursionMM.toFixed(1)}`;
    this.ui.excursionOut.style.color = excursionMM >= 0 ? 'var(--accent)' : 'var(--accent-2)';
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

const IC_WAVE = '<svg viewBox="0 0 24 24" class="ic" aria-hidden="true"><path d="M2 12h2l2-6 3 12 3-9 2 5 2-3h6" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const IC_STOP = '<svg viewBox="0 0 24 24" class="ic" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor"/></svg>';

function fmt(t: number): string {
  if (!isFinite(t) || t < 0) t = 0;
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}
