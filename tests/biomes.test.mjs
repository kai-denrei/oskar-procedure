// biomes.test.mjs — six terrain biomes (shape generators + lookup).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BIOMES, getBiome } from '../src/structures/biomes.js';

// A deterministic spread-out grid mesh (no DOM): n×n [x,y] vertices.
function gridMesh(n, spacing = 0.1) {
  const vertices = [];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) vertices.push([i * spacing, j * spacing]);
  }
  return { vertices };
}

const PARAMS = { seed: 99, amplitude: 6, roughness: 5 };

test('registry: six biomes with the expected ids + shape', () => {
  const ids = BIOMES.map((b) => b.id);
  assert.deepEqual(ids, ['dunes', 'mountains', 'forest', 'meadows', 'swamps', 'quarry']);
  for (const b of BIOMES) {
    assert.equal(typeof b.label, 'string');
    assert.equal(typeof b.generate, 'function');
    assert.equal(typeof b.colorize, 'function');
  }
});

test('getBiome looks up by id and falls back to dunes', () => {
  assert.equal(getBiome('mountains').id, 'mountains');
  assert.equal(getBiome('nope').id, 'dunes');
  assert.equal(getBiome(undefined).id, 'dunes');
});

test('every generator: non-negative integer heights, one per vertex, deterministic', () => {
  const mesh = gridMesh(10);
  for (const b of BIOMES) {
    const a = b.generate(mesh, PARAMS);
    const c = b.generate(mesh, PARAMS);
    assert.equal(a.length, mesh.vertices.length, `${b.id}: one height per vertex`);
    assert.deepEqual(a, c, `${b.id}: deterministic per seed`);
    for (const v of a) {
      assert.ok(Number.isInteger(v), `${b.id}: non-integer height ${v}`);
      assert.ok(v >= 0, `${b.id}: negative height ${v}`);
      assert.ok(Number.isFinite(v), `${b.id}: NaN/Inf height`);
    }
  }
});

test('amplitude bounds: heights stay within [0, amplitude] for every biome', () => {
  const mesh = gridMesh(12);
  for (const amplitude of [1, 3, 8]) {
    for (const b of BIOMES) {
      const h = b.generate(mesh, { seed: 7, amplitude, roughness: 6 });
      for (const v of h) {
        assert.ok(v >= 0 && v <= amplitude, `${b.id}@amp${amplitude}: height ${v} out of bounds`);
      }
    }
  }
});

test('quarry: high baseline at the rim, pit floor at 0 (concave, all ≥ 0)', () => {
  const mesh = gridMesh(13);
  const amplitude = 6;
  const h = getBiome('quarry').generate(mesh, { seed: 1, amplitude, roughness: 4 });
  // The rim (corners) should reach the plateau height (== amplitude); the
  // center should be the deepest (near 0).
  const max = Math.max(...h);
  const min = Math.min(...h);
  assert.equal(min, 0, 'pit bottom dug to ground (0)');
  assert.equal(max, amplitude, 'rim sits at the plateau (amplitude)');
  // Center cell should be lower than the rim (concave).
  const n = 13;
  const centerIdx = Math.floor(n / 2) * n + Math.floor(n / 2);
  const cornerIdx = 0;
  assert.ok(h[centerIdx] < h[cornerIdx], 'center is lower than a corner (pit)');
});

test('meadows: heavily damped — heights capped at ≤ 2 regardless of amplitude', () => {
  const mesh = gridMesh(12);
  const h = getBiome('meadows').generate(mesh, { seed: 3, amplitude: 8, roughness: 5 });
  for (const v of h) assert.ok(v <= 2, `meadow height ${v} exceeds cap`);
});

test('swamps: nearly flat — the vast majority of cells are 0', () => {
  const mesh = gridMesh(14);
  const h = getBiome('swamps').generate(mesh, { seed: 3, amplitude: 8, roughness: 5 });
  const zeros = h.filter((v) => v === 0).length;
  assert.ok(zeros / h.length > 0.7, `expected mostly flat, got ${zeros}/${h.length} zeros`);
});

test('biomes produce visibly different terrain for the same seed/params', () => {
  const mesh = gridMesh(14);
  const fields = BIOMES.map((b) => b.generate(mesh, PARAMS));
  // Each pair of biomes differs on a meaningful fraction of vertices.
  for (let i = 0; i < fields.length; i++) {
    for (let j = i + 1; j < fields.length; j++) {
      let diff = 0;
      for (let k = 0; k < fields[i].length; k++) {
        if (fields[i][k] !== fields[j][k]) diff++;
      }
      const frac = diff / fields[i].length;
      assert.ok(
        frac > 0.1,
        `${BIOMES[i].id} vs ${BIOMES[j].id} differ on only ${(frac * 100).toFixed(0)}% of vertices`
      );
    }
  }
});

test('higher roughness → more height variety for noise biomes', () => {
  const mesh = gridMesh(14);
  for (const id of ['mountains', 'forest']) {
    const variety = (rough) =>
      new Set(getBiome(id).generate(mesh, { seed: 3, amplitude: 8, roughness: rough })).size;
    assert.ok(variety(8) >= variety(1), `${id}: expected ≥ variety at higher roughness`);
  }
});

test('amplitude 0 yields all-zero (flat) for shape biomes', () => {
  const mesh = gridMesh(8);
  // dunes/mountains/forest/meadows/swamps all collapse to flat at amp 0.
  for (const id of ['dunes', 'mountains', 'forest', 'meadows', 'swamps']) {
    const h = getBiome(id).generate(mesh, { seed: 5, amplitude: 0, roughness: 4 });
    assert.ok(h.every((v) => v === 0), `${id}: amplitude 0 should be flat`);
  }
});

test('colorize returns finite rgb in [0,1] for every biome', () => {
  for (const b of BIOMES) {
    for (const height of [0, 1, 3, 6]) {
      const c = b.colorize({ height, amplitude: 6, vertexIndex: 0, worldXY: [0.3, 0.4] });
      assert.equal(c.length, 3, `${b.id}: rgb triple`);
      for (const ch of c) {
        assert.ok(Number.isFinite(ch), `${b.id}: non-finite color channel`);
        assert.ok(ch >= 0 && ch <= 1.001, `${b.id}: color channel ${ch} out of [0,1]`);
      }
    }
  }
});

test('empty / null mesh yields empty heights for every biome', () => {
  for (const b of BIOMES) {
    assert.deepEqual(b.generate({ vertices: [] }, PARAMS), []);
    assert.deepEqual(b.generate(null, PARAMS), []);
  }
});
