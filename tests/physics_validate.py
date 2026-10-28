#!/usr/bin/env python3
"""Numerical replica of src/core/physics.ts RK4 electro-mechanical model.

Goal: reproduce the user-reported "cone only moves 0-1mm" bug, then verify
the fix targets BEFORE editing TypeScript:

  Bug A (primary): velocity clamp vMax = 40*maxUnits = 0.4 m/s is frequency-
  blind. A 10mm cone at 36.7 Hz needs ~2.3 m/s peak velocity -> the clamp
  hard-caps sinusoidal excursion at vMax/(2*pi*f) ~ 1.0-1.8 mm.

  Bug B: quadratic aero drag 'cAero*v*|v|/maxUnits' is ~166x too strong
  (linearized zeta ~ 9 at Xmax velocity vs physical 0.05-0.1).

Fix targets (defaults: Xmax=10mm, Fs=32Hz, boxLoad=0.35, zeta=0.6025):
  T1  full-scale (1.4) sine at boxed resonance  -> peak ~ 1.15-1.35 * Xmax
  T2  full-scale sine 45 Hz                     -> peak ~ 6-10 mm
  T3  test-tone-like signal (45+62 Hz, AGC 1.0) -> peak ~ 4-8 mm
  T4  music-like bass (RMS~0.35, peak 1.0)      -> typical 1.5-5, peaks 7-11
  T5  small signal (0.1 sine @45)               -> ~0.4-1.5 mm (linear region)
"""
import math

TWO_PI = 2 * math.pi
LE_TAU = 0.00035
EM_SHARE = 0.38
BL_ROLL_OFF = 0.42
BL_SPAN = 1.7
LE_DROOP = 0.35
SPRING_ASYMMETRY = 0.16
BOX_K = 0.9

SR = 48000


def bl_fall(x, max_units):
    s = abs(x) / (max_units * BL_SPAN)
    if s >= 1:
        return 1 - BL_ROLL_OFF
    return 1 - BL_ROLL_OFF * s * s


def le_drop(x, max_units, le0):
    s = abs(x) / (max_units * BL_SPAN)
    if s >= 1:
        return le0 / (1 + LE_DROOP)
    return le0 / (1 + LE_DROOP * s * s)


def make_stiff(wn2, max_units, box_load):
    def stiff(x):
        k = wn2 * (1 + BOX_K * box_load)
        over = abs(x) - max_units
        if over > 0:
            q = over / max_units
            k *= 1 + 8 * q * q
        return k * (1 + SPRING_ASYMMETRY * (x / max_units))
    return stiff


def simulate(sig, v_gain, zeta=0.30 + 0.55 * 0.55, max_units=0.010,
             res_hz=32, box_load=0.35, cone_mass=1.0,
             aero_mode="buggy", aero_coeff=0.05, v_max_mode="buggy"):
    """Integrate the 3-state system with RK4, one step per sample (as TS does).

    aero_mode: 'buggy' = AERO_COEFF*wn2*maxUnits * v|v| / maxUnits   (current TS)
               'fixed' = AERO_COEFF*ke*maxUnits * (v/vChar)*|v/vChar|
    v_max_mode: 'buggy' = 40*maxUnits
                'fixed' = 3.5*wn*maxUnits
    """
    wn = TWO_PI * res_hz
    wn2 = wn * wn
    ke = wn2 * (1 + BOX_K * box_load)
    v_char = math.sqrt(ke) * max_units
    c_total = 2 * zeta * wn
    c_em = EM_SHARE * c_total
    re = 1 / max(1e-9, c_em)
    le0 = LE_TAU * re
    c_mech = c_total - c_em
    if aero_mode == "buggy":
        c_aero = aero_coeff * wn2 * max_units

        def aero_f(vv):
            return c_aero * vv * abs(vv) / max(1e-9, max_units)
    else:
        c_aero = aero_coeff * ke * max_units

        def aero_f(vv):
            r = vv / v_char
            return c_aero * r * abs(r)

    if v_max_mode == "buggy":
        v_max = 40 * max_units
    else:
        v_max = 3.5 * wn * max_units

    stiff = make_stiff(wn2, max_units, box_load)

    def deriv(y, v_drive):
        ii, xx, vv = y
        le = le_drop(xx, max_units, le0)
        d0 = (v_drive - re * ii - bl_fall(xx, max_units) * vv) / le
        bl = bl_fall(xx, max_units)
        k = stiff(xx)
        d2 = (bl * ii - k * xx - c_mech * vv - aero_f(vv)) / cone_mass
        return (d0, vv, d2)

    n = len(sig)
    h = 1.0 / SR
    i_s = x_s = v_s = 0.0
    xs = [0.0] * n
    for idx in range(n):
        v_drive = sig[idx] * v_gain
        y = (i_s, x_s, v_s)
        k1 = deriv(y, v_drive)
        yt = tuple(y[s] + 0.5 * h * k1[s] for s in range(3))
        k2 = deriv(yt, v_drive)
        yt = tuple(y[s] + 0.5 * h * k2[s] for s in range(3))
        k3 = deriv(yt, v_drive)
        yt = tuple(y[s] + h * k3[s] for s in range(3))
        k4 = deriv(yt, v_drive)
        y = tuple(y[s] + (h / 6) * (k1[s] + 2 * k2[s] + 2 * k3[s] + k4[s]) for s in range(3))
        if y[2] > v_max:
            y = (y[0], y[1], v_max)
        elif y[2] < -v_max:
            y = (y[0], y[1], -v_max)
        i_s, x_s, v_s = y
        xs[idx] = x_s
    # steady-state stats over the last 40%
    tail = xs[int(n * 0.6):]
    peak = max(abs(v) for v in tail)
    rms = math.sqrt(sum(v * v for v in tail) / len(tail))
    return peak, rms, xs


