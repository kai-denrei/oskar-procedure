---
project: oskar-procedure
created: 2026-05-27
status: active
mode: solo
stale_threshold_days: 30
---

# oskar-procedure — Index

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
   - **3D tab variation** (2026-05-28): reworked into a **fixed-isometric (orthographic) terrain playground** — orbit removed, camera locked to true iso; panel with Zoom / Orientation (N/E/S/W) / Randomize / Height / Roughness / Flatten; procedural value-noise terrain + drag-to-build. 137/137 tests. Shares the per-vertex height field (corner-state intact). `src/structures/terrain.js`, `src/gl/terrain-controls.js`, ortho camera.
   - M3D-2 (MC reduction + trilinear, placeholder meshes) → M3D-3 (15 authored tiles) → M3D-4 (specials + WFC) — next (tiles deform onto the terrain columns).

## Open Questions (cross-role)
- ES modules do not load over `file://` in Chrome/Firefox — V1 needs a static server. The HANDOVER's "ideally file://" is partly unrealistic for module scripts. See [[arch]].
- Relaxation derivation orders corners **clockwise**; stage-4 normalizes winding to **CCW**. Possible sign/winding mismatch to verify empirically at M1 gate. See [[dev]].
