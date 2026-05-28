// grid.js — M1 grid kernel, stages 2–5. Pure logic, NO DOM (so it unit-tests
// in Node). All coordinates live in normalized [0,1]² space. Deterministic:
// the whole pipeline is driven by mulberry32(seed); no Math.random anywhere.
//
// Pipeline (Oskar Stålberg / andersource "organic grid"):
//   1. poisson seed (src/poisson.js)
//   2. triangulate (delaunator) + drop sliver triangles
//   3. dissolve edges: greedily merge legal triangle pairs into quads
//   4. subdivide every face into quads (shared midpoints -> watertight)
//   4b. normalize winding to CCW
//   5. relax vertices toward squareness (closed-form closest-square fit)
//
// PUBLIC API (the renderer/animator builds on these):
//
//   generateMesh({ seed, r = 0.1, k = 30 }) -> { vertices, quads, seed }
//     Runs stages 1–4b. PRE-relax mesh.
//       vertices: Array<[x,y]>  in [0,1]²
//       quads:    Array<[i0,i1,i2,i3]>  CCW vertex indices into vertices
//
//   makeRelaxer(mesh, { SIDE_LENGTH = 0.06, PULL_RATE = 0.3 })
//       -> { step }   step() runs ONE relaxation iteration in place on
//                     mesh.vertices and returns the total displacement
//                     magnitude (so callers can detect convergence).
//
//   relaxStep(mesh, params) -> displacement   // one in-place iteration
//   relax(mesh, { n_iters = 100, ... })       // run all iterations at once
//
// ---------------------------------------------------------------------------
// RISK 1 (CW/CCW relaxation ordering) — RESOLVED, see makeRelaxer below.
//   The closed-form `alpha` derivation orders the quad corners CLOCKWISE about
//   the centroid, but stage 4b normalizes stored winding to CCW. Feeding the
//   formula CCW corners makes the relaxation fight itself (squareness error
//   stays flat / rises). Fix: the relaxer reads each quad's corners in REVERSE
//   (CW view) before applying the formula, then maps the resulting per-corner
//   force back to the correct CCW vertex index. Verified empirically by the
//   "relaxation reduces squareness error" test across several seeds.
// ---------------------------------------------------------------------------

import Delaunator from '../vendor/delaunator.js?v=54e16ae8';
import { mulberry32 } from './rng.js?v=54e16ae8';
import { poissonDisk } from './poisson.js?v=54e16ae8';
import { hexLattice } from './hex.js?v=54e16ae8';
import { sub, mean, cross, dot, len, dist } from './vec.js?v=54e16ae8';

// --- constants -------------------------------------------------------------
const MAX_ANGLE = (Math.PI / 2) * 1.65; // ≈ 148.5°, drop slivers ≥ this
const QUAD_ANGLE_MIN = 0.2 * Math.PI; // 36°
const QUAD_ANGLE_MAX = 0.9 * Math.PI; // 162°

const edgeKey = (a, b) => Math.min(a, b) + '-' + Math.max(a, b);

// --- stage 2: triangulate + filter ----------------------------------------
function triangulate(points) {
  const flat = Delaunator.from(points).triangles;
  const tris = [];
  for (let i = 0; i < flat.length; i += 3) {
    tris.push([flat[i], flat[i + 1], flat[i + 2]]);
  }
  // Drop sliver triangles: largest angle (opposite the longest edge) ≥ MAX_ANGLE.
  return tris.filter((t) => {
    const d = [
      dist(points[t[0]], points[t[1]]),
      dist(points[t[1]], points[t[2]]),
      dist(points[t[2]], points[t[0]]),
    ].sort((x, y) => x - y);
    const [a, b, c] = d; // a ≤ b ≤ c
    if (a < 1e-12 || b < 1e-12) return false; // degenerate -> drop
    let cosLargest = (a * a + b * b - c * c) / (2 * a * b);
    cosLargest = Math.max(-1, Math.min(1, cosLargest));
    return Math.acos(cosLargest) < MAX_ANGLE;
  });
}

