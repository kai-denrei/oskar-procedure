---
role: qa
owner: minikai
status: active
last-updated: 2026-05-28
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
- **WebGL + headless verification is split-brained on this machine:** direct `--screenshot=` mode with `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader` renders WebGL fine, but **CDP-launched Chrome (`--remote-debugging-port`) has NO WebGL** (`getContext('webgl2')` null → blank canvas). So: verify WebGL *rendering* via direct-screenshot; use CDP only for layout/DOM/size (no GL). A "mobile 3D blank" via CDP is a harness artifact, not a real bug. — from M3D-1 verification, 2026-05-28
- **Don't read fine-grained UI STATE off a screenshot — read the DOM.** Twice now a screenshot has lied: the 8-char badge token (misread as stale), and the active-tab underline (read as "Grid" when `#3d`/`#map` were correctly active). For "which tab/value is active", `chrome --headless --dump-dom` + grep `aria-selected`/`hidden` is authoritative; reserve screenshots for "does it render / does it look right". — from hexagon-map verification, 2026-05-28
- **A real gap vs. a terrain illusion:** the hexagon-map "central hole / seams" looked like tiling gaps but were a low/pit center tile + quarry pits + a random per-load seed. Settle "is the geometry wrong?" with a math/Node diagnostic on the actual built geometry BEFORE touching code — the fix here was zero code. A forced retype→Water (clean hex sea-cutout) is the control that shows what a *real* hole looks like. — from hexagon-map verification, 2026-05-28
- **A whole-feature review catches what per-task reviews + screenshots can't.** The "camera reframes on every edit" bug (frameBounds in the per-edit rebuild path) was invisible to (a) each task's review (the call sat in an earlier task, the trigger in a later one) and (b) screenshots (one settled frame hides inter-edit motion). A final holistic review reading the cross-task call-flow found it. For interactive/temporal behavior (camera, animation, drag), screenshots verify end-states; the *flow* must be read or watched live. — from map tile-editing final review, 2026-05-28
- **DEMO URL hooks are the way to verify interactive WebGL headlessly.** Direct `--screenshot` can't run JS, and CDP has no GL — so to screenshot the *result* of an interaction, drive it from the URL: `?focus=q,r` (enter focus) + `&edit=showcase` (a scripted place-one-of-each + sculpt sequence). DEMO-gated (`?demo=1`), inert in production. Also: kill stray headless Chromes between runs — ~48 accumulated and stalled new launches (profile/resource contention). — from map tile-editing, 2026-05-28

## Open Questions
- [ ] How to machine-assert "no zero-area quads after relax" tolerance? Pick an epsilon relative to SIDE_LENGTH. — owner: minikai — since: 2026-05-27

## Assumptions

## Dependencies
Blocked by: [[dev]]
Feeds into: [[pm]]

## Session Log
- 2026-05-28 — Map TILE EDITING gate PASSED. 201 Node tests (pure ops: cellAt/bake/sculpt-clamps/placeObject-clamp/eraseAt). Focus/sculpt/place(tree,rock,building,water)/palette verified via direct WebGL --screenshot across forest+meadows seeds + DEMO ?focus=/&edit=showcase. Grid/3D/About/Map-board unregressed. Final opus review caught a camera-reframe-on-every-edit bug (fixed). Live deploy token 95363b74 confirmed.
- 2026-05-28 — Hexagon Map gate PASSED (resume + ship). Gap-free tiling proven by a Node diagnostic on the *rendered* patches (not just the lattice): adjacent boundaries coincide to 0.000000 (7 shared nodes/edge). 179/179 tests. Board radius 1/2/3 + retype + Grid/3D/About verified via direct WebGL --screenshot; tab highlight via --dump-dom. Live deploy token confirmed (f9d2abf8).
- 2026-05-27 — SYNC. M0/M1/M2 gates all passed (machine invariants + headless-Chrome screenshots). 66/66 Node tests. Pinch-vertex caveat on the dual-tiling gate noted; live click-paint is the operator's visual gate.
- 2026-05-27 — INIT. Captured M0/M1/M2 gates from HANDOVER; split machine vs human verification.
