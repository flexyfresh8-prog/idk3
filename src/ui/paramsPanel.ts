// Simulation parameter panel: builds sliders from PARAM_META, applies every
// change instantly to the running simulation (no page reload), validates
// ranges and cross-field constraints (hfCutoff >= lfCutoff + 40 Hz).
import { PARAM_META, DEFAULT_PARAMS, type SimParams, type ParamMeta } from '../core/types';
import { paintRange } from './paintRange';

export class ParamsPanel {
  private inputs = new Map<keyof SimParams, HTMLInputElement>();
  private bubbles = new Map<keyof SimParams, HTMLSpanElement>();
  onChange: (key: keyof SimParams, value: number) => void = () => {};
  onReset: () => void = () => {};

  constructor(private container: HTMLElement, private params: SimParams) {
    this.build();
  }

  private build(): void {
    this.container.innerHTML = '';
    for (const meta of PARAM_META) this.addSlider(meta);
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
    const meta = PARAM_META.find((m) => m.key === key)!;
    const bubble = this.bubbles.get(key)!;
    const v = this.params[key];
    bubble.textContent = `${meta.unit === '×' ? '' : ''}${round(v, meta.step)}${meta.unit ? (meta.unit === '×' ? '×' : ' ' + meta.unit) : ''}`;
  }

  syncAll(): void {
    for (const meta of PARAM_META) {
      const input = this.inputs.get(meta.key)!;
      input.value = String(this.params[meta.key]);
      paintRange(input);
      this.syncBubble(meta.key);
    }
  }

  resetToDefaults(): void {
    Object.assign(this.params, DEFAULT_PARAMS);
    this.syncAll();
  }
}

function round(v: number, step: number): number {
  const dec = Math.max(0, (String(step).split('.')[1] ?? '').length);
  return parseFloat(v.toFixed(dec));
}
