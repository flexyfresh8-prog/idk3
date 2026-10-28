// idk3 v3 — procedural PBR texture + FINISH STUDIO.
//
// The supplied GLB ships with ZERO materials/textures (gltfpack stripped
// them). v3 turns the single v2 texture set into a parametric FINISH SYSTEM:
// every generator is palette-driven, and four complete finish packs can be
// swapped live from the UI ("Finish studio"), each regenerating albedo +
// normal (Sobel height→normal) + roughness maps per component class:
//
//   obsidian    smoked graphite cone, gunmetal frame, carbon coil (v2 lineage)
//   copperhead  black ceramic cone, polished copper twill coil, dark bronze
//   arctic      glazed white-ceramic cone, bright forged aluminum, silver twill
//   heritage    vintage tan paper cone, cream cloth surround, aged brass
//
// MeshPhysicalMaterial sets per class with per-finish parameter overrides.
// "Original" mode still renders the untouched neutral gray.
import * as THREE from 'three';
import type { MaterialKind } from '../core/types';

// ------------------------------------------------------------------ helpers

type Maps = { map?: THREE.CanvasTexture; normalMap?: THREE.CanvasTexture; roughnessMap?: THREE.CanvasTexture };

function makeCanvas(size: number): { c: HTMLCanvasElement; g: CanvasRenderingContext2D } {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return { c, g: c.getContext('2d')! };
}

function toTexture(c: HTMLCanvasElement, srgb: boolean, repeat = 1): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/** Sobel height→normal conversion. In: luminance-as-height grayscale canvas. */
function normalFromHeight(height: HTMLCanvasElement, strength = 1.6): THREE.CanvasTexture {
  const size = height.width;
  const src = height.getContext('2d')!.getImageData(0, 0, size, size).data;
  const { c, g } = makeCanvas(size);
  const out = g.createImageData(size, size);
  const h = (x: number, y: number): number => {
    x = (x + size) % size; y = (y + size) % size;
    return src[(y * size + x) * 4] / 255;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx =
        (h(x - 1, y - 1) + 2 * h(x - 1, y) + h(x - 1, y + 1)) -
        (h(x + 1, y - 1) + 2 * h(x + 1, y) + h(x + 1, y + 1));
      const dy =
        (h(x - 1, y - 1) + 2 * h(x, y - 1) + h(x + 1, y - 1)) -
        (h(x - 1, y + 1) + 2 * h(x, y + 1) + h(x + 1, y + 1));
      let nx = dx * strength, ny = dy * strength, nz = 1;
      const len = Math.hypot(nx, ny, nz);
      nx /= len; ny /= len; nz /= len;
      const i = (y * size + x) * 4;
      out.data[i] = (nx * 0.5 + 0.5) * 255;
      out.data[i + 1] = (ny * 0.5 + 0.5) * 255;
      out.data[i + 2] = (nz * 0.5 + 0.5) * 255;
      out.data[i + 3] = 255;
    }
  }
  g.putImageData(out, 0, 0);
  return toTexture(c, false);
}

/** Roughness map from a grayscale canvas (dark = smooth, bright = rough). */
function roughFromGray(gray: HTMLCanvasElement): THREE.CanvasTexture {
  return toTexture(gray, false);
}

/** rgba() helper for hsl-ish triples stored as [r,g,b] arrays. */
const rgba = (c: readonly number[], a: number): string => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

// ------------------------------------------------------------------ palettes

export interface FinishDef {
  id: string;
  label: string;
  desc: string;
  chip: [string, string]; // two-tone UI swatch
}

