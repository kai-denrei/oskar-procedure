# Map Tile Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a player drill into a single Map tile (focus mode), sculpt its terrain (raise/lower), and place/remove objects (tree/rock/building/water), with auto-decorations baked into one editable set.

**Architecture:** A Map tile gains an optional in-memory `tile.edit = { heights:number[], objects:Record[], epoch }` (null = procedural, as today). New pure modules `objects.js` (placeable registry) and `map-edit.js` (bake/sculpt/place/erase/picking + single-tile geometry) drive editing; `map-view.js` gains a `focusedTile` state that routes draw + input to the editor; a `map-edit-controls.js` panel swaps in while focused. Rendering reuses the existing WebGL renderer, fixed-iso camera, and `buildSceneGeometry` pipeline. `view3d.js` is NOT touched.

**Tech Stack:** Vanilla ES modules, no build step, no deps, WebGL2. Pure logic Node-tested with `node:test` + `node:assert/strict`. Cache-bust via `scripts/bust.sh`. Spec: `docs/specs/2026-05-28-map-tile-editing-design.md`.

**Branch:** Do this on `feat/map-tile-editing` (project pattern: one feature branch, squash-merge to main, re-bust, push). Create it before Task 1 (via `superpowers:using-git-worktrees` if executing in a worktree).

**Import/fingerprint note:** Write all `import` statements in NEW modules **without** a `?v=` query (e.g. `from '../structures/geometry.js'`). Node resolves these directly, and `scripts/bust.sh` (via `fingerprint-imports.py`) stamps `?v=<token>` onto every relative import at ship time (Task 19). Tests import modules **without** `?v=` (matching `tests/hexmap.test.mjs`).

---

## File Structure

| File | New? | Responsibility |
|---|---|---|
| `src/structures/hexmap.js` | modify | `createHexMap` initializes `edit: null` on each tile. |
| `src/structures/objects.js` | **create** | Placeable-object registry: `OBJECTS`, `getObjectDef(id)`, deterministic `make(ctx)` per type → a `buildSceneGeometry`-compatible record tagged with `cell`. |
| `src/structures/geometry.js` | modify | New `emitBox` closure + `rock`/`building` branches in `emitDecorations`; new module-level `ROCK_COLOR`/`WALL_COLOR`/`ROOF_COLOR`. |
| `src/gl/map-edit.js` | **create** | Pure edit ops + picking + single-tile geometry: `cellAt`, `objectPos`, `nearestObject`, `bakeIfNeeded`, `sculpt`, `placeObject`, `eraseAt`, `buildFocusGeometry`. |
| `src/gl/map-view.js` | modify | `focusedTile` state; `enterFocus`/`exitFocus`/`isFocused`; click-to-focus vs drag-to-pan; focus-mode input (sculpt drag, place click, erase right-click); board cache key → `seed:biomeId:epoch`; per-`seed` relaxed-mesh cache. |
| `src/gl/map-edit-controls.js` | **create** | Focus panel: Raise/Lower toggle, object palette (Tree/Rock/Building/Water + Sculpt/none), "← Board" button. |
| `src/main.js` | modify | Wire focus enter/exit, panel swap, Esc-to-exit, tool/object selection; DEMO hooks `?focus=q,r` + `window.__mapEdit`. |
| `index.html`, `sw.js` | modify | Precache the two new modules; update `#map-hint` copy; run `bust.sh`. |
| `tests/objects.test.mjs` | **create** | Registry tests. |
| `tests/map-edit.test.mjs` | **create** | Bake/sculpt/place/erase/picking tests. |
| `tests/geometry.test.mjs` | modify | Add rock/building emit assertions. |

**Constants used across modules:** `FLOOR_H = 0.06` (matches `map-view.js`, `view3d.js`, relax `SIDE_LENGTH`). `ERASE_RADIUS_FACTOR = 0.6` (× cell inradius).

---

# Phase 1 — MAP-EDIT-1: focus shell + terrain sculpt

Goal of phase: click a land tile → camera focuses it → left-drag raises/lowers cells → exit → board shows the sculpt. No object placement yet (auto-decorations still render).

---

### Task 1: `tile.edit` field on the board model

**Files:**
- Modify: `src/structures/hexmap.js:99-104` (the tile literal inside `createHexMap`)
- Test: `tests/hexmap.test.mjs` (add one test)

- [ ] **Step 1: Write the failing test**

Add to `tests/hexmap.test.mjs` (after the existing `setBiome` test):

```js
test('tiles start with edit === null (procedural until focused)', () => {
  const map = createHexMap({ radius: 1, seed: 1 });
  for (const t of map.tiles) assert.equal(t.edit, null, `tile (${t.q},${t.r}) edit null`);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/hexmap.test.mjs`
Expected: FAIL — `t.edit` is `undefined`, not `null`.

- [ ] **Step 3: Add the field**

In `src/structures/hexmap.js`, inside the `const tile = { … }` literal (currently `q, r, center, biomeId, seed`), add `edit: null`:

```js
      const tile = {
        q, r,
        center: tileCenter(q, r, m1, m2),
        biomeId,
        seed: tileSeed(seed, q, r),
        edit: null, // { heights:number[], objects:Record[], epoch } once edited (map-edit.js)
      };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/hexmap.test.mjs`
Expected: PASS (all hexmap tests, including the new one).

- [ ] **Step 5: Commit**

```bash
git add src/structures/hexmap.js tests/hexmap.test.mjs
git commit -m "feat(map-edit): tiles carry an optional edit field (null = procedural)"
```

---

### Task 2: `cellAt` — point-in-quad picking (`map-edit.js`)

**Files:**
- Create: `src/gl/map-edit.js`
- Test: `tests/map-edit.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `tests/map-edit.test.mjs`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/map-edit.test.mjs`
Expected: FAIL — cannot find module `../src/gl/map-edit.js`.

- [ ] **Step 3: Create `src/gl/map-edit.js` with `cellAt`**

```js
// map-edit.js — pure edit ops + picking + single-tile geometry for Map focus
// mode. NO DOM, NO GL (Node-testable). The focus SHELL (camera/input/panel)
// lives in map-view.js / main.js; this module owns the data transforms.

import { buildSceneGeometry } from '../structures/geometry.js';
import { getBiome } from '../structures/biomes.js';
import { generateDecorations } from '../structures/decorations.js';
import { getObjectDef } from '../structures/objects.js';

export const FLOOR_H = 0.06;            // world units per floor (matches map-view)
export const ERASE_RADIUS_FACTOR = 0.6; // × cell inradius

// Sign of the 2D cross product (b-a)×(p-a).
function side(a, b, p) {
  return (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
}

// Index of the (convex) quad containing (x,y), or -1. A point is inside a CCW
// convex quad when it is on the left (>=0) of all four directed edges.
export function cellAt(mesh, x, y) {
  const { vertices, quads } = mesh;
  const p = [x, y];
  for (let qi = 0; qi < quads.length; qi++) {
    const q = quads[qi];
    let inside = true;
    for (let i = 0; i < 4; i++) {
      const a = vertices[q[i]], b = vertices[q[(i + 1) % 4]];
      if (side(a, b, p) < -1e-9) { inside = false; break; }
    }
    if (inside) return qi;
  }
  return -1;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/map-edit.test.mjs`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/gl/map-edit.js tests/map-edit.test.mjs
