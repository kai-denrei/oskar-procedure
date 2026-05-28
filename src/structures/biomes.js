// biomes.js — six terrain biomes for the 3D playground. Pure logic, NO DOM,
// NO GL — Node-testable (determinism, bounds, ints ≥ 0).
//
// A biome is a pair: a `generate(mesh, params)` that returns an integer height
// per primary vertex, and a `colorize(ctx)` that returns an [r,g,b] for a
// given vertex / world-space context. Decorations are handled separately
// (see decorations.js) so a renderer can choose to skip them.
//
//   BIOMES                    array of {id,label,generate,colorize}
//   getBiome(id)              lookup by id, falls back to 'dunes'
//
// All generators are deterministic per seed and honor the {amplitude, roughness}
// sliders. Heights are non-negative ints. The 'dunes' biome reproduces the
// original generateTerrain() look so it stays the default.

import { valueNoise2D } from './terrain.js?v=f9d2abf8';

// Deterministic 32-bit hash → [0,1). Same primitive as terrain.js so all
// biomes hash decorrelate against the same seed space.
function hash2(ix, iy, seed) {
  let h = (ix | 0) * 374761393 + (iy | 0) * 668265263 + (seed | 0) * 2246822519;
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 1274126177) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967296;
}

// Compute the planar bbox + center of a mesh's vertices. Used to derive a
// canonical "distance from center" for radial biomes (quarry).
function meshExtents(mesh) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const v of mesh.vertices) {
    if (v[0] < minX) minX = v[0];
    if (v[0] > maxX) maxX = v[0];
    if (v[1] < minY) minY = v[1];
    if (v[1] > maxY) maxY = v[1];
  }
  if (!Number.isFinite(minX)) return { cx: 0, cy: 0, radius: 1 };
  return {
    cx: (minX + maxX) / 2,
    cy: (minY + maxY) / 2,
    radius: Math.max(1e-6, 0.5 * Math.hypot(maxX - minX, maxY - minY)),
  };
}

function clampInt(h, max) {
  let v = Math.round(h);
  if (!Number.isFinite(v) || v < 0) v = 0;
  if (v > max) v = max;
  return v;
}

// ── Dunes (default — original terrain.js look) ──────────────────────────────
// Directional sinusoidal waves with a perpendicular cross-modulation: rolling
// sand dunes that read as a coherent direction (not blobby). The wave axis
// rotates with the seed so different randomizations look distinct.
const DUNES_MAX = 3;
function generateDunes(mesh, opts = {}) {
  const seed = (opts.seed | 0) || 0;
  const amplitude = Math.min(DUNES_MAX, Math.max(0, Math.round(opts.amplitude != null ? opts.amplitude : 4)));
  const roughness = opts.roughness != null ? opts.roughness : 1;
  if (!mesh || !mesh.vertices || !mesh.vertices.length) return [];

  // Seed-derived direction so each randomization has its own dune axis.
  const ang = hash2(0x71B5, seed, seed) * Math.PI * 2;
  const dx = Math.cos(ang), dy = Math.sin(ang);
  // Perpendicular axis for the cross-modulation.
  const px = -dy, py = dx;

  // Spatial frequency of the primary wave: scaled by roughness so the slider
  // visibly tightens / loosens the dunes. Cross-mod is slower (broader bands).
  const k1 = roughness * 0.75;
  const k2 = roughness * 0.31;

  const out = new Array(mesh.vertices.length);
  for (let i = 0; i < mesh.vertices.length; i++) {
    const v = mesh.vertices[i];
    const along = v[0] * dx + v[1] * dy;
    const cross = v[0] * px + v[1] * py;
    // Primary sinusoid along the wave axis, modulated by a perpendicular wave
    // (sin·cos product folds them into a single dune-field height in [0,1]).
    const s = 0.5 + 0.5 * Math.sin(along * k1 + cross * 0.4);
    const m = 0.5 + 0.5 * Math.cos(cross * k2);
    // A touch of value noise breaks dead repetition without dissolving the form.
    const n = valueNoise2D(v[0] * roughness * 0.5 + 7.1, v[1] * roughness * 0.5 + 3.7, seed);
    const h01 = 0.55 * s + 0.30 * m + 0.15 * n;
    out[i] = clampInt(h01 * amplitude, amplitude);
  }
  return out;
}

