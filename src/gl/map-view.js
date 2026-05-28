// map-view.js — owns the #map-canvas in #view-map: the Catan-style hexagon
// board. Parallels view3d.js (DO NOT modify view3d) — same WebGL renderer +
// fixed-iso ortho camera + true-bounds reframe pattern, pan (WASD + two-finger)
// + wheel/pinch zoom + orientation. The board MODEL (createHexMap) is owned by
// main.js and passed in via drawMapView({ map }).
//
// Geometry: each tile is its OWN hex patch (generateMesh hex → relax pinned →
// biome.generate heights → colorize + decorations → buildSceneGeometry), then
// its positions are TRANSLATED by tile.center (xy) so the patches abut on the
// honeycomb lattice (see hexmap.js for the Rc·√3 tiling math). Per-tile geometry
// is CACHED (keyed by seed+biome); only a retyped tile rebuilds. A flat sea
// plane is merged under the tiles. All tiles + water → one merged VBO/IBO.
//
// Right-click a tile → a DOM context menu (6 biomes + Water) → setBiome →
// rebuild that one tile → redraw. (Right-click = RETYPE, not lower.)
//
//   initMapView()                wire canvas, GL, pointer/keyboard handlers
//   drawMapView({ map })         rebuild dirty tiles + water, draw
//   resizeMapView()              re-measure on tab switch / resize
//   requestMapReframe()          reframe on next rebuild (radius/randomize/orient)
//   markMapDirty()               force a full rebuild next draw
//   getMapCamera()               expose camera for the panel zoom/orientation

import { createRenderer } from './renderer.js?v=02391cf2';
import { createCamera } from './camera.js?v=02391cf2';
import { multiply, invert, transformPoint } from './mat4.js?v=02391cf2';
import { generateMesh, relax } from '../grid.js?v=02391cf2';
import { getBiome, BIOMES } from '../structures/biomes.js?v=02391cf2';
import { createHeights } from '../structures/heights.js?v=02391cf2';
import { generateDecorations } from '../structures/decorations.js?v=02391cf2';
import { buildSceneGeometry } from '../structures/geometry.js?v=02391cf2';
import { bakeIfNeeded, buildFocusGeometry, cellAt, cellInradius, cellCentroid, sculpt as editSculpt, placeObject as editPlace, eraseAt as editErase, ERASE_RADIUS_FACTOR } from './map-edit.js?v=02391cf2';

const FLOOR_H = 0.06; // world-units per floor (matches view3d / relax SIDE_LENGTH)
// Sea plane sits just under the tiles' base slab so the land reads as islands
// floating on the ocean. The slab in geometry.js is ~4% of the patch diagonal
// below z=0; keep the water just beneath that.
const WATER_Z = -0.05;
const WATER_COLOR = [0.16, 0.40, 0.52]; // blue-green sea
const WATER_MARGIN = 1.6; // sea extends this × Rc beyond the board's tile span

let canvas = null;
let renderer = null;
let camera = null;

// Notified when the wheel changes zoom, so the panel slider can reflect it.
let onZoomChange = null;
export function setMapOnZoomChange(cb) { onZoomChange = cb; }
let onCameraChange = null;
export function setMapOnCameraChange(cb) { onCameraChange = cb; }

export function getMapCamera() { return camera; }

// --- per-tile geometry cache ----------------------------------------------
// key = `${seed}:${biomeId}` → { positions, normals, colors, indices } already
// translated to the tile center. Rebuilt only when a tile's biome changes
// (its seed is stable). Cleared wholesale on radius/randomize.
const tileCache = new Map();
// Relaxed hex patch per tile seed (deterministic from seed) — reused by both
// the board build and focus-mode editing so we never re-relax the same patch.
const meshCache = new Map(); // seed -> relaxed mesh
function tileMesh(tile, map) {
  let m = meshCache.get(tile.seed);
  if (!m) {
    m = generateMesh({ seeder: 'hex', rings: map.ringsPerTile, seed: tile.seed });
    relax(m, { n_iters: 100, pinned: m.boundary });
    meshCache.set(tile.seed, m);
  }
  return m;
}
function tileKey(tile) {
  return tile.seed + ':' + tile.biomeId + ':' + (tile.edit ? tile.edit.epoch : 0);
}