// --- stage 3: dissolve edges -> merge triangle pairs into quads ------------
// legit(quad): convex (all 4 corner cross-products same sign) AND every
// interior angle in [QUAD_ANGLE_MIN, QUAD_ANGLE_MAX].
function legitQuad(points, quad) {
  const signs = new Set();
  let minAng = Infinity;
  let maxAng = -Infinity;
  for (let i = 0; i < 4; i++) {
    const prev = points[quad[(i - 1 + 4) % 4]];
    const cur = points[quad[i]];
    const next = points[quad[(i + 1) % 4]];
    const d1 = sub(cur, prev);
    const d2 = sub(next, cur);
    signs.add(Math.sign(cross(d1, d2)));
    const l1 = len(d1);
    const l2 = len(d2);
    if (l1 < 1e-12 || l2 < 1e-12) return false;
    let c = dot(d1, d2) / (l1 * l2);
    c = Math.max(-1, Math.min(1, c));
    const ang = Math.acos(c);
    if (ang < minAng) minAng = ang;
    if (ang > maxAng) maxAng = ang;
  }
  return signs.size === 1 && maxAng <= QUAD_ANGLE_MAX && minAng >= QUAD_ANGLE_MIN;
}

function mergeToQuads(points, triangles, rng) {
  // mutable copy of triangle list
  let tris = triangles.map((t) => t.slice());
  const prequads = [];
  const tabu = new Set();

  for (;;) {
    // Count interior edges over non-tabu edges.
    const counts = new Map();
    for (const t of tris) {
      const es = [edgeKey(t[0], t[1]), edgeKey(t[1], t[2]), edgeKey(t[2], t[0])];
      for (const e of es) {
        if (tabu.has(e)) continue;
        counts.set(e, (counts.get(e) || 0) + 1);
      }
    }
    // Candidates: edges shared by exactly 2 (interior), not tabu.
    let candidates = [];
    for (const [key, c] of counts) {
      if (c > 1) candidates.push(key.split('-').map(Number));
    }
    if (candidates.length === 0) break;

    let mergedThisRound = false;
    while (candidates.length > 0) {
      const idx = Math.floor(rng() * candidates.length);
      const [ea, eb] = candidates.splice(idx, 1)[0];

      // Find the two triangles sharing edge (ea, eb); collect non-shared verts.
      const mergeIdx = [];
      const opp = [];
      for (let i = 0; i < tris.length; i++) {
        const t = tris[i];
        if (t.includes(ea) && t.includes(eb)) {
          mergeIdx.push(i);
          for (const v of t) if (v !== ea && v !== eb) opp.push(v);
        }
      }
      if (mergeIdx.length !== 2) continue; // shouldn't happen for interior edges

      // Interleave: [edge.a, opp0, edge.b, opp1] -> correct corner order.
      const candQuad = [ea, opp[0], eb, opp[1]];

      if (legitQuad(points, candQuad)) {
        prequads.push(candQuad);
        // remove both triangles (higher index first to keep indices valid)
        mergeIdx.sort((x, y) => y - x);
        tris.splice(mergeIdx[0], 1);
        tris.splice(mergeIdx[1], 1);
        mergedThisRound = true;
        break; // restart outer loop with fresh edge counts
      } else {
        tabu.add(edgeKey(ea, eb));
      }
    }
    if (!mergedThisRound) break; // exhausted candidates without a legal merge
  }

  return { triangles: tris, prequads };
}

