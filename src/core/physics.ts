// idk3 v2 — TRUE electro-mechanical cone mechanics ("dot to dot"), reworked.
//
// The moving assembly is a real 3-state electro-mechanical system driven BY
// THE AUDIO ITSELF, integrated one physics step per audio sample with RK4:
//
//   Electrical (voice-coil current lag):
//     τ_i · dF/dt = F_target(t) − F
//
//     F is the effective "current force" state. The drive voltage V(t) (the
//     low-passed music sample) does not teleport into force: the coil has
//     inductance + resistance, so force slews toward the target with a short
//     time constant τ_i ≈ 0.35 ms. This adds the correct extra phase lag at
//     high frequency and softens sub-sample transients like a real amp+coil.
//
//   Mechanical (Newton, normalized mass m = 1):
//     a = F·Bl(x) − k(x)·x − c_mech·v − c_em·v − c_aero·v·|v|
//
//     Bl(x) — NONLINEAR force factor. As the coil leaves the magnetic gap at
//             large excursion the coupling weakens (a smooth quadratic
//             falloff), so extreme travel softens instead of buzzing.
//     k(x)  — suspension stiffness: linear in the working range, then
//             PROGRESSIVELY stiffening past Xmax (Duffing hardening — the
//             classic spider model), with a slight ASYMMETRY term: real
//             suspensions are stiffer outward than inward.
//     c_mech — spider/surround/air losses (from "Motion smoothing").
//     c_em   — ELECTROMAGNETIC braking from back-EMF (Bl²/Re in the physical
//             model): a velocity-proportional drag that exists only while the
//             coil moves in the gap. It is what compresses the resonance peak
//             of a real driver. Split from the user damping ratio.
//     c_aero — small quadratic (turbulent) air-load term: prevents runaway
//             velocity on extreme gain settings the way real air load does.
//
// Integration: RK4 at the AUDIO sample rate (h = 1/fs ≈ 20.8 µs at 48 kHz).
// The fastest time constant (τ_i) resolves with ~6 steps per time constant and
// the mechanical resonance with >1000× margin — the motion you see is the
// actual solution of the coupled differential equations for the actual music
// samples, not a tween.

const TWO_PI = Math.PI * 2;

// Model constants
const TAU_I = 0.00035;          // coil current lag (s) — Le/Re of a typical VC
const EM_DAMP_SHARE = 0.38;     // share of user damping delivered by back-EMF
const BL_ROLL_OFF = 0.42;       // force-factor falloff depth at extreme x
const BL_SPAN = 1.7;            // falloff span (× Xmax)
const SPRING_ASYMMETRY = 0.16;  // outward-stiffer asymmetry (× x/Xmax)
const AERO_COEFF = 0.05;        // quadratic air-load coefficient (tuned)

export interface StepOpts {
  forceGain: number;   // world-units of force per unit of normalized audio
  zeta: number;        // user damping ratio 0.30..0.85 (mech + EM combined)
  maxUnits: number;    // Xmax (world units) — progressive stiffening beyond this
  resonanceHz?: number; // driver free-air resonance Fs (default 32 Hz)
}

export class ExcursionPhysics {
  private x = 0;          // displacement (world units, along driver axis)
  private v = 0;          // velocity (world units / s)
  private F = 0;          // effective coil force state (lags the target)
  private lastRes = 32;   // cached resonance for silent-path integration

  /** Force factor Bl(x): 1 in the gap, smoothly falling once the coil leaves. */
  private static blFall(x: number, maxUnits: number): number {
    const s = Math.abs(x) / (maxUnits * BL_SPAN);
    if (s >= 1) return 1 - BL_ROLL_OFF;
    return 1 - BL_ROLL_OFF * s * s;
  }

  /** Suspension stiffness k(x): Duffing hardening past Xmax + asymmetry. */
  private static stiff(x: number, wn2: number, maxUnits: number): number {
    const over = Math.abs(x) - maxUnits;
    let k = wn2;
    if (over > 0) {
      const q = (over / maxUnits);
      k *= 1 + 8 * q * q;
    }
    // asymmetry: the suspension reads stiffer in the outward direction
    return k * (1 + SPRING_ASYMMETRY * (x / maxUnits));
  }

