// Bottom transport bar: file import, drag & drop, play/pause/restart/seek,
// volume, mute, spectrum + level meters. Handles browser autoplay policy by
// creating/resuming the AudioContext only inside user gestures.
import type { AudioEngine } from '../audio/audioEngine';

export class PlayerUI {
  private seekDrag = false;
  private fileInput: HTMLInputElement;

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
    });
    u.muteBtn.addEventListener('click', () => {
      const muted = u.muteBtn.classList.contains('active');
      u.muteBtn.classList.toggle('active', !muted);
      if (muted) { this.engine.setVolume(parseFloat(u.volume.value)); }
      else this.engine.setMuted(true);
    });

    u.testBtn.addEventListener('click', () => {
      if (this.engine.testToneActive) {
        this.engine.stopTestTone();
        u.testBtn.classList.remove('active');
        u.testBtn.textContent = '▶ Bass test tone';
      } else {
        this.engine.startTestTone();
        u.testBtn.classList.add('active');
        u.testBtn.textContent = '■ Stop test tone';
      }
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
    this.ui.playBtn.textContent = playing ? '❚❚' : '▶';
    this.ui.playBtn.setAttribute('aria-label', playing ? 'Pause' : 'Play');
  }

  /** Called every animation frame. */
  frame(): void {
    const u = this.ui;
    if (this.engine.hasSource) {
      if (!this.seekDrag) {
        u.seek.value = String(this.engine.currentTime);
      }
      if (!this.seekDrag) {
        u.time.textContent = `${fmt(this.engine.currentTime)} / ${fmt(this.engine.duration)}`;
      }
    }
  }

  drawSpectrum(spectrum: Uint8Array | null, sampleRate: number): void {
    const u = this.ui;
    const canvas = u.spectrum;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(255,255,255,0.045)';
    ctx.fillRect(0, 0, w, h);
    if (!spectrum || !sampleRate) return;
    const nyq = sampleRate / 2;
    const bins = spectrum.length;
    const bars = 44;
    const fMin = 30, fMax = 16000;
    for (let i = 0; i < bars; i++) {
      // log-spaced band for each bar
      const f0 = fMin * Math.pow(fMax / fMin, i / bars);
      const f1 = fMin * Math.pow(fMax / fMin, (i + 1) / bars);
      const b0 = Math.max(0, Math.floor(f0 / nyq * bins));
      const b1 = Math.max(b0 + 1, Math.min(bins - 1, Math.ceil(f1 / nyq * bins)));
      let sum = 0;
      for (let b = b0; b <= b1; b++) sum += spectrum[b];
      const v = (sum / (b1 - b0 + 1)) / 255;
      const bh = Math.max(2, v * h);
      const x = (i / bars) * w;
      const hue = 22 + (i / bars) * 30;
      ctx.fillStyle = `hsl(${hue} 92% ${42 + v * 22}%)`;
      ctx.fillRect(x + 1, h - bh, w / bars - 2, bh);
    }
  }

  setLevels(bass: number, mid: number, high: number, excursionMM: number): void {
    this.ui.bassBar.style.width = `${Math.min(100, bass * 130)}%`;
    this.ui.midBar.style.width = `${Math.min(100, mid * 130)}%`;
    this.ui.highBar.style.width = `${Math.min(100, high * 130)}%`;
    this.ui.excursionOut.textContent = `${excursionMM >= 0 ? '+' : ''}${excursionMM.toFixed(1)}`;
  }
}

function fmt(t: number): string {
  if (!isFinite(t) || t < 0) t = 0;
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}
