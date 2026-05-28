---
project: oskar-procedure
created: 2026-05-27
status: active
mode: solo
stale_threshold_days: 30
---

# oskar-procedure — Index

## ✅ Hexagon Map SHIPPED (2026-05-28 — resume point resolved)

The **Hexagon Map** (MAP-1 board + MAP-2 right-click retype) is **verified, merged, and
live**. Resumed the WIP from `feat/hexagon-map` (9f00751): visually verified, re-busted,
merged to main (`789f39d`), token re-unified to `f9d2abf8` (`9c8f8a9`), pushed + deployed.

**Verification done this session (the prior session only got to code-complete):**
- **Gap-free tiling — the flagged #1 risk — PROVEN.** A Node diagnostic on the *actual
  rendered* patches (generateMesh hex → relax pinned → translate) showed adjacent tiles'
  boundary vertices coincide **exactly** (0.000000 cross-patch gap; 7 shared nodes per edge;
  patch radial min=apothem 0.25981, max=Rc 0.30000). The honeycomb math (pitch `Rc·√3`) is
  correct. NOTE: `hexmap.test.mjs`'s "patches share a full edge" test only checks the **raw
  `hexLattice` points**, not the rendered mesh — the diagnostic closed that gap.
- 179/179 Node tests pass (post-merge + post-bust).
- Board renders at radius 1/2/3 (7/19/37 tiles), biomes mixed, water surround, centered
  (direct WebGL `--screenshot`). The radius-1 "central hole" first read as a gap was just a
  low/pit center tile — geometry is sound; a *real* water hole (forced retype→water) looks
  like a clean hex sea-cutout.
- Right-click retype works end-to-end via the DEMO `?retype=q,r,biome` hook (center→water
  gave a clean hexagonal open-sea hole — exercises pick→setBiome→rebuild + the water path).
- Grid / 3D / About tabs unregressed; tab highlighting **DOM-verified** correct (a screenshot
  read of the tab underline was wrong — same screenshot-misread trap as the badge token; the
  `--dump-dom` aria-selected check is authoritative).
- Spec: `docs/specs/2026-05-28-hexagon-map-design.md`.

## Brief
A local, from-scratch, vanilla-ES-module recreation of Oskar Stålberg's organic
irregular quad grid (the *Townscaper* generation technique). Generate an organic all-quad
mesh (triangulate → merge → subdivide → relax), extract paintable rounded **dual cells**, and
click to paint corner-state. No framework, no build step, offline-capable, deterministic under
a seeded PRNG. Ships in gated milestones M0–M5.

**V1 (this phase) = M0 + M1 + M2** — scaffold, grid kernel, half-edge + dual cells + paint —
viewable live on localhost. M3–M5 (deformed tiles, 3D extrude, WFC) are follow-on.

**Live:** https://kai-denrei.github.io/oskar-procedure/ (GitHub Pages, public) ·
**Repo:** https://github.com/kai-denrei/oskar-procedure · V1 shipped 2026-05-27.

## Active Roles
- [[pm]] — owner: minikai
- [[arch]] — owner: minikai
- [[dev]] — owner: minikai
- [[ux]] — owner: minikai
- [[qa]] — owner: minikai
- [[devops]] — owner: minikai

