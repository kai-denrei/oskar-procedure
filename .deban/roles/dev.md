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

## Lessons

## Open Questions
- [ ] Corner ordering fed to the relaxation closed-form: CW (per the derivation) or the stored CCW? Resolve at M1 by testing convergence both ways. — owner: minikai — since: 2026-05-27

## Assumptions
- [assumption] mulberry32 seeded PRNG gives adequate blue-noise variety for regenerate-differs gate. — status: untested — since: 2026-05-27
- [assumption] Shared edge-midpoint cache (min-max key) keeps the post-subdivision mesh watertight (every interior edge referenced by exactly 2 quads). — status: untested — since: 2026-05-27

## Dependencies
Blocked by: [[arch]]
Feeds into: [[qa]] [[ux]]

## Session Log
- 2026-05-27 — INIT. Set test strategy (Node for logic, browser for render). Flagged CW/CCW relaxation question and watertight-midpoint assumption.
