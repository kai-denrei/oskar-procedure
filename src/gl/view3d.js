// view3d.js — owns the #gl-canvas in #view-3d: WebGL renderer + orbit camera +
// a cached scene geometry (rebuilt only when {mesh, heights} change). Drives
// the orbit + click-to-raise interaction. The mesh/heights state is OWNED by
// main.js and passed into drawView3d() each frame.
//
//   initView3d()                              wire canvas, GL, pointer handlers
//   drawView3d({ mesh, heights, dualCells })  rebuild geom if dirty, draw
//   resizeView3d()                            re-measure on tab switch / resize
//   markView3dDirty()                         force a geometry rebuild next draw

import { createRenderer } from './renderer.js?v=dfbbef36';
import { createCamera } from './camera.js?v=dfbbef36';
import { multiply, invert, transformPoint } from './mat4.js?v=dfbbef36';
import { buildSceneGeometry } from '../structures/geometry.js?v=dfbbef36';
import { hitTestVertex } from '../dual.js?v=dfbbef36';

const FLOOR_H = 0.06; // world-units per floor (matches relax SIDE_LENGTH)
const DRAG_THRESHOLD = 5; // px of pointer movement that turns a click into a drag
const ORBIT_SPEED = 0.008; // radians per CSS pixel

let canvas = null;
let renderer = null;
let camera = null;

// Geometry cache + dirty tracking. We rebuild only when the inputs change.
let cachedGeom = null;
let dirty = true;
let lastMeshRef = null;
let lastHeightsRef = null;
let lastHeightsMax = -1;
let framedOnce = false;

// State injected each frame so pointer handlers can pick against current data.
let liveState = { mesh: null, heights: null, dualCells: null };

// Pointer / drag-vs-click bookkeeping.
let pointerDown = false;
let downX = 0, downY = 0, lastX = 0, lastY = 0;
let moved = 0;
let downShift = false;
let downButton = 0;

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

// --- click-to-raise: unproject a click to the z=0 ground plane -------------
// Build a world ray from the click's NDC, intersect z=0, hit-test the dual
// cells, and raise/lower the picked vertex's height.
function pickAndEdit(ev) {
  const { mesh, heights, dualCells } = liveState;
  if (!heights || !dualCells || !dualCells.length) return;

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

  const vi = hitTestVertex([wx, wy], dualCells);
  if (vi < 0) return;

  // Shift or right-click lowers; plain click raises.
  if (downShift || downButton === 2) heights.lower(vi);
  else heights.raise(vi);
  markView3dDirty();
}

function onPointerDown(ev) {
  pointerDown = true;
  downX = lastX = ev.clientX;
  downY = lastY = ev.clientY;
  moved = 0;
  downShift = ev.shiftKey;
  downButton = ev.button;
  canvas.setPointerCapture?.(ev.pointerId);
}

function onPointerMove(ev) {
  if (!pointerDown) return;
  const dx = ev.clientX - lastX;
  const dy = ev.clientY - lastY;
  lastX = ev.clientX;
  lastY = ev.clientY;
  moved += Math.abs(dx) + Math.abs(dy);

  // Once past the threshold, treat as an orbit drag.
  if (moved >= DRAG_THRESHOLD) {
    // drag right -> rotate azimuth; drag up -> raise elevation.
    camera.orbit(-dx * ORBIT_SPEED, dy * ORBIT_SPEED);
  }
}

function onPointerUp(ev) {
  if (!pointerDown) return;
  pointerDown = false;
  canvas.releasePointerCapture?.(ev.pointerId);
  const totalMove = Math.hypot(ev.clientX - downX, ev.clientY - downY);
  if (totalMove < DRAG_THRESHOLD) {
    // It was a click, not a drag: raise/lower the picked cell.
    pickAndEdit(ev);
  }
}

// --- wheel / pinch zoom ----------------------------------------------------
function onWheel(ev) {
  ev.preventDefault();
  const factor = ev.deltaY > 0 ? 1.1 : 1 / 1.1;
  camera.zoom(factor);
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
    if (pinchStartDist > 0) camera.zoom(pinchStartDist / d);
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
