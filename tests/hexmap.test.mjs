// hexmap.test.mjs — MAP-1 board model tests. Run with: node --test
//
// Pure logic, NO DOM. Covers:
//   1. tile count == 1 + 3R(R+1) for R = 1, 2, 3 (7 / 19 / 37).
//   2. gap-free honeycomb tiling — adjacent tile centers are EXACTLY Rc·√3
//      apart (edge-sharing); non-adjacent tiles are further; and the actual
//      hex PATCHES abut (every node of a shared edge coincides between two
//      neighboring patches — the load-bearing "no gaps/overlaps" guarantee).
//   3. default biome assignment is deterministic per seed.
//   4. getTile / setBiome / neighbors helpers.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createHexMap } from '../src/structures/hexmap.js';
import { hexLattice, hexDistance } from '../src/hex.js';
import { BIOMES } from '../src/structures/biomes.js';

const SQRT3 = Math.sqrt(3);

// --- 1. tile count ---------------------------------------------------------
for (const R of [1, 2, 3]) {
  test(`createHexMap: tile count == 1 + 3R(R+1) (radius ${R})`, () => {
    const map = createHexMap({ radius: R, seed: 7 });
    const expected = 1 + 3 * R * (R + 1);
    assert.equal(map.tiles.length, expected, `radius=${R} -> ${expected} tiles`);
    // every tile is inside the hex of radius R, and unique (q,r)
    const seen = new Set();
    for (const t of map.tiles) {
      assert.ok(hexDistance(t.q, t.r) <= R, `tile (${t.q},${t.r}) within radius`);
      const k = t.q + ',' + t.r;
      assert.ok(!seen.has(k), `tile (${k}) unique`);
      seen.add(k);
    }
  });
}

test('createHexMap: explicit counts (1→7, 2→19, 3→37)', () => {
  assert.equal(createHexMap({ radius: 1, seed: 1 }).tiles.length, 7);
  assert.equal(createHexMap({ radius: 2, seed: 1 }).tiles.length, 19);
  assert.equal(createHexMap({ radius: 3, seed: 1 }).tiles.length, 37);
});

// --- 2. gap-free tiling ----------------------------------------------------
test('tiling: adjacent tile centers are EXACTLY Rc·√3 apart', () => {
  const ringsPerTile = 3, spacing = 0.1;
  const map = createHexMap({ radius: 2, seed: 3, ringsPerTile, spacing });
  const Rc = ringsPerTile * spacing;
  const pitch = Rc * SQRT3;
  assert.ok(Math.abs(map.Rc - Rc) < 1e-12, 'Rc derived correctly');
  assert.ok(Math.abs(map.pitch - pitch) < 1e-12, 'pitch == Rc·√3');

  const NEIGH = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, -1], [-1, 1]];
  let checked = 0;
  for (const t of map.tiles) {
    for (const [dq, dr] of NEIGH) {
      const n = map.getTile(t.q + dq, t.r + dr);
      if (!n) continue;
      const d = Math.hypot(n.center[0] - t.center[0], n.center[1] - t.center[1]);
      assert.ok(
        Math.abs(d - pitch) < 1e-9,
        `adjacent (${t.q},${t.r})↔(${n.q},${n.r}) distance ${d} must equal Rc·√3 ${pitch}`
      );
      checked++;
    }
  }
  assert.ok(checked >= 12, `checked several adjacent pairs (${checked})`);
});

test('tiling: non-adjacent tiles are strictly further than Rc·√3 (no overlap)', () => {
  const map = createHexMap({ radius: 2, seed: 3, ringsPerTile: 3, spacing: 0.1 });
  const pitch = map.pitch;
  for (const a of map.tiles) {
    for (const b of map.tiles) {
      if (a === b) continue;
      const d = Math.hypot(b.center[0] - a.center[0], b.center[1] - a.center[1]);
      // distance-2 (or more) on the axial lattice → strictly more than pitch.
      if (hexDistance(b.q - a.q, b.r - a.r) >= 2) {
        assert.ok(d > pitch + 1e-9, `non-adjacent pair too close: d=${d} pitch=${pitch}`);
      }
    }
  }
});