## Key Decisions
<!-- Cross-role summary, maintained by COMPACT -->
- 2026-05-27 — V1 scope fixed at M0+M1+M2 (spec's "definition of done this phase"). See [[pm]].
- 2026-05-27 — Seed = Poisson (Variant A) for M1; hex (Variant B) is optional toggle. See [[arch]].
- 2026-05-27 — Cache-busting + 3-shape visual version badge installed at scaffold time. See [[devops]].
- 2026-05-27 — Execution: lead orchestrates gated worker sub-agents (not one monolithic PM agent). See [[pm]].
- 2026-05-27 — Shipped public (GitHub Pages) + hand-authored PWA (token-keyed SW, offline-verified). See [[devops]].
- 2026-05-28 — Next: Hexagon seed (Variant B), scoped H1 (single patch); growth = incremental (H2b) later. Spec: `docs/specs/2026-05-27-hexagon-seed-design.md`. See [[pm]] [[arch]].

## Roadmap (post-V1)
1. **H1 — single hexagon patch** ✅ DONE 2026-05-28: `src/hex.js` lattice seeder + pluggable `seedPoints` refactor + Poisson|Hexagon selector + Rings slider + fit-to-bounds view. 96/96 tests (66 regression + 30 hex). Paint stack works on hex. Shipped to main.
2. **H2 — connected patches** (chosen direction: incremental patch-adding / pinned boundaries). Needs a pan/zoom camera. Spec later.
3. **H3 — true infinite streaming** (research; only if "literally endless" is wanted).
4. **3D tab — isometric grid "floor"** ✅ DONE 2026-05-28: Canvas2D iso (no WebGL). `src/iso.js` (projection, 12 tests) + `src/render-iso.js` (depth-sorted slab walls + grid + painted cells) + `src/iso-view.js` (drag-to-rotate, per-frame fit). Shares the Grid tab's mesh. 111/111 tests. Spec: `docs/specs/2026-05-28-3d-floor-tab-design.md`.
5. **3D structures** — full-3D-15 marching-cubes on hand-written **WebGL** + click-to-raise. Spec: `docs/specs/2026-05-28-3d-structures-webgl-design.md`. Supersedes the Canvas2D iso floor.
   - **M3D-1** ✅ DONE 2026-05-28: WebGL2 renderer (mat4, orbit camera, Lambert shading, depth+cull) + height field + click-to-raise extruded columns. `src/gl/{mat4,camera,renderer,view3d}.js` + `src/structures/{heights,geometry}.js`. iso modules retired. 125/125 tests. ⚠ raised cells read as **spikes** (per-vertex height tents the 4 incident quads) — open question before M3D-2 (see [[pm]]).
   - **3D tab variation** (2026-05-28): reworked into a **fixed-isometric (orthographic) terrain playground** — orbit removed, camera locked to true iso; panel with Zoom / Orientation (N/E/S/W) / Randomize / Height / Roughness / Flatten; procedural value-noise terrain + drag-to-build. Shares the per-vertex height field (corner-state intact). `src/structures/terrain.js`, `src/gl/terrain-controls.js`, ortho camera.
   - **Biomes + decorations + pan** (2026-05-28): 6 biomes (`src/structures/biomes.js`) — Dunes (amber sine waves), Mountains (grey ridged), Forest (green + cone-trees), Meadows (low green + flowers + ponds), Swamps (water plane + olive hummocks), Quarry (terracotta terraced pit). Lite decorations (`src/structures/decorations.js`: trees/flowers/ponds/water/reeds). Camera-centering fix (frames z-range, no clip). WASD + two-finger pan; wheel/pinch zoom kept. 160/160 tests.
   - M3D-2 (MC reduction + trilinear, placeholder meshes) → M3D-3 (15 authored tiles) → M3D-4 (specials + WFC) — open (tiles deform onto the terrain columns).
6. **Hexagon Map** (Catan board) ✅ **DONE + LIVE 2026-05-28** (merge `789f39d`, bust `9c8f8a9`, token `f9d2abf8`). New **Map tab**: board of distinct abutting biome hex-tiles (default 19 = radius-2; 7/19/37 by radius slider), per-tile unique grids, flat sea-plane surround, right-click-a-tile→biome picker (incl. Water = open-sea hole). Tiles abut gap-free (pinned regular-hexagon boundary; pitch `Rc·√3`) — **proven** via a rendered-patch boundary-coincidence diagnostic. `src/structures/hexmap.js` + `src/gl/{map-view,map-controls}.js` + `tests/hexmap.test.mjs`. Spec: `docs/specs/2026-05-28-hexagon-map-design.md`. MAP-1 (board) + MAP-2 (retype).

7. **Map tile editing** (focus-mode sculpt + objects) ✅ **DONE + LIVE 2026-05-28** (merge `868086e`, bust `cb126f3`, token `95363b74`). Click a Map tile → camera focuses it → left-drag sculpts terrain (Raise/Lower, flat-block, biome-capped); object palette (Tree/Rock/Building/Water) places on left-click, right-click erases nearest. Auto-decorations bake into one editable set (WYSIWYG). In-session only; retype keeps edits + recolors. `tile.edit={heights,objects,epoch}`. New `src/structures/objects.js` + `src/gl/{map-edit,map-edit-controls}.js`; `geometry.js` emitBox + rock/building; `map-view.js` focus state + place/erase. view3d untouched. 201 tests. Spec `docs/specs/2026-05-28-map-tile-editing-design.md`, plan `docs/plans/2026-05-28-map-tile-editing.md`. Built subagent-driven (per-task spec+quality + final opus review).

## Future features (backlog)
- **Map tile-editing follow-ups** (from the final review, non-blocking): (a) dynamic status-line hints — show a "no focus" hint when clicking a water tile, and an edit hint on focus enter (currently only a static `#map-hint`); (b) defensive `exitFocus()` in `buildHexMap`/`clearMapCache` so a future programmatic board rebuild while focused can't dangle `focusedTile` (safe today only because the board controls are hidden during focus); (c) touch: sculpt-on-press fires one stray cell on the first finger of a pinch (desktop/mouse unaffected); (d) placed water doesn't ride later terrain edits under it (its z is fixed at placement) — acceptable for a flat sheet.
- **Seamless-mesh tiles** — stitch adjacent hex tiles' shared boundaries into one continuous landscape (the original "infinite irregular quad grid" idea). Deferred in favor of the distinct-tile Catan board; revisit after the Map ships. Needs shared-boundary vertex dedup + joint/pinned relaxation across tiles. (Operator: "log it as a potential feature.")
- **3D structures M3D-2..4** — the marching-cubes building tiles on the height field (separate from terrain).
- **Decoration polish (Round 2)** — authored multi-shape trees, animated water, denser flowers/reeds, rocks on mountains.

## Open Questions (cross-role)
- ES modules do not load over `file://` in Chrome/Firefox — V1 needs a static server. The HANDOVER's "ideally file://" is partly unrealistic for module scripts. See [[arch]].
- Relaxation derivation orders corners **clockwise**; stage-4 normalizes winding to **CCW**. Possible sign/winding mismatch to verify empirically at M1 gate. See [[dev]].