// Live board model + dirty tracking.
let liveMap = null;
let lastMapRef = null;
let dirty = true;
let reframePending = true;
let currentBounds = null;

export function markMapDirty() { dirty = true; }
export function requestMapReframe() { reframePending = true; dirty = true; }

// Drop all cached tile geometry (radius change / randomize → all new seeds).
export function clearMapCache() { tileCache.clear(); meshCache.clear(); markMapDirty(); }

function aspect() {
  if (!canvas) return 1;
  return canvas.width > 0 && canvas.height > 0 ? canvas.width / canvas.height : 1;
}

// Build one tile's renderable geometry (translated to tile.center). A 'water'
// tile is an open-sea hole → no land geometry (the sea plane shows through).
function buildTileGeometry(tile, map) {
  if (tile.biomeId === 'water') return null;
  const biome = getBiome(tile.biomeId);
  const mesh = tileMesh(tile, map);

  let geom;
  if (tile.edit) {
    // Edited tile: render from the editable state (objects already ride terrain
    // via buildFocusGeometry, which refreshes their z).
    geom = buildFocusGeometry(tile, mesh);
  } else {
    // Procedural tile (unchanged behavior).
    const hs = biome.generate(mesh, { seed: tile.seed, amplitude: biome.maxHeight, roughness: 4 });
    const heights = createHeights(mesh.vertices.length);
    for (let i = 0; i < hs.length; i++) heights.set(i, hs[i]);
    const decorations = generateDecorations({ biome: tile.biomeId, mesh, heights, seed: tile.seed, floorH: FLOOR_H });
    geom = buildSceneGeometry({ mesh, heights, decorations, biome }, { floorH: FLOOR_H, amplitude: biome.maxHeight });
  }

  // Translate positions by the tile center (xy).
  const [tx, ty] = tile.center;
  const pos = geom.positions;
  const out = new Float32Array(pos.length);
  for (let i = 0; i < pos.length; i += 3) {
    out[i] = pos[i] + tx; out[i + 1] = pos[i + 1] + ty; out[i + 2] = pos[i + 2];
  }
  return { positions: out, normals: geom.normals, colors: geom.colors, indices: geom.indices };
}

// Cached fetch (build on miss). Returns null for water tiles.
function getTileGeometry(tile, map) {
  if (tile.biomeId === 'water') return null;
  const key = tileKey(tile);
  let g = tileCache.get(key);
  if (!g) {
    g = buildTileGeometry(tile, map);
    if (g) tileCache.set(key, g);
  }
  return g;
}

// A flat sea quad covering the whole board's tile span + a margin, at WATER_Z.
// Returned as a 4-vertex / 2-triangle geometry chunk (normal +z, blue-green).
function buildWaterGeometry(map) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const t of map.tiles) {
    if (t.center[0] < minX) minX = t.center[0];
    if (t.center[1] < minY) minY = t.center[1];
    if (t.center[0] > maxX) maxX = t.center[0];
    if (t.center[1] > maxY) maxY = t.center[1];
  }
  if (!Number.isFinite(minX)) { minX = minY = maxX = maxY = 0; }
  const m = map.Rc * WATER_MARGIN + map.Rc; // a full tile + margin beyond the centers
  const x0 = minX - m, x1 = maxX + m, y0 = minY - m, y1 = maxY + m;
  // CCW from above → +z normal.
  const positions = new Float32Array([
    x0, y0, WATER_Z, x1, y0, WATER_Z, x1, y1, WATER_Z,
    x0, y0, WATER_Z, x1, y1, WATER_Z, x0, y1, WATER_Z,
  ]);
  const normals = new Float32Array(18);
  for (let i = 0; i < 6; i++) { normals[i * 3 + 2] = 1; }
  const colors = new Float32Array(18);
  for (let i = 0; i < 6; i++) {
    colors[i * 3] = WATER_COLOR[0];
    colors[i * 3 + 1] = WATER_COLOR[1];
    colors[i * 3 + 2] = WATER_COLOR[2];
  }
  const indices = new Uint32Array([0, 1, 2, 3, 4, 5]);
  return { positions, normals, colors, indices };
}

