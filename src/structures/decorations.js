// decorations.js — pure, low-poly decoration meshes layered on top of the
// floor + columns geometry per biome. NO DOM, NO GL — Node-testable.
//
//   generateDecorations({ biome, mesh, heights, seed, floorH }) -> Decoration[]
//
// Where Decoration is { type: 'tree'|'flower'|'pond'|'water'|'reeds', ... } and
// the renderable triangle list is built later by geometry.js (it knows how to
// place each primitive's vertices). Returning a declarative list (instead of
// raw triangles) keeps this module trivially testable and lets a future biome
// add new primitive types without touching the merger.
//
// Determinism: every random choice is a hash on (seed, cellIndex, slotIndex)
// so re-running with the same seed yields identical placement. No shimmer on
// rebuild.

// 32-bit integer hash → [0,1). Mirrors the one in terrain.js / biomes.js so
// decoration placement decorrelates against the same seed space.
function hash01(a, b, c) {
  let h = (a | 0) * 374761393 + (b | 0) * 668265263 + (c | 0) * 2246822519;
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 1274126177) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967296;
}

// Centroid of a quad's 4 vertex positions (planar xy).
function quadCentroid(quad, vertices) {
  let cx = 0, cy = 0;
  for (const vi of quad) { cx += vertices[vi][0]; cy += vertices[vi][1]; }
  return [cx / 4, cy / 4];
}

// Approximate "radius" of a quad — distance from centroid to its furthest
// corner. Used to scale decoration sizes relative to cell size, so decorations
// don't overflow neighbour cells.
function quadRadius(quad, vertices, cx, cy) {
  let maxR = 0;
  for (const vi of quad) {
    const dx = vertices[vi][0] - cx;
    const dy = vertices[vi][1] - cy;
    const r = Math.hypot(dx, dy);
    if (r > maxR) maxR = r;
  }
  return maxR;
}

// Inradius of a quad: minimum distance from the centroid to any of its 4
// edges. For a convex quad this gives the largest circle that fits inside.
// A decoration placed within `inradius` of the centroid is guaranteed to stay
// inside the quad (assuming it is convex, which relaxed quads are in practice).
function quadInradius(quad, vertices, cx, cy) {
  let minDist = Infinity;
  const n = quad.length;
  for (let i = 0; i < n; i++) {
    const a = vertices[quad[i]];
    const b = vertices[quad[(i + 1) % n]];
    // Signed distance from centroid to the edge line (a→b): ||(b-a) × (a-c)|| / ||b-a||
    const edx = b[0] - a[0], edy = b[1] - a[1];
    const len = Math.hypot(edx, edy);
    if (len < 1e-12) continue;
    const cross = Math.abs(edx * (a[1] - cy) - edy * (a[0] - cx));
    const d = cross / len;
    if (d < minDist) minDist = d;
  }
  return Number.isFinite(minDist) ? minDist : 0;
}

// Build a Set of boundary vertex indices from the mesh's boundary data.
// `mesh.boundary` may be a Set<number> or an array; returns a Set<number>.
function buildBoundarySet(mesh) {
  if (!mesh.boundary) return new Set();
  if (mesh.boundary instanceof Set) return mesh.boundary;
  return new Set(mesh.boundary);
}

// Returns true if any vertex of the quad is a boundary vertex.
function isBoundaryQuad(quad, boundarySet) {
  for (const vi of quad) { if (boundarySet.has(vi)) return true; }
  return false;
}

// World-z of a quad's top: max of its 4 corners' heights × floorH.
function quadTopZ(quad, heights, floorH) {
  let max = 0;
  for (const vi of quad) {
    const h = heights ? heights.get(vi) : 0;
    if (h > max) max = h;
  }
  return max * floorH;
}

/**
 * Build the decoration list for a biome.
 *
 * @param {{
 *   biome: string,
 *   mesh:  {vertices,quads},
 *   heights: any,    // createHeights() handle (has .get(vi))
 *   seed:  number,
 *   floorH: number,  // world units per floor
 * }} args
 * @returns {Array<object>}  one entry per decoration (type-tagged + params)
 */
