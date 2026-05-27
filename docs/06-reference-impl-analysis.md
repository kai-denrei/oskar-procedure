# 06 — Reference implementation analysis

A walkthrough of `reference/andersource-organic-grid.js` (547 lines), mapped to the pipeline in
`docs/02`. This is study material — we will **not** copy it (it depends on `numjs` and is
`var`-heavy callback code); we re-implement clean in `HANDOVER.md`. But it's the ground truth
for the algorithm, so know exactly what it does.

External deps: `nj` (numjs, NumPy-like) and `Delaunator` (loaded globally on the page).

## Top-level flow

- `window.onload` → `generate_grid()`, wires up Clear / Regenerate buttons (DOM scrubbing of
  the SVG, then re-run).
- `generate_grid()` runs stages 1–4 synchronously, then kicks `loop_iter()` (stage 5
  relaxation) via `setTimeout`, which on completion calls `post_loop()` (stage 6 + paint UI).

## Stage-by-stage map

### Stage 1 — seeding · `poisson_disk_sampling(r, k)` (L463–519)
Bridson in [0,1]². `r = 0.1`, `k = 30`. Grid acceleration with `cell_size = r/√2`. Candidates
at distance `[r, 2r)` (`r2 = rand·r + r`), random angle. Neighbour check over a 5×5 cell block
(L493–502). Final rescale `·0.85 + 0.075` (L518) keeps points off the boundary. Returns an
array of `[x,y]`.

### Stage 2 — triangulate + filter · L32–54
`Delaunator.from(blue_noise).triangles` → grouped into triples (L32–36). Then the obtuse-filter
loop (L40–54): for each triangle, sort edge lengths `a≤b≤c`, compute the largest angle via law
of cosines `acos((a²+b²−c²)/(2ab))`, and `splice` it out if `≥ MAX_ANGLE = π/2·1.65` (L38, 49).

### Stage 3 — merge to quads · L56–139
- `legit_prequad(quad)` (L58–75): walks the 4 corners; collects per-corner **cross products**
  (turn direction) and **normalized dot products** (for angles). Accepts iff all cross-product
  signs are equal (**convex**, L72) and all interior angles ∈ `[0.2π, 0.9π]` (L73–74).
- Merge loop (L77–139): build `edge_counts` over non-tabu edges (L79–95); `candidate_edges` =
  those shared by `>1` triangle (interior edges, L97–103); break if none (L105). Randomly pick
  a candidate (L108–109), find the two triangles sharing it and their two non-shared vertices
  (`unique_vertices`, L110–124), form `candidate_quad = [a, opp0, b, opp1]` (interleaved so
  corner order is correct, L126–127). If `legit`: push to `prequads`, remove both triangles
  (L129–134). Else: add edge to `tabu_edges` and try the next candidate (L136). Leftover
  triangles persist in `triangles`.

### Stage 4 — subdivide · L141–219
Shared midpoint cache `midpoints` / `midpoints_index` keyed by `make_edge_key` (`min-max`,
L534–537) so adjacent faces reuse the same midpoint vertex (watertight).
- **Triangles → 3 quads** (L144–175): push the centroid as a new vertex (L146–148); ensure all
  3 edge midpoints exist (L151–159); for each corner emit
  `[common_vertex, e1_mid, center, e2_mid]` (L161–174).
- **Prequads → 4 quads** (L177–208): identical construction over 4 edges.
- **Winding normalize** (L210–219): for each quad, if cross of first two edges `> 0`, reverse.

### Stage 5 — relax · `loop_iter()` (L313–389)
`SIDE_LENGTH = 0.06`, `r = SIDE_LENGTH/√2`, `PULL_RATE = 0.3`, `n_iters = 100` (L223–228).
Each iter: zero `forces` (L314); per quad (L315–355): center it (subtract centroid, L322–323);
compute `denom = x0 − y1 − x2 + y3` (L324–325, with sign-preserving `1e-10` guard L326–329) and
`numerator = y0 + x1 − y2 − x3` (L330–331); `alpha = atan(num/denom)` (L333); branch-correct
`if cos·denom + sin·num < 0: alpha += π` (L335–337); build target square corners `xyt` at radius
`r` (L342–347); accumulate `forces[vertex] += (target − current)` per corner (L351–354). Then
`blue_noise += forces · PULL_RATE` (L357). Redraws temp lines each frame (L360–378); recurses via
`setTimeout(loop_iter, 0)` until `n_iters` exhausts, then `post_loop()` (L380–388).

This is the closed-form closest-square fit; the math is derived in `docs/02` stage 5.

### Stage 6 — dual cells + paint · `post_loop()` (L230–311)
Final coordinate map `·150 − 25` (L231). Draws final quad edges (dedup via `added_lines`,
L233–244). Then the **dual extraction + paint** (L255–298): for each vertex, gather incident
quads (`vertex_quads`, L256–261); **skip if fewer than 3** (L263, boundary vertices); compute
each incident quad's centroid (`centers`, L265–266); **sort centroids by angle** around the
vertex (L268–272); `add_path(centers)` draws the rounded dual-cell polygon (L275). Mouse
handlers (L277–297) let you click/drag to paint cells in the current colour. Colour buttons set
`curr_color` (L305–310).

## Helpers
`fancy_index` (L394, numpy-style gather), `add_circle/line/polygon/path` (SVG element factories;
`add_path` L439–460 builds the **rounded** corners via quadratic control points through edge
midpoints), `dist`, `mean_on_axis0`, `make_edge_key`, `repeat`.

## What to keep vs. drop when re-implementing

| Keep | Drop / replace |
|------|----------------|
| The 6-stage pipeline & all params | `numjs` → small `vec.js` (`docs/04`) |
| Closed-form relaxation math | `var`/callback style → modern `const`/`let`, modules |
| Shared-midpoint dedup by edge key | SVG-element scrubbing → clean canvas/SVG redraw |
| Dual extraction (centroids around vertex, angle-sorted) | global `Delaunator` → vendored ESM import |
| `min-max` edge keys for watertightness | inline DOM event wiring → small input module |
| Convexity + angle bounds for legal quads | the `·150−25` magic numbers → one view transform |

The half-edge structure (`docs/04`) is the main *addition* — the reference re-scans the quad
list to find incident faces (`O(quads)` per vertex); half-edge makes that an `O(1)` orbit and
will matter once tiles + interaction arrive.