// Merge every tile's geometry + the water plane into one big VBO/IBO + bounds.
function buildBoardGeometry(map) {
  const chunks = [];
  // Water first (drawn under the tiles; depth test handles ordering anyway).
  chunks.push(buildWaterGeometry(map));
  for (const tile of map.tiles) {
    const g = getTileGeometry(tile, map);
    if (g) chunks.push(g);
  }

  let totalV = 0, totalI = 0;
  for (const c of chunks) { totalV += c.positions.length / 3; totalI += c.indices.length; }

  const positions = new Float32Array(totalV * 3);
  const normals = new Float32Array(totalV * 3);
  const colors = new Float32Array(totalV * 3);
  const indices = new Uint32Array(totalI);

  let vOff = 0, iOff = 0;
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const c of chunks) {
    const vCount = c.positions.length / 3;
    positions.set(c.positions, vOff * 3);
    normals.set(c.normals, vOff * 3);
    colors.set(c.colors, vOff * 3);
    for (let i = 0; i < c.indices.length; i++) indices[iOff + i] = c.indices[i] + vOff;
    // bounds
    for (let i = 0; i < c.positions.length; i += 3) {
      const x = c.positions[i], y = c.positions[i + 1], z = c.positions[i + 2];
      if (x < minX) minX = x; if (y < minY) minY = y; if (z < minZ) minZ = z;
      if (x > maxX) maxX = x; if (y > maxY) maxY = y; if (z > maxZ) maxZ = z;
    }
    vOff += vCount;
    iOff += c.indices.length;
  }
  if (!Number.isFinite(minX)) { minX = minY = minZ = maxX = maxY = maxZ = 0; }

  return {
    positions, normals, colors, indices,
    vertexCount: totalV,
    triangleCount: totalI / 3,
    bounds: { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] },
  };
}

let cachedBoard = null;

// --- focus mode (single-tile editor) -------------------------------------
let focusedTile = null;          // the tile being edited, or null (= board)
let focusGeom = null;            // its cached renderable geometry
let onFocusChange = null;        // (tile|null) => void — main.js swaps the panel
export function setMapOnFocusChange(cb) { onFocusChange = cb; }
export function isFocused() { return focusedTile != null; }
export function getFocusedTile() { return focusedTile; }

function rebuildFocus() {
  if (!focusedTile || !liveMap) return;
  const mesh = tileMesh(focusedTile, liveMap);
  const g = buildFocusGeometry(focusedTile, mesh);
  focusGeom = g;
  if (renderer) renderer.setGeometry(g);
  if (camera) camera.frameBounds(g.bounds);
}

export function enterFocus(tile) {
  if (!tile || tile.biomeId === 'water' || !liveMap) return false;
  if (focusedTile === tile) return true;   // already focused here
  if (focusedTile) exitFocus();            // switching tiles → clean exit first (fires onFocusChange(null))
  bakeIfNeeded(tile, tileMesh(tile, liveMap));
  focusedTile = tile;
  rebuildFocus();
  if (onFocusChange) onFocusChange(tile);
  return true;
}

export function exitFocus() {
  if (!focusedTile) return;
  const t = focusedTile;
  focusedTile = null;
  focusGeom = null;
  // Drop every cached board-geometry entry for this tile (any biome/epoch) so
  // the forced rebuild below re-renders it with the edit.
  for (const k of tileCache.keys()) { if (k.startsWith(t.seed + ':')) tileCache.delete(k); }
  markMapDirty();
  requestMapReframe();
  if (onFocusChange) onFocusChange(null);
}

function rebuildBoard() {
  if (!liveMap) return;
  cachedBoard = buildBoardGeometry(liveMap);
  if (renderer) renderer.setGeometry(cachedBoard);
  dirty = false;
  lastMapRef = liveMap;
  currentBounds = cachedBoard.bounds;

  if (reframePending && cachedBoard.triangleCount > 0 && camera) {
    camera.frameBounds(cachedBoard.bounds);
    reframePending = false;
  }
}

export function drawMapView(state = {}) {
  liveMap = state.map || liveMap;
  if (!renderer || !renderer.ok || !camera || !liveMap) return;

  if (focusedTile) {
    if (!focusGeom) rebuildFocus();
    const view = camera.viewMatrix();
    const proj = camera.projMatrix(aspect());
    renderer.draw(multiply(proj, view));
    return;
  }

  if (dirty || liveMap !== lastMapRef) rebuildBoard();
  const view = camera.viewMatrix();
  const proj = camera.projMatrix(aspect());
  renderer.draw(multiply(proj, view));
}

