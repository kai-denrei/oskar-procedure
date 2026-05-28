// view3d.js — owns the #gl-canvas in #view-3d: WebGL renderer + FIXED-ISO
// ortho camera + a cached scene geometry (rebuilt only when {mesh, heights}
// change). Drives the drag-to-build interaction (no orbit) + wheel/pinch zoom.
// The mesh/heights state is OWNED by main.js and passed into drawView3d().
//
//   initView3d()                              wire canvas, GL, pointer handlers
//   drawView3d({ mesh, heights, dualCells })  rebuild geom if dirty, draw
//   resizeView3d()                            re-measure on tab switch / resize
//   markView3dDirty()                         force a geometry rebuild next draw

import { createRenderer } from './renderer.js?v=1689f3b0';
import { createCamera } from './camera.js?v=1689f3b0';
import { multiply, invert, transformPoint } from './mat4.js?v=1689f3b0';
import { buildSceneGeometry } from '../structures/geometry.js?v=1689f3b0';

const FLOOR_H = 0.06; // world-units per floor (matches relax SIDE_LENGTH)

let canvas = null;
let renderer = null;
let camera = null;

// Notified when the wheel changes zoom, so the panel slider can reflect it.
let onZoomChange = null;
export function setOnZoomChange(cb) {
  onZoomChange = cb;
}

// Expose the camera so main.js can drive zoom / orientation from the panel.
export function getCamera() {
  return camera;
}

// Geometry cache + dirty tracking. We rebuild only when the inputs change.
let cachedGeom = null;
let dirty = true;
let lastMeshRef = null;
let lastHeightsRef = null;
let lastHeightsMax = -1;
let framedOnce = false;

// State injected each frame so pointer handlers can pick against current data.
let liveState = { mesh: null, heights: null, dualCells: null };

// Pointer / drag-to-build bookkeeping. Dragging paints a terrain stroke: each
// pointer sample picks a quad and raises (or lowers) it. We track the last
// quad edited THIS stroke so dragging across one cell only edits it once per
// pass (re-entering it after leaving edits it again).
let pointerDown = false;
let downShift = false;
let downButton = 0;
let lastEditedQuad = null; // reference to the quad array last edited this stroke

export function markView3dDirty() {
  dirty = true;
}

function aspect() {
  if (!canvas) return 1;
  return canvas.width > 0 && canvas.height > 0 ? canvas.width / canvas.height : 1;
}

// Rebuild the scene geometry from the live mesh + heights and upload it.
function rebuildGeometry() {
  const { mesh, heights } = liveState;
  cachedGeom = buildSceneGeometry({ mesh, heights }, { floorH: FLOOR_H });
  if (renderer) renderer.setGeometry(cachedGeom);
  dirty = false;
  lastMeshRef = mesh;
  lastHeightsRef = heights;
  lastHeightsMax = heights ? heights.max() : -1;

  // First time we have real geometry, frame the camera on its bounds.
  if (!framedOnce && cachedGeom && cachedGeom.triangleCount > 0 && camera) {
    camera.frameBounds(cachedGeom.bounds);
    framedOnce = true;
  }
}

// Detect input changes cheaply: a new mesh/heights object, or a changed max
// height (the common edit). main.js also calls markView3dDirty() on edits.
function inputsChanged() {
  if (dirty) return true;
  if (liveState.mesh !== lastMeshRef) return true;
  if (liveState.heights !== lastHeightsRef) return true;
  if (liveState.heights && liveState.heights.max() !== lastHeightsMax) return true;
  return false;
}

export function drawView3d(state = {}) {
  liveState = {
    mesh: state.mesh || null,
    heights: state.heights || null,
    dualCells: state.dualCells || null,
  };
  if (!renderer || !renderer.ok || !camera) return;

  if (inputsChanged()) rebuildGeometry();

  const view = camera.viewMatrix();
  const proj = camera.projMatrix(aspect());
  const mvp = multiply(proj, view);
  renderer.draw(mvp);
}

export function resizeView3d() {
  if (renderer) renderer.resize();
}

// --- drag-to-build: unproject a pointer to the z=0 ground plane ------------
// Build a world ray from the pointer's NDC, intersect z=0, pick the quad under
// it, and raise/lower that cell's 4 corners to a flat block. `force` edits even
// if it's the same quad as last sample (used on pointerdown for a clean click).
function pickAndEdit(ev, force = false) {
  const { mesh, heights } = liveState;
  if (!heights || !mesh || !mesh.quads || !mesh.quads.length) return;

  const rect = canvas.getBoundingClientRect();
  // NDC in [-1,1]; y flipped (screen y grows downward).
  const ndcX = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
  const ndcY = -(((ev.clientY - rect.top) / rect.height) * 2 - 1);

  const view = camera.viewMatrix();
  const proj = camera.projMatrix(aspect());
  const invVP = invert(multiply(proj, view));
  if (!invVP) return;

  // Two points along the ray: near plane (z=-1) and far plane (z=+1) in NDC.
  const nearW = transformPoint(invVP, [ndcX, ndcY, -1]);
  const farW = transformPoint(invVP, [ndcX, ndcY, 1]);

  // Ray dir; intersect the z=0 ground plane: nearW + t*(farW-nearW), zhit=0.
  const dz = farW[2] - nearW[2];
  if (Math.abs(dz) < 1e-9) return; // ray parallel to ground
  const t = -nearW[2] / dz;
  if (t < 0) return; // ground behind the camera
  const wx = nearW[0] + t * (farW[0] - nearW[0]);
  const wy = nearW[1] + t * (farW[1] - nearW[1]);

  // Pick the QUAD (cell) under the pointer.
  const quad = pickQuad([wx, wy], mesh);
  if (!quad) return;
  // Skip if it's the same cell we just edited this stroke (one edit per pass).
  if (!force && quad === lastEditedQuad) return;
  lastEditedQuad = quad;

  // Set the 4 corners to a common height: a FLAT-topped block, one floor above
  // (or below) the cell's current tallest corner; neighbours terrace at shared
  // corners. Shift or right-button lowers.
  const cur = Math.max(0, ...quad.map((vi) => heights.get(vi)));
  const lower = downShift || downButton === 2;
  const target = lower ? Math.max(0, cur - 1) : cur + 1;
  for (const vi of quad) heights.set(vi, target);
  markView3dDirty();
}

