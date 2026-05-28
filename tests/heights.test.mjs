// heights.test.mjs — per-vertex height field.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHeights } from '../src/structures/heights.js';

test('defaults to all zero', () => {
  const h = createHeights(5);
  assert.equal(h.size, 5);
  for (let i = 0; i < 5; i++) assert.equal(h.get(i), 0);
  assert.equal(h.max(), 0);
});

test('set / get with integer coercion', () => {
  const h = createHeights(3);
  h.set(0, 2);
  h.set(1, 3.7); // rounds to 4
  assert.equal(h.get(0), 2);
  assert.equal(h.get(1), 4);
  assert.equal(h.get(2), 0);
});

test('set clamps negatives to 0', () => {
  const h = createHeights(2);
  h.set(0, -5);
  assert.equal(h.get(0), 0);
});

test('raise increments (default by 1) and returns new height', () => {
  const h = createHeights(2);
  assert.equal(h.raise(0), 1);
  assert.equal(h.raise(0), 2);
  assert.equal(h.raise(0, 3), 5);
  assert.equal(h.get(0), 5);
});

test('lower decrements and clamps at 0', () => {
  const h = createHeights(2);
  h.set(0, 2);
  assert.equal(h.lower(0), 1);
  assert.equal(h.lower(0), 0);
  assert.equal(h.lower(0), 0); // clamps, does not go negative
});

test('max() returns the tallest column', () => {
  const h = createHeights(4);
  h.set(0, 1);
  h.set(2, 7);
  h.set(3, 3);
  assert.equal(h.max(), 7);
});

test('clear() resets all to 0', () => {
  const h = createHeights(3);
  h.set(0, 4); h.set(1, 2);
  h.clear();
  assert.equal(h.max(), 0);
});

test('forEach visits every index with its height', () => {
  const h = createHeights(3);
  h.set(1, 5);
  const seen = [];
  h.forEach((height, i) => seen.push([i, height]));
  assert.deepEqual(seen, [[0, 0], [1, 5], [2, 0]]);
});

test('out-of-range access is safe', () => {
  const h = createHeights(2);
  assert.equal(h.get(-1), 0);
  assert.equal(h.get(99), 0);
  h.set(-1, 3); // no-op
  h.raise(99);  // no-op
  assert.equal(h.max(), 0);
});
