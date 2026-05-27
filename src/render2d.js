// render2d.js — canvas drawing for the organic quad grid (M1).
// Stateless: receives ctx, mesh, view transform, options. Draws once and returns.
//
// drawMesh(ctx, mesh, view, opts)
//   ctx   — 2D canvas context (already scaled by dpr in main.js)
//   mesh  — { vertices: [[x,y],...], quads: [[i0,i1,i2,i3],...] }
//   view  — { toScreen([x,y]) -> [px,py], scale } from fitView()
//   opts  — { strokeStyle, lineWidth }

/**
 * Draw the quad mesh as thin, low-contrast grid strokes.
 * Shared edges are de-duplicated so they're not double-stroked.
 */
export function drawMesh(ctx, mesh, view, opts = {}) {
  const { vertices, quads } = mesh;
  const {
    strokeStyle = 'rgba(232,226,212,0.18)',
    lineWidth = 0.8,
  } = opts;

  // Collect unique edges: for each quad emit 4 edges, keyed by min-max vertex pair.
  const seen = new Set();
  const edges = [];

  for (const q of quads) {
    for (let i = 0; i < 4; i++) {
      const a = q[i];
      const b = q[(i + 1) % 4];
      const key = a < b ? `${a}-${b}` : `${b}-${a}`;
      if (!seen.has(key)) {
        seen.add(key);
        edges.push([a, b]);
      }
    }
  }

  // Draw all edges in a single path for efficiency.
  ctx.beginPath();
  ctx.strokeStyle = strokeStyle;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  for (const [a, b] of edges) {
    const [ax, ay] = view.toScreen(vertices[a]);
    const [bx, by] = view.toScreen(vertices[b]);
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
  }

  ctx.stroke();
}

/**
 * Draw the filled dual cells (Townscaper-style soft rounded cells).
 *
 * For each dual cell whose primary vertex is "filled" in `state`, build a closed
 * path with ROUNDED corners (docs/06 add_path): the on-curve points are the
 * MIDPOINTS of consecutive centroid pairs and each centroid is the quadratic
 * control point. For polygon points p[0..n-1]:
 *   moveTo(mid(p[n-1], p[0]))
 *   for each i: quadraticCurveTo(p[i], mid(p[i], p[(i+1)%n]))
 *   closePath()
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {Array<{vertexIndex:number, centroids:[number,number][], center:[number,number]}>} dualCells
 * @param {{get(i:number):boolean}} state  per-primary-vertex filled flags
 * @param {{toScreen([x,y]):[number,number]}} view
 * @param {{fillStyle?:string, strokeStyle?:string, lineWidth?:number}} opts
 */
export function drawDualCells(ctx, dualCells, state, view, opts = {}) {
  const {
    fillStyle = 'rgba(60,199,184,0.55)', // teal at ~0.55 alpha
    strokeStyle = 'rgba(60,199,184,0.85)',
    lineWidth = 1,
  } = opts;

  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

  ctx.save();
  ctx.fillStyle = fillStyle;
  ctx.strokeStyle = strokeStyle;
  ctx.lineWidth = lineWidth;
  ctx.lineJoin = 'round';

  for (const cell of dualCells) {
    if (!state.get(cell.vertexIndex)) continue;

    const p = cell.centroids.map((c) => view.toScreen(c));
    const n = p.length;
    if (n < 3) continue;

    ctx.beginPath();
    const startMid = mid(p[n - 1], p[0]);
    ctx.moveTo(startMid[0], startMid[1]);
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
