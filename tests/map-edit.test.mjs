import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cellAt, cellCentroid, cellInradius, cellTopHeight, bakeIfNeeded } from '../src/gl/map-edit.js';
import { generateMesh, relax } from '../src/grid.js';

function patch(seed) {
  const m = generateMesh({ seeder: 'hex', rings: 3, seed });
  relax(m, { n_iters: 100, pinned: m.boundary });
  return m;
}

// A 2-quad mesh: unit squares side by side. Vertices:
//  3---2---5
//  |   |   |
//  0---1---4
const mesh = {
  vertices: [[0,0],[1,0],[1,1],[0,1],[2,0],[2,1]],
  quads: [[0,1,2,3],[1,4,5,2]],
};

test('cellAt returns the quad index containing a point', () => {
  assert.equal(cellAt(mesh, 0.5, 0.5), 0);
  assert.equal(cellAt(mesh, 1.5, 0.5), 1);
});

test('cellAt returns -1 for a point outside all quads', () => {
  assert.equal(cellAt(mesh, 5, 5), -1);
  assert.equal(cellAt(mesh, -1, 0.5), -1);
});

test('cellCentroid is the mean of the quad corners', () => {
  assert.deepEqual(cellCentroid(mesh, 0), [0.5, 0.5]);
});

test('cellInradius is positive and bounded by the cell size', () => {
  const inr = cellInradius(mesh, 0);
  assert.ok(inr > 0 && inr <= 0.5 + 1e-9, `inradius ${inr}`);
});

test('cellTopHeight = max corner height of the cell', () => {
  const heights = [0, 0, 3, 1, 0, 0]; // per vertex
  assert.equal(cellTopHeight(mesh, 0, heights), 3); // quad 0 = verts 0,1,2,3
});

test('bakeIfNeeded populates heights+objects+epoch and is idempotent', () => {
  const tile = { biomeId: 'forest', seed: 7, edit: null };
  const m = patch(tile.seed);
  const edit = bakeIfNeeded(tile, m);
  assert.equal(edit.heights.length, m.vertices.length, 'one height per vertex');
  assert.ok(edit.heights.every((h) => Number.isInteger(h) && h >= 0), 'int heights >=0');
  assert.ok(Array.isArray(edit.objects), 'objects array');
  assert.equal(edit.epoch, 1, 'epoch starts at 1');
  // idempotent: a second call returns the same object, does not re-bake.
  const again = bakeIfNeeded(tile, m);
  assert.equal(again, edit, 'same edit object reused');
});

test('baked objects carry a cell index (so they can ride terrain)', () => {
  const tile = { biomeId: 'forest', seed: 7, edit: null };
  const m = patch(tile.seed);
  const { objects } = bakeIfNeeded(tile, m);
  for (const o of objects) {
    assert.ok(Number.isInteger(o.cell) && o.cell >= 0, `object cell set (${o.type})`);
  }
});
