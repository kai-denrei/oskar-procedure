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

// generateDecorations + buildSceneGeometry read heights through an object with
// .get/.max; our edit store keeps a plain number[]. This adapts the array.
function heightsView(arr) {
  return {
    get: (v) => (v >= 0 && v < arr.length ? (arr[v] | 0) : 0),
    max: () => { let m = 0; for (const h of arr) if (h > m) m = h; return m; },
    forEach: (cb) => arr.forEach((h, i) => cb(h, i)),
    get size() { return arr.length; },
  };
}

// Resolve the cell a decoration record sits on. Water carries quadIndex; others
// carry x,y → point-in-quad. Returns a cell index (>=0) or 0 as a safe fallback.
function recordCell(mesh, d) {
  if (Number.isInteger(d.quadIndex)) return d.quadIndex;
  if (typeof d.x === 'number' && typeof d.y === 'number') {
    const c = cellAt(mesh, d.x, d.y);
    return c >= 0 ? c : 0;
  }
  return 0;
}

// Bake a tile's procedural output into an editable edit-state (idempotent).
// `mesh` is the tile's relaxed hex patch (caller supplies; see map-view cache).
export function bakeIfNeeded(tile, mesh) {
  if (tile.edit) return tile.edit;
  const biome = getBiome(tile.biomeId);
  const generated = biome.generate(mesh, {
    seed: tile.seed, amplitude: biome.maxHeight, roughness: 4,
  });
  const heights = generated.map((h) => Math.max(0, Math.round(h)));
  const decs = generateDecorations({
    biome: tile.biomeId, mesh, heights: heightsView(heights),
    seed: tile.seed, floorH: FLOOR_H,
  });
  const objects = decs.map((d) => ({ ...d, cell: recordCell(mesh, d) }));
  tile.edit = { heights, objects, epoch: 1 };
  return tile.edit;
}

// Raise (dir=+1) or lower (dir=-1) a cell to a FLAT block one floor from its
// current top, clamped to [0, maxHeight]. Sets all 4 corners equal (terracing
// look, matches the 3D playground). Bumps epoch. Mutates tile.edit.heights.
export function sculpt(tile, cellIdx, dir, maxHeight, mesh) {
  const e = tile.edit;
  const q = mesh.quads[cellIdx];
  const top = cellTopHeight(mesh, cellIdx, e.heights);
  let target = top + (dir >= 0 ? 1 : -1);
  if (target < 0) target = 0;
  if (target > maxHeight) target = maxHeight;
  for (let i = 0; i < 4; i++) e.heights[q[i]] = target;
  e.epoch++;
  return target;
}

// Refresh each object's z to its cell's current surface top (objects ride
// terrain) and build the focused tile's geometry, centered at the tile's own
// origin (NOT translated to tile.center — the board view does that).
export function buildFocusGeometry(tile, mesh) {
  const e = tile.edit;
  const biome = getBiome(tile.biomeId);
  for (const o of e.objects) {
    if (Number.isInteger(o.cell)) {
      o.z = cellTopHeight(mesh, o.cell, e.heights) * FLOOR_H;
    }
  }
  return buildSceneGeometry(
    { mesh, heights: heightsView(e.heights), decorations: e.objects, biome },
    { floorH: FLOOR_H, amplitude: biome.maxHeight }
  );
}
