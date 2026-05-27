# HANDOVER — build brief for Claude Code CLI

**Project:** `oskar-procedure` — a local, from-scratch recreation of Oskar Stålberg's organic
irregular quad grid (the *Townscaper* generation breakthrough).

**You are:** a CLI coding agent building this locally. This file is self-contained enough to
start. For deeper detail on any algorithm, read the referenced `docs/0X` file — they are the
spec; this is the work order.

---

## Mission

Build an interactive web app that generates a Townscaper-style **organic quad grid** and lets
the user paint cells, with a clean path to deformed tiles and (optionally) WFC auto-fill. Ship
in milestones; **M1 is the core and gates everything** — do not rush past it.

## Hard constraints (non-negotiable)

- **Vanilla JS, ES modules.** No framework (no React/Vue/Svelte).
- **No build step.** Must run by opening `index.html` via any static file server (and ideally
  `file://`). Native `import` only.
- **No heavy dependencies.** The only permitted third-party lib is `delaunator`, **vendored
  locally** (no CDN at runtime, PWA-friendly). Everything else is hand-written.
- **No `numjs`.** Write a tiny `vec.js` instead (see M1).
- **Deterministic option.** A seeded PRNG so a given seed reproduces a given grid.
- Keep generation logic in normalized/world space; apply one view transform at draw time.

## Locked stack

| Concern | Choice |
|---|---|
| Lang | vanilla ES modules |
| Render M1–M3 | Canvas 2D |
| Render M4+ | WebGL (raw), only when extruding to 3D |
| Delaunay | vendored `delaunator` (M1 stage 2) |
| Connectivity | hand-written half-edge (M2) |
| PRNG | mulberry32 (or similar), seedable |

---

## Target file layout (create this)

```
oskar-procedure/
├── index.html                 entry; <script type="module" src="src/main.js">
├── src/
│   ├── main.js                bootstrap, RAF loop, wires controls
│   ├── rng.js                 seedable PRNG (mulberry32)
│   ├── vec.js                 vec2/vec3 helpers (no deps)
│   ├── poisson.js             Bridson Poisson disk sampling   [M1]
│   ├── grid.js                stages 2–5: triangulate→quads→relax  [M1]
│   ├── halfedge.js            half-edge structure + queries    [M2]
│   ├── dual.js                dual-cell extraction             [M2]
│   ├── state.js               corner values + toggle           [M2]
│   ├── tiles.js               6 families, variants, deformation [M3/M4]
│   ├── wfc.js                 Model Synthesis driver (optional) [M5]
│   ├── render2d.js            canvas drawing                    [M1–M3]
│   └── controls.js            sliders/buttons                   [M1+]
├── vendor/
│   └── delaunator.js          vendored ESM build
└── styles.css
```

Adjust names if you have a better scheme, but keep the layer separation (grid / state / tiles /
driver — see `docs/04`).

## Dependency setup

Vendor delaunator as a local ES module. Either:
- download the ESM build to `vendor/delaunator.js` and `import Delaunator from '../vendor/delaunator.js'`, or
- fetch `https://cdn.jsdelivr.net/npm/delaunator@5/+esm` once at build time and save it to
  `vendor/`.

Do **not** import from a CDN at runtime. Confirm it works offline before moving on.

---

## Milestones

Each milestone has a **goal**, **tasks**, and an **acceptance gate**. Do not advance until the
gate passes. Commit at each gate.

### M0 — Scaffold
**Goal:** blank canvas renders, controls stubbed.
**Tasks:** `index.html` + `main.js` with a `requestAnimationFrame` loop; resize/DPI-correct
canvas; a "Regenerate" button (no-op for now); `rng.js` (mulberry32) and `vec.js`.
**Gate:** page loads, canvas fills its container at correct DPI, button logs a click.

`vec.js` minimum:
```js
export const add=(a,b)=>[a[0]+b[0],a[1]+b[1]];
export const sub=(a,b)=>[a[0]-b[0],a[1]-b[1]];
export const scale=(a,s)=>[a[0]*s,a[1]*s];
export const mean=(ps)=>{let x=0,y=0;for(const p of ps){x+=p[0];y+=p[1];}return [x/ps.length,y/ps.length];};
export const cross=(a,b)=>a[0]*b[1]-a[1]*b[0];
export const dot=(a,b)=>a[0]*b[0]+a[1]*b[1];
export const len=(a)=>Math.hypot(a[0],a[1]);
```

