// geometry.js — build renderable 3D geometry (positions + normals + colors +
// indices) from a relaxed quad {mesh} and a per-vertex {heights} field.
// Pure logic, NO DOM, NO GL — Node-testable (assert counts, finite values,
// unit normals). The WebGL renderer uploads the buffers this returns.
//
// World axes: x,y are the mesh's planar world units; z is UP. The ground plane
// is z=0. A vertex at integer height h raises that column corner to z = h*floorH.
//
//   buildSceneGeometry({ mesh, heights }, opts) -> {
//     positions: Float32Array (xyz per vertex),
//     normals:   Float32Array (xyz per vertex, unit length),
//     colors:    Float32Array (rgb per vertex, 0..1),
//     indices:   Uint32Array  (triangle list, CCW front faces),
//     vertexCount, triangleCount, bounds: {min:[x,y,z], max:[x,y,z]}
//   }
//
// Geometry built:
//   (a) FLOOR — every relaxed quad triangulated as a flat plane at z=0, plus a
//       thin slab: the boundary edges extruded down to z=-slabT and capped, so
//       the patch reads as a solid floor (like the retired iso slab). Warm color.
//   (b) COLUMNS — for each quad with ANY raised corner (max corner height > 0):
//       an extruded prism = 4 side walls + a top face. Each of the 4 top corners
//       sits at z = heights.get(thatVertex) * floorH, so the top is stepped/sloped
//       per the per-vertex heights. A quad with all-zero corners draws floor only.
//       Outward normals, CCW winding (front faces). Slightly brighter/amber color.

// House palette (linearish 0..1 rgb). Floor top is warm ink; column tops/walls
// are amber-tinted and a touch brighter so structure reads against the floor.
const FLOOR_COLOR = [0.79, 0.74, 0.66];   // ~#c9bda9 warm ink, low
const FLOOR_SIDE_COLOR = [0.40, 0.37, 0.31]; // darker slab walls
const COLUMN_TOP_COLOR = [0.88, 0.66, 0.28];  // amber top ~#e0a847
const COLUMN_WALL_COLOR = [0.74, 0.55, 0.24]; // slightly darker amber wall

function bboxDiagonal(vertices) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of vertices) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  if (!Number.isFinite(minX)) return 1;
  return Math.hypot(maxX - minX, maxY - minY) || 1;
}

const edgeKey = (a, b) => (a < b ? a + '-' + b : b + '-' + a);

// Boundary edges = edges used by exactly one quad (the hull). Returns ordered
// [a,b] pairs as they appear on their owning quad (so a→b winds CCW around the
// quad, i.e. the patch interior is on the left).
function boundaryEdges(quads) {
  const uses = new Map();
  for (const q of quads) {
    for (let i = 0; i < 4; i++) {
      const a = q[i], b = q[(i + 1) % 4];
      const key = edgeKey(a, b);
      const rec = uses.get(key);
      if (rec) rec.count++;
      else uses.set(key, { a, b, count: 1 });
    }
  }
  const out = [];
  for (const { a, b, count } of uses.values()) {
    if (count === 1) out.push([a, b]);
  }
  return out;
}

// Cross product of (b-a)×(c-a) for 3-vectors, normalized. Returns null if the
// triangle is degenerate (zero area / collinear) so the caller can skip it.
function triNormal(a, b, c) {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  const l = Math.hypot(nx, ny, nz);
  if (l < 1e-12) return null; // degenerate triangle
  return [nx / l, ny / l, nz / l];
}

