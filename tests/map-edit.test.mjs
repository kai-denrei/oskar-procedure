import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cellAt } from '../src/gl/map-edit.js';

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
