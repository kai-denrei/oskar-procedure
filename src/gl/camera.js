// camera.js — orbit camera around a target. Uses mat4 for view + projection.
// State: { azimuth, elevation, distance, target:[x,y,z] }. World z is UP.
//   azimuth   yaw around the vertical (z) axis (radians)
//   elevation pitch above the horizon, clamped to ~[5°, 85°]
//   distance  eye distance from target
// Pure-ish: depends only on mat4 (no DOM/GL). The eye is derived from spherical
// coords; viewMatrix() is lookAt(eye, target, +z).

import { perspective, lookAt } from './mat4.js?v=2b44eac3';

const DEG = Math.PI / 180;
const MIN_EL = 5 * DEG;
const MAX_EL = 85 * DEG;
const MIN_DIST = 0.05;

export function createCamera(opts = {}) {
  const state = {
    azimuth: opts.azimuth != null ? opts.azimuth : -Math.PI / 4, // 3/4 view
    elevation: opts.elevation != null ? opts.elevation : 35 * DEG,
    distance: opts.distance != null ? opts.distance : 3,
    target: opts.target ? opts.target.slice() : [0, 0, 0],
    fovy: opts.fovy != null ? opts.fovy : 50 * DEG,
    near: opts.near != null ? opts.near : 0.01,
    far: opts.far != null ? opts.far : 100,
  };

  function clamp() {
    if (state.elevation < MIN_EL) state.elevation = MIN_EL;
    if (state.elevation > MAX_EL) state.elevation = MAX_EL;
    if (state.distance < MIN_DIST) state.distance = MIN_DIST;
  }

  // Eye position from spherical coords around the target (z up).
  function eye() {
    const ce = Math.cos(state.elevation);
    const se = Math.sin(state.elevation);
    const ca = Math.cos(state.azimuth);
    const sa = Math.sin(state.azimuth);
    return [
      state.target[0] + state.distance * ce * ca,
      state.target[1] + state.distance * ce * sa,
      state.target[2] + state.distance * se,
    ];
  }

  return {
    state,
    eye,

    viewMatrix() {
      // up = +z. lookAt computes a valid basis as long as the view dir isn't
      // parallel to up — guaranteed since elevation < 90°.
      return lookAt(eye(), state.target, [0, 0, 1]);
    },

    projMatrix(aspect) {
      return perspective(state.fovy, aspect || 1, state.near, state.far);
    },

    // Drag: dAz radians of yaw, dEl radians of pitch (clamped).
    orbit(dAz, dEl) {
      state.azimuth += dAz;
      state.elevation += dEl;
      clamp();
    },

    // factor < 1 zooms in (closer), > 1 zooms out.
    zoom(factor) {
      state.distance *= factor;
      clamp();
    },

    setTarget(t) {
      state.target = t.slice();
    },

    setDistance(d) {
      state.distance = d;
      clamp();
    },

    // Frame a bounds {min:[x,y,z], max:[x,y,z]}: target = center, distance from
    // the bounding-sphere radius so the whole patch fits the fovy.
    frameBounds(bounds) {
      if (!bounds) return;
      const cx = (bounds.min[0] + bounds.max[0]) / 2;
      const cy = (bounds.min[1] + bounds.max[1]) / 2;
      const cz = (bounds.min[2] + bounds.max[2]) / 2;
      state.target = [cx, cy, cz];
      const dx = bounds.max[0] - bounds.min[0];
      const dy = bounds.max[1] - bounds.min[1];
      const dz = bounds.max[2] - bounds.min[2];
      const radius = 0.5 * Math.hypot(dx, dy, dz) || 1;
      // distance so the sphere fits the (smaller) field of view, with margin.
      const fit = radius / Math.sin(state.fovy / 2);
      state.distance = fit * 1.25;
      // keep near/far sane around this distance
      state.far = Math.max(state.far, state.distance + radius * 4);
      clamp();
    },
  };
}
