// Three-part rubber surround deformation.
//
// Technique: CPU-side vertex displacement on the original GLB geometry.
// For every vertex we precompute (from REST world positions):
//   w(r)   — axial-drive weight purely as a function of radial distance r
//            from the driver axis, so the field is C0-continuous across the
//            three surround parts (shared seam vertices get identical w).
//            w = 1 at/below the cone attach radius (inner edge follows the
//            cone EXACTLY — no gap), w = 0 at/above the frame radius
//            (outer edge stays fixed — no detachment).
//   dirA   — the world driver axis expressed in the mesh's LOCAL space
//   dirR   — per-vertex radial direction in local space (volume compensation)
//
// Per frame: p = rest + dirA * (d * w) + dirR * (bulge * sin(pi*w))
// The bulge term makes the half-roll appear to roll rather than shear; it is
// signed with the displacement so inward/outward excursion both work, and it
// vanishes at both edges (sin(pi*0)=sin(pi*1)=0), preserving attachments.
//
// Flexibility reshapes w between the edges ONLY — the plateau guarantees
// (w=1 inner, w=0 outer) hold for every flexibility value.
import * as THREE from 'three';
import type { AuditedPart } from './gltfAudit';
import { clamp01, smooth } from './gltfAudit';

interface DeformPart {
  mesh: THREE.Mesh;
  rest: Float32Array;      // rest local positions
  dirA: Float32Array;      // per-vertex: driver axis in local space (same for all verts, stored per slot for cache-friendly loop)
  dirR: Float32Array;      // per-vertex radial dir (local)
  w: Float32Array;         // per-vertex weight
  sinW: Float32Array;      // sin(pi*w)
  count: number;
  positionAttr: THREE.BufferAttribute;
  needsNormals: boolean;
}

export class SurroundDeformer {
  private parts: DeformPart[] = [];
  private flexibility = 0.6;
  private lastAppliedD = NaN;   // positions currently on the GPU
  private lastNormalD = NaN;    // normals computed for this displacement
  private lastNormalTime = 0;   // ms timestamp of last normal rebuild

  constructor(parts: AuditedPart[], private axis: THREE.Vector3, private axisPoint: THREE.Vector3,
              private rIn: number, private rOut: number) {
    for (const p of parts) this.addPart(p);
    this.rebuildWeights();
  }

  private addPart(part: AuditedPart): void {
    const mesh = part.mesh;
    const geo = mesh.geometry;
    const posAttr = geo.getAttribute('position') as THREE.BufferAttribute;
    const count = posAttr.count;
    const rest = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      rest[i * 3] = posAttr.getX(i);
      rest[i * 3 + 1] = posAttr.getY(i);
      rest[i * 3 + 2] = posAttr.getZ(i);
    }

    mesh.updateWorldMatrix(true, false);
    const qWorld = mesh.getWorldQuaternion(new THREE.Quaternion());
    const qInv = qWorld.clone().invert();

    // driver axis in local space (uniform)
    const axisLocal = this.axis.clone().applyQuaternion(qInv).normalize();

    const dirA = new Float32Array(count * 3);
    const dirR = new Float32Array(count * 3);
    const v = new THREE.Vector3();
    const radial = new THREE.Vector3();

    for (let i = 0; i < count; i++) {
      dirA[i * 3] = axisLocal.x; dirA[i * 3 + 1] = axisLocal.y; dirA[i * 3 + 2] = axisLocal.z;
      v.fromBufferAttribute(posAttr, i).applyMatrix4(mesh.matrixWorld);
      radial.copy(v).sub(this.axisPoint);
      const axial = radial.dot(this.axis);
      radial.addScaledVector(this.axis, -axial);
      if (radial.lengthSq() < 1e-10) radial.set(1, 0, 0); else radial.normalize();
      radial.applyQuaternion(qInv); // to local space
      dirR[i * 3] = radial.x; dirR[i * 3 + 1] = radial.y; dirR[i * 3 + 2] = radial.z;
    }

