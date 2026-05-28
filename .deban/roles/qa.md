---
role: qa
owner: minikai
status: active
last-updated: 2026-05-27
---

# QA — Acceptance & Gates

## Scope
Owns the per-milestone acceptance gates and their verification. Distinguishes machine-verifiable
invariants from human-judged visual gates.

## Decisions
| Date | Decision | Rationale | Linked roles |
|---|---|---|---|
| 2026-05-27 | Gate verification split: **machine** (invariants via Node + console assertions) vs **human** (visual aesthetics on localhost). | Headless agents can't judge "visibly squares" / "Townscaper-ish". | [[pm]] [[dev]] |

## Gates (acceptance criteria, from HANDOVER)
- **M0**: page loads; canvas fills container at correct DPI; Regenerate button logs a click. (machine + quick human)
- **M1**: regenerate → different, always-valid all-quad mesh (no triangles, no zero-area quads post-relax, no NaNs); relaxation visibly squares cells (human); grid recognizably organic (human).
- **M2**: every interior vertex → exactly one closed dual cell; dual cells tile interior, no gaps/overlaps; click toggles correct corner and fill updates.

## Dead Ends
<!-- APPEND ONLY. Never delete. -->
| Date | What was tried | Why it failed / was rejected |
|---|---|---|

## Lessons
- Headless Chrome's `--window-size` is NOT the CSS layout viewport — it laid out at ~500 CSS px while screenshotting 390px, cropping the right edge and faking a "clipped label" bug that didn't exist. Verify mobile layout with **CDP `Emulation.setDeviceMetricsOverride`** (true width/DSF/mobile) + `Page.captureScreenshot`, or read element rects via CDP, not a window-sized screenshot. — from chasing a phantom mobile clip on 2026-05-28

## Open Questions
- [ ] How to machine-assert "no zero-area quads after relax" tolerance? Pick an epsilon relative to SIDE_LENGTH. — owner: minikai — since: 2026-05-27

## Assumptions

## Dependencies
Blocked by: [[dev]]
Feeds into: [[pm]]

## Session Log
- 2026-05-27 — SYNC. M0/M1/M2 gates all passed (machine invariants + headless-Chrome screenshots). 66/66 Node tests. Pinch-vertex caveat on the dual-tiling gate noted; live click-paint is the operator's visual gate.
- 2026-05-27 — INIT. Captured M0/M1/M2 gates from HANDOVER; split machine vs human verification.
