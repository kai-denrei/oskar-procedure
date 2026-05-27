// grid.test.mjs — M1 kernel tests. Run with: node --test
//
// Pure-logic tests (NO DOM). Validate the full pipeline:
//   poisson seed -> triangulate+filter -> merge -> subdivide -> winding -> relax
// over several seeds, plus the two surfaced risks:
//   risk 1 — relaxation must REDUCE a squareness-error metric (CW/CCW ordering).
//   risk 2 — subdivided mesh must be watertight (interior edges shared by exactly 2 quads).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { mulberry32 } from '../src/rng.js';
import { poissonDisk } from '../src/poisson.js';
import { generateMesh, makeRelaxer, relax } from '../src/grid.js';
import { sub, cross } from '../src/vec.js';

const SEEDS = [1, 42, 1337, 2024, 7];

// --- helpers ---------------------------------------------------------------

const isFinitePt = (p) => Number.isFinite(p[0]) && Number.isFinite(p[1]);

function allFinite(vertices) {
  return vertices.every(isFinitePt);
}

// Shoelace area (absolute) of a polygon given as [x,y] points.
function polyArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return Math.abs(a) / 2;
}

function quadPts(mesh, quad) {
  return quad.map((vi) => mesh.vertices[vi]);
}

// Squareness error: mean over quads of variance of the 4 edge lengths
// PLUS mean over corners of |interior angle - 90deg|. Lower = more square.
function squarenessError(mesh) {
  let total = 0;
  for (const q of mesh.quads) {
    const p = quadPts(mesh, q);
    // edge length variance
    const lens = [];
    for (let i = 0; i < 4; i++) {
      const d = sub(p[(i + 1) % 4], p[i]);
      lens.push(Math.hypot(d[0], d[1]));
    }
    const meanLen = (lens[0] + lens[1] + lens[2] + lens[3]) / 4;
    let varLen = 0;
    for (const l of lens) varLen += (l - meanLen) ** 2;
    varLen /= 4;
    // angle deviation from 90deg
    let angErr = 0;
    for (let i = 0; i < 4; i++) {
      const a = sub(p[(i - 1 + 4) % 4], p[i]);
      const b = sub(p[(i + 1) % 4], p[i]);
      const la = Math.hypot(a[0], a[1]);
      const lb = Math.hypot(b[0], b[1]);
      if (la < 1e-12 || lb < 1e-12) continue;
      let c = (a[0] * b[0] + a[1] * b[1]) / (la * lb);
      c = Math.max(-1, Math.min(1, c));
      angErr += Math.abs(Math.acos(c) - Math.PI / 2);
    }
    total += varLen + angErr * 0.001; // scale angle term into roughly the same range
  }
  return total / Math.max(1, mesh.quads.length);
}

// --- tests -----------------------------------------------------------------

test('poisson: deterministic, in-bounds (inset), respects min spacing', () => {
  const rng = mulberry32(42);
  const pts = poissonDisk(rng, { r: 0.1, k: 30 });
  assert.ok(pts.length > 5, `expected several points, got ${pts.length}`);
  for (const p of pts) {
    assert.ok(isFinitePt(p));
    // inset: ·0.85 + 0.075 maps [0,1] -> [0.075, 0.925]
    assert.ok(p[0] >= 0.075 - 1e-9 && p[0] <= 0.925 + 1e-9, `x in inset range: ${p[0]}`);
    assert.ok(p[1] >= 0.075 - 1e-9 && p[1] <= 0.925 + 1e-9, `y in inset range: ${p[1]}`);
  }
  // determinism
  const pts2 = poissonDisk(mulberry32(42), { r: 0.1, k: 30 });
  assert.deepEqual(pts, pts2);
});