export const FINISHES: FinishDef[] = [
  { id: 'obsidian', label: 'Obsidian Graphite', desc: 'Smoked graphite cone · gunmetal frame · carbon coil', chip: ['#26282d', '#6a7078'] },
  { id: 'copperhead', label: 'Copperhead', desc: 'Black ceramic cone · polished copper coil · dark bronze', chip: ['#1d1f24', '#b0682f'] },
  { id: 'arctic', label: 'Arctic Forged', desc: 'Glazed ceramic cone · forged aluminum · silver twill', chip: ['#d8dde2', '#9aa2ab'] },
  { id: 'heritage', label: 'Heritage Paper', desc: 'Vintage paper cone · cream cloth surround · aged brass', chip: ['#b08d5f', '#8a7340'] }
];

interface Palette {
  cone: { base: string; strandA: [number, number, number]; strandB: [number, number, number]; speck: [number, number, number]; rough: string; resin: string };
  rubber: { base: string; mottle: [number, number, number]; grain: [number, number, number]; rough: string };
  cap: { top: string; bottom: string; speck: [number, number, number]; rough: string };
  coil: { warp: string; weft: string; sheen: number; rough: string };
  metal: { base: string; streak: [number, number, number]; rough: string };
  steel: { base: string; mark: [number, number, number]; speck: [number, number, number] };
  box: { base: string; tuft: [number, number, number]; rough: string };
  mat: Partial<Record<MaterialKind, { roughness?: number; metalness?: number; clearcoat?: number; clearcoatRoughness?: number; sheen?: number; sheenColor?: string }>>;
}

const PALETTES: Record<string, Palette> = {
  obsidian: {
    cone: { base: '#26282d', strandA: [40, 42, 48], strandB: [34, 36, 42], speck: [30, 32, 38], rough: '#a8a8a8', resin: '#8f8f8f' },
    rubber: { base: '#5c626b', mottle: [108, 115, 125], grain: [42, 46, 52], rough: '#b0b0b0' },
    cap: { top: '#23262c', bottom: '#1a1d22', speck: [30, 34, 42], rough: '#3c3c3c' },
    coil: { warp: '#3c4046', weft: '#20242a', sheen: 0.05, rough: '#8a8a8a' },
    metal: { base: '#6a7078', streak: [86, 92, 102], rough: '#6f6f6f' },
    steel: { base: '#4a4f56', mark: [62, 66, 74], speck: [50, 54, 60] },
    box: { base: '#191b1f', tuft: [30, 33, 38], rough: '#c8c8c8' },
    mat: {}
  },
  copperhead: {
    cone: { base: '#1d1f24', strandA: [58, 46, 36], strandB: [44, 36, 30], speck: [40, 34, 28], rough: '#969696', resin: '#6e6055' },
    rubber: { base: '#50555d', mottle: [94, 100, 109], grain: [38, 42, 48], rough: '#b4b4b4' },
    cap: { top: '#26221c', bottom: '#1b1916', speck: [64, 48, 32], rough: '#343434' },
    coil: { warp: '#a05a2c', weft: '#5c3018', sheen: 0.12, rough: '#5e5e5e' },
    metal: { base: '#57503f', streak: [96, 86, 66], rough: '#64645e' },
    steel: { base: '#3c3a38', mark: [58, 54, 50], speck: [46, 44, 42] },
    box: { base: '#16171a', tuft: [28, 28, 30], rough: '#cccccc' },
    mat: {
      coil: { roughness: 0.38, metalness: 0.62, clearcoat: 0.5, clearcoatRoughness: 0.3 },
      metal: { roughness: 0.42, metalness: 0.92 },
      cap: { clearcoat: 0.85, clearcoatRoughness: 0.16 }
    }
  },
  arctic: {
    cone: { base: '#d8dde2', strandA: [176, 184, 194], strandB: [158, 166, 178], speck: [148, 156, 168], rough: '#7c7c7c', resin: '#6a6a6a' },
    rubber: { base: '#aab2bb', mottle: [198, 206, 214], grain: [120, 128, 138], rough: '#d2d2d2' },
    cap: { top: '#cfd6dc', bottom: '#bfc7cf', speck: [120, 128, 138], rough: '#464646' },
    coil: { warp: '#9aa2ab', weft: '#6d757e', sheen: 0.1, rough: '#7a7a7a' },
    metal: { base: '#b9c0c7', streak: [220, 226, 232], rough: '#5c5c5c' },
    steel: { base: '#8f979e', mark: [150, 158, 166], speck: [120, 128, 136] },
    box: { base: '#3a3f46', tuft: [70, 76, 84], rough: '#c4c4c4' },
    mat: {
      cone: { roughness: 0.5, metalness: 0.05, clearcoat: 0.55, clearcoatRoughness: 0.3 },
      rubber: { sheen: 0.2, sheenColor: '#e8eef4' },
      metal: { roughness: 0.38, metalness: 0.95 }
    }
  },
  heritage: {
    cone: { base: '#b08d5f', strandA: [150, 118, 78], strandB: [128, 100, 66], speck: [110, 86, 56], rough: '#b6b6b6', resin: '#8a7a62' },
    rubber: { base: '#cfc4ae', mottle: [224, 216, 198], grain: [156, 146, 126], rough: '#e2e2e2' },
    cap: { top: '#5e2a2a', bottom: '#4c2222', speck: [90, 44, 44], rough: '#4a4a4a' },
    coil: { warp: '#9c7b3c', weft: '#6b5226', sheen: 0.1, rough: '#8a8a8a' },
    metal: { base: '#8a7340', streak: [176, 150, 92], rough: '#787870' },
    steel: { base: '#55524c', mark: [86, 82, 74], speck: [68, 66, 60] },
    box: { base: '#33201f', tuft: [62, 40, 38], rough: '#cccccc' },
    mat: {
      cone: { roughness: 0.88, metalness: 0.0, clearcoat: 0.06, clearcoatRoughness: 0.7 },
      rubber: { roughness: 0.95, sheen: 0.4, sheenColor: '#f2e8d0', clearcoat: 0.0 },
      metal: { roughness: 0.46, metalness: 0.88 }
    }
  }
};

