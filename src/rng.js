// rng.js — mulberry32: a small, fast, seedable PRNG.
// Returns a function () -> float in [0, 1). Same seed => same sequence (determinism).
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Convenience: a fresh seed from Date.now() when no determinism is wanted.
export const randomSeed = () => (Date.now() ^ (Math.random() * 0x100000000)) >>> 0;