// --- stage 4: subdivide every face into quads ------------------------------
// Shared midpoints keep the mesh watertight (canonical min-max edge key).
function subdivide(points, faces) {
  const vertices = points.map((p) => p.slice()); // own the array
  const midCache = new Map(); // edgeKey -> vertex index

  const midpointIndex = (a, b) => {
    const key = edgeKey(a, b);
    let mi = midCache.get(key);
    if (mi === undefined) {
      const m = [(vertices[a][0] + vertices[b][0]) / 2, (vertices[a][1] + vertices[b][1]) / 2];
      mi = vertices.length;
      vertices.push(m);
      midCache.set(key, mi);
    }
    return mi;
  };

  const quads = [];
  for (const face of faces) {
    const n = face.length; // 3 (triangle) or 4 (quad)
    const centroid = mean(face.map((vi) => vertices[vi]));
    const ci = vertices.length;
    vertices.push(centroid);

    // edges around the face, in order
    const edges = [];
    for (let i = 0; i < n; i++) edges.push([face[i], face[(i + 1) % n]]);

    // For each corner: [corner, mid(edge meeting it on one side), centroid,
    // mid(edge meeting it on the other side)]. edge j and edge j+1 share corner.
    for (let j = 0; j < n; j++) {
      const e1 = edges[j];
      const e2 = edges[(j + 1) % n];
      const m1 = midpointIndex(e1[0], e1[1]);
      const m2 = midpointIndex(e2[0], e2[1]);
      // common vertex of e1 and e2 = the corner
      let corner = e1[0];
      if (!e2.includes(corner)) corner = e1[1];
      quads.push([corner, m1, ci, m2]);
    }
  }

  return { vertices, quads };
}

// --- stage 4b: normalize winding to CCW ------------------------------------
// Signed area > 0 == CCW (standard math convention, y up). Reverse if CW.
function normalizeWinding(vertices, quads) {
  for (const q of quads) {
    let signed = 0;
    for (let i = 0; i < 4; i++) {
      const cur = vertices[q[i]];
      const nxt = vertices[q[(i + 1) % 4]];
      signed += cur[0] * nxt[1] - nxt[0] * cur[1];
    }
    if (signed < 0) q.reverse(); // was CW -> make CCW
  }
}

// --- stage 1: seed dispatch ------------------------------------------------
// Produce the input point set for stages 2–5. The pipeline is seed-agnostic:
// these are just [x,y] points. `rng` is the mulberry32 stream so the Poisson
// path stays deterministic (the hex path is deterministic by construction and
// doesn't consume rng — the random dissolve in mergeToQuads does).
//
//   seeder 'poisson' -> Bridson Poisson-disk in [0,1]²  (default, unchanged)
//   seeder 'hex'     -> triangular lattice clipped to a hexagon (Variant B)
function seedPoints(rng, { seeder = 'poisson', r = 0.1, k = 30, rings = 4, spacing = 0.1 } = {}) {
  if (seeder === 'hex') {
    return hexLattice({ rings, spacing }).points;
  }
  // default: poisson
  return poissonDisk(rng, { r, k });
}

// --- public: generateMesh --------------------------------------------------
// generateMesh({ seed, seeder, r, k, rings, spacing }) -> { vertices, quads, seed, seeder }
//   seeder === 'poisson' (default): existing Bridson path. Backward-compatible:
//     generateMesh({ seed }) behaves exactly as before.
//   seeder === 'hex': hexLattice({ rings, spacing }) then the SAME stages 2–5.
export function generateMesh({ seed = 0, seeder = 'poisson', r = 0.1, k = 30, rings = 4, spacing = 0.1 } = {}) {
  const rng = mulberry32(seed);
  const points = seedPoints(rng, { seeder, r, k, rings, spacing });
  const triangles = triangulate(points);
  const { triangles: leftover, prequads } = mergeToQuads(points, triangles, rng);
  const faces = [...leftover, ...prequads];
  const { vertices, quads } = subdivide(points, faces);
  normalizeWinding(vertices, quads);
  const boundary = [...boundaryVertices({ quads })];
  return { vertices, quads, seed, seeder, boundary };
}