// ------------------------------------------------------------------ textures

/** Pressed composite cone: crosshatch weave + radial striations + speckle. */
function coneMaps(p: Palette['cone']): Maps {
  const S = 512;
  const { c: albedo, g: a } = makeCanvas(S);
  a.fillStyle = p.base;
  a.fillRect(0, 0, S, S);

  // woven under-layer: two directional strand sets
  for (let i = 0; i < 220; i++) {
    a.strokeStyle = rgba(p.strandA, 0.10 + Math.random() * 0.12);
    a.lineWidth = 0.8 + Math.random() * 1.4;
    a.beginPath();
    const y = Math.random() * S;
    for (let x = 0; x <= S; x += 10) a.lineTo(x, y + Math.sin(x / 34 + i) * 2.2);
    a.stroke();
  }
  for (let i = 0; i < 220; i++) {
    a.strokeStyle = rgba(p.strandB, 0.08 + Math.random() * 0.10);
    a.lineWidth = 0.8 + Math.random() * 1.2;
    a.beginPath();
    const x = Math.random() * S;
    for (let y = 0; y <= S; y += 10) a.lineTo(x + Math.sin(y / 30 + i) * 2.0, y);
    a.stroke();
  }
  // pressed-paper speckle
  for (let i = 0; i < 2600; i++) {
    a.fillStyle = rgba(p.speck, Math.random() * 0.16);
    a.fillRect(Math.random() * S, Math.random() * S, 1.4, 1.4);
  }

  // height canvas (drives the normal map): weave ridges + speckle
  const { c: height, g: hh } = makeCanvas(S);
  hh.fillStyle = '#808080';
  hh.fillRect(0, 0, S, S);
  hh.globalAlpha = 0.5;
  for (let i = 0; i < 160; i++) {
    const v = Math.random() > 0.5 ? 200 : 60;
    hh.strokeStyle = `rgba(${v},${v},${v},0.5)`;
    hh.lineWidth = 1 + Math.random() * 1.6;
    hh.beginPath();
    const y = Math.random() * S;
    for (let x = 0; x <= S; x += 10) hh.lineTo(x, y + Math.sin(x / 34 + i) * 2.2);
    hh.stroke();
  }
  for (let i = 0; i < 160; i++) {
    const v = Math.random() > 0.5 ? 190 : 65;
    hh.strokeStyle = `rgba(${v},${v},${v},0.4)`;
    hh.lineWidth = 1 + Math.random() * 1.4;
    hh.beginPath();
    const x = Math.random() * S;
    for (let y = 0; y <= S; y += 10) hh.lineTo(x + Math.sin(y / 30 + i) * 2.0, y);
    hh.stroke();
  }
  hh.globalAlpha = 1;
  for (let i = 0; i < 2400; i++) {
    const v = Math.random() > 0.5 ? 165 : 90;
    hh.fillStyle = `rgba(${v},${v},${v},${Math.random() * 0.35})`;
    hh.fillRect(Math.random() * S, Math.random() * S, 1.3, 1.3);
  }

  // roughness map: base rough with darker (smoother) resin pools
  const { c: rough, g: r } = makeCanvas(S);
  r.fillStyle = p.rough;
  r.fillRect(0, 0, S, S);
  for (let i = 0; i < 900; i++) {
    const v = 120 + Math.random() * 90;
    r.fillStyle = `rgba(${v},${v},${v},0.35)`;
    const rr = 2 + Math.random() * 9;
    r.beginPath();
    r.arc(Math.random() * S, Math.random() * S, rr, 0, Math.PI * 2);
    r.fill();
  }

  return {
    map: toTexture(albedo, true, 3),
    normalMap: normalFromHeight(height, 1.4),
    roughnessMap: roughFromGray(rough)
  };
}

