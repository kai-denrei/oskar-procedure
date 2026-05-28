# Design spec — 3D structures: full-3D marching-cubes tiles on WebGL

**Date:** 2026-05-28
**Status:** draft — awaiting operator review
**Author:** Kai Denrei (Claude Opus 4.7)

## Scope

The next phase: **building structures on the grid in true 3D**, using the general
full-3D marching-cubes tile model (2⁸ = 256 corner configs → **15** canonical
cases under cube symmetry), rendered with a **hand-written WebGL** renderer
(no Three.js — the no-deps rule holds; WebGL is a browser API).

This is decomposed into four milestones. **This spec details M3D-1** (the WebGL
3D foundation + build-by-stacking) as the first buildable unit; M3D-2…4 are the
roadmap and will get their own specs as we reach them.

**Supersession:** the 3D tab currently renders a Canvas2D *isometric floor*
(`src/iso.js`, `render-iso.js`, `iso-view.js`). That was the agreed spike. Full-3D
occluded, stacked tile meshes cannot be done reliably in Canvas2D (no depth
buffer), so **the 3D tab moves to the WebGL renderer.** The Canvas2D iso modules
are retired from the live path (kept in git history); the iso work validated the
concept and is not wasted.

## Decision record

Operator chose **full-3D-15 + WebGL + click-to-raise**, over the recommended
**2.5D six-family** path. Alternative considered and rejected: 2.5D (2-D 6-family
corner logic per floor + vertical connectors) — it reaches the Townscaper look at
~⅓ the cost and keeps a lighter renderer, but does not give overhangs / caves /
fully-general 3D. Operator wants the general system; accepted the WebGL rewrite
and larger effort. (Recorded so the trade-off is explicit.)

## The data model (shared across all milestones)

- **Height field** — one integer height (floor count) per **primary vertex** of
  the relaxed quad mesh. State lives on corners/vertices (consistent with the
  corner-state idea). `src/structures/heights.js`: `createHeights(vertexCount)`
  → `{ get(v), set(v,h), raise(v), lower(v), max }`. Pure, Node-testable. Shared
  with the Grid tab's paint (a painted cell = height ≥ 1).
