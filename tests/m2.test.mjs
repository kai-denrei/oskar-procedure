// m2.test.mjs — M2 tests: half-edge connectivity, dual cells, paint hit-test.
// Run with: node --test  (runs alongside grid.test.mjs).
//
// Pure-logic only (NO DOM). Covers:
//   - half-edge integrity: twin.twin === he, verticesOfFace, facesAroundVertex
//   - dual count: one cell per interior vertex (degree >= 3), none for boundary
//   - dual cell closed & non-degenerate: >= 3 centroids, monotonic angular order
//   - tiling proxy: every interior corner of every quad references that quad's centroid
//   - paint/hit-test: a point near an interior vertex resolves to it; toggle flips state

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { generateMesh, relax } from '../src/grid.js';
import { buildHalfEdge } from '../src/halfedge.js';
import { extractDualCells, hitTestVertex } from '../src/dual.js';
import { createState } from '../src/state.js';

const SEEDS = [1, 42, 1337, 2024, 7];

// Build a finalized (relaxed) mesh the way main.js will.
function finalMesh(seed) {
  const mesh = generateMesh({ seed });
  relax(mesh, { n_iters: 100 });
  return mesh;
}

// Count incident quads per vertex directly from the quad list (ground truth).
function incidentQuadCounts(mesh) {
  const counts = new Array(mesh.vertices.length).fill(0);
  for (const q of mesh.quads) for (const vi of q) counts[vi]++;
  return counts;
}

// --- half-edge integrity ---------------------------------------------------

for (const seed of SEEDS) {
  test(`half-edge: twin.twin === he for every non-boundary HE (seed ${seed})`, () => {
    const mesh = finalMesh(seed);
    const he = buildHalfEdge(mesh);
    let interiorCount = 0;
    for (const e of he.halfEdges) {
      if (e.twin !== null) {
        interiorCount++;
        assert.equal(e.twin.twin, e, 'twin involution must hold');
      }
    }
    assert.ok(interiorCount > 0, 'mesh has interior (shared) edges');
  });

  test(`half-edge: verticesOfFace returns the 4 quad indices (seed ${seed})`, () => {
    const mesh = finalMesh(seed);
    const he = buildHalfEdge(mesh);
    assert.equal(he.faces.length, mesh.quads.length);
    for (let f = 0; f < he.faces.length; f++) {
      const got = he.verticesOfFace(he.faces[f]);
      assert.equal(got.length, 4, 'face has 4 vertices');
      // Same set as the original quad (walk order may differ in start, not membership).
      assert.deepEqual([...got].sort((a, b) => a - b), [...mesh.quads[f]].sort((a, b) => a - b));
    }
  });

  test(`half-edge: facesAroundVertex terminates and matches incident-quad count (seed ${seed})`, () => {
    const mesh = finalMesh(seed);
    const he = buildHalfEdge(mesh);
    const truth = incidentQuadCounts(mesh);
    for (let v = 0; v < mesh.vertices.length; v++) {
      if (truth[v] === 0) continue; // unreferenced vertex (none expected, but be safe)
      const faces = he.facesAroundVertex(v);
      assert.equal(
        faces.length,
        truth[v],
        `vertex ${v}: orbit found ${faces.length} faces, expected ${truth[v]}`
      );
      // no duplicate faces in the orbit
      assert.equal(new Set(faces).size, faces.length, 'orbit visits each face once');
    }
  });
}

// --- dual cells ------------------------------------------------------------

