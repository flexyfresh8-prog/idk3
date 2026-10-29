// Three-part rubber surround deformation — GPU-accelerated.
//
// v3.2 ran this deformation on the CPU: every frame it rewrote ~87k vertex
// positions across the three surround meshes, re-uploaded ~1 MB of position
// buffers to the GPU, and every 90 ms recomputed normals for ~170k triangles
// (computeVertexNormals) — multi-millisecond CPU spikes that made music
// playback stutter. The deformation field is fully analytic, so it now runs
// ENTIRELY in the vertex shader:
//
//   p' = p + aDirA·(uD·aW) + aDirR·(uBulge·sin(π·aW))
//   n' = normalize(n − (uD·aDirA + uBulge·π·cos(π·aW)·aDirR)·aKG)
//
// Per-vertex precomputed attributes (from REST geometry, built once):
//   aDirA — the driver axis in the mesh's LOCAL space
//   aDirR — per-vertex radial direction in local space
//   aW    — axial-drive weight w(r): 1 at/below the cone attach radius
//           (inner edge follows the cone EXACTLY — no gap), 0 at/above the
//           frame radius (outer edge fixed — no detachment). C0-continuous
//           across the three parts because it depends only on world radius.
//   aKG   — dot(∇w, restNormal): the precomputed normal-perturbation factor.
//           Derived from the analytic gradient of the weight field, so the
//           shading follows the roll WITHOUT any per-frame normal rebuild.
//
// Per frame the CPU only writes two shared uniforms (uD, uBulge) — zero
// vertex work, zero buffer uploads, zero GC pressure. The normal update is
// the first-order Jacobian correction of the same field, so it stays
// physically consistent with the displaced surface (no computeVertexNormals,
// no flip-guard needed — the rest normals never change sign).
//
// Flexibility reshapes w between the edges ONLY — the plateau guarantees
// (w=1 inner, w=0 outer) hold for every flexibility value.
import * as THREE from 'three';
import type { AuditedPart } from './gltfAudit';
import { clamp01, smooth } from './gltfAudit';

interface DeformPart {
  index: number;
  mesh: THREE.Mesh;
  rest: Float32Array;      // rest local positions (source of truth for bounds)
  dirA: Float32Array;      // per-vertex: driver axis in local space
  dirR: Float32Array;      // per-vertex radial dir (local)
  wAttr: THREE.BufferAttribute;   // aW
  kgAttr: THREE.BufferAttribute;  // aKG
  count: number;
}

interface DeformUniforms {
  uD: { value: number };
  uBulge: { value: number };
}

/** Deform uniforms are a MODULE-LEVEL SINGLETON, deliberately shared by every
 *  SurroundDeformer instance. Why instance-owned uniforms break:
 *
 *  1. MaterialLibrary caches ONE material instance per kind ('rubber') and it
 *     OUTLIVES driver hot-swaps — the 10-inch and the 2-inch mini patch the
 *     very same material object.
 *  2. Every deformer injects IDENTICAL shader source under the SAME
 *     customProgramCacheKey. Three.js therefore hits its program cache after
 *     the first swap: onBeforeCompile is NOT re-run and the cached WebGL
 *     program keeps referencing the uniforms captured at ITS compile time.
 *  3. With per-instance uniform objects, that cached program stayed bound to
 *     the PREVIOUS driver's deformer — which nobody updates anymore — so
 *     after one hot-swap the surround read frozen uniforms and never moved
 *     again (the 2-inch mini shipped with exactly this bug).
 *
 *  A single shared uniforms object makes program reuse CORRECT: whichever
 *  deformer is current writes the same objects the GPU program reads. */
const SHARED_DEFORM_UNIFORMS: DeformUniforms = { uD: { value: 0 }, uBulge: { value: 0 } };

const DEFORM_CACHE_KEY = 'idk3-surround-deform-v3';

