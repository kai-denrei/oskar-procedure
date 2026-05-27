// main.js — bootstrap: DPI-correct canvas, RAF animation loop, grid wiring.
// M1: renders the organic quad grid with animated relaxation.

import { generateMesh, makeRelaxer } from './grid.js';
import { randomSeed } from './rng.js';
import { drawMesh, drawDualCells } from './render2d.js';
import { createControls, setSeedDisplay } from './controls.js';
import { buildHalfEdge } from './halfedge.js';
import { extractDualCells, hitTestVertex } from './dual.js';
import { createState } from './state.js';

const canvas = document.getElementById('grid');
const ctx = canvas.getContext('2d');

// --- DPI-correct sizing -------------------------------------------------
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
export function fitView(margin = 0.06) {
  const size = Math.min(cssW, cssH) * (1 - 2 * margin);
  const ox = (cssW - size) / 2;
  const oy = (cssH - size) / 2;
  return {
    toScreen: (p) => [ox + p[0] * size, oy + p[1] * size],
    // inverse of toScreen: CSS-pixel -> normalized [0,1]² (used for hit-testing)
    fromScreen: (px, py) => [(px - ox) / size, (py - oy) / size],
    scale: size,
  };
}

// --- animation state ----------------------------------------------------
// currentMesh: the live mesh being relaxed (vertices mutated in place).
// relaxer:     { step() } returned by makeRelaxer.
// frameCount:  how many relaxation steps have been applied this session.
// maxFrames:   n_iters (from controls).
// settled:     true once relaxation is done (still redraws on resize).
let currentMesh = null;
let relaxer = null;
let frameCount = 0;
let maxFrames = 100;
let settled = false;

// M2 connectivity / paint state — built once the grid settles, rebuilt on regen.
let halfEdge = null;
let dualCells = null;
let cornerState = null;

const CONVERGENCE_THRESHOLD = 1e-4; // stop early if displacement drops below this

// Demo paint: gated behind ?demo=1 (OFF by default — shipped default starts with
// NO cells painted). Paints a deterministic subset of interior cells so headless
// screenshots show filled rounded dual cells.
const DEMO = typeof location !== 'undefined' && location.search.includes('demo=1');

// Build half-edge + dual cells + a fresh corner state from the settled mesh.
function buildConnectivity() {
  halfEdge = buildHalfEdge(currentMesh);
  dualCells = extractDualCells(currentMesh, halfEdge);
  cornerState = createState(currentMesh.vertices.length);

  if (DEMO) {
    // every 3rd interior cell -> filled, so the screenshot shows painted cells
    for (let i = 0; i < dualCells.length; i += 3) {
      cornerState.set(dualCells[i].vertexIndex, true);
    }
  }
}

// --- render loop --------------------------------------------------------
let rafId = null;

function render() {
  ctx.clearRect(0, 0, cssW, cssH);
  ctx.fillStyle = '#14130f';
  ctx.fillRect(0, 0, cssW, cssH);

  if (currentMesh) {
    // advance relaxation one step per frame
    if (!settled) {
      const disp = relaxer.step();
      frameCount++;
      if (frameCount >= maxFrames || disp < CONVERGENCE_THRESHOLD) {
        settled = true;
        buildConnectivity(); // half-edge + dual cells + fresh state
      }
    }

    const view = fitView();
    // Painted dual-cell fills first, then thin grid lines on top so structure stays visible.
    if (settled && dualCells) drawDualCells(ctx, dualCells, cornerState, view);
    drawMesh(ctx, currentMesh, view);
  }

  rafId = requestAnimationFrame(render);
}

// --- grid generation ----------------------------------------------------
// Params come from controls; seed is managed here.
let currentSeed = randomSeed();
let currentParams = { r: 0.1, pullRate: 0.3, nIters: 100 };

function startGrid({ seed, r, pullRate, nIters } = {}) {
  currentSeed = seed ?? randomSeed();
  maxFrames = nIters ?? currentParams.nIters;

  currentMesh = generateMesh({ seed: currentSeed, r: r ?? currentParams.r });
  relaxer = makeRelaxer(currentMesh, {
    PULL_RATE: pullRate ?? currentParams.pullRate,
  });
  frameCount = 0;
  settled = false;
  // drop stale connectivity/paint state; rebuilt once the new grid settles
  halfEdge = null;
  dualCells = null;
  cornerState = null;
  setSeedDisplay(currentSeed);

  // DEMO: relax synchronously and settle immediately so headless screenshots
  // (which only get a handful of RAF frames under --virtual-time-budget) show
  // fully-relaxed, painted dual cells. No effect on the shipped default path.
  if (DEMO) {
    for (let i = 0; i < maxFrames; i++) relaxer.step();
    frameCount = maxFrames;
    settled = true;
    buildConnectivity();
  }
}

// --- controls -----------------------------------------------------------
const { getParams } = createControls((params) => {
  // Slider changed: re-generate with the same seed so user can compare pull-rate
  // / iter changes, but use a new seed for density (r) changes because the
  // point layout itself changes. Either way, re-start.
  currentParams = params;
  startGrid({ seed: currentSeed, ...params });
});

const regenerateBtn = document.getElementById('regenerate');
regenerateBtn.addEventListener('click', () => {
  currentParams = getParams();
  startGrid({ seed: randomSeed(), ...currentParams });
});

// --- resize handler -----------------------------------------------------
window.addEventListener('resize', () => {
  resize();
  // Don't restart the grid; just let the next render() pick up the new size.
  // If settled, the settled grid is redrawn at the new size automatically.
});

// --- paint interaction --------------------------------------------------
// pointerdown + drag toggles the dual cell under the cursor. Convert the CSS
// pixel to normalized space via the view's fromScreen, hit-test the dual cells,
// and toggle that primary vertex's filled value. Drag paints across cells; each
// distinct cell is toggled once per drag so passing over it doesn't flicker.
let painting = false;
let lastPaintedVertex = -1;

function pointerToNormalized(ev) {
  const rect = canvas.getBoundingClientRect();
  const px = ev.clientX - rect.left;
  const py = ev.clientY - rect.top;
  return fitView().fromScreen(px, py);
}

function paintAt(ev) {
  if (!settled || !dualCells) return;
  const pt = pointerToNormalized(ev);
  const vi = hitTestVertex(pt, dualCells);
  if (vi < 0 || vi === lastPaintedVertex) return; // outside any cell or same cell
  cornerState.toggle(vi);
  lastPaintedVertex = vi;
  // RAF loop redraws every frame, so no explicit repaint needed.
}

canvas.addEventListener('pointerdown', (ev) => {
  painting = true;
  lastPaintedVertex = -1;
  canvas.setPointerCapture?.(ev.pointerId);
  paintAt(ev);
});
canvas.addEventListener('pointermove', (ev) => {
  if (painting) paintAt(ev);
});
const endPaint = () => {
  painting = false;
  lastPaintedVertex = -1;
};
canvas.addEventListener('pointerup', endPaint);
canvas.addEventListener('pointercancel', endPaint);
canvas.addEventListener('pointerleave', endPaint);

// --- boot ---------------------------------------------------------------
resize();
// Kick off with a fresh random seed at startup.
currentParams = getParams();
startGrid({ seed: randomSeed(), ...currentParams });
requestAnimationFrame(render);
console.log('[oskar-procedure] M2 booted');
