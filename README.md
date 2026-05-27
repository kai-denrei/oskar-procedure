# oskar-procedure

A from-scratch local recreation of the conceptual breakthrough behind Oskar Stålberg's
*Townscaper* / *Bad North*: an **organic irregular quad grid** that lets handcrafted art
survive procedural placement.

This repo is, for now, **documentation + a build brief**. No app code yet. The goal of this
phase is to get the real algorithm written down precisely enough that it can be rebuilt
locally as a vanilla ES-module web project (no framework, no build step).

## The breakthrough in one paragraph

Voxel/square grids look stiff; pure triangle or Voronoi meshes don't accept rectangular art.
Stålberg gets both: every cell is a **quadrilateral** (so square-ish tiles map onto it) but
the connectivity is **organic**. He reaches it by going *through* triangles —
triangulate → dissolve edges to merge triangle pairs into quads → subdivide every face into
quads → relax vertices toward squareness. Then state lives on **corners** (not cells), which
collapses the tile-case explosion via symmetry, and handmade tiles are **deformed** to fit
each irregular cell so the grid's irregularity is hidden rather than fought.

## Three ideas, stacked

1. **Irregular quad grid** — tri → quad → subdivide → relax. The conceptual core. (`docs/02`)
2. **Dual grid / corner-state** — tile chosen by 4 corner values; 16 cases → ~6 under
   symmetry. Paintable cells are the *dual* of the quad mesh. (`docs/03`)
3. **Deformation to fit** — author tiles in a unit cell; bilinear/trilinear/barycentric map
   onto the target cell. Variants + pattern-matched specials kill repetition. (`docs/03`)

Driver: manual click (*Townscaper*) vs. WFC / Model Synthesis (*Bad North*). Same tile system.

## Repo map

```
oskar-procedure/
├── README.md                          ← you are here
├── HANDOVER.md                        ← build brief for Claude Code CLI (start here to build)
├── docs/
│   ├── 01-concept.md                  the breakthrough, in depth
│   ├── 02-grid-algorithm.md           grid generation, both variants, full math
│   ├── 03-dual-grid-and-tiles.md      corner-state, tile families, deformation
│   ├── 04-architecture.md             four-layer decomposition + tech decisions
│   ├── 05-references.md               annotated sources
│   └── 06-reference-impl-analysis.md  walkthrough of the andersource source
└── reference/
    └── andersource-organic-grid.js    pulled reference implementation (read-only study)
```

## Build path (summary)

| Milestone | Deliverable | Gate |
|-----------|-------------|------|
| M0 | Scaffold: index.html + ES module entry, canvas, regenerate button | renders blank canvas |
| M1 | **Grid kernel**: points → quad mesh → relax, drawn as lines | organic grid breathes on regenerate |
| M2 | Half-edge structure + dual cells + click-to-paint | paint rounded cells |
| M3 | Corner-state + 2D deformed tiles | six tile families place correctly |
| M4 | 3D extrude + trilinear tiles | walls/roofs appear in 3D |
| M5 | WFC / Model Synthesis auto-fill driver | code-generated towns |

M1 is the conceptual core and gates everything. Nail it first. Estimated ~200 lines.

## Status

- [x] Sources investigated, algorithm extracted
- [x] Reference implementation pulled and analysed
- [ ] M0–M5 (not started)

See `HANDOVER.md` to begin building.