export function resizeMapView() {
  if (renderer) renderer.resize();
}

// --- right-click → biome picker --------------------------------------------
// Unproject the click to the z=0 plane, find the tile whose regular hexagon
// (circumradius Rc, corner pointing +x) contains the point, and pop a DOM menu.
let onRetype = null; // (tile, biomeId) => void  (main.js installs this)
export function setMapOnRetype(cb) { onRetype = cb; }

function unprojectToGround(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1;
  const ndcY = -(((clientY - rect.top) / rect.height) * 2 - 1);
  const view = camera.viewMatrix();
  const proj = camera.projMatrix(aspect());
  const invVP = invert(multiply(proj, view));
  if (!invVP) return null;
  const nearW = transformPoint(invVP, [ndcX, ndcY, -1]);
  const farW = transformPoint(invVP, [ndcX, ndcY, 1]);
  const dz = farW[2] - nearW[2];
  if (Math.abs(dz) < 1e-9) return null;
  const t = -nearW[2] / dz;
  if (t < 0) return null;
  return [nearW[0] + t * (farW[0] - nearW[0]), nearW[1] + t * (farW[1] - nearW[1])];
}

// Point-in-regular-hexagon (corner pointing +x, circumradius Rc) centered at c.
// A flat-x-corner hexagon = intersection of 3 slabs at 0°/60°/120° normals; the
// max projection onto the three edge-normals (apothem axes 30°/90°/150°) must be
// ≤ apothem = Rc·√3/2.
function pointInTileHex(p, c, Rc) {
  const dx = p[0] - c[0], dy = p[1] - c[1];
  const apothem = (Rc * Math.sqrt(3)) / 2; // edge-normal half-width
  const axes = [30, 90, 150];
  for (const deg of axes) {
    const a = (deg * Math.PI) / 180;
    const proj = Math.abs(dx * Math.cos(a) + dy * Math.sin(a));
    if (proj > apothem + 1e-9) return false;
  }
  return true;
}

// Find the tile under a ground point: exact point-in-hexagon, else nearest
// center within Rc (covers seam rounding).
export function pickTileAt(groundPt) {
  if (!liveMap || !groundPt) return null;
  for (const t of liveMap.tiles) {
    if (pointInTileHex(groundPt, t.center, liveMap.Rc)) return t;
  }
  let best = null, bestD = Infinity;
  for (const t of liveMap.tiles) {
    const d = Math.hypot(groundPt[0] - t.center[0], groundPt[1] - t.center[1]);
    if (d < bestD) { bestD = d; best = t; }
  }
  return bestD <= liveMap.Rc ? best : null;
}

// The DOM context menu (created lazily, reused). 6 biome labels + Water.
let menuEl = null;
function ensureMenu() {
  if (menuEl) return menuEl;
  menuEl = document.createElement('div');
  menuEl.id = 'map-biome-menu';
  menuEl.setAttribute('role', 'menu');
  menuEl.hidden = true;
  document.body.appendChild(menuEl);
  // Dismiss on any outside click / scroll / escape.
  document.addEventListener('pointerdown', (e) => {
    if (menuEl && !menuEl.hidden && !menuEl.contains(e.target)) hideMenu();
  }, true);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hideMenu();
  });
  return menuEl;
}
function hideMenu() { if (menuEl) menuEl.hidden = true; }

// Show the picker for `tile` at client (x,y). On pick → onRetype(tile, id).
function showMenu(tile, clientX, clientY) {
  const el = ensureMenu();
  el.innerHTML = '';
  const options = [...BIOMES.map((b) => ({ id: b.id, label: b.label })), { id: 'water', label: 'Water' }];
  for (const opt of options) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'map-menu-item';
    item.setAttribute('role', 'menuitem');
    item.textContent = opt.label;
    if (opt.id === tile.biomeId) item.classList.add('map-menu-active');
    item.addEventListener('click', () => {
      hideMenu();
      if (onRetype) onRetype(tile, opt.id);
    });
    el.appendChild(item);
  }
  el.hidden = false;
  // Position: clamp to viewport so the menu never spills off-screen (mobile).
  const vw = window.innerWidth, vh = window.innerHeight;
  // measure after un-hiding
  const mw = el.offsetWidth || 140;
  const mh = el.offsetHeight || 200;
  let x = clientX, y = clientY;
  if (x + mw > vw - 4) x = Math.max(4, vw - mw - 4);
  if (y + mh > vh - 4) y = Math.max(4, vh - mh - 4);
  el.style.left = x + 'px';
  el.style.top = y + 'px';
}

