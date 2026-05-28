// iso.test.mjs — tests for the isometric projection (src/iso.js). Pure math,
// no DOM. Run with: node --test (alongside the other suites).
//
// Covers:
//   - project: origin → (ox,oy); unit +x / +y produce the expected iso offsets
//     at angle 0; z lifts sy UPWARD (negative screen-y); rotating by 2π is
//     ≈ identity (rotation consistency).
//   - depth: monotonic — larger ground-depth / lower z sorts nearer-front.
//   - fitIso: returned scale/offset maps the points' projected bbox inside
//     [0,cssW]×[0,cssH] respecting the margin.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makeIsoCamera, fitIso, ISO } from '../src/iso.js';

const cos30 = Math.cos(ISO);
const sin30 = Math.sin(ISO);
const approx = (a, b, eps = 1e-9) =>
  assert.ok(Math.abs(a - b) <= eps, `expected ${a} ≈ ${b} (Δ=${Math.abs(a - b)})`);

test('project: origin maps to the camera origin (ox,oy)', () => {
  const cam = makeIsoCamera({ angle: 0.37, scale: 3.2, ox: 100, oy: 50 });
  const [sx, sy] = cam.project([0, 0, 0]);
  approx(sx, 100);
  approx(sy, 50);
});

test('project: unit +x and +y give expected iso offsets at angle 0', () => {
  const cam = makeIsoCamera({ angle: 0, scale: 1, ox: 0, oy: 0 });
  // +x at angle 0: rx=1, ry=0 → sx=(1-0)cos30, sy=(1+0)sin30
  const [px, py] = cam.project([1, 0, 0]);
  approx(px, cos30);
  approx(py, sin30);
  // +y at angle 0: rx=0, ry=1 → sx=(0-1)cos30, sy=(0+1)sin30
  const [qx, qy] = cam.project([0, 1, 0]);
  approx(qx, -cos30);
  approx(qy, sin30);
});

test('project: scale + origin apply after the iso transform', () => {
  const cam = makeIsoCamera({ angle: 0, scale: 10, ox: 7, oy: -3 });
  const [px, py] = cam.project([1, 0, 0]);
  approx(px, 7 + cos30 * 10);
  approx(py, -3 + sin30 * 10);
});

test('project: z lifts sy UPWARD (negative screen-y direction)', () => {
  const cam = makeIsoCamera({ angle: 0.9, scale: 4, ox: 0, oy: 0 });
  const ground = cam.project([0.3, 0.7, 0]);
  const lifted = cam.project([0.3, 0.7, 1]); // +1 height
  // larger z → smaller sy (up the screen). Difference is exactly z*scale.
  approx(lifted[1], ground[1] - 1 * 4);
  approx(lifted[0], ground[0]); // z does not affect sx
});

test('project: rotating by 2π is ≈ identity (rotation consistency)', () => {
  const base = makeIsoCamera({ angle: 0.4, scale: 2, ox: 5, oy: 9 });
  const spun = makeIsoCamera({ angle: 0.4 + 2 * Math.PI, scale: 2, ox: 5, oy: 9 });
  const pts = [[0.1, 0.2, 0], [-0.5, 0.9, 0.3], [1.0, -0.4, 0]];
  for (const p of pts) {
    const a = base.project(p);
    const b = spun.project(p);
    approx(a[0], b[0], 1e-7);
    approx(a[1], b[1], 1e-7);
  }
});

test('project: rotating by π/2 swaps +x and +y projections (consistency)', () => {
  const cam0 = makeIsoCamera({ angle: 0, scale: 1, ox: 0, oy: 0 });
  const cam90 = makeIsoCamera({ angle: Math.PI / 2, scale: 1, ox: 0, oy: 0 });
  // +x at 90° yaw lands where +y was at 0° (rx,ry rotate the ground plane).
  const xAt90 = cam90.project([1, 0, 0]);
  const yAt0 = cam0.project([0, 1, 0]);
  approx(xAt90[0], yAt0[0], 1e-9);
  approx(xAt90[1], yAt0[1], 1e-9);
});

