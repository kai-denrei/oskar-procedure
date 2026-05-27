// hex.test.mjs — H1 hexagon-seed tests. Run with: node --test
//
// Two layers (all pure logic, NO DOM):
//   1. hexLattice geometry — point counts, boundary size, nearest-neighbour dist.
//   2. the full pipeline routed through the hex seeder — the same invariants the
//      Poisson suite (grid.test.mjs) checks, parametrized by seeder='hex':
//        all-quad, watertight, no NaN/Infinite (pre+post relax), no zero-area
//        quads post-relax, determinism, relaxation reduces squareness error.
//
// The existing Poisson regression suite lives in grid.test.mjs and stays green.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { hexLattice, hexDistance } from '../src/hex.js';
import { generateMesh, relax } from '../src/grid.js';
import { sub, dist } from '../src/vec.js';

const RINGS = [2, 3, 4];
const SEEDS = [1, 42, 1337];

// --- shared helpers (mirror grid.test.mjs) --------------------------------

const isFinitePt = (p) => Number.isFinite(p[0]) && Number.isFinite(p[1]);
const allFinite = (vertices) => vertices.every(isFinitePt);

function polyArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return Math.abs(a) / 2;
}

const quadPts = (mesh, quad) => quad.map((vi) => mesh.vertices[vi]);

// Squareness error: mean over quads of edge-length variance + angle deviation.
// (Identical metric to grid.test.mjs so the "relax reduces it" claim is the same.)
function squarenessError(mesh) {
  let total = 0;
  for (const q of mesh.quads) {
    const p = quadPts(mesh, q);
    const lens = [];
    for (let i = 0; i < 4; i++) {
      const d = sub(p[(i + 1) % 4], p[i]);
      lens.push(Math.hypot(d[0], d[1]));
    }
    const meanLen = (lens[0] + lens[1] + lens[2] + lens[3]) / 4;
    let varLen = 0;
    for (const l of lens) varLen += (l - meanLen) ** 2;
    varLen /= 4;
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
    total += varLen + angErr * 0.001;
  }
  return total / Math.max(1, mesh.quads.length);
}

// --- layer 1: hexLattice geometry -----------------------------------------

for (const R of RINGS) {
  test(`hexLattice: point count == 1 + 3R(R+1) (rings ${R})`, () => {
    const { points } = hexLattice({ rings: R, spacing: 0.1 });
    const expected = 1 + 3 * R * (R + 1);
    assert.equal(points.length, expected, `rings=${R} -> ${expected} points`);
    for (const p of points) assert.ok(isFinitePt(p), 'finite point');
  });

  test(`hexLattice: boundary size == 6R (rings ${R})`, () => {
    const { points, boundary } = hexLattice({ rings: R, spacing: 0.1 });
    assert.equal(boundary.length, 6 * R, `rings=${R} -> ${6 * R} boundary nodes`);
    // boundary indices are valid + unique
    const set = new Set(boundary);
    assert.equal(set.size, boundary.length, 'boundary indices unique');
    for (const idx of boundary) {
      assert.ok(idx >= 0 && idx < points.length, 'index in range');
    }
  });

  test(`hexLattice: nearest-neighbour distance ≈ spacing (rings ${R})`, () => {
    const spacing = 0.1;
    const { points } = hexLattice({ rings: R, spacing });
    // brute-force nearest neighbour for each point (small lattices)
    for (let i = 0; i < points.length; i++) {
      let nn = Infinity;
      for (let j = 0; j < points.length; j++) {
        if (i === j) continue;
        const d = dist(points[i], points[j]);
        if (d < nn) nn = d;
      }
      assert.ok(
        Math.abs(nn - spacing) < 1e-9,
        `point ${i}: nearest-neighbour ${nn} ≈ ${spacing}`
      );
    }
  });
}

test('hexLattice: explicit small cases (rings 1→7, 2→19, 3→37, 4→61)', () => {
  assert.equal(hexLattice({ rings: 1 }).points.length, 7);
  assert.equal(hexLattice({ rings: 2 }).points.length, 19);
  assert.equal(hexLattice({ rings: 3 }).points.length, 37);
  assert.equal(hexLattice({ rings: 4 }).points.length, 61);
});

test('hexLattice: center offset translates every point', () => {
  const a = hexLattice({ rings: 3, spacing: 0.1, center: [0, 0] });
  const b = hexLattice({ rings: 3, spacing: 0.1, center: [1, 2] });
  assert.equal(a.points.length, b.points.length);
  for (let i = 0; i < a.points.length; i++) {
    assert.ok(Math.abs(b.points[i][0] - (a.points[i][0] + 1)) < 1e-12);
    assert.ok(Math.abs(b.points[i][1] - (a.points[i][1] + 2)) < 1e-12);
  }
});

