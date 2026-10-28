// Runtime model audit: identifies every mesh of the supplied GLB, verifies the
// mapping against the offline audit, measures world-space geometry (AABBs,
// radial extents around the driver axis) and exposes it to the UI + tests.
import * as THREE from 'three';
import { specFor, EXPECTED_PARTS, type PartSpec } from './types';

export interface AuditedPart {
  index: number;
  nodeName: string;
  mesh: THREE.Mesh;
  spec: PartSpec;
  verts: number;
  tris: number;
  center: THREE.Vector3;   // world AABB center
  size: THREE.Vector3;     // world AABB size
  minZ: number; maxZ: number;
  rIn: number; rOut: number;   // radial extent around the driver axis (percentile-based)
  // original transform bookkeeping (for per-part reset)
  restParent: THREE.Object3D | null;
  restPosition: THREE.Vector3;
  restQuaternion: THREE.Quaternion;
  restScale: THREE.Vector3;
}

export interface AuditResult {
  parts: AuditedPart[];
  byIndex: Map<number, AuditedPart>;
  axis: THREE.Vector3;        // unit driver axis (+Z in model space)
  outward: THREE.Vector3;     // unit direction the driver fires (−Z here)
  axisPoint: THREE.Vector3;   // a point on the axis (model center xy)
  surroundParts: AuditedPart[];
  movingParts: AuditedPart[];
  frameParts: AuditedPart[];
  motorParts: AuditedPart[];
  enclosureParts: AuditedPart[];
  rInGlobal: number;          // surround inner attach radius (world units)
  rOutGlobal: number;         // surround outer edge radius
  coneRimRadius: number;      // cone outer edge radius
  modelCenter: THREE.Vector3;
  modelRadius: number;
  notes: string[];
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const smooth = (t: number) => t * t * (3 - 2 * t);

function radialStats(mesh: THREE.Mesh, axis: THREE.Vector3, axisPoint: THREE.Vector3): { rIn: number; rOut: number } {
  const pos = mesh.geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
  if (!pos) return { rIn: 0, rOut: 0 };
  mesh.updateWorldMatrix(true, false);
  const v = new THREE.Vector3();
  const rs: number[] = [];
  const stride = Math.max(1, Math.floor(pos.count / 4000)); // sample big meshes
  for (let i = 0; i < pos.count; i += stride) {
    v.fromBufferAttribute(pos as THREE.BufferAttribute, i).applyMatrix4(mesh.matrixWorld);
    const d = v.clone().sub(axisPoint);
    const axial = d.dot(axis);
    const radial = Math.sqrt(Math.max(0, d.lengthSq() - axial * axial));
    rs.push(radial);
  }
  rs.sort((a, b) => a - b);
  const p = (f: number) => rs[Math.min(rs.length - 1, Math.floor(f * rs.length))];
  return { rIn: p(0.02), rOut: p(0.98) };
}

export function auditModel(root: THREE.Object3D): AuditResult {
  const notes: string[] = [];
  const parts: AuditedPart[] = [];
  const byIndex = new Map<number, AuditedPart>();

  root.updateMatrixWorld(true);

  // pass 1: collect meshes + names
  const re = /tripo_part_(\d+)/;
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!(mesh as any).isMesh) return;
    const m = re.exec(mesh.name) ?? re.exec(mesh.parent?.name ?? '');
    if (!m) { notes.push(`Unrecognized mesh node "${mesh.name}" — treated as motor detail.`); return; }
    const index = parseInt(m[1], 10);
    const spec = specFor(index);
    const geo = mesh.geometry;
    const posAttr = geo.getAttribute('position') as THREE.BufferAttribute | undefined;
    const idxAttr = geo.getAttribute('position');
    const tris = geo.index ? geo.index.count / 3 : (posAttr ? posAttr.count / 3 : 0);
    const box = new THREE.Box3().setFromObject(mesh);
    parts.push({
      index,
      nodeName: mesh.name,
      mesh,
      spec,
      verts: posAttr ? posAttr.count : 0,
      tris: Math.round(tris),
      center: box.getCenter(new THREE.Vector3()),
      size: box.getSize(new THREE.Vector3()),
      minZ: box.min.z, maxZ: box.max.z,
      rIn: 0, rOut: 0,
      restParent: mesh.parent,
      restPosition: mesh.position.clone(),
      restQuaternion: mesh.quaternion.clone(),
      restScale: mesh.scale.clone()
    });
    void idxAttr;
  });

  parts.sort((a, b) => a.index - b.index);
  parts.forEach((p) => byIndex.set(p.index, p));

  // ---- driver axis: verified Z. Re-derive from data as a sanity check:
  const cone = byIndex.get(21);
  const cap = byIndex.get(6);
  const frameProbe = cone ?? cap ?? parts[0];
  const sz = frameProbe.size;
  const axisIdx = sz.x < sz.y && sz.x < sz.z ? 'x' : sz.y < sz.z ? 'y' : 'z';
  const axis = new THREE.Vector3(axisIdx === 'x' ? 1 : 0, axisIdx === 'y' ? 1 : 0, axisIdx === 'z' ? 1 : 0);
  if (axisIdx !== 'z') notes.push(`Derived axis ${axisIdx.toUpperCase()} differs from the audited Z axis — using data-driven axis.`);

  // model center from all parts
  const total = new THREE.Box3();
  parts.forEach((p) => {
    total.expandByPoint(new THREE.Vector3(p.center.x - p.size.x / 2, p.center.y - p.size.y / 2, p.center.z - p.size.z / 2));
    total.expandByPoint(new THREE.Vector3(p.center.x + p.size.x / 2, p.center.y + p.size.y / 2, p.center.z + p.size.z / 2));
  });
  const modelCenter = total.getCenter(new THREE.Vector3());
  const modelRadius = total.getSize(new THREE.Vector3()).length() / 2;
  const axisPoint = new THREE.Vector3(modelCenter.x, modelCenter.y, modelCenter.z);

  // pass 2: radial stats
  parts.forEach((p) => {
    const s = radialStats(p.mesh, axis, axisPoint);
    p.rIn = s.rIn; p.rOut = s.rOut;
  });

  // ---- outward direction: the dust cap / cone band sits at the firing side
  let frontSign = -1;
  if (cap && cone) {
    const probe = (cap.center.z + cone.center.z) / 2 - modelCenter.z;
    frontSign = probe < 0 ? -1 : 1;
  }
  const outward = axis.clone().multiplyScalar(frontSign);

  // ---- surround attach radii (global, percentile-based)
  const surroundParts = parts.filter((p) => p.spec.group === 'surround');
  const movingParts = parts.filter((p) => p.spec.group === 'moving');
  const frameParts = parts.filter((p) => p.spec.group === 'frame');
  const motorParts = parts.filter((p) => p.spec.group === 'motor');
  const enclosureParts = parts.filter((p) => p.spec.group === 'enclosure');

  let rInGlobal = Infinity, rOutGlobal = 0;
  surroundParts.forEach((p) => { rInGlobal = Math.min(rInGlobal, p.rIn); rOutGlobal = Math.max(rOutGlobal, p.rOut); });
  // push the inner attach radius up to just under the cone rim so every surround
  // part's inner edge (min 0.216..0.287 across parts) is fully driven by the cone
  const coneRimRadius = cone ? cone.rOut : rInGlobal + 0.05;
  rInGlobal = Math.max(rInGlobal, Math.min(coneRimRadius - 0.02, rInGlobal + 0.08));

  // ---- mapping verification notes
  const missing: number[] = [];
  EXPECTED_PARTS.forEach((i) => { if (!byIndex.has(i)) missing.push(i); });
  if (missing.length) notes.push(`Expected parts not found in GLB: ${missing.join(', ')}`);
  if (byIndex.has(7)) notes.push('Verified: Mesh 7 = flange quadrant with mounting holes → kept stationary (brief expected a cone).');
  notes.push(`Verified: surround = meshes ${surroundParts.map((p) => p.index).join(', ')}; moving diaphragm = ${movingParts.map((p) => p.index).join(', ')}.`);
  notes.push(`Driver axis = ${axisIdx.toUpperCase()}, firing toward ${frontSign < 0 ? '−' : '+'}${axisIdx.toUpperCase()}.`);

  return {
    parts, byIndex, axis, outward, axisPoint,
    surroundParts, movingParts, frameParts, motorParts, enclosureParts,
    rInGlobal, rOutGlobal, coneRimRadius,
    modelCenter, modelRadius, notes
  };
}

export { clamp01, smooth };