export function generateDecorations({ biome, mesh, heights, seed = 0, floorH = 0.06 } = {}) {
  if (!mesh || !mesh.vertices || !mesh.quads || !mesh.quads.length) return [];

  // Mountains, dunes, quarry: terrain shape carries them — no decorations.
  if (biome === 'mountains' || biome === 'dunes' || biome === 'quarry') return [];

  const { vertices, quads } = mesh;
  const boundarySet = buildBoundarySet(mesh);
  const out = [];

  for (let qi = 0; qi < quads.length; qi++) {
    const q = quads[qi];
    const [cx, cy] = quadCentroid(q, vertices);
    const r = quadRadius(q, vertices, cx, cy);
    const inr = quadInradius(q, vertices, cx, cy);
    const topZ = quadTopZ(q, heights, floorH);

    if (biome === 'forest') {
      // Skip boundary cells so a tree's canopy can't poke past the hull edge.
      if (isBoundaryQuad(q, boundarySet)) continue;
      // ~40% chance of a tree per cell. Deterministic per (seed, qi).
      const pTree = hash01(seed, qi, 0xA11C);
      if (pTree < 0.40) {
        const scale = 0.7 + 0.7 * hash01(seed, qi, 0x70BE);
        const angle = hash01(seed, qi, 0xF00D) * Math.PI * 2;
        // Clamp the canopy to the cell's inradius so the whole tree stays inside
        // the quad; derive the rest from it (keeps the tree's proportions).
        const canopyRadius = Math.min(r * 0.40 * scale, inr * 0.9);
        const trunkRadius = canopyRadius * 0.25;
        const trunkHeight = canopyRadius * 1.1;
        const canopyHeight = canopyRadius * 2.1;
        out.push({
          type: 'tree',
          x: cx, y: cy, z: topZ,
          trunkRadius, trunkHeight,
          canopyRadius, canopyHeight,
          angle,
        });
      }
    } else if (biome === 'meadows') {
      // Skip boundary cells so flowers near the hull edge can't spill past it.
      if (isBoundaryQuad(q, boundarySet)) continue;

      // 1–3 flowers per cell. Clamp placement to within 85% of the inradius so
      // every flower is guaranteed inside the (convex) quad.
      const safeR = inr * 0.85;
      const nFlowers = 1 + Math.floor(hash01(seed, qi, 0xF10F) * 3);
      for (let k = 0; k < nFlowers; k++) {
        const a = hash01(seed, qi, 0x100 + k) * Math.PI * 2;
        // Radial distance: uniform in [0, safeR] (no minimum so centroid is reachable).
        const radial = safeR * hash01(seed, qi, 0x200 + k);
        const fx = cx + Math.cos(a) * radial;
        const fy = cy + Math.sin(a) * radial;
        // Pick a color from a four-stop meadow palette.
        const pal = [
          [0.95, 0.95, 0.90], // white
          [0.96, 0.84, 0.30], // yellow
          [0.93, 0.55, 0.68], // pink
          [0.50, 0.62, 0.92], // blue
        ];
        const c = pal[Math.floor(hash01(seed, qi, 0x300 + k) * pal.length) % pal.length];
        const size = r * 0.06 * (0.8 + 0.5 * hash01(seed, qi, 0x400 + k));
        out.push({
          type: 'flower',
          x: fx, y: fy, z: topZ,
          radius: size,
          height: size * 1.6,
          color: c,
        });
      }
      // Rare pond: ~4% of cells. Use centroid only (always inside).
      if (hash01(seed, qi, 0xB0A7) < 0.04) {
        // Clamp pond radius so it fits inside the cell (≤ inradius).
        const pondRadius = Math.min(r * 0.65, inr * 0.85);
        out.push({
          type: 'pond',
          x: cx, y: cy, z: Math.max(0, topZ) - floorH * 0.18,
          radius: pondRadius,
        });
      }
    } else if (biome === 'swamps') {
      // Water plane covers the whole cell (the cell footprint as a flat quad).
      out.push({
        type: 'water',
        quadIndex: qi,
        z: floorH * 0.3,
      });
      // Rare reed cluster: ~12% of interior cells get 3–5 reeds, kept inside
      // the cell via the inradius (like meadow flowers).
      if (!isBoundaryQuad(q, boundarySet) && hash01(seed, qi, 0x7EED) < 0.12) {
        const safeR = inr * 0.85;
        const nReeds = 3 + Math.floor(hash01(seed, qi, 0x8EED) * 3);
        for (let k = 0; k < nReeds; k++) {
          const a = hash01(seed, qi, 0x900 + k) * Math.PI * 2;
          const radial = safeR * hash01(seed, qi, 0xA00 + k);
          const fx = cx + Math.cos(a) * radial;
          const fy = cy + Math.sin(a) * radial;
          out.push({
            type: 'reed',
            x: fx, y: fy, z: floorH * 0.3,
            radius: r * 0.018,
            height: r * (0.25 + 0.20 * hash01(seed, qi, 0xB00 + k)),
          });
        }
      }
    }
  }
  return out;
}
