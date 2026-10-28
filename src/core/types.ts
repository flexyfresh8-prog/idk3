// Central types + the VERIFIED component map for tripo_model_1793179198729.glb.
//
// The mapping below was established by an offline audit of the GLB
// (JSON chunk + decoded EXT_meshopt_compression buffers) and confirmed
// visually by rendering each candidate part in isolation:
//
//   part 4 / 15 / 19 : three arc segments that together form the complete
//                      360-degree rubber surround torus (front face, z -0.46..-0.33)
//   part 21          : full annulus ring around the dust cap = main visible cone body
//   part 6           : center dust cap (carries embossed text), part of moving diaphragm
//   part 1           : large cylindrical voice-coil band behind the cone (z -0.31..-0.15)
//   part 5/7/8/22    : the four quadrants of the outer mounting FLANGE (with screw
//                      holes). NOTE: the user brief listed "Mesh 7" as the cone, but
//                      geometry + renders prove it is a flange quadrant, so it stays
//                      stationary and is listed as frame.
//   part 14          : thin outer lip ring where surround meets the flange
//   part 9/10/20     : cast basket legs
//   part 11/12/13/16/17/18/23/24..47 : spider, motor, terminals, pole details
//   part 0/2/3       : big sealed enclosure drum at the back (+z) — hidden in
//                      driver-only view
//
// Driver axis = Z; the driver fires toward NEGATIVE Z (verified: surround and
// cone occupy the most-negative z band; enclosure drum the most-positive).

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

const range = (a: number, b: number): number[] => {
  const out: number[] = [];
  for (let i = a; i <= b; i++) out.push(i);
  return out;
};

function specFor(index: number): PartSpec {
  switch (index) {
    case 19: return { role: 'surround1', label: 'Rubber Surround — Part 1', meshLabel: 'Mesh 19', group: 'surround', material: 'rubber' };
    case 15: return { role: 'surround2', label: 'Rubber Surround — Part 2', meshLabel: 'Mesh 15', group: 'surround', material: 'rubber' };
    case 4:  return { role: 'surround3', label: 'Rubber Surround — Part 3', meshLabel: 'Mesh 4', group: 'surround', material: 'rubber' };
    case 21: return { role: 'cone', label: 'Cone', meshLabel: 'Mesh 21', group: 'moving', material: 'cone' };
    case 6:  return { role: 'dustCap', label: 'Dust Cap', meshLabel: 'Mesh 6', group: 'moving', material: 'cap',
      note: 'Found by audit — center of the moving diaphragm (user brief did not list it).' };
    case 1:  return { role: 'voiceCoil', label: 'Voice Coil', meshLabel: 'Mesh 1', group: 'moving', material: 'coil' };
    case 7:  return { role: 'frame', label: 'Frame Flange Quadrant', meshLabel: 'Mesh 7', group: 'frame', material: 'metal',
      note: 'Listed as "cone" in the brief, but geometry shows screw holes: it is a stationary flange quadrant. Not animated — per the never-animate-wrong-parts rule.' };
    case 5:  return { role: 'frame', label: 'Frame Flange Quadrant', meshLabel: 'Mesh 5', group: 'frame', material: 'metal' };
    case 8:  return { role: 'frame', label: 'Frame Flange Quadrant', meshLabel: 'Mesh 8', group: 'frame', material: 'metal' };
    case 22: return { role: 'frame', label: 'Frame Flange Quadrant', meshLabel: 'Mesh 22', group: 'frame', material: 'metal' };
    case 14: return { role: 'frame', label: 'Outer Lip Ring', meshLabel: 'Mesh 14', group: 'frame', material: 'metal' };
    case 9:  return { role: 'basket', label: 'Basket Leg', meshLabel: 'Mesh 9', group: 'frame', material: 'metal' };
    case 10: return { role: 'basket', label: 'Basket Leg', meshLabel: 'Mesh 10', group: 'frame', material: 'metal' };
    case 20: return { role: 'basket', label: 'Basket Leg', meshLabel: 'Mesh 20', group: 'frame', material: 'metal' };
    case 0:  return { role: 'enclosure', label: 'Enclosure Drum', meshLabel: 'Mesh 0', group: 'enclosure', material: 'box' };
    case 2:  return { role: 'enclosure', label: 'Enclosure Drum Section', meshLabel: 'Mesh 2', group: 'enclosure', material: 'box' };
    case 3:  return { role: 'enclosure', label: 'Enclosure Adapter Ring', meshLabel: 'Mesh 3', group: 'enclosure', material: 'box' };
    default:
      if (range(11, 13).includes(index) || range(16, 18).includes(index) || range(23, 47).includes(index)) {
        return { role: 'motor', label: 'Motor / Suspension Detail', meshLabel: `Mesh ${index}`, group: 'motor', material: 'steel' };
      }
      return { role: 'motor', label: 'Detail Part', meshLabel: `Mesh ${index}`, group: 'motor', material: 'steel' };
  }
}

export const EXPECTED_PARTS = new Set<number>(
  [19, 15, 4, 21, 6, 1, 5, 7, 8, 22, 14, 9, 10, 20, 0, 2, 3, ...range(11, 13), ...range(16, 18), ...range(23, 47)]
);

export { specFor };

// ------------------------------------------------------------------ params

export interface SimParams {
  maxExcursionMM: number;      // user-defined simulation parameter (mm of simulated peak excursion)
  resonanceHz: number;         // driver free-air resonance Fs of the simulated system
  coneMass: number;            // normalized moving mass 0.6..1.8 (transient feel)
  boxLoad: number;             // sealed-enclosure air-spring load 0..1
  bassSensitivity: number;     // drive multiplier for the bass band
  lfCutoffHz: number;          // lowpass cutoff for the displacement drive signal
  hfCutoffHz: number;          // upper bound of the "bass" analysis band (metering)
  smoothing: number;           // motion damping 0..1
  surroundFlexibility: number; // 0..1 shape of the deformation field
  surroundStrength: number;    // 0..1 bulge/bend richness of the surround
  coilFollow: number;          // 0.8..1.2 voice-coil travel relative to cone (1 = glued)
  audioGain: number;           // 0..2 output gain
  animationIntensity: number;  // 0..3 master visual scale
}

export const DEFAULT_PARAMS: SimParams = {
  maxExcursionMM: 10,
  resonanceHz: 32,
  coneMass: 1.0,
  boxLoad: 0.35,
  bassSensitivity: 1.0,
  lfCutoffHz: 120,
  hfCutoffHz: 200,
  smoothing: 0.55,
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
  { key: 'smoothing', label: 'Motion smoothing', min: 0, max: 1, step: 0.01, unit: '', kind: 'sim',
    hint: 'Damping of the mass-spring cone model. Higher = slower, heavier cone.' },
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