function onContextMenu(ev) {
  ev.preventDefault();
  if (focusedTile) {
    // In focus mode: right-click erases the nearest object under the cursor.
    const { gp, cell, mesh } = focusGroundCell(ev);
    if (!gp || cell < 0) return;
    const radius = cellInradius(mesh, cell) * ERASE_RADIUS_FACTOR;
    if (editErase(focusedTile, mesh, gp, radius)) rebuildFocus();
    return;
  }
  const gp = unprojectToGround(ev.clientX, ev.clientY);
  const tile = pickTileAt(gp);
  if (!tile) { hideMenu(); return; }
  showMenu(tile, ev.clientX, ev.clientY);
}

// Test hook: synthesize a retype at a tile (q,r) without a real event. Used by
// headless verification (no reliable contextmenu synthesis under SwiftShader).
export function retypeTileForTest(q, r, biomeId) {
  if (!liveMap) return false;
  const tile = liveMap.getTile(q, r);
  if (!tile) return false;
  if (onRetype) onRetype(tile, biomeId);
  return true;
}

// --- wheel / pinch zoom + two-finger pan (mirrors view3d) ------------------
function onWheel(ev) {
  ev.preventDefault();
  const factor = ev.deltaY < 0 ? 1.1 : 1 / 1.1;
  camera.zoom(factor);
  if (onZoomChange) onZoomChange(camera.getZoom());
}

const activePointers = new Map();
let pinchStartDist = 0;
let pinchStartCentroid = null;
function pointerCentroid() {
  let cx = 0, cy = 0;
  for (const [, [x, y]] of activePointers) { cx += x; cy += y; }
  const n = activePointers.size || 1;
  return [cx / n, cy / n];
}
function onPointerDownPinch(ev) {
  activePointers.set(ev.pointerId, [ev.clientX, ev.clientY]);
  if (activePointers.size === 2) {
    const pts = [...activePointers.values()];
    pinchStartDist = Math.hypot(pts[0][0] - pts[1][0], pts[0][1] - pts[1][1]) || 1;
    pinchStartCentroid = pointerCentroid();
  }
}
function onPointerMovePinch(ev) {
  if (!activePointers.has(ev.pointerId)) return;
  activePointers.set(ev.pointerId, [ev.clientX, ev.clientY]);
  if (activePointers.size === 2) {
    const pts = [...activePointers.values()];
    const d = Math.hypot(pts[0][0] - pts[1][0], pts[0][1] - pts[1][1]) || 1;
    if (pinchStartDist > 0) {
      camera.zoom(d / pinchStartDist);
      if (onZoomChange) onZoomChange(camera.getZoom());
    }
    pinchStartDist = d;
    const c = pointerCentroid();
    if (pinchStartCentroid) {
      const dxPx = c[0] - pinchStartCentroid[0];
      const dyPx = c[1] - pinchStartCentroid[1];
      const rect = canvas.getBoundingClientRect();
      const ext = camera.state.halfExtent / camera.state.zoom;
      const worldPerPx = (2 * ext) / Math.min(rect.width, rect.height);
      camera.pan(-dxPx * worldPerPx, dyPx * worldPerPx, currentBounds);
      if (onCameraChange) onCameraChange();
    }
    pinchStartCentroid = c;
  }
}
function onPointerUpPinch(ev) {
  activePointers.delete(ev.pointerId);
  if (activePointers.size < 2) { pinchStartDist = 0; pinchStartCentroid = null; }
}

// --- focus-mode editing input --------------------------------------------
// tool: { mode:'sculpt'|'place', dir:+1|-1, objectId:string|null }
let tool = { mode: 'sculpt', dir: +1, objectId: null };
export function setMapTool(t) { tool = { ...tool, ...t }; }