git commit -m "feat(map-edit): cellAt point-in-quad picking"
```

---

### Task 3: cell geometry helpers — `cellCentroid`, `cellInradius`, `cellTopHeight`

**Files:**
- Modify: `src/gl/map-edit.js`
- Test: `tests/map-edit.test.mjs`

- [ ] **Step 1: Write the failing test**

Append to `tests/map-edit.test.mjs`:

```js
import { cellCentroid, cellInradius, cellTopHeight } from '../src/gl/map-edit.js';

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/map-edit.test.mjs`
Expected: FAIL — `cellCentroid` is not exported.

- [ ] **Step 3: Add the helpers to `map-edit.js`**

Append (after `cellAt`):

```js
// Mean of a quad's 4 corner positions (planar xy).
export function cellCentroid(mesh, cellIdx) {
  const q = mesh.quads[cellIdx], v = mesh.vertices;
  let x = 0, y = 0;
  for (let i = 0; i < 4; i++) { x += v[q[i]][0]; y += v[q[i]][1]; }
  return [x / 4, y / 4];
}

// Min distance from the centroid to the 4 edges — a safe "inside" radius.
export function cellInradius(mesh, cellIdx) {
  const q = mesh.quads[cellIdx], v = mesh.vertices;
  const [cx, cy] = cellCentroid(mesh, cellIdx);
  let min = Infinity;
  for (let i = 0; i < 4; i++) {
    const a = v[q[i]], b = v[q[(i + 1) % 4]];
    const ex = b[0] - a[0], ey = b[1] - a[1];
    const len = Math.hypot(ex, ey) || 1;
    // perpendicular distance from centroid to the (infinite) edge line
    const d = Math.abs((cx - a[0]) * ey - (cy - a[1]) * ex) / len;
    if (d < min) min = d;
  }
  return Number.isFinite(min) ? min : 0;
}

