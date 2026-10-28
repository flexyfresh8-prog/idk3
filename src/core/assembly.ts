// Moving assembly: cone (21) + dust cap (6) + voice coil (1) ride on one
// rigid group that translates strictly along the verified driver axis.
// The coil can get an extra inspection offset (coilFollow ≠ 1) but at the
// default 1.0 it is glued to the cone — a coordinated mechanical system.
import * as THREE from 'three';
import type { AuditedPart } from './gltfAudit';

export class ConeAssembly {
  readonly group = new THREE.Group();
  private members: AuditedPart[] = [];
  private coil: AuditedPart | null = null;
  private coilRestLocal = new THREE.Vector3();
  private axisLocal = new THREE.Vector3(0, 0, 1);
  private attached = false;
  currentD = 0; // mm (for UI/tests)

  constructor(private axis: THREE.Vector3, private outwardSign: number) {
    this.group.name = 'movingAssembly';
  }

  attach(parts: AuditedPart[]): void {
    if (this.attached) return;
    this.members = parts;
    this.coil = parts.find((p) => p.spec.role === 'voiceCoil') ?? null;
    for (const p of parts) {
      this.group.attach(p.mesh);
      p.mesh.castShadow = true;
      p.mesh.receiveShadow = false;
    }
    if (this.coil) {
      this.coilRestLocal.copy(this.coil.mesh.position);
      const qInv = this.group.getWorldQuaternion(new THREE.Quaternion()).invert();
      this.axisLocal.copy(this.axis).applyQuaternion(qInv).normalize();
    }
    this.attached = true;
  }

  /** d in world units along the axis, POSITIVE = outward (firing direction). */
  setDisplacement(dUnits: number, coilFactor = 1): void {
    this.currentD = dUnits * 1000; // mm, signed outward+
    // convert to model-axis motion: positive d moves the assembly OUTWARD
    this.group.position.copy(this.axis).multiplyScalar(dUnits * this.outwardSign);
    if (this.coil) {
      const extra = dUnits * (coilFactor - 1) * this.outwardSign;
      this.coil.mesh.position.copy(this.coilRestLocal).addScaledVector(this.axisLocal, extra);
    }
  }

  /** Per-part reset (used by inspector). Returns part to its original scene slot. */
  detachPart(part: AuditedPart): void {
    if (part.restParent) {
      part.restParent.add(part.mesh);
      part.mesh.position.copy(part.restPosition);
      part.mesh.quaternion.copy(part.restQuaternion);
      part.mesh.scale.copy(part.restScale);
    }
    this.members = this.members.filter((m) => m !== part);
    if (this.coil === part) this.coil = null;
    this.attached = this.members.length > 0;
  }

  reset(): void {
    this.setDisplacement(0, 1);
  }

  get memberParts(): AuditedPart[] { return [...this.members]; }
}