// DEMO/test hook: apply an edit to the focused tile by op name, then rebuild.
//   op 'sculpt'  payload { cellIdx, dir }
//   op 'place'   payload { type, point:[lx,ly] }
//   op 'erase'   payload { point:[lx,ly] }
export function applyFocusEdit(op, payload = {}) {
  if (!focusedTile || !liveMap) return false;
  const mesh = tileMesh(focusedTile, liveMap);
  const biome = getBiome(focusedTile.biomeId);
  let ok = false;
  if (op === 'sculpt') {
    editSculpt(focusedTile, payload.cellIdx, payload.dir, biome.maxHeight, mesh);
    ok = true;
  } else if (op === 'place') {
    ok = editPlace(focusedTile, payload.type, mesh, payload.point);
  } else if (op === 'erase') {
    const ci = cellAt(mesh, payload.point[0], payload.point[1]);
    if (ci >= 0) {
      ok = editErase(focusedTile, mesh, payload.point, cellInradius(mesh, ci) * ERASE_RADIUS_FACTOR);
    }
  }
  if (ok) rebuildFocus();
  return ok;
}

// DEMO/test hook: place one of each object + a raised block on the focused tile,
// on spread cells, for a deterministic verification screenshot. Returns false if
// not focused.
export function demoShowcaseEdit() {
  if (!focusedTile || !liveMap) return false;
  const mesh = tileMesh(focusedTile, liveMap);
  const biome = getBiome(focusedTile.biomeId);
  const n = mesh.quads.length;
  const cell = (frac) => Math.min(n - 1, Math.max(0, Math.round(frac * (n - 1))));
  const place = (type, frac) => editPlace(focusedTile, type, mesh, cellCentroid(mesh, cell(frac)));
  place('tree', 0.20);
  place('rock', 0.42);
  place('building', 0.64);
  place('water', 0.84);
  const sc = cell(0.10);
  editSculpt(focusedTile, sc, +1, biome.maxHeight, mesh);
  editSculpt(focusedTile, sc, +1, biome.maxHeight, mesh);
  rebuildFocus();
  return true;
}

let lastSculptCell = -1; // avoid re-editing the same cell while dragging
function focusGroundCell(ev) {
  const gp = unprojectToGround(ev.clientX, ev.clientY);
  if (!gp || !focusedTile) return { gp: null, cell: -1, mesh: null };
  const mesh = tileMesh(focusedTile, liveMap);
  // focus geometry is centered at the tile's own origin → subtract tile.center
  const lx = gp[0] - focusedTile.center[0];
  const ly = gp[1] - focusedTile.center[1];
  return { gp: [lx, ly], cell: cellAt(mesh, lx, ly), mesh };
}

function focusSculptAt(ev) {
  if (tool.mode !== 'sculpt') return;            // Place handled on click
  const { cell, mesh } = focusGroundCell(ev);
  if (cell < 0 || cell === lastSculptCell) return;
  lastSculptCell = cell;
  const biome = getBiome(focusedTile.biomeId);
  editSculpt(focusedTile, cell, tool.dir, biome.maxHeight, mesh);
  rebuildFocus();
}

function focusPlaceAt(ev) {
  const { gp, cell, mesh } = focusGroundCell(ev);
  if (!gp || cell < 0) return;
  if (editPlace(focusedTile, tool.objectId, mesh, gp)) rebuildFocus();
}

// Single-finger drag → pan the board (no build interaction on the Map tab).
let dragging = false;
let lastDrag = null;
let pressStart = null;     // [x,y] client at press
let movedFar = false;      // exceeded the click threshold
const CLICK_PX = 5;