export class SurroundDeformer {
  private parts: DeformPart[] = [];
  private flexibility = 0.6;
  private lastD = NaN;
  private lastBulge = NaN;
  private patched = new WeakSet<THREE.Material>();

  /** Smooth per-vertex normals derived from triangle winding, returned as a
   *  raw Float32Array. Used instead of BufferGeometry.computeVertexNormals()
   *  when the existing normal attribute is degenerate or quantized: three's
   *  implementation writes through the existing attribute, and a normalized
   *  Int8 attribute truncates every small cross-product write to zero. */
  private static buildFloatNormals(geo: THREE.BufferGeometry): Float32Array {
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    const count = pos.count;
    const nrm = new Float32Array(count * 3);
    const index = geo.index;
    if (index) {
      for (let i = 0; i < index.count; i += 3) {
        const a = index.getX(i), b = index.getX(i + 1), c = index.getX(i + 2);
        const ax = pos.getX(a), ay = pos.getY(a), az = pos.getZ(a);
        const bx = pos.getX(b), by = pos.getY(b), bz = pos.getZ(b);
        const cx = pos.getX(c), cy = pos.getY(c), cz = pos.getZ(c);
        const cbx = cx - bx, cby = cy - by, cbz = cz - bz;
        const abx = ax - bx, aby = ay - by, abz = az - bz;
        const nx = cby * abz - cbz * aby;
        const ny = cbz * abx - cbx * abz;
        const nz = cbx * aby - cby * abx;
        nrm[a * 3] += nx; nrm[a * 3 + 1] += ny; nrm[a * 3 + 2] += nz;
        nrm[b * 3] += nx; nrm[b * 3 + 1] += ny; nrm[b * 3 + 2] += nz;
        nrm[c * 3] += nx; nrm[c * 3 + 1] += ny; nrm[c * 3 + 2] += nz;
      }
    } else {
      for (let i = 0; i < count; i += 3) {
        const ax = pos.getX(i), ay = pos.getY(i), az = pos.getZ(i);
        const bx = pos.getX(i + 1), by = pos.getY(i + 1), bz = pos.getZ(i + 1);
        const cx = pos.getX(i + 2), cy = pos.getY(i + 2), cz = pos.getZ(i + 2);
        const cbx = cx - bx, cby = cy - by, cbz = cz - bz;
        const abx = ax - bx, aby = ay - by, abz = az - bz;
        const nx = cby * abz - cbz * aby;
        const ny = cbz * abx - cbx * abz;
        const nz = cbx * aby - cby * abx;
        nrm[i * 3] += nx; nrm[i * 3 + 1] += ny; nrm[i * 3 + 2] += nz;
        nrm[(i + 1) * 3] += nx; nrm[(i + 1) * 3 + 1] += ny; nrm[(i + 1) * 3 + 2] += nz;
        nrm[(i + 2) * 3] += nx; nrm[(i + 2) * 3 + 1] += ny; nrm[(i + 2) * 3 + 2] += nz;
      }
    }
    for (let i = 0; i < count; i++) {
      const x = nrm[i * 3], y = nrm[i * 3 + 1], z = nrm[i * 3 + 2];
      const l = Math.sqrt(x * x + y * y + z * z) || 1;
      nrm[i * 3] = x / l; nrm[i * 3 + 1] = y / l; nrm[i * 3 + 2] = z / l;
    }
    return nrm;
  }

