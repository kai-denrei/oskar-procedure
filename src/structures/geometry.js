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
// These are the DUNES-era defaults and remain the fallback when no biome
// `colorize()` is supplied (Grid-paint-only sessions, tests).
const FLOOR_COLOR = [0.79, 0.74, 0.66];   // ~#c9bda9 warm ink, low
const FLOOR_SIDE_COLOR = [0.40, 0.37, 0.31]; // darker slab walls
const COLUMN_TOP_COLOR = [0.88, 0.66, 0.28];  // amber top ~#e0a847
const COLUMN_WALL_COLOR = [0.74, 0.55, 0.24]; // slightly darker amber wall

// Decoration palette — only used when `decorations` are merged in.
const TREE_TRUNK_COLOR  = [0.32, 0.22, 0.14];
const TREE_CANOPY_COLOR = [0.08, 0.36, 0.16];
const WATER_COLOR       = [0.18, 0.42, 0.52];
const POND_COLOR        = [0.22, 0.46, 0.58];
const REED_COLOR        = [0.20, 0.42, 0.20];
const ROCK_COLOR        = [0.50, 0.50, 0.52];
const WALL_COLOR        = [0.80, 0.72, 0.58];
const ROOF_COLOR        = [0.62, 0.30, 0.24];
// Soft side-tone for slope/wall variants of a base color (darken a bit).
function darken(c, k = 0.78) { return [c[0] * k, c[1] * k, c[2] * k]; }

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

