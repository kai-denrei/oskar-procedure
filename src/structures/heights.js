// heights.js — per-primary-vertex height field (integer floor count).
// Pure logic, NO DOM (Node-testable). Default all 0 (ground). Heights are
// non-negative integers clamped at 0 — a vertex at height h means its column
// rises h floors. A painted Grid cell maps to height ≥ 1 (see main.js seeding).
//
//   createHeights(vertexCount) -> {
//     get(v):number, set(v,h), raise(v,by=1), lower(v,by=1),
//     max():number, clear(), forEach(cb)
//   }

export function createHeights(vertexCount) {
  const h = new Array(Math.max(0, vertexCount | 0)).fill(0);

  // Coerce to a non-negative integer.
  const norm = (v) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) && n > 0 ? n : 0;
  };

  return {
    get(v) {
      return v >= 0 && v < h.length ? h[v] : 0;
    },
    set(v, height) {
      if (v >= 0 && v < h.length) h[v] = norm(height);
    },
    raise(v, by = 1) {
      if (v >= 0 && v < h.length) h[v] = norm(h[v] + by);
      return this.get(v);
    },
    lower(v, by = 1) {
      if (v >= 0 && v < h.length) h[v] = norm(h[v] - by);
      return this.get(v);
    },
    max() {
      let m = 0;
      for (let i = 0; i < h.length; i++) if (h[i] > m) m = h[i];
      return m;
    },
    clear() {
      h.fill(0);
    },
    forEach(cb) {
      for (let i = 0; i < h.length; i++) cb(h[i], i);
    },
    get size() {
      return h.length;
    },
  };
}
