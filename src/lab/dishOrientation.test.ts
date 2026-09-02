import assert from 'node:assert/strict';
import test from 'node:test';

import { compactAngleDelta, rotationFromBearingDrag } from './dishOrientation.ts';

const close = (actual: number, expected: number): void => {
  assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} != ${expected}`);
};

test('bearing drag follows the shortest angle across the turn boundary', () => {
  const nearPositivePi = Math.PI - 0.05;
  const nearNegativePi = -Math.PI + 0.08;
  close(compactAngleDelta(nearPositivePi, nearNegativePi), 0.13);
  close(compactAngleDelta(nearNegativePi, nearPositivePi), -0.13);
});

test('dragging the visible bearing clockwise rotates the camera oppositely', () => {
  close(rotationFromBearingDrag(0.4, -Math.PI / 2, 0), 0.4 - Math.PI / 2);
  close(rotationFromBearingDrag(-0.2, Math.PI - 0.1, -Math.PI + 0.1), -0.4);
});