/** Satin rubber: soft cured mottle + micro-pebble grain + faint mold lines. */
function rubberMaps(p: Palette['rubber']): Maps {
  const S = 256;
  const { c: albedo, g: a } = makeCanvas(S);
  a.fillStyle = p.base;
  a.fillRect(0, 0, S, S);

  // soft lighter mottle — cured-rubber clouding (large, low contrast)
  for (let i = 0; i < 260; i++) {
    a.fillStyle = rgba(p.mottle, 0.05 + Math.random() * 0.10);
    a.beginPath();
    a.arc(Math.random() * S, Math.random() * S, 4 + Math.random() * 16, 0, Math.PI * 2);
    a.fill();
  }
  // fine dark micro-grain (pebble shadows)
  for (let i = 0; i < 4200; i++) {
    a.fillStyle = rgba(p.grain, 0.05 + Math.random() * 0.13);
    const s = 0.8 + Math.random() * 1.6;
    a.fillRect(Math.random() * S, Math.random() * S, s, s);
  }
  // light speckle catching grain crests
  for (let i = 0; i < 1400; i++) {
    a.fillStyle = rgba(p.mottle, Math.random() * 0.10);
    a.fillRect(Math.random() * S, Math.random() * S, 1, 1);
  }
  // faint circumferential mold/trim lines (run around the roll)
  for (let i = 0; i < 5; i++) {
    a.strokeStyle = rgba(p.grain, 0.10 + Math.random() * 0.08);
    a.lineWidth = 0.8;
    a.beginPath();
    const y = Math.random() * S;
    a.moveTo(0, y);
    a.lineTo(S, y + (Math.random() - 0.5) * 6);
    a.stroke();
  }

  const { c: height, g: hh } = makeCanvas(S);
  hh.fillStyle = '#808080';
  hh.fillRect(0, 0, S, S);
  // pebbled micro-bumps, both directions of relief
  for (let i = 0; i < 3200; i++) {
    const v = Math.random() > 0.5 ? 158 : 98;
    hh.fillStyle = `rgba(${v},${v},${v},${Math.random() * 0.42})`;
    hh.beginPath();
    hh.arc(Math.random() * S, Math.random() * S, 0.45 + Math.random() * 0.95, 0, Math.PI * 2);
    hh.fill();
  }
  // mold parting lines
  for (let i = 0; i < 5; i++) {
    hh.strokeStyle = 'rgba(64,64,64,0.5)';
    hh.lineWidth = 1;
    hh.beginPath();
    const y = Math.random() * S;
    hh.moveTo(0, y);
    hh.lineTo(S, y + (Math.random() - 0.5) * 8);
    hh.stroke();
  }
  // roughness: satin base with slightly glossier worn patches
  const { c: rough, g: r } = makeCanvas(S);
  r.fillStyle = p.rough;
  r.fillRect(0, 0, S, S);
  for (let i = 0; i < 650; i++) {
    const v = 150 + Math.random() * 80;
    r.fillStyle = `rgba(${v},${v},${v},0.35)`;
    r.beginPath();
    r.arc(Math.random() * S, Math.random() * S, 2 + Math.random() * 7, 0, Math.PI * 2);
    r.fill();
  }
  return {
    map: toTexture(albedo, true, 3),
    normalMap: normalFromHeight(height, 1.15),
    roughnessMap: roughFromGray(rough)
  };
}

