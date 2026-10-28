// PBR material sets. The supplied GLB ships with ZERO materials/textures
// (gltfpack stripped them), so "Studio" assigns physically plausible
// materials per component class; "Original" renders the untouched neutral
// gray. The voice coil gets a subtle procedural carbon-fiber texture.
import * as THREE from 'three';
import type { MaterialKind } from '../core/types';

function fiberTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#141619';
  g.fillRect(0, 0, 256, 256);
  // fine diagonal fiber strands
  for (let i = 0; i < 170; i++) {
    const y = Math.random() * 256;
    const amp = 2 + Math.random() * 5;
    const light = 26 + Math.random() * 16;
    g.strokeStyle = `rgba(${light},${light + 4},${light + 10},${0.10 + Math.random() * 0.14})`;
    g.lineWidth = 0.6 + Math.random() * 1.1;
    g.beginPath();
    for (let x = 0; x <= 256; x += 8) g.lineTo(x, y + Math.sin((x / 256) * Math.PI * (2 + (i % 3))) * amp);
    g.stroke();
  }
  // speckle
  for (let i = 0; i < 900; i++) {
    g.fillStyle = `rgba(255,255,255,${Math.random() * 0.05})`;
    g.fillRect(Math.random() * 256, Math.random() * 256, 1, 1);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2.5, 2.5);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export type MaterialMode = 'studio' | 'original';

export class MaterialLibrary {
  private studio = new Map<MaterialKind, THREE.MeshStandardMaterial>();
  private originalMat: THREE.MeshStandardMaterial;
  private coilFiber: THREE.MeshStandardMaterial | null = null;
  mode: MaterialMode = 'studio';

  constructor() {
    const rubber = new THREE.MeshStandardMaterial({ color: '#191b1e', roughness: 0.93, metalness: 0.0, side: THREE.DoubleSide });
    const cone = new THREE.MeshStandardMaterial({ color: '#23262b', roughness: 0.62, metalness: 0.05 });
    const cap = new THREE.MeshStandardMaterial({ color: '#1e2125', roughness: 0.42, metalness: 0.12 });
    const metal = new THREE.MeshStandardMaterial({ color: '#33373d', roughness: 0.48, metalness: 0.82 });
    const steel = new THREE.MeshStandardMaterial({ color: '#6d747c', roughness: 0.38, metalness: 0.9 });
    const box = new THREE.MeshStandardMaterial({ color: '#141517', roughness: 0.88, metalness: 0.05 });
    this.studio.set('rubber', rubber);
    this.studio.set('cone', cone);
    this.studio.set('cap', cap);
    this.studio.set('coil', this.makeCoilMaterial());
    this.studio.set('metal', metal);
    this.studio.set('steel', steel);
    this.studio.set('box', box);
    this.originalMat = new THREE.MeshStandardMaterial({ color: '#b9bdc4', roughness: 0.72, metalness: 0.04 });
  }

  private makeCoilMaterial(): THREE.MeshStandardMaterial {
    const tex = fiberTexture();
    this.coilFiber = new THREE.MeshStandardMaterial({
      color: '#cfd2d6', map: tex, roughness: 0.55, metalness: 0.25, side: THREE.DoubleSide
    });
    return this.coilFiber;
  }

  setFiberDetail(on: boolean): void {
    if (this.coilFiber) this.coilFiber.map = on ? fiberTexture() : null;
    if (this.coilFiber) this.coilFiber.needsUpdate = true;
  }

  for(kind: MaterialKind): THREE.MeshStandardMaterial {
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