// --- stage 5: relaxation ---------------------------------------------------
// Closed-form closest-square fit. See RISK 1 note at top of file: the formula
// is derived for CLOCKWISE corner order, so we read each (CCW-stored) quad's
// corners reversed before applying it.
export function relaxStep(mesh, { SIDE_LENGTH = 0.06, PULL_RATE = 0.3, pinned = null } = {}) {
  const { vertices, quads } = mesh;
  const r = SIDE_LENGTH / Math.SQRT2;

  // accumulate per-vertex force
  const forces = vertices.map(() => [0, 0]);

  for (const quad of quads) {
    // CW view of the CCW-stored quad (risk 1).
    const cw = [quad[0], quad[3], quad[2], quad[1]];
    const corners = cw.map((vi) => vertices[vi]);
    const c = mean(corners);
    // centered corners q0..q3
    const q = corners.map((p) => sub(p, c));

    let denom = q[0][0] - q[1][1] - q[2][0] + q[3][1];
    const num = q[0][1] + q[1][0] - q[2][1] - q[3][0];

    const s = Math.sign(denom) || 1;
    denom = s * Math.max(1e-10, Math.abs(denom));

    let alpha = Math.atan(num / denom);
    if (Math.cos(alpha) * denom + Math.sin(alpha) * num < 0) alpha += Math.PI;

    const ca = Math.cos(alpha);
    const sa = Math.sin(alpha);
    const target = [
      [r * ca, r * sa],
      [r * sa, -r * ca],
      [-r * ca, -r * sa],
      [-r * sa, r * ca],
    ];

    for (let i = 0; i < 4; i++) {
      const f = sub(target[i], q[i]);
      const vi = cw[i];
      forces[vi][0] += f[0];
      forces[vi][1] += f[1];
    }
  }

  // apply forces, measure total displacement. PINNED vertices stay fixed: they
  // anchor the relaxation so the interior squares up against an unchanging
  // outline. For a hex patch this keeps the boundary a perfect hexagon (relax
  // happens inside only); it is also the seam H2b uses to stitch patches — a
  // shared boundary, pinned, so adjacent patches meet without cracks.
  let totalDisp = 0;
  for (let v = 0; v < vertices.length; v++) {
    if (pinned && pinned.has(v)) continue;
    const dx = forces[v][0] * PULL_RATE;
    const dy = forces[v][1] * PULL_RATE;
    vertices[v][0] += dx;
    vertices[v][1] += dy;
    totalDisp += Math.hypot(dx, dy);
  }
  return totalDisp;
}

// Boundary vertices = endpoints of edges used by exactly ONE quad (a watertight
// mesh has 2 quads per interior edge, 1 per boundary edge). Returned by
// generateMesh as `boundary`. Pin these to relax a hex patch's interior only
// (perfect-hexagon outline), and as the shared-edge anchor for H2b patches.
export function boundaryVertices({ quads }) {
  const count = new Map();
  for (const q of quads) {
    for (let i = 0; i < 4; i++) {
      const a = q[i], b = q[(i + 1) % 4];
      const key = a < b ? `${a}-${b}` : `${b}-${a}`;
      count.set(key, (count.get(key) || 0) + 1);
    }
  }
  const bset = new Set();
  for (const [key, c] of count) {
    if (c === 1) { const [a, b] = key.split('-'); bset.add(+a); bset.add(+b); }
  }
  return bset;
}

function toPinnedSet(pinned) {
  if (!pinned) return null;
  return pinned instanceof Set ? pinned : new Set(pinned);
}

// Stepper: one iteration per call, in place. Returns total displacement.
export function makeRelaxer(mesh, params = {}) {
  const p = { ...params, pinned: toPinnedSet(params.pinned) };
  return { step: () => relaxStep(mesh, p) };
}

// Convenience: run all iterations at once (used by tests).
export function relax(mesh, { n_iters = 100, ...params } = {}) {
  const p = { ...params, pinned: toPinnedSet(params.pinned) };
  let disp = 0;
  for (let i = 0; i < n_iters; i++) disp = relaxStep(mesh, p);
  return disp;
}
