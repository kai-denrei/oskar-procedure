# 01 — The concept

Stålberg's contribution is best understood not as a single algorithm but as a **separation of
concerns** that lets a human artist's handmade meshes survive an automated placement system
without looking automated. Three ideas stack on top of each other. Each is independently
useful; together they produce the *Townscaper* look.

---

## Idea 1 — The irregular quad grid

### The problem

Two obvious grid choices each fail:

- **Regular square / voxel grid.** Tiles fit trivially (everything is a unit square), but the
  result reads as obviously gridded. Stiff. Mechanical. The repetition is the first thing the
  eye catches.
- **Voronoi / Delaunay / Poisson mesh.** Organic and varied, but cells are triangles or
  irregular polygons. Rectangular handmade art (walls, windows, roof ridges) has nothing
  square to map onto. You'd need bespoke art per cell.

### The resolution

Make every cell a **quadrilateral** — four-sided, so a square-ish tile maps on — but let the
*connectivity and shape* be organic. You get art-friendliness from the quad constraint and
natural variation from the irregularity.

The non-obvious part is *how* you guarantee an all-quad mesh from organic input. Pure
quadrangulation of a point set is hard and not guaranteed. Stålberg's trick sidesteps it:

```
seed points → triangulate → dissolve some edges (merge triangle pairs → quads)
            → subdivide EVERY face into quads → relax toward square
```

The subdivision step is the guarantee: a triangle splits into **3** quads (centroid + edge
midpoints), a quad splits into **4** quads. So however messy the merge step left things —
some quads, some leftover triangles — after subdivision **everything is a quad**, period. The
merge step isn't required to succeed; it just reduces how many tiny quads you end up with and
shapes the final connectivity.

Relaxation then iteratively nudges each vertex so its surrounding quads become as square as
possible, hiding the triangular ancestry. (Two relaxation formulations exist — see `docs/02`.)

The seeding choice matters for the final *feel*:
- **Hex lattice** (Stålberg) — deterministic, tileable to infinity, leaves a faint hexagonal
  memory in the relaxed grid. This is the Townscaper signature.
- **Poisson disk** (andersource) — isotropic, no preferred direction, slightly more "random".

---

## Idea 2 — The dual grid and corner-state

### Corner-state, not cell-state

The intuitive way to drive generation is per-cell: "this cell is land, that one is water."
With 4 neighbours that's 2⁴ = 16 boundary cases in 2D; in 3D marching cubes it's 2⁸ = 256.
You'd author a mesh per case (minus symmetry), and the count is painful.

Stålberg instead stores state on **corners**. A tile is selected by looking at its 4 corner
values. Under rotation + reflection symmetry the 16 corner-configurations collapse to a small
canonical set (the classic marching-squares reduction lands at **6** distinct shapes). You
author six meshes — convex corner, concave corner, edge, full, empty, etc. — and symmetry
covers the rest by rotating/mirroring the same asset.

### The dual grid

The "dual grid" is a copy of the grid offset by half a cell: every *vertex* of the primary
grid becomes the *center* of a dual cell, and vice versa. In the reference implementation this
falls out naturally — **the paintable cell in Townscaper is the dual cell**: take a vertex,
collect the centroids of every quad touching it, sort them by angle, and that polygon (a
rounded quad / pentagon / hexagon depending on vertex degree) is what the player paints. This
is why the playable cells look like soft hexagons even though the underlying mesh is quads.

Why dual? Because corner-state is most naturally edited on the dual: clicking a dual cell
toggles the value at the corresponding primary-grid vertex, which is exactly the corner whose
value the tile-selection logic reads.

---

## Idea 3 — Deformation to fit

Authoring six tiles solves the *combinatorial* problem but not the *geometric* one: the cells
are irregular quads, and a tile modeled as a clean unit square won't sit in a warped cell
without gaps or overlaps.

Solution: model each tile in a canonical **unit cell** ([0,1]² in 2D, [0,1]³ in 3D), then map
every tile vertex into the target cell by **interpolation**:

- **Bilinear** for a 2D quad cell: a vertex at parameter (u, v) maps to
  `lerp(lerp(c00, c10, u), lerp(c01, c11, u), v)` where c?? are the four cell corners.
- **Trilinear** for a 3D cube/prism cell (the extruded quad columns): same idea with a third
  parameter w and eight corners.
- **Barycentric** for the rare triangle cell.

The tile *squashes and stretches* to fit. Because the deformation is continuous and shared
along edges, adjacent tiles stay seamlessly connected. The grid's irregularity is now
**hidden inside the art** rather than fought against.

Two finishing moves break visual repetition:
- **Multiple variants per family** — author several meshes for each of the six cases; pick one
  at random per placement.
- **Pattern-matched specials** — check a cell's neighbourhood; when it matches a specific
  pattern, swap the standard tiles for a special piece that spans multiple cells (an arch, a
  big roof, a tower). These are the "architectural flourishes" that make a town feel authored.

---

## Driver: who decides what goes where

The tile *system* (ideas 1–3) is identical across Stålberg's games. Only the **driver**
differs:

- **Townscaper** — the player clicks. Pure manual placement; the system just resolves
  corner-state into deformed tiles.
- **Bad North** — fully automatic via **Wave Function Collapse / Model Synthesis**: the
  algorithm fills the grid with tiles whose edge-constraints are mutually compatible, no human
  input. (See Boris the Brave and mxgmn/WaveFunctionCollapse in `docs/05`.)

For this project, manual click first (M2–M3); WFC is the optional M5.
