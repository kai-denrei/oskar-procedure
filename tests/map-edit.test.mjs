import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cellAt, cellCentroid, cellInradius, cellTopHeight } from '../src/gl/map-edit.js';

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
