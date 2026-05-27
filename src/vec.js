// vec.js — tiny 2D vector helpers on plain [x, y] arrays. No deps (replaces numjs).
export const add   = (a, b) => [a[0] + b[0], a[1] + b[1]];
export const sub   = (a, b) => [a[0] - b[0], a[1] - b[1]];
export const scale = (a, s) => [a[0] * s, a[1] * s];
export const mean  = (ps) => {
  let x = 0, y = 0;
  for (const p of ps) { x += p[0]; y += p[1]; }
  return [x / ps.length, y / ps.length];
};
export const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
export const dot   = (a, b) => a[0] * b[0] + a[1] * b[1];
export const len   = (a) => Math.hypot(a[0], a[1]);
export const dist  = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
export const lerp  = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
