// state.js — corner-state: one boolean per PRIMARY vertex (filled / empty).
// Pure logic, NO DOM (Node-testable). Default all empty. Reset on regenerate by
// creating a fresh state sized to the new mesh's vertex count.
//
// Only interior vertices (those with a dual cell) are meaningfully paintable,
// but storing per-vertex is simplest and keeps indices aligned with the mesh.

export function createState(vertexCount) {
  const filled = new Array(vertexCount).fill(false);

  return {
    get(i) {
      return i >= 0 && i < filled.length ? filled[i] : false;
    },
    set(i, v) {
      if (i >= 0 && i < filled.length) filled[i] = !!v;
    },
    toggle(i) {
      if (i >= 0 && i < filled.length) filled[i] = !filled[i];
      return this.get(i);
    },
    clear() {
      filled.fill(false);
    },
    get size() {
      return filled.length;
    },
  };
}
