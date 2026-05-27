// hex.js — hexagonal lattice seeder (Oskar Stålberg "Variant B"). Stage 1B of
// the grid kernel. Pure geometry: NO DOM, NO RNG (deterministic by construction;
// the pipeline's `seed` still drives the random dissolve downstream in grid.js).
//
// A triangular point lattice clipped to a hexagonal outline of `rings` rings
// around `center`. Triangular basis:
//   e1 = (spacing, 0)
//   e2 = (spacing/2, spacing·√3/2)
// A lattice node at axial coord (q, r) sits at: center + q·e1 + r·e2.
// Include every (q, r) with hex-distance max(|q|, |r|, |q+r|) ≤ rings.
//
// Ring k contributes 6·k points; total = 1 + 3·rings·(rings+1) (centered
// hexagonal numbers: rings 1→7, 2→19, 3→37, 4→61).
//
//   hexLattice({ rings, spacing = 0.1, center = [0, 0] }) -> { points, boundary }
//     points:   [[x,y], ...]  — the lattice nodes, world units, centered on `center`
//     boundary: number[]      — indices (into points) of the outermost ring's
//                               nodes (hex-distance == rings). Unused in H1;
//                               exposed for H2b shared-edge identification.

const SQRT3 = Math.sqrt(3);

// Hex (axial) distance from the origin (0,0). For axial coords this is
// max(|q|, |r|, |q+r|) — the cube-coordinate Chebyshev distance.
export function hexDistance(q, r) {
  return Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r));
}

export function hexLattice({ rings, spacing = 0.1, center = [0, 0] } = {}) {
  const R = rings | 0;
  if (!(R >= 1)) {
    throw new Error(`hexLattice: rings must be an integer >= 1, got ${rings}`);
  }

  const [cx, cy] = center;
  // Triangular basis vectors.
  const e1x = spacing,        e1y = 0;
  const e2x = spacing / 2,    e2y = (spacing * SQRT3) / 2;

  const points = [];
  const boundary = [];

  // Walk axial coords. For a hexagon of radius R the valid q-range is [-R, R];
  // for each q the r-range is clamped so hex-distance stays ≤ R.
  for (let q = -R; q <= R; q++) {
    const rLo = Math.max(-R, -q - R);
    const rHi = Math.min(R, -q + R);
    for (let r = rLo; r <= rHi; r++) {
      const x = cx + q * e1x + r * e2x;
      const y = cy + q * e1y + r * e2y;
      const idx = points.length;
      points.push([x, y]);
      if (hexDistance(q, r) === R) boundary.push(idx);
    }
  }

  return { points, boundary };
}