// Warm amber dunes; troughs darken slightly so the form reads.
function colorizeDunes(ctx) {
  const h = ctx.height, amp = Math.max(1, ctx.amplitude);
  const t = h / amp; // 0 (trough) → 1 (crest)
  // Crest: warm sand; trough: deeper amber-brown.
  const r = 0.78 + 0.12 * t;
  const g = 0.62 + 0.12 * t;
  const b = 0.34 + 0.08 * t;
  return [r, g, b];
}

// ── Mountains — ridged multifractal noise (sharp ridges) ────────────────────
// Sum of (1 - |fbm_i|)^2 * amp/2^i over a few octaves. Squaring (1-|n|)
// produces sharp ridge crests; doubling the frequency per octave gives the
// classic multifractal jaggedness. We square the final 0..1 height to push
// most mass toward the base (most cells low, occasional peaks tall).
const MOUNTAINS_MAX = 7;
function generateMountains(mesh, opts = {}) {
  const seed = (opts.seed | 0) || 0;
  const amplitude = Math.min(MOUNTAINS_MAX, Math.max(0, Math.round(opts.amplitude != null ? opts.amplitude : 4)));
  const roughness = opts.roughness != null ? opts.roughness : 1;
  if (!mesh || !mesh.vertices || !mesh.vertices.length) return [];

  const OCTAVES = 4;
  // Per-octave seeds so each layer decorrelates from the others.
  const octSeeds = [seed, seed ^ 0x9E37, seed ^ 0x6BAD, seed ^ 0xC2B2];

  const out = new Array(mesh.vertices.length);
  for (let i = 0; i < mesh.vertices.length; i++) {
    const v = mesh.vertices[i];
    let sum = 0;
    let norm = 0;
    let freq = roughness * 0.9;
    let amp = 1;
    for (let o = 0; o < OCTAVES; o++) {
      const n = valueNoise2D(v[0] * freq, v[1] * freq, octSeeds[o]); // [0,1)
      const ridged = 1 - Math.abs(2 * n - 1); // tent → [0,1]
      sum += amp * ridged * ridged;            // sharp crests
      norm += amp;
      freq *= 2;
      amp *= 0.5;
    }
    let h01 = sum / norm; // [0,1]
    // Push mass down so peaks are rare and dramatic.
    h01 = h01 * h01 * h01;
    out[i] = clampInt(h01 * amplitude, amplitude);
  }
  return out;
}

// Height-banded greys: dark grey base → mid grey → near-white peaks.
function colorizeMountains(ctx) {
  const h = ctx.height, amp = Math.max(1, ctx.amplitude);
  const t = h / amp; // 0..1
  // Three-stop ramp: dark stone → mid grey → snow.
  if (t < 0.5) {
    const k = t / 0.5;
    const c = 0.22 + 0.30 * k; // 0.22 → 0.52
    return [c, c, c * 1.02];
  } else {
    const k = (t - 0.5) / 0.5;
    const c = 0.52 + 0.42 * k; // 0.52 → 0.94
    return [c, c, c];
  }
}