export function buildSceneGeometry({ mesh, heights, decorations, biome } = {}, opts = {}) {
  const floorH = opts.floorH != null ? opts.floorH : 0.06;
  // Slab thickness: default scaled to the patch so it reads at any grid size.
  const slabT =
    opts.slabT != null
      ? opts.slabT
      : (mesh && mesh.vertices && mesh.vertices.length
          ? bboxDiagonal(mesh.vertices) * 0.04
          : 0.04);

  // Biome color resolver — falls back to legacy amber palette when no biome is
  // supplied (keeps existing tests + Grid-only sessions visually unchanged).
  // The biome's colorize() gets a per-vertex context so it can vary by height
  // / world position; the resolver swaps in darker tones for walls/slab so
  // the form still reads in any palette.
  const hasBiome = biome && typeof biome.colorize === 'function';
  const amp = opts.amplitude != null
    ? opts.amplitude
    : (heights && typeof heights.max === 'function' ? Math.max(1, heights.max()) : 1);

  function colorTop(vi) {
    if (!hasBiome) return COLUMN_TOP_COLOR;
    const h = heights ? heights.get(vi) : 0;
    return biome.colorize({
      height: h,
      amplitude: amp,
      vertexIndex: vi,
      worldXY: mesh.vertices[vi],
    });
  }
  function colorFloorTop(vi) {
    if (!hasBiome) return FLOOR_COLOR;
    return biome.colorize({
      height: 0,
      amplitude: amp,
      vertexIndex: vi,
      worldXY: mesh.vertices[vi],
    });
  }
  function colorWall(vi) {
    if (!hasBiome) return COLUMN_WALL_COLOR;
    const top = colorTop(vi);
    return darken(top, 0.78);
  }
  function colorSlab(vi) {
    if (!hasBiome) return FLOOR_SIDE_COLOR;
    return darken(colorFloorTop(vi), 0.55);
  }

  const positions = [];
  const normals = [];
  const colors = [];
  const indices = [];

  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

  // Emit one triangle from three world points + a per-tri normal + colors.
  // `color` may be a single [r,g,b] (shared by all three verts) or a 3-tuple
  // of [r,g,b]s (one per vertex) for per-vertex shaded faces (biome ramps).
  // (Flat shading: every triangle owns its three vertices, so columns get crisp
  // faceted faces — appropriate for the blocky build-by-stacking look.)
  function tri(p0, p1, p2, color) {
    const n = triNormal(p0, p1, p2);
    if (!n) return; // skip degenerate (collapsed) triangle — keeps normals unit
    const base = positions.length / 3;
    const perVertex = Array.isArray(color) && Array.isArray(color[0]);
    const pts = [p0, p1, p2];
    for (let i = 0; i < 3; i++) {
      const p = pts[i];
      const c = perVertex ? color[i] : color;
      positions.push(p[0], p[1], p[2]);
      normals.push(n[0], n[1], n[2]);
      colors.push(c[0], c[1], c[2]);
      if (p[0] < minX) minX = p[0];
      if (p[1] < minY) minY = p[1];
      if (p[2] < minZ) minZ = p[2];
      if (p[0] > maxX) maxX = p[0];
      if (p[1] > maxY) maxY = p[1];
      if (p[2] > maxZ) maxZ = p[2];
    }
    indices.push(base, base + 1, base + 2);
  }

  // A planar quad p0→p1→p2→p3 (CCW) as two triangles. Color is either one
  // [r,g,b] (uniform) or a 4-tuple [c0,c1,c2,c3] (one per corner).
  function quadFace(p0, p1, p2, p3, color) {
    const perVertex = Array.isArray(color) && Array.isArray(color[0]);
    if (perVertex) {
      tri(p0, p1, p2, [color[0], color[1], color[2]]);
      tri(p0, p2, p3, [color[0], color[2], color[3]]);
    } else {
      tri(p0, p1, p2, color);
      tri(p0, p2, p3, color);
    }
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
    if (hasBiome) {
      quadFace(a, b, c, d, [
        colorFloorTop(q[0]), colorFloorTop(q[1]),
        colorFloorTop(q[2]), colorFloorTop(q[3]),
      ]);
    } else {
      quadFace(a, b, c, d, FLOOR_COLOR);
    }
  }

  // --- (a) FLOOR slab: boundary edges extruded down to z=-slabT (side walls).
  // Quad winding makes interior on the LEFT of a→b, so the outward side wall is
  // top(a)→top(b)→bot(b)→bot(a) read so its normal points away from the patch.
  for (const [a, b] of boundaryEdges(quads)) {
    const ta = z3(a, 0), tb = z3(b, 0);
    const ba = z3(a, -slabT), bb = z3(b, -slabT);
    if (hasBiome) {
      quadFace(tb, ta, ba, bb, [colorSlab(b), colorSlab(a), colorSlab(a), colorSlab(b)]);
    } else {
      quadFace(tb, ta, ba, bb, FLOOR_SIDE_COLOR);
    }
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
    if (hasBiome) {
      quadFace(t0, t1, t2, t3, [colorTop(q[0]), colorTop(q[1]), colorTop(q[2]), colorTop(q[3])]);
    } else {
      quadFace(t0, t1, t2, t3, COLUMN_TOP_COLOR);
    }

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
      if (hasBiome) {
        const ci = colorWall(q[i]);
        const cj = colorWall(q[j]);
        quadFace(flrs[i], tops[i], tops[j], flrs[j], [ci, ci, cj, cj]);
      } else {
        quadFace(flrs[i], tops[i], tops[j], flrs[j], COLUMN_WALL_COLOR);
      }
    }
  }

  // --- (c) DECORATIONS: low-poly per-biome props (trees, flowers, ponds…) ---
  if (decorations && decorations.length) emitDecorations(decorations);

  return finalize();

  // ── decoration mesh emitters ──────────────────────────────────────────────
  // Each emitter takes a Decoration record (declarative, see decorations.js)
  // and pushes triangles via the same tri()/quadFace() helpers, so decorations
  // ride the same VBO/IBO + Lambert shading as the columns.

  // A cylinder (n-sided prism) standing along +z at (cx,cy,z0..z0+h). Returns
  // outward side walls + a top cap. Used for tree trunks + reed shafts.
  function emitCylinder(cx, cy, z0, h, r, sides, color) {
    if (r <= 0 || h <= 0) return;
    const N = Math.max(3, sides | 0);
    const cz = z0 + h;
    // Side walls
    for (let i = 0; i < N; i++) {
      const a0 = (i / N) * Math.PI * 2;
      const a1 = ((i + 1) / N) * Math.PI * 2;
      const p0 = [cx + r * Math.cos(a0), cy + r * Math.sin(a0), z0];
      const p1 = [cx + r * Math.cos(a1), cy + r * Math.sin(a1), z0];
      const p2 = [cx + r * Math.cos(a1), cy + r * Math.sin(a1), cz];
      const p3 = [cx + r * Math.cos(a0), cy + r * Math.sin(a0), cz];
      // CCW from outside: p0 → p1 → p2 → p3
      quadFace(p0, p1, p2, p3, color);
    }
    // Top cap (small fan)
    const top = [cx, cy, cz];
    for (let i = 0; i < N; i++) {
      const a0 = (i / N) * Math.PI * 2;
      const a1 = ((i + 1) / N) * Math.PI * 2;
      const p0 = [cx + r * Math.cos(a0), cy + r * Math.sin(a0), cz];
      const p1 = [cx + r * Math.cos(a1), cy + r * Math.sin(a1), cz];
      tri(top, p1, p0, color); // wound so +z faces up
    }
  }

  // A cone (n-sided pyramid) sitting on its circular base at z0, apex at z0+h.
  // Used for tree canopies + flower heads.
  function emitCone(cx, cy, z0, h, r, sides, color) {
    if (r <= 0 || h <= 0) return;
    const N = Math.max(3, sides | 0);
    const apex = [cx, cy, z0 + h];
    // Side faces (each a single triangle apex–baseN–baseN+1, normal outward)
    for (let i = 0; i < N; i++) {
      const a0 = (i / N) * Math.PI * 2;
      const a1 = ((i + 1) / N) * Math.PI * 2;
      const b0 = [cx + r * Math.cos(a0), cy + r * Math.sin(a0), z0];
      const b1 = [cx + r * Math.cos(a1), cy + r * Math.sin(a1), z0];
      tri(b0, b1, apex, color);
    }
    // Closed base disk so the bottom doesn't show as a hole (back-facing the
    // light, but two-sided shader hides this — and depth ordering is correct).
    const center = [cx, cy, z0];
    for (let i = 0; i < N; i++) {
      const a0 = (i / N) * Math.PI * 2;
      const a1 = ((i + 1) / N) * Math.PI * 2;
      const b0 = [cx + r * Math.cos(a0), cy + r * Math.sin(a0), z0];
      const b1 = [cx + r * Math.cos(a1), cy + r * Math.sin(a1), z0];
      tri(center, b0, b1, color); // base faces down (-z) — order CCW from below
    }
  }

  // A flat horizontal disk at (cx,cy,z) with radius r. Single face, +z normal.
  function emitDisk(cx, cy, z, r, sides, color) {
    if (r <= 0) return;
    const N = Math.max(3, sides | 0);
    const center = [cx, cy, z];
    for (let i = 0; i < N; i++) {
      const a0 = (i / N) * Math.PI * 2;
      const a1 = ((i + 1) / N) * Math.PI * 2;
      const p0 = [cx + r * Math.cos(a0), cy + r * Math.sin(a0), z];
      const p1 = [cx + r * Math.cos(a1), cy + r * Math.sin(a1), z];
      tri(center, p0, p1, color); // CCW from above → +z normal
    }
  }

  // An axis-aligned square prism (hut walls) centered at (cx,cy), side `w`,
  // from z0 up to z0+h, plus a flat top. Walls wound outward (matches columns).
  // For a CCW-from-above square, wall on edge i→j wound floor(i)→top(i)→top(j)→floor(j)
  // faces outward (same convention as column side walls above).
  function emitBox(cx, cy, z0, w, h, color) {
    if (w <= 0 || h <= 0) return;
    const hw = w / 2, z1 = z0 + h;
    const c = [[cx-hw,cy-hw],[cx+hw,cy-hw],[cx+hw,cy+hw],[cx-hw,cy+hw]]; // CCW
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      const fi = [c[i][0], c[i][1], z0], ti = [c[i][0], c[i][1], z1];
      const tj = [c[j][0], c[j][1], z1], fj = [c[j][0], c[j][1], z0];
      quadFace(fi, ti, tj, fj, color); // outward
    }
    quadFace([c[0][0],c[0][1],z1],[c[1][0],c[1][1],z1],[c[2][0],c[2][1],z1],[c[3][0],c[3][1],z1], color);
  }

  function emitDecorations(decs) {
    for (const d of decs) {
      if (d.type === 'tree') {
        emitCylinder(d.x, d.y, d.z, d.trunkHeight, d.trunkRadius, 5, TREE_TRUNK_COLOR);
        emitCone(d.x, d.y, d.z + d.trunkHeight, d.canopyHeight, d.canopyRadius, 6, TREE_CANOPY_COLOR);
      } else if (d.type === 'flower') {
        // Tiny stem (thin green) + a small colored cap (cone or disk).
        emitCylinder(d.x, d.y, d.z, d.height, d.radius * 0.25, 3, [0.30, 0.50, 0.20]);
        emitCone(d.x, d.y, d.z + d.height, d.radius * 1.4, d.radius * 0.9, 4, d.color);
      } else if (d.type === 'pond') {
        emitDisk(d.x, d.y, d.z, d.radius, 12, POND_COLOR);
      } else if (d.type === 'water') {
        // Cover the cell's footprint with a flat quad at low z.
        const q = quads[d.quadIndex];
        if (!q) continue;
        const a = z3(q[0], d.z), b = z3(q[1], d.z),
              c = z3(q[2], d.z), e = z3(q[3], d.z);
        quadFace(a, b, c, e, WATER_COLOR);
      } else if (d.type === 'reed') {
        emitCylinder(d.x, d.y, d.z, d.height, d.radius, 3, REED_COLOR);
      } else if (d.type === 'rock') {
        emitCone(d.x, d.y, d.z, d.height, d.radius, 5, ROCK_COLOR);
      } else if (d.type === 'building') {
        emitBox(d.x, d.y, d.z, d.width, d.wallHeight, WALL_COLOR);
        emitCone(d.x, d.y, d.z + d.wallHeight, d.roofHeight, d.width * 0.78, 4, ROOF_COLOR);
      }
    }
  }

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
