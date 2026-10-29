// Central types shared by every driver profile. The per-model VERIFIED
// component maps live in drivers.ts (one specFor per GLB).

export type Role =
  | 'surround1' | 'surround2' | 'surround3'
  | 'cone' | 'dustCap' | 'voiceCoil'
  | 'frame' | 'basket' | 'motor' | 'enclosure';

export type MechGroup = 'surround' | 'moving' | 'frame' | 'motor' | 'enclosure';

export type MaterialKind = 'rubber' | 'cone' | 'cap' | 'coil' | 'metal' | 'steel' | 'box';

export interface PartSpec {
  role: Role;
  label: string;
  meshLabel: string;
  group: MechGroup;
  material: MaterialKind;
  note?: string;
}

export const range = (a: number, b: number): number[] => {
  const out: number[] = [];
  for (let i = a; i <= b; i++) out.push(i);
  return out;
};

// ------------------------------------------------------------------ params

export interface SimParams {
  maxExcursionMM: number;      // user-defined simulation parameter (mm of simulated peak excursion)
  resonanceHz: number;         // driver free-air resonance Fs of the simulated system
  coneMass: number;            // normalized moving mass 0.6..1.8 (transient feel)
  boxLoad: number;             // sealed-enclosure air-spring load 0..1
  bassSensitivity: number;     // drive multiplier for the bass band
  lfCutoffHz: number;          // lowpass cutoff for the displacement drive signal
  hfCutoffHz: number;          // upper bound of the "bass" analysis band (metering)
  surroundFlexibility: number; // 0..1 shape of the deformation field
  surroundStrength: number;    // 0..1 bulge/bend richness of the surround
  coilFollow: number;          // 0.8..1.2 voice-coil travel relative to cone (1 = glued)
  audioGain: number;           // 0..2 output gain
  animationIntensity: number;  // 0..3 master visual scale
}

// Defaults chosen for PHYSICAL REALISM: Butterworth sealed alignment via the
// fixed damping ratio (physics.ts REALISTIC_ZETA), a standard 80 Hz sub
// crossover on the drive tap, Fs = 32 Hz, Xmax = 10 mm (typical 12" driver),
// and no visual exaggeration (animationIntensity 1.0 = the calibrated scale).
export const DEFAULT_PARAMS: SimParams = {
  maxExcursionMM: 10,
  resonanceHz: 32,
  coneMass: 1.0,
  boxLoad: 0.35,
  bassSensitivity: 1.0,
  lfCutoffHz: 80,
  hfCutoffHz: 200,
  surroundFlexibility: 0.6,
  surroundStrength: 0.8,
  coilFollow: 1.0,
  audioGain: 1.0,
  animationIntensity: 1.0
};

export interface ParamMeta {
  key: keyof SimParams;
  label: string;
  min: number; max: number; step: number;
  unit: string;
  kind: 'sim' | 'model';
  hint: string;
}

export const PARAM_META: ParamMeta[] = [
  { key: 'maxExcursionMM', label: 'Max cone excursion', min: 1, max: 30, step: 0.5, unit: 'mm', kind: 'sim',
    hint: 'Xmax of the simulated suspension. Beyond it the spring stiffens progressively (real spider behavior).' },
  { key: 'resonanceHz', label: 'Driver resonance Fs', min: 18, max: 60, step: 1, unit: 'Hz', kind: 'sim',
    hint: 'Free-air resonance of the simulated driver. Sets where the mass-spring system naturally rings.' },
  { key: 'coneMass', label: 'Cone moving mass', min: 0.6, max: 1.8, step: 0.02, unit: '×', kind: 'sim',
    hint: 'Normalized moving mass Mms. Heavier cones attack slower and overshoot deeper at the same damping.' },
  { key: 'boxLoad', label: 'Enclosure air load', min: 0, max: 1, step: 0.01, unit: '', kind: 'sim',
    hint: 'Sealed-box air spring behind the cone. Adds compliance stiffness and raises the effective resonance like a real closed box.' },
  { key: 'bassSensitivity', label: 'Bass sensitivity', min: 0.2, max: 4, step: 0.05, unit: '×', kind: 'sim',
    hint: 'How strongly the low-frequency band drives the cone.' },
  { key: 'lfCutoffHz', label: 'Drive low-pass cutoff', min: 40, max: 300, step: 5, unit: 'Hz', kind: 'sim',
    hint: 'Audio above this frequency barely moves the cone (24 dB/oct low-pass on the drive tap).' },
  { key: 'hfCutoffHz', label: 'Bass band upper limit', min: 80, max: 400, step: 5, unit: 'Hz', kind: 'sim',
    hint: 'Upper bound of the "bass" band used for metering and sensitivity. ≥ drive cutoff.' },
  { key: 'surroundFlexibility', label: 'Surround flexibility', min: 0, max: 1, step: 0.01, unit: '', kind: 'sim',
    hint: 'How gradually the rubber roll shares motion between cone edge and frame.' },
  { key: 'surroundStrength', label: 'Surround deformation', min: 0, max: 1, step: 0.01, unit: '', kind: 'sim',
    hint: 'Amount of roll bending / volume compensation in the rubber.' },
  { key: 'coilFollow', label: 'Voice coil travel', min: 0.8, max: 1.2, step: 0.01, unit: '×', kind: 'sim',
    hint: '1.00 = coil glued to the cone (physical). Other values are for inspection only.' },
  { key: 'audioGain', label: 'Audio gain', min: 0, max: 2, step: 0.01, unit: '×', kind: 'sim',
    hint: 'Output volume of the processed signal.' },
  { key: 'animationIntensity', label: 'Animation intensity', min: 0, max: 3, step: 0.05, unit: '×', kind: 'sim',
    hint: 'Master visual scale of all motion. Purely visual exaggeration.' }
];