/** Twill-woven coil former: 2×2 twill, palette-driven strand colors. */
function coilMaps(p: Palette['coil']): Maps {
  const S = 256;
  const cell = 16;
  const n = S / cell;
  const { c: albedo, g: a } = makeCanvas(S);
  const { c: height, g: hh } = makeCanvas(S);
  hh.fillStyle = '#808080';
  hh.fillRect(0, 0, S, S);
  for (let iy = 0; iy < n; iy++) {
    for (let ix = 0; ix < n; ix++) {
      const twill = (ix + iy) % 4 < 2; // 2×2 twill pattern
      const grad = a.createLinearGradient(
        twill ? ix * cell : (ix + 0.5) * cell,
        twill ? (iy + 0.5) * cell : iy * cell,
        twill ? (ix + 1) * cell : (ix + 0.5) * cell,
        twill ? (iy + 0.5) * cell : (iy + 1) * cell
      );
      grad.addColorStop(0, twill ? p.warp : p.weft);
      grad.addColorStop(0.5, twill ? lighten(p.warp, 26) : lighten(p.weft, 14));
      grad.addColorStop(1, twill ? p.warp : p.weft);
      a.fillStyle = grad;
      a.fillRect(ix * cell, iy * cell, cell, cell);
      // weave height: bright = strand crest
      const hv = twill ? 190 : 70;
      hh.fillStyle = `rgba(${hv},${hv},${hv},1)`;
      hh.fillRect(ix * cell + 1, iy * cell + 1, cell - 2, cell - 2);
    }
  }
  // sheen speckle over the twill
  for (let i = 0; i < 700; i++) {
    a.fillStyle = `rgba(255,255,255,${Math.random() * p.sheen})`;
    a.fillRect(Math.random() * S, Math.random() * S, 1, 1);
  }
  const { c: rough, g: r } = makeCanvas(S);
  r.fillStyle = p.rough;
  r.fillRect(0, 0, S, S);
  return {
    map: toTexture(albedo, true, 2.5),
    normalMap: normalFromHeight(height, 2.2),
    roughnessMap: roughFromGray(rough)
  };
}

function lighten(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, (n >> 16) + amt), g = Math.min(255, ((n >> 8) & 255) + amt), b = Math.min(255, (n & 255) + amt);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

