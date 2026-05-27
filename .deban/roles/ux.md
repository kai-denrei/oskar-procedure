---
role: ux
owner: minikai
status: active
last-updated: 2026-05-27
---

# UX / Visual Design

## Scope
Owns the editorial house style and the controls UX once the build is presentable (M1+).

## Decisions
| Date | Decision | Rationale | Linked roles |
|---|---|---|---|
| 2026-05-27 | Dark editorial style: Fraunces / EB Garamond (display/body), IBM Plex Mono (params); amber + teal accents on dark ground; thin low-contrast grid strokes, colour lives in painted dual cells. | Established house style from HANDOVER "Aesthetic" + docs/04. | [[dev]] |
| 2026-05-27 | Controls: Regenerate + live sliders (point density, pull rate, iters) + Poisson/hex seed toggle; wire to live-regenerate so the grid is "felt, not just seen". | HANDOVER aesthetic section. | [[dev]] |

## Dead Ends
<!-- APPEND ONLY. Never delete. -->
| Date | What was tried | Why it failed / was rejected |
|---|---|---|

## Lessons

## Open Questions
- [ ] Web fonts offline: Fraunces/EB Garamond/IBM Plex Mono must be vendored locally or the dark-editorial look breaks offline (no-CDN constraint). Self-host or fall back to system serif/mono for V1? — owner: minikai — since: 2026-05-27

## Assumptions

## Dependencies
Blocked by: [[dev]]
Feeds into:

## Session Log
- 2026-05-27 — INIT. Captured house style + controls intent. Flagged offline web-font sourcing.
