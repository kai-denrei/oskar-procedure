// iso-view.js — owns the #iso-grid canvas in #view-3d: DPI-correct sizing,
// camera state (yaw `angle`), drag-to-rotate interaction, and a draw() that
// frames + renders the shared mesh as an isometric floor. The mesh/paint state
// is OWNED BY main.js (single source of truth) and passed in to draw(); this
// module never regenerates anything.

import { makeIsoCamera, fitIso } from './iso.js?v=6471296b';
import { drawIsoFloor } from './render-iso.js?v=6471296b';

const BG = '#14130f';
const THICKNESS_FRAC = 0.06; // must match render-iso slab thickness for fit

let canvas = null;
let ctx = null;
let cssW = 0, cssH = 0, dpr = 1;

// Camera yaw. Default to a pleasant 3/4 angle.
let angle = Math.PI / 8;

// drag-to-rotate
let dragging = false;
let lastX = 0;
const ROTATE_SPEED = 0.01; // radians per CSS pixel of horizontal drag

function resize() {
  if (!canvas) return;
  dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  cssW = Math.max(1, Math.round(rect.width));
  cssH = Math.max(1, Math.round(rect.height));
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // 1 unit = 1 CSS px
}

// Build the full set of 3D points to frame: every vertex at both the top face
// (z=0) and the slab bottom (z=-T), so the slab stays framed under rotation.
function framePoints(vertices, T) {
  const pts = [];
  for (const [x, y] of vertices) {
    pts.push([x, y, 0]);
    pts.push([x, y, -T]);
  }
  return pts;
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

/**
 * Draw the iso floor for the given shared state. Clears to --bg each frame.
 * @param {{mesh:object|null, cornerState:object|null, dualCells:Array|null}} state
 */
export function drawIsoView(state = {}) {
  if (!ctx) return;
  ctx.clearRect(0, 0, cssW, cssH);
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, cssW, cssH);

  const mesh = state.mesh;
  if (!mesh || !mesh.vertices || !mesh.vertices.length) return;

  const T = bboxDiagonal(mesh.vertices) * THICKNESS_FRAC;

  // Fit at the current angle (re-derived every frame so rotation stays framed).
  const cam0 = { angle };
  const fit = fitIso(framePoints(mesh.vertices, T), cam0, cssW, cssH, 0.1);
  const cam = makeIsoCamera({ angle, scale: fit.scale, ox: fit.ox, oy: fit.oy });

  drawIsoFloor(
    ctx, mesh, state.cornerState, state.dualCells, cam, cssW, cssH,
    { thicknessFrac: THICKNESS_FRAC }
  );
}

// --- interaction: drag horizontally to rotate the floor -------------------
function onPointerDown(ev) {
  dragging = true;
  lastX = ev.clientX;
  canvas.setPointerCapture?.(ev.pointerId);
}
function onPointerMove(ev) {
  if (!dragging) return;
  const dx = ev.clientX - lastX;
  lastX = ev.clientX;
  angle += dx * ROTATE_SPEED;
  // next RAF frame from main.js re-fits + redraws
}
function endDrag() { dragging = false; }

/**
 * Wire up the canvas, resize handling and pointer rotation. Idempotent-safe to
 * call once at boot.
 */
export function initIsoView() {
  canvas = document.getElementById('iso-grid');
  if (!canvas) return;
  ctx = canvas.getContext('2d');

  resize();
  window.addEventListener('resize', resize);

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('pointerleave', endDrag);
  canvas.style.touchAction = 'none'; // let drag-rotate own the gesture
}

/** Re-measure the canvas (called when the 3D tab becomes visible). */
export function resizeIsoView() {
  resize();
}