  constructor(parts: AuditedPart[], private axis: THREE.Vector3, private axisPoint: THREE.Vector3,
              private rIn: number, private rOut: number,
              /** local units per world unit (1 / model root scale). The shader
               *  displaces LOCAL coordinates, but the excursion d arrives in
               *  WORLD units — when the driver model is uniformly scaled (the
               *  2-inch mini is scaled to its 2" rating) the uniform must be
               *  converted or the surround would travel 1/scale × too far. */
              private unitsPerWorld = 1) {
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

    // Normal-attribute repair + orientation reference.
    //
    // Generated GLBs (Tripo + meshopt quantization) ship the surround's
    // normals as a NORMALIZED Int8 attribute — and in this model they decode
    // to ALL ZEROS. Worse, THREE.BufferGeometry.computeVertexNormals()
    // accumulates raw (unnormalized) cross products through setXYZ(), whose
    // normalized-Int8 path encodes with Math.round(v * 127): on a small-scale
    // model the cross products are ~1e-6, so EVERY write quantizes to 0 and
    // the roll shades pitch black (N·L = 0) no matter what the material says.
    //
    // Fix: build smooth normals ourselves into a fresh Float32 attribute
    // (also removes the 127-step banding). These repaired REST normals are
    // also the base for the shader-side Jacobian normal update, and the
    // orientation reference recorded for the surroundNormals() test hook.
    let refNormals: Float32Array | null = null;
    const nAttr0 = geo.getAttribute('normal') as THREE.BufferAttribute | undefined;
    if (nAttr0) {
      let nonZero = 0;
      const probe = Math.min(count, 512);
      for (let i = 0; i < probe; i++) {
        if (nAttr0.getX(i) !== 0 || nAttr0.getY(i) !== 0 || nAttr0.getZ(i) !== 0) nonZero++;
      }
      const degenerate = nonZero < probe * 0.01;
      const quantized = nAttr0.normalized ||
        (nAttr0 as unknown as { isInterleavedBufferAttribute?: boolean }).isInterleavedBufferAttribute === true ||
        nAttr0.array.constructor !== Float32Array;
      if (degenerate) {
        // No usable authored data: derive from triangle winding.
        refNormals = SurroundDeformer.buildFloatNormals(geo);
        geo.setAttribute('normal', new THREE.BufferAttribute(refNormals, 3));
      } else if (quantized) {
        // Authored data is good but quantized/interleaved — decode it into a
        // Float32 attribute so nothing downstream can truncate to zero.
        const decoded = new Float32Array(count * 3);
        for (let i = 0; i < count; i++) {
          decoded[i * 3] = nAttr0.getX(i);
          decoded[i * 3 + 1] = nAttr0.getY(i);
          decoded[i * 3 + 2] = nAttr0.getZ(i);
        }
        refNormals = decoded;
        geo.setAttribute('normal', new THREE.BufferAttribute(decoded, 3));
      } else {
        const authored = new Float32Array(count * 3);
        for (let i = 0; i < count; i++) {
          authored[i * 3] = nAttr0.getX(i);
          authored[i * 3 + 1] = nAttr0.getY(i);
          authored[i * 3 + 2] = nAttr0.getZ(i);
        }
        refNormals = authored;
      }
      (geo.userData as { authoredNormals?: Float32Array }).authoredNormals = refNormals;
    }

    mesh.updateWorldMatrix(true, false);
    const qWorld = mesh.getWorldQuaternion(new THREE.Quaternion());
    const qInv = qWorld.clone().invert();

    // driver axis in local space (uniform per part)
    const axisLocal = this.axis.clone().applyQuaternion(qInv).normalize();

    const dirA = new Float32Array(count * 3);
    const dirR = new Float32Array(count * 3);
    const wArr = new Float32Array(count);
    const kgArr = new Float32Array(count);
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

    geo.setAttribute('aDirA', new THREE.BufferAttribute(dirA, 3));
    geo.setAttribute('aDirR', new THREE.BufferAttribute(dirR, 3));
    const wAttr = new THREE.BufferAttribute(wArr, 1);
    const kgAttr = new THREE.BufferAttribute(kgArr, 1);
    geo.setAttribute('aW', wAttr);
    geo.setAttribute('aKG', kgAttr);

    this.parts.push({
      index: part.index, mesh, rest, dirA, dirR,
      wAttr, kgAttr, count
    });
  }

