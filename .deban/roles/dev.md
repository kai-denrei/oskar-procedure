---
role: dev
owner: minikai
status: active
last-updated: 2026-05-27
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

## Lessons
- A closed-form geometric optimizer carries an implicit corner/winding convention; transcribing the formula without matching the winding silently inverts the objective (diverge instead of converge). Always assert the optimizer *reduces* its error metric, not just that it runs. — from dead end on 2026-05-27

## Open Questions
- [x] RESOLVED 2026-05-27: relaxation closed-form needs CW corner order; implementation feeds a CW view and remaps forces to CCW indices. See Dead Ends + [[qa]].

## Assumptions
- [assumption] mulberry32 seeded PRNG gives adequate blue-noise variety for regenerate-differs gate. — status: untested — since: 2026-05-27
- [assumption] Shared edge-midpoint cache (min-max key) keeps the post-subdivision mesh watertight (every interior edge referenced by exactly 2 quads). — status: untested — since: 2026-05-27

## Dependencies
Blocked by: [[arch]]
Feeds into: [[qa]] [[ux]]

## Session Log
- 2026-05-28 — H1 hexagon seed. New `src/hex.js` (deterministic hex lattice, `1+3R(R+1)` points). `grid.js` gained a `seedPoints` dispatcher; `generateMesh({seeder:'hex',rings})` reuses stages 2–5; Poisson default byte-for-byte unchanged. View generalized to fit mesh bbox (paint inverse uses it too). Shape selector + Rings slider. 96/96 tests (30 new hex). Delaunay-on-lattice behaved cleanly (no fallback needed).
- 2026-05-27 — SYNC. Implemented poisson/grid (29 tests) + render2d/controls (animated relax, 3 sliders) + halfedge/dual/state (37 tests). 66/66 green. CW/CCW relaxation dead-end recorded + resolved.
- 2026-05-27 — INIT. Set test strategy (Node for logic, browser for render). Flagged CW/CCW relaxation question and watertight-midpoint assumption.
