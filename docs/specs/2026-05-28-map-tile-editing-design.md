# Design spec — Map tile editing (focus-mode terrain sculpt + object placement)

**Date:** 2026-05-28
**Status:** draft — awaiting operator review
**Author:** Kai Denrei (Claude Opus 4.7)

## Scope

Make individual **Map** tiles editable: a player drills into one tile, sculpts its
terrain (add/remove height), and places or removes objects (trees, rocks, huts,
water) on its cells. Builds directly on the shipped Hexagon Map (the board of
distinct biome hex-patches) — see `docs/specs/2026-05-28-hexagon-map-design.md`.

- **In scope:**
  - **Focus mode** — click a board tile to focus the camera on that single hex
    patch; edit there; exit back to the board.
  - **Terrain sculpt** — left-drag raises/lowers a cell (one floor per step,
    flat-block, clamped to the biome's height cap). Raise/Lower toggle.
  - **Object placement / removal** — an object palette (Tree / Rock / Building /
    Water); select a type + left-click to place; right-click to erase the nearest
    object. WYSIWYG: a tile's auto-generated decorations bake into the same
    editable object set, so auto-placed props are removable too.
- **Deferred / out of scope:**
  - Cross-reload persistence (save/load a board). Edits are **in-session only**,
    matching the rest of the app (nothing touches disk). Logged as a future
    feature.
  - In-place (no-focus) board editing — explicitly declined in favor of focus mode.
  - New object *categories* beyond the four; object rotation/scale handles; roads/
    paths. The palette is built to extend, but only four types ship.
- **Unchanged:** the Grid tab, the 3D terrain playground (`view3d.js` is NOT
  touched), the Stålberg's-Breakthrough tab, the board model's tiling/biome/retype
  behavior, the cache-bust pipeline, the PWA.

## Why this is tractable

A Map tile **is** a hex patch with a per-vertex height field and a list of
decoration records — the same data the 3D playground already sculpts and the same
records `buildSceneGeometry`/`emitDecorations` already render. Focus mode reuses
the existing WebGL renderer, the fixed-iso ortho camera, the `buildSceneGeometry`
pipeline, and the playground's flat-block raise/lower behavior. The only genuinely
new pieces are: a small editable per-tile state, two new object meshes (rock, hut),
and the focus-mode shell (enter/exit + input routing + a panel).

## Architecture

### Data model — `tile.edit` (in-memory, on the `hexMap` tile)

Each tile gains an optional edit record; `null` means "procedural, as today":

```js
tile.edit = {
  heights: number[],     // per primary vertex; overrides biome.generate(...)
  objects: ObjectRecord[],// the unified editable object set (see below)
  epoch: number,         // bumped on every edit; part of the board cache key
}
```

- **Bake on first focus** (`bakeIfNeeded(tile, map)`): when `tile.edit` is `null`,
  populate it from the tile's current procedural output —
  `heights` from `biome.generate(mesh, …)`, `objects` from
  `generateDecorations({ biome, mesh, heights, seed })`. After baking the tile
  renders from `tile.edit` and never re-generates.
- **`ObjectRecord`** reuses the existing decoration schema so it flows through the
  same emitter: `{ type, x, y, z, …typeParams, cell }` where `type ∈
  {'tree','rock','building','water'}` (existing `'flower'`/`'pond'`/`'reed'` records
  survive a bake unchanged and remain erasable), and `cell` is the quad index the
  object sits on (so its `z` can ride terrain edits).

`hexmap.js` stays pure: `edit` is plain data attached to the tile object. The
mutation ops live in `map-edit.js`. `createHexMap` initializes `edit: null`.

### New / touched modules

| Module | New? | Responsibility |
|---|---|---|
| `src/structures/objects.js` | new (pure) | Placeable-object registry: `OBJECTS = [{ id, label, make(point, cellZ, cellIdx, rng) → ObjectRecord }]` for tree / rock / building / water. Tree + water reuse existing decoration param shapes; rock + building define theirs. Shared by the palette UI and the bake/place path. Node-tested. |
| `src/structures/geometry.js` | touched | Add `rock` and `building` branches to `emitDecorations`, plus an `emitBox` helper (hut walls + a short pyramid roof; rock = a low faceted `emitCone`). Existing type branches untouched. |
| `src/gl/map-edit.js` | new | Focus-mode editor logic + single-tile geometry. Holds `focusedTile`; pure-ish ops `bakeIfNeeded`, `sculpt(tile, cellIdx, dir, maxH)`, `placeObject(tile, type, groundPt, mesh, heights)`, `eraseAt(tile, groundPt)`; picking math `cellAt(mesh, pt)` (point-in-quad) and `nearestObject(tile, pt, radius)`. Builds the focused tile's geometry (from `tile.edit`, centered at origin) via `buildSceneGeometry`. |
| `src/gl/map-view.js` | touched | Board view as today, plus: classify a left press+release with negligible drag on a tile as `enterFocus(tile)` (left-drag still pans; right-click still retypes); while `focusedTile` is set, route draw + pointer/right-click to `map-edit`; expose `enterFocus`/`exitFocus`/`isFocused`. Board tile-cache key → `seed:biomeId:epoch`. Per-tile **relaxed mesh** cached (keyed by `seed`) so sculpt rebuilds are cheap. |
| `src/gl/map-edit-controls.js` | new | Focus panel UI (mirrors `map-controls.js`): a Raise/Lower toggle, the object palette (Tree/Rock/Building/Water + a "Sculpt"/none state that returns left-click to sculpting), and a "← Board" exit button. |
| `src/main.js` | touched | Own focus enter/exit wiring; swap the Map panel between the board controls and the edit controls on focus; route Esc to exit; pass the active tool/object selection into `map-edit`. |
| `index.html` / `sw.js` | touched | Precache the two new modules; run `bust.sh` to unify the token. |

### Object meshes (via `emitDecorations`)
- **Tree** — existing cylinder trunk + cone canopy.
- **Water** — existing pond disk.
- **Rock (new)** — a low, wide faceted cone/dome in grey (reuse `emitCone`, low height, few sides).
- **Building / hut (new)** — `emitBox` walls + a short pyramid/`emitCone` roof; small, Catan-settlement scale, warm-neutral walls + accent roof.

## Interaction & data flow

**Board view (unchanged inputs + one addition):**
- Left press→release, drag below a small px threshold, on a land tile → `enterFocus(tile)`.
- Left-drag (≥ threshold) → pan (as today). Right-click → biome retype menu (as today).
- Click on a **water** tile or empty sea → no focus (hint in the status line).

**`enterFocus(tile)`** → `bakeIfNeeded(tile, map)`; set `focusedTile`; swap the panel
to the edit controls; `camera.frameBounds(tileBounds)` so the single tile fills the
view; status line shows the edit hint.

**Focus-mode input:**
- *Sculpt active (no object selected):* left-click/drag → `cellAt` picks the cell →
  `sculpt(tile, cellIdx, dir, biome.maxHeight)` sets that cell's 4 corner heights to
  a common flat block (±1 floor), clamped `[0, maxHeight]` raise / `≥0` lower. Drag
  paints across cells (one step per newly-entered cell, like the playground).
- *Object selected:* left-click → `placeObject(tile, type, groundPt, …)` → registry
  `make()` produces a record at the picked cell (xy clamped inside the cell, `z` =
  cell height), appended to `tile.edit.objects`.
- *Right-click → erase:* `eraseAt(tile, groundPt)` removes the nearest object within
  a small world radius; no-op if none. (Terrain removal is Lower-sculpt, so
  right-click means "delete object" unambiguously.)
- Every edit bumps `tile.edit.epoch` and rebuilds the focused geometry.

**`exitFocus()`** (← Board button or **Esc**) → clear `focusedTile`; restore the
board panel; the edited tile's board-cache entry (now keyed by the new `epoch`)
rebuilds on the next board draw so the edit shows; `camera.frameBounds(boardBounds)`.

## Rendering & cache
- `drawMapView`: if `focusedTile` → render only that tile's geometry (from
  `tile.edit`, centered at origin); else the board (as today).