def agc_normalize(sig, chunk=2048):
    """Replicate the engine AGC: per-chunk peak with slow decay -> peak ~ 1.0."""
    out = [0.0] * len(sig)
    ref = 0.02
    dt = chunk / SR
    for start in range(0, len(sig), chunk):
        c = sig[start:start + chunk]
        pk = max(abs(v) for v in c)
        ref = max(pk, ref - ref * dt * 0.25, 0.02)
        inv = 1.0 / ref
        for j, v in enumerate(c):
            s = v * inv
            out[start + j] = max(-1.4, min(1.4, s))
    return out


def sine(freq, amp, seconds):
    n = int(seconds * SR)
    return [amp * math.sin(TWO_PI * freq * k / SR) for k in range(n)]


def music_like(seconds):
    """Bass-heavy music stand-in: 40/55/80 Hz + kick envelope, peak-norm ~1, RMS~0.35."""
    n = int(seconds * SR)
    sig = []
    for k in range(n):
        t = k / SR
        # kick envelope at 2 Hz
        ph = (t * 2.0) % 1.0
        env = math.exp(-ph * 5.5) * 0.9 + 0.18
        s = (0.55 * math.sin(TWO_PI * 40 * t)
             + 0.35 * math.sin(TWO_PI * 55 * t + 0.7)
             + 0.22 * math.sin(TWO_PI * 80 * t + 1.3))
        sig.append(s * env)
    pk = max(abs(v) for v in sig)
    return [v / pk for v in sig]


def test_tone_like(seconds):
    """Replicates engine.startTestTone(): 45+62 Hz sines, gain 0.5 +/- 0.32 LFO."""
    n = int(seconds * SR)
    sig = []
    for k in range(n):
        t = k / SR
        g = 0.5 + 0.32 * math.sin(TWO_PI * 0.28 * t)
        sig.append((math.sin(TWO_PI * 45 * t) + math.sin(TWO_PI * 62 * t)) * 0.5 * g)
    return agc_normalize(sig)


def report(title, peak, rms, xmax=10.0):
    print(f"  {title:<52} peak={peak*1000:7.2f} mm  ({peak/xmax*1e0*100:5.1f}% Xmax)  rms={rms*1000:6.2f} mm")