// The cell's surface height (floors) = the max of its 4 corner heights.
// `heights` is a plain number[] per vertex.
export function cellTopHeight(mesh, cellIdx, heights) {
  const q = mesh.quads[cellIdx];
  let m = 0;
  for (let i = 0; i < 4; i++) { const h = heights[q[i]] || 0; if (h > m) m = h; }
  return m;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/map-edit.test.mjs`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/gl/map-edit.js tests/map-edit.test.mjs
git commit -m "feat(map-edit): cell centroid/inradius/top-height helpers"
```

---

### Task 4: `bakeIfNeeded` — procedural → editable state

**Files:**
- Modify: `src/gl/map-edit.js`
- Test: `tests/map-edit.test.mjs`

- [ ] **Step 1: Write the failing test**

Append to `tests/map-edit.test.mjs`:

```js
import { bakeIfNeeded } from '../src/gl/map-edit.js';
import { generateMesh, relax } from '../src/grid.js';

function patch(seed) {
  const m = generateMesh({ seeder: 'hex', rings: 3, seed });
  relax(m, { n_iters: 100, pinned: m.boundary });
  return m;
}

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/map-edit.test.mjs`
Expected: FAIL — `bakeIfNeeded` not exported.

- [ ] **Step 3: Add `bakeIfNeeded` (+ a private heights read-adapter) to `map-edit.js`**

Append:

```js
// generateDecorations + buildSceneGeometry read heights through an object with
// .get/.max; our edit store keeps a plain number[]. This adapts the array.
function heightsView(arr) {
  return {
    get: (v) => (v >= 0 && v < arr.length ? (arr[v] | 0) : 0),
    max: () => { let m = 0; for (const h of arr) if (h > m) m = h; return m; },
    forEach: (cb) => arr.forEach((h, i) => cb(h, i)),
    get size() { return arr.length; },
  };
}

// Resolve the cell a decoration record sits on. Water carries quadIndex; others
// carry x,y → point-in-quad. Returns a cell index (>=0) or 0 as a safe fallback.
function recordCell(mesh, d) {
  if (Number.isInteger(d.quadIndex)) return d.quadIndex;
  if (typeof d.x === 'number' && typeof d.y === 'number') {
    const c = cellAt(mesh, d.x, d.y);
    return c >= 0 ? c : 0;
  }
  return 0;
}

// Bake a tile's procedural output into an editable edit-state (idempotent).
// `mesh` is the tile's relaxed hex patch (caller supplies; see map-view cache).
export function bakeIfNeeded(tile, mesh) {
  if (tile.edit) return tile.edit;
  const biome = getBiome(tile.biomeId);
  const generated = biome.generate(mesh, {
    seed: tile.seed, amplitude: biome.maxHeight, roughness: 4,
  });
  const heights = generated.map((h) => Math.max(0, Math.round(h)));
  const decs = generateDecorations({
    biome: tile.biomeId, mesh, heights: heightsView(heights),
    seed: tile.seed, floorH: FLOOR_H,
  });
  const objects = decs.map((d) => ({ ...d, cell: recordCell(mesh, d) }));
  tile.edit = { heights, objects, epoch: 1 };
  return tile.edit;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/map-edit.test.mjs`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/gl/map-edit.js tests/map-edit.test.mjs
git commit -m "feat(map-edit): bakeIfNeeded — procedural terrain+decorations → editable state"
```

---

### Task 5: `sculpt` — flat-block raise/lower

**Files:**
- Modify: `src/gl/map-edit.js`
- Test: `tests/map-edit.test.mjs`

- [ ] **Step 1: Write the failing test**

Append to `tests/map-edit.test.mjs`:

```js
import { sculpt } from '../src/gl/map-edit.js';

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/map-edit.test.mjs`
Expected: FAIL — `sculpt` not exported.

- [ ] **Step 3: Add `sculpt` to `map-edit.js`**

Append:

```js
// Raise (dir=+1) or lower (dir=-1) a cell to a FLAT block one floor from its
// current top, clamped to [0, maxHeight]. Sets all 4 corners equal (terracing
// look, matches the 3D playground). Bumps epoch. Mutates tile.edit.heights.
export function sculpt(tile, cellIdx, dir, maxHeight, mesh) {
  const e = tile.edit;
  const q = mesh.quads[cellIdx];
  const top = cellTopHeight(mesh, cellIdx, e.heights);
  let target = top + (dir >= 0 ? 1 : -1);
  if (target < 0) target = 0;
  if (target > maxHeight) target = maxHeight;
  for (let i = 0; i < 4; i++) e.heights[q[i]] = target;
  e.epoch++;
  return target;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/map-edit.test.mjs`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add src/gl/map-edit.js tests/map-edit.test.mjs
git commit -m "feat(map-edit): sculpt — flat-block raise/lower with clamps + epoch bump"
```

---

### Task 6: `buildFocusGeometry` — render one edited tile

**Files:**
- Modify: `src/gl/map-edit.js`
- Test: `tests/map-edit.test.mjs`

- [ ] **Step 1: Write the failing test**

Append to `tests/map-edit.test.mjs`:

```js
import { buildFocusGeometry } from '../src/gl/map-edit.js';

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
  // force one tree object on cell 0 at z=0
  edit.objects = [{ type: 'tree', cell: 0, x: cellCentroid(m,0)[0], y: cellCentroid(m,0)[1], z: 0,
                    trunkRadius: 0.005, trunkHeight: 0.02, canopyRadius: 0.02, canopyHeight: 0.04 }];
  sculpt(tile, 0, +1, 7, m);          // cell 0 now height 1
  buildFocusGeometry(tile, m);         // refreshes object z in place
  assert.equal(edit.objects[0].z, 1 * FLOOR_H, 'tree z lifted to cell top');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/map-edit.test.mjs`
Expected: FAIL — `buildFocusGeometry` not exported.

- [ ] **Step 3: Add `buildFocusGeometry` to `map-edit.js`**

Append:

```js
// Refresh each object's z to its cell's current surface top (objects ride
// terrain) and build the focused tile's geometry, centered at the tile's own
// origin (NOT translated to tile.center — the board view does that).
export function buildFocusGeometry(tile, mesh) {
  const e = tile.edit;
  const biome = getBiome(tile.biomeId);
  for (const o of e.objects) {
    if (Number.isInteger(o.cell)) {
      o.z = cellTopHeight(mesh, o.cell, e.heights) * FLOOR_H;
    }
  }
  return buildSceneGeometry(
    { mesh, heights: heightsView(e.heights), decorations: e.objects, biome },
    { floorH: FLOOR_H, amplitude: biome.maxHeight }
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/map-edit.test.mjs`
Expected: PASS (11 tests).

- [ ] **Step 5: Run the FULL suite (no regressions)**

Run: `node --test tests/*.mjs`
Expected: all pass (179 prior + the new map-edit/hexmap tests).

- [ ] **Step 6: Commit**

```bash
git add src/gl/map-edit.js tests/map-edit.test.mjs
git commit -m "feat(map-edit): buildFocusGeometry — single-tile render, objects ride terrain"
```

---

### Task 7: Per-`seed` relaxed-mesh cache + edit-aware tile build in `map-view.js`

**Files:**
- Modify: `src/gl/map-view.js` (imports; `buildTileGeometry`; cache key)
- Verify: browser (Phase-1 screenshot at Task 11)

- [ ] **Step 1: Add imports + a mesh cache (top of `map-view.js`, after existing imports)**

After the existing `import { buildSceneGeometry } …` block (around line 31), add:

```js
import { bakeIfNeeded, buildFocusGeometry, cellAt, sculpt as editSculpt } from './map-edit.js';
```

After `const tileCache = new Map();` (around line 57) add a relaxed-mesh cache:

```js
// Relaxed hex patch per tile seed (deterministic from seed) — reused by both
// the board build and focus-mode editing so we never re-relax the same patch.
const meshCache = new Map(); // seed -> relaxed mesh
function tileMesh(tile, map) {
  let m = meshCache.get(tile.seed);
  if (!m) {
    m = generateMesh({ seeder: 'hex', rings: map.ringsPerTile, seed: tile.seed });
    relax(m, { n_iters: 100, pinned: m.boundary });
    meshCache.set(tile.seed, m);
  }
  return m;
}
```

- [ ] **Step 2: Make `buildTileGeometry` edit-aware**

Replace the body of `buildTileGeometry(tile, map)` (lines ~80-130) so it uses `tileMesh` and, when `tile.edit` exists, renders from the edited heights+objects instead of regenerating:

```js
function buildTileGeometry(tile, map) {
  if (tile.biomeId === 'water') return null;
  const biome = getBiome(tile.biomeId);
  const mesh = tileMesh(tile, map);

  let geom;
  if (tile.edit) {
    // Edited tile: render from the editable state (objects already ride terrain
    // via buildFocusGeometry, which refreshes their z).
    geom = buildFocusGeometry(tile, mesh);
  } else {
    // Procedural tile (unchanged behavior).
    const hs = biome.generate(mesh, { seed: tile.seed, amplitude: biome.maxHeight, roughness: 4 });
    const heights = createHeights(mesh.vertices.length);
    for (let i = 0; i < hs.length; i++) heights.set(i, hs[i]);
    const decorations = generateDecorations({ biome: tile.biomeId, mesh, heights, seed: tile.seed, floorH: FLOOR_H });
    geom = buildSceneGeometry({ mesh, heights, decorations, biome }, { floorH: FLOOR_H, amplitude: biome.maxHeight });
  }

  // Translate positions by the tile center (xy).
  const [tx, ty] = tile.center;
  const pos = geom.positions;
  const out = new Float32Array(pos.length);
  for (let i = 0; i < pos.length; i += 3) {
    out[i] = pos[i] + tx; out[i + 1] = pos[i + 1] + ty; out[i + 2] = pos[i + 2];
  }
  return { positions: out, normals: geom.normals, colors: geom.colors, indices: geom.indices };
}
```

- [ ] **Step 3: Make the board cache key edit-aware**

Replace `tileKey` (line ~58):

```js
function tileKey(tile) {
  return tile.seed + ':' + tile.biomeId + ':' + (tile.edit ? tile.edit.epoch : 0);
}
```

- [ ] **Step 4: Verify nothing regressed (board still renders)**

Run: `node --test tests/*.mjs` (no test asserts on these GL functions, but confirm the suite still passes — nothing imported was broken).
Then serve + screenshot the board (recipe at Task 11) — confirm the 19-tile board still renders unchanged for an unedited map.

- [ ] **Step 5: Commit**

```bash
git add src/gl/map-view.js
git commit -m "feat(map-edit): edit-aware tile build + per-seed mesh cache + epoch cache key"
```

---

### Task 8: Focus state + draw routing in `map-view.js`

**Files:**
- Modify: `src/gl/map-view.js` (focus state, `enterFocus`/`exitFocus`/`isFocused`, `drawMapView`)

- [ ] **Step 1: Add focus state + accessors**

After `let cachedBoard = null;` (around line 220) add:

```js
// --- focus mode (single-tile editor) -------------------------------------
let focusedTile = null;          // the tile being edited, or null (= board)
let focusGeom = null;            // its cached renderable geometry
let onFocusChange = null;        // (tile|null) => void — main.js swaps the panel
export function setMapOnFocusChange(cb) { onFocusChange = cb; }
export function isFocused() { return focusedTile != null; }
export function getFocusedTile() { return focusedTile; }

function rebuildFocus() {
  if (!focusedTile || !liveMap) return;
  const mesh = tileMesh(focusedTile, liveMap);
  const g = buildFocusGeometry(focusedTile, mesh);
  focusGeom = g;
  if (renderer) renderer.setGeometry(g);
  if (camera) camera.frameBounds(g.bounds);
}

export function enterFocus(tile) {
  if (!tile || tile.biomeId === 'water' || !liveMap) return false;
  bakeIfNeeded(tile, tileMesh(tile, liveMap));
  focusedTile = tile;
  rebuildFocus();
  if (onFocusChange) onFocusChange(tile);
  return true;
}

export function exitFocus() {
  if (!focusedTile) return;
  const t = focusedTile;
  focusedTile = null;
  focusGeom = null;
  // The edited tile's board-cache entry is now stale (epoch changed) → drop it
  // so the board rebuild picks up the edit.
  tileCache.delete(tileKey(t));
  markMapDirty();
  requestMapReframe();
  if (onFocusChange) onFocusChange(null);
}
```

- [ ] **Step 2: Route the draw**

In `drawMapView` (line ~236), branch on focus before the board path:

```js
export function drawMapView(state = {}) {
  liveMap = state.map || liveMap;
  if (!renderer || !renderer.ok || !camera || !liveMap) return;

  if (focusedTile) {
    if (!focusGeom) rebuildFocus();
    const view = camera.viewMatrix();
    const proj = camera.projMatrix(aspect());
    renderer.draw(multiply(proj, view));
    return;
  }

  if (dirty || liveMap !== lastMapRef) rebuildBoard();
  const view = camera.viewMatrix();
  const proj = camera.projMatrix(aspect());
  renderer.draw(multiply(proj, view));
}
```

- [ ] **Step 3: Verify (smoke, runtime errors only)**

Run: `node --test tests/*.mjs` (confirms no import/syntax break).
Browser verification deferred to Task 11 (after input + panel exist).

- [ ] **Step 4: Commit**

```bash
git add src/gl/map-view.js
git commit -m "feat(map-edit): focus state + enter/exit + focus draw routing"
```

---

### Task 9: Input routing — click-to-focus, sculpt drag, exit

**Files:**
- Modify: `src/gl/map-view.js` (pointer handlers)

- [ ] **Step 1: Track press origin to distinguish click from drag (board)**

In `onPointerDown` (line ~432), record the press point and a moved flag:

```js
let dragging = false;
let lastDrag = null;
let pressStart = null;     // [x,y] client at press
let movedFar = false;      // exceeded the click threshold
const CLICK_PX = 5;

function onPointerDown(ev) {
  if (ev.button === 2) return; // right-click handled by contextmenu
  dragging = true;
  lastDrag = [ev.clientX, ev.clientY];
  pressStart = [ev.clientX, ev.clientY];
  movedFar = false;
  canvas.setPointerCapture?.(ev.pointerId);
  // In focus mode a press may begin a sculpt stroke (Task: tool state in main).
  if (focusedTile) focusSculptAt(ev);
}
```

- [ ] **Step 2: In move, pan on the board / continue sculpt in focus**

Replace `onPointerMove` (line ~438):

```js
function onPointerMove(ev) {
  if (!dragging || !lastDrag) return;
  const dxPx = ev.clientX - lastDrag[0];
  const dyPx = ev.clientY - lastDrag[1];
  if (pressStart && Math.hypot(ev.clientX - pressStart[0], ev.clientY - pressStart[1]) > CLICK_PX) movedFar = true;
  lastDrag = [ev.clientX, ev.clientY];

  if (focusedTile) { focusSculptAt(ev); return; } // sculpt-paint across cells

  const rect = canvas.getBoundingClientRect();
  const ext = camera.state.halfExtent / camera.state.zoom;
  const worldPerPx = (2 * ext) / Math.min(rect.width, rect.height);
  camera.pan(-dxPx * worldPerPx, dyPx * worldPerPx, currentBounds);
  if (onCameraChange) onCameraChange();
}
```

- [ ] **Step 3: On release, a no-drag board click enters focus**

Replace `onPointerUp` (line ~449):

```js
function onPointerUp(ev) {
  const wasClick = dragging && !movedFar;
  dragging = false;
  lastDrag = null;
  canvas.releasePointerCapture?.(ev.pointerId);
  if (!focusedTile && wasClick) {
    const gp = unprojectToGround(ev.clientX, ev.clientY);
    const tile = pickTileAt(gp);
    if (tile) enterFocus(tile);
  }
}
```

- [ ] **Step 4: Add the sculpt-stroke helper + tool state hook**

After `pickTileAt` (around line 304) add (tool state is set by main.js via `setMapTool`):

```js
// --- focus-mode editing input --------------------------------------------
// tool: { mode:'sculpt'|'place', dir:+1|-1, objectId:string|null }
let tool = { mode: 'sculpt', dir: +1, objectId: null };
export function setMapTool(t) { tool = { ...tool, ...t }; }

let lastSculptCell = -1; // avoid re-editing the same cell while dragging
function focusGroundCell(ev) {
  const gp = unprojectToGround(ev.clientX, ev.clientY);
  if (!gp || !focusedTile) return { gp: null, cell: -1, mesh: null };
  const mesh = tileMesh(focusedTile, liveMap);
  // focus geometry is centered at the tile's own origin → subtract tile.center
  const lx = gp[0] - focusedTile.center[0];
  const ly = gp[1] - focusedTile.center[1];
  return { gp: [lx, ly], cell: cellAt(mesh, lx, ly), mesh };
}

function focusSculptAt(ev) {
  if (tool.mode !== 'sculpt') return;            // Place handled on click (Phase 2)
  const { cell, mesh } = focusGroundCell(ev);
  if (cell < 0 || cell === lastSculptCell) return;
  lastSculptCell = cell;
  const biome = getBiome(focusedTile.biomeId);
  editSculpt(focusedTile, cell, tool.dir, biome.maxHeight, mesh);
  rebuildFocus();
}
```

Add `lastSculptCell = -1;` reset at the end of `onPointerUp` (so each stroke is fresh):

```js
  lastSculptCell = -1;
```

- [ ] **Step 5: Verify (smoke)**

Run: `node --test tests/*.mjs` — confirm no import/syntax break.

- [ ] **Step 6: Commit**

```bash
git add src/gl/map-view.js
git commit -m "feat(map-edit): click-to-focus, drag-to-pan vs sculpt-stroke, exit on no-drag click"
```

---

### Task 10: Focus panel + main.js wiring (Raise/Lower, ← Board, Esc)

**Files:**
- Create: `src/gl/map-edit-controls.js`
- Modify: `index.html` (focus panel container + hint copy), `src/main.js` (wiring)

- [ ] **Step 1: Create `src/gl/map-edit-controls.js`**

```js
// map-edit-controls.js — the Map FOCUS-mode panel, injected into
// <aside id="map-edit-controls">. Mirrors map-controls.js styling (.ctrl-*,
// .seg-*). Phase-1 widgets: a Raise/Lower toggle and a "← Board" exit button.
// (Phase 2 adds the object palette to the same panel.)
//
//   createMapEditControls({ onTool, onExit }) -> { setMode }
//     onTool({ mode, dir, objectId })  fires when a widget changes the tool
//     onExit()                          "← Board" clicked

export function createMapEditControls(handlers = {}) {
  const aside = document.getElementById('map-edit-controls');
  if (!aside) return { setMode() {} };
  aside.innerHTML = '';
  const onTool = handlers.onTool || (() => {});
  const onExit = handlers.onExit || (() => {});

  const back = document.createElement('button');
  back.type = 'button';
  back.id = 'map-edit-back';
  back.textContent = '← Board';
  back.addEventListener('click', () => onExit());
  aside.appendChild(back);

  const h1 = document.createElement('h1');
  h1.textContent = 'edit tile';
  aside.appendChild(h1);

  // Raise / Lower segmented toggle (2-way).
  const row = document.createElement('div');
  row.className = 'ctrl-row';
  const lbl = document.createElement('span');
  lbl.className = 'ctrl-label';
  lbl.textContent = 'Sculpt';
  row.appendChild(lbl);
  const group = document.createElement('div');
  group.className = 'seg-group';
  let dir = +1;
  const mk = (label, d) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'seg-btn' + (d === dir ? ' seg-active' : '');
    b.textContent = label;
    b.addEventListener('click', () => {
      dir = d;
      group.querySelectorAll('.seg-btn').forEach((x) => x.classList.remove('seg-active'));
      b.classList.add('seg-active');
      onTool({ mode: 'sculpt', dir, objectId: null });
    });
    return b;
  };
  group.appendChild(mk('Raise', +1));
  group.appendChild(mk('Lower', -1));
  row.appendChild(group);
  aside.appendChild(row);

  return {
    setMode() { /* Phase 2: reflect palette selection */ },
  };
}
```

- [ ] **Step 2: Add the focus panel container + update the hint in `index.html`**

In `#view-map` (line ~61-67), add a second aside and tweak the hint:

```html
      <main id="map-stage">
        <canvas id="map-canvas" aria-label="hexagon biome map WebGL canvas"></canvas>
        <p id="map-hint">click a tile to edit · right-click: change biome</p>
      </main>

      <aside id="map-controls"></aside>
      <aside id="map-edit-controls" hidden></aside>
```

- [ ] **Step 3: Wire focus enter/exit + panel swap + Esc in `main.js`**

After the `setMapOnRetype(...)` block (line ~590), add:

```js
import { setMapOnFocusChange, setMapTool, exitFocus, isFocused } from './gl/map-view.js?v=f9d2abf8';
import { createMapEditControls } from './gl/map-edit-controls.js?v=f9d2abf8';
```

(Place the imports with the other `map-view`/`map-controls` imports at the top of the file; shown here for locality. Use the file's current token; `bust.sh` re-stamps it.)

Then, near the map wiring:

```js
const boardPanel = document.getElementById('map-controls');
const editPanel = document.getElementById('map-edit-controls');

const mapEditUI = createMapEditControls({
  onTool: (t) => setMapTool(t),
  onExit: () => exitFocus(),
});

// Swap panels when focus enters/leaves a tile.
setMapOnFocusChange((tile) => {
  const editing = !!tile;
  boardPanel.hidden = editing;
  editPanel.hidden = !editing;
  if (editing) setMapTool({ mode: 'sculpt', dir: +1, objectId: null });
});

// Esc exits focus.
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && isFocused()) exitFocus();
});
```

- [ ] **Step 4: Add minimal styling for the back button (styles.css)**

Append to `styles.css` (reuses existing button styling; just spacing):

```css
/* ── Map focus-edit panel ─────────────────────────────────────────────── */
#map-edit-back { margin-bottom: 0.75rem; }
#map-edit-controls h1 { margin-top: 0; }
```

- [ ] **Step 5: Verify in the browser (focus shell + sculpt end to end)**

Serve and screenshot (one Chrome at a time):

```bash
python3 -m http.server 8777 >/tmp/srv.log 2>&1 &
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
"$CHROME" --headless --disable-gpu-sandbox --use-gl=angle --use-angle=swiftshader \
  --enable-unsafe-swiftshader --window-size=1400,950 --virtual-time-budget=7000 \
  --screenshot=/tmp/focus-empty.png "http://127.0.0.1:8777/?demo=1&radius=2#map"
```

Manual check (or via the Task 18 DEMO `?focus=` hook once it exists): clicking a tile should swap to the "edit tile" panel and fill the view with one patch. Confirm `node --test tests/*.mjs` still green.

- [ ] **Step 6: Commit**

```bash
git add src/gl/map-edit-controls.js index.html src/main.js styles.css
git commit -m "feat(map-edit): focus panel (Raise/Lower + Back), Esc exit, panel swap"
```

---

### Task 11: Phase-1 cache-bust + screenshot verification

**Files:**
- Modify: `sw.js` (precache new modules), then `scripts/bust.sh`

- [ ] **Step 1: Add the new modules to the SW precache list**

In `sw.js`, add `'src/gl/map-edit.js'` and `'src/gl/map-edit-controls.js'` to the precached-assets array (find the array listing `src/gl/map-view.js` and add alongside).

- [ ] **Step 2: Run bust to fingerprint + unify the token**

Run: `bash scripts/bust.sh`
Expected: `cache bust complete — token <new>`; new imports stamped.

- [ ] **Step 3: Full test run**

Run: `node --test tests/*.mjs`
Expected: all pass (Node handles `?v=` query'd imports).

- [ ] **Step 4: Screenshot: focus a tile + sculpt (uses the Task 18 hook if landed, else manual)**

For Phase 1, verify visually that entering focus renders one centered patch and the panel reads "edit tile". (The deterministic `?focus=`/`__mapEdit` hooks arrive in Phase 2 Task 18; until then, confirm the board screenshot is unchanged and the focus panel toggles.)

- [ ] **Step 5: Commit**

```bash
git add sw.js index.html src/ vendor/ styles.css
git commit -m "chore(map-edit): precache focus modules + cache-bust (Phase 1)"
```

---

# Phase 2 — MAP-EDIT-2: object palette (place / erase) + meshes

Goal of phase: a palette of Tree/Rock/Building/Water; select + left-click places, right-click erases the nearest object; auto-decorations (already baked) are erasable.

---

### Task 12: `objects.js` placeable registry

**Files:**
- Create: `src/structures/objects.js`
- Test: `tests/objects.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `tests/objects.test.mjs`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/objects.test.mjs`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Create `src/structures/objects.js`**

```js
// objects.js — placeable-object registry for Map tile editing. Pure: NO DOM/GL.
// make(ctx) returns a record using the SAME schema buildSceneGeometry's
// emitDecorations consumes (so placed objects ride the same VBO + shading),
// tagged with `cell` (the quad it sits on) so its z can follow terrain edits.
//   ctx = { x, y, z, cell, inr }   (inr = cell inradius → keeps objects in-cell)

function makeTree({ x, y, z, cell, inr }) {
  const canopyRadius = inr * 0.7;
  return {
    type: 'tree', cell, x, y, z,
    canopyRadius,
    trunkRadius: canopyRadius * 0.25,
    trunkHeight: canopyRadius * 1.1,
    canopyHeight: canopyRadius * 2.1,
    angle: 0,
  };
}
function makeRock({ x, y, z, cell, inr }) {
  const radius = inr * 0.55;
  return { type: 'rock', cell, x, y, z, radius, height: radius * 0.7 };
}
function makeBuilding({ x, y, z, cell, inr }) {
  const width = inr * 0.95;
  return { type: 'building', cell, x, y, z, width, wallHeight: width * 0.8, roofHeight: width * 0.6 };
}
function makeWater({ x, y, z, cell }) {
  return { type: 'water', cell, quadIndex: cell, z };
}

export const OBJECTS = [
  { id: 'tree', label: 'Tree', make: makeTree },
  { id: 'rock', label: 'Rock', make: makeRock },
  { id: 'building', label: 'Building', make: makeBuilding },
  { id: 'water', label: 'Water', make: makeWater },
];

export function getObjectDef(id) {
  return OBJECTS.find((o) => o.id === id) || null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/objects.test.mjs`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/structures/objects.js tests/objects.test.mjs
git commit -m "feat(map-edit): objects.js placeable registry (tree/rock/building/water)"
```

---

### Task 13: rock + building emitters in `geometry.js`

**Files:**
- Modify: `src/structures/geometry.js` (colors; `emitBox`; `emitDecorations`)
- Test: `tests/geometry.test.mjs`

- [ ] **Step 1: Write the failing test**

Append to `tests/geometry.test.mjs` (import `buildSceneGeometry` is already there; if not, add it):

```js
test('emits triangles for rock + building decoration records', () => {
  const mesh = { vertices: [[0,0],[1,0],[1,1],[0,1]], quads: [[0,1,2,3]] };
  const base = buildSceneGeometry({ mesh, heights: null }, {}).triangleCount;
  const withRock = buildSceneGeometry(
    { mesh, heights: null, decorations: [{ type:'rock', x:0.5, y:0.5, z:0, radius:0.2, height:0.15 }] }, {}
  ).triangleCount;
  const withBuilding = buildSceneGeometry(
    { mesh, heights: null, decorations: [{ type:'building', x:0.5, y:0.5, z:0, width:0.3, wallHeight:0.24, roofHeight:0.18 }] }, {}
  ).triangleCount;
  assert.ok(withRock > base, 'rock adds triangles');
  assert.ok(withBuilding > base, 'building adds triangles');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/geometry.test.mjs`
Expected: FAIL — rock/building add no triangles (count equals base).

- [ ] **Step 3: Add colors, `emitBox`, and the two branches**

In `src/structures/geometry.js`, after the decoration palette consts (line ~41) add:

```js
const ROCK_COLOR = [0.50, 0.50, 0.52];
const WALL_COLOR = [0.80, 0.72, 0.58];
const ROOF_COLOR = [0.62, 0.30, 0.24];
```

Add an `emitBox` closure next to `emitDisk` (after line ~345, inside `buildSceneGeometry`):

```js
  // An axis-aligned square prism (hut walls) centered at (cx,cy), side `w`,
  // from z0 up to z0+h, plus a flat top. Walls wound outward (matches columns).
  function emitBox(cx, cy, z0, w, h, color) {
    if (w <= 0 || h <= 0) return;
    const hw = w / 2, z1 = z0 + h;
    const c = [[cx-hw,cy-hw],[cx+hw,cy-hw],[cx+hw,cy+hw],[cx-hw,cy+hw]]; // CCW
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      const fi = [c[i][0], c[i][1], z0], ti = [c[i][0], c[i][1], z1];
      const tj = [c[j][0], c[j][1], z1], fj = [c[j][0], c[j][1], z0];
      quadFace(fi, ti, tj, fj, color); // outward
    }
    quadFace([c[0][0],c[0][1],z1],[c[1][0],c[1][1],z1],[c[2][0],c[2][1],z1],[c[3][0],c[3][1],z1], color);
  }
```

In `emitDecorations` (line ~347), add branches before the closing brace of the loop (after the `reed` branch):

```js
      } else if (d.type === 'rock') {
        emitCone(d.x, d.y, d.z, d.height, d.radius, 5, ROCK_COLOR);
      } else if (d.type === 'building') {
        emitBox(d.x, d.y, d.z, d.width, d.wallHeight, WALL_COLOR);
        emitCone(d.x, d.y, d.z + d.wallHeight, d.roofHeight, d.width * 0.78, 4, ROOF_COLOR);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/geometry.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/structures/geometry.js tests/geometry.test.mjs
git commit -m "feat(map-edit): rock + building decoration emitters (emitBox)"
```

---

### Task 14: `placeObject` (`map-edit.js`)

**Files:**
- Modify: `src/gl/map-edit.js`
- Test: `tests/map-edit.test.mjs`

- [ ] **Step 1: Write the failing test**

Append to `tests/map-edit.test.mjs`:

```js
import { placeObject } from '../src/gl/map-edit.js';

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/map-edit.test.mjs`
Expected: FAIL — `placeObject` not exported.

- [ ] **Step 3: Add `placeObject` to `map-edit.js`**

Append:

```js
// Place an object of `type` at ground point [x,y] (already in the tile's local
// frame). Clamps inside the picked cell, sets z to the cell's surface top,
// appends to tile.edit.objects, bumps epoch. Returns false if off any cell.
export function placeObject(tile, type, mesh, point) {
  const def = getObjectDef(type);
  if (!def) return false;
  const cell = cellAt(mesh, point[0], point[1]);
  if (cell < 0) return false;
  const [cx, cy] = cellCentroid(mesh, cell);
  const inr = cellInradius(mesh, cell);
  // clamp the point to within 0.8·inradius of the centroid (keeps it in-cell)
  let dx = point[0] - cx, dy = point[1] - cy;
  const d = Math.hypot(dx, dy), lim = inr * 0.8;
  if (d > lim && d > 0) { dx = dx / d * lim; dy = dy / d * lim; }
  const z = cellTopHeight(mesh, cell, tile.edit.heights) * FLOOR_H;
  const rec = def.make({ x: cx + dx, y: cy + dy, z, cell, inr });
  tile.edit.objects.push(rec);
  tile.edit.epoch++;
  return true;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/map-edit.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/gl/map-edit.js tests/map-edit.test.mjs
git commit -m "feat(map-edit): placeObject — append a registry object at the picked cell"
```

---

### Task 15: `objectPos` + `nearestObject` + `eraseAt` (`map-edit.js`)

**Files:**
- Modify: `src/gl/map-edit.js`
- Test: `tests/map-edit.test.mjs`

- [ ] **Step 1: Write the failing test**

Append to `tests/map-edit.test.mjs`:

```js
import { eraseAt, nearestObject } from '../src/gl/map-edit.js';

test('eraseAt removes the nearest object within radius and bumps epoch', () => {
  const m = patch(7);
  const [cx, cy] = cellCentroid(m, 0);
  const tile = { biomeId: 'meadows', seed: 7, edit: { heights: [0,0,0,0,0,0],
    objects: [{ type:'tree', cell:0, x:cx, y:cy, z:0 }], epoch: 5 } };
  const ok = eraseAt(tile, m, [cx, cy], 0.5);
  assert.equal(ok, true);
  assert.equal(tile.edit.objects.length, 0);
  assert.equal(tile.edit.epoch, 6);
});

test('eraseAt is a no-op when nothing is within radius', () => {
  const m = patch(7);
  const [cx, cy] = cellCentroid(m, 0);
  const tile = { biomeId: 'meadows', seed: 7, edit: { heights: [0,0,0,0,0,0],
    objects: [{ type:'tree', cell:0, x:cx, y:cy, z:0 }], epoch: 5 } };
  const ok = eraseAt(tile, m, [cx + 100, cy], 0.01);
  assert.equal(ok, false);
  assert.equal(tile.edit.objects.length, 1);
  assert.equal(tile.edit.epoch, 5);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/map-edit.test.mjs`
Expected: FAIL — `eraseAt`/`nearestObject` not exported.

- [ ] **Step 3: Add the three functions to `map-edit.js`**

Append:

```js
// An object's planar position. xy-records use x,y; cell-only records (water)
// use their cell centroid.
export function objectPos(mesh, o) {
  if (typeof o.x === 'number' && typeof o.y === 'number') return [o.x, o.y];
  const cell = Number.isInteger(o.cell) ? o.cell : (o.quadIndex | 0);
  return cellCentroid(mesh, cell);
}

// Index + distance of the nearest object to [x,y], or { index:-1 }.
export function nearestObject(tile, mesh, point) {
  let best = -1, bestD = Infinity;
  const objs = tile.edit.objects;
  for (let i = 0; i < objs.length; i++) {
    const [ox, oy] = objectPos(mesh, objs[i]);
    const d = Math.hypot(point[0] - ox, point[1] - oy);
    if (d < bestD) { bestD = d; best = i; }
  }
  return { index: best, dist: bestD };
}

// Remove the nearest object within `radius` of [x,y]. Returns true if removed.
export function eraseAt(tile, mesh, point, radius) {
  const { index, dist } = nearestObject(tile, mesh, point);
  if (index < 0 || dist > radius) return false;
  tile.edit.objects.splice(index, 1);
  tile.edit.epoch++;
  return true;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/map-edit.test.mjs`
Expected: PASS.

- [ ] **Step 5: Full suite**

Run: `node --test tests/*.mjs`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/gl/map-edit.js tests/map-edit.test.mjs
git commit -m "feat(map-edit): objectPos + nearestObject + eraseAt (right-click delete)"
```

---

### Task 16: Wire place/erase input in `map-view.js`

**Files:**
- Modify: `src/gl/map-view.js` (import; focus place-on-click + right-click erase)

- [ ] **Step 1: Extend the map-edit import**

Update the Task-7 import to include the new ops:

```js
import {
  bakeIfNeeded, buildFocusGeometry, cellAt, cellInradius,
  sculpt as editSculpt, placeObject as editPlace, eraseAt as editErase, ERASE_RADIUS_FACTOR,
} from './map-edit.js';
```

- [ ] **Step 2: Handle Place on click in focus mode**

In `focusSculptAt` (Task 9), the function returns early unless `tool.mode === 'sculpt'`. Add a sibling that runs on *click* (pointerdown), placing when a tool object is selected. Replace the `if (focusedTile) focusSculptAt(ev);` line in `onPointerDown` with:

```js
  if (focusedTile) {
    if (tool.mode === 'place' && tool.objectId) focusPlaceAt(ev);
    else focusSculptAt(ev);
  }
```

Add `focusPlaceAt`:

```js
function focusPlaceAt(ev) {
  const { gp, cell, mesh } = focusGroundCell(ev);
  if (!gp || cell < 0) return;
  if (editPlace(focusedTile, tool.objectId, mesh, gp)) rebuildFocus();
}
```

- [ ] **Step 3: Right-click erases in focus mode (else retypes on the board)**

In `onContextMenu` (line ~357), branch on focus:

```js
function onContextMenu(ev) {
  ev.preventDefault();
  if (focusedTile) {
    const { gp, cell, mesh } = focusGroundCell(ev);
    if (!gp || cell < 0) return;
    const radius = cellInradius(mesh, cell) * ERASE_RADIUS_FACTOR;
    if (editErase(focusedTile, mesh, gp, radius)) rebuildFocus();
    return;
  }
  const gp = unprojectToGround(ev.clientX, ev.clientY);
  const tile = pickTileAt(gp);
  if (!tile) { hideMenu(); return; }
  showMenu(tile, ev.clientX, ev.clientY);
}
```

- [ ] **Step 4: Verify (smoke)**

Run: `node --test tests/*.mjs` — confirm no import/syntax break.

- [ ] **Step 5: Commit**

```bash
git add src/gl/map-view.js
git commit -m "feat(map-edit): focus-mode place-on-click + right-click erase"
```

---

### Task 17: Object palette in the focus panel

**Files:**
- Modify: `src/gl/map-edit-controls.js` (palette), `src/main.js` (already wired via `onTool`)

- [ ] **Step 1: Add the palette to `createMapEditControls`**

After the Raise/Lower row in `map-edit-controls.js`, add (uses `OBJECTS` for labels):

```js
  // Object palette: a "Sculpt" (none) chip + one chip per placeable object.
  // Selecting an object switches the tool to place-mode; "Sculpt" returns to
  // sculpt-mode. Right-click always erases (handled in map-view).
  const palRow = document.createElement('div');
  palRow.className = 'ctrl-row';
  const palLbl = document.createElement('span');
  palLbl.className = 'ctrl-label';
  palLbl.textContent = 'Place';
  palRow.appendChild(palLbl);
  const pal = document.createElement('div');
  pal.className = 'seg-group';
  let selected = null; // null = sculpt
  const chips = new Map();
  const select = (objectId) => {
    selected = objectId;
    for (const [id, btn] of chips) btn.classList.toggle('seg-active', id === objectId);
    if (objectId) onTool({ mode: 'place', dir, objectId });
    else onTool({ mode: 'sculpt', dir, objectId: null });
  };
  const chip = (id, label) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'seg-btn';
    b.textContent = label;
    b.addEventListener('click', () => select(id === selected ? null : id));
    chips.set(id, b);
    pal.appendChild(b);
  };
  chip(null, 'Sculpt');
  for (const o of OBJECTS) chip(o.id, o.label);
  palRow.appendChild(pal);
  aside.appendChild(palRow);
  chips.get(null).classList.add('seg-active'); // default to Sculpt
```

Add the import at the top of `map-edit-controls.js`:

```js
import { OBJECTS } from '../structures/objects.js';
```

- [ ] **Step 2: Verify (smoke)**

Run: `node --test tests/*.mjs` — confirm no break (this is DOM code; the suite just confirms imports resolve under Node when other tests import siblings — `map-edit-controls.js` itself isn't imported by tests, so this is a syntax sanity check via the browser).

- [ ] **Step 3: Commit**

```bash
git add src/gl/map-edit-controls.js
git commit -m "feat(map-edit): object palette (Sculpt + Tree/Rock/Building/Water)"
```

---

### Task 18: Retype keeps edits + recolors; DEMO test hooks

**Files:**
- Modify: `src/main.js` (retype handler; `?focus=` + `window.__mapEdit`)

- [ ] **Step 1: Retype preserves edits (recolor only)**

Replace the `setMapOnRetype(...)` body (line ~584-590):

```js
setMapOnRetype((tile, biomeId) => {
  if (!hexMap || !tile) return;
  hexMap.setBiome(tile, biomeId);
  // An EDITED tile keeps its sculpt + objects; only the biome (→ colorize +
  // height cap) changes. An UNEDITED tile regenerates from the new biome (its
  // cache key has epoch 0, so the next board build re-generates it).
  markMapDirty();
});
```

(No code change is needed to "keep" edits — `buildTileGeometry` already renders from `tile.edit` when present, applying the new biome's `colorize`. This step documents + verifies the behavior.)

- [ ] **Step 2: Add DEMO hooks for headless verification**

In the existing `if (DEMO && typeof window !== 'undefined') { … }` block (line ~596), add:

```js
  // ?focus=q,r — enter focus on a tile on boot (deterministic screenshots).
  // window.__mapEdit('sculpt'|'place'|'erase', …) drives an edit then redraws.
  window.__mapFocus = (q, r) => {
    const t = hexMap && hexMap.getTile(q, r);
    return t ? enterFocus(t) : false;
  };
  window.__mapEdit = (op, ...args) => {
    // op: 'tool' {mode,dir,objectId} | 'sculptStroke' not needed headless;
    // expose direct ops through map-view's tool + a synthetic ground click is
    // hard headless, so call the edit module path used by the UI:
    return mapEditApply(op, ...args);
  };
  const f = new URLSearchParams(location.search).get('focus');
  if (f) {
    const [qs, rs] = f.split(',');
    window.__mapFocus(parseInt(qs, 10), parseInt(rs, 10));
  }
```

Add `enterFocus` to the `./gl/map-view.js` import, and a thin `mapEditApply` helper that imports the edit ops + the focused tile/mesh from map-view. For headless determinism, expose a single map-view function `applyFocusEdit(op, payload)` that operates on the focused tile and redraws:

In `map-view.js` add (after `setMapTool`):

```js
// DEMO/test hook: apply an edit to the focused tile by op name, then rebuild.
//   op 'sculpt'  payload { cellIdx, dir }
//   op 'place'   payload { type, point:[lx,ly] }
//   op 'erase'   payload { point:[lx,ly] }
export function applyFocusEdit(op, payload = {}) {
  if (!focusedTile || !liveMap) return false;
  const mesh = tileMesh(focusedTile, liveMap);
  const biome = getBiome(focusedTile.biomeId);
  let ok = false;
  if (op === 'sculpt') ok = (editSculpt(focusedTile, payload.cellIdx, payload.dir, biome.maxHeight, mesh), true);
  else if (op === 'place') ok = editPlace(focusedTile, payload.type, mesh, payload.point);
  else if (op === 'erase') ok = editErase(focusedTile, mesh, payload.point, cellInradius(mesh, cellAt(mesh, payload.point[0], payload.point[1])) * ERASE_RADIUS_FACTOR);
  if (ok) rebuildFocus();
  return ok;
}
```

In `main.js`, import `applyFocusEdit` and define `mapEditApply = (op, payload) => applyFocusEdit(op, payload);`.

- [ ] **Step 3: Verify the hooks (smoke)**

Run: `node --test tests/*.mjs` — confirm imports resolve.

- [ ] **Step 4: Commit**

```bash
git add src/main.js src/gl/map-view.js
git commit -m "feat(map-edit): retype preserves edits + DEMO ?focus / __mapEdit hooks"
```

---

### Task 19: Phase-2 cache-bust + full visual verification

**Files:**
- Modify: `sw.js` (precache `objects.js`), `index.html` (hint), then `scripts/bust.sh`

- [ ] **Step 1: Precache `objects.js` + run bust**

Add `'src/structures/objects.js'` to the SW precache list. Then:

Run: `bash scripts/bust.sh`
Expected: `cache bust complete — token <new>`.

- [ ] **Step 2: Full test run**

Run: `node --test tests/*.mjs`
Expected: all pass (objects + map-edit + geometry + the prior 179).

- [ ] **Step 3: Visual verification (direct WebGL screenshots, one Chrome at a time)**

```bash
python3 -m http.server 8777 >/tmp/srv.log 2>&1 &
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
GL="--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader --disable-gpu-sandbox"
# focus a tile + sculpt + place via the DEMO hooks, screenshot each step
"$CHROME" --headless $GL --window-size=1400,950 --virtual-time-budget=8000 \
  --screenshot=/tmp/focus-sculpt.png \
  "http://127.0.0.1:8777/?demo=1&radius=2&focus=0,0#map"
```

For multi-step (place/erase) screenshots, drive `window.__mapEdit` via a tiny URL-param sequence or evaluate-on-load hook (extend `?focus=` handling to also accept `&edit=place:tree@0` if richer determinism is wanted). Confirm by reading `/tmp/focus-sculpt.png`:
- Focusing renders one centered patch with the "edit tile" panel (Raise/Lower + palette).
- A sculpt raises a flat block; a placed tree/rock/hut/water appears; erase removes one.
- Exit (Esc/Back) returns to the board and the edited tile reflects the change.
- A water tile is NOT focusable (clicking it does nothing).

Also re-screenshot `#grid`, `#3d`, `#about`, and the plain `#map` board to confirm no regressions, and dump-DOM the tab state.

- [ ] **Step 4: Commit**

```bash
git add sw.js index.html src/ vendor/ styles.css
git commit -m "chore(map-edit): precache objects.js + cache-bust (Phase 2)"
```

---

### Task 20: Ship

- [ ] **Step 1: Merge to main + re-bust + push (project pattern)**

```bash
git checkout main
git merge --no-ff feat/map-tile-editing -m "Merge feat/map-tile-editing: focus-mode tile editing (sculpt + objects)"
bash scripts/bust.sh                 # unify token on main
node --test tests/*.mjs              # green
git add -A && git commit -m "chore: re-bust after map-tile-editing merge"
git push origin main
```

- [ ] **Step 2: Confirm GitHub Pages redeploy** — poll the live token until it matches `sw.js`'s `CB_TOKEN`; screenshot the live `#map` focusing a tile.

- [ ] **Step 3: deban sync** — log the feature shipped; delete the merged branch.

---

## Self-Review

**1. Spec coverage:**
- Focus mode (enter/exit, camera reframe) → Tasks 8, 10. ✓
- Terrain sculpt (left-drag, raise/lower, flat block, clamp) → Tasks 5, 9, 10. ✓
- Object palette + place (click) + erase (right-click) → Tasks 12, 14, 15, 16, 17. ✓
- WYSIWYG bake (procedural → editable, auto-decos erasable) → Task 4 (heights+objects), erasable via Task 15. ✓
- Object meshes tree/rock/building/water → Tasks 12 (records) + 13 (rock/building emitters; tree/water reuse existing). ✓
- Objects ride terrain → Task 6 (z refresh in buildFocusGeometry) + test. ✓
- Board cache key includes epoch; edited tile shows on board after exit → Tasks 7, 8 (exitFocus drops the stale cache entry). ✓
- Water tiles not focusable → Task 8 (`enterFocus` guards `biomeId==='water'`). ✓
- Retype keeps edits + recolors → Task 18. ✓
- In-session only (Randomize/radius clears edits) → existing `clearMapCache`/`buildHexMap` rebuild new tiles with `edit:null`; meshCache is keyed by seed so new seeds get fresh meshes. NOTE: add `meshCache.clear()` to `clearMapCache` (Task 7 amend) so stale meshes don't linger across radius/randomize. **(Fix applied below.)**
- DEMO hooks for headless verify → Task 18. ✓
- Don't touch view3d / regress other tabs → no task modifies `view3d.js`; Tasks 11/19 re-verify other tabs. ✓

**Fix applied (meshCache clearing):** In Task 7, also update `clearMapCache`:

```js
export function clearMapCache() { tileCache.clear(); meshCache.clear(); markMapDirty(); }
```

**2. Placeholder scan:** No "TBD"/"add error handling"/"similar to". The only soft spot is Task 18's richer multi-edit screenshot driver — the single `?focus=` + `applyFocusEdit` path is concrete; richer sequencing is explicitly optional. Acceptable.

**3. Type consistency:**
- `sculpt(tile, cellIdx, dir, maxHeight, mesh)` — same signature in Task 5 (def), Task 9 (`editSculpt` call), Task 18 (`applyFocusEdit`). ✓
- `placeObject(tile, type, mesh, point)` — Task 14 def, Task 16 (`editPlace`), Task 18. ✓
- `eraseAt(tile, mesh, point, radius)` — Task 15 def, Task 16, Task 18. ✓
- `buildFocusGeometry(tile, mesh)` — Task 6 def; Tasks 7, 8 calls. ✓
- `tile.edit = { heights:number[], objects, epoch }` — consistent across Tasks 4, 5, 6, 14, 15. ✓
- Object records use the exact fields `emitDecorations` reads (tree: trunk/canopy radius+height; rock: radius+height; building: width+wallHeight+roofHeight; water: quadIndex+z) — registry (Task 12) matches emitters (Task 13) and existing branches. ✓

No further issues.
