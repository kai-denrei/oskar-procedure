// map-edit.js — pure edit ops + picking + single-tile geometry for Map focus
// mode. NO DOM, NO GL (Node-testable). The focus SHELL (camera/input/panel)
// lives in map-view.js / main.js; this module owns the data transforms.

import { buildSceneGeometry } from '../structures/geometry.js';
import { getBiome } from '../structures/biomes.js';
import { generateDecorations } from '../structures/decorations.js';
import { getObjectDef } from '../structures/objects.js';

export const FLOOR_H = 0.06;            // world units per floor (matches map-view)
export const ERASE_RADIUS_FACTOR = 0.6; // × cell inradius

// Sign of the 2D cross product (b-a)×(p-a).
function side(a, b, p) {
  return (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
}

// Index of the (convex) quad containing (x,y), or -1. A point is inside a CCW
// convex quad when it is on the left (>=0) of all four directed edges.
export function cellAt(mesh, x, y) {
  const { vertices, quads } = mesh;
  const p = [x, y];
  for (let qi = 0; qi < quads.length; qi++) {
    const q = quads[qi];
    let inside = true;
    for (let i = 0; i < 4; i++) {
      const a = vertices[q[i]], b = vertices[q[(i + 1) % 4]];
      if (side(a, b, p) < -1e-9) { inside = false; break; }
    }
    if (inside) return qi;
  }
  return -1;
}

// Mean of a quad's 4 corner positions (planar xy).
export function cellCentroid(mesh, cellIdx) {
  const q = mesh.quads[cellIdx], v = mesh.vertices;
  let x = 0, y = 0;
  for (let i = 0; i < 4; i++) { x += v[q[i]][0]; y += v[q[i]][1]; }
  return [x / 4, y / 4];
}

// Min distance from the centroid to the 4 edges — a safe "inside" radius.
export function cellInradius(mesh, cellIdx) {
  const q = mesh.quads[cellIdx], v = mesh.vertices;
  const [cx, cy] = cellCentroid(mesh, cellIdx);
  let min = Infinity;
  for (let i = 0; i < 4; i++) {
    const a = v[q[i]], b = v[q[(i + 1) % 4]];
    const ex = b[0] - a[0], ey = b[1] - a[1];
    const len = Math.hypot(ex, ey) || 1;
    // perpendicular distance from centroid to the (infinite) edge line
    const d = Math.abs((cx - a[0]) * ey - (cy - a[1]) * ex) / len;
    if (d < min) min = d;
  }
  return Number.isFinite(min) ? min : 0;
}

// The cell's surface height (floors) = the max of its 4 corner heights.
// `heights` is a plain number[] per vertex.
export function cellTopHeight(mesh, cellIdx, heights) {
  const q = mesh.quads[cellIdx];
  let m = 0;
  for (let i = 0; i < 4; i++) { const h = heights[q[i]] || 0; if (h > m) m = h; }
  return m;
}
