// main.js — bootstrap: DPI-correct canvas, RAF animation loop, grid wiring.
// M1: renders the organic quad grid with animated relaxation.

import { generateMesh, makeRelaxer } from './grid.js?v=eb73a4b5';
import { randomSeed } from './rng.js?v=eb73a4b5';
import { drawMesh, drawDualCells } from './render2d.js?v=eb73a4b5';
import { createControls, setSeedDisplay } from './controls.js?v=eb73a4b5';
import { buildHalfEdge } from './halfedge.js?v=eb73a4b5';
import { extractDualCells, hitTestVertex } from './dual.js?v=eb73a4b5';
import { createState } from './state.js?v=eb73a4b5';
import { initTabs } from './tabs.js?v=eb73a4b5';
import { createHeights } from './structures/heights.js?v=eb73a4b5';
import { BIOMES, getBiome } from './structures/biomes.js?v=eb73a4b5';
import { generateDecorations } from './structures/decorations.js?v=eb73a4b5';
import { initView3d, drawView3d, markView3dDirty, getCamera, setOnZoomChange, setSceneExtras, setOnCameraChange } from './gl/view3d.js?v=eb73a4b5';
import { createTerrainControls } from './gl/terrain-controls.js?v=eb73a4b5';

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
// Fit the current mesh's bounding box into the canvas: centered, aspect-
// preserved, with `margin` (fraction of the shorter canvas side) of padding.
// Poisson points live in ≈[0,1]² so the box is ≈unit and behavior is unchanged;
// a hex patch is centered on the origin in world units, so this frames it too.
// `fromScreen` is the exact inverse, used by the paint hit-test for BOTH seeders.
//
// `currentBBox` is recomputed whenever a mesh is (re)generated. No pan/zoom —
// auto-fit only (the `view` object shape is the seam a future camera slots into).
let currentBBox = { minX: 0, minY: 0, maxX: 1, maxY: 1 };

function computeBBox(vertices) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of vertices) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  if (!Number.isFinite(minX)) return { minX: 0, minY: 0, maxX: 1, maxY: 1 };
  return { minX, minY, maxX, maxY };
}

