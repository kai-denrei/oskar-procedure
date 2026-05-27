# 05 — References (annotated)

## Primary — Stålberg himself

- **Oskar Stålberg — talk on Townscaper generation** (YouTube `1hqt8JkYRdI`, grid section
  ~21:51 / `&t=1311s`). The source for the hex-seed + dissolve + subdivide + relax pipeline
  and the corner-state / dual-grid idea. Watch this first.
- **OskSta on Twitter/X** — running devlog of the grid, deformation, and specials. Key threads
  collected by sketchpunklabs (IDs): `1147881669350891521`, `1169940644669861888`,
  `1458921394855718917`, `1448265809269338117`, `1338825080844021760`, `1246729301434798080`.
  (X scraping is unreliable; use the sketchpunk page as the index.)
- **oskarstalberg.com** — portfolio, links to *Townscaper* and *Bad North*.

## Reproductions studied

- **eliemichel/TownBuilder** — Unity (C# + HLSL) reproduction. Most *complete* (grid →
  marching cubes → module placement) but engine-bound. Documented in 4 Twitter threads
  (`exppad` `1261950965189672961`, `1267045322116734977`, `1283520023798198273`,
  `1263605678746284033`). Spawned **BMeshUnity** (half-edge mesh lib — good API reference) and
  **MesoGen** (WFC-based tile generation research). MIT.
- **sketchpunklabs/irregular_grid** — JS + Three.js, educational. Half-edge backbone; hex /
  sphere / circle seeding; animated relaxation; marching cubes; **trilinear / barycentric tile
  fitting demos** (the deformation step many writeups skip). WFC marked PLANNED. Demo index:
  `sketchpunklabs.github.io/irregular_grid/`.
- **andersource — "Generating an organic grid"** (`andersource.dev/2020/11/06/organic-grid.html`).
  Vanilla JS, canvas, **no framework**. Only the 2D grid + relaxation, but the cleanest
  distillation and the best math writeup (closed-form closest-square derivation). **This is the
  reference implementation for M1.** Source pulled to `reference/andersource-organic-grid.js`;
  analysed in `docs/06`. Deps: `numjs` (droppable) + `Delaunator`.

## Algorithms / background

- **Bridson, "Fast Poisson Disk Sampling in Arbitrary Dimensions"** (SIGGRAPH 2007 sketch).
  The seeding for Variant A.
- **Delaunator** (`github.com/mapbox/delaunator`). Fast Delaunay triangulation, ESM,
  vendorable. Stage 2 for Variant A.
- **mxgmn/WaveFunctionCollapse** — the canonical WFC repo. For the optional M5 driver.
- **Boris the Brave — "Editable WFC"** (`boristhebrave.com/2022/04/25/editable-wfc/`) and his
  broader WFC/Model-Synthesis writeups. Best conceptual treatment for a clean implementation.
- **Red Blob Games** — hex grids, grid math, general reference (`redblobgames.com`).
- **Catlike Coding — Marching Squares series** (`catlikecoding.com/unity/tutorials/`).
  Unity-flavoured but the clearest marching-squares/cubes case-analysis if you go that route
  for tile selection.

## Related scapers (for ideas / variants)

- **samuelbigos/globescaper**, **john-wigg.dev/SphereScaper** — Townscaper-on-a-sphere; useful
  if the grid is ever mapped to non-planar domains.

## Reading order

1. Stålberg talk (grid section) — the mental model.
2. andersource blog + `docs/06` — the concrete algorithm.
3. sketchpunk trilinear/barycentric demos — the deformation step.
4. Boris the Brave — only when starting M5.
