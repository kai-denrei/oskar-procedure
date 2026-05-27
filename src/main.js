// main.js — bootstrap: DPI-correct canvas, RAF loop, control wiring.
// M0: blank canvas renders at correct DPI; Regenerate logs a click.
// M1 will replace the placeholder render with the grid kernel.

const canvas = document.getElementById('grid');
const ctx = canvas.getContext('2d');

// --- DPI-correct sizing -------------------------------------------------
// CSS size drives layout; the backing store is scaled by devicePixelRatio so
// strokes stay crisp. We keep the ctx transform at dpr scale, so all drawing
// code works in CSS pixels.
let cssW = 0, cssH = 0, dpr = 1;

function resize() {
  dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  cssW = Math.max(1, Math.round(rect.width));
  cssH = Math.max(1, Math.round(rect.height));
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // 1 unit = 1 CSS px
}

// --- view transform -----------------------------------------------------
// Generation lives in normalized [0,1] space. fitView maps that square into
// the canvas centered, with margin, preserving aspect. One transform, applied
// at draw time only (keeps relaxation params meaningful — see docs/04).
export function fitView(margin = 0.06) {
  const size = Math.min(cssW, cssH) * (1 - 2 * margin);
  const ox = (cssW - size) / 2;
  const oy = (cssH - size) / 2;
  return {
    toScreen: (p) => [ox + p[0] * size, oy + p[1] * size],
    scale: size,
  };
}

// --- render loop --------------------------------------------------------
function render() {
  ctx.clearRect(0, 0, cssW, cssH);
  ctx.fillStyle = '#14130f';
  ctx.fillRect(0, 0, cssW, cssH);

  // M0 placeholder: a thin inset frame + centered label prove the canvas
  // fills its container and is DPI-sharp. Replaced by the grid in M1.
  const view = fitView();
  const a = view.toScreen([0, 0]);
  const b = view.toScreen([1, 1]);
  ctx.strokeStyle = 'rgba(232,226,212,0.10)';
  ctx.lineWidth = 1;
  ctx.strokeRect(a[0] + 0.5, a[1] + 0.5, b[0] - a[0], b[1] - a[1]);

  ctx.fillStyle = 'rgba(138,130,112,0.85)';
  ctx.font = '13px ui-monospace, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('M0 · canvas ready — grid kernel arrives in M1', cssW / 2, cssH / 2);

  requestAnimationFrame(render);
}

// --- controls -----------------------------------------------------------
const regenerateBtn = document.getElementById('regenerate');
regenerateBtn.addEventListener('click', () => {
  // M0: no-op beyond logging. M1 wires this to a fresh grid generation.
  console.log('[oskar-procedure] Regenerate clicked');
});

// --- boot ---------------------------------------------------------------
window.addEventListener('resize', resize);
resize();
requestAnimationFrame(render);
console.log('[oskar-procedure] M0 scaffold booted');
