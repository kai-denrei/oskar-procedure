// terrain.js — procedural height field for the 3D isometric playground.
// Pure logic, NO DOM, NO GL — Node-testable (determinism, bounds, ints ≥ 0).
//
// A small seeded value-noise (no deps): a hashed integer lattice with smooth
// (quintic) interpolation gives continuous, repeatable 2D noise over world
// positions. generateTerrain() samples it per primary vertex and maps the
// [0,1] noise to integer floor heights in [0, amplitude].
//
//   valueNoise2D(x, y, seed) -> number in [0,1)
//   generateTerrain(mesh, { seed, amplitude, roughness }) -> number[]
//     one integer height (≥0, ≤amplitude) per mesh vertex, deterministic per seed.

// 32-bit integer hash → a float in [0,1). Cheap, deterministic, decorrelates
// neighbouring lattice cells well enough for value noise. (xorshift-ish mix.)
function hash2(ix, iy, seed) {
  // Combine lattice coords + seed into one 32-bit word, then avalanche it.
  let h = (ix | 0) * 374761393 + (iy | 0) * 668265263 + (seed | 0) * 2246822519;
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 1274126177) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967296; // [0,1)
}

// Quintic smoothstep (Perlin's fade) — C2-continuous, kills directional banding.
function fade(t) {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

const lerp = (a, b, t) => a + (b - a) * t;

// Smooth value noise at (x,y) for a given integer seed. Returns [0,1).
// Bilinearly blends the four surrounding lattice hashes with a faded weight.
export function valueNoise2D(x, y, seed = 0) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = x0 + 1;
  const y1 = y0 + 1;

  const sx = fade(x - x0);
  const sy = fade(y - y0);

  const n00 = hash2(x0, y0, seed);
  const n10 = hash2(x1, y0, seed);
  const n01 = hash2(x0, y1, seed);
  const n11 = hash2(x1, y1, seed);

  const ix0 = lerp(n00, n10, sx);
  const ix1 = lerp(n01, n11, sx);
  return lerp(ix0, ix1, sy);
}

/**
 * Generate an integer height per primary vertex by sampling value-noise at each
 * vertex's world position scaled by `roughness`. Deterministic per `seed`.
 *
 * @param {{ vertices: Array<[number,number]> }} mesh
 * @param {{ seed?: number, amplitude?: number, roughness?: number }} opts
 *   seed       integer; same seed → identical heights.
 *   amplitude  max floors (clamped ≥0). Heights land in [0, amplitude].
 *   roughness  noise frequency / feature size. Higher = smaller features = more
 *              variation across the patch.
 * @returns {number[]} one integer height (≥0, ≤amplitude) per vertex.
 */
export function generateTerrain(mesh, opts = {}) {
  const seed = (opts.seed | 0) || 0;
  const amplitude = Math.max(0, Math.round(opts.amplitude != null ? opts.amplitude : 4));
  const roughness = opts.roughness != null ? opts.roughness : 1;

  if (!mesh || !mesh.vertices || !mesh.vertices.length) return [];

  const out = new Array(mesh.vertices.length);
  for (let i = 0; i < mesh.vertices.length; i++) {
    const v = mesh.vertices[i];
    const x = v[0] * roughness;
    const y = v[1] * roughness;
    const n = valueNoise2D(x, y, seed); // [0,1)
    // Map noise → [0, amplitude] floors, rounded to an integer, clamped ≥0.
    let h = Math.round(n * amplitude);
    if (h < 0) h = 0;
    if (h > amplitude) h = amplitude;
    out[i] = h;
  }
  return out;
}
