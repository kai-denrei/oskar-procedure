// camera.js — FIXED ISOMETRIC camera (orthographic) for the terrain playground.
// World z is UP. The camera no longer orbits: it is locked to a true-isometric
// view direction and only changes via zoom + a 4-way orientation (0–3 → N/E/S/W).
//
// State: { target:[x,y,z], orientation:0..3, zoom, halfExtent, near, far }
//   - elevation is FIXED at atan(1/√2) ≈ 35.264° (the true-iso angle).
//   - azimuth   = 45° + 90°·orientation (the classic iso yaw, rotatable in 90°s).
//   - zoom      scales the orthographic half-extent (smaller half-extent = more
//               zoomed in). halfExtent is the framed world radius; the effective
//               ortho extent is halfExtent / zoom.
//
// Projection is ORTHOGRAPHIC (parallel) — the iso look (no perspective
// foreshortening, parallel edges). Pure-ish: depends only on mat4 (no DOM/GL).

import { ortho, lookAt } from './mat4.js?v=1689f3b0';

const DEG = Math.PI / 180;
// True isometric elevation: the camera looks down a (1,1,1)-style diagonal, so
// the angle above the horizon is atan(1/√2) ≈ 35.264°.
const ISO_ELEVATION = Math.atan(1 / Math.SQRT2);
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 4;
// Eye distance from the target. With an orthographic projection the distance
// doesn't affect framing (parallel rays) — it only needs to be large enough to
// keep the whole patch inside [near, far]. Fixed and generous.
const EYE_DIST = 50;

export function createCamera(opts = {}) {
  const state = {
    target: opts.target ? opts.target.slice() : [0, 0, 0],
    orientation: opts.orientation != null ? ((opts.orientation % 4) + 4) % 4 : 0,
    zoom: opts.zoom != null ? opts.zoom : 1,
    halfExtent: opts.halfExtent != null ? opts.halfExtent : 1, // framed world radius
    near: opts.near != null ? opts.near : 0.01,
    far: opts.far != null ? opts.far : 200,
  };

  function clampZoom() {
    if (state.zoom < MIN_ZOOM) state.zoom = MIN_ZOOM;
    if (state.zoom > MAX_ZOOM) state.zoom = MAX_ZOOM;
  }

  // Azimuth for the current orientation: 45° base + 90° per step.
  function azimuth() {
    return (45 * DEG) + state.orientation * (90 * DEG);
  }

  // Eye position from the fixed iso elevation + current azimuth around target.
  function eye() {
    const el = ISO_ELEVATION;
    const az = azimuth();
    const ce = Math.cos(el);
    const se = Math.sin(el);
    const ca = Math.cos(az);
    const sa = Math.sin(az);
    return [
      state.target[0] + EYE_DIST * ce * ca,
      state.target[1] + EYE_DIST * ce * sa,
      state.target[2] + EYE_DIST * se,
    ];
  }

  return {
    state,
    eye,

    viewMatrix() {
      // up = +z. lookAt is valid since the iso view dir isn't parallel to +z.
      return lookAt(eye(), state.target, [0, 0, 1]);
    },

    projMatrix(aspect) {
      // Orthographic. Half-extent shrinks with zoom (bigger zoom = closer view).
      const a = aspect || 1;
      const ext = state.halfExtent / state.zoom;
      // Fit the framed radius into the SHORTER axis so the patch never clips.
      let halfW, halfH;
      if (a >= 1) {
        halfH = ext;
        halfW = ext * a;
      } else {
        halfW = ext;
        halfH = ext / a;
      }
      return ortho(-halfW, halfW, -halfH, halfH, state.near, state.far);
    },

    // Zoom factor in [MIN_ZOOM, MAX_ZOOM]; >1 zooms in (closer), <1 out.
    setZoom(z) {
      state.zoom = Number(z) || 1;
      clampZoom();
    },
    getZoom() {
      return state.zoom;
    },

    // factor < 1 zooms out, > 1 zooms in (kept for wheel parity — wheel passes a
    // multiplicative factor on the zoom level).
    zoom(factor) {
      state.zoom *= factor;
      clampZoom();
    },

    // Orientation 0..3 → azimuth 45°/135°/225°/315° (N/E/S/W rotations).
    setOrientation(k) {
      state.orientation = (((k | 0) % 4) + 4) % 4;
    },
    getOrientation() {
      return state.orientation;
    },

    setTarget(t) {
      state.target = t.slice();
    },

    // Frame a bounds {min:[x,y,z], max:[x,y,z]}: center the target, set the
    // ortho half-extent from the bounding radius (with margin). Orientation +
    // zoom are preserved (this only resets the framing extent + target).
    frameBounds(bounds) {
      if (!bounds) return;
      const cx = (bounds.min[0] + bounds.max[0]) / 2;
      const cy = (bounds.min[1] + bounds.max[1]) / 2;
      const cz = (bounds.min[2] + bounds.max[2]) / 2;
      state.target = [cx, cy, cz];
      const dx = bounds.max[0] - bounds.min[0];
      const dy = bounds.max[1] - bounds.min[1];
      const dz = bounds.max[2] - bounds.min[2];
      // Iso-projected footprint: x/y span both contribute to the on-screen
      // width/height. Use the planar diagonal (covers a 90° rotation too) plus
      // the height contribution, halved to a radius, with a comfortable margin.
      const planar = Math.hypot(dx, dy);
      const radius = 0.5 * Math.max(planar, dz) || 1;
      state.halfExtent = radius * 1.25;
      // keep near/far safely around the eye distance
      state.far = Math.max(state.far, EYE_DIST + radius * 4);
    },
  };
}