test('hexLattice: rejects rings < 1', () => {
  assert.throws(() => hexLattice({ rings: 0 }));
  assert.throws(() => hexLattice({}));
});

test('hexDistance: cube-Chebyshev distance', () => {
  assert.equal(hexDistance(0, 0), 0);
  assert.equal(hexDistance(1, 0), 1);
  assert.equal(hexDistance(0, 1), 1);
  assert.equal(hexDistance(1, -1), 1); // q+r == 0, |q|==1
  assert.equal(hexDistance(2, -1), 2);
  assert.equal(hexDistance(-2, -2), 4); // |q+r| == 4
});

// --- layer 2: pipeline invariants over the hex seeder ----------------------

for (const rings of RINGS) {
  test(`hex pipeline: all faces are quads (rings ${rings})`, () => {
    const mesh = generateMesh({ seeder: 'hex', rings, seed: 1 });
    assert.equal(mesh.seeder, 'hex');
    assert.ok(mesh.quads.length > 0, 'mesh has quads');
    for (const q of mesh.quads) {
      assert.equal(q.length, 4, 'every face has exactly 4 vertices');
      for (const vi of q) {
        assert.ok(Number.isInteger(vi) && vi >= 0 && vi < mesh.vertices.length);
      }
    }
  });

  test(`hex pipeline: watertight — interior edges shared by exactly 2 quads (rings ${rings})`, () => {
    const mesh = generateMesh({ seeder: 'hex', rings, seed: 1 });
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

  test(`hex pipeline: no NaN/Infinite coords before and after relax (rings ${rings})`, () => {
    const mesh = generateMesh({ seeder: 'hex', rings, seed: 1 });
    assert.ok(allFinite(mesh.vertices), 'pre-relax vertices finite');
    relax(mesh, { n_iters: 100 });
    assert.ok(allFinite(mesh.vertices), 'post-relax vertices finite');
  });

  test(`hex pipeline: no zero-area quads after relax (rings ${rings})`, () => {
    const mesh = generateMesh({ seeder: 'hex', rings, seed: 1 });
    relax(mesh, { n_iters: 100 });
    const SIDE_LENGTH = 0.06;
    const eps = (SIDE_LENGTH / 10) ** 2;
    for (const q of mesh.quads) {
      const area = polyArea(quadPts(mesh, q));
      assert.ok(area > eps, `quad area ${area} > eps ${eps}`);
    }
  });

  test(`hex pipeline: relaxation reduces squareness error (rings ${rings})`, () => {
    const mesh = generateMesh({ seeder: 'hex', rings, seed: 1 });
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

test('hex pipeline: determinism — same seed+rings identical; different differ', () => {
  for (const seed of SEEDS) {
    const a = generateMesh({ seeder: 'hex', rings: 4, seed });
    const b = generateMesh({ seeder: 'hex', rings: 4, seed });
    assert.deepEqual(a.vertices, b.vertices, `seed ${seed} vertices reproducible`);
    assert.deepEqual(a.quads, b.quads, `seed ${seed} quads reproducible`);
  }

  // different seed -> different mesh (the random dissolve diverges)
  const a = generateMesh({ seeder: 'hex', rings: 4, seed: 1 });
  const b = generateMesh({ seeder: 'hex', rings: 4, seed: 2 });
  const differs =
    JSON.stringify(a.vertices) !== JSON.stringify(b.vertices) ||
    JSON.stringify(a.quads) !== JSON.stringify(b.quads);
  assert.ok(differs, 'different seed should produce a different mesh');

  // different rings -> different mesh
  const c = generateMesh({ seeder: 'hex', rings: 3, seed: 1 });
  assert.notEqual(a.vertices.length, c.vertices.length, 'different rings -> different size');
});

test('hex pipeline: winding — all quads CCW (positive signed area)', () => {
  const mesh = generateMesh({ seeder: 'hex', rings: 4, seed: 1 });
  for (const q of mesh.quads) {
    const p = quadPts(mesh, q);
    let signed = 0;
    for (let i = 0; i < 4; i++) {
      const cur = p[i];
      const nxt = p[(i + 1) % 4];
      signed += cur[0] * nxt[1] - nxt[0] * cur[1];
    }
    assert.ok(signed > 0, `quad should be CCW (signed area ${signed} > 0)`);
  }
});