/** Brushed metal: dense horizontal streaks (anisotropic look). */
function brushedMaps(p: Palette['metal']): Maps {
  const S = 512;
  const { c: albedo, g: a } = makeCanvas(S);
  a.fillStyle = p.base;
  a.fillRect(0, 0, S, S);
  for (let i = 0; i < 2400; i++) {
    a.strokeStyle = rgba(p.streak, 0.06 + Math.random() * 0.18);
    a.lineWidth = 0.5 + Math.random() * 0.9;
    const y = Math.random() * S;
    const x0 = Math.random() * S;
    const len = 30 + Math.random() * 220;
    a.beginPath();
    a.moveTo(x0, y);
    a.lineTo(x0 + len, y + (Math.random() - 0.5) * 1.5);
    a.stroke();
  }
  const { c: height, g: hh } = makeCanvas(S);
  hh.fillStyle = '#808080';
  hh.fillRect(0, 0, S, S);
  for (let i = 0; i < 1600; i++) {
    const v = Math.random() > 0.5 ? 165 : 95;
    hh.strokeStyle = `rgba(${v},${v},${v},${0.15 + Math.random() * 0.3})`;
    hh.lineWidth = 0.5 + Math.random() * 0.8;
    const y = Math.random() * S;
    const x0 = Math.random() * S;
    hh.beginPath();
    hh.moveTo(x0, y);
    hh.lineTo(x0 + 30 + Math.random() * 200, y);
    hh.stroke();
  }
  const { c: rough, g: r } = makeCanvas(S);
  r.fillStyle = p.rough;
  r.fillRect(0, 0, S, S);
  for (let i = 0; i < 1800; i++) {
    const v = 70 + Math.random() * 110;
    r.strokeStyle = `rgba(${v},${v},${v},0.35)`;
    r.lineWidth = 0.5 + Math.random() * 0.8;
    const y = Math.random() * S;
    const x0 = Math.random() * S;
    r.beginPath();
    r.moveTo(x0, y);
    r.lineTo(x0 + 40 + Math.random() * 200, y);
    r.stroke();
  }
  return {
    map: toTexture(albedo, true, 2),
    normalMap: normalFromHeight(height, 0.9),
    roughnessMap: roughFromGray(rough)
  };
}

/** Machined steel: radial turning marks for motor parts. */
function steelMaps(p: Palette['steel']): Maps {
  const S = 512;
  const { c: albedo, g: a } = makeCanvas(S);
  a.fillStyle = p.base;
  a.fillRect(0, 0, S, S);
  for (let i = 0; i < 1800; i++) {
    a.strokeStyle = rgba(p.mark, 0.07 + Math.random() * 0.15);
    a.lineWidth = 0.5 + Math.random() * 1.0;
    const y = Math.random() * S;
    a.beginPath();
    a.moveTo(0, y);
    a.lineTo(S, y + (Math.random() - 0.5) * 3);
    a.stroke();
  }
  for (let i = 0; i < 900; i++) {
    a.fillStyle = rgba(p.speck, Math.random() * 0.2);
    a.fillRect(Math.random() * S, Math.random() * S, 1 + Math.random() * 2, 1 + Math.random() * 2);
  }
  const { c: height, g: hh } = makeCanvas(S);
  hh.fillStyle = '#808080';
  hh.fillRect(0, 0, S, S);
  for (let i = 0; i < 1200; i++) {
    const v = Math.random() > 0.5 ? 160 : 100;
    hh.strokeStyle = `rgba(${v},${v},${v},${0.12 + Math.random() * 0.25})`;
    hh.lineWidth = 0.6 + Math.random() * 1.0;
    const y = Math.random() * S;
    hh.beginPath();
    hh.moveTo(0, y);
    hh.lineTo(S, y + (Math.random() - 0.5) * 3);
    hh.stroke();
  }
  return {
    map: toTexture(albedo, true, 2),
    normalMap: normalFromHeight(height, 0.8)
  };
}