export function buildSceneGeometry({ mesh, heights } = {}, opts = {}) {
  const floorH = opts.floorH != null ? opts.floorH : 0.06;
  // Slab thickness: default scaled to the patch so it reads at any grid size.
  const slabT =
    opts.slabT != null
      ? opts.slabT
      : (mesh && mesh.vertices && mesh.vertices.length
          ? bboxDiagonal(mesh.vertices) * 0.04
          : 0.04);

  const positions = [];
  const normals = [];
  const colors = [];
  const indices = [];

  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

  // Emit one triangle from three world points + a per-tri normal + flat color.
  // (Flat shading: every triangle owns its three vertices, so columns get crisp
  // faceted faces — appropriate for the blocky build-by-stacking look.)
  function tri(p0, p1, p2, color) {
    const n = triNormal(p0, p1, p2);
    if (!n) return; // skip degenerate (collapsed) triangle — keeps normals unit
    const base = positions.length / 3;
    for (const p of [p0, p1, p2]) {
      positions.push(p[0], p[1], p[2]);
      normals.push(n[0], n[1], n[2]);
      colors.push(color[0], color[1], color[2]);
      if (p[0] < minX) minX = p[0];
      if (p[1] < minY) minY = p[1];
      if (p[2] < minZ) minZ = p[2];
      if (p[0] > maxX) maxX = p[0];
      if (p[1] > maxY) maxY = p[1];
      if (p[2] > maxZ) maxZ = p[2];
    }
    indices.push(base, base + 1, base + 2);
  }

  // A planar quad p0→p1→p2→p3 (CCW) as two triangles, sharing the same color.
  function quadFace(p0, p1, p2, p3, color) {
    tri(p0, p1, p2, color);
    tri(p0, p2, p3, color);
  }

  if (!mesh || !mesh.vertices || !mesh.quads || !mesh.vertices.length) {
    return finalize();
  }

  const { vertices, quads } = mesh;
  const H = (v) => (heights ? heights.get(v) : 0);
  const z3 = (vi, z) => [vertices[vi][0], vertices[vi][1], z];

  // --- (a) FLOOR top: every quad as a flat CCW plane at z=0 (normal +z). ----
  for (const q of quads) {
    const a = z3(q[0], 0), b = z3(q[1], 0), c = z3(q[2], 0), d = z3(q[3], 0);
    // mesh quads are CCW in xy; with +z up this gives an upward (+z) normal.
    quadFace(a, b, c, d, FLOOR_COLOR);
  }

  // --- (a) FLOOR slab: boundary edges extruded down to z=-slabT (side walls).
  // Quad winding makes interior on the LEFT of a→b, so the outward side wall is
  // top(a)→top(b)→bot(b)→bot(a) read so its normal points away from the patch.
  for (const [a, b] of boundaryEdges(quads)) {
    const ta = z3(a, 0), tb = z3(b, 0);
    const ba = z3(a, -slabT), bb = z3(b, -slabT);
    quadFace(tb, ta, ba, bb, FLOOR_SIDE_COLOR);
  }

  // --- (b) COLUMNS: per quad with any raised corner -> extruded prism. ------
  for (const q of quads) {
    const h0 = H(q[0]), h1 = H(q[1]), h2 = H(q[2]), h3 = H(q[3]);
    if (h0 <= 0 && h1 <= 0 && h2 <= 0 && h3 <= 0) continue; // floor only

    // Top corners at each vertex's height (stepped/sloped top).
    const t0 = z3(q[0], h0 * floorH);
    const t1 = z3(q[1], h1 * floorH);
    const t2 = z3(q[2], h2 * floorH);
    const t3 = z3(q[3], h3 * floorH);
    // Bottoms at the floor (z=0).
    const f0 = z3(q[0], 0);
    const f1 = z3(q[1], 0);
    const f2 = z3(q[2], 0);
    const f3 = z3(q[3], 0);

    // Top face (CCW from above -> +z-ish normal). May be sloped if heights differ.
    quadFace(t0, t1, t2, t3, COLUMN_TOP_COLOR);

    // 4 side walls. For edge corner i->i+1, the wall is floor(i)->floor(i+1)->
    // top(i+1)->top(i). Because the quad is CCW (interior on the left of i->i+1),
    // winding floor(i)->top(i)->top(i+1)->floor(i+1) faces OUTWARD.
    const tops = [t0, t1, t2, t3];
    const flrs = [f0, f1, f2, f3];
    const hs = [h0, h1, h2, h3];
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      // A wall whose BOTH endpoints sit on the floor has zero height -> zero
      // area -> a degenerate (NaN) normal. Skip it; the floor already covers it.
      if (hs[i] <= 0 && hs[j] <= 0) continue;
      quadFace(flrs[i], tops[i], tops[j], flrs[j], COLUMN_WALL_COLOR);
    }
  }

  return finalize();

  function finalize() {
    if (!Number.isFinite(minX)) {
      minX = minY = minZ = 0;
      maxX = maxY = maxZ = 0;
    }
    return {
      positions: new Float32Array(positions),
      normals: new Float32Array(normals),
      colors: new Float32Array(colors),
      indices: new Uint32Array(indices),
      vertexCount: positions.length / 3,
      triangleCount: indices.length / 3,
      bounds: { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] },
    };
  }
}
