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

## Dead Ends
<!-- APPEND ONLY. Never delete. -->
| Date | What was tried | Why it failed / was rejected |
|---|---|---|

## Lessons

## Open Questions
- [ ] Does the vendored `delaunator` `/+esm` bundle fully inline `robust-predicates`, or does it leave a bare import that breaks offline? Verify the vendored file has zero further imports. — owner: minikai — since: 2026-05-27

## Assumptions
- [assumption] `delaunator@5/+esm` is a single self-contained ESM file (deps inlined) → vendorable offline. — status: untested — since: 2026-05-27
- [assumption] Canvas 2D is sufficient through M3; WebGL deferred to M4 (out of V1). — status: validated — since: 2026-05-27

## Dependencies
Blocked by:
Feeds into: [[dev]]

## Session Log
- 2026-05-27 — INIT. Locked stack per docs/04. Decided Poisson-first, vec.js over numjs, vendored delaunator, half-edge-after-subdivision, repo reorg to docs/+reference/.
