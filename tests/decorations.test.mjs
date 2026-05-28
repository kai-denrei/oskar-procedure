// decorations.test.mjs — per-biome low-poly decoration placement (pure).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateDecorations } from '../src/structures/decorations.js';
import { createHeights } from '../src/structures/heights.js';

// A grid of unit quads: (cols × rows) cells. Vertices are a (cols+1)×(rows+1)
// lattice; each quad is CCW. Gives a clean, countable set of cells.
function quadGrid(cols, rows, spacing = 1) {
  const vertices = [];
  const vidx = (i, j) => j * (cols + 1) + i;
  for (let j = 0; j <= rows; j++) {
    for (let i = 0; i <= cols; i++) vertices.push([i * spacing, j * spacing]);
  }
  const quads = [];
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      quads.push([vidx(i, j), vidx(i + 1, j), vidx(i + 1, j + 1), vidx(i, j + 1)]);
    }
  }
  return { vertices, quads };
}

function allFinite(decs) {
  for (const d of decs) {
    for (const k of Object.keys(d)) {
      const v = d[k];
      if (typeof v === 'number' && !Number.isFinite(v)) return false;
      if (Array.isArray(v)) for (const c of v) if (typeof c === 'number' && !Number.isFinite(c)) return false;
    }
  }
  return true;
}

function makeArgs(biome, seed = 1) {
  const mesh = quadGrid(20, 20); // 400 cells
  const heights = createHeights(mesh.vertices.length);
  return { biome, mesh, heights, seed, floorH: 0.06 };
}

test('deterministic per seed (same seed → identical decorations)', () => {
  for (const biome of ['forest', 'meadows', 'swamps']) {
    const a = generateDecorations(makeArgs(biome, 42));
    const b = generateDecorations(makeArgs(biome, 42));
    assert.deepEqual(a, b, `${biome}: deterministic per seed`);
  }
});

test('different seeds → different placement (forest)', () => {
  const a = generateDecorations(makeArgs('forest', 1));
  const b = generateDecorations(makeArgs('forest', 2));
  assert.notDeepEqual(a, b, 'forest: different seed → different trees');
});

test('mountains / dunes / quarry → no decorations', () => {
  for (const biome of ['mountains', 'dunes', 'quarry']) {
    const decs = generateDecorations(makeArgs(biome));
    assert.equal(decs.length, 0, `${biome}: expected no decorations`);
  }
});

test('forest: ~40% of cells have a tree', () => {
  const mesh = quadGrid(20, 20); // 400 cells
  const heights = createHeights(mesh.vertices.length);
  const decs = generateDecorations({ biome: 'forest', mesh, heights, seed: 7, floorH: 0.06 });
  const trees = decs.filter((d) => d.type === 'tree');
  const frac = trees.length / mesh.quads.length;
  assert.ok(frac > 0.30 && frac < 0.50, `forest tree fraction ${frac.toFixed(2)} not ~0.40`);
  // Each tree has trunk + canopy geometry params, finite.
  for (const t of trees) {
    assert.ok(t.trunkHeight > 0 && t.canopyHeight > 0, 'tree has positive heights');
  }
  assert.ok(allFinite(decs), 'no NaN in forest decorations');
});

test('meadows: most cells have ≥ 1 flower', () => {
  const mesh = quadGrid(20, 20);
  const heights = createHeights(mesh.vertices.length);
  const decs = generateDecorations({ biome: 'meadows', mesh, heights, seed: 7, floorH: 0.06 });
  // Count distinct cells that produced at least one flower.
  const flowers = decs.filter((d) => d.type === 'flower');
  // 1–3 flowers per cell, so flower count should exceed the cell count.
  assert.ok(flowers.length >= mesh.quads.length, `expected ≥ 1 flower per cell, got ${flowers.length} for ${mesh.quads.length} cells`);
  // Rare ponds present but uncommon (< 10% of cells).
  const ponds = decs.filter((d) => d.type === 'pond');
  assert.ok(ponds.length < mesh.quads.length * 0.10, `too many ponds: ${ponds.length}`);
  assert.ok(allFinite(decs), 'no NaN in meadow decorations');
});

test('swamps: water on every cell + rare reeds', () => {
  const mesh = quadGrid(20, 20);
  const heights = createHeights(mesh.vertices.length);
  const decs = generateDecorations({ biome: 'swamps', mesh, heights, seed: 7, floorH: 0.06 });
  const water = decs.filter((d) => d.type === 'water');
  assert.equal(water.length, mesh.quads.length, 'water plane on every cell');
  const reeds = decs.filter((d) => d.type === 'reed');
  assert.ok(reeds.length > 0, 'some reeds present');
  // Reeds are rare clusters, so fewer reed-instances than cells.
  assert.ok(reeds.length < mesh.quads.length, 'reeds are a rare cluster, not on every cell');
  assert.ok(allFinite(decs), 'no NaN in swamp decorations');
});

test('decorations ride the terrain top (z reflects cell height) for forest trees', () => {
  const mesh = quadGrid(6, 6);
  const heights = createHeights(mesh.vertices.length);
  // Raise every vertex to 3 floors so all cell tops are at 3*floorH.
  for (let i = 0; i < mesh.vertices.length; i++) heights.set(i, 3);
  const decs = generateDecorations({ biome: 'forest', mesh, heights, seed: 7, floorH: 0.06 });
  const trees = decs.filter((d) => d.type === 'tree');
  for (const t of trees) {
    assert.ok(Math.abs(t.z - 3 * 0.06) < 1e-9, `tree z should be at cell top, got ${t.z}`);
  }
});

test('empty / missing mesh yields no decorations', () => {
  assert.deepEqual(generateDecorations({ biome: 'forest', mesh: { vertices: [], quads: [] } }), []);
  assert.deepEqual(generateDecorations({ biome: 'forest' }), []);
  assert.deepEqual(generateDecorations({}), []);
});