// ── Forest — medium-frequency rolling value noise ───────────────────────────
const FOREST_MAX = 3;
function generateForest(mesh, opts = {}) {
  const seed = (opts.seed | 0) || 0;
  const amplitude = Math.min(FOREST_MAX, Math.max(0, Math.round(opts.amplitude != null ? opts.amplitude : 4)));
  const roughness = opts.roughness != null ? opts.roughness : 1;
  if (!mesh || !mesh.vertices || !mesh.vertices.length) return [];

  // Two octaves of value noise: a base roll + a finer detail layer.
  const out = new Array(mesh.vertices.length);
  for (let i = 0; i < mesh.vertices.length; i++) {
    const v = mesh.vertices[i];
    const n1 = valueNoise2D(v[0] * roughness * 0.7, v[1] * roughness * 0.7, seed);
    const n2 = valueNoise2D(v[0] * roughness * 1.6 + 11.1, v[1] * roughness * 1.6 - 3.3, seed ^ 0x5A5A);
    const h01 = 0.65 * n1 + 0.35 * n2; // [0,1)
    // Forest reads best with most cells near 30–60% height; ease toward mid.
    const t = 0.15 + 0.7 * h01;
    out[i] = clampInt(t * amplitude, amplitude);
  }
  return out;
}

// Deep saturated green; slightly darker in shaded valleys, slightly brighter
// near the upper canopy strata.
function colorizeForest(ctx) {
  const h = ctx.height, amp = Math.max(1, ctx.amplitude);
  const t = h / amp;
  const r = 0.10 + 0.06 * t;
  const g = 0.32 + 0.18 * t;
  const b = 0.14 + 0.06 * t;
  return [r, g, b];
}

// ── Meadows — heavily damped: heights capped at 1–2 floors ──────────────────
const MEADOWS_MAX = 2;
function generateMeadows(mesh, opts = {}) {
  const seed = (opts.seed | 0) || 0;
  const amplitude = Math.min(MEADOWS_MAX, Math.max(0, Math.round(opts.amplitude != null ? opts.amplitude : 4)));
  const roughness = opts.roughness != null ? opts.roughness : 1;
  if (!mesh || !mesh.vertices || !mesh.vertices.length) return [];

  // Meadows damp HARD: regardless of slider amplitude, heights cap at 2 floors
  // (most cells 0–1). The roughness still varies the noise frequency so the
  // slider visibly reshuffles the gentle hillocks.
  const cap = Math.min(2, amplitude);
  const out = new Array(mesh.vertices.length);
  for (let i = 0; i < mesh.vertices.length; i++) {
    const v = mesh.vertices[i];
    const n = valueNoise2D(v[0] * roughness * 0.55, v[1] * roughness * 0.55, seed);
    // Soft step: most cells flat (n < 0.6 → 0), some bumped (n > 0.6 → 1),
    // rare tall (n > 0.88 → 2 if amplitude allows).
    let h;
    if (n < 0.6) h = 0;
    else if (n < 0.88) h = Math.min(1, cap);
    else h = cap;
    out[i] = h;
  }
  return out;
}

// Bright spring-green. Slight elevation tint just to add depth.
function colorizeMeadows(ctx) {
  const h = ctx.height;
  // Subtle variance by height: ground green, raised slightly cooler.
  if (h <= 0) return [0.42, 0.66, 0.30];
  return [0.36, 0.62, 0.26];
}

// ── Swamps — nearly flat (mostly 0, occasional 1) ───────────────────────────
const SWAMPS_MAX = 1;
function generateSwamps(mesh, opts = {}) {
  const seed = (opts.seed | 0) || 0;
  const amplitude = Math.min(SWAMPS_MAX, Math.max(0, Math.round(opts.amplitude != null ? opts.amplitude : 4)));
  const roughness = opts.roughness != null ? opts.roughness : 1;
  if (!mesh || !mesh.vertices || !mesh.vertices.length) return [];

  // Most ground at 0; ~10% rises to 1 (mounds in the marsh). Amplitude scales
  // how high the rare hummocks can go (still rare — n > 0.95).
  const out = new Array(mesh.vertices.length);
  const hummockMax = Math.min(2, amplitude);
  for (let i = 0; i < mesh.vertices.length; i++) {
    const v = mesh.vertices[i];
    const n = valueNoise2D(v[0] * roughness * 0.7, v[1] * roughness * 0.7, seed);
    let h = 0;
    if (n > 0.88) h = Math.min(1, hummockMax);
    if (n > 0.97) h = hummockMax;
    out[i] = h;
  }
  return out;
}

