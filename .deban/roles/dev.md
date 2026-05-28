---
role: dev
owner: minikai
status: active
last-updated: 2026-05-28
---

# Development

## Scope
Owns implementation of all `src/` modules: rng, vec, poisson, grid (stages 2–5), halfedge, dual,
state, render2d, controls. Owns the Node test harness for pure-logic invariants.

## Decisions
| Date | Decision | Rationale | Linked roles |
|---|---|---|---|
| 2026-05-27 | Pure-logic modules (rng, vec, poisson, grid math, halfedge, dual) get **Node unit tests** for invariants; rendering/interaction verified in-browser. | docs/04: "individually-testable layers". Node can assert all-quad, no-NaN, watertight midpoints, no zero-area, determinism without a browser. | [[qa]] |
| 2026-05-27 | Implement relaxation step **exactly** as transcribed in HANDOVER M1.7 (denom/num/alpha closed form), do not "improve" the math. | It's the load-bearing core; the reference is ground truth. Deviation risks non-convergence. | [[arch]] |

## Dead Ends
<!-- APPEND ONLY. Never delete. -->
| Date | What was tried | Why it failed / was rejected |
|---|---|---|
| 2026-05-27 | Feeding stage-4b CCW-ordered quad corners directly into the closed-form relaxation `alpha`/`target` formula. | The closed form is derived for **clockwise** corner order about the centroid. With raw CCW corners the relaxation *diverges* — mean edge-length variance rose 1.877e-4 → 2.738e-4 (cells got less square). Fix: relax on a CW view `[q0,q3,q2,q1]` and map each per-corner force back to its true CCW vertex index. Post-fix variance ~halved (→9.46e-5). Verified by [[qa]] squareness test. |
| 2026-05-28 | H1 hex relaxation moved ALL vertices, including the boundary → the hexagon outline came out wobbly/rounded (operator flagged: "the hexagon has perfect vertices, algorithms happen inside only"). | A bounded patch's boundary *defines its shape* — it must not relax. Fix: `boundaryVertices` (edges used by 1 quad) + a `pinned` set in the relaxer; hex pins its boundary so only the interior squares. Outline now crisp (6 straight sides). Bonus: this pinned-boundary is exactly the seam H2b needs to stitch patches. |

## Lessons
- A closed-form geometric optimizer carries an implicit corner/winding convention; transcribing the formula without matching the winding silently inverts the objective (diverge instead of converge). Always assert the optimizer *reduces* its error metric, not just that it runs. — from dead end on 2026-05-27
- A bounded procedural patch has two vertex classes: **interior** (relax freely) and **boundary** (defines the shape — pin it). Relaxing the boundary destroys the intended outline; pinning it is also what lets independent patches stitch seamlessly. — from dead end on 2026-05-28
- The `[hidden]` attribute hides only if no higher-specificity rule sets `display`. A mobile media query's `#id { display: flex }` (ID specificity) silently beat `.view[hidden] { display:none }`, so a "hidden" tab view bled over the active one — but only on mobile. Give the hide rule `!important` (the one place it's justified: hidden must always win), and verify EVERY view-state × breakpoint, not just the default tab. — from a tab-overlap bug on 2026-05-28
- A unit test that asserts a geometric invariant on the *inputs* to a pipeline does NOT verify the *output*. `hexmap.test.mjs`'s "neighboring patches share a full edge" test built patches from the raw `hexLattice` points — but the rendered tiles go through generateMesh (triangulate→merge→subdivide→relax-pinned) first. The test passed while telling us nothing about the thing on screen. It happened to be fine (a Node diagnostic on the *rendered* patches confirmed exact boundary coincidence), but assert the invariant on the SAME artifact you ship. — from verifying the hexagon map on 2026-05-28

## Open Questions
- [x] RESOLVED 2026-05-27: relaxation closed-form needs CW corner order; implementation feeds a CW view and remaps forces to CCW indices. See Dead Ends + [[qa]].

## Assumptions
- [assumption] mulberry32 seeded PRNG gives adequate blue-noise variety for regenerate-differs gate. — status: untested — since: 2026-05-27
- [assumption] Shared edge-midpoint cache (min-max key) keeps the post-subdivision mesh watertight (every interior edge referenced by exactly 2 quads). — status: untested — since: 2026-05-27

## Dependencies
Blocked by: [[arch]]
Feeds into: [[qa]] [[ux]]

## Session Log
- 2026-05-28 — RESUME → SHIP Hexagon Map. Verified the WIP (gap-free tiling PROVEN by a rendered-patch boundary diagnostic; 179/179; radius 1/2/3 render; retype works; other tabs unregressed), merged feat/hexagon-map → main (789f39d), re-busted token → f9d2abf8 (9c8f8a9), pushed + Pages-deployed (live confirmed). NO code changes were needed — the WIP was correct as written; the "gap" suspicion was a render/biome illusion (quarry pits + random per-load seed), not a bug.
- 2026-05-28 — Decoration bounds fix (forest trees + swamp reeds skip boundary cells + inradius-clamp). 3D tile-centering fix (true-bounds reframe via requestView3dReframe; unified the two competing framing paths). Hexagon Map MAP-1+2 BUILT but cut by usage limit before commit/verify — WIP preserved on branch `feat/hexagon-map` (9f00751): hexmap.js + map-view.js + map-controls.js + hexmap.test.mjs, 179/179 tests, NOT visually verified, NOT merged. See _index RESUME POINT.
- 2026-05-28 — H1 hexagon seed. New `src/hex.js` (deterministic hex lattice, `1+3R(R+1)` points). `grid.js` gained a `seedPoints` dispatcher; `generateMesh({seeder:'hex',rings})` reuses stages 2–5; Poisson default byte-for-byte unchanged. View generalized to fit mesh bbox (paint inverse uses it too). Shape selector + Rings slider. 96/96 tests (30 new hex). Delaunay-on-lattice behaved cleanly (no fallback needed).
- 2026-05-27 — SYNC. Implemented poisson/grid (29 tests) + render2d/controls (animated relax, 3 sliders) + halfedge/dual/state (37 tests). 66/66 green. CW/CCW relaxation dead-end recorded + resolved.
- 2026-05-27 — INIT. Set test strategy (Node for logic, browser for render). Flagged CW/CCW relaxation question and watertight-midpoint assumption.
