// hexmap.js — MAP-1 the Catan-style board model. Pure logic, NO DOM, NO GL —
// Node-testable (tile count, gap-free tiling math, deterministic biomes).
//
// A board is a hex-of-hexes: every axial tile (q,r) with hex-distance
// max(|q|,|r|,|q+r|) <= radius. Each tile is a hexagonal terrain PATCH
// (a hexLattice of `ringsPerTile` rings, spacing `spacing`). The patches are
// regular hexagons with a CORNER pointing along +x (corners at world angles
// 0,60,...,300 — the hexLattice basis e1=(s,0), e2=(s/2, s√3/2)).
//
// ── The tiling geometry (the load-bearing bit) ──────────────────────────────
// A patch of `ringsPerTile` rings has its outermost CORNER node at axial
// (ringsPerTile,0) = ringsPerTile·(s,0), i.e. at distance Rc = ringsPerTile·s
// from the patch center. So the patch is a regular hexagon of circumradius
//   Rc = ringsPerTile · spacing
// with corners at angles 0,60,...,300 and EDGES facing 30,90,...,330. Two such
// hexagons abut edge-to-edge (gap-free, no overlap) when their centers are
// 2·apothem = 2·(Rc·√3/2) = Rc·√3 apart, along an edge-normal (30,90,...).
//
// So the MAP lattice basis is two of those edge-normal vectors, length Rc·√3:
//   m1 = Rc·√3 · (cos30°, sin30°)   (pitch along the 30° edge-normal)
//   m2 = Rc·√3 · (cos90°, sin90°)   (pitch along the 90° edge-normal)
// and a tile's world center is q·m1 + r·m2. Adjacent tiles (the 6 axial
// neighbors) are then exactly Rc·√3 apart and share a full edge: all
// (ringsPerTile+1) boundary nodes of that edge coincide between the two patches
// (verified empirically + in hexmap.test.mjs). That is what makes the seams
// crisp and gap-free — the Catan look.
//
//   createHexMap({ radius, seed, ringsPerTile, spacing }) -> {
//     radius, ringsPerTile, spacing, seed, Rc, pitch, tiles,
//     getTile(q,r), setBiome(tile,id), neighbors(tile),
//   }
//   tiles: [{ q, r, center:[x,y], biomeId, seed }]  — count = 1 + 3·R·(R+1)

import { hexDistance } from '../hex.js?v=a0f69c78';
import { BIOMES } from './biomes.js?v=a0f69c78';
import { mulberry32 } from '../rng.js?v=a0f69c78';

const SQRT3 = Math.sqrt(3);

// The 6 axial-neighbor offsets (q,r). For this map lattice these are the tiles
// whose centers sit exactly `pitch` (= Rc·√3) away — the edge-sharing neighbors.
const NEIGHBOR_OFFSETS = [
  [1, 0], [-1, 0],
  [0, 1], [0, -1],
  [1, -1], [-1, 1],
];

// Map-lattice basis from the patch circumradius. The two edge-normal directions
// 30° and 90°, scaled to the honeycomb pitch.
function latticeBasis(Rc) {
  const pitch = Rc * SQRT3;
  const d30 = (30 * Math.PI) / 180;
  const d90 = (90 * Math.PI) / 180;
  return {
    pitch,
    m1: [pitch * Math.cos(d30), pitch * Math.sin(d30)],
    m2: [pitch * Math.cos(d90), pitch * Math.sin(d90)],
  };
}

// World center for axial (q,r) on the map lattice.
function tileCenter(q, r, m1, m2) {
  return [q * m1[0] + r * m2[0], q * m1[1] + r * m2[1]];
}

// Per-tile seed: a deterministic hash of (mapSeed, q, r) so each tile gets its
// own organic grid + terrain, reproducibly. Mirrors the integer-hash primitive
// used across terrain.js / biomes.js / decorations.js so it decorrelates well.
function tileSeed(mapSeed, q, r) {
  let h = (mapSeed | 0) * 374761393 + (q | 0) * 668265263 + (r | 0) * 2246822519;
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 1274126177) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h >>> 0;
}

/**
 * Build the board model.
 * @param {{ radius?:number, seed?:number, ringsPerTile?:number, spacing?:number }} opts
 */
export function createHexMap({ radius = 2, seed = 0, ringsPerTile = 3, spacing = 0.1 } = {}) {
  const R = Math.max(0, radius | 0);
  const rpt = Math.max(1, ringsPerTile | 0);
  const Rc = rpt * spacing; // patch circumradius (corner-node distance)
  const { pitch, m1, m2 } = latticeBasis(Rc);

  // Deterministic biome stream over the map seed. Each tile draws one biome id.
  // (Seeded-random spread across the 6 biomes — the operator-confirmed default.)
  const rng = mulberry32(seed >>> 0);

  const tiles = [];
  const byKey = new Map(); // "q,r" -> tile
  for (let q = -R; q <= R; q++) {
    const rLo = Math.max(-R, -q - R);
    const rHi = Math.min(R, -q + R);
    for (let r = rLo; r <= rHi; r++) {
      if (hexDistance(q, r) > R) continue; // defensive (loop already clamps)
      const biomeId = BIOMES[Math.floor(rng() * BIOMES.length) % BIOMES.length].id;
      const tile = {
        q, r,
        center: tileCenter(q, r, m1, m2),
        biomeId,
        seed: tileSeed(seed, q, r),
        edit: null, // { heights:number[], objects:Record[], epoch } once edited (map-edit.js)
      };
      tiles.push(tile);
      byKey.set(q + ',' + r, tile);
    }
  }

  function getTile(q, r) {
    return byKey.get(q + ',' + r) || null;
  }

  // Re-terrain/recolor a tile to a new biome id. Keeps the tile's grid + seed
  // (operator default: just swap the biome; the per-tile mesh is unchanged).
  // 'water' is accepted as a sentinel id (an open-sea hole — handled by the
  // view, which skips terrain for water tiles).
  function setBiome(tile, id) {
    if (!tile) return false;
    tile.biomeId = id;
    return true;
  }

  // The up-to-6 existing neighbor tiles of `tile` (edge-sharing on this lattice).
  function neighbors(tile) {
    if (!tile) return [];
    const out = [];
    for (const [dq, dr] of NEIGHBOR_OFFSETS) {
      const n = getTile(tile.q + dq, tile.r + dr);
      if (n) out.push(n);
    }
    return out;
  }

  return {
    radius: R,
    ringsPerTile: rpt,
    spacing,
    seed: seed >>> 0,
    Rc,
    pitch,
    m1,
    m2,
    tiles,
    getTile,
    setBiome,
    neighbors,
  };
}

// Exposed for tests / callers that want the lattice math without a full board.
export { latticeBasis, tileCenter, NEIGHBOR_OFFSETS };