export function fitView(margin = 0.06) {
  const b = currentBBox;
  const bw = Math.max(1e-9, b.maxX - b.minX);
  const bh = Math.max(1e-9, b.maxY - b.minY);

  // Available draw area after margin (margin is a fraction of the shorter side).
  const avail = Math.min(cssW, cssH) * (1 - 2 * margin);
  // Uniform scale that fits the box's longer dimension into `avail`.
  const scale = avail / Math.max(bw, bh);

  // Center the scaled box in the canvas.
  const drawW = bw * scale;
  const drawH = bh * scale;
  const ox = (cssW - drawW) / 2;
  const oy = (cssH - drawH) / 2;

  return {
    bounds: b,
    scale,
    toScreen: (p) => [ox + (p[0] - b.minX) * scale, oy + (p[1] - b.minY) * scale],
    // inverse of toScreen: CSS-pixel -> world coords (used for hit-testing)
    fromScreen: (px, py) => [(px - ox) / scale + b.minX, (py - oy) / scale + b.minY],
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

// M3D-1: shared per-primary-vertex height field for the 3D build-by-stacking
// view. Recreated whenever a mesh is (re)generated. The 3D tab is a TERRAIN
// PLAYGROUND: procedural terrain (generateTerrain) OWNS the height field — on
// settle/regen the field is filled from the current terrain params, then the
// user hand-edits it by drag-building. The Grid tab's paint still nudges the
// same field (painting a cell raises it ≥1), so paint + terrain stay coherent
// on one shared field; whichever acted last wins per cell.
let heights = null;

// Terrain params for the 3D playground. `seed` drives the procedural relief;
// `biome` picks which generator + color scheme shapes it; Randomize picks a
// new seed; Height/Roughness sliders regenerate at the same seed. orientation
// + zoom drive the fixed-iso camera (not the height field).
let terrainParams = { biome: 'dunes', seed: randomSeed(), amplitude: 4, roughness: 4, orientation: 0, zoom: 1 };

// Decorations cache for the active biome (rebuilt with the height field). The
// view3d geometry builder pulls these via setSceneExtras() so the cached
// rebuild path stays the single source of truth.
let decorations = [];

const CONVERGENCE_THRESHOLD = 1e-4; // stop early if displacement drops below this

// Demo paint: gated behind ?demo=1 (OFF by default — shipped default starts with
// NO cells painted). Paints a deterministic subset of interior cells so headless
// screenshots show filled rounded dual cells.
const DEMO = typeof location !== 'undefined' && location.search.includes('demo=1');

// URL params let headless screenshots boot a specific seeder/rings deterministically:
//   ?seeder=hex&rings=4   -> boot in Hexagon mode with 4 rings
// Parsed once at startup and merged into the initial params (Component 3/4).
function urlOverrides() {
  if (typeof location === 'undefined') return {};
  const q = new URLSearchParams(location.search);
  const out = {};
  const seeder = q.get('seeder');
  if (seeder === 'hex' || seeder === 'poisson') out.seeder = seeder;
  if (q.has('rings')) {
    const n = Math.round(Number(q.get('rings')));
    if (Number.isFinite(n) && n >= 2 && n <= 6) out.rings = n;
  }
  // ?biome=<id> deterministically boots the 3D tab in a given biome (so each
  // biome's screenshot can target it). Validated against the biome registry.
  const biome = q.get('biome');
  if (biome && BIOMES.some((b) => b.id === biome)) out.biome = biome;
  return out;
}

// Read the biome from the URL once at startup (used to seed terrainParams.biome
// before the controls panel is constructed).
function urlBiome() {
  if (typeof location === 'undefined') return null;
  const b = new URLSearchParams(location.search).get('biome');
  return b && BIOMES.some((x) => x.id === b) ? b : null;
}

// ?amp=<1..8> overrides the initial amplitude (used to verify max-height
// centering in headless screenshots). Returns null if unset/invalid.
function urlAmplitude() {
  if (typeof location === 'undefined') return null;
  const a = Math.round(Number(new URLSearchParams(location.search).get('amp')));
  return Number.isFinite(a) && a >= 1 && a <= 8 ? a : null;
}

// Build half-edge + dual cells + a fresh corner state from the settled mesh.
function buildConnectivity() {
  halfEdge = buildHalfEdge(currentMesh);
  dualCells = extractDualCells(currentMesh, halfEdge);
  cornerState = createState(currentMesh.vertices.length);
  heights = createHeights(currentMesh.vertices.length);

  // The 3D tab is a terrain playground: fill the height field from procedural
  // terrain at the current params. This is the source of relief; the user then
  // hand-edits by drag-building in 3D.
  applyTerrain();

  if (DEMO) {
    // every 3rd interior cell -> filled, so the Grid screenshot shows painted cells
    for (let i = 0; i < dualCells.length; i += 3) {
      cornerState.set(dualCells[i].vertexIndex, true);
    }
  }

  // Seed heights from paint: a painted dual cell shows as at least a 1-floor
  // block in 3D. Preserve any larger value already set (e.g. the terrain).
  seedHeightsFromPaint();
  markView3dDirty();
}

// Fill the shared height field from the active biome's generator at the current
// params, then recompute the biome's decorations. Replaces the field's contents
// (terrain owns it). No-op if no mesh/heights yet. Marks the 3D view dirty so
// the geometry rebuild picks up the new heights + decorations, then reframes
// the camera (heights can scale very differently across biomes).
function applyTerrain() {
  if (!heights || !currentMesh || !currentMesh.vertices) return;
  const biome = getBiome(terrainParams.biome);
  const hs = biome.generate(currentMesh, {
    seed: terrainParams.seed,
    amplitude: terrainParams.amplitude,
    roughness: terrainParams.roughness,
  });
  // Replace the whole field (set() clamps to non-negative ints).
  for (let i = 0; i < hs.length; i++) heights.set(i, hs[i]);
  // Recompute decorations for the new heights / biome (deterministic per seed).
  decorations = generateDecorations({
    biome: terrainParams.biome,
    mesh: currentMesh,
    heights,
    seed: terrainParams.seed,
    floorH: 0.06,
  });
  markView3dDirty();
  reframeCamera();
}

// Re-frame the iso camera on the current scene bounds. We derive the bounds
// from the mesh planar extent + the current max height so framing accounts for
// tall terrain even before the next geometry rebuild runs.
function reframeCamera() {
  const cam = getCamera();
  if (!cam || !currentMesh || !currentMesh.vertices || !currentMesh.vertices.length) return;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of currentMesh.vertices) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  if (!Number.isFinite(minX)) return;
  const maxZ = (heights ? heights.max() : 0) * 0.06;
  cam.reframe({ min: [minX, minY, 0], max: [maxX, maxY, Math.max(maxZ, 0.06)] });
}

// For each painted dual cell, ensure heights.get(vertexIndex) >= 1. Idempotent.
function seedHeightsFromPaint() {
  if (!heights || !dualCells || !cornerState) return;
  for (const cell of dualCells) {
    if (cornerState.get(cell.vertexIndex)) {
      heights.set(cell.vertexIndex, Math.max(1, heights.get(cell.vertexIndex)));
    }
  }
}

// --- render loop --------------------------------------------------------
let rafId = null;

// Is the 3D tab the active/visible view? (#view-3d loses its `hidden` attr when
// selected — see tabs.js.) Cheap DOM read; the mesh itself is never regenerated
// on tab switch, so both tabs reflect the one shared currentMesh + paint state.
const view3d = document.getElementById('view-3d');
function is3dActive() {
  return view3d && !view3d.hasAttribute('hidden');
}

function render() {
  // Advance relaxation one step per frame regardless of which tab is showing,
  // so the shared mesh settles + builds connectivity even while viewed in 3D.
  if (currentMesh && !settled) {
    const disp = relaxer.step();
    frameCount++;
    if (frameCount >= maxFrames || disp < CONVERGENCE_THRESHOLD) {
      settled = true;
      buildConnectivity(); // half-edge + dual cells + fresh state
    }
  }

  if (is3dActive()) {
    // 3D tab: render the shared mesh + heights as a true-3D WebGL scene
    // (floor + extruded columns). Skip the flat 2D grid this frame.
    drawView3d({ mesh: currentMesh, heights, dualCells });
  } else {
    // Grid tab (default): flat 2D draw, exactly as before.
    ctx.clearRect(0, 0, cssW, cssH);
    ctx.fillStyle = '#14130f';
    ctx.fillRect(0, 0, cssW, cssH);

    if (currentMesh) {
      const view = fitView();
      // Painted dual-cell fills first, then thin grid lines on top so structure stays visible.
      if (settled && dualCells) drawDualCells(ctx, dualCells, cornerState, view);
      drawMesh(ctx, currentMesh, view);
    }
  }

  rafId = requestAnimationFrame(render);
}

// --- grid generation ----------------------------------------------------
// Params come from controls; seed is managed here.
let currentSeed = randomSeed();
let currentParams = { seeder: 'poisson', r: 0.1, rings: 4, pullRate: 0.3, nIters: 100 };

function startGrid({ seed, seeder, r, rings, pullRate, nIters } = {}) {
  currentSeed = seed ?? randomSeed();
  maxFrames = nIters ?? currentParams.nIters;

  const effectiveSeeder = seeder ?? currentParams.seeder;
  currentMesh = generateMesh({
    seed: currentSeed,
    seeder: effectiveSeeder,
    r: r ?? currentParams.r,
    rings: rings ?? currentParams.rings,
  });
  // Recompute the fit-to-bounds box for the new mesh (Poisson ≈[0,1]², hex centered).
  currentBBox = computeBBox(currentMesh.vertices);
  // Hex patches must keep a PERFECT hexagon outline: pin the boundary so
  // relaxation only squares the interior (the boundary is also H2b's stitch seam).
  // Poisson keeps its natural (unpinned) ragged edge — unchanged behavior.
  relaxer = makeRelaxer(currentMesh, {
    PULL_RATE: pullRate ?? currentParams.pullRate,
    pinned: effectiveSeeder === 'hex' ? currentMesh.boundary : null,
  });
  frameCount = 0;
  settled = false;
  // drop stale connectivity/paint/height state; rebuilt once the new grid settles
  halfEdge = null;
  dualCells = null;
  cornerState = null;
  heights = null;
  markView3dDirty();
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
const initialOverrides = urlOverrides();
const { getParams } = createControls((params) => {
  // Selector / slider changed: re-generate with the same seed so the user can
  // compare seeder + param changes against the same dissolve sequence. Either
  // way, re-start. (Regenerate button below picks a fresh seed instead.)
  currentParams = params;
  startGrid({ seed: currentSeed, ...params });
}, initialOverrides);

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
  const nowFilled = cornerState.toggle(vi);
  lastPaintedVertex = vi;
  // Keep the 3D height field consistent with paint: painting a cell raises it
  // to at least 1 floor; un-painting clears its column back to ground.
  if (heights) {
    if (nowFilled) heights.set(vi, Math.max(1, heights.get(vi)));
    else heights.set(vi, 0);
    markView3dDirty();
  }
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

// --- tabs ---------------------------------------------------------------
initTabs();

// Seed the active biome from the URL (?biome=<id>) so each biome's screenshot
// can target it deterministically; defaults to 'dunes' (today's look).
const bootBiome = urlBiome();
if (bootBiome) terrainParams.biome = bootBiome;
const bootAmp = urlAmplitude();
if (bootAmp != null) terrainParams.amplitude = bootAmp;

// --- 3D WebGL view ------------------------------------------------------
// Owns the #gl-canvas + fixed-iso ortho camera + drag-to-build. The mesh +
// heights are shared (never regenerated on tab switch); the RAF loop feeds them.
initView3d();

// Feed the geometry builder the active biome's color scheme + decorations so
// the cached rebuild path (in view3d) colors + decorates the scene.
setSceneExtras(() => ({
  biome: getBiome(terrainParams.biome),
  decorations,
  amplitude: terrainParams.amplitude,
}));

// A camera-target change (WASD / two-finger pan) just needs the next RAF to
// redraw; the loop already does that, so this is a no-op hook for now (kept so
// view3d has somewhere to notify without coupling to the loop).
setOnCameraChange(() => {});

// Apply the initial camera zoom/orientation (the camera frames the mesh on its
// first real geometry; these set the playground defaults on top of that).
const _cam = getCamera();
if (_cam) {
  _cam.setZoom(terrainParams.zoom);
  _cam.setOrientation(terrainParams.orientation);
}

// --- 3D terrain controls panel ------------------------------------------
const terrainUI = createTerrainControls(
  {
    biomes: BIOMES.map((b) => ({ id: b.id, label: b.label })),
    // Biome/Height/Roughness regenerate terrain; zoom/orientation drive camera.
    onChange: (p) => {
      const orientationChanged = p.orientation !== terrainParams.orientation;
      terrainParams = { ...terrainParams, ...p };
      const cam = getCamera();
      if (cam) {
        cam.setZoom(terrainParams.zoom);
        cam.setOrientation(terrainParams.orientation);
      }
      applyTerrain(); // regenerate relief + decorations + reframe
      // Re-frame on orientation change too (the iso-projected bbox depends on it).
      if (orientationChanged) reframeCamera();
    },
    onRandomize: () => {
      terrainParams.seed = randomSeed();
      applyTerrain();
    },
    onFlatten: () => {
      if (heights) {
        heights.clear();
        decorations = [];
        markView3dDirty();
        reframeCamera();
      }
    },
  },
  {
    biome: terrainParams.biome,
    zoom: terrainParams.zoom,
    orientation: terrainParams.orientation,
    amplitude: terrainParams.amplitude,
    roughness: terrainParams.roughness,
  }
);

// Wheel zoom in the 3D view → reflect the new zoom level into the panel slider.
setOnZoomChange((z) => {
  terrainParams.zoom = z;
  terrainUI.setZoom(z);
});

// --- boot ---------------------------------------------------------------
resize();
// Kick off with a fresh random seed at startup.
currentParams = getParams();
startGrid({ seed: randomSeed(), ...currentParams });
requestAnimationFrame(render);
console.log('[oskar-procedure] M2 booted');