---

### M1 — Grid kernel  ★ the conceptual core
**Goal:** points → all-quad mesh → relaxed, drawn as lines; Regenerate makes a new organic
grid each time. **Full spec: `docs/02`.**

**Tasks (in order):**

1. **Poisson seed** (`poisson.js`): Bridson in [0,1]², `r=0.1`, `k=30`, grid-accelerated
   (`cell=r/√2`), candidates at dist `[r,2r)`. Rescale `·0.85 + 0.075` to inset from boundary.
   Use the seeded `rng`.
2. **Triangulate** (`grid.js`): `Delaunator.from(points).triangles` → triples.
3. **Filter obtuse:** drop triangles whose largest angle `≥ π/2·1.65 (≈148.5°)` (law of cosines
   on sorted edges).
4. **Merge to quads:** count interior edges (shared by exactly 2 triangles, skip a `tabu` set);
   randomly pick one; the two triangles' non-shared vertices are `opp0,opp1`; candidate quad =
   `[a, opp0, b, opp1]` (interleaved). Accept iff **convex** (all 4 corner cross-products same
   sign) **and** all interior angles ∈ `[36°,162°]` (`[0.2π,0.9π]`); else tabu the edge.
   Repeat until no interior edges remain mergeable.
5. **Subdivide → all quads:** per face compute centroid + edge midpoints (**share midpoints via
   a `min-max` edge-key cache** so the mesh stays watertight). Triangle→3 quads, quad→4 quads;
   each small quad = `[corner, edge1_mid, centroid, edge2_mid]`. After this the mesh is 100% quads.
6. **Normalize winding** to CCW (reverse a quad if cross of its first two edges is negative/positive
   per your convention — be consistent).
7. **Relax** (closed-form closest-square, `SIDE_LENGTH=0.06`, `r=SIDE_LENGTH/√2`,
   `PULL_RATE=0.3`, `n_iters=100`). Animate over RAF frames so the grid visibly squares up.

Relaxation step (per quad, per iteration) — implement exactly:
```
c = centroid(quad);  q[i] -= c            // center
denom = q0.x - q1.y - q2.x + q3.y
num   = q0.y + q1.x - q2.y - q3.x
s = Math.sign(denom) || 1
denom = s * Math.max(1e-10, Math.abs(denom))
alpha = Math.atan(num / denom)
if (Math.cos(alpha)*denom + Math.sin(alpha)*num < 0) alpha += Math.PI
ca = Math.cos(alpha), sa = Math.sin(alpha)
target = [[ r*ca,  r*sa], [ r*sa, -r*ca], [-r*ca, -r*sa], [-r*sa,  r*ca]]
for i in 0..3: force[quad.vertexId[i]] += sub(target[i], q[i])
// after all quads this iter:
for each vertex v: pos[v] += scale(force[v], PULL_RATE); force[v] = [0,0]
```

**Gate:**
- Regenerate yields a different, always-valid all-quad mesh (no triangles left, no zero-area
  quads after relax, no NaNs).
- Relaxation visibly squares the cells over the animation.
- The organic Townscaper-ish grid is recognizable.

> Optional now / later: add **Variant B** (hex-lattice seed) behind a toggle — it needs no
> Delaunay and gives the true Townscaper look (`docs/02` stage 1B). Poisson is fine for M1.

---

### M2 — Half-edge + dual cells + paint
**Goal:** build connectivity, extract the paintable dual cells, click-to-paint. **Spec:
`docs/03` + `docs/04` (half-edge section).**

**Tasks:**
1. `halfedge.js`: build a half-edge structure from the final quad list (HalfEdge{vertex,twin,
   next,face}, Vertex{pos,he}, Face{he}). Provide `facesAroundVertex(v)` (orbit `he.twin.next`)
   and `verticesOfFace(f)`.
2. `dual.js`: for each vertex with **≥3 incident quads**, gather incident quad centroids, sort
   by angle around the vertex → the dual cell polygon. Skip boundary vertices (<3).
3. `render2d.js`: draw dual cells with **rounded corners** (quadratic path through edge
   midpoints, corner points as controls — see `docs/06` `add_path`). Thin grid strokes; dual
   cells carry colour.
