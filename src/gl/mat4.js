// mat4.js — minimal column-major 4×4 matrix math for the WebGL 3D view.
// Pure, no DOM, Node-testable. Matrices are 16-element Float-ish arrays in
// COLUMN-MAJOR order (the layout WebGL's uniformMatrix4fv expects):
//
//   m = [ m0  m4  m8  m12     column-major index layout:
//         m1  m5  m9  m13       column c, row r  ->  m[c*4 + r]
//         m2  m6 m10  m14     ]
//         m3  m7 m11  m15
//
// A point transform is  m · [x y z 1]ᵀ  with the matrix on the left, so a
// composed transform T·R·S applied to a point is multiply(multiply(T,R),S).

export function identity() {
  return [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ];
}

// out = a · b  (column-major). Each output column j is a · (column j of b).
export function multiply(a, b) {
  const out = new Array(16);
  for (let c = 0; c < 4; c++) {
    const b0 = b[c * 4 + 0];
    const b1 = b[c * 4 + 1];
    const b2 = b[c * 4 + 2];
    const b3 = b[c * 4 + 3];
    for (let r = 0; r < 4; r++) {
      out[c * 4 + r] =
        a[0 * 4 + r] * b0 +
        a[1 * 4 + r] * b1 +
        a[2 * 4 + r] * b2 +
        a[3 * 4 + r] * b3;
    }
  }
  return out;
}

// Perspective projection (right-handed, clip-space z in [-1,1]).
// fovy in radians (vertical field of view). Matches gl-matrix / glm.
export function perspective(fovyRad, aspect, near, far) {
  const f = 1 / Math.tan(fovyRad / 2);
  const nf = 1 / (near - far);
  return [
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far + near) * nf, -1,
    0, 0, 2 * far * near * nf, 0,
  ];
}

// Orthographic projection (right-handed, clip-space z in [-1,1]). Parallel
// projection — the "isometric" look (no perspective foreshortening). Maps the
// box [left,right]×[bottom,top]×[-near,-far] (view space, camera looks down -z)
// onto the NDC cube [-1,1]³. Matches gl-matrix / glm `ortho`.
export function ortho(left, right, bottom, top, near, far) {
  const lr = 1 / (left - right);
  const bt = 1 / (bottom - top);
  const nf = 1 / (near - far);
  return [
    -2 * lr, 0, 0, 0,
    0, -2 * bt, 0, 0,
    0, 0, 2 * nf, 0,
    (left + right) * lr, (top + bottom) * bt, (far + near) * nf, 1,
  ];
}

// View matrix looking from `eye` toward `center` with `up`. Right-handed.
export function lookAt(eye, center, up) {
  const ex = eye[0], ey = eye[1], ez = eye[2];

  // z = normalize(eye - center)  (camera looks down -z)
  let zx = ex - center[0], zy = ey - center[1], zz = ez - center[2];
  let zl = Math.hypot(zx, zy, zz) || 1;
  zx /= zl; zy /= zl; zz /= zl;

  // x = normalize(up × z)
  let xx = up[1] * zz - up[2] * zy;
  let xy = up[2] * zx - up[0] * zz;
  let xz = up[0] * zy - up[1] * zx;
  let xl = Math.hypot(xx, xy, xz) || 1;
  xx /= xl; xy /= xl; xz /= xl;

  // y = z × x  (already orthonormal)
  const yx = zy * xz - zz * xy;
  const yy = zz * xx - zx * xz;
  const yz = zx * xy - zy * xx;

  return [
    xx, yx, zx, 0,
    xy, yy, zy, 0,
    xz, yz, zz, 0,
    -(xx * ex + xy * ey + xz * ez),
    -(yx * ex + yy * ey + yz * ez),
    -(zx * ex + zy * ey + zz * ez),
    1,
  ];
}

// m · translate(v)  — post-multiply by a translation (translate in m's local space).
export function translate(m, v) {
  const [x, y, z] = v;
  const out = m.slice();
  out[12] = m[0] * x + m[4] * y + m[8] * z + m[12];
  out[13] = m[1] * x + m[5] * y + m[9] * z + m[13];
  out[14] = m[2] * x + m[6] * y + m[10] * z + m[14];
  out[15] = m[3] * x + m[7] * y + m[11] * z + m[15];
  return out;
}

