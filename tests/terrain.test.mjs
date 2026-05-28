// terrain.test.mjs — procedural value-noise height field.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { valueNoise2D, generateTerrain } from '../src/structures/terrain.js';

// A deterministic spread-out mesh (no DOM): a grid of [x,y] vertices.
function gridMesh(n, spacing = 0.1) {
  const vertices = [];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) vertices.push([i * spacing, j * spacing]);
  }
  return { vertices };
}

test('valueNoise2D stays in [0,1) and is deterministic', () => {
  for (let i = 0; i < 50; i++) {
    const x = i * 0.37;
    const y = i * 0.91;
    const a = valueNoise2D(x, y, 42);
    const b = valueNoise2D(x, y, 42);
    assert.equal(a, b, 'same input + seed → identical');
    assert.ok(a >= 0 && a < 1, `noise out of range: ${a}`);
  }
});

test('valueNoise2D is smooth (lattice corners are continuous)', () => {
  // Sampling just inside a lattice cell should be close to the corner hash.
  const at = (x, y) => valueNoise2D(x, y, 7);
  const c = at(3, 4);
  const near = at(3.001, 4.001);
  assert.ok(Math.abs(c - near) < 0.05, `expected near-continuity, got ${c} vs ${near}`);
});

test('generateTerrain: one integer height ≥ 0 per vertex', () => {
  const mesh = gridMesh(8);
  const h = generateTerrain(mesh, { seed: 1, amplitude: 5, roughness: 4 });
  assert.equal(h.length, mesh.vertices.length);
  for (const v of h) {
    assert.ok(Number.isInteger(v), `not an integer: ${v}`);
    assert.ok(v >= 0, `negative height: ${v}`);
  }
});

test('generateTerrain is deterministic per seed', () => {
  const mesh = gridMesh(8);
  const a = generateTerrain(mesh, { seed: 99, amplitude: 6, roughness: 5 });
  const b = generateTerrain(mesh, { seed: 99, amplitude: 6, roughness: 5 });
  assert.deepEqual(a, b, 'same seed → identical heights');
});

test('different seeds produce different terrain', () => {
  const mesh = gridMesh(8);
  const a = generateTerrain(mesh, { seed: 1, amplitude: 6, roughness: 5 });
  const b = generateTerrain(mesh, { seed: 2, amplitude: 6, roughness: 5 });
  assert.notDeepEqual(a, b, 'different seed → different heights');
});

test('amplitude bounds heights to [0, amplitude]', () => {
  const mesh = gridMesh(10);
  for (const amplitude of [1, 3, 8]) {
    const h = generateTerrain(mesh, { seed: 7, amplitude, roughness: 6 });
    for (const v of h) {
      assert.ok(v >= 0 && v <= amplitude, `height ${v} out of [0,${amplitude}]`);
    }
  }
});

test('higher roughness → more variation', () => {
  const mesh = gridMesh(12);
  const variety = (rough) => {
    const h = generateTerrain(mesh, { seed: 3, amplitude: 8, roughness: rough });
    return new Set(h).size; // distinct height levels present
  };
  // A near-flat (very low frequency) field has few distinct levels; a rougher
  // (higher frequency) one samples more of the amplitude range.
  const low = variety(1);
  const high = variety(8);
  assert.ok(high > low, `expected more variation at high roughness: low=${low} high=${high}`);
});

test('amplitude 0 yields all-zero (flat) terrain', () => {
  const mesh = gridMesh(6);
  const h = generateTerrain(mesh, { seed: 5, amplitude: 0, roughness: 4 });
  assert.ok(h.every((v) => v === 0), 'amplitude 0 → flat ground');
});

test('empty mesh yields empty heights', () => {
  assert.deepEqual(generateTerrain({ vertices: [] }, { seed: 1, amplitude: 4 }), []);
  assert.deepEqual(generateTerrain(null, {}), []);
});