test('depth: monotonic — larger ground-depth sorts nearer-front', () => {
  const cam = makeIsoCamera({ angle: 0, scale: 1, ox: 0, oy: 0 });
  // angle 0: depth = x*0 + y*1 - z = y - z. Larger y → nearer front.
  assert.ok(cam.depth([0, 1, 0]) > cam.depth([0, 0, 0]));
  assert.ok(cam.depth([0, 2, 0]) > cam.depth([0, 1, 0]));
});

test('depth: lower z (deeper down) sorts nearer-front than higher z', () => {
  const cam = makeIsoCamera({ angle: 0.6, scale: 1, ox: 0, oy: 0 });
  const high = cam.depth([0.2, 0.3, 1]);   // up high
  const low = cam.depth([0.2, 0.3, -1]);   // down low
  assert.ok(low > high, 'lower z should read as nearer the viewer (larger depth)');
});

test('depth: ordering is independent of scale and origin', () => {
  const a = makeIsoCamera({ angle: 1.1, scale: 1, ox: 0, oy: 0 });
  const b = makeIsoCamera({ angle: 1.1, scale: 50, ox: 999, oy: -333 });
  const p = [0.4, -0.2, 0.1], q = [0.9, 0.5, 0];
  assert.equal(Math.sign(a.depth(p) - a.depth(q)), Math.sign(b.depth(p) - b.depth(q)));
});

test('fitIso: projected bbox lands inside the canvas respecting margin', () => {
  const cssW = 800, cssH = 600, margin = 0.1;
  const pts = [];
  // a small grid of ground points + a couple of lifted ones
  for (let x = 0; x <= 1; x += 0.25)
    for (let y = 0; y <= 1; y += 0.25) pts.push([x, y, 0]);
  pts.push([0.5, 0.5, 0.5], [0, 0, -0.06]);

  const angle = 0.42;
  const fit = fitIso(pts, { angle }, cssW, cssH, margin);
  const cam = makeIsoCamera({ angle, scale: fit.scale, ox: fit.ox, oy: fit.oy });

  const pad = Math.min(cssW, cssH) * margin;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    const [sx, sy] = cam.project(p);
    minX = Math.min(minX, sx); maxX = Math.max(maxX, sx);
    minY = Math.min(minY, sy); maxY = Math.max(maxY, sy);
  }
  // inside the canvas, with at least `pad` clearance from each edge
  assert.ok(minX >= pad - 1e-6, `minX ${minX} >= pad ${pad}`);
  assert.ok(minY >= pad - 1e-6, `minY ${minY} >= pad ${pad}`);
  assert.ok(maxX <= cssW - pad + 1e-6, `maxX ${maxX} <= ${cssW - pad}`);
  assert.ok(maxY <= cssH - pad + 1e-6, `maxY ${maxY} <= ${cssH - pad}`);
});

test('fitIso: scale > 0 and centers the bbox on the canvas midpoint', () => {
  const cssW = 400, cssH = 400;
  const pts = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0]];
  const angle = 0;
  const fit = fitIso(pts, { angle }, cssW, cssH, 0.1);
  assert.ok(fit.scale > 0);
  const cam = makeIsoCamera({ angle, scale: fit.scale, ox: fit.ox, oy: fit.oy });
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    const [sx, sy] = cam.project(p);
    minX = Math.min(minX, sx); maxX = Math.max(maxX, sx);
    minY = Math.min(minY, sy); maxY = Math.max(maxY, sy);
  }
  approx((minX + maxX) / 2, cssW / 2, 1e-6);
  approx((minY + maxY) / 2, cssH / 2, 1e-6);
});

test('fitIso: empty point set returns a sane centered fallback', () => {
  const fit = fitIso([], { angle: 0 }, 300, 200, 0.1);
  approx(fit.ox, 150);
  approx(fit.oy, 100);
  assert.ok(fit.scale > 0);
});
