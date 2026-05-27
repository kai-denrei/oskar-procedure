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
