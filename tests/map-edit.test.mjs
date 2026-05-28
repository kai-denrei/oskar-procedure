import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cellAt, cellCentroid, cellInradius, cellTopHeight, bakeIfNeeded, sculpt, buildFocusGeometry, FLOOR_H, placeObject } from '../src/gl/map-edit.js';
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

test('sculpt raises a cell\'s 4 corners to a flat block, clamped to maxHeight', () => {
  // mesh quad 0 = verts [0,1,2,3]
  const tile = { edit: { heights: [0,0,0,0,0,0], objects: [], epoch: 1 } };
  sculpt(tile, 0, +1, 3, mesh);              // raise
  assert.deepEqual(tile.edit.heights.slice(0,4), [1,1,1,1]);
  assert.equal(tile.edit.epoch, 2, 'epoch bumped');
  // raise to the cap and no further
  sculpt(tile, 0, +1, 3, mesh);
  sculpt(tile, 0, +1, 3, mesh);
  sculpt(tile, 0, +1, 3, mesh);              // would be 4, clamps at 3
  assert.deepEqual(tile.edit.heights.slice(0,4), [3,3,3,3]);
});

test('sculpt lowers to a flat block, clamped at 0', () => {
  const tile = { edit: { heights: [2,2,3,1,0,0], objects: [], epoch: 1 } };
  sculpt(tile, 0, -1, 7, mesh);              // top=max(2,2,3,1)=3 → 2, flatten
  assert.deepEqual(tile.edit.heights.slice(0,4), [2,2,2,2]);
  // lower repeatedly never goes below 0
  for (let i=0;i<5;i++) sculpt(tile, 0, -1, 7, mesh);
  assert.deepEqual(tile.edit.heights.slice(0,4), [0,0,0,0]);
});

test('baked objects carry a cell index (so they can ride terrain)', () => {
  const tile = { biomeId: 'forest', seed: 7, edit: null };
  const m = patch(tile.seed);
  const { objects } = bakeIfNeeded(tile, m);
  for (const o of objects) {
    assert.ok(Number.isInteger(o.cell) && o.cell >= 0, `object cell set (${o.type})`);
  }
});

test('buildFocusGeometry returns non-empty, finite geometry for an edited tile', () => {
  const tile = { biomeId: 'meadows', seed: 7, edit: null };
  const m = patch(tile.seed);
  bakeIfNeeded(tile, m);
  sculpt(tile, 0, +1, tile.editMax || 7, m); // raise a cell so a column exists
  const g = buildFocusGeometry(tile, m);
  assert.ok(g.triangleCount > 0, 'has triangles');
  assert.ok(g.positions.every(Number.isFinite), 'finite positions');
  assert.ok(g.normals.every(Number.isFinite), 'finite normals');
});

test('objects ride terrain: an object z follows its cell top after sculpt', () => {
  const tile = { biomeId: 'forest', seed: 7, edit: null };
  const m = patch(tile.seed);
  const edit = bakeIfNeeded(tile, m);
  // force one tree object on cell 0 at z=0, and reset cell 0 heights to 0
  // so that sculpt +1 brings cell 0 to exactly height 1 (plan: "cell 0 now height 1")
  for (const vi of m.quads[0]) edit.heights[vi] = 0;
  edit.objects = [{ type: 'tree', cell: 0, x: cellCentroid(m,0)[0], y: cellCentroid(m,0)[1], z: 0,
                    trunkRadius: 0.005, trunkHeight: 0.02, canopyRadius: 0.02, canopyHeight: 0.04 }];
  sculpt(tile, 0, +1, 7, m);          // cell 0 now height 1
  buildFocusGeometry(tile, m);         // refreshes object z in place
  assert.equal(edit.objects[0].z, 1 * FLOOR_H, 'tree z lifted to cell top');
});

// Task 14: placeObject
test('placeObject appends a record at the picked cell with z = cell top', () => {
  const tile = { biomeId: 'meadows', seed: 7, edit: { heights: [0,0,0,0,0,0], objects: [], epoch: 1 } };
  const m = patch(7);
  const n0 = tile.edit.objects.length;
  const [cx, cy] = cellCentroid(m, 0);
  const ok = placeObject(tile, 'tree', m, [cx, cy]);
  assert.equal(ok, true);
  assert.equal(tile.edit.objects.length, n0 + 1);
  const obj = tile.edit.objects[tile.edit.objects.length - 1];
  assert.equal(obj.type, 'tree');
  assert.equal(obj.cell, 0);
  assert.equal(obj.z, 0); // cell 0 at height 0 → z 0
  assert.equal(tile.edit.epoch, 2);
});

test('placeObject returns false off-cell (no append)', () => {
  const tile = { biomeId: 'meadows', seed: 7, edit: { heights: [0,0,0,0,0,0], objects: [], epoch: 1 } };
  const m = patch(7);
  const ok = placeObject(tile, 'tree', m, [999, 999]);
  assert.equal(ok, false);
  assert.equal(tile.edit.objects.length, 0);
});
