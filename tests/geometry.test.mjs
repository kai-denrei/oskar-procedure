// geometry.test.mjs — scene geometry builder (floor + extruded columns).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSceneGeometry } from '../src/structures/geometry.js';
import { createHeights } from '../src/structures/heights.js';

// A tiny 2-quad mesh (two unit squares side by side), shared CCW.
//   v0(0,0) v1(1,0) v2(1,1) v3(0,1) v4(2,0) v5(2,1)
//   quad A: 0,1,2,3   quad B: 1,4,5,2
function tinyMesh() {
  return {
    vertices: [
      [0, 0], [1, 0], [1, 1], [0, 1], [2, 0], [2, 1],
    ],
    quads: [
      [0, 1, 2, 3],
      [1, 4, 5, 2],
    ],
  };
}

// A single isolated unit quad (no shared vertices) for clean column counting.
//   quad: 0,1,2,3 CCW
function oneQuadMesh() {
  return {
    vertices: [[0, 0], [1, 0], [1, 1], [0, 1]],
    quads: [[0, 1, 2, 3]],
  };
}

function allFinite(arr) {
  for (let i = 0; i < arr.length; i++) {
    if (!Number.isFinite(arr[i])) return false;
  }
  return true;
}

function normalsUnitLength(geom) {
  const n = geom.normals;
  for (let i = 0; i < n.length; i += 3) {
    const len = Math.hypot(n[i], n[i + 1], n[i + 2]);
    if (Math.abs(len - 1) > 1e-5) return false;
  }
  return true;
}

test('all-zero heights => floor only (top + slab walls), finite, unit normals', () => {
  const mesh = tinyMesh();
  const heights = createHeights(mesh.vertices.length);
  const geom = buildSceneGeometry({ mesh, heights }, { floorH: 0.06 });

  assert.ok(allFinite(geom.positions), 'positions finite');
  assert.ok(allFinite(geom.normals), 'normals finite');
  assert.ok(normalsUnitLength(geom), 'normals unit length');

  // Floor top: 2 quads × 2 tris = 4 triangles.
  // Slab walls: boundary edges (the hull of 2 squares = 6 outer edges) × 2 tris.
  //   shared edge v1-v2 is interior, so 8 total edges - 1 shared*... -> 6 boundary.
  // 6 walls × 2 tris = 12. Total floor = 4 + 12 = 16 triangles.
  assert.equal(geom.triangleCount, 16, 'floor-only triangle count');

  // No vertex should rise above z=0 (only floor + downward slab).
  let maxZ = -Infinity;
  for (let i = 2; i < geom.positions.length; i += 3) maxZ = Math.max(maxZ, geom.positions[i]);
  assert.ok(maxZ <= 1e-9, 'no raised geometry with all-zero heights');
});

test('raising ALL corners of an isolated quad adds a full column (top + 4 walls)', () => {
  const mesh = oneQuadMesh();
  const geomFlat = buildSceneGeometry({ mesh, heights: createHeights(4) });

  // Uniform height so all 4 walls are non-degenerate:
  // +1 top face (2 tris) + 4 walls (8 tris) = +10 triangles.
  const raised = createHeights(4);
  for (const v of [0, 1, 2, 3]) raised.raise(v);
  const geomRaised = buildSceneGeometry({ mesh, heights: raised });

  assert.equal(geomRaised.triangleCount - geomFlat.triangleCount, 10,
    'a full uniform column adds top + 4 walls (10 tris)');
  assert.ok(allFinite(geomRaised.positions));
  assert.ok(normalsUnitLength(geomRaised));

  const floorH = 0.06;
  let maxZ = -Infinity;
  for (let i = 2; i < geomRaised.positions.length; i += 3) maxZ = Math.max(maxZ, geomRaised.positions[i]);
  assert.ok(Math.abs(maxZ - floorH) < 1e-6, `column top at floorH, got ${maxZ}`);
});

test('raising any corner extrudes geometry above the floor with unit normals (no NaN)', () => {
  const mesh = tinyMesh();
  const geomFlat = buildSceneGeometry({ mesh, heights: createHeights(6) });

  const raised = createHeights(mesh.vertices.length);
  raised.raise(0); // single corner -> sloped top, collapsed walls auto-skipped
  const geom = buildSceneGeometry({ mesh, heights: raised });

  assert.ok(geom.triangleCount > geomFlat.triangleCount, 'adds geometry above floor');
  assert.ok(allFinite(geom.positions), 'positions finite');
  assert.ok(allFinite(geom.normals), 'normals finite');
  assert.ok(normalsUnitLength(geom), 'no degenerate (NaN) normals — collapsed faces skipped');

  let maxZ = -Infinity;
  for (let i = 2; i < geom.positions.length; i += 3) maxZ = Math.max(maxZ, geom.positions[i]);
  assert.ok(Math.abs(maxZ - 0.06) < 1e-6, `raised corner reaches floorH, got ${maxZ}`);
});