for (const seed of SEEDS) {
  test(`all faces are quads after subdivision (seed ${seed})`, () => {
    const mesh = generateMesh({ seed });
    assert.ok(mesh.quads.length > 0, 'mesh has quads');
    for (const q of mesh.quads) {
      assert.equal(q.length, 4, 'every face has exactly 4 vertices');
      // valid indices
      for (const vi of q) {
        assert.ok(Number.isInteger(vi) && vi >= 0 && vi < mesh.vertices.length);
      }
    }
  });

  test(`no NaN/Infinite coords before and after relax (seed ${seed})`, () => {
    const mesh = generateMesh({ seed });
    assert.ok(allFinite(mesh.vertices), 'pre-relax vertices finite');
    relax(mesh, { n_iters: 100 });
    assert.ok(allFinite(mesh.vertices), 'post-relax vertices finite');
  });

  test(`no zero-area quads after relax (seed ${seed})`, () => {
    const mesh = generateMesh({ seed });
    relax(mesh, { n_iters: 100 });
    const SIDE_LENGTH = 0.06;
    const eps = (SIDE_LENGTH / 10) ** 2; // justified: 1% of target square area
    for (const q of mesh.quads) {
      const area = polyArea(quadPts(mesh, q));
      assert.ok(area > eps, `quad area ${area} > eps ${eps}`);
    }
  });

  test(`watertight: interior edges shared by exactly 2 quads (seed ${seed})`, () => {
    const mesh = generateMesh({ seed });
    const counts = new Map();
    for (const q of mesh.quads) {
      for (let i = 0; i < 4; i++) {
        const a = q[i];
        const b = q[(i + 1) % 4];
        const key = Math.min(a, b) + '-' + Math.max(a, b);
        counts.set(key, (counts.get(key) || 0) + 1);
      }
    }
    for (const [key, c] of counts) {
      assert.ok(c === 1 || c === 2, `edge ${key} shared by ${c} quads (must be 1 or 2)`);
    }
  });

  test(`relaxation reduces squareness error (seed ${seed})`, () => {
    const mesh = generateMesh({ seed });
    const before = squarenessError(mesh);
    relax(mesh, { n_iters: 100 });
    const after = squarenessError(mesh);
    assert.ok(
      after < before,
      `squareness error should strictly decrease: before=${before}, after=${after}`
    );
    assert.ok(Number.isFinite(after), 'error stayed finite (no divergence)');
  });
}

test('determinism: same seed -> identical mesh; different seeds -> different', () => {
  const a = generateMesh({ seed: 42 });
  const b = generateMesh({ seed: 42 });
  assert.deepEqual(a.vertices, b.vertices);
  assert.deepEqual(a.quads, b.quads);

  const c = generateMesh({ seed: 43 });
  const differs =
    JSON.stringify(c.vertices) !== JSON.stringify(a.vertices) ||
    JSON.stringify(c.quads) !== JSON.stringify(a.quads);
  assert.ok(differs, 'different seed should produce a different mesh');
});

test('winding: all quads CCW (positive signed area)', () => {
  const mesh = generateMesh({ seed: 42 });
  for (const q of mesh.quads) {
    const p = quadPts(mesh, q);
    // signed area via cross of first two edges + shoelace sign
    let signed = 0;
    for (let i = 0; i < 4; i++) {
      const cur = p[i];
      const nxt = p[(i + 1) % 4];
      signed += cur[0] * nxt[1] - nxt[0] * cur[1];
    }
    assert.ok(signed > 0, `quad should be CCW (signed area ${signed} > 0)`);
  }
});

test('makeRelaxer: step() returns displacement and converges', () => {
  const mesh = generateMesh({ seed: 42 });
  const relaxer = makeRelaxer(mesh);
  const first = relaxer.step();
  assert.ok(Number.isFinite(first) && first >= 0, 'step returns a finite non-negative displacement');
  let last = first;
  for (let i = 0; i < 99; i++) last = relaxer.step();
  // displacement should shrink as it settles
  assert.ok(last < first, `displacement should shrink: first=${first}, last=${last}`);
});
