// render-iso.js — draw the shared quad grid as an isometric "floor" in Canvas2D.
// Stateless: receives ctx, mesh, paint state, dual cells, an iso camera and the
// canvas dims. Draws once and returns. No state ownership, no DOM beyond ctx.
//
// drawIsoFloor(ctx, mesh, cornerState, dualCells, cam, cssW, cssH, opts)
//   mesh        — { vertices: [[x,y],...], quads: [[i0..i3],...] } (world units)
//   cornerState — { get(vertexIndex):boolean } paint flags
//   dualCells   — [{ vertexIndex, centroids:[[x,y]...], center }] (built on settle)
//   cam         — makeIsoCamera(...) instance (project / depth)
//   cssW, cssH  — logical canvas size (ctx already dpr-scaled by the caller)
//
// The floor reads as a SLAB: the boundary edges are extruded down to z=-T and
// drawn as side walls (back-to-front by camera depth) so the patch looks solid
// seen in iso, not a flat outline. The top face shows painted dual cells (teal)
// then the quad grid lines (thin warm strokes, like the 2D renderer).

const DEFAULTS = {
  // slab thickness as a fraction of the mesh bbox diagonal
  thicknessFrac: 0.06,
  // top-face grid strokes (matches drawMesh idiom)
  gridStroke: 'rgba(232,226,212,0.20)',
  gridLineWidth: 0.8,
  // painted dual-cell fill/stroke (matches drawDualCells teal idiom)
  cellFill: 'rgba(60,199,184,0.55)',
  cellStroke: 'rgba(60,199,184,0.85)',
  cellLineWidth: 1,
  // slab side-wall faces (faint dark, so the body reads as solid)
  wallFill: 'rgba(10,9,7,0.78)',
  wallStroke: 'rgba(232,226,212,0.10)',
  wallLineWidth: 0.6,
  // bottom outline (very faint) — drawn implicitly by the wall back edges
};

const edgeKey = (a, b) => (a < b ? a + '-' + b : b + '-' + a);

// Collect mesh edges. Returns { boundary:[[a,b]...], all:[[a,b]...] }.
// boundary = edges used by exactly ONE quad (the hull, watertight mesh).
function collectEdges(quads) {
  const uses = new Map(); // key -> { a, b, count }
  for (const q of quads) {
    for (let i = 0; i < 4; i++) {
      const a = q[i], b = q[(i + 1) % 4];
      const key = edgeKey(a, b);
      const rec = uses.get(key);
      if (rec) rec.count++;
      else uses.set(key, { a, b, count: 1 });
    }
  }
  const all = [];
  const boundary = [];
  for (const { a, b, count } of uses.values()) {
    all.push([a, b]);
    if (count === 1) boundary.push([a, b]);
  }
  return { all, boundary };
}

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

export function drawIsoFloor(ctx, mesh, cornerState, dualCells, cam, cssW, cssH, opts = {}) {
  if (!mesh || !mesh.vertices || !mesh.quads) return;
  const o = { ...DEFAULTS, ...opts };
  const { vertices, quads } = mesh;

  const T = bboxDiagonal(vertices) * o.thicknessFrac;
  const { all, boundary } = collectEdges(quads);

  // --- 1. Slab side walls: each boundary edge → a wall quad (top z=0 → bottom
  // z=-T). Build with a depth key (midpoint, averaged top/bottom), sort
  // back-to-front (smaller depth first), draw filled so the body reads solid.
  const walls = [];
  for (const [a, b] of boundary) {
    const pa = vertices[a], pb = vertices[b];
    const topA = cam.project([pa[0], pa[1], 0]);
    const topB = cam.project([pb[0], pb[1], 0]);
    const botA = cam.project([pa[0], pa[1], -T]);
    const botB = cam.project([pb[0], pb[1], -T]);
    // depth at edge midpoint on the ground (z=0): larger = nearer front
    const dKey = (cam.depth([pa[0], pa[1], 0]) + cam.depth([pb[0], pb[1], 0])) / 2;
    walls.push({ topA, topB, botA, botB, dKey });
  }
  walls.sort((u, v) => u.dKey - v.dKey); // back (small) → front (large)

  ctx.save();
  ctx.fillStyle = o.wallFill;
  ctx.strokeStyle = o.wallStroke;
  ctx.lineWidth = o.wallLineWidth;
  ctx.lineJoin = 'round';
  for (const w of walls) {
    ctx.beginPath();
    ctx.moveTo(w.topA[0], w.topA[1]);
    ctx.lineTo(w.topB[0], w.topB[1]);
    ctx.lineTo(w.botB[0], w.botB[1]);
    ctx.lineTo(w.botA[0], w.botA[1]);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();

  // --- 2. Top face: painted dual cells (teal), projected onto z=0.
  if (dualCells && cornerState) {
    const mid = (p, q) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
    ctx.save();
    ctx.fillStyle = o.cellFill;
    ctx.strokeStyle = o.cellStroke;
    ctx.lineWidth = o.cellLineWidth;
    ctx.lineJoin = 'round';

    for (const cell of dualCells) {
      if (!cornerState.get(cell.vertexIndex)) continue;
      const p = cell.centroids.map((c) => cam.project([c[0], c[1], 0]));
      const n = p.length;
      if (n < 3) continue;
      // rounded fill (same midpoint/quadratic scheme as drawDualCells)
      ctx.beginPath();
      const start = mid(p[n - 1], p[0]);
      ctx.moveTo(start[0], start[1]);
      for (let i = 0; i < n; i++) {
        const ctrl = p[i];
        const end = mid(p[i], p[(i + 1) % n]);
        ctx.quadraticCurveTo(ctrl[0], ctrl[1], end[0], end[1]);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }

  // --- 3. Top face: quad grid lines (deduped edges), thin warm strokes.
  ctx.save();
  ctx.beginPath();
  ctx.strokeStyle = o.gridStroke;
  ctx.lineWidth = o.gridLineWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const [a, b] of all) {
    const pa = vertices[a], pb = vertices[b];
    const sa = cam.project([pa[0], pa[1], 0]);
    const sb = cam.project([pb[0], pb[1], 0]);
    ctx.moveTo(sa[0], sa[1]);
    ctx.lineTo(sb[0], sb[1]);
  }
  ctx.stroke();
  ctx.restore();
}
