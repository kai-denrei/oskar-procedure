# Design spec — 3D tab: isometric grid "floor"

**Date:** 2026-05-28
**Status:** draft — awaiting operator review
**Author:** Kai Denrei (Claude Opus 4.7)

## Scope

- **In scope (build now):** a second **tab** ("2D" | "3D"). The 3D tab renders the *current* grid as an **isometric 3D floor** using **Canvas2D** (no WebGL, no deps). The grid is the ground plane onto which structures will later be built. Build/paint in 2D, switch to 3D to see it as a floor.
- **Deferred (separate spec, needs research):** the **3D structures** that sit on the floor — corner-state tile families in 3D (the "256 → ~15" reduction; see below) deformed to fit and dovetailing organically. **Not built here.**
- **Out of scope:** WebGL, perspective projection, lighting/shadows, free-fly camera.

## Background / intent

Operator decision: render the grid in **Canvas2D isometric** (a fast spike, reusing the existing 2D renderer and matching the isometric look in the Stålberg video frames) rather than raw WebGL. The grid "will just be the floor for 3D structures we build after." So this phase delivers the *substrate*: the relaxed quad mesh shown as a tilted ground plane in iso. Real 3D / WebGL stays the option for later if the structures phase needs it.

## Architecture

Build bottom-up; each unit is small and independently testable.

### Component 1 — `src/iso.js` (new, pure, no DOM): isometric projection
- `isoProject([x, y, z], { scale, angle = 0, origin }) → [sx, sy]`. The grid's plane is the ground: a grid vertex `(gx, gy)` becomes the 3D ground point `(gx, gy, 0)`; structures later use `z > 0` (height). Standard dimetric/isometric basis (≈30°): rotate `(x,y)` around vertical by `angle` (the camera spin), then
  `sx = (x' - y') * cos(30°)`, `sy = (x' + y') * sin(30°) - z`, then `* scale` + `origin`.
- `isoDepth([x,y,z])` → a painter's-order key (back-to-front) so faces/edges draw in correct overlap order.
- Pure math ⇒ unit-testable (project known points to expected coords; depth ordering monotonic).

### Component 2 — tab shell (`src/main.js` + `src/controls.js` + `index.html`)
- A `viewMode` state: `'2d'` (default) | `'3d'`, exposed as a small **tab control** at the top of the controls panel ("2D" | "3D", same dark/amber idiom as the shape selector).
- **The grid is shared, single source of truth.** Switching tabs does NOT regenerate — the 3D tab renders the same `currentMesh` + paint `cornerState` the 2D tab holds. Regenerate / sliders / shape selector still drive the one grid; both tabs reflect it.
- The RAF loop dispatches: `viewMode === '2d'` → existing flat `drawMesh`/`drawDualCells`; `'3d'` → the iso renderer (Component 3).

### Component 3 — `src/render-iso.js` (new): draw the floor in iso
- Given `currentMesh`, `cornerState`, and an iso camera, draw the relaxed quad mesh as a tilted ground plane: thin grid strokes (as in 2D) + painted dual cells filled (so paint shows on the floor). Faces drawn back-to-front via `isoDepth`.
- A subtle ground feel: optionally a faint fill on the whole patch / a thin drop edge at the boundary so it reads as a slab, not a flat outline. Keep minimal for the spike.
- Reuses the existing canvas + DPI handling. The iso camera (scale/origin) **auto-fits the projected floor's bounding box** to the canvas — the same fit-to-bounds idea as 2D, applied to projected coordinates.

### Component 4 — camera control
- Fixed iso tilt (~30°) + a **rotate** affordance (spin the floor around its vertical axis) so it can be viewed from different sides — drag-to-rotate or a slider/buttons (N/E/S/W snaps). Zoom = auto-fit (optionally a zoom slider later). No pitch control in the spike.

### Reuse / interaction
- Painting in the 3D tab is **out of scope for the spike** (paint in 2D, view in 3D). If trivial later, iso hit-testing can be added; not now (YAGNI).
- PWA: add `src/iso.js` + `src/render-iso.js` to `sw.js` PRECACHE, then run `./scripts/bust.sh`.

## Data flow
2D tab builds/paints `currentMesh` + `cornerState` → tab switch to 3D → RAF loop projects the same mesh via the iso camera and draws the floor (+ painted cells). No regeneration on switch. Rotate spins the camera `angle`; the projected bbox re-fits.

## The deferred "structures" phase (research — documented, not built)
The operator's "optimized from 256 to ? to 15 or so" is the **3D corner-state / marching-cubes reduction**: a column (extruded quad) has 8 corners → 2⁸ = **256** filled/empty configurations → under the cube symmetry group (48 rotations+reflections) these collapse to the classic **~15 marching-cubes base cases**. The structures phase will: author ~15 canonical meshes, **trilinear-deform** each to its column (bilinear floor face × height — `docs/03`), select by the 8 corner values, and add pattern-matched "specials" so pieces dovetail organically (arches, roofs). This is M4/M5 territory and needs its own spec + research; the iso floor here is the substrate it renders on. (If the structures need true depth/occlusion beyond what Canvas2D painter-ordering gives, revisit WebGL at that point.)

## Testing
- `iso.js`: project known points to expected screen coords; depth ordering is monotonic back-to-front; rotation by `angle` is consistent.
- Visual (headless screenshot): 3D tab shows the current grid as a recognizable tilted iso floor; painted cells appear on it; switching 2D↔3D preserves the grid (no regen); rotate changes the viewing side.
- Regression: 2D tab unchanged; existing 99 tests stay green.

## Constraints
- **Canvas2D only**, no WebGL, no new dependencies, no build step.
- Single shared mesh/paint state across tabs.

## Decisions flagged for review
1. **Camera:** fixed iso tilt + rotate-around-vertical (recommended) vs fixed single angle only. Defaulting to rotatable.
2. **Floor content:** grid strokes **+ painted dual cells** (recommended — connects M2 paint to 3D) vs strokes only.
3. **Slab vs plane:** a faint boundary "drop" to read as a slab (recommended, subtle) vs a flat outline.
4. **Paint in 3D:** deferred (paint in 2D) — confirm that's acceptable for the spike.
