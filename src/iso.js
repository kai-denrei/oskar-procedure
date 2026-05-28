// iso.js — isometric projection for the 3D "floor" tab. Pure math, NO DOM.
//
// The grid plane is the ground: a grid vertex (gx, gy) becomes the 3D ground
// point (gx, gy, 0). z is UP (reserved for future structures). The camera spins
// around the vertical (z) axis by `angle` (yaw), then projects with a fixed
// ~30° isometric tilt. Pure functions ⇒ unit-testable & deterministic.
//
//   makeIsoCamera({ angle, scale, ox, oy }) -> { project, depth, angle, scale, ox, oy }
//     project([x,y,z=0]) -> [sx, sy]   ground → screen (CSS px)
//     depth([x,y,z=0])   -> number     painter key; LARGER = nearer-front
//
//   fitIso(points3d, cam0, cssW, cssH, margin) -> { scale, ox, oy }
//     Project all points with a unit camera at cam0's angle, measure the screen
//     bbox, and return scale+offset so the projection fits centered with margin.

export const ISO = Math.PI / 6; // 30° iso tilt

/**
 * Build an isometric camera. All parameters are plain numbers so the camera is
 * a deterministic, DOM-free value object.
 *
 * @param {{angle?:number, scale?:number, ox?:number, oy?:number}} opts
 *   angle  yaw around the vertical axis (radians)
 *   scale  world-unit → screen-pixel multiplier
 *   ox,oy  screen-space origin (where world (0,0,0) lands before per-point offset)
 */
export function makeIsoCamera({ angle = 0, scale = 1, ox = 0, oy = 0 } = {}) {
  const ca = Math.cos(angle), sa = Math.sin(angle);
  const cIso = Math.cos(ISO), sIso = Math.sin(ISO);

  return {
    angle, scale, ox, oy,

    project([x, y, z = 0]) {
      // yaw in the ground plane
      const rx = x * ca - y * sa;
      const ry = x * sa + y * ca;
      // standard iso basis; z lifts UP the screen (negative screen-y)
      const sx = (rx - ry) * cIso;
      const sy = (rx + ry) * sIso - z;
      return [ox + sx * scale, oy + sy * scale];
    },

    depth([x, y, z = 0]) {
      // ground-depth toward camera minus height. Larger = nearer the viewer
      // (drawn later, on top). Independent of scale/origin (ordering only).
      return (x * sa + y * ca) - z;
    },
  };
}

/**
 * Compute a scale + screen origin that frames `points3d` (projected at cam0's
 * angle) centered in a cssW×cssH canvas with `margin` (fraction of the shorter
 * side) of padding on each edge. Re-deriving this every frame keeps the floor
 * framed at any rotation (the projected bbox changes as the camera spins).
 *
 * @param {Array<[number,number,number?]>} points3d  world points to frame
 * @param {{angle:number}} cam0  any camera (only its angle is used)
 * @param {number} cssW
 * @param {number} cssH
 * @param {number} margin  fraction of min(cssW,cssH), per side
 * @returns {{scale:number, ox:number, oy:number}}
 */
export function fitIso(points3d, cam0, cssW, cssH, margin = 0.08) {
  // Unit camera at the target angle (no scale, origin at 0) to measure the
  // raw projected bounding box.
  const unit = makeIsoCamera({ angle: cam0.angle, scale: 1, ox: 0, oy: 0 });

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points3d) {
    const [sx, sy] = unit.project(p);
    if (sx < minX) minX = sx;
    if (sy < minY) minY = sy;
    if (sx > maxX) maxX = sx;
    if (sy > maxY) maxY = sy;
  }
  if (!Number.isFinite(minX)) {
    return { scale: 1, ox: cssW / 2, oy: cssH / 2 };
  }

  const bw = Math.max(1e-9, maxX - minX);
  const bh = Math.max(1e-9, maxY - minY);

  const pad = Math.min(cssW, cssH) * margin;
  const availW = Math.max(1e-9, cssW - 2 * pad);
  const availH = Math.max(1e-9, cssH - 2 * pad);

  // Uniform scale that fits both dimensions of the projected box.
  const scale = Math.min(availW / bw, availH / bh);

  // Center the scaled box: place its midpoint at the canvas center. The unit
  // projection maps world (0,0,0) to (0,0), so ox/oy is the offset that lands
  // the box's projected center at the canvas center.
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const ox = cssW / 2 - cx * scale;
  const oy = cssH / 2 - cy * scale;

  return { scale, ox, oy };
}