- Board tile-cache key: `seed:biomeId:epoch`. Editing bumps `epoch` → only that tile
  rebuilds; all others reuse cache. `'water'` tiles still render nothing (sea shows).
- **Mesh reuse:** the relaxed patch mesh is deterministic from `seed`; cache it per
  tile (keyed by `seed`) so both bake and per-edit rebuilds skip re-relaxing.
- **Objects ride terrain:** at build time each object's `z` is read from its `cell`'s
  current height, so sculpting under an object lifts/drops it with the surface.
- Camera transitions reuse `frameBounds` (snap, matching the existing reframe
  pattern). Animated tween is a possible polish, not in scope.

## Edge cases / decisions
- **Water tiles** aren't focus-editable; retype to a land biome first.
- **Retype an edited tile** (right-click on the board): keep `tile.edit` (heights +
  objects), re-run the new biome's `colorize` only (recolor). Retype an *unedited*
  tile regenerates from the new biome, as today.
- **Randomize map / radius change** clears all `tile.edit` (new per-tile seeds) — the
  clean-slate is expected. In-session only; a reload starts fresh.
- **Sculpt height cap** uses the focused tile's biome `maxHeight`.

## Constraints
Vanilla ESM, no build step, no new dependencies, WebGL2. `objects.js` + the
`map-edit.js` edit/picking ops are pure and Node-tested. Do NOT modify `view3d.js`
or otherwise regress the Grid / 3D / About tabs, the Map board's tiling/biome/retype,
mobile layout, the cache pipeline, or the PWA.

