// Component inspector: lists every audited part grouped by mechanical role,
// supports selection (subtle 3D highlight), visibility toggle, solo/isolated
// inspection, per-part transform reset and verified-mapping notes.
import * as THREE from 'three';
import type { AuditedPart } from '../core/gltfAudit';

export interface InspectorCallbacks {
  onSelect: (part: AuditedPart | null) => void;
  onVisibility: (part: AuditedPart, visible: boolean) => void;
  onSolo: (part: AuditedPart | null) => void;
  onResetTransform: (part: AuditedPart) => void;
  /** Called after a part's material is cloned for the highlight pulse.
   *  THREE does not copy onBeforeCompile on clone(), so shader-injected
   *  effects (e.g. the GPU surround deformation) must be re-applied here or
   *  the part would visually snap back to its rest shape while selected. */
  onMaterialClone?: (part: AuditedPart, clone: THREE.Material) => void;
}

const GROUP_TITLES: { key: string; title: string }[] = [
  { key: 'moving', title: 'Moving assembly' },
  { key: 'surround', title: 'Rubber surround (flexible)' },
  { key: 'frame', title: 'Frame · flange' },
  { key: 'motor', title: 'Basket · motor · suspension' },
  { key: 'enclosure', title: 'Enclosure' }
];

export class Inspector {
  private selected: AuditedPart | null = null;
  private soloed: AuditedPart | null = null;
  private rows = new Map<number, { row: HTMLElement; vis: HTMLInputElement; dimLabel: HTMLElement }>();
  private card: HTMLElement;
  private highlightMats = new Map<number, THREE.MeshStandardMaterial>();
  private pulse = 0;

  constructor(private container: HTMLElement, private parts: AuditedPart[], private cb: InspectorCallbacks) {
    this.build();
    this.card = document.getElementById('part-card')!;
  }

  private build(): void {
    this.container.innerHTML = '';
    for (const g of GROUP_TITLES) {
      const groupParts = this.parts.filter((p) => p.spec.group === g.key);
      if (!groupParts.length) continue;
      const h = document.createElement('h3');
      h.className = 'insp-group-title';
      h.textContent = g.title;
      this.container.appendChild(h);
      for (const p of groupParts) this.addRow(p);
    }
  }

  private addRow(p: AuditedPart): void {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'comp-row';
    row.dataset.part = String(p.index);

    const dot = document.createElement('span');
    dot.className = `comp-dot ${p.spec.group}`;

    const name = document.createElement('span');
    name.className = 'comp-name';
    name.textContent = p.spec.label;
    const mesh = document.createElement('span');
    mesh.className = 'comp-mesh';
    mesh.textContent = `(${p.spec.meshLabel})`;

    const right = document.createElement('span');
    right.className = 'comp-right';

    const vis = document.createElement('input');
    vis.type = 'checkbox';
    vis.checked = true;
    vis.title = `Show/hide ${p.spec.label}`;
    vis.addEventListener('click', (e) => e.stopPropagation());
    vis.addEventListener('change', () => {
      this.cb.onVisibility(p, vis.checked);
    });

    const solo = document.createElement('span');
    solo.className = 'comp-solo';
    solo.title = 'Isolated inspection';
    solo.innerHTML = '<svg viewBox="0 0 24 24" class="ic" aria-hidden="true"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" stroke="currentColor" stroke-width="1.7" fill="none" stroke-linejoin="round"/><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.7" fill="none"/></svg>';
    solo.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleSolo(p);
    });

    right.appendChild(vis);
    right.appendChild(solo);
    row.appendChild(dot);
    row.appendChild(name);
    row.appendChild(mesh);
    row.appendChild(right);

    row.addEventListener('click', () => this.select(p));

    this.container.appendChild(row);
    this.rows.set(p.index, { row, vis, dimLabel: mesh });
  }

  private toggleSolo(p: AuditedPart): void {
    this.soloed = this.soloed === p ? null : p;
    this.rows.forEach((_, idx) => {
      const row = this.rows.get(idx)!;
      row.row.classList.toggle('soloed', this.soloed === this.parts.find((q) => q.index === idx));
    });
    this.cb.onSolo(this.soloed);
  }

  select(p: AuditedPart | null): void {
    this.selected = p;
    this.rows.forEach((r, idx) => r.row.classList.toggle('selected', idx === p?.index));
    if (p) this.renderCard(p); else this.card.innerHTML = '';
    this.cb.onSelect(p);
  }

  private renderCard(p: AuditedPart): void {
    const mm = (v: number) => `${(v * 1000).toFixed(0)}`;
    this.card.innerHTML = `
      <div class="card-head">
        <strong>${p.spec.label}</strong>
        <span class="badge sim">${p.spec.meshLabel}</span>
      </div>
      <p class="card-sub">${p.nodeName} · role: ${p.spec.role}</p>
      ${p.spec.note ? `<p class="card-note">⚠ ${p.spec.note}</p>` : ''}
      <div class="card-grid">
        <div><span>Vertices</span><b>${p.verts.toLocaleString()}</b></div>
        <div><span>Triangles</span><b>${p.tris.toLocaleString()}</b></div>
        <div><span>Size (mm)</span><b>${mm(p.size.x)}×${mm(p.size.y)}×${mm(p.size.z)}</b></div>
        <div><span>Radius span</span><b>${(p.rIn * 1000).toFixed(0)}–${(p.rOut * 1000).toFixed(0)} mm</b></div>
      </div>
      <div class="card-actions">
        <button class="btn tiny" id="card-reset">Reset transform</button>
        <button class="btn tiny" id="card-solo">${this.soloed === p ? 'Exit isolation' : 'Isolate part'}</button>
      </div>`;
    document.getElementById('card-reset')?.addEventListener('click', () => this.cb.onResetTransform(p));
    document.getElementById('card-solo')?.addEventListener('click', () => this.toggleSolo(p));
  }

  /** Per-frame subtle emissive pulse on the selected part. */
  updateHighlight(dt: number): void {
    this.pulse += dt * 3.2;
    // restore previous
    this.highlightMats.forEach((mat, idx) => {
      const part = this.parts.find((q) => q.index === idx);
      if (part && this.selected !== part) {
        part.mesh.material = mat.userData.__original;
        this.highlightMats.delete(idx);
      }
    });
    if (this.selected) {
      const part = this.selected;
      let mat = this.highlightMats.get(part.index);
      const orig = part.mesh.material as THREE.MeshStandardMaterial;
      if (!mat) {
        mat = (orig.clone() as THREE.MeshStandardMaterial);
        mat.userData.__original = orig;
        this.cb.onMaterialClone?.(part, mat);
        part.mesh.material = mat;
        this.highlightMats.set(part.index, mat);
      }
      const k = 0.16 + 0.13 * Math.sin(this.pulse);
      if (mat.emissive) {
        mat.emissive.setRGB(k, k * 0.58, k * 0.22);   // amber pulse, matches the v3 dyno UI
      }
    }
  }

  isSoloed(part: AuditedPart): boolean { return this.soloed === part; }
  get soloPart(): AuditedPart | null { return this.soloed; }

  clearSolo(): void {
    this.soloed = null;
    this.rows.forEach((r) => r.row.classList.remove('soloed'));
  }
}