- **Column cell** — a quad face × one floor level = a prism with **8 corners**
  (the quad's 4 vertices at `z = floor` and `z = floor+1`). Its fill is read from
  the 8 corner heights (corner filled at level *k* iff that vertex's height > *k*).
  This 8-corner fill is the input to the marching-cubes case (M3D-2).
- Floor height in world units: a fixed `FLOOR_H` (e.g. `SIDE_LENGTH`), so columns
  read proportional to cell size.

## M3D-1 — WebGL foundation + build-by-stacking (build this first)

**Goal:** orbit a true-3D scene; the relaxed quad mesh renders as a 3D floor;
clicking a cell raises its corners and the quads extrude into solid 3D columns
with correct depth/occlusion. No tiles yet — just the floor + extruded prisms.
This proves the WebGL pipeline, the camera, depth, and the build interaction, and
establishes the 8-corner column geometry that M3D-2's tiles deform into.

### Components
1. **`src/gl/mat4.js`** (pure, no DOM, unit-tested): minimal column-major 4×4
   matrix math — `identity, multiply, perspective(fovy,aspect,near,far),
   lookAt(eye,center,up), translate, scale, rotateX, rotateY, transformPoint,
   invert` (invert + transformPoint needed for click ray-unprojection). No deps.
2. **`src/gl/camera.js`**: an **orbit camera** — `{ azimuth, elevation, distance,
   target }` → view matrix (lookAt) + perspective projection. Drag = azimuth/
   elevation; wheel/pinch = distance (zoom). Generalizes the iso view's drag-rotate.
   Sensible defaults framing the mesh bounds; clamp elevation.
3. **`src/gl/renderer.js`**: WebGL2 context (fallback WebGL1) on the 3D canvas;
   compile one shader program (vertex: `MVP * position`, pass world-normal;
   fragment: simple directional/Lambert shade + a flat ambient, in the house
   palette — warm floor, slightly distinct column faces); VBO/IBO upload; draw with
   `DEPTH_TEST` + backface cull. Handles DPI + resize + `webglcontextlost`.
4. **`src/structures/geometry.js`** (pure, tested): build renderable geometry from
   `{mesh, heights}` — the **floor** (the relaxed quads as a triangulated plane at
   z=0 with a slight slab thickness like the iso floor) plus, for each quad with any
   raised corner, an **extruded prism** (4 side walls + top face; top corners at
   each vertex's height). Emits positions + normals + indices (Float32/Uint arrays).
   Pure → testable without a GL context (assert vertex/triangle counts, no NaN,
   watertight side walls, winding/normals outward).
5. **`src/gl/view3d.js`**: owns the 3D `<canvas>` + GL context; on each frame builds
   (or reuses cached) geometry from the shared `{mesh, heights}`, sets camera
   matrices, draws. Orbit interaction (drag) + **click-to-raise**: a *click* (not a
   drag) ray-unprojects to the `z=0` ground plane (via inverted view-proj) → world
   point → nearest interior primary vertex (reuse `dual.js` `hitTestVertex` against
   the dual cells) → `heights.raise(v)` → rebuild geometry. Shift/right-click lowers.

### Integration
- `index.html`: the `#view-3d` canvas becomes the WebGL canvas (`#gl-canvas`).
  Replace the iso hint with "drag: orbit · click: raise · ⇧click: lower".
- `src/main.js`: own the shared `heights` (alongside `currentMesh`/`cornerState`);
  feed `{mesh, heights}` to `view3d` when the 3D tab is active (stop driving the
  Canvas2D iso). Painting in the Grid tab and raising in 3D both write `heights`
  (a painted cell ⇒ height ≥ 1), so the two tabs stay consistent.
- `tabs.js`: switching to 3D triggers a GL resize (as it does for the 2D canvases).
- `sw.js`: add the new `src/gl/*.js` + `src/structures/*.js` to PRECACHE; `bust.sh`.
- Retire `iso.js`/`render-iso.js`/`iso-view.js` from the live import graph (leave
  files or delete — implementer's call; keep `iso.test.mjs` only if iso.js stays).

### M3D-1 gate
- The 3D tab shows the relaxed grid as a 3D floor; **orbit** (drag) + **zoom**
  (wheel) work; depth/occlusion correct (no see-through).
- **Click raises** a cell's corners; quads extrude into solid 3D columns that
  occlude correctly; ⇧-click lowers. Works for Poisson and hexagon grids.
- No WebGL/JS errors; 60fps on a typical grid; existing tests stay green; new
  `mat4`/`geometry` Node tests pass.

## Roadmap (separate specs as reached)

- **M3D-2 — corner-state + marching cubes + trilinear (placeholder meshes).**
  `src/mc.js`: the 256→15 canonical case table + config→(case, transform) reduction
  (standard MC symmetry; thoroughly unit-tested — all 256 configs map to a valid
  case). Per column-cell: read 8-corner fill → case → pick the canonical tile →
  **trilinear-deform** its unit-cube `(u,v,w)` vertices onto the cell's 8 world
  corners → emit to the WebGL buffer. Use **placeholder** per-case primitives
  (boxes/wedges/slopes) first. Gate: 15 cases select+orient correctly; deformed
  tiles meet seamlessly across shared faces (no cracks); determinism.
- **M3D-3 — author the 15 architectural tiles** (walls, roofs, corners, ridges)
  in the unit cube, replacing placeholders; multiple variants per case (seeded).
- **M3D-4 — specials + driver.** Pattern-matched multi-cell specials (arches, big
  roofs); the WFC / Model-Synthesis auto-fill driver (the Bad North path) as an
  alternative to manual click-to-raise.

## Constraints
- Vanilla ES modules, **no build step, no dependencies** (hand-written WebGL +
  mat4; shaders as inline strings). Pure-logic modules (mat4, heights, geometry,
  mc) DOM-free + Node-testable. Deterministic where the grid is.
- Don't break the Grid or Stålberg's-Breakthrough tabs, mobile layout, the
  cache-bust/import-fingerprint pipeline, or the PWA.

## Testing
- `mat4`: multiply/identity, perspective & lookAt against known matrices,
  `transformPoint`, invert (M·M⁻¹ = I).
- `heights`: get/set/raise/lower/clear; painted-cell ⇒ height ≥ 1 mapping.
- `geometry`: from a small mesh + heights → expected vertex/triangle counts, no
  NaN, outward normals, watertight column walls; raising a vertex adds a column.
- WebGL render verified by headless screenshots (orbit + raised columns visible,
  correct occlusion) and optionally `readPixels` sanity (non-background pixels).
- Existing suite stays green.

## Risks / open questions
- **WebGL in headless Chrome** for screenshots — may need `--use-gl=angle
  --enable-unsafe-swiftshader` or similar software-GL flags; verify the capture
  path early (a blank GL canvas is the failure mode to catch).
- **Click vs drag disambiguation** (a small movement threshold) so orbiting
  doesn't accidentally raise cells.
- **Per-corner vs per-cell height** — this spec uses per-vertex height (corners),
  giving stepped/sloped column tops and feeding trilinear naturally; confirm that
  matches the intended "stacking" feel.
- **Performance** at high grids × floors — instancing or geometry caching may be
  needed by M3D-2/3; M3D-1 rebuilds geometry only on edit.

## Decisions flagged for review
1. WebGL2 (fallback WebGL1) — confirm acceptable (vs WebGL1-only for max reach).
2. Height lives on **primary vertices** (corners), not cells — confirm.
3. The Canvas2D iso floor is **retired** (superseded by WebGL) — confirm you're ok
   losing the iso view, or whether to keep it selectable.
