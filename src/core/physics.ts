// Cone excursion physics: a damped mass-spring follower driven by the
// processed bass signal, with soft excursion limiting (no hard clipping).
// This produces smooth, continuous, audio-synchronized motion at display
// frame rates and returns exactly to rest when the drive stops.
export class ExcursionPhysics {
  private x = 0;       // current displacement (units)
  private v = 0;       // velocity (units/s)

  /** Advance the simulation. Returns the new displacement in units. */
  update(dt: number, targetUnits: number, maxUnits: number, smoothing: number): number {
    const dtClamped = Math.min(dt, 1 / 20);
    const omega = 34 - 20 * clamp01(smoothing);   // stiffness: 34 → 14 rad/s
    const zeta = 0.5 + 0.65 * clamp01(smoothing); // damping ratio
    const steps = 2;
    const h = dtClamped / steps;
    for (let s = 0; s < steps; s++) {
      const a = omega * omega * (targetUnits - this.x) - 2 * zeta * omega * this.v;
      this.v += a * h;
      this.x += this.v * h;
      // soft limiter beyond maxUnits
      const over = Math.abs(this.x) - maxUnits;
      if (over > 0) {
        const sign = Math.sign(this.x);
        this.v -= sign * over * 320 * h;
      }
    }
    return this.x;
  }

  reset(): void { this.x = 0; this.v = 0; }

  get displacement(): number { return this.x; }
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
