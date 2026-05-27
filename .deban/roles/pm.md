---
role: pm
owner: minikai
status: active
last-updated: 2026-05-27
---

# PM — Project Management

## Scope
Owns scope, milestone gating, sequencing, and the build-to-V1 plan. Holds the operator's intent
and challenges the brief. Coordinates worker sub-agents and verifies gates before advancing.

## Decisions
| Date | Decision | Rationale | Linked roles |
|---|---|---|---|
| 2026-05-27 | V1 = M0+M1+M2 (not M0–M5). | HANDOVER "Definition of done (this phase)": M1+M2 shipped = organic grid that regenerates+relaxes live with paintable rounded dual cells. M3–M5 explicitly "follow-on". | [[arch]] [[dev]] |
| 2026-05-27 | Drive build via a lead orchestrator dispatching **gated worker sub-agents**, one per milestone, rather than one autonomous "PM" mega-agent. | HANDOVER: "Ship in milestones; M1 gates everything — do not rush past it... Do not advance until the gate passes." A single fire-and-forget agent cannot enforce inter-gate verification, and M1's exact math needs a tight verify loop. Alternative (one monolithic PM agent) rejected: no checkpoint between gates, harder to catch a wrong M1 before M2 builds on it. | [[dev]] [[qa]] |
| 2026-05-27 | Final visual gate ("relaxation visibly squares", "Townscaper-ish recognizable") is the **operator's** to judge on localhost. | Headless agents verify invariants, not aesthetics. Matches the request: "a working V1 in localhost to look at." | [[qa]] [[ux]] |

## Dead Ends
<!-- APPEND ONLY. Never delete. -->
| Date | What was tried | Why it failed / was rejected |
|---|---|---|

## Lessons
<!-- Distilled principles from Dead Ends. -->

## Open Questions
<!-- Challenge of the brief: untested assumptions & logical gaps surfaced at init. -->
- [ ] `file://` + ES modules is a stated aspiration ("ideally file://") but native `<script type="module">` is blocked over `file://` in Chrome/Firefox (CORS). V1 will require a static server on localhost. Confirm operator accepts "localhost only," not true `file://`. — owner: minikai — since: 2026-05-27
- [x] RESOLVED 2026-05-27 (M1): relaxation formula IS CW-derived; CCW data diverges. Fixed by relaxing on a CW view + remapping forces. See [[dev]] Dead Ends.
- [~] PARTLY RESOLVED 2026-05-27 (M2): dual cells tile the interior — verified by the tiling-proxy test (every quad centroid is referenced by each interior corner's dual cell ⇒ partition). **Caveat:** the merge/subdivide kernel occasionally produces **non-manifold "pinch" vertices** (incident quads meeting at a point only — 2 found on seed 42). Their dual cell is still closed/non-degenerate but may be slightly irregular/non-convex. Edge-watertightness holds. Strict manifoldness would be a kernel-level fix (out of V1 scope). See [[arch]]. — owner: minikai — since: 2026-05-27
- [ ] HANDOVER M1.4 quad angle bounds `[36°,162°]` + MAX_ANGLE filter are tuned for the reference's point count. With Poisson r=0.1 in [0,1]² (~50–80 points) the merge step may leave many leftover triangles → more tiny quads. Acceptable per spec ("leftover triangles are fine"), but the *feel* may differ from the reference until tuned. — owner: minikai — since: 2026-05-27
- [ ] Saddle/diagonal tile case (#3) is "genuinely ambiguous — pick a convention" but the convention is unspecified. Out of V1 scope (M3), but flagged so it isn't forgotten. — owner: minikai — since: 2026-05-27

## Assumptions
- [assumption] Operator wants the full V1 (M0+M1+M2) built autonomously this session, no mid-build checkpoint. — status: validated — since: 2026-05-27 (explicit: "until /goal of a working V1 ... is finished")

## Dependencies
Blocked by:
Feeds into: [[dev]] [[qa]] — gate verification gates each milestone advance.

## Session Log
- 2026-05-27 — INIT. Read 9 spec docs. Scoped V1=M0+M1+M2. Challenged brief: 5 open questions (file:// vs modules, CW/CCW relaxation mismatch, dual-cell simplicity, point-count tuning, saddle convention). Chose orchestrator+gated-workers execution model.
