// mat4.test.mjs — column-major 4×4 matrix math.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  identity, multiply, perspective, lookAt, translate, scale,
  rotateX, rotateY, transformPoint, invert,
} from '../src/gl/mat4.js';

const EPS = 1e-9;
const approx = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

function assertMatApprox(got, want, eps = 1e-6) {
  assert.equal(got.length, 16);
  for (let i = 0; i < 16; i++) {
    assert.ok(approx(got[i], want[i], eps), `idx ${i}: got ${got[i]} want ${want[i]}`);
  }
}

test('identity is the 4x4 identity', () => {
  assertMatApprox(identity(), [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]);
});

test('identity · M = M and M · identity = M', () => {
  const M = [
    2, 3, 5, 7,
    11, 13, 17, 19,
    23, 29, 31, 37,
    41, 43, 47, 53,
  ];
  assertMatApprox(multiply(identity(), M), M, EPS);
  assertMatApprox(multiply(M, identity()), M, EPS);
});

test('multiply matches a hand-computed product', () => {
  // A = translate by (1,2,3) ; B = scale by (2,2,2). A·B scales then translates.
  const A = translate(identity(), [1, 2, 3]);
  const B = scale(identity(), [2, 2, 2]);
  const AB = multiply(A, B);
  // Apply to point (1,1,1): scale -> (2,2,2), translate -> (3,4,5)
  assert.deepEqual(transformPoint(AB, [1, 1, 1]).map((v) => Math.round(v)), [3, 4, 5]);
});

test('perspective matches the known reference matrix', () => {
  // fovy=90° (PI/2), aspect=1, near=1, far=3.  f = 1/tan(45°) = 1.
  // m[0]=f/aspect=1, m[5]=f=1, m[10]=(far+near)/(near-far)=4/-2=-2,
  // m[11]=-1, m[14]=2*far*near/(near-far)=6/-2=-3, rest 0.
  const P = perspective(Math.PI / 2, 1, 1, 3);
  const want = [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, -2, -1,
    0, 0, -3, 0,
  ];
  assertMatApprox(P, want);
});

test('lookAt matches a known reference (eye on +z looking at origin)', () => {
  // eye=(0,0,5), center=origin, up=+y. Camera looks down -z (world == view axes).
  // z = (eye-center)/|..| = (0,0,1); x = up×z = (1,0,0); y = z×x = (0,1,0).
  // Translation = -(R·eye) = (0,0,-5).
  const V = lookAt([0, 0, 5], [0, 0, 0], [0, 1, 0]);
  const want = [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, -5, 1,
  ];
  assertMatApprox(V, want);
});

test('lookAt places eye at the origin in view space', () => {
  const eye = [3, 4, 5];
  const V = lookAt(eye, [0, 0, 0], [0, 1, 0]);
  const eyeInView = transformPoint(V, eye);
  assert.ok(approx(eyeInView[0], 0) && approx(eyeInView[1], 0) && approx(eyeInView[2], 0),
    `eye should map to origin, got ${eyeInView}`);
});

test('translate / scale / rotate transformPoint', () => {
  const T = translate(identity(), [10, 0, 0]);
  assert.deepEqual(transformPoint(T, [1, 2, 3]), [11, 2, 3]);

  const S = scale(identity(), [2, 3, 4]);
  assert.deepEqual(transformPoint(S, [1, 1, 1]), [2, 3, 4]);

  // rotateY by 90°: +x -> -z (right-handed).
  const RY = rotateY(identity(), Math.PI / 2);
  const ry = transformPoint(RY, [1, 0, 0]);
  assert.ok(approx(ry[0], 0) && approx(ry[1], 0) && approx(ry[2], -1), `got ${ry}`);

  // rotateX by 90°: +y -> +z.
  const RX = rotateX(identity(), Math.PI / 2);
  const rx = transformPoint(RX, [0, 1, 0]);
  assert.ok(approx(rx[0], 0) && approx(rx[1], 0) && approx(rx[2], 1), `got ${rx}`);
});

test('invert: M · M⁻¹ ≈ I', () => {
  const M = multiply(
    translate(identity(), [3, -2, 5]),
    multiply(rotateY(identity(), 0.7), scale(identity(), [2, 1.5, 0.5]))
  );
  const Mi = invert(M);
  assert.ok(Mi, 'matrix should be invertible');
  assertMatApprox(multiply(M, Mi), identity(), 1e-6);
  assertMatApprox(multiply(Mi, M), identity(), 1e-6);
});

test('invert of a perspective·view round-trips a point (unproject)', () => {
  const proj = perspective(Math.PI / 3, 1.5, 0.1, 100);
  const view = lookAt([2, 3, 6], [0, 0, 0], [0, 1, 0]);
  const VP = multiply(proj, view);
  const inv = invert(VP);
  assert.ok(inv);
  const world = [0.4, -0.7, 1.1];
  const clip = transformPoint(VP, world);
  const back = transformPoint(inv, clip);
  assert.ok(
    approx(back[0], world[0], 1e-4) && approx(back[1], world[1], 1e-4) && approx(back[2], world[2], 1e-4),
    `round-trip failed: ${back} vs ${world}`
  );
});

test('invert returns null for a singular matrix', () => {
  const singular = scale(identity(), [1, 1, 0]); // collapses z
  assert.equal(invert(singular), null);
});
