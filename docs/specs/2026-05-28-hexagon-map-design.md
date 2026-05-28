# Design spec — Hexagon map (Catan-style board of biome tiles)

**Date:** 2026-05-28
**Status:** draft — awaiting operator review
**Author:** Kai Denrei (Claude Opus 4.7)

## Scope
A **new "Map" tab**: a board of hexagonal biome **tiles** (homage to Catan), default
**19** (radius-2 hex-of-hexes) centered and surrounded by water, the count
changeable. Tiles **abut as distinct tiles** (each its own biome terrain — crisp
seams, not a continuous mesh). Each tile has its **own seed** (a unique organic
grid). **Right-click a tile → pick its biome type** (regenerates that tile).

- **In scope:** MAP-1 (the board) + MAP-2 (right-click retype).
- **Deferred / logged as future features:** MAP-3 polish (water shimmer, tile-edge
  definition, per-tile rotation), and **seamless-mesh tiles** (stitching shared
  boundaries into one continuous landscape — the old "infinite grid" idea; the
  operator wants the distinct-tile board first).
- **Unchanged:** the single-patch 3D terrain playground (the 3D tab stays as-is).

## Why this is tractable
Each hex patch's outer edge is a **pinned, perfect regular hexagon** (the H1 fix).
Regular hexagons tile the plane, so "combining hexagons" is **placement**, not the
hard seamless-stitching problem: drop patches on a honeycomb lattice and adjacent
tiles' straight boundary edges **coincide gap-free**. Distinct biomes per tile show
a clean seam at those edges — exactly the Catan look.

## Architecture

### `src/structures/hexmap.js` (pure, Node-tested)
- `createHexMap({ radius = 2, seed }) → { tiles, radius }` where `tiles` is an array
  of `{ q, r, center:[x,y], biomeId, seed }` for every axial `(q,r)` with hex-distance
  `max(|q|,|r|,|q+r|) ≤ radius`. Count = `1 + 3·radius·(radius+1)` (7 / 19 / 37 …).
- **Tile world centers** lie on a **honeycomb lattice** whose pitch matches the
  patch's regular-hexagon **circumradius** `Rc` (derived from the patch's rings ×
  spacing). The map lattice vectors must match the patch hexagon's orientation
  (flat-top vs pointy-top — read it off `hexLattice`'s basis) so the hexagon SHAPES
  abut edge-to-edge with no gap/overlap. **This geometry is the thing to get right;**
  unit-test that adjacent tile centers are exactly `Rc·√3` apart (edge-sharing).
- **Default biome assignment:** a seeded spread across the 6 biomes (Catan-ish
  variety; deterministic per map seed). Helpers: `getTile(q,r)`, `setBiome(tile, id)`,
  `neighbors(tile)`.

### Per-tile geometry (own seed)
For each tile: generate its **own** hex patch — `generateMesh({ seeder:'hex',
rings:R_patch, seed: tile.seed })` → relax (pinned boundary) → `biome.generate` heights
+ `biome.colorize` colors + `generateDecorations` → `buildSceneGeometry`, then
**translate** the tile's geometry to `tile.center`. Cache per tile; rebuild only a
tile that's retyped (MAP-2) or all tiles on a count/seed change. Merge all tiles'
buffers (+ water) into the renderer's VBO/IBO.
- **Perf:** N unique meshes = N relaxations at load. Use a **modest `R_patch`** for
  the map (e.g. 3 — smaller patches keep the board light) vs the playground's larger
  patches. Build is cached; only one tile rebuilds on retype.

### Water surround (`geometry.js` or a small helper)
A **sea plane** (a few quads) at `z ≈ 0` (or just below the tiles' base), spanning the
board bounds + a margin, in a blue-green color, rendered under the tiles. The "ocean"
frame around the hex cluster.

### `src/gl/map-view.js` (new — parallels `view3d.js`)
- Owns `#map-canvas` in `#view-map`. Reuses `camera.js` (fixed-iso ortho) + the
  renderer. Builds the merged board geometry; frames the **whole board** (camera
  fit over all tiles + water). Pan (WASD + two-finger) + zoom (wheel/pinch) +
  orientation — same controls as the playground.
- **Right-click a tile → biome picker:** unproject the click to the ground plane →
  find the tile whose hexagon contains the point (point-in-hexagon / nearest center) →
  show a small **DOM context menu** at the cursor listing the biomes (+ Water) →
  on pick, `setBiome` + rebuild that tile + redraw. (In the Map, right-click = retype,
  not lower — the per-cell build interaction lives in the playground.)

### UI — Map controls panel
Mirror the other tabs' panel (stacks on mobile): **Tiles** slider (radius 1–3 →
7/19/37), **Randomize map** (re-seed biomes + grids), **Orientation** (N/E/S/W),
**Zoom**. The biome picker is the right-click menu (a "Water" option lets a tile
become open sea).

### Integration
- `index.html`: add a **"Map" tab** (4th: Grid · 3D · **Map** · Stålberg's
  Breakthrough) + `#view-map` (canvas + panel).
- `tabs.js`: route `#map`; resize the map canvas on switch.
- `main.js`: own the map state (`createHexMap`), drive `map-view` when the Map tab
  is active. The 3D playground tab is untouched.
- `sw.js`: precache `src/structures/hexmap.js` + `src/gl/map-view.js`; run `bust.sh`.

## Constraints
Vanilla ESM, no build, no deps, WebGL2. `hexmap.js` pure + Node-tested. Don't break
Grid / 3D / About tabs, mobile, cache pipeline, or PWA.

## Tests
- `hexmap.js`: tile count `1+3R(R+1)` for R=1,2,3; adjacent tile centers exactly
  `Rc·√3` apart (gap-free tiling); default biome assignment deterministic per seed;
  `setBiome`/`neighbors`.
- Existing suite stays green.

## Verify (WebGL via direct `--screenshot` only — CDP has no GL here)
- `node --test` green.
- Direct screenshot of `#map` (`?demo=1#map`): a centered board of ~19 distinct biome
  hex tiles abutting gap-free, surrounded by water; varied per-tile grids. A
  radius=3 shot (37 tiles) and a radius=1 shot (7). Confirm tiles abut with no gaps
  and biomes are visibly mixed.
- Right-click retype: verify the menu appears and a tile changes biome (synthesize a
  right-click via a test hook or the camera/picking math).
- Grid / 3D / About unregressed.

## Decisions flagged for review
1. **Patch detail in the map:** `R_patch` rings per tile — I'll use **3** (lighter
   board) unless you want the full playground detail (heavier with 19+ unique grids).
2. **Retype re-seeds the grid?** When you change a tile's biome, keep its grid (just
   recolor + re-terrain) or also give it a fresh grid? I'll **keep the grid, swap the
   biome** (less jarring) — confirm.
3. **Water as a flat sea plane** (recommended) vs a ring of water-biome tiles.
4. **Default biome spread:** seeded random over the 6 biomes — or a fixed Catan-like
   distribution? I'll do **seeded random** unless you prefer a fixed recipe.