// Which quad (face) contains the world ground point p=[x,y]? Even-odd
// point-in-polygon over each quad's 4 (x,y) vertices. Returns the quad's
// vertex-index array, or null if the click missed the mesh.
function pickQuad(p, mesh) {
  for (const q of mesh.quads) {
    if (pointInPoly(p, q, mesh.vertices)) return q;
  }
  return null;
}
function pointInPoly(p, idx, verts) {
  let inside = false;
  for (let i = 0, j = idx.length - 1; i < idx.length; j = i++) {
    const a = verts[idx[i]];
    const b = verts[idx[j]];
    if (
      (a[1] > p[1]) !== (b[1] > p[1]) &&
      p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]
    ) {
      inside = !inside;
    }
  }
  return inside;
}

function onPointerDown(ev) {
  pointerDown = true;
  downShift = ev.shiftKey;
  downButton = ev.button;
  lastEditedQuad = null;
  canvas.setPointerCapture?.(ev.pointerId);
  // A stationary click still raises once (force = ignore the same-quad guard).
  pickAndEdit(ev, true);
}

function onPointerMove(ev) {
  if (!pointerDown) return;
  // Keep shift live during a drag (a stroke can change modifier mid-way).
  downShift = ev.shiftKey || downButton === 2;
  // Drag paints a terrain stroke: each new cell gets edited once per pass.
  pickAndEdit(ev, false);
}

function onPointerUp(ev) {
  if (!pointerDown) return;
  pointerDown = false;
  lastEditedQuad = null;
  canvas.releasePointerCapture?.(ev.pointerId);
}

// --- wheel / pinch zoom ----------------------------------------------------
// New ortho camera: zoom() multiplies the zoom level (>1 = zoom in). Scroll up
// (deltaY < 0) zooms in, scroll down zooms out. Notify the panel slider.
function onWheel(ev) {
  ev.preventDefault();
  const factor = ev.deltaY < 0 ? 1.1 : 1 / 1.1;
  camera.zoom(factor);
  if (onZoomChange) onZoomChange(camera.getZoom());
}

// Pinch-to-zoom via two active pointers.
const activePointers = new Map();
let pinchStartDist = 0;
function onPointerDownPinch(ev) {
  activePointers.set(ev.pointerId, [ev.clientX, ev.clientY]);
  if (activePointers.size === 2) {
    const pts = [...activePointers.values()];
    pinchStartDist = Math.hypot(pts[0][0] - pts[1][0], pts[0][1] - pts[1][1]) || 1;
  }
}
function onPointerMovePinch(ev) {
  if (!activePointers.has(ev.pointerId)) return;
  activePointers.set(ev.pointerId, [ev.clientX, ev.clientY]);
  if (activePointers.size === 2) {
    const pts = [...activePointers.values()];
    const d = Math.hypot(pts[0][0] - pts[1][0], pts[0][1] - pts[1][1]) || 1;
    // Spreading fingers (d grows) zooms IN with the new ortho camera.
    if (pinchStartDist > 0) {
      camera.zoom(d / pinchStartDist);
      if (onZoomChange) onZoomChange(camera.getZoom());
    }
    pinchStartDist = d;
  }
}
function onPointerUpPinch(ev) {
  activePointers.delete(ev.pointerId);
  if (activePointers.size < 2) pinchStartDist = 0;
}

export function initView3d() {
  canvas = document.getElementById('gl-canvas');
  if (!canvas) {
    console.warn('[view3d] #gl-canvas not found');
    return false;
  }
  renderer = createRenderer(canvas);
  if (!renderer.ok) {
    console.error('[view3d] WebGL unavailable');
    return false;
  }
  camera = createCamera();

  canvas.style.touchAction = 'none';

  // Orbit + click pointer handling.
  canvas.addEventListener('pointerdown', (ev) => {
    onPointerDownPinch(ev);
    // single-pointer => orbit/click; multi => pinch (don't start an orbit)
    if (activePointers.size === 1) onPointerDown(ev);
  });
  canvas.addEventListener('pointermove', (ev) => {
    if (activePointers.size >= 2) onPointerMovePinch(ev);
    else onPointerMove(ev);
  });
  const up = (ev) => {
    onPointerUpPinch(ev);
    onPointerUp(ev);
  };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', (ev) => {
    onPointerUpPinch(ev);
    pointerDown = false;
  });
  canvas.addEventListener('wheel', onWheel, { passive: false });
  // suppress the browser context menu so right-click can lower.
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  window.addEventListener('resize', resizeView3d);
  return true;
}
