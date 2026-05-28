// poisson.js — Bridson Poisson-disk sampling in normalized [0,1]² space.
//
// Stage 1 of the M1 grid kernel. Pure logic, NO DOM. The PRNG is INJECTED so
// results are reproducible by seed (no Math.random anywhere). Returns an array
// of [x,y] points, inset from the boundary by ·0.85 + 0.075.
//
//   import { mulberry32 } from './rng.js?v=2b44eac3';
//   poissonDisk(mulberry32(seed), { r: 0.1, k: 30 }) -> [[x,y], ...]

import { dist } from './vec.js?v=2b44eac3';

// rng: () -> float in [0,1). r: min spacing. k: candidate attempts per point.
export function poissonDisk(rng, { r = 0.1, k = 30 } = {}) {
  const cellSize = r / Math.SQRT2; // ≤1 point per cell
  const gridW = Math.ceil(1 / cellSize);
  const gridH = Math.ceil(1 / cellSize);
  // grid[row*gridW + col] = index into points, or -1 if empty
  const grid = new Int32Array(gridW * gridH).fill(-1);

  const points = [];
  const active = [];

  const cellIndex = (x, y) => {
    const col = Math.floor(x / cellSize);
    const row = Math.floor(y / cellSize);
    return row * gridW + col;
  };

  // Seed one random point.
  const x0 = rng();
  const y0 = rng();
  points.push([x0, y0]);
  grid[cellIndex(x0, y0)] = 0;
  active.push(0);

  while (active.length > 0) {
    // Pop an active point from the front (matches reference FIFO order).
    const s = active.shift();
    const [sx, sy] = points[s];

    let found = false;
    for (let i = 0; i < k; i++) {
      const theta = rng() * Math.PI * 2;
      // distance in [r, 2r): rng()*r + r
      const rad = rng() * r + r;
      const x2 = sx + rad * Math.cos(theta);
      const y2 = sy + rad * Math.sin(theta);
      if (x2 < 0 || y2 < 0 || x2 > 1 || y2 > 1) continue;

      const col = Math.floor(x2 / cellSize);
      const row = Math.floor(y2 / cellSize);
      if (grid[row * gridW + col] >= 0) continue; // cell already occupied

      // Check the 5×5 cell block around the candidate.
      let tooClose = false;
      for (let jr = Math.max(0, row - 2); jr <= Math.min(gridH - 1, row + 2) && !tooClose; jr++) {
        for (let jc = Math.max(0, col - 2); jc <= Math.min(gridW - 1, col + 2); jc++) {
          const idx = grid[jr * gridW + jc];
          if (idx >= 0 && dist([x2, y2], points[idx]) <= r) {
            tooClose = true;
            break;
          }
        }
      }

      if (!tooClose) {
        const newIdx = points.length;
        points.push([x2, y2]);
        grid[row * gridW + col] = newIdx;
        active.push(newIdx);
        found = true;
        break; // accept the first valid candidate
      }
    }

    // If we found a candidate this round, the source point may still spawn
    // more — keep it active (re-add to front). Otherwise retire it.
    if (found) active.unshift(s);
  }

  // Inset from the boundary: [0,1] -> [0.075, 0.925].
  return points.map(([x, y]) => [x * 0.85 + 0.075, y * 0.85 + 0.075]);
}