4. `state.js`: a value per primary vertex (boolean to start). `controls.js`/mouse: click or
   click-drag a dual cell toggles its corner value; repaint.

**Gate:** every interior vertex yields exactly one closed dual cell; dual cells tile the
interior with no gaps/overlaps; clicking toggles the correct corner and the fill updates.

---

### M3 — Corner-state → 2D deformed tiles
**Goal:** replace flat fills with the 6 tile families, deformed to each quad. **Spec: `docs/03`.**

**Tasks:**
1. `tiles.js`: define the 6 canonical families (empty, convex corner, edge, diagonal/saddle,
   concave corner, full) as 2D meshes authored in the **unit square [0,1]²**, vertices stored
   as (u,v) params. Pick a deterministic convention for the diagonal/saddle case.
2. Tile selection: read a quad's 4 corner values → canonical case + the rotation/reflection that
   maps canonical→actual.
3. **Bilinear deformation:** map each tile vertex (u,v) into the target quad via
   `lerp(lerp(c00,c10,u), lerp(c01,c11,u), v)`. Draw.
4. Variants: allow N meshes per family; pick by a per-cell seeded hash so it's stable.

**Gate:** all 6 cases select + orient correctly; deformed tile edges meet seamlessly across
shared cell edges (no cracks); variants vary without flicker on redraw.

---

### M4 — 3D extrude + trilinear tiles  (WebGL)
**Goal:** lift to columns and real geometry. **Spec: `docs/03` (trilinear).**

**Tasks:** introduce WebGL in `render*.js`; extrude each quad into a column (bottom = relaxed
quad, top = lifted by floor height); author tiles in the **unit cube [0,1]³**, deform via
**trilinear** interpolation of the 8 column corners; support stacked floors; basic camera.
Keep tile *selection* logic from M3 (per-floor 2.5D) plus vertical connectors.

**Gate:** walls/roofs render in 3D, seamless across shared edges and floors; orbit camera works.

---

### M5 — WFC / Model Synthesis driver (optional)
**Goal:** auto-fill the grid with a globally consistent tile assignment, no manual painting.
**Spec: `docs/03` (drivers) + `docs/05` (mxgmn, Boris the Brave).**

**Tasks:** define edge-compatibility constraints on the 6 families; implement Model Synthesis /
WFC (propagate constraints, collapse lowest-entropy cell, backtrack or restart on
contradiction). Run it as an alternative driver to manual painting.

**Gate:** solver terminates with a consistent fill; no unresolved contradictions; output looks
plausibly town-like.

---

## Param reference (Variant A, normalized [0,1] space)

| Symbol | Value | Where |
|---|---|---|
| Poisson `r` | 0.1 | M1.1 |
| Poisson `k` | 30 | M1.1 |
| inset rescale | `·0.85 + 0.075` | M1.1 |
| `MAX_ANGLE` | `π/2·1.65` ≈ 148.5° | M1.3 |
| quad angle bounds | `[0.2π, 0.9π]` = [36°,162°] | M1.4 |
| `SIDE_LENGTH` | 0.06 | M1.7 |
| `r` (relax) | `SIDE_LENGTH/√2` | M1.7 |
| `PULL_RATE` | 0.3 | M1.7 |
| `n_iters` | 100 | M1.7 |
| dual-cell min degree | 3 | M2.2 |

Rescale all together if you change the working coordinate range.

## Aesthetic (when presentable)

Dark editorial house style: Fraunces / EB Garamond display+body, IBM Plex Mono for param
readouts; amber + teal accents on a dark ground. Thin low-contrast grid strokes; colour lives in
the painted dual cells. Controls: Regenerate + sliders for point density, pull rate, iters, and
a Poisson/hex seed toggle — wire them to live-regenerate so the grid can be felt, not just seen.

## Definition of done (this phase)

M1 + M2 shipped: an organic grid that regenerates and relaxes live, with paintable rounded dual
cells, in vanilla ES modules, no build step, offline-capable. M3–M5 are follow-on.

## Where to look when stuck

- Algorithm detail / math → `docs/02`.
- Dual grid, corner-state, deformation → `docs/03`.
- Half-edge API, stack rationale, testing → `docs/04`.
- The exact reference behaviour → `docs/06` + `reference/andersource-organic-grid.js`
  (study only; do not copy — it's `numjs`-bound `var`/callback code).
- Sources / further reading → `docs/05`.