/** Loudspeaker carpet for the enclosure drum. */
function carpetMaps(p: Palette['box']): Maps {
  const S = 512;
  const { c: albedo, g: a } = makeCanvas(S);
  a.fillStyle = p.base;
  a.fillRect(0, 0, S, S);
  // fiber tufts
  for (let i = 0; i < 5200; i++) {
    a.strokeStyle = rgba(p.tuft, 0.12 + Math.random() * 0.22);
    a.lineWidth = 0.7;
    const x = Math.random() * S, y = Math.random() * S;
    const ang = Math.random() * Math.PI;
    const len = 2.5 + Math.random() * 5;
    a.beginPath();
    a.moveTo(x, y);
    a.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len);
    a.stroke();
  }
  const { c: height, g: hh } = makeCanvas(S);
  hh.fillStyle = '#808080';
  hh.fillRect(0, 0, S, S);
  for (let i = 0; i < 3800; i++) {
    const v = Math.random() > 0.5 ? 150 : 100;
    hh.strokeStyle = `rgba(${v},${v},${v},${0.15 + Math.random() * 0.25})`;
    hh.lineWidth = 0.8;
    const x = Math.random() * S, y = Math.random() * S;
    const ang = Math.random() * Math.PI;
    const len = 2.5 + Math.random() * 5;
    hh.beginPath();
    hh.moveTo(x, y);
    hh.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len);
    hh.stroke();
  }
  const { c: rough, g: r } = makeCanvas(S);
  r.fillStyle = p.rough;
  r.fillRect(0, 0, S, S);
  return {
    map: toTexture(albedo, true, 3),
    normalMap: normalFromHeight(height, 1.2),
    roughnessMap: roughFromGray(rough)
  };
}

/** Glossy painted dust cap: subtle orange-peel normal, low roughness. */
function capMaps(p: Palette['cap']): Maps {
  const S = 256;
  const { c: albedo, g: a } = makeCanvas(S);
  const grad = a.createLinearGradient(0, 0, 0, S);
  grad.addColorStop(0, p.top);
  grad.addColorStop(1, p.bottom);
  a.fillStyle = grad;
  a.fillRect(0, 0, S, S);
  for (let i = 0; i < 900; i++) {
    a.fillStyle = rgba(p.speck, Math.random() * 0.1);
    a.fillRect(Math.random() * S, Math.random() * S, 1.5, 1.5);
  }
  const { c: height, g: hh } = makeCanvas(S);
  hh.fillStyle = '#808080';
  hh.fillRect(0, 0, S, S);
  // orange peel
  for (let i = 0; i < 1600; i++) {
    const v = Math.random() > 0.5 ? 145 : 110;
    hh.fillStyle = `rgba(${v},${v},${v},${Math.random() * 0.22})`;
    const s = 1 + Math.random() * 2.4;
    hh.beginPath();
    hh.arc(Math.random() * S, Math.random() * S, s, 0, Math.PI * 2);
    hh.fill();
  }
  const { c: rough, g: r } = makeCanvas(S);
  r.fillStyle = p.rough;
  r.fillRect(0, 0, S, S);
  for (let i = 0; i < 500; i++) {
    const v = 40 + Math.random() * 50;
    r.fillStyle = `rgba(${v},${v},${v},0.4)`;
    r.beginPath();
    r.arc(Math.random() * S, Math.random() * S, 2 + Math.random() * 6, 0, Math.PI * 2);
    r.fill();
  }
  return {
    map: toTexture(albedo, true, 2),
    normalMap: normalFromHeight(height, 0.55),
    roughnessMap: roughFromGray(rough)
  };
}

// ------------------------------------------------------------------ library

export type MaterialMode = 'studio' | 'original';

interface CoilRef { mat: THREE.MeshPhysicalMaterial; map: THREE.Texture | null }

export class MaterialLibrary {
  private cache = new Map<string, Map<MaterialKind, THREE.MeshPhysicalMaterial>>();
  private coilRefs = new Map<string, CoilRef>();
  private fiberOn = true;
  private originalMat: THREE.MeshStandardMaterial;
  mode: MaterialMode = 'studio';
  private current = FINISHES[0].id;

  constructor() {
    this.originalMat = new THREE.MeshStandardMaterial({ color: '#b9bdc4', roughness: 0.72, metalness: 0.04 });
    this.buildFinish(this.current);
  }

  get finishId(): string { return this.current; }

