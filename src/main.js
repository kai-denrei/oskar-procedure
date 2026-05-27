// main.js — bootstrap: DPI-correct canvas, RAF animation loop, grid wiring.
// M1: renders the organic quad grid with animated relaxation.

import { generateMesh, makeRelaxer } from './grid.js';
import { randomSeed } from './rng.js';
import { drawMesh } from './render2d.js';
import { createControls, setSeedDisplay } from './controls.js';

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

const CONVERGENCE_THRESHOLD = 1e-4; // stop early if displacement drops below this

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
      }
    }

    const view = fitView();
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
  setSeedDisplay(currentSeed);
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

// --- boot ---------------------------------------------------------------
resize();
// Kick off with a fresh random seed at startup.
currentParams = getParams();
startGrid({ seed: randomSeed(), ...currentParams });
requestAnimationFrame(render);
console.log('[oskar-procedure] M1 booted');
