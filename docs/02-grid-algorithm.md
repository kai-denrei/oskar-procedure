# 02 — The grid generation algorithm

This is the conceptual core (milestone M1). Two variants are documented: the **andersource**
variant (what the reference code does) and the **Stålberg** variant (what the original talk
describes). They share stages 3–4; they differ on seeding (stage 1) and relaxation (stage 5).

Pipeline:

```
1. seed points        2. triangulate        3. dissolve → quads
4. subdivide → quads  5. relax              (6. extract dual cells)
```

---

## Stage 1 — Seed points

### Variant A (andersource): Poisson disk sampling

Bridson's algorithm in normalized [0,1]² space. Reference params: radius `r = 0.1`, samples
per active point `k = 30`. Output is rescaled to a margin (`·0.85 + 0.075`) so points don't
hug the boundary, then later mapped to screen with `·150 − 25`.

Bridson sketch:
1. Grid-accelerate with cell size `r/√2` (so each cell holds ≤1 point).
2. Seed one random point; mark active.
3. While active list non-empty: pop an active point, try `k` candidates at distance `[r, 2r)`
   and random angle; accept the first that's ≥ `r` from all neighbours (check the 5×5 cell
   block); if none accepted, retire the point.

Properties: blue-noise distribution, minimum spacing `r`, no preferred direction.

### Variant B (Stålberg): hex lattice

Points arranged in concentric hexagonal rings (centre point, then ring of 6, ring of 12, …).
Deterministic and tileable to infinity. The relaxed grid retains a faint hexagonal memory —
**this is the Townscaper signature look**. Prefer this variant if matching Townscaper exactly
matters; prefer Poisson if you want a more isotropic, less directional result.

---

## Stage 2 — Triangulate

Delaunay triangulation of the seed points.

- Variant A uses **Delaunator** (Mapbox; tiny, fast, ESM-importable). Output is a flat
  `triangles` index array; group into triples.
- Variant B (hex) can connect the lattice into triangles directly (each hex ring + centre is
  a known fan), no Delaunay needed — though Delaunay also works.

### Filter degenerate triangles (Variant A)

Delaunay on a bounded point set produces sliver triangles along the convex hull. Drop any
triangle whose largest angle ≥ `MAX_ANGLE = π/2 · 1.65 ≈ 148.5°`. Compute the angle via the
law of cosines on the sorted edge lengths:

```
angle_opposite_longest = acos((a² + b² − c²) / (2ab))   // a ≤ b ≤ c
drop triangle if angle ≥ MAX_ANGLE
```

This trims the ragged boundary so the merge step has cleaner material.

---

## Stage 3 — Dissolve edges → merge triangle pairs into quads

Greedily merge pairs of triangles that share an edge into a single quadrilateral, subject to
quality constraints.

Algorithm (Variant A, the reference):

```
tabu = empty set
loop:
  count interior edges (edges shared by exactly 2 triangles), skipping tabu edges
  candidates = edges with count > 1
  if none: break
  shuffle-pick a candidate edge:
    find the 2 triangles sharing it; their 2 non-shared vertices = opp1, opp2
    candidate_quad = [edge.a, opp1, edge.b, opp2]      // interleaved → correct quad order
    if legit(candidate_quad):
      accept: add quad, remove both triangles
      restart outer loop
    else:
      tabu the edge; try next candidate
```

`legit(quad)` rejects non-convex or badly-shaped quads. Check, walking the 4 corners:
- **Convex**: the cross product (turn direction) has the **same sign** at all 4 corners.
- **Angles bounded**: every interior angle in `[0.2π, 0.9π]` = `[36°, 162°]` (via the dot
  product of incoming/outgoing edge directions, `acos`).

Leftover triangles that never found a legal merge partner are fine — stage 4 handles them.

> Variant B does the same conceptually ("randomly dissolve edges to merge triangle pairs"),
> just over the hex-derived triangulation.

---

## Stage 4 — Subdivide every face into quads

This is the **guarantee** step. After it, the mesh is 100% quads regardless of stage 3's mess.

For each face, compute its **centroid** and the **midpoint of each edge** (midpoints are
*shared* between adjacent faces — dedupe them by a canonical edge key `min-max`, so the mesh
stays watertight). Then:

- **Triangle → 3 quads.** For each of the 3 corners: `[corner, edge1_mid, centroid, edge2_mid]`
  where edge1/edge2 are the two edges meeting at that corner.
- **Quad → 4 quads.** For each of the 4 corners: `[corner, edge1_mid, centroid, edge2_mid]`.

Same construction either way — iterate the corners, each emits one small quad built from the
corner, its two adjacent edge-midpoints, and the face centroid.

