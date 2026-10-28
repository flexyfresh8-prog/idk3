// TRUE sample-accurate cone mechanics ("dot to dot").
//
// The moving assembly is simulated as a real second-order electro-mechanical
// system driven BY THE AUDIO ITSELF, one physics step per audio sample:
//
//   m·a(t) = F(t) − k(x)·x − c·v
//
//   F(t)  — voice-coil force, proportional to the low-passed audio waveform
//           (current ⇔ signal). NOT an envelope, NOT a tween target: every
//          sample of the music pushes the cone directly, so a 45 Hz test
//          tone produces a 45 Hz excursion, a kick produces the kick's own
//          transient, and the phase lag of a real driver is preserved.
//   k(x)  — suspension stiffness: linear in the linear region, then
//           PROGRESSIVELY stiffening beyond Xmax (what a real spider +
//           surround do). No fake hard clipping, no fake damping — the
//           limit is a physical spring nonlinearity, so overshoot and
//           return are calculated, and the cone always comes back.
//   c     — mechanical damping (losses of spider + surround + air).
//
// Integration: semi-implicit Euler at the AUDIO sample rate (h = 1/fs),
// which resolves the driver resonance (Fs = 32 Hz) with >1000× margin —
// the motion you see is the actual solution of the differential equation
// for the actual music samples.
//
// Model constants (normalized mass m = 1):
//   Fs = 32 Hz  — free-air resonance of a typical 10–12" subwoofer
//   ζ  = user "Motion smoothing" (0.30..0.85) — real mechanical damping ratio

const FS_HZ = 32;                      // driver free-air resonance (Hz)
const TWO_PI = Math.PI * 2;

export interface StepOpts {
  forceGain: number;   // world-units force per unit of normalized audio
  zeta: number;        // damping ratio 0.3..0.9
  maxUnits: number;    // Xmax (world units) — progressive stiffening beyond this
}

export class ExcursionPhysics {
  private x = 0;       // displacement (world units, along driver axis)
  private v = 0;       // velocity (world units / s)

  /**
   * Integrate the mechanical model through the latest audio samples.
   * @param samples     low-passed, AGC-normalized audio (−1.4..1.4), oldest→newest.
   *                    Pass null/empty to integrate silence (cone rings down naturally).
   * @param sampleRate  audio sample rate (Hz)
   * @param dt          frame delta (s) — keeps integration time-correct after stalls
   */
  stepAudio(samples: Float32Array | null, sampleRate: number, dt: number, opts: StepOpts): number {
    const { forceGain, zeta, maxUnits } = opts;
    const wn = TWO_PI * FS_HZ;
    const cDamp = 2 * zeta * wn;

    let n: number;
    let h: number;
    let src: Float32Array | null = null;

    if (samples && samples.length > 0 && sampleRate > 0 && dt > 0) {
      // Normally n == dt·fs and h == 1/fs → true dot-to-dot integration.
      // After a frame stall the newest available samples are stretched over
      // the frame so the cone never jumps and never falls behind.
      const want = Math.round(dt * sampleRate);
      n = Math.min(samples.length, Math.max(1, want));
      src = samples.subarray(samples.length - n);
      h = dt / n;
    } else {
      // silent path: no force, pure mechanical ring-down.
      // Sub-step is capped at 4 ms so the damped integrator stays stable
      // even after a long frame stall (background tab → dt up to 100 ms);
      // a fixed 8-step split could make h exceed the stability limit
      // (h < 1/(ζ·ωₙ) ≈ 6 ms) and blow the state up.
      const span = Math.min(Math.max(dt, 1 / 120), 0.12);
      n = Math.max(8, Math.ceil(span / 0.004));
      h = span / n;
    }

    const wn2 = wn * wn;
    const inv = 1 / Math.max(1e-6, maxUnits);

    for (let i = 0; i < n; i++) {
      const F = src ? forceGain * src[i] : 0;
      // progressive suspension: stiffness rises smoothly past Xmax
      // (quadratic hardening — the classic Duffing spider model)
      const over = Math.abs(this.x) - maxUnits;
      const k = over > 0 ? wn2 * (1 + 8 * (over * inv) * (over * inv)) : wn2;
      const a = F - k * this.x - cDamp * this.v;
      this.v += a * h;
      this.x += this.v * h;
    }
    return this.x;
  }

  reset(): void { this.x = 0; this.v = 0; }

  get displacement(): number { return this.x; }
}