function onPointerDown(ev) {
  if (ev.button === 2) return; // right-click handled by contextmenu
  dragging = true;
  lastDrag = [ev.clientX, ev.clientY];
  pressStart = [ev.clientX, ev.clientY];
  movedFar = false;
  canvas.setPointerCapture?.(ev.pointerId);
  // In focus mode a press begins a place or sculpt stroke depending on the tool.
  // NOTE (Phase 1): sculpt-on-press fires for the first finger of a touch pinch
  // too (one stray cell edit before the 2nd finger cancels the drag). Harmless on
  // desktop/mouse; reversible via Lower. Revisit for touch in a later pass.
  if (focusedTile) {
    if (tool.mode === 'place' && tool.objectId) focusPlaceAt(ev);
    else focusSculptAt(ev);
  }
}
function onPointerMove(ev) {
  if (!dragging || !lastDrag) return;
  const dxPx = ev.clientX - lastDrag[0];
  const dyPx = ev.clientY - lastDrag[1];
  if (pressStart && Math.hypot(ev.clientX - pressStart[0], ev.clientY - pressStart[1]) > CLICK_PX) movedFar = true;
  lastDrag = [ev.clientX, ev.clientY];

  if (focusedTile) { focusSculptAt(ev); return; } // sculpt-paint across cells

  const rect = canvas.getBoundingClientRect();
  const ext = camera.state.halfExtent / camera.state.zoom;
  const worldPerPx = (2 * ext) / Math.min(rect.width, rect.height);
  camera.pan(-dxPx * worldPerPx, dyPx * worldPerPx, currentBounds);
  if (onCameraChange) onCameraChange();
}
function onPointerUp(ev) {
  const wasClick = dragging && !movedFar;
  dragging = false;
  lastDrag = null;
  canvas.releasePointerCapture?.(ev.pointerId);
  if (!focusedTile && wasClick) {
    const gp = unprojectToGround(ev.clientX, ev.clientY);
    const tile = pickTileAt(gp);
    if (tile) enterFocus(tile);
  }
  lastSculptCell = -1;
}

export function initMapView() {
  canvas = document.getElementById('map-canvas');
  if (!canvas) { console.warn('[map-view] #map-canvas not found'); return false; }
  renderer = createRenderer(canvas);
  if (!renderer.ok) { console.error('[map-view] WebGL unavailable'); return false; }
  camera = createCamera();
  canvas.style.touchAction = 'none';

  canvas.addEventListener('pointerdown', (ev) => {
    onPointerDownPinch(ev);
    if (activePointers.size === 1) onPointerDown(ev);
    else if (activePointers.size === 2 && dragging) { dragging = false; lastDrag = null; }
  });
  canvas.addEventListener('pointermove', (ev) => {
    if (activePointers.size >= 2) onPointerMovePinch(ev);
    else onPointerMove(ev);
  });
  const up = (ev) => { onPointerUpPinch(ev); onPointerUp(ev); };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', (ev) => { onPointerUpPinch(ev); dragging = false; lastDrag = null; lastSculptCell = -1; });
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('contextmenu', onContextMenu);
  window.addEventListener('resize', resizeMapView);

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', releaseAllKeys);
  startKeyboardLoop();

  return true;
}

// --- WASD continuous pan (only while the Map tab is visible) ---------------
const heldKeys = new Set();
let keyLoopLast = 0;
function isMapVisible() {
  const view = document.getElementById('view-map');
  return view && !view.hasAttribute('hidden');
}
function isFormFocused() {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}
function onKeyDown(e) {
  if (!isMapVisible() || isFormFocused()) return;
  const k = e.key.toLowerCase();
  if (k === 'w' || k === 'a' || k === 's' || k === 'd') { heldKeys.add(k); e.preventDefault(); }
}
function onKeyUp(e) {
  const k = e.key.toLowerCase();
  if (heldKeys.has(k)) { heldKeys.delete(k); e.preventDefault(); }
}
function releaseAllKeys() { heldKeys.clear(); }
function startKeyboardLoop() {
  keyLoopLast = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  const tick = (now) => {
    const dt = Math.max(0, (now - keyLoopLast) / 1000);
    keyLoopLast = now;
    if (camera && heldKeys.size > 0 && isMapVisible()) {
      const ext = camera.state.halfExtent / camera.state.zoom;
      const speed = ext * 0.7;
      let dx = 0, dy = 0;
      if (heldKeys.has('w')) dy += speed * dt;
      if (heldKeys.has('s')) dy -= speed * dt;
      if (heldKeys.has('d')) dx += speed * dt;
      if (heldKeys.has('a')) dx -= speed * dt;
      if (dx !== 0 || dy !== 0) { camera.pan(dx, dy, currentBounds); if (onCameraChange) onCameraChange(); }
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