def main():
    wn = TWO_PI * 32
    box = 0.35
    we = wn * math.sqrt(1 + BOX_K * box)
    fe = we / TWO_PI
    xmax = 0.010
    print(f"effective boxed resonance: {fe:.1f} Hz")
    print(f"current TS vMax clamp    : {40*xmax:.3f} m/s")
    print(f"needed peak vel @Xmax,f_e: {we*xmax:.3f} m/s  <-- clamp is {we*xmax/(40*xmax):.1f}x too low")
    print(f"sinusoidal excursion cap by clamp: "
          f"{40*xmax/we*1000:.2f} mm @ {fe:.0f} Hz, "
          f"{40*xmax/(TWO_PI*45)*1000:.2f} mm @ 45 Hz, "
          f"{40*xmax/(TWO_PI*62)*1000:.2f} mm @ 62 Hz")
    print()

    old_gain = 1.25 * xmax * wn / EM_SHARE
    print("=== CURRENT (buggy) PHYSICS, vGain = 1.25*xmax*wn/EM_SHARE ===")
    for f in (fe, 45.0, 62.0):
        pk, rms, _ = simulate(sine(f, 1.4, 6.0), old_gain)
        report(f"full-scale 1.4 sine @ {f:.1f} Hz", pk, rms)
    tt = test_tone_like(8.0)
    pk, rms, _ = simulate(tt, old_gain)
    report("test tone (45+62 Hz, AGC peak=1.0)", pk, rms)
    mu = music_like(8.0)
    pk, rms, _ = simulate(mu, old_gain)
    report("music-like bass (peak 1.0, RMS~0.35)", pk, rms)
    pk, rms, _ = simulate(sine(45, 0.1, 6.0), old_gain)
    report("small 0.1 sine @ 45 Hz", pk, rms)

    # ------------------------------------------------ fix calibration: bisect K
    # gain = K * xmax * we   such that a full-scale (1.4) sine at the boxed
    # resonance peaks at exactly 1.25 * Xmax with fixed aero + fixed clamp.
    print("\n=== bisect K in gain = K * xmax * we for 1.25*Xmax at resonance ===")
    lo, hi = 1.0, 8.0
    for _ in range(40):
        mid = 0.5 * (lo + hi)
        pk, _, _ = simulate(sine(fe, 1.4, 6.0), mid * xmax * we, aero_mode="fixed", v_max_mode="fixed")
        if pk > 1.25 * xmax:
            hi = mid
        else:
            lo = mid
    K = 0.5 * (lo + hi)
    print(f"  K = {K:.4f}  (gain at defaults = {K*xmax*we:.3f})")

    print(f"\n=== TARGETS with gain = K*xmax*we, K={K:.4f} ===")
    gain = K * xmax * we
    for f in (fe, 45.0, 62.0):
        pk, rms, _ = simulate(sine(f, 1.4, 6.0), gain, aero_mode="fixed", v_max_mode="fixed")
        report(f"T1/T2 full-scale 1.4 sine @ {f:.1f} Hz", pk, rms)
    pk, rms, _ = simulate(sine(fe, 1.0, 6.0), gain, aero_mode="fixed", v_max_mode="fixed")
    report("T2b 1.0 sine @ boxed res", pk, rms)
    tt = test_tone_like(8.0)
    pk, rms, _ = simulate(tt, gain, aero_mode="fixed", v_max_mode="fixed")
    report("T3 test tone (AGC peak=1.0)", pk, rms)
    mu = music_like(8.0)
    pk, rms, _ = simulate(mu, gain, aero_mode="fixed", v_max_mode="fixed")
    report("T4 music-like bass (peak 1.0, RMS~0.35)", pk, rms)
    pk, rms, _ = simulate(sine(45, 0.1, 6.0), gain, aero_mode="fixed", v_max_mode="fixed")
    report("T5 small 0.1 sine @ 45 Hz", pk, rms)

    # boxLoad extremes sanity
    for bl in (0.0, 1.0):
        we_b = wn * math.sqrt(1 + BOX_K * bl)
        g_b = K * xmax * we_b
        pk, _, _ = simulate(sine(we_b / TWO_PI, 1.4, 6.0), g_b, aero_mode="fixed",
                            v_max_mode="fixed", box_load=bl)
        print(f"  boxLoad={bl}: res={we_b/TWO_PI:.1f} Hz gain={g_b:.2f} -> peak {pk*1000:.2f} mm ({pk/xmax*100:.0f}%)")

    # Xmax slider extremes
    for mm in (2.0, 30.0):
        xu = mm / 1000
        g_b = K * xu * we
        pk, _, _ = simulate(sine(fe, 1.4, 6.0), g_b, aero_mode="fixed", v_max_mode="fixed", max_units=xu)
        print(f"  Xmax={mm:4.1f} mm: gain={g_b:6.2f} -> peak {pk*1000:6.2f} mm ({pk/xu*100 if xu else 0:.0f}% of slider)")

    # zeta extremes (smoothing 0 -> 0.30, 1 -> 0.85)
    for z in (0.30, 0.85):
        pk, _, _ = simulate(sine(fe, 1.4, 6.0), gain, aero_mode="fixed", v_max_mode="fixed", zeta=z)
        print(f"  zeta={z:.2f}: peak {pk*1000:6.2f} mm ({pk/xmax*100:.0f}% Xmax)")

    # bassSensitivity / animationIntensity extremes (x4 both = x16 total)
    pk, _, _ = simulate(sine(fe, 1.4, 6.0), gain * 16.0, aero_mode="fixed", v_max_mode="fixed")
    print(f"  gain x16 (max sliders): peak {pk*1000:6.2f} mm — Duffing/BL/aero must keep it bounded")


if __name__ == "__main__":
    main()
