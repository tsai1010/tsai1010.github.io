// routing-composer/src/core/graphLayout.js
// -------------------------------------------------------------
// Minimal deterministic layout for imported legacy chains.
// -------------------------------------------------------------

export function linearLayout(count, opts = {}) {
  const startX = opts.startX ?? 120;
  const startY = opts.startY ?? 180;
  const dx = opts.dx ?? 190;
  return Array.from({ length: count }, (_, i) => ({
    x: startX + i * dx,
    y: startY + (i % 2) * 18,
  }));
}

export function defaultNodePosition(kind, idx = 0) {
  const presets = {
    ks_source: { x: 120, y: 180 },
    source: { x: 120, y: 290 },
    filter: { x: 330, y: 180 },
    delay: { x: 540, y: 145 },
    gain: { x: 540, y: 255 },
    analyzer: { x: 750, y: 145 },
    convolver_ir: { x: 540, y: 365 },
    reverb: { x: 540, y: 365 },
    output: { x: 820, y: 200 },
  };
  const p = presets[kind] || { x: 200 + idx * 160, y: 200 };
  return { ...p };
}
