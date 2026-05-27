# 03 — Dual grid, corner-state, and tile deformation

Covers everything past the bare grid: how state is stored, how tiles are chosen, and how
handmade meshes deform to fit irregular cells. Milestones M2–M4.

---

## The dual grid

Two interleaved grids, offset by half a cell:

- **Primary grid** — the relaxed quad mesh from `docs/02`. Its faces are the quads; its
  vertices are the corners.
- **Dual grid** — one cell per primary *vertex*, formed by joining the centroids of all quads
  around that vertex (see stage 6). One dual *vertex* per primary face centroid.

Why both:
- **Tiles render on the primary quads** (each quad column becomes a tile).
- **The player edits the dual** (clicking a dual cell toggles the corner value at the primary
  vertex it surrounds).
- **Corner-state is read from primary vertices** — exactly the values the dual edits.

So: paint a dual cell → flip a corner bit → the up-to-four quads touching that corner
re-select their tiles. Clean loop.

---

## Corner-state and the 6 tile families

Store a value per primary-grid vertex (corner). Simplest is boolean (`filled / empty`) but it
generalizes to height levels (Townscaper stacks floors) or material IDs.

A quad's tile is chosen by its **4 corner values**. With booleans that's 2⁴ = 16
configurations. Under the symmetry group of the square (4 rotations × 2 reflections = 8
elements) they collapse to **6 canonical cases**:

| # | Corners filled | Shape | Notes |
|---|----------------|-------|-------|
| 0 | none | empty | no tile |
| 1 | one | convex corner | outer rounded corner |
| 2 | two adjacent | edge / wall | straight run |
| 3 | two diagonal | saddle | ambiguous case — pick a convention |
| 4 | three | concave corner | inner rounded corner |
| 5 | four | full | solid interior |

Author one mesh per case (or several variants each — see below). At placement, determine the
case, then **rotate/mirror** the canonical mesh by the transform that maps the canonical
configuration onto the actual one. The diagonal case (#3) is genuinely ambiguous (two ways to
connect); fix a deterministic convention so the mesh is consistent.

> 3D note: stacking floors turns this into a marching-cubes-style problem (2⁸ = 256 → a
> canonical set after symmetry). Stålberg's geometry is effectively 2.5D — a 2D corner grid
> extruded into columns — so you can often stay with the 2D 6-case logic per floor plus
> vertical connectors, rather than full 3D marching cubes.

---

## Deformation: fitting unit-cell art to irregular cells

Author each tile in a **canonical unit cell**: a unit square [0,1]² (2D) or unit cube [0,1]³
(3D extruded column). Store each tile vertex by its **parameters** (u, v) or (u, v, w) within
that unit cell, *not* absolute coordinates.

At placement, map each tile vertex into the target cell by interpolating the cell's corners.

### Bilinear (2D quad cell)

Cell corners `c00, c10, c01, c11`. Tile vertex at (u, v):

```
bottom = lerp(c00, c10, u)
top    = lerp(c01, c11, u)
world  = lerp(bottom, top, v)
```

### Trilinear (3D cube / extruded quad column)

Eight corners `cijk` (i,j,k ∈ {0,1}). Tile vertex at (u, v, w):

```
interpolate the 4 bottom corners by (u,v)  → p0   (as bilinear above, w=0 face)
interpolate the 4 top corners by (u,v)      → p1   (w=1 face)
world = lerp(p0, p1, w)
```

For Townscaper-style columns, the bottom face is the relaxed quad and the top face is the same
quad lifted by the floor height (optionally with its own slight relaxation/offset).

### Barycentric (triangle cell)

For the rare triangle cell (if you keep any), map via barycentric weights of the 3 corners.
With the subdivide-everything approach you usually have **no triangle cells left**, so this is
mostly academic — keep bilinear/trilinear as the workhorses.

### Why it stays seamless

Deformation is a continuous function of the shared cell corners. Two adjacent tiles share an
edge's corners, so their deformed boundary vertices land at the same world positions →
no cracks. This is the whole point: the irregularity lives *inside* the deformation, invisible.

---

## Breaking repetition

1. **Variants per family.** Model several meshes for each of the six cases. Pick one
   pseudo-randomly per placement (seed by cell id so it's stable across redraws).
2. **Pattern-matched specials.** Inspect a cell's neighbourhood; if it matches a registered
   pattern (e.g. a 2×1 run of full cells on the perimeter), replace the standard tiles with a
   **special multi-cell piece** (arch, bridge, big roof, tower). These are the authored
   "flourishes" that make a generated town feel hand-built. Implement as: pattern table →
   match → claim the covered cells → place the special mesh deformed across the union of those
   cells' corners.

---

## Drivers (who sets corner-state)

- **Manual (Townscaper, our M2–M3).** Player clicks dual cells; toggle corner values.
- **WFC / Model Synthesis (Bad North, our optional M5).** Tiles carry edge-compatibility
  constraints; the solver fills the grid with a globally consistent assignment, no human
  input. Adjacency constraints are defined on the 6 families' edges. See `docs/05` for the
  canonical WFC references (mxgmn, Boris the Brave's editable-WFC writeup).

The tile system below the driver is identical in both cases.
