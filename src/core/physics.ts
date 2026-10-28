// idk3 v3 — FULLY COUPLED electro-mechanical cone mechanics.
//
// v2 used a 3-state model where back-EMF braking was a separate bolted-on
// damping term. v3 replaces it with the textbook (Klippel-style) lumped
// transducer model in which the ELECTRICAL and MECHANICAL domains are truly
// coupled — the audio signal is a VOLTAGE across the voice coil, and every
// cross-domain effect emerges from the physics instead of being faked:
//
//   Electrical domain (voice-coil circuit):
//     Le(x)·di/dt = V(t) − Re·i − Bl(x)·v
//
//     V(t)  — drive voltage: the actual low-passed, AGC-normalized music
//             samples (±1.4 full scale)
//     i     — coil current state. Force is NOT proportional to voltage; it
//             is proportional to current, and current has its own dynamics.
//     Re    — DC resistance
//     Le(x) — NONLINEAR inductance: droops as the coil leaves the gap
//             (Le = Le0 / (1 + kL·s²)), adding real inductive phase lag and
//             top-end force softening at large excursion.
//     Bl(x)·v — BACK-EMF. The moving coil is a generator: its velocity
//             opposes the drive current. Electromagnetic braking (the Bl²/Re
//             "damping" of v2) is no longer a term we add — it FALLS OUT of
//             this coupling, including its correct frequency dependence.
//
//   Mechanical domain (Newton, normalized moving mass m):
//     m·a = Bl(x)·i − k(x)·x − cMech·v − cAero·v·|v|
//
//     Bl(x)  — nonlinear force factor: smooth quadratic falloff once the
//              coil exits the magnetic gap (extreme travel softens).
//     k(x)   — suspension stiffness: linear + Duffing hardening past Xmax
//              (progressive spider stiffening) + slight outward/inward
//              asymmetry + OPTIONAL SEALED-BOX AIR SPRING (boxLoad): a
//              closed enclosure adds compliance, raising the effective
//              resonance exactly like a real closed box (√(1+0.9·load)).
//     cMech  — mechanical losses (spider/surround) from "Motion smoothing".
//     cAero  — quadratic air-load: turbulence limits runaway velocity.
//     m      — normalized moving mass (new "Cone mass" param): heavier
//              cones attack slower and overshoot deeper at the same damping.
//
// Calibration: with Bl = 1 (normalized), back-EMF damping = Bl²/Re = 1/Re.
// We set Re = 1/(EM_SHARE·2ζωn) so the total damping ratio at rest equals
// the v2 feel, and derive the voltage gain so a full-scale sine AT resonance
// produces ≈ 1.25 × Xmax of excursion (the same headroom convention v2 used).
//
// Integration: RK4, one step per AUDIO SAMPLE (h ≈ 20.8 µs @ 48 kHz). The
// electrical time constant τ = Le0/Re resolves in ~6 sub-steps, the mechanical
// resonance with >1000× margin. The motion you see is the actual solution of
// the coupled ODEs for the actual music samples — not a tween.

const TWO_PI = Math.PI * 2;

// Model constants
const LE_TAU = 0.00035;        // electrical time constant Le0/Re (s)
const EM_SHARE = 0.38;         // share of total damping realized as back-EMF
const BL_ROLL_OFF = 0.42;      // force-factor falloff depth at extreme x
const BL_SPAN = 1.7;           // falloff span (× Xmax)
const LE_DROOP = 0.35;         // inductance droop depth at extreme x
const SPRING_ASYMMETRY = 0.16; // outward-stiffer asymmetry (× x/Xmax)
const AERO_COEFF = 0.05;       // quadratic air-load coefficient
const BOX_K = 0.9;             // sealed-box stiffness gain at boxLoad = 1

export interface StepOpts {
  voltageGain: number; // drive voltage (normalized) per unit of AGC audio
  zeta: number;        // user damping ratio 0.30..0.85 (mech + EM combined)
  maxUnits: number;    // Xmax (world units) — progressive stiffening beyond this
  resonanceHz?: number; // driver free-air resonance Fs (default 32 Hz)
  boxLoad?: number;    // sealed-enclosure air-spring load 0..1 (default 0)
  coneMass?: number;   // normalized moving mass 0.6..1.8 (default 1)
}

/** Voltage gain that makes a full-scale sine at resonance produce ≈
 *  1.25 × Xmax of excursion (matches the v2 headroom convention).
 *  Derivation: x_res ≈ V·(cEm/cTotal)/ωn = V·EM_SHARE/ωn for Bl = 1. */
export function calibratedVoltageGain(maxUnits: number, resonanceHz: number): number {
  const wn = TWO_PI * Math.max(5, resonanceHz);
  return 1.25 * maxUnits * wn / EM_SHARE;
}

export class ExcursionPhysics {
  private i = 0;          // coil current (normalized)
  private x = 0;          // displacement (world units, along driver axis)
  private v = 0;          // velocity (world units / s)
  private lastRes = 32;   // cached resonance for silent-path integration