// m · scale(v)
export function scale(m, v) {
  const [x, y, z] = v;
  const out = m.slice();
  out[0] = m[0] * x; out[1] = m[1] * x; out[2] = m[2] * x; out[3] = m[3] * x;
  out[4] = m[4] * y; out[5] = m[5] * y; out[6] = m[6] * y; out[7] = m[7] * y;
  out[8] = m[8] * z; out[9] = m[9] * z; out[10] = m[10] * z; out[11] = m[11] * z;
  return out;
}

// m · rotateX(a)
export function rotateX(m, a) {
  const c = Math.cos(a), s = Math.sin(a);
  const out = m.slice();
  // affects columns 1 (y) and 2 (z)
  out[4] = m[4] * c + m[8] * s;
  out[5] = m[5] * c + m[9] * s;
  out[6] = m[6] * c + m[10] * s;
  out[7] = m[7] * c + m[11] * s;
  out[8] = m[8] * c - m[4] * s;
  out[9] = m[9] * c - m[5] * s;
  out[10] = m[10] * c - m[6] * s;
  out[11] = m[11] * c - m[7] * s;
  return out;
}

// m · rotateY(a)
export function rotateY(m, a) {
  const c = Math.cos(a), s = Math.sin(a);
  const out = m.slice();
  // affects columns 0 (x) and 2 (z)
  out[0] = m[0] * c - m[8] * s;
  out[1] = m[1] * c - m[9] * s;
  out[2] = m[2] * c - m[10] * s;
  out[3] = m[3] * c - m[11] * s;
  out[8] = m[0] * s + m[8] * c;
  out[9] = m[1] * s + m[9] * c;
  out[10] = m[2] * s + m[10] * c;
  out[11] = m[3] * s + m[11] * c;
  return out;
}

// Transform a point by m, applying the perspective divide. Returns [x,y,z].
export function transformPoint(m, [x, y, z]) {
  const px = m[0] * x + m[4] * y + m[8] * z + m[12];
  const py = m[1] * x + m[5] * y + m[9] * z + m[13];
  const pz = m[2] * x + m[6] * y + m[10] * z + m[14];
  let pw = m[3] * x + m[7] * y + m[11] * z + m[15];
  if (pw === 0) pw = 1;
  return [px / pw, py / pw, pz / pw];
}

// Full 4×4 inverse (Laplace expansion / cofactors). Returns null if singular.
export function invert(m) {
  const m00 = m[0], m01 = m[1], m02 = m[2], m03 = m[3];
  const m10 = m[4], m11 = m[5], m12 = m[6], m13 = m[7];
  const m20 = m[8], m21 = m[9], m22 = m[10], m23 = m[11];
  const m30 = m[12], m31 = m[13], m32 = m[14], m33 = m[15];

  const b00 = m00 * m11 - m01 * m10;
  const b01 = m00 * m12 - m02 * m10;
  const b02 = m00 * m13 - m03 * m10;
  const b03 = m01 * m12 - m02 * m11;
  const b04 = m01 * m13 - m03 * m11;
  const b05 = m02 * m13 - m03 * m12;
  const b06 = m20 * m31 - m21 * m30;
  const b07 = m20 * m32 - m22 * m30;
  const b08 = m20 * m33 - m23 * m30;
  const b09 = m21 * m32 - m22 * m31;
  const b10 = m21 * m33 - m23 * m31;
  const b11 = m22 * m33 - m23 * m32;

  let det =
    b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (!det) return null;
  det = 1.0 / det;

  return [
    (m11 * b11 - m12 * b10 + m13 * b09) * det,
    (m02 * b10 - m01 * b11 - m03 * b09) * det,
    (m31 * b05 - m32 * b04 + m33 * b03) * det,
    (m22 * b04 - m21 * b05 - m23 * b03) * det,
    (m12 * b08 - m10 * b11 - m13 * b07) * det,
    (m00 * b11 - m02 * b08 + m03 * b07) * det,
    (m32 * b02 - m30 * b05 - m33 * b01) * det,
    (m20 * b05 - m22 * b02 + m23 * b01) * det,
    (m10 * b10 - m11 * b08 + m13 * b06) * det,
    (m01 * b08 - m00 * b10 - m03 * b06) * det,
    (m30 * b04 - m31 * b02 + m33 * b00) * det,
    (m21 * b02 - m20 * b04 - m23 * b00) * det,
    (m11 * b07 - m10 * b09 - m12 * b06) * det,
    (m00 * b09 - m01 * b07 + m02 * b06) * det,
    (m31 * b01 - m30 * b03 - m32 * b00) * det,
    (m20 * b03 - m21 * b01 + m22 * b00) * det,
  ];
}