  /** Rebuild the weight field (aW) and its normal-gradient factor (aKG) for a
   *  flexibility value (0..1). Reads REST positions — never the live buffer.
   *  aKG = dw/dr · dot(radialDir, restNormal): because the deformation field
   *  is D(p) = aDirA·(uD·w) + aDirR·(uBulge·sin(πw)) with w = w(r), its
   *  Jacobian is (uD·aDirA + uBulge·π·cos(πw)·aDirR) ⊗ ∇w — so the whole
   *  normal correction needs only this one dot product per vertex. */
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
      const dirR = part.dirR;
      const nAttr = part.mesh.geometry.getAttribute('normal') as THREE.BufferAttribute;
      const wArr = part.wAttr.array as Float32Array;
      const kgArr = part.kgAttr.array as Float32Array;
      for (let i = 0; i < part.count; i++) {
        const lx = part.rest[i * 3], ly = part.rest[i * 3 + 1], lz = part.rest[i * 3 + 2];
        v.set(
          m[0] * lx + m[4] * ly + m[8] * lz + m[12],
          m[1] * lx + m[5] * ly + m[9] * lz + m[13],
          m[2] * lx + m[6] * ly + m[10] * lz + m[14]
        );
        const dx = v.x - this.axisPoint.x, dy = v.y - this.axisPoint.y, dz = v.z - this.axisPoint.z;
        const axial = dx * this.axis.x + dy * this.axis.y + dz * this.axis.z;
        const r = Math.sqrt(Math.max(0, dx * dx + dy * dy + dz * dz - axial * axial));
        const u = clamp01((this.rOut - r) / span);
        const t = Math.pow(u, expo);
        const w = smooth(t); // smoothstep keeps derivative 0 at both ends
        wArr[i] = w;
        // analytic dw/dr of the SAME field the shader displaces with:
        //   w = t²(3-2t), t = u^expo, u = (rOut − r)/span  →  dw/dr < 0
        let dwdr = 6 * t * (1 - t) * expo * Math.pow(u, expo - 1) / span;
        if (!isFinite(dwdr)) dwdr = 0;
        const i3 = i * 3;
        // ∇w(local) = dw/dr · r̂  (r̂ = dirR, the outward radial dir) — the
        // sign of dw/dr already encodes "w falls with radius"; aKG = ∇w·N.
        kgArr[i] = dwdr * (dirR[i3] * nAttr.getX(i) + dirR[i3 + 1] * nAttr.getY(i) + dirR[i3 + 2] * nAttr.getZ(i));
      }
      part.wAttr.needsUpdate = true;
      part.kgAttr.needsUpdate = true;
    }
    this.lastD = NaN; // force uniform refresh with the new weight field
  }

  /** Inject the deformation into a material's vertex shader. Safe to call on
   *  any MeshStandardMaterial-based material; meshes WITHOUT the deform
   *  attributes are unaffected (unbound attributes read as 0 → zero
   *  displacement, zero normal change), so even shared materials are safe. */
  patchMaterial(mat: THREE.Material): void {
    if (!mat || this.patched.has(mat) || !('isMeshStandardMaterial' in mat)) return;
    const shared = SHARED_DEFORM_UNIFORMS;
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uD = shared.uD;
      shader.uniforms.uBulge = shared.uBulge;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', /* glsl */`#include <common>
  uniform float uD;
  uniform float uBulge;
  attribute vec3 aDirA;
  attribute vec3 aDirR;
  attribute float aW;
  attribute float aKG;`)
        .replace('#include <beginnormal_vertex>', /* glsl */`#include <beginnormal_vertex>
  {
    // First-order Jacobian normal update of the displacement field below:
    // n' = normalize(n − (∂D/∂p)ᵀ·n),  ∂D/∂p ≈ jRow ⊗ ∇w,  ∇w·n = aKG.
    float cwB = uBulge * PI * cos(PI * aW);
    vec3 jRow = uD * aDirA + cwB * aDirR;
    objectNormal = normalize(objectNormal - jRow * aKG);
  }`)
        .replace('#include <begin_vertex>', /* glsl */`#include <begin_vertex>
  transformed += aDirA * (uD * aW) + aDirR * (uBulge * sin(PI * aW));`);
    };
    mat.customProgramCacheKey = () => DEFORM_CACHE_KEY;
    this.patched.add(mat);
    mat.needsUpdate = true;
  }

  /** Patch whatever materials the surround meshes currently use. Call once
   *  after material assignment and again after any finish swap. */
  refreshMaterials(): void {
    for (const part of this.parts) {
      const mats = Array.isArray(part.mesh.material) ? part.mesh.material : [part.mesh.material];
      for (const m of mats) this.patchMaterial(m);
    }
  }

  /** Apply axial excursion d (world units, signed along `axis`) + bulge.
   *  GPU path: this only writes uniforms (converted to LOCAL units — the
   *  vertex shader works in local space) — the shader does the rest.
   *
   *  bulgeK drives the roll's radial "breathing": the crest of the roll
   *  (w ≈ 0.5, where sin(πw) peaks) shifts radially by ≈ bulgeK·2.2·|d| as
   *  the cone strokes. Physically the inextensible rubber membrane flattens
   *  against the flange on the OUTWARD stroke (crest pulls in) and stands
   *  up/inflates on the INWARD stroke (crest pushes out) — hence the −d sign.
   *  0.14 made the crest travel only ~31 % of the cone excursion, which read
   *  as a FROZEN roll (the moving inner wall hides behind the crest from any
   *  outside view — the "surround doesn't move" report). 0.24 puts the
   *  visible crest swing at ~53 % of excursion: the roll visibly rolls. */
  apply(d: number, strength: number, bulgeK = 0.24): void {
    if (!isFinite(d)) d = 0;
    const dLocal = d * this.unitsPerWorld;
    const bulge = -dLocal * bulgeK * clamp01(strength) * 2.2;
    if (dLocal === this.lastD && bulge === this.lastBulge) return;
    this.lastD = dLocal;
    this.lastBulge = bulge;
    SHARED_DEFORM_UNIFORMS.uD.value = dLocal;
    SHARED_DEFORM_UNIFORMS.uBulge.value = bulge;
  }

  /** Current LOCAL-space z bounds of each deformed surround part. Test-hook
   *  replacement for geometry.computeBoundingBox() (which now always sees
   *  rest positions — the deformation lives on the GPU). */
  getDeformedBoundsZ(): Record<number, { min: number; max: number }> {
    const uD = SHARED_DEFORM_UNIFORMS.uD.value;
    const uBulge = SHARED_DEFORM_UNIFORMS.uBulge.value;
    const out: Record<number, { min: number; max: number }> = {};
    for (const part of this.parts) {
      const wArr = part.wAttr.array as Float32Array;
      let min = Infinity, max = -Infinity;
      for (let i = 0; i < part.count; i++) {
        const w = wArr[i];
        const z = part.rest[i * 3 + 2]
          + part.dirA[i * 3 + 2] * (uD * w)
          + part.dirR[i * 3 + 2] * (uBulge * Math.sin(Math.PI * w));
        if (z < min) min = z;
        if (z > max) max = z;
      }
      out[part.index] = { min, max };
    }
    return out;
  }

  /** Restore the exact rest pose (uniforms → 0; buffers were never touched). */
  reset(): void {
    SHARED_DEFORM_UNIFORMS.uD.value = 0;
    SHARED_DEFORM_UNIFORMS.uBulge.value = 0;
    this.lastD = 0;
    this.lastBulge = 0;
  }

  /** Direct uniform access for automated tests (acceptance test asserts the
   *  GPU path is actually driven by the physics displacement). Returns the
   *  module singleton — the same objects the GPU program reads. */
  getUniformsForTest(): DeformUniforms {
    return SHARED_DEFORM_UNIFORMS;
  }
}