  /** Force factor Bl(x): 1 in the gap, smoothly falling once the coil leaves. */
  private static blFall(x: number, maxUnits: number): number {
    const s = Math.abs(x) / (maxUnits * BL_SPAN);
    if (s >= 1) return 1 - BL_ROLL_OFF;
    return 1 - BL_ROLL_OFF * s * s;
  }

  /** Inductance droop Le(x): the gap gets "leaky" at large excursion. */
  private static leDrop(x: number, maxUnits: number, le0: number): number {
    const s = Math.abs(x) / (maxUnits * BL_SPAN);
    if (s >= 1) return le0 / (1 + LE_DROOP);
    return le0 / (1 + LE_DROOP * s * s);
  }

  /** Suspension stiffness k(x): box spring + Duffing hardening + asymmetry. */
  private static stiff(x: number, wn2: number, maxUnits: number, boxLoad: number): number {
    let k = wn2 * (1 + BOX_K * boxLoad);
    const over = Math.abs(x) - maxUnits;
    if (over > 0) {
      const q = over / maxUnits;
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
    const { voltageGain, zeta, maxUnits } = opts;
    const fs = opts.resonanceHz && opts.resonanceHz > 5 ? opts.resonanceHz : 32;
    this.lastRes = fs;
    const wn = TWO_PI * fs;
    const wn2 = wn * wn;
    const boxLoad = opts.boxLoad ?? 0;
    const mass = Math.max(0.2, opts.coneMass ?? 1);

    // Electrical parameters: back-EMF realizes EM_SHARE of the total damping.
    const cTotal = 2 * zeta * wn;
    const cEm = EM_SHARE * cTotal;              // = Bl²/Re with Bl = 1
    const re = 1 / Math.max(1e-9, cEm);         // DC resistance
    const le0 = LE_TAU * re;                    // τ = Le0/Re
    const cMech = cTotal - cEm;                 // spider/surround losses
    const cAero = AERO_COEFF * wn2 * maxUnits;  // scales with the suspension

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
      // silent path: no drive, pure electro-mechanical ring-down.
      // Sub-step capped at 4 ms so RK4 stays comfortably inside its stability
      // region even after a long stall (background tab → dt up to 100 ms).
      const span = Math.min(Math.max(dt, 1 / 120), 0.12);
      n = Math.max(8, Math.ceil(span / 0.004));
      h = span / n;
    }

    // RK4 over the 3-state system y = (i, x, v)
    const y0 = [this.i, this.x, this.v];
    const k1 = [0, 0, 0], k2 = [0, 0, 0], k3 = [0, 0, 0], k4 = [0, 0, 0];
    const yTmp = [0, 0, 0];

    const deriv = (y: number[], V: number, out: number[]): void => {
      const [ii, xx, vv] = y;
      // electrical: Le(x)·di/dt = V − Re·i − Bl(x)·v   (back-EMF coupled)
      const le = ExcursionPhysics.leDrop(xx, maxUnits, le0);
      out[0] = (V - re * ii - ExcursionPhysics.blFall(xx, maxUnits) * vv) / le;
      // mechanical: m·a = Bl(x)·i − k(x)·x − cMech·v − cAero·v·|v|
      const bl = ExcursionPhysics.blFall(xx, maxUnits);
      const k = ExcursionPhysics.stiff(xx, wn2, maxUnits, boxLoad);
      const aero = cAero * vv * Math.abs(vv) / Math.max(1e-9, maxUnits);
      out[2] = (bl * ii - k * xx - cMech * vv - aero) / mass;
      out[1] = vv;
    };

    for (let i = 0; i < n; i++) {
      const V = src ? src[i] * voltageGain : 0;

      deriv(y0, V, k1);
      for (let s = 0; s < 3; s++) yTmp[s] = y0[s] + 0.5 * h * k1[s];
      const Vh = src && i + 1 < n ? (src[i] + src[i + 1]) * 0.5 * voltageGain : V;
      deriv(yTmp, Vh, k2);
      for (let s = 0; s < 3; s++) yTmp[s] = y0[s] + 0.5 * h * k2[s];
      deriv(yTmp, Vh, k3);
      for (let s = 0; s < 3; s++) yTmp[s] = y0[s] + h * k3[s];
      deriv(yTmp, src && i + 1 < n ? src[i + 1] * voltageGain : V, k4);

      for (let s = 0; s < 3; s++) {
        y0[s] += (h / 6) * (k1[s] + 2 * k2[s] + 2 * k3[s] + k4[s]);
      }

      // numeric safety: the nonlinear terms can push energy in on absurd
      // slider settings; a hard velocity clamp keeps the sim sane.
      const vMax = 40 * maxUnits;
      if (y0[2] > vMax) y0[2] = vMax; else if (y0[2] < -vMax) y0[2] = -vMax;
      if (!isFinite(y0[1])) { y0[1] = 0; y0[2] = 0; y0[0] = 0; }
    }

    this.i = y0[0];
    this.x = y0[1];
    this.v = y0[2];
    return this.x;
  }

  reset(): void { this.x = 0; this.v = 0; this.i = 0; }

  get displacement(): number { return this.x; }
  get velocity(): number { return this.v; }
  get coilCurrent(): number { return this.i; }
  get resonanceHz(): number { return this.lastRes; }
}