for (const seed of SEEDS) {
  test(`dual: one cell per interior vertex (degree >= 3), none for boundary (seed ${seed})`, () => {
    const mesh = finalMesh(seed);
    const he = buildHalfEdge(mesh);
    const cells = extractDualCells(mesh, he);

    const truth = incidentQuadCounts(mesh);
    const interiorVerts = [];
    for (let v = 0; v < mesh.vertices.length; v++) if (truth[v] >= 3) interiorVerts.push(v);

    assert.equal(cells.length, interiorVerts.length, 'one dual cell per interior vertex');

    const cellVerts = new Set(cells.map((c) => c.vertexIndex));
    for (const v of interiorVerts) assert.ok(cellVerts.has(v), `interior vertex ${v} has a cell`);
    // No cell for any boundary vertex (degree < 3).
    for (const c of cells) assert.ok(truth[c.vertexIndex] >= 3, `cell vertex ${c.vertexIndex} is interior`);
  });

  test(`dual: each cell closed, >=3 centroids, monotonic angular order (seed ${seed})`, () => {
    const mesh = finalMesh(seed);
    const he = buildHalfEdge(mesh);
    const cells = extractDualCells(mesh, he);

    for (const c of cells) {
      assert.ok(c.centroids.length >= 3, `cell ${c.vertexIndex} has >= 3 centroids`);
      // angle-sort proxy for "simple polygon": angles about the center are strictly
      // monotonic when traversed cyclically (exactly one wrap-around decrease).
      const angles = c.centroids.map((p) =>
        Math.atan2(p[1] - c.center[1], p[0] - c.center[0])
      );
      let decreases = 0;
      for (let i = 0; i < angles.length; i++) {
        const a = angles[i];
        const b = angles[(i + 1) % angles.length];
        if (b <= a) decreases++;
      }
      assert.equal(
        decreases,
        1,
        `cell ${c.vertexIndex}: angular order must wrap exactly once (got ${decreases})`
      );
    }
  });

  // Tiling proxy: a quad's centroid must appear in the dual cell of EACH of that
  // quad's interior (degree>=3) corners. Adjacent dual cells therefore share the
  // centroid vertices on their common boundary -> the cells partition the interior
  // (no gaps: every interior corner of every quad is covered; no overlaps: the
  // shared vertices are the seams between cells). This is non-trivial: it fails if
  // the orbit drops or duplicates an incident face for any cell.
  test(`dual: tiling proxy — each quad centroid is in every interior corner's cell (seed ${seed})`, () => {
    const mesh = finalMesh(seed);
    const he = buildHalfEdge(mesh);
    const cells = extractDualCells(mesh, he);
    const byVertex = new Map(cells.map((c) => [c.vertexIndex, c]));
    const truth = incidentQuadCounts(mesh);

    // Recompute each quad centroid to compare positions exactly.
    const centroidOf = (q) => {
      let x = 0, y = 0;
      for (const vi of q) { x += mesh.vertices[vi][0]; y += mesh.vertices[vi][1]; }
      return [x / 4, y / 4];
    };

    for (let qi = 0; qi < mesh.quads.length; qi++) {
      const q = mesh.quads[qi];
      const ctr = centroidOf(q);
      for (const corner of q) {
        if (truth[corner] < 3) continue; // boundary corner has no cell
        const cell = byVertex.get(corner);
        assert.ok(cell, `interior corner ${corner} has a cell`);
        const found = cell.centroids.some(
          (p) => Math.abs(p[0] - ctr[0]) < 1e-9 && Math.abs(p[1] - ctr[1]) < 1e-9
        );
        assert.ok(found, `quad ${qi} centroid present in cell of corner ${corner}`);
      }
    }
  });
}

// --- paint / hit-test ------------------------------------------------------

for (const seed of SEEDS) {
  test(`hit-test: a point near an interior vertex resolves to that vertex (seed ${seed})`, () => {
    const mesh = finalMesh(seed);
    const he = buildHalfEdge(mesh);
    const cells = extractDualCells(mesh, he);
    assert.ok(cells.length > 0, 'have interior cells to test');

    // pick a cell, sample its exact center -> must hit its own vertex (point-in-polygon).
    const target = cells[Math.floor(cells.length / 2)];
    const hit = hitTestVertex(target.center, cells);
    assert.equal(hit, target.vertexIndex, 'center of a cell hit-tests to its own vertex');
  });
}

test('state: toggle flips a vertex value; set/get/clear behave', () => {
  const st = createState(10);
  assert.equal(st.get(3), false, 'default empty');
  st.toggle(3);
  assert.equal(st.get(3), true, 'toggle -> true');
  st.toggle(3);
  assert.equal(st.get(3), false, 'toggle -> false');
  st.set(5, true);
  assert.equal(st.get(5), true, 'set true');
  st.clear();
  assert.equal(st.get(5), false, 'clear resets');
  // out-of-range get is safe
  assert.equal(st.get(999), false, 'out-of-range get is false');
});

test('hit-test + toggle: clicking an interior cell center toggles exactly that corner', () => {
  const mesh = finalMesh(42);
  const he = buildHalfEdge(mesh);
  const cells = extractDualCells(mesh, he);
  const st = createState(mesh.vertices.length);

  const c = cells[0];
  const hit = hitTestVertex(c.center, cells);
  assert.equal(hit, c.vertexIndex);
  assert.equal(st.get(hit), false);
  st.toggle(hit);
  assert.equal(st.get(hit), true, 'cell now filled');
  // a second click un-paints
  st.toggle(hit);
  assert.equal(st.get(hit), false, 'second click clears');
});
