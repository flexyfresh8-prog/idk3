// idk3 v2 — procedural PBR texture + material library.
//
// The supplied GLB ships with ZERO materials/textures (gltfpack stripped
// them). v1 painted every part with a flat color. v2 generates a full set of
// procedural texture maps on offscreen canvases — albedo, normal (Sobel
// height→normal) and roughness — and assigns physically plausible
// MeshPhysicalMaterial sets per component class:
//
//   cone      pressed aramid/paper weave with radial striations + clearcoat
//   rubber    fine matte micro-grain, high roughness, slight sheen
//   cap       glossy painted composite with orange-peel normal
//   coil      2×2 twill carbon-fiber composite
//   metal     brushed gunmetal flange/basket (anisotropic streak roughness)
//   steel     machined dark motor steel (turning-mark crosshatch)
//   box       black loudspeaker carpet (bedliner speckle + fiber noise)
//
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

// ------------------------------------------------------------------ textures

/** Pressed aramid/paper cone: crosshatch weave + radial striations + speckle. */
function coneMaps(): Maps {
  const S = 512;
  const { c: albedo, g: a } = makeCanvas(S);
  a.fillStyle = '#26282d';
  a.fillRect(0, 0, S, S);

  // woven under-layer: two directional strand sets
  for (let i = 0; i < 220; i++) {
    const light = 34 + Math.random() * 18;
    a.strokeStyle = `rgba(${light},${light + 2},${light + 6},${0.10 + Math.random() * 0.12})`;
    a.lineWidth = 0.8 + Math.random() * 1.4;
    a.beginPath();
    const y = Math.random() * S;
    for (let x = 0; x <= S; x += 10) a.lineTo(x, y + Math.sin(x / 34 + i) * 2.2);
    a.stroke();
  }
  for (let i = 0; i < 220; i++) {
    const light = 30 + Math.random() * 16;
    a.strokeStyle = `rgba(${light},${light + 2},${light + 6},${0.08 + Math.random() * 0.10})`;
    a.lineWidth = 0.8 + Math.random() * 1.2;
    a.beginPath();
    const x = Math.random() * S;
    for (let y = 0; y <= S; y += 10) a.lineTo(x + Math.sin(y / 30 + i) * 2.0, y);
    a.stroke();
  }
  // pressed-paper speckle
  for (let i = 0; i < 2600; i++) {
    const l = 22 + Math.random() * 40;
    a.fillStyle = `rgba(${l},${l + 2},${l + 6},${Math.random() * 0.16})`;
    a.fillRect(Math.random() * S, Math.random() * S, 1.4, 1.4);
  }

  // height canvas (drives the normal map): weave ridges + speckle
  const { c: height, g: hh } = makeCanvas(S);
  hh.fillStyle = '#808080';
  hh.fillRect(0, 0, S, S);
  hh.globalAlpha = 0.5;
  for (let i = 0; i < 160; i++) {
    hh.strokeStyle = `rgba(${Math.random() > 0.5 ? 200 : 60},${Math.random() > 0.5 ? 200 : 60},${Math.random() > 0.5 ? 200 : 60},0.5)`;
    hh.lineWidth = 1 + Math.random() * 1.6;
    hh.beginPath();
    const y = Math.random() * S;
    for (let x = 0; x <= S; x += 10) hh.lineTo(x, y + Math.sin(x / 34 + i) * 2.2);
    hh.stroke();
  }
  for (let i = 0; i < 160; i++) {
    hh.strokeStyle = `rgba(${Math.random() > 0.5 ? 190 : 65},${Math.random() > 0.5 ? 190 : 65},${Math.random() > 0.5 ? 190 : 65},0.4)`;
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
  r.fillStyle = '#a8a8a8';
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

/** Matte rubber micro-grain: fine noise + faint mold seams. */
function rubberMaps(): Maps {
  const S = 256;
  const { c: albedo, g: a } = makeCanvas(S);
  a.fillStyle = '#3f444b';
  a.fillRect(0, 0, S, S);
  for (let i = 0; i < 5200; i++) {
    const l = 48 + Math.random() * 34;
    a.fillStyle = `rgba(${l},${l + 2},${l + 7},${0.05 + Math.random() * 0.12})`;
    const s = 0.8 + Math.random() * 1.7;
    a.fillRect(Math.random() * S, Math.random() * S, s, s);
  }
  const { c: height, g: hh } = makeCanvas(S);
  hh.fillStyle = '#808080';
  hh.fillRect(0, 0, S, S);
  for (let i = 0; i < 3600; i++) {
    const v = Math.random() > 0.5 ? 150 : 95;
    hh.fillStyle = `rgba(${v},${v},${v},${Math.random() * 0.4})`;
    const s = 0.8 + Math.random() * 1.8;
    hh.fillRect(Math.random() * S, Math.random() * S, s, s);
  }
  // subtle mold parting lines
  for (let i = 0; i < 3; i++) {
    hh.strokeStyle = 'rgba(60,60,60,0.5)';
    hh.lineWidth = 1;
    hh.beginPath();
    const y = Math.random() * S;
    hh.moveTo(0, y);
    hh.lineTo(S, y + (Math.random() - 0.5) * 8);
    hh.stroke();
  }
  const { c: rough, g: r } = makeCanvas(S);
  r.fillStyle = '#d4d4d4';
  r.fillRect(0, 0, S, S);
  for (let i = 0; i < 700; i++) {
    const v = 175 + Math.random() * 70;
    r.fillStyle = `rgba(${v},${v},${v},0.4)`;
    r.fillRect(Math.random() * S, Math.random() * S, 2 + Math.random() * 4, 2 + Math.random() * 4);
  }
  return {
    map: toTexture(albedo, true, 4),
    normalMap: normalFromHeight(height, 1.1),
    roughnessMap: roughFromGray(rough)
  };
}

/** 2×2 twill carbon-fiber for the voice-coil former. */
function carbonMaps(): Maps {
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
      grad.addColorStop(0, twill ? '#3c4046' : '#20242a');
      grad.addColorStop(0.5, twill ? '#565c64' : '#2b3037');
      grad.addColorStop(1, twill ? '#3c4046' : '#20242a');
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
    a.fillStyle = `rgba(255,255,255,${Math.random() * 0.05})`;
    a.fillRect(Math.random() * S, Math.random() * S, 1, 1);
  }
  const { c: rough, g: r } = makeCanvas(S);
  r.fillStyle = '#8a8a8a';
  r.fillRect(0, 0, S, S);
  return {
    map: toTexture(albedo, true, 2.5),
    normalMap: normalFromHeight(height, 2.2),
    roughnessMap: roughFromGray(rough)
  };
}

/** Brushed gunmetal: dense horizontal streaks (anisotropic look). */
function brushedMaps(): Maps {
  const S = 512;
  const { c: albedo, g: a } = makeCanvas(S);
  a.fillStyle = '#6a7078';
  a.fillRect(0, 0, S, S);
  for (let i = 0; i < 2400; i++) {
    const l = 78 + Math.random() * 60;
    a.strokeStyle = `rgba(${l},${l + 3},${l + 8},${0.06 + Math.random() * 0.18})`;
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
  r.fillStyle = '#6f6f6f';
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

/** Machined dark steel: radial turning marks for motor parts. */
function steelMaps(): Maps {
  const S = 512;
  const { c: albedo, g: a } = makeCanvas(S);
  a.fillStyle = '#4a4f56';
  a.fillRect(0, 0, S, S);
  for (let i = 0; i < 1800; i++) {
    const l = 58 + Math.random() * 46;
    a.strokeStyle = `rgba(${l},${l + 2},${l + 7},${0.07 + Math.random() * 0.15})`;
    a.lineWidth = 0.5 + Math.random() * 1.0;
    const y = Math.random() * S;
    a.beginPath();
    a.moveTo(0, y);
    a.lineTo(S, y + (Math.random() - 0.5) * 3);
    a.stroke();
  }
  for (let i = 0; i < 900; i++) {
    const l = 45 + Math.random() * 40;
    a.fillStyle = `rgba(${l},${l + 2},${l + 6},${Math.random() * 0.2})`;
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

/** Black speaker carpet for the enclosure drum. */
function carpetMaps(): Maps {
  const S = 512;
  const { c: albedo, g: a } = makeCanvas(S);
  a.fillStyle = '#191b1f';
  a.fillRect(0, 0, S, S);
  // fiber tufts
  for (let i = 0; i < 5200; i++) {
    const l = 26 + Math.random() * 26;
    a.strokeStyle = `rgba(${l},${l + 2},${l + 6},${0.12 + Math.random() * 0.22})`;
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
  r.fillStyle = '#c8c8c8';
  r.fillRect(0, 0, S, S);
  return {
    map: toTexture(albedo, true, 3),
    normalMap: normalFromHeight(height, 1.2),
    roughnessMap: roughFromGray(rough)
  };
}

/** Glossy painted dust cap: subtle orange-peel normal, low roughness. */
function capMaps(): Maps {
  const S = 256;
  const { c: albedo, g: a } = makeCanvas(S);
  const grad = a.createLinearGradient(0, 0, 0, S);
  grad.addColorStop(0, '#23262c');
  grad.addColorStop(1, '#1a1d22');
  a.fillStyle = grad;
  a.fillRect(0, 0, S, S);
  for (let i = 0; i < 900; i++) {
    const l = 26 + Math.random() * 20;
    a.fillStyle = `rgba(${l},${l + 3},${l + 8},${Math.random() * 0.1})`;
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
  r.fillStyle = '#3c3c3c';
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

export class MaterialLibrary {
  private studio = new Map<MaterialKind, THREE.MeshPhysicalMaterial>();
  private originalMat: THREE.MeshStandardMaterial;
  private coilFiber: THREE.MeshPhysicalMaterial | null = null;
  private coilMap: THREE.CanvasTexture | null = null;
  mode: MaterialMode = 'studio';

  constructor() {
    const coneMapsT = coneMaps();
    const rubberMapsT = rubberMaps();
    const carbonMapsT = carbonMaps();
    const brushedMapsT = brushedMaps();
    const steelMapsT = steelMaps();
    const carpetMapsT = carpetMaps();
    const capMapsT = capMaps();

    const rubber = new THREE.MeshPhysicalMaterial({
      color: '#ffffff', roughness: 0.92, metalness: 0.0, side: THREE.DoubleSide,
      sheen: 0.35, sheenRoughness: 0.7, sheenColor: new THREE.Color('#3a4250'),
      ...rubberMapsT
    });
    const cone = new THREE.MeshPhysicalMaterial({
      color: '#ffffff', roughness: 0.78, metalness: 0.06,
      clearcoat: 0.14, clearcoatRoughness: 0.55,
      ...coneMapsT
    });
    const cap = new THREE.MeshPhysicalMaterial({
      color: '#ffffff', roughness: 0.32, metalness: 0.10,
      clearcoat: 0.65, clearcoatRoughness: 0.22,
      ...capMapsT
    });
    const coil = new THREE.MeshPhysicalMaterial({
      color: '#ffffff', roughness: 0.48, metalness: 0.22, side: THREE.DoubleSide,
      clearcoat: 0.3, clearcoatRoughness: 0.4,
      ...carbonMapsT
    });
    const metal = new THREE.MeshPhysicalMaterial({
      color: '#ffffff', roughness: 0.5, metalness: 0.88,
      ...brushedMapsT
    });
    const steel = new THREE.MeshPhysicalMaterial({
      color: '#ffffff', roughness: 0.55, metalness: 0.92,
      ...steelMapsT
    });
    const box = new THREE.MeshPhysicalMaterial({
      color: '#ffffff', roughness: 0.95, metalness: 0.02,
      ...carpetMapsT
    });

    this.studio.set('rubber', rubber);
    this.studio.set('cone', cone);
    this.studio.set('cap', cap);
    this.studio.set('coil', coil);
    this.studio.set('metal', metal);
    this.studio.set('steel', steel);
    this.studio.set('box', box);
    this.coilFiber = coil;
    this.coilMap = carbonMapsT.map ?? null;
    this.originalMat = new THREE.MeshStandardMaterial({ color: '#b9bdc4', roughness: 0.72, metalness: 0.04 });
  }

  setFiberDetail(on: boolean): void {
    if (this.coilFiber) {
      this.coilFiber.map = on ? this.coilMap : null;
      this.coilFiber.needsUpdate = true;
    }
  }

  for(kind: MaterialKind): THREE.Material {
    return this.mode === 'studio' ? this.studio.get(kind)! : this.originalMat;
  }

  applyTo(mesh: THREE.Mesh, kind: MaterialKind): void {
    mesh.material = this.for(kind);
    mesh.castShadow = true;
  }

  setMode(mode: MaterialMode, meshes: { mesh: THREE.Mesh; kind: MaterialKind }[]): void {
    this.mode = mode;
    for (const m of meshes) m.mesh.material = this.for(m.kind);
  }
}
