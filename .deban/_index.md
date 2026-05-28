---
project: oskar-procedure
created: 2026-05-27
status: active
mode: solo
stale_threshold_days: 30
---

# oskar-procedure — Index

## ⚠ RESUME POINT (2026-05-28, session cut by usage limit)

**Where progress stopped:** mid the **Hexagon Map** build (MAP-1 + MAP-2). The dispatched
agent hit the session limit *after* writing the code but *before* committing or
visually verifying.

**State — preserved on branch `feat/hexagon-map` (commit `9f00751`, pushed to origin):**
- **Code-complete + 179/179 Node tests pass** (+12 new `hexmap` tests). New files:
  `src/structures/hexmap.js` (honeycomb layout + gap-free tiling), `src/gl/map-view.js`,
  `src/gl/map-controls.js`, `tests/hexmap.test.mjs`. Wired: `index.html` (Map tab +
  `#view-map`), `tabs.js` (`#map` route), `main.js`, `sw.js` (working-tree token `d5410cfc`).
- **NOT done:** visual verification (does the WebGL board render — 19 tiles abut gap-free,
  biomes mixed, centered, water surround; does right-click→retype work?), and **NOT merged to main**.
- `main` is clean at `9846baf` (3D tile-centering fix, token `013d47e9`), fully pushed + live.

**To resume (fresh session):**
1. `git checkout feat/hexagon-map` (the WIP is there).
2. Serve (`python3 -m http.server 8777`) + **direct** `--screenshot` (GL flags:
   `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader --disable-gpu-sandbox`;
   **one screenshot at a time** — back-to-back Chromes flake SwiftShader to blank) of
   `http://127.0.0.1:8777/?demo=1#map`, plus `?radius=1` / `?radius=3`. Verify tiles abut
   gap-free, biomes are mixed, the board is centered, water surrounds it, and right-click a
   tile opens the biome picker + retypes.
3. Fix any visual issues; confirm Grid/3D/About unregressed.
4. Merge `feat/hexagon-map` → main, re-bust (unify token), push.
- Spec: `docs/specs/2026-05-28-hexagon-map-design.md`. Key risk to check: honeycomb tiling
  geometry (adjacent tile centers must be `Rc·√3` apart — the unit test asserts it; confirm visually too).

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
6. **Hexagon Map** (Catan board) — **WIP on branch `feat/hexagon-map` (commit 9f00751, code-complete, 179 tests pass, NOT visually verified, NOT merged)** — see ⚠ RESUME POINT at top. New **Map tab**: board of distinct abutting biome hex-tiles (default 19 = radius-2, configurable), per-tile unique grids, water surround, right-click-a-tile→change biome. Tiles abut gap-free thanks to the pinned regular-hexagon boundary. Spec: `docs/specs/2026-05-28-hexagon-map-design.md`. MAP-1 (board) + MAP-2 (retype).

## Future features (backlog)
- **Seamless-mesh tiles** — stitch adjacent hex tiles' shared boundaries into one continuous landscape (the original "infinite irregular quad grid" idea). Deferred in favor of the distinct-tile Catan board; revisit after the Map ships. Needs shared-boundary vertex dedup + joint/pinned relaxation across tiles. (Operator: "log it as a potential feature.")
- **3D structures M3D-2..4** — the marching-cubes building tiles on the height field (separate from terrain).
- **Decoration polish (Round 2)** — authored multi-shape trees, animated water, denser flowers/reeds, rocks on mountains.

## Open Questions (cross-role)
- ES modules do not load over `file://` in Chrome/Firefox — V1 needs a static server. The HANDOVER's "ideally file://" is partly unrealistic for module scripts. See [[arch]].
- Relaxation derivation orders corners **clockwise**; stage-4 normalizes winding to **CCW**. Possible sign/winding mismatch to verify empirically at M1 gate. See [[dev]].
