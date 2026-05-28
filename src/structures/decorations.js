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
  const out = [];

  for (let qi = 0; qi < quads.length; qi++) {
    const q = quads[qi];
    const [cx, cy] = quadCentroid(q, vertices);
    const r = quadRadius(q, vertices, cx, cy);
    const topZ = quadTopZ(q, heights, floorH);

    if (biome === 'forest') {
      // ~40% chance of a tree per cell. Deterministic per (seed, qi).
      const pTree = hash01(seed, qi, 0xA11C);
      if (pTree < 0.40) {
        // Scale 0.7×–1.4× and orientation jitter (rotation cosmetic for cones).
        const scale = 0.7 + 0.7 * hash01(seed, qi, 0x70BE);
        const angle = hash01(seed, qi, 0xF00D) * Math.PI * 2;
        // Tree size scales with the cell so trees fit inside their cell.
        const trunkRadius = r * 0.10 * scale;
        const trunkHeight = r * 0.45 * scale;
        const canopyRadius = r * 0.40 * scale;
        const canopyHeight = r * 0.85 * scale;
        out.push({
          type: 'tree',
          x: cx, y: cy, z: topZ,
          trunkRadius, trunkHeight,
          canopyRadius, canopyHeight,
          angle,
        });
      }
    } else if (biome === 'meadows') {
      // 1–3 flowers per cell.
      const nFlowers = 1 + Math.floor(hash01(seed, qi, 0xF10F) * 3);
      for (let k = 0; k < nFlowers; k++) {
        // Place within ~60% of the cell radius around the centroid.
        const a = hash01(seed, qi, 0x100 + k) * Math.PI * 2;
        const radial = 0.15 + 0.45 * hash01(seed, qi, 0x200 + k);
        const fx = cx + Math.cos(a) * r * radial;
        const fy = cy + Math.sin(a) * r * radial;
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
      // Rare pond: ~4% of cells.
      if (hash01(seed, qi, 0xB0A7) < 0.04) {
        out.push({
          type: 'pond',
          x: cx, y: cy, z: Math.max(0, topZ) - floorH * 0.18,
          radius: r * 0.65,
        });
      }
    } else if (biome === 'swamps') {
      // Water plane covers the whole cell (the cell footprint as a flat quad).
      out.push({
        type: 'water',
        quadIndex: qi,
        z: floorH * 0.3,
      });
      // Rare reed cluster: ~12% of cells get 3–5 reeds.
      if (hash01(seed, qi, 0x7EED) < 0.12) {
        const nReeds = 3 + Math.floor(hash01(seed, qi, 0x8EED) * 3);
        for (let k = 0; k < nReeds; k++) {
          const a = hash01(seed, qi, 0x900 + k) * Math.PI * 2;
          const radial = 0.10 + 0.40 * hash01(seed, qi, 0xA00 + k);
          const fx = cx + Math.cos(a) * r * radial;
          const fy = cy + Math.sin(a) * r * radial;
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
