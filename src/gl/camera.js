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

import { ortho, lookAt } from './mat4.js?v=d5410cfc';

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

    // Pan the target in world XY, relative to the CURRENT orientation: dx is
    // "screen-right" amount (the camera's right axis projected to the ground),
    // dy is "screen-up / forward" (the camera's projected forward on the
    // ground plane). Z is held at the current target z so we never lose the
    // mesh's vertical mid. Soft-clamped against `bounds` (when provided) so
    // the patch stays mostly on screen.
    pan(dx, dy, bounds = null) {
      // The camera's azimuth defines its ground-plane forward; right is +90°.
      // Forward direction (in world XY, pointing FROM eye TOWARD target on the
      // ground plane). Eye is in the +cos/+sin direction at azimuth `az`, so
      // forward (target − eye xy) is (−cos az, −sin az). Right = forward · R(-90°).
      const az = azimuth();
      const fx = -Math.cos(az);
      const fy = -Math.sin(az);
      const rx = fy;          // right = forward rotated -90° in xy
      const ry = -fx;
      state.target[0] += rx * dx + fx * dy;
      state.target[1] += ry * dx + fy * dy;
      // Soft clamp: never let the target wander further than the patch radius
      // outside the bounds, so the user can't lose the mesh entirely.
      if (bounds && bounds.min && bounds.max) {
        const cx = (bounds.min[0] + bounds.max[0]) / 2;
        const cy = (bounds.min[1] + bounds.max[1]) / 2;
        const radius = Math.hypot(
          bounds.max[0] - bounds.min[0],
          bounds.max[1] - bounds.min[1]
        ) * 0.6; // a bit more than half-diagonal so we don't snap mid-pan
        const ox = state.target[0] - cx;
        const oy = state.target[1] - cy;
        const d = Math.hypot(ox, oy);
        if (d > radius) {
          state.target[0] = cx + (ox / d) * radius;
          state.target[1] = cy + (oy / d) * radius;
        }
      }
    },

    // Frame a bounds {min:[x,y,z], max:[x,y,z]}: project the 8 corners of the
    // bbox through the current view, fit the resulting screen-space bbox into
    // the canvas (centered both horizontally and vertically), so tall terrain
    // stays centered and never clips. Orientation + zoom are preserved.
    //
    // Implementation: compute the view-space coordinates of all 8 corners
    // (the projection is orthographic so x_view and y_view are linear in the
    // world point). Take the half-extent in EACH axis; pick the larger axis
    // (so a square canvas always contains the bbox) with a margin. This is
    // a generous bound that works for any window aspect — projMatrix() further
    // expands the shorter axis with the canvas aspect so nothing clips.
    reframe(bounds) { frameBoundsImpl(bounds); },
    frameBounds(bounds) { frameBoundsImpl(bounds); },
  };

  function frameBoundsImpl(bounds) {
      if (!bounds) return;
      const cx = (bounds.min[0] + bounds.max[0]) / 2;
      const cy = (bounds.min[1] + bounds.max[1]) / 2;
      const cz = (bounds.min[2] + bounds.max[2]) / 2;
      state.target = [cx, cy, cz];

      // Iso view basis vectors (computed inline so this stays mat4-free):
      // view-right  axis (screen x) and view-up axis (screen y), in world coords.
      // Forward (eye→target) = -(eyeDir), with eyeDir computed from elevation+azimuth.
      const el = ISO_ELEVATION;
      const az = azimuth();
      const ce = Math.cos(el), se = Math.sin(el);
      const ca = Math.cos(az), sa = Math.sin(az);
      // eye at target + EYE_DIST*(ce*ca, ce*sa, se); forward = -that, normalized.
      const fx = -ce * ca, fy = -ce * sa, fz = -se;
      // up world = [0,0,1]; right = forward × up (right-handed view basis).
      // We want screen-right (camera x) such that lookAt(eye→target,up=+z) → +x.
      // For lookAt right-handed: right = normalize(cross(up, forward * -1)),
      // but simpler: right = normalize(cross(world_up, eye-target)) = cross(up, -fwd).
      const rxv = 0 * -fz - 1 * -fy; // up × (-fwd) = (uy*-fz - uz*-fy, uz*-fx - ux*-fz, ux*-fy - uy*-fx)
      const ryv = 1 * -fx - 0 * -fz;
      const rzv = 0 * -fy - 0 * -fx;
      const rl = Math.hypot(rxv, ryv, rzv) || 1;
      const rrx = rxv / rl, rry = ryv / rl, rrz = rzv / rl;
      // view-up = forward × right (so screen Y points "up" in the iso frame)
      const uux = fy * rrz - fz * rry;
      const uuy = fz * rrx - fx * rrz;
      const uuz = fx * rry - fy * rrx;
      // (already unit because fwd and right are unit + orthogonal)

      // Project each of the 8 bbox corners into view-space (right, up) about
      // the target. Track the screen-space half-extents.
      let maxHx = 0, maxHy = 0;
      for (let i = 0; i < 8; i++) {
        const x = (i & 1) ? bounds.max[0] : bounds.min[0];
        const y = (i & 2) ? bounds.max[1] : bounds.min[1];
        const z = (i & 4) ? bounds.max[2] : bounds.min[2];
        const dx = x - cx, dy = y - cy, dz = z - cz;
        const sx = dx * rrx + dy * rry + dz * rrz; // view x
        const sy = dx * uux + dy * uuy + dz * uuz; // view y
        if (Math.abs(sx) > maxHx) maxHx = Math.abs(sx);
        if (Math.abs(sy) > maxHy) maxHy = Math.abs(sy);
      }
      // Use the larger axis as our framing extent so both fit a square canvas;
      // projMatrix() expands the shorter side by aspect to the actual canvas.
      // Add ~15% margin so we never clip and tall terrain still has breathing room.
      const extent = Math.max(maxHx, maxHy, 1e-3) * 1.18;
      state.halfExtent = extent;
      // Keep near/far roomy around the eye distance so depth clipping never bites.
      const radius = Math.max(maxHx, maxHy);
      state.far = Math.max(state.far, EYE_DIST + radius * 6);
  }
}
