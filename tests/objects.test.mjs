import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OBJECTS, getObjectDef } from '../src/structures/objects.js';

test('registry has tree/rock/building/water with id+label+make', () => {
  const ids = OBJECTS.map((o) => o.id);
  assert.deepEqual(ids, ['tree', 'rock', 'building', 'water']);
  for (const o of OBJECTS) {
    assert.equal(typeof o.label, 'string');
    assert.equal(typeof o.make, 'function');
  }
});

test('make returns a record tagged with type + cell, sized to inradius', () => {
  const ctx = { x: 1, y: 2, z: 0.3, cell: 4, inr: 0.05 };
  const tree = getObjectDef('tree').make(ctx);
  assert.equal(tree.type, 'tree');
  assert.equal(tree.cell, 4);
  assert.equal(tree.x, 1); assert.equal(tree.y, 2); assert.equal(tree.z, 0.3);
  assert.ok(tree.canopyRadius > 0 && tree.canopyRadius <= ctx.inr + 1e-9);
  const water = getObjectDef('water').make(ctx);
  assert.equal(water.type, 'water');
  assert.equal(water.quadIndex, 4, 'water covers its cell');
});

test('make is deterministic (same ctx → equal record)', () => {
  const ctx = { x: 0, y: 0, z: 0, cell: 1, inr: 0.04 };
  assert.deepEqual(getObjectDef('rock').make(ctx), getObjectDef('rock').make(ctx));
});

test('getObjectDef returns null for unknown id', () => {
  assert.equal(getObjectDef('nope'), null);
});
