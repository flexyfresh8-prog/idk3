// Simulation parameter panel: builds sliders from a ParamMeta list (per-driver
// ranges), applies every change instantly to the running simulation (no page
// reload), validates ranges and cross-field constraints (hfCutoff >= lfCutoff
// + 40 Hz). Rebuilt live when the driver profile changes (a 2-inch mini has
// different excursion/resonance ranges than the 10-inch).
import { type SimParams, type ParamMeta } from '../core/types';
import { paintRange } from './paintRange';

export class ParamsPanel {
  private inputs = new Map<keyof SimParams, HTMLInputElement>();
  private bubbles = new Map<keyof SimParams, HTMLSpanElement>();
  private meta: ParamMeta[] = [];
  private defaults!: Partial<SimParams>;
  onChange: (key: keyof SimParams, value: number) => void = () => {};
  onReset: () => void = () => {};

  constructor(private container: HTMLElement, private params: SimParams, meta: ParamMeta[], defaults: Partial<SimParams>) {
    this.build(meta, defaults);
  }

  /** Swap the slider set + defaults for a new driver profile and repaint. */
  rebuild(meta: ParamMeta[], defaults: Partial<SimParams>): void {
    this.build(meta, defaults);
  }

  private build(meta: ParamMeta[], defaults: Partial<SimParams>): void {
    this.meta = meta;
    this.defaults = defaults;
    this.container.innerHTML = '';
    this.inputs.clear();
    this.bubbles.clear();
    for (const m of meta) this.addSlider(m);
    const resetBtn = document.createElement('button');
    resetBtn.className = 'btn ghost full-width';
    resetBtn.id = 'reset-sim';
    resetBtn.textContent = 'Reset simulation to defaults';
    resetBtn.addEventListener('click', () => this.onReset());
    this.container.appendChild(resetBtn);
  }

  private addSlider(meta: ParamMeta): void {
    const row = document.createElement('div');
    row.className = 'param';
    const head = document.createElement('div');
    head.className = 'param-head';
    const label = document.createElement('label');
    label.htmlFor = `param-${meta.key}`;
    label.textContent = meta.label;
    const badge = document.createElement('span');
    badge.className = `badge ${meta.kind}`;
    badge.textContent = meta.kind === 'sim' ? 'sim' : 'model';
    badge.title = meta.kind === 'sim'
      ? 'User-defined simulation parameter (not a measurement from the model)'
      : 'Value derived from the supplied model geometry';
    head.appendChild(label);
    head.appendChild(badge);
    if (meta.hint) {
      const hint = document.createElement('p');
      hint.className = 'param-hint';
      hint.textContent = meta.hint;
      row.appendChild(head);
      row.appendChild(hint);
    } else {
      row.appendChild(head);
    }

    const valRow = document.createElement('div');
    valRow.className = 'param-valrow';
    const input = document.createElement('input');
    input.type = 'range';
    input.id = `param-${meta.key}`;
    input.min = String(meta.min);
    input.max = String(meta.max);
    input.step = String(meta.step);
    input.value = String(this.params[meta.key]);
    const bubble = document.createElement('span');
    bubble.className = 'param-value';
    valRow.appendChild(input);
    valRow.appendChild(bubble);
    row.appendChild(valRow);
    this.container.appendChild(row);

    this.inputs.set(meta.key, input);
    this.bubbles.set(meta.key, bubble);
    paintRange(input);
    input.addEventListener('input', () => {
      let v = parseFloat(input.value);
      if (isNaN(v)) return;
      // cross constraint: bass band upper limit stays above the drive cutoff
      if (meta.key === 'hfCutoffHz' && v < this.params.lfCutoffHz + 40) v = this.params.lfCutoffHz + 40;
      if (meta.key === 'lfCutoffHz' && v > this.params.hfCutoffHz - 40) v = this.params.hfCutoffHz - 40;
      input.value = String(v);
      this.params[meta.key] = v;
      this.syncBubble(meta.key);
      this.onChange(meta.key, v);
    });
    this.syncBubble(meta.key);
  }

  private syncBubble(key: keyof SimParams): void {
    const meta = this.meta.find((m) => m.key === key);
    if (!meta) return;
    const bubble = this.bubbles.get(key);
    if (!bubble) return;
    bubble.textContent = `${round(this.params[key], meta.step)}${meta.unit ? (meta.unit === '×' ? '×' : ' ' + meta.unit) : ''}`;
  }

  syncAll(): void {
    for (const meta of this.meta) {
      const input = this.inputs.get(meta.key);
      if (!input) continue;
      input.value = String(this.params[meta.key]);
      paintRange(input);
      this.syncBubble(meta.key);
    }
  }

  resetToDefaults(): void {
    Object.assign(this.params, DEFAULTS_BASE, this.defaults);
    // clamp into the active ranges (a default from another driver may sit
    // outside the current slider range)
    for (const meta of this.meta) {
      const v = this.params[meta.key];
      this.params[meta.key] = Math.min(meta.max, Math.max(meta.min, v));
    }
    this.syncAll();
  }
}

// the v3 baseline every profile overrides from
const DEFAULTS_BASE: Partial<SimParams> = {
  maxExcursionMM: 10,
  resonanceHz: 32,
  coneMass: 1.0,
  boxLoad: 0.35,
  bassSensitivity: 1.0,
  lfCutoffHz: 80,
  hfCutoffHz: 200,
  surroundFlexibility: 0.6,
  surroundStrength: 0.8,
  coilFollow: 1.0,
  audioGain: 1.0,
  animationIntensity: 1.0
};

function round(v: number, step: number): number {
  const dec = Math.max(0, (String(step).split('.')[1] ?? '').length);
  return parseFloat(v.toFixed(dec));
}
