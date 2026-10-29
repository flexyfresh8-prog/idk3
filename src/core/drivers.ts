// Driver profiles — the dyno lab can hot-swap between complete drivers.
//
// Each profile carries:
//   specFor(index)      — the VERIFIED mesh → role map for that GLB
//   expectedParts       — every mesh index the GLB must contain (audit guard)
//   scaleMode           — 'unit' (use model as authored) or 'driver-inches'
//                         (uniformly scale the model so the surround outer
//                         diameter equals the nominal driver size, derived
//                         from the audited geometry — never hardcoded)
//   defaults / ranges   — per-driver simulation parameter defaults and slider
//                         ranges (a 2-inch mini cannot share the 10-inch
//                         Xmax/Fs ranges — different physics class)
//
// ---------------------------------------------------------------- 10-inch
// Mapping for tripo_model_1793179198729.glb (48 parts) — established by the
// offline audit + isolated renders, unchanged since v1:
//   4/15/19  three arc segments forming the rubber surround torus
//   21       main cone annulus · 6 center dust cap · 1 voice-coil band
//   5/7/8/22 flange quadrants (7 was listed "cone" in the brief; geometry
//            proves screw holes — kept stationary per the
//            never-animate-wrong-parts rule) · 14 outer lip ring
//   9/10/20  basket legs · 11-13/16-18/23-47 spider, motor, terminals
//   0/2/3    sealed enclosure drum (hidden in Driver-only view)
// Fires toward −Z.
//
// ---------------------------------------------------------------- 2-inch
// Mapping for tripo_model_1793266104276.glb (31 parts) — user-supplied brief
// ("voice coil part 3 · cone part 10 · rubber surround part 2"), verified
// geometrically by radial/z cross-section audit + isolated renders:
//   2        rubber surround: half-roll S-curve r 0.19..0.39 ✓
//   10       cone diaphragm with embossed logo, r 0..0.18 ✓ (includes the
//            center dome — one-piece diaphragm, no separate dust cap)
//   3        voice coil + former: cylindrical sleeve directly behind the
//            cone, hidden inside the sealed body ✓ (user-verified; cross-
//            section shows the coil sleeve + flared former)
//   1        cast front flange ring · 15 surround mounting gasket
//   0/4/5/7/8/9    sealed shell + back plate (enclosure — hidden in
//                  Driver-only view)
//   6/12/13/14     internal motor structure (magnet ring, spider, pole details)
//   11/16-27       terminal cups, feet rails, badges (detail hardware)
//   28/29/30       three rear feet
// Fires toward +Z (opposite of the 10-inch — derived from geometry anyway).
import type { PartSpec } from './types';
import { range } from './types';

export type Role = 'surround1' | 'surround2' | 'surround3' | 'cone' | 'dustCap' | 'voiceCoil'
  | 'frame' | 'basket' | 'motor' | 'enclosure';

export interface ParamRange { min: number; max: number; step: number }

export interface DriverProfile {
  id: 'fullsize' | 'mini2';
  name: string;                 // switcher label ("10″ Sub")
  fullName: string;             // toast / info chip
  tagline: string;              // short description for the info chip
  modelFile: string;            // under BASE_URL
  specFor: (index: number) => PartSpec;
  expectedParts: Set<number>;
  scaleMode: { kind: 'unit' } | { kind: 'driver-inches'; inches: number };
  defaults: Record<string, number>;
  ranges: Partial<Record<string, ParamRange>>;
}

// ------------------------------------------------------------------ 10-inch
const FULLSIZE_SPECS = (index: number): PartSpec => {
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
};

// ------------------------------------------------------------------ 2-inch
const MINI_ENCLOSURE = new Set([0, 4, 5, 7, 8, 9, 28, 29, 30]);
const MINI_MOTOR = new Set([6, 11, 12, 13, 14, 16, 17, 18, 20, 21, 22, 23, 24, 25, 26, 27]);
const MINI_DETAIL_LABEL: Record<number, string> = {
  6: 'Internal Motor Structure', 11: 'Terminal Detail', 12: 'Magnet Ring',
  13: 'Pole Vent Ring', 14: 'Spider / Suspension', 16: 'Terminal Cup',
  17: 'Badge Detail', 18: 'Badge Detail', 20: 'Foot Rail', 21: 'Foot Rail',
  22: 'Terminal Detail', 23: 'Terminal Detail', 24: 'Foot Pad',
  25: 'Badge Detail', 26: 'Terminal Detail', 27: 'Foot Pad'
};