## Tests

**Node (pure logic):**
- `objects.js`: `make()` returns a valid, deterministic `ObjectRecord` per type.
- `map-edit.js`: `bakeIfNeeded` populates `heights` + `objects` from the procedural
  output (and is idempotent); `sculpt` raises/lowers a cell's 4 corners and clamps to
  `[0, maxHeight]`; `placeObject` appends a record at the picked cell with `z` = cell
  height; `eraseAt` removes the nearest object within radius and is a no-op otherwise;
  every mutating op bumps `epoch`.
- Picking: `cellAt` (point-in-quad) and `nearestObject` return correct results.
- Regression: the existing suite stays green; the board cache-key change still renders
  the board.

**Browser (WebGL via direct `--screenshot` only — CDP has no GL here):**
- Enter focus on a tile (camera fills with one patch), sculpt a raised block, place a
  tree + rock + hut + water, erase one object, exit → the board tile reflects the
  edits.
- A baked tile's auto-decorations are erasable (right-click removes an auto tree).
- A water tile is not focusable.
- Grid / 3D / About / Map-board unregressed; mobile layout intact.

## Verify (recipe)
- `node --test tests/*.mjs` green.
- Serve (`python3 -m http.server 8777`) + **direct** `--screenshot`
  (`--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader
  --disable-gpu-sandbox`; one Chrome at a time). Use the DEMO test hooks below.
- DEMO-gated headless hooks (parallel to the map's existing `?retype=` hook), inert
  in the shipped build: `?focus=q,r` to enter focus on a tile, and a
  `window.__mapEdit(op, …)` to drive sculpt/place/erase for a deterministic
  before/after screenshot.
- Read UI/tool state from `--dump-dom` (`aria-selected`/active tool), not from a
  screenshot — screenshots have misread fine UI state before.

## Suggested phasing (for the implementation plan)
- **MAP-EDIT-1** — focus shell (enter/exit, camera reframe, panel swap, single-tile
  render) + terrain sculpt (reuse flat-block raise/lower) + cache-key/epoch + mesh
  cache. No objects yet.
- **MAP-EDIT-2** — `objects.js` registry + rock/hut emitters + WYSIWYG bake +
  palette place/erase + the DEMO hooks. Then re-bust + ship.

## Decisions flagged for review
1. **Right-click = erase object only** (terrain removal via Lower-sculpt). Alternative:
   right-click also lowers a bare cell. Chosen: object-only, to keep right-click
   unambiguous.
2. **Retype keeps edits + recolors** (vs. wiping edits on any retype). Chosen: preserve
   the player's work.
3. **In-session persistence only.** A save/load board feature is logged as future, not
   built now.
4. **Snap camera on focus enter/exit** (no animated tween) for MVP.
