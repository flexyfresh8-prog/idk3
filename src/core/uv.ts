// Cylindrical UV generation — both supplied GLBs ship with POSITION+NORMAL
// only (gltfpack strips TEXCOORD when the source has none), so every procedural
// PBR texture sampled a single texel: the weave/brush/carpet detail never
// showed. Every part of a loudspeaker is a body of revolution around the
// driver axis, so a CYLINDRICAL projection around that axis is the natural
// parameterization:
//
//   u = (atan2(dy, dx) / 2π + 0.5) · U_WRAPS      angular coordinate
//   v = axial · V_PER_UNIT                         axial coordinate
//
// U_WRAPS is an integer so the atan2 seam (−π → +π) lands exactly on a tile
// boundary: with RepeatWrapping the wrap is invisible. World-space mapping
// keeps density consistent across parts of very different sizes (the 10-inch
// flange and the mini's coil get the same texel density).
//
// Runs once per model mount — ~1M vertices, one-time cost, then the buffers
// live on the GPU as usual.
import * as THREE from 'three';

const U_WRAPS = 14;        // texture tiles around the full circumference
const V_PER_UNIT = 22;     // texture tiles per world-unit along the axis

export function generateCylindricalUVs(root: THREE.Object3D, axis: THREE.Vector3, axisPoint: THREE.Vector3): number {
  root.updateMatrixWorld(true);
  const ax = Math.abs(axis.x), ay = Math.abs(axis.y), az = Math.abs(axis.z);
  let meshes = 0;
  const v = new THREE.Vector3();
  const d = new THREE.Vector3();
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!(mesh as any).isMesh) return;
    const geo = mesh.geometry as THREE.BufferGeometry;
    const pos = geo.getAttribute('position') as THREE.BufferAttribute | undefined;
    if (!pos) return;
    let uv = geo.getAttribute('uv') as THREE.BufferAttribute | null;
    if (!uv || uv.count !== pos.count || (uv as any).isGeneratedCylindrical) {
      uv = new THREE.BufferAttribute(new Float32Array(pos.count * 2), 2);
      (uv as any).isGeneratedCylindrical = true;
      geo.setAttribute('uv', uv);
    }
    const arr = uv.array as Float32Array;
    // local → world once per vertex; project onto the axis frame
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
      d.copy(v).sub(axisPoint);
      const axial = d.dot(axis);
      // radial components: drop the axial part
      const rx = d.x - axis.x * axial;
      const ry = d.y - axis.y * axial;
      const rz = d.z - axis.z * axial;
      // 2D coords in the plane ⊥ axis
      let px: number, py: number, hgt: number;
      if (az >= ax && az >= ay)      { px = rx; py = ry; hgt = axial; }
      else if (ax >= ay && ax >= az) { px = ry; py = rz; hgt = axial; }
      else                           { px = rz; py = rx; hgt = axial; }
      const ang = Math.atan2(py, px) / (Math.PI * 2) + 0.5;
      arr[i * 2] = ang * U_WRAPS;
      arr[i * 2 + 1] = hgt * V_PER_UNIT;
    }
    uv.needsUpdate = true;
    meshes++;
  });
  return meshes;
}