test('tiling: neighboring PATCHES share a full edge gap-free (all rings+1 nodes coincide)', () => {
  const ringsPerTile = 3, spacing = 0.1;
  const map = createHexMap({ radius: 1, seed: 11, ringsPerTile, spacing });
  // Build the actual hex patch (translated to its center) for each tile.
  const patch = (t) => hexLattice({ rings: ringsPerTile, spacing, center: t.center }).points;
  const center = map.getTile(0, 0);
  const A = patch(center);
  const NEIGH = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, -1], [-1, 1]];
  let neighborsChecked = 0;
  for (const [dq, dr] of NEIGH) {
    const nt = map.getTile(dq, dr);
    assert.ok(nt, `neighbor (${dq},${dr}) exists on a radius-1 board`);
    const B = patch(nt);
    let coincident = 0;
    for (const a of A) {
      for (const b of B) {
        if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-9) { coincident++; break; }
      }
    }
    // A full shared edge of an R-ring patch has exactly (rings+1) nodes.
    assert.equal(
      coincident, ringsPerTile + 1,
      `neighbor (${dq},${dr}) must share a full edge (${ringsPerTile + 1} nodes), got ${coincident}`
    );
    neighborsChecked++;
  }
  assert.equal(neighborsChecked, 6, 'all 6 neighbors checked on a radius-1 board');
});

// --- 3. deterministic biome assignment -------------------------------------
test('biomes: deterministic per seed; different seed differs', () => {
  const a = createHexMap({ radius: 2, seed: 99 });
  const b = createHexMap({ radius: 2, seed: 99 });
  assert.deepEqual(
    a.tiles.map((t) => t.biomeId),
    b.tiles.map((t) => t.biomeId),
    'same seed → identical biome spread'
  );
  // every assigned biome is a real biome id
  const ids = new Set(BIOMES.map((x) => x.id));
  for (const t of a.tiles) assert.ok(ids.has(t.biomeId), `valid biome id ${t.biomeId}`);

  const c = createHexMap({ radius: 2, seed: 100 });
  const differs = a.tiles.some((t, i) => t.biomeId !== c.tiles[i].biomeId);
  assert.ok(differs, 'a different seed should change the biome spread');
});

test('seeds: per-tile seeds are deterministic and (mostly) distinct', () => {
  const a = createHexMap({ radius: 2, seed: 5 });
  const b = createHexMap({ radius: 2, seed: 5 });
  assert.deepEqual(a.tiles.map((t) => t.seed), b.tiles.map((t) => t.seed));
  const seeds = new Set(a.tiles.map((t) => t.seed));
  // 19 tiles → expect 19 distinct per-tile seeds (hash collisions vanishingly rare)
  assert.equal(seeds.size, a.tiles.length, 'per-tile seeds distinct');
});

// --- 4. helpers ------------------------------------------------------------
test('getTile: returns the tile at (q,r) or null', () => {
  const map = createHexMap({ radius: 2, seed: 1 });
  const t = map.getTile(0, 0);
  assert.ok(t && t.q === 0 && t.r === 0, 'center tile present');
  assert.equal(map.getTile(99, 99), null, 'off-board → null');
});

test('setBiome: swaps the biome id, keeps the grid seed', () => {
  const map = createHexMap({ radius: 1, seed: 1 });
  const t = map.getTile(0, 0);
  const seedBefore = t.seed;
  const ok = map.setBiome(t, 'mountains');
  assert.ok(ok);
  assert.equal(t.biomeId, 'mountains', 'biome swapped');
  assert.equal(t.seed, seedBefore, 'grid seed unchanged (keep the grid)');
  // 'water' sentinel accepted
  assert.ok(map.setBiome(t, 'water'));
  assert.equal(t.biomeId, 'water');
});

test('neighbors: center tile has 6, edge tiles fewer', () => {
  const map = createHexMap({ radius: 2, seed: 1 });
  const center = map.getTile(0, 0);
  assert.equal(map.neighbors(center).length, 6, 'center has 6 neighbors');
  // a corner of the radius-2 board has fewer than 6
  const corner = map.getTile(2, 0);
  assert.ok(corner, 'corner tile exists');
  assert.ok(map.neighbors(corner).length < 6, 'corner has < 6 neighbors');
  // all returned neighbors are adjacent (hex-distance 1)
  for (const n of map.neighbors(center)) {
    assert.equal(hexDistance(n.q - center.q, n.r - center.r), 1, 'neighbor is adjacent');
  }
});