// Muddy olive / brown-green ground.
function colorizeSwamps(ctx) {
  const h = ctx.height;
  if (h <= 0) return [0.28, 0.30, 0.18];
  return [0.34, 0.34, 0.20];
}

// ── Quarry — terraced concave pit dug into a plateau ────────────────────────
// Baseline = amplitude floors (high plateau). A radial "step" function digs
// a stepped pit centered on the mesh center. All heights stay ≥ 0 (the pit
// floor is at 0, the rim sits at `amplitude`).
const QUARRY_MAX = 3;
function generateQuarry(mesh, opts = {}) {
  const seed = (opts.seed | 0) || 0;
  const amplitude = Math.min(QUARRY_MAX, Math.max(0, Math.round(opts.amplitude != null ? opts.amplitude : 4)));
  const roughness = opts.roughness != null ? opts.roughness : 1;
  if (!mesh || !mesh.vertices || !mesh.vertices.length) return [];

  const { cx, cy, radius } = meshExtents(mesh);
  // Number of terrace rings — at least 2, at most amplitude (one ring per floor).
  const rings = Math.max(2, Math.min(amplitude, 6));
  // Step width: how far between terrace edges, fraction of patch radius.
  // `roughness` modulates ring width — higher roughness = tighter rings.
  const stepRadius = radius / (rings + 0.5);
  // Per-vertex noise jitters the rim a touch so the pit isn't a perfect circle.
  const jitterAmp = stepRadius * 0.18;

  const out = new Array(mesh.vertices.length);
  for (let i = 0; i < mesh.vertices.length; i++) {
    const v = mesh.vertices[i];
    // Distance from the patch center, with a small noise jitter so terraces
    // don't read as a perfect circle. Roughness controls jitter spatial scale.
    const jitter = (valueNoise2D(v[0] * roughness * 0.9, v[1] * roughness * 0.9, seed) - 0.5) * 2 * jitterAmp;
    const d = Math.hypot(v[0] - cx, v[1] - cy) + jitter;
    // Ring index from the center: 0 = pit bottom, growing outward.
    const ringIdx = Math.floor(d / stepRadius);
    // Map: at ring 0 (center) we're at the deepest point (h=0). Each ring out
    // raises the floor by one step until we reach the plateau at h=amplitude.
    let h = ringIdx; // steps up as we move away from center
    if (h > amplitude) h = amplitude;
    out[i] = clampInt(h, amplitude);
  }
  return out;
}

// Darker red / ochre / terracotta. Deeper (pit bottom) is darker.
function colorizeQuarry(ctx) {
  const h = ctx.height, amp = Math.max(1, ctx.amplitude);
  const t = h / amp; // 0 (pit bottom) → 1 (rim)
  // Pit bottom: very dark terracotta; rim: warmer ochre.
  const r = 0.32 + 0.36 * t;
  const g = 0.16 + 0.22 * t;
  const b = 0.10 + 0.12 * t;
  return [r, g, b];
}

// ── Registry + lookup ──────────────────────────────────────────────────────
export const BIOMES = [
  { id: 'dunes',     label: 'Dunes',     maxHeight: 3, generate: generateDunes,     colorize: colorizeDunes },
  { id: 'mountains', label: 'Mountains', maxHeight: 7, generate: generateMountains, colorize: colorizeMountains },
  { id: 'forest',    label: 'Forest',    maxHeight: 3, generate: generateForest,    colorize: colorizeForest },
  { id: 'meadows',   label: 'Meadows',   maxHeight: 2, generate: generateMeadows,   colorize: colorizeMeadows },
  { id: 'swamps',    label: 'Swamps',    maxHeight: 1, generate: generateSwamps,    colorize: colorizeSwamps },
  { id: 'quarry',    label: 'Quarry',    maxHeight: 3, generate: generateQuarry,    colorize: colorizeQuarry },
];

const BY_ID = new Map(BIOMES.map((b) => [b.id, b]));

export function getBiome(id) {
  return BY_ID.get(id) || BIOMES[0];
}