  /** Generate (and cache) the full material set for a finish id. */
  private buildFinish(id: string): Map<MaterialKind, THREE.MeshPhysicalMaterial> {
    const cached = this.cache.get(id);
    if (cached) return cached;
    const p = PALETTES[id] ?? PALETTES[FINISHES[0].id];
    const over = (k: MaterialKind) => p.mat[k] ?? {};

    const rubber = new THREE.MeshPhysicalMaterial({
      color: '#ffffff', metalness: 0.0, side: THREE.DoubleSide,
      roughness: 0.68, sheen: 0.55, sheenRoughness: 0.42,
      sheenColor: new THREE.Color('#8d959f'),
      clearcoat: 0.10, clearcoatRoughness: 0.55,
      ...rubberMaps(p.rubber), ...over('rubber')
    });
    const cone = new THREE.MeshPhysicalMaterial({
      color: '#ffffff', metalness: 0.06,
      clearcoatRoughness: 0.55,
      roughness: 0.78, clearcoat: 0.14, ...coneMaps(p.cone), ...over('cone')
    });
    const cap = new THREE.MeshPhysicalMaterial({
      color: '#ffffff', metalness: 0.10,
      clearcoatRoughness: 0.22,
      roughness: 0.32, clearcoat: 0.65, ...capMaps(p.cap), ...over('cap')
    });
    const coil = new THREE.MeshPhysicalMaterial({
      color: '#ffffff', metalness: 0.22, side: THREE.DoubleSide,
      clearcoatRoughness: 0.4,
      roughness: 0.48, clearcoat: 0.3, ...coilMaps(p.coil), ...over('coil')
    });
    const metal = new THREE.MeshPhysicalMaterial({
      color: '#ffffff', metalness: 0.88,
      roughness: 0.5, ...brushedMaps(p.metal), ...over('metal')
    });
    const steel = new THREE.MeshPhysicalMaterial({
      color: '#ffffff', metalness: 0.92,
      roughness: 0.55, ...steelMaps(p.steel), ...over('steel')
    });
    const box = new THREE.MeshPhysicalMaterial({
      color: '#ffffff', metalness: 0.02,
      roughness: 0.95, ...carpetMaps(p.box), ...over('box')
    });

    const set = new Map<MaterialKind, THREE.MeshPhysicalMaterial>([
      ['rubber', rubber], ['cone', cone], ['cap', cap], ['coil', coil],
      ['metal', metal], ['steel', steel], ['box', box]
    ]);
    this.cache.set(id, set);
    this.coilRefs.set(id, { mat: coil, map: coil.map ?? null });
    this.applyFiber(id);
    return set;
  }

  /** Coil weave detail toggle — applies to the ACTIVE finish's coil. */
  setFiberDetail(on: boolean): void {
    this.fiberOn = on;
    this.applyFiber(this.current);
  }

  private applyFiber(id: string): void {
    const ref = this.coilRefs.get(id);
    if (!ref) return;
    ref.mat.map = this.fiberOn ? ref.map : null;
    ref.mat.needsUpdate = true;
  }

  for(kind: MaterialKind): THREE.Material {
    if (this.mode === 'original') return this.originalMat;
    return this.cache.get(this.current)!.get(kind)!;
  }

  applyTo(mesh: THREE.Mesh, kind: MaterialKind): void {
    mesh.material = this.for(kind);
    mesh.castShadow = true;
  }

  setMode(mode: MaterialMode, meshes: { mesh: THREE.Mesh; kind: MaterialKind }[]): void {
    this.mode = mode;
    for (const m of meshes) m.mesh.material = this.for(m.kind);
  }

  /** Swap the active finish pack and repaint every registered mesh. */
  setFinish(id: string, meshes: { mesh: THREE.Mesh; kind: MaterialKind }[]): void {
    if (!PALETTES[id]) return;
    this.current = id;
    this.mode = 'studio';
    this.buildFinish(id);
    for (const m of meshes) m.mesh.material = this.for(m.kind);
  }
}
