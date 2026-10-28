// Paints the filled-track state of a range input via the --val CSS custom
// property (0..100%). Used by the transport sliders and the params panel.
export function paintRange(el: HTMLInputElement): void {
  const min = el.min === '' ? 0 : parseFloat(el.min);
  const max = el.max === '' ? 100 : parseFloat(el.max);
  const v = parseFloat(el.value);
  if (!isFinite(v) || !isFinite(min) || !isFinite(max) || max <= min) return;
  const pct = Math.min(100, Math.max(0, ((v - min) / (max - min)) * 100));
  el.style.setProperty('--val', `${pct}%`);
}