    this.parts.push({
      mesh, rest, dirA, dirR,
      w: new Float32Array(count),
      sinW: new Float32Array(count),
      count,
      positionAttr: posAttr,
      needsNormals: false
    });
  }

  /** Rebuild the weight field for a flexibility value (0..1).
   *  IMPORTANT: reads REST positions — current buffer positions may be
   *  displaced by a previous apply(), which would corrupt the radius field. */
  rebuildWeights(flexibility?: number): void {
    if (flexibility !== undefined) this.flexibility = clamp01(flexibility);
    const span = Math.max(1e-5, this.rOut - this.rIn);
    // flexibility: 0 => stiff roll (weight concentrated near the cone edge),
    //              1 => soft roll (gradual, smoothstep-like sharing)
    const expo = 2.4 - 1.4 * this.flexibility;
    const v = new THREE.Vector3();
    for (const part of this.parts) {
      part.mesh.updateWorldMatrix(true, false);
      const m = part.mesh.matrixWorld.elements;
      for (let i = 0; i < part.count; i++) {
        // rest position (local) -> world (translation/scale handled; rotation is
        // identity for these meshes but apply the full matrix for safety)
        const lx = part.rest[i * 3], ly = part.rest[i * 3 + 1], lz = part.rest[i * 3 + 2];
        v.set(
          m[0] * lx + m[4] * ly + m[8] * lz + m[12],
          m[1] * lx + m[5] * ly + m[9] * lz + m[13],
          m[2] * lx + m[6] * ly + m[10] * lz + m[14]
        );
        const dx = v.x - this.axisPoint.x, dy = v.y - this.axisPoint.y, dz = v.z - this.axisPoint.z;
        const axial = dx * this.axis.x + dy * this.axis.y + dz * this.axis.z;
        const r = Math.sqrt(Math.max(0, dx * dx + dy * dy + dz * dz - axial * axial));
        let t = clamp01((this.rOut - r) / span);
        t = Math.pow(t, expo);
        const w = smooth(t); // smoothstep keeps derivative 0 at both ends
        part.w[i] = w;
        part.sinW[i] = Math.sin(Math.PI * w);
      }
    }
    this.lastAppliedD = NaN; // force position refresh with the new weight field
  }

  /** Apply axial excursion d (world units, signed along `axis`) + bulge. */
  apply(d: number, strength: number, bulgeK = 0.14): void {
    // Skip redundant GPU uploads: only refresh when the displacement actually
    // changed by a perceptible amount (keeps the render loop cheap at rest).
    if (this.lastAppliedD === d) return;
    if (Math.abs(d - (isNaN(this.lastAppliedD) ? NaN : this.lastAppliedD)) < 1e-5 && !isNaN(this.lastAppliedD)) return;
    this.lastAppliedD = d;
    const bulge = -d * bulgeK * clamp01(strength) * 2.2;
    for (const part of this.parts) {
      const attr = part.positionAttr;
      const arr = attr.array as Float32Array;
      for (let i = 0; i < part.count; i++) {
        const i3 = i * 3;
        const ax = d * part.w[i];
        const rad = bulge * part.sinW[i];
        arr[i3] = part.rest[i3] + part.dirA[i3] * ax + part.dirR[i3] * rad;
        arr[i3 + 1] = part.rest[i3 + 1] + part.dirA[i3 + 1] * ax + part.dirR[i3 + 1] * rad;
        arr[i3 + 2] = part.rest[i3 + 2] + part.dirA[i3 + 2] * ax + part.dirR[i3 + 2] * rad;
      }
      attr.needsUpdate = true;
      part.needsNormals = true;
    }
    this.updateNormals(d);
  }

  /** Normals are throttled: recomputing ~170k triangle normals every single
   *  frame is wasteful — shading differences below ~0.3 mm of excursion are
   *  invisible on matte rubber, so we rebuild at most every 90 ms and only
   *  when the displacement moved by more than 0.25 mm since the last rebuild. */
  private updateNormals(d: number): void {
    const now = performance.now();
    const movedEnough = isNaN(this.lastNormalD) || Math.abs(d - this.lastNormalD) > 0.00025;
    if (!movedEnough || now - this.lastNormalTime < 90) return;
    this.lastNormalTime = now;
    this.lastNormalD = d;
    for (const part of this.parts) {
      if (part.needsNormals) {
        part.mesh.geometry.computeVertexNormals();
        part.needsNormals = false;
      }
    }
  }

  /** Restore the exact rest shape. */
  reset(): void {
    for (const part of this.parts) {
      const attr = part.positionAttr;
      (attr.array as Float32Array).set(part.rest);
      attr.needsUpdate = true;
      part.mesh.geometry.computeVertexNormals();
      part.needsNormals = false;
    }
    this.lastAppliedD = 0;
    this.lastNormalD = 0;
    this.lastNormalTime = performance.now();
  }
}