const MINI_SPECS = (index: number): PartSpec => {
  switch (index) {
    case 2:  return { role: 'surround1', label: 'Rubber Surround', meshLabel: 'Mesh 2', group: 'surround', material: 'rubber',
      note: 'User-verified + geometric audit: half-roll S-curve, r 0.19–0.39.' };
    case 10: return { role: 'cone', label: 'Cone', meshLabel: 'Mesh 10', group: 'moving', material: 'cone',
      note: 'User-verified + geometric audit: one-piece diaphragm with embossed logo (center dome included — no separate dust cap on this driver).' };
    case 3:  return { role: 'voiceCoil', label: 'Voice Coil', meshLabel: 'Mesh 3', group: 'moving', material: 'coil',
      note: 'User-verified: coil + former sleeve directly behind the cone, inside the sealed body.' };
    case 1:  return { role: 'frame', label: 'Front Flange Ring', meshLabel: 'Mesh 1', group: 'frame', material: 'metal' };
    case 15: return { role: 'frame', label: 'Surround Gasket Ring', meshLabel: 'Mesh 15', group: 'frame', material: 'metal' };
    default:
      if (MINI_ENCLOSURE.has(index)) {
        const backPlate = index === 9;
        const foot = index >= 28;
        return { role: 'enclosure', label: backPlate ? 'Sealed Back Plate' : foot ? 'Rear Foot' : 'Enclosure Shell',
          meshLabel: `Mesh ${index}`, group: 'enclosure', material: 'box' };
      }
      if (MINI_MOTOR.has(index)) {
        return { role: 'motor', label: MINI_DETAIL_LABEL[index] ?? 'Motor Detail', meshLabel: `Mesh ${index}`, group: 'motor', material: 'steel' };
      }
      return { role: 'motor', label: 'Detail Part', meshLabel: `Mesh ${index}`, group: 'motor', material: 'steel' };
  }
};

export const DRIVERS: DriverProfile[] = [
  {
    id: 'fullsize',
    name: '10″ Sub',
    fullName: '10-inch reference sub',
    tagline: '48-part art model · drum enclosure · fires −Z',
    modelFile: 'models/tripo_model_1793179198729.glb',
    specFor: FULLSIZE_SPECS,
    expectedParts: new Set<number>([19, 15, 4, 21, 6, 1, 5, 7, 8, 22, 14, 9, 10, 20, 0, 2, 3, ...range(11, 13), ...range(16, 18), ...range(23, 47)]),
    scaleMode: { kind: 'unit' },
    defaults: {},
    ranges: {}
  },
  {
    id: 'mini2',
    name: '2″ Mini',
    fullName: '2-inch mini sub',
    tagline: '31-part sealed micro sub · scaled to a 2″ driver · fires +Z',
    modelFile: 'models/tripo_model_1793266104276.glb',
    specFor: MINI_SPECS,
    expectedParts: new Set<number>(range(0, 30)),
    scaleMode: { kind: 'driver-inches', inches: 2 },
    // A 2-inch sealed micro driver is a different physics class: tiny Xmax,
    // high free-air resonance, crossover well above the 10-inch.
    // Visual floor: at the rated 1.5 mm Xmax the roll's visible breathing is
    // sub-millimeter and reads as a FROZEN surround (user report) while the
    // 3 mm default keeps the roll's crest swing clearly visible at the
    // mini's scale, matching the exaggerated-dyno feel of the 10-inch.
    defaults: {
      maxExcursionMM: 3.0,
      resonanceHz: 70,
      boxLoad: 0.6,
      lfCutoffHz: 120,
      hfCutoffHz: 250,
      surroundFlexibility: 0.65,
      surroundStrength: 1.0
    },
    ranges: {
      maxExcursionMM: { min: 0.5, max: 6, step: 0.1 },
      resonanceHz: { min: 40, max: 120, step: 1 }
    }
  }
];

export function driverById(id: string): DriverProfile {
  return DRIVERS.find((d) => d.id === id) ?? DRIVERS[0];
}