  /**
   * Integrate the coupled electro-mechanical model through the latest audio
   * samples with RK4, one step per sample.
   * @param samples     low-passed, AGC-normalized audio (−1.4..1.4), oldest→newest.
   *                    Pass null/empty to integrate silence (cone rings down naturally).
   * @param sampleRate  audio sample rate (Hz)
   * @param dt          frame delta (s) — keeps integration time-correct after stalls
   */
  stepAudio(samples: Float32Array | null, sampleRate: number, dt: number, opts: StepOpts): number {
    const { forceGain, zeta, maxUnits } = opts;
    const fs = opts.resonanceHz && opts.resonanceHz > 5 ? opts.resonanceHz : 32;
    this.lastRes = fs;
    const wn = TWO_PI * fs;
    const wn2 = wn * wn;

    // damping split: mechanical losses + electromagnetic back-EMF braking
    const cTotal = 2 * zeta * wn;
    const cEm = cTotal * EM_DAMP_SHARE;          // Bl²/Re effect
    const cMech = cTotal - cEm;
    const cAero = AERO_COEFF * wn2 * maxUnits;   // scales with the suspension

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
      // silent path: no drive, pure mechanical + EM ring-down.
      // Sub-step capped at 4 ms so RK4 stays comfortably inside its stability
      // region even after a long stall (background tab → dt up to 100 ms).
      const span = Math.min(Math.max(dt, 1 / 120), 0.12);
      n = Math.max(8, Math.ceil(span / 0.004));
      h = span / n;
    }

    // RK4 over the 3-state system y = (F, x, v)
    const y0 = [this.F, this.x, this.v];
    const k1 = [0, 0, 0], k2 = [0, 0, 0], k3 = [0, 0, 0], k4 = [0, 0, 0];
    const yTmp = [0, 0, 0];

    const deriv = (y: number[], V: number, out: number[]): void => {
      const [F, xx, vv] = y;
      out[0] = (forceGain * V - F) / TAU_I;                       // force slew
      const bl = ExcursionPhysics.blFall(xx, maxUnits);
      const k = ExcursionPhysics.stiff(xx, wn2, maxUnits);
      const aero = cAero * vv * Math.abs(vv) / Math.max(1e-9, maxUnits);
      out[2] = F * bl - k * xx - cMech * vv - cEm * vv - aero;    // acceleration
      out[1] = vv;                                                // velocity
    };

    for (let i = 0; i < n; i++) {
      const V = src ? src[i] : 0;

      deriv(y0, V, k1);
      for (let s = 0; s < 3; s++) yTmp[s] = y0[s] + 0.5 * h * k1[s];
      deriv(yTmp, (V + (src && i + 1 < n ? src[i + 1] : V)) * 0.5, k2);
      for (let s = 0; s < 3; s++) yTmp[s] = y0[s] + 0.5 * h * k2[s];
      deriv(yTmp, (V + (src && i + 1 < n ? src[i + 1] : V)) * 0.5, k3);
      for (let s = 0; s < 3; s++) yTmp[s] = y0[s] + h * k3[s];
      deriv(yTmp, src && i + 1 < n ? src[i + 1] : V, k4);

      for (let s = 0; s < 3; s++) {
        y0[s] += (h / 6) * (k1[s] + 2 * k2[s] + 2 * k3[s] + k4[s]);
      }

      // numeric safety: the nonlinear terms can push energy in on absurd
      // slider settings; a hard velocity clamp keeps the sim sane.
      const vMax = 40 * maxUnits;
      if (y0[2] > vMax) y0[2] = vMax; else if (y0[2] < -vMax) y0[2] = -vMax;
      if (!isFinite(y0[1])) { y0[1] = 0; y0[2] = 0; y0[0] = 0; }
    }

    this.F = y0[0];
    this.x = y0[1];
    this.v = y0[2];
    return this.x;
  }

  reset(): void { this.x = 0; this.v = 0; this.F = 0; }

  get displacement(): number { return this.x; }
  get velocity(): number { return this.v; }
  get resonanceHz(): number { return this.lastRes; }
}