### Normalize winding

After building all quads, flip any that are clockwise so all are consistently CCW (check the
cross product of the first two edges; reverse the index list if negative). Consistent winding
matters for the relaxation math and later for face normals / tile orientation.

---

## Stage 5 — Relax toward squareness

Iteratively move vertices so every quad approaches a square. Two formulations:

### Variant A (andersource): closest-square fit, closed form

For each quad, find the **square** that (1) shares the quad's centroid, (2) has a fixed side
length, (3) is rotated to minimize the sum of squared distances from quad corners to square
corners. There's a closed-form solution for the optimal angle. Accumulate per-vertex the
displacement `(target_square_corner − current_corner)` summed over all incident quads, then
move every vertex by `forces · PULL_RATE`. Repeat.

Reference params: `SIDE_LENGTH = 0.06`, `r = SIDE_LENGTH/√2` (centroid-to-corner radius),
`PULL_RATE = 0.3`, `n_iters = 100`.

Per-quad step:
```
center the quad: q[i] -= centroid(q)            // work relative to centroid
denom = q0.x − q1.y − q2.x + q3.y               // guard |denom| ≥ 1e-10, keep sign
num   = q0.y + q1.x − q2.y − q3.x
alpha = atan(num / denom)
if cos(alpha)·denom + sin(alpha)·num < 0: alpha += π   // pick the minimizing branch
// target square corners (relative to centroid), radius r:
target = [ ( r·cosα,  r·sinα),
           ( r·sinα, −r·cosα),
           (−r·cosα, −r·sinα),
           (−r·sinα,  r·cosα) ]
for i in 0..3: force[ q.vertexIndex[i] ] += target[i] − q_centered[i]
```
After all quads: `pos += force · PULL_RATE`, zero the forces, next iter.

#### Derivation of `alpha` (the appendix worth keeping)

Order the quad corners clockwise about the centroid (set centroid = origin). Square corners,
clockwise, for angle α and radius r:

```
( r·cosα,  r·sinα),  ( r·sinα, −r·cosα),  (−r·cosα, −r·sinα),  (−r·sinα,  r·cosα)
```

Minimize `D(α) = Σ (xᵢ − xᵢ′)² + (yᵢ − yᵢ′)²`. Expanding and dropping α-independent terms
leaves a `cosα·A + sinα·B` form; setting `D′(α) = 0`:

```
alpha = arctan( (y0 + x1 − y2 − x3) / (x0 − y1 − x2 + y3) ) + k·π,  k ∈ {0,1}
```

Two roots: one minimizes, one maximizes (the 180°-rotated square). Pick the minimizing branch
via the sign check above (equivalently, the `k` for which `D″(α) > 0`).

Squared distance (not absolute) is chosen because it gives the clean closed form *and* encodes
"move two vertices a little rather than one vertex a lot."

### Variant B (Stålberg): neighbour-equidistant relaxation

The original talk describes relaxation as moving each vertex toward the position that is
**equidistant from its connected neighbours** — a Laplacian-style smoothing that, combined with
the quad structure, settles into squarish cells. Simpler to state, behaves similarly. Variant A's
closest-square fit is more explicit about the "square" objective and is better documented, so
**use Variant A's relaxation as the default**; keep B in mind as the canonical reference.

---

## Stage 6 — Extract dual cells (for painting; M2)

Not part of grid generation per se, but it's how the grid becomes playable.

For each vertex with **≥ 3 incident quads** (interior vertices): collect the **centroids** of
all quads touching it, sort them by angle around the vertex, and emit that polygon. That
polygon is the **dual cell** — the soft hexagon/pentagon/quad the player paints. Boundary
vertices (< 3 incident quads) are skipped; they have no complete dual cell.

Render dual cells with rounded corners (the reference uses a quadratic/Catmull-Rom-style path
through edge-midpoints with the corner points as control points) for the Townscaper softness.

---

## Parameter quick-reference (Variant A defaults)

| Symbol | Value | Meaning |
|--------|-------|---------|
| `r` (Poisson) | 0.1 | min point spacing |
| `k` | 30 | Poisson candidate attempts |
| `MAX_ANGLE` | π/2·1.65 ≈ 148.5° | drop triangles flatter than this |
| angle bounds | [36°, 162°] | legal quad interior angles |
| `SIDE_LENGTH` | 0.06 | target square side in relaxation |
| `PULL_RATE` | 0.3 | relaxation step size |
| `n_iters` | 100 | relaxation iterations |

These are tuned for normalized [0,1] space. Rescale consistently if you change the working
coordinate range.