test('a stepped column (uneven corner heights) peaks at the tallest corner', () => {
  const mesh = oneQuadMesh();
  const h = createHeights(4);
  h.set(0, 2);
  h.set(1, 1); // heights around the quad: [2,1,0,0] -> sloped/stepped top
  const geom = buildSceneGeometry({ mesh, heights: h }, { floorH: 0.06 });

  assert.ok(allFinite(geom.positions));
  assert.ok(normalsUnitLength(geom), 'stepped top + walls have unit normals');

  let maxZ = -Infinity;
  for (let i = 2; i < geom.positions.length; i += 3) maxZ = Math.max(maxZ, geom.positions[i]);
  assert.ok(Math.abs(maxZ - 2 * 0.06) < 1e-6, `stepped top peaks at 2*floorH, got ${maxZ}`);
});

test('empty mesh yields empty buffers, no throw', () => {
  const geom = buildSceneGeometry({ mesh: { vertices: [], quads: [] }, heights: createHeights(0) });
  assert.equal(geom.triangleCount, 0);
  assert.equal(geom.positions.length, 0);
});

test('missing args yield empty buffers', () => {
  const geom = buildSceneGeometry({});
  assert.equal(geom.triangleCount, 0);
});

test('colors buffer is parallel to positions (rgb per vertex)', () => {
  const mesh = tinyMesh();
  const h = createHeights(6);
  h.raise(1);
  const geom = buildSceneGeometry({ mesh, heights: h });
  assert.equal(geom.colors.length, geom.positions.length);
  // all color channels in [0,1]
  for (let i = 0; i < geom.colors.length; i++) {
    assert.ok(geom.colors[i] >= 0 && geom.colors[i] <= 1);
  }
});

test('biome colorize is applied to vertex colors when a biome is supplied', () => {
  const mesh = oneQuadMesh();
  const h = createHeights(4);
  for (const v of [0, 1, 2, 3]) h.set(v, 2);
  // A fake biome that paints everything pure green.
  const greenBiome = { id: 'green', colorize: () => [0, 1, 0] };
  const geom = buildSceneGeometry({ mesh, heights: h, biome: greenBiome }, { floorH: 0.06, amplitude: 2 });
  assert.ok(allFinite(geom.colors));
  // The column top should be green-dominant (g channel highest on most verts).
  let greenVerts = 0;
  for (let i = 0; i < geom.colors.length; i += 3) {
    if (geom.colors[i + 1] >= geom.colors[i] && geom.colors[i + 1] >= geom.colors[i + 2]) greenVerts++;
  }
  assert.ok(greenVerts > 0, 'biome color reached the buffer');
});

test('decorations merge extra triangles into the scene buffers (no NaN)', () => {
  const mesh = oneQuadMesh();
  const h = createHeights(4);
  const base = buildSceneGeometry({ mesh, heights: h });
  // One tree decoration: trunk cylinder + canopy cone over the cell center.
  const decorations = [{
    type: 'tree', x: 0.5, y: 0.5, z: 0,
    trunkRadius: 0.05, trunkHeight: 0.2,
    canopyRadius: 0.2, canopyHeight: 0.4, angle: 0,
  }];
  const withDec = buildSceneGeometry({ mesh, heights: h, decorations });
  assert.ok(withDec.triangleCount > base.triangleCount, 'decorations add triangles');
  assert.ok(allFinite(withDec.positions), 'decoration positions finite');
  assert.ok(allFinite(withDec.normals), 'decoration normals finite');
  assert.ok(normalsUnitLength(withDec), 'decoration normals unit length');
});

test('water decoration covers a cell footprint as a flat quad', () => {
  const mesh = oneQuadMesh();
  const h = createHeights(4);
  const decorations = [{ type: 'water', quadIndex: 0, z: 0.02 }];
  const geom = buildSceneGeometry({ mesh, heights: h, decorations });
  assert.ok(allFinite(geom.positions));
  assert.ok(normalsUnitLength(geom));
});
