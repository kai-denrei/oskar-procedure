---
role: arch
owner: minikai
status: active
last-updated: 2026-05-27
---

# Architecture

## Scope
Owns the four-layer decomposition (grid → state → tiles → driver), the locked stack, coordinate
spaces, module boundaries, and the no-build/offline constraint.

## Decisions
| Date | Decision | Rationale | Linked roles |
|---|---|---|---|
| 2026-05-27 | Seed = Poisson disk (Variant A) for M1; hex lattice (Variant B) kept behind an optional toggle. | HANDOVER M1 mandates Poisson; Variant B is the true Townscaper look but optional "now/later". Build the spec'd path first. | [[dev]] [[pm]] |
| 2026-05-27 | Vanilla ES modules, no framework, no build step. Single view transform applied only at draw time; all generation in normalized [0,1] space. | Non-negotiable constraint from HANDOVER + docs/04. Keeps relaxation params (SIDE_LENGTH=0.06 etc.) meaningful and decouples logic from canvas/DPI. | [[dev]] |
| 2026-05-27 | Drop numjs → hand-written `vec.js`. Only third-party dep = `delaunator`, vendored locally as ESM. No runtime CDN. | docs/04: numjs is dead weight (trivial 2D vector ops); CDN import breaks offline/PWA. | [[dev]] [[devops]] |
| 2026-05-27 | Own half-edge structure built **after** subdivision (stage 3 merge done on plain triangle arrays, as the reference does). | docs/04 recommendation: simpler than maintaining half-edge through the dissolve step; O(1) orbits matter from M2 on (dual extraction, paint). | [[dev]] |
| 2026-05-27 | Reorganize repo to match README map: spec docs → `docs/`, reference impl → `reference/`. | HANDOVER references `docs/0X` paths that don't currently resolve (files sit at root). Aligns reality to the documented layout; clears root for the app scaffold. | [[devops]] |
| 2026-05-28 | Hexagon (H1): **pluggable seeder** — extract a `seedPoints` dispatcher in `grid.js` so Poisson and hex feed the same stages 2–5; `generateMesh` stays backward-compatible (default poisson). New `src/hex.js` (deterministic hex-lattice). | The pipeline is already seed-agnostic; the only new code is the seeder. Backward-compat keeps the 66 tests + Poisson UI intact. | [[dev]] |
| 2026-05-28 | View generalizes from "fit [0,1]²" to **fit mesh bounding-box**, kept behind a small `view` object (bounds + toScreen/fromScreen). H1 ships auto-fit only. | Hex patches live in world units, not [0,1]². The `view` object is the seam a pan/zoom camera (needed for H2 multi-patch) later slots into — without over-building it now (YAGNI). | [[dev]] [[ux]] |
| 2026-05-28 | 3D structures = **full-3D marching-cubes (15 cases)** on a **hand-written WebGL** renderer (own mat4 + shaders, no deps), click-to-raise height field on primary vertices. **Retires the Canvas2D iso floor** for the 3D tab. | Operator's explicit choice over the recommended 2.5D-6 (alternative rejected: 2.5D reaches the Townscaper look at ~⅓ cost + keeps Canvas2D, but no overhangs/true-3D). Canvas2D painter-sort can't do occluded stacked tile meshes → WebGL required. Built in milestones M3D-1..4. | [[dev]] |
| 2026-05-28 | 3D tab reworked into a **fixed-isometric (orthographic) terrain playground**: orbit removed, camera locked to true iso (elev atan(1/√2), azimuth 45°+90°·orientation), `mat4.ortho`. Panel: Zoom, Orientation N/E/S/W, Randomize, Height, Roughness, Flatten. Procedural value-noise terrain (`src/structures/terrain.js`) + drag-to-build. | Operator iteration — wanted a stable, controllable 3D view driven by the panel rather than free-orbit. Still feeds the same per-vertex height field (corner-state intact for the M3D-2 tiles). | [[dev]] [[ux]] |
| 2026-05-28 | **Hexagon Map** = a NEW tab (playground kept), a board of **distinct abutting** biome hex-tiles on a honeycomb lattice (default 19/radius-2, configurable), **per-tile unique grids** (own seed), water sea plane, right-click→change biome. Seamless-mesh stitching **deferred** (logged as a future feature). | Operator choices (AskUserQuestion 2026-05-28). Abutting (not seamless) matches Catan + the pinned regular-hexagon boundary tiles the plane gap-free → far simpler than joint relaxation. New tab keeps the single-patch playground intact. Per-tile seeds = variety at ~N× mesh-build cost (use modest rings/tile). | [[dev]] |

## Dead Ends
<!-- APPEND ONLY. Never delete. -->
| Date | What was tried | Why it failed / was rejected |
|---|---|---|
| 2026-05-27 | Vendoring `delaunator@5/+esm` as a single self-contained file. | The jsDelivr `+esm` bundle is NOT self-contained — it re-imports `orient2d` from a bare CDN path `/npm/robust-predicates@3.0.3/+esm`, which breaks the offline/no-CDN constraint. Fix: vendor `robust-predicates` too and rewrite delaunator's import to `./robust-predicates.js`. Verified loads + triangulates in Node. |

## Lessons
- A CDN `+esm` "bundle" can still contain bare external imports — always grep the vendored file for `/npm/` or `from"..."` and confirm zero external imports before trusting it offline. — from dead end on 2026-05-27

## Open Questions
- [x] RESOLVED 2026-05-27: delaunator `+esm` re-imports robust-predicates from CDN; both now vendored locally, import rewritten to relative path. See Dead Ends.
- [ ] **Non-manifold pinch vertices** from merge/subdivide (M2 finding): the kernel occasionally creates interior vertices whose incident quads meet at a point only (>1 disjoint fan; 2 on seed 42). Edge-watertight but not strictly 2-manifold. M2's `facesAroundVertex` handles it (multi-fan sweep). Does this need a kernel-level guarantee before M3 tile deformation (tiles assume a clean quad fan)? Defer to M3. — owner: minikai — since: 2026-05-27

## Assumptions
- [assumption] `delaunator@5/+esm` is a single self-contained ESM file (deps inlined) → vendorable offline. — status: untested — since: 2026-05-27
- [assumption] Canvas 2D is sufficient through M3; WebGL deferred to M4 (out of V1). — status: validated — since: 2026-05-27

## Dependencies
Blocked by:
Feeds into: [[dev]]

## Session Log
- 2026-05-27 — SYNC. delaunator +esm bare-import dead-end (vendored robust-predicates, rewrote import). Non-manifold pinch-vertex finding at M2. Stack held: vanilla ESM, no build, vendored deps, half-edge after subdivision.
- 2026-05-27 — INIT. Locked stack per docs/04. Decided Poisson-first, vec.js over numjs, vendored delaunator, half-edge-after-subdivision, repo reorg to docs/+reference/.
