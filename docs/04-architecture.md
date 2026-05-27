# 04 — Architecture & technical decisions

## The four layers

The system factors cleanly into four independent, individually-testable layers. Build bottom-up.

```
┌─────────────────────────────────────────────┐
│ 4. DRIVER     manual click  /  WFC auto-fill  │   M2 (click), M5 (WFC)
├─────────────────────────────────────────────┤
│ 3. TILES      6 families, variants, specials, │   M3 (2D), M4 (3D)
│               bilinear/trilinear deformation   │
├─────────────────────────────────────────────┤
│ 2. STATE      half-edge connectivity,          │   M2
│               corner values, dual extraction    │
├─────────────────────────────────────────────┤
│ 1. GRID       points → quads → relax            │   M1  ← conceptual core
└─────────────────────────────────────────────┘
```

Each layer depends only on the one below. You can ship and admire layer 1 alone (an organic
grid that breathes). You can paint on layer 2 with no tiles. Etc.

---

## Stack decisions

These match the established constraints from prior projects (vanilla ES-module / PWA, no
framework, no build step):

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Language | Vanilla JS, ES modules | no build step; runs from `file://` or any static server |
| Framework | none | matches PWA-constraint pattern; the logic is the point, not the framework |
| Build | none | `<script type="module">`, native imports |
| Math lib | **none** — small local `vec2`/`vec3` helpers | the reference's `numjs` (`nj`) dependency is dead weight; replace with plain arrays + a ~40-line vector helper module |
| Delaunay | **vendor `delaunator`** locally (`/vendor/delaunator.js`) | tiny, fast, ESM; vendoring keeps it offline/PWA-friendly. Alt: own incremental Delaunay later, or hex-connect (Variant B) needs no Delaunay at all |
| Connectivity | **own half-edge structure** | the unlock for edge dissolve, neighbour queries, and dual extraction. Don't skip it — ad-hoc arrays get painful by M2 |
| Render (M1–M3) | Canvas 2D (or SVG) | 2D is enough through tile placement in plan view |
| Render (M4+) | WebGL (raw or thin wrapper) | only when extruding to 3D; defer as long as possible |
| Determinism | seeded PRNG (e.g. mulberry32) | reproducible grids; stable variant selection per cell |

### On dropping numjs

The reference uses `nj` (numjs) and `Delaunator`. `numjs` is used only for tiny 2D vector ops
(`add`, `subtract`, `mean`, `pick`, `stack`) — all trivially replaced by a small helper:

```js
// vec.js  (sketch)
export const add  = (a, b) => [a[0]+b[0], a[1]+b[1]];
export const sub  = (a, b) => [a[0]-b[0], a[1]-b[1]];
export const scale= (a, s) => [a[0]*s, a[1]*s];
export const mean = (pts)  => pts.reduce((s,p)=>add(s,p),[0,0]).map(c=>c/pts.length);
export const cross= (a, b) => a[0]*b[1] - a[1]*b[0];
export const dot  = (a, b) => a[0]*b[0] + a[1]*b[1];
export const len  = (a)    => Math.hypot(a[0], a[1]);
```

Dropping numjs removes the only heavy dependency and makes the kernel readable.

---

## The half-edge structure (layer 2)

A half-edge (a.k.a. doubly-connected edge list) gives O(1) traversal of "the faces around a
vertex", "the vertices of a face", "the neighbour across this edge" — exactly the queries
stages 3–6 need. Minimal version:

```
HalfEdge { vertex (origin), twin, next, face }
Vertex   { position, oneOutgoingHalfEdge }
Face     { oneHalfEdge }     // a quad: walk next ×4
```

Build it once after the grid is finalized (post-relax). Then:
- **vertices of a face**: `f.he → he.next → … ×4`, read each `he.vertex`.
- **faces around a vertex** (for dual extraction): orbit `he.twin.next` from one outgoing
  half-edge until you return; collect each `he.face` centroid.
- **edge dissolve** (if you build half-edge *before* merge): remove a shared half-edge pair,
  rewire `next` pointers. (Simpler to do stage 3 on plain triangle arrays as the reference
  does, then build half-edge after subdivision. Recommended.)

> Élie Michel's `BMeshUnity` is the Unity analogue and a good structural reference for the API
> shape (see `docs/05`), even though we're not in Unity.

---

## Coordinate spaces

The reference works in normalized [0,1] then maps to screen with `·150 − 25`. Keep generation
in a clean normalized/world space and apply a single view transform at draw time. This keeps
the relaxation params (`SIDE_LENGTH = 0.06`, etc.) meaningful and decouples logic from canvas
size / DPI.

---

## Visual aesthetic (for the eventual UI)

When the build reaches a presentable state, match the established dark-editorial house style:
- Type: Fraunces / EB Garamond (display/body), IBM Plex Mono (labels, params, readouts).
- Accents: amber + teal on a dark ground.
- Controls: minimal — a regenerate button, a few sliders (point density, pull rate, iters) for
  live experimentation. Show the grid relaxing in real time (the reference animates 100 iters
  via `setTimeout`); a `requestAnimationFrame` loop is the modern equivalent.

The grid itself wants thin, low-contrast strokes; let the painted dual cells carry the colour.

---

## Testing / acceptance per layer

- **L1 grid**: regenerate produces a different but always-valid all-quad mesh; no NaNs; relax
  visibly squares the cells; no degenerate (zero-area) quads after relax.
- **L2 state/dual**: every interior vertex yields one closed dual cell; clicking toggles the
  right corner; dual cells tile the interior with no gaps/overlaps.
- **L3 tiles**: each of the 6 cases selects + orients correctly; deformed tile edges meet
  seamlessly across shared cell edges.
- **L4 driver**: (WFC) solver terminates with a globally consistent assignment; no contradiction
  states left unresolved.
