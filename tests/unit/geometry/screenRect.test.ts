// The screen rectangle of a box (src/geometry/screenRect.ts): the composite runs the fan's
// 3 x 3 time-sample average only inside the fan's rectangle, so the rectangle must contain
// every pixel the box can cover, and fall back to the whole screen when it cannot be bounded.

import { describe, expect, it } from 'vitest';
import { Matrix4, PerspectiveCamera } from 'three';
import { screenRectOfBox, type Box3Like } from '../../../src/geometry/screenRect';

function camera(pos: [number, number, number], target: [number, number, number]) {
  const c = new PerspectiveCamera(30, 16 / 9, 0.05, 200);
  c.position.set(...pos);
  c.lookAt(...target);
  c.updateMatrixWorld();
  c.updateProjectionMatrix();
  return new Matrix4().multiplyMatrices(c.projectionMatrix, c.matrixWorldInverse).elements;
}

const FAN: Box3Like = { min: [-0.05, -0.8, -0.8], max: [0.3, 0.8, 0.8] };

/** uv (0..1, y down) of a world point, as the composite's screenUV. */
function uvOf(m: readonly number[], p: readonly [number, number, number]): [number, number] {
  const [x, y, z] = p;
  const cx = (m[0] ?? 0) * x + (m[4] ?? 0) * y + (m[8] ?? 0) * z + (m[12] ?? 0);
  const cy = (m[1] ?? 0) * x + (m[5] ?? 0) * y + (m[9] ?? 0) * z + (m[13] ?? 0);
  const cw = (m[3] ?? 0) * x + (m[7] ?? 0) * y + (m[11] ?? 0) * z + (m[15] ?? 0);
  return [(cx / cw) * 0.5 + 0.5, 0.5 - (cy / cw) * 0.5];
}

describe('screenRectOfBox', () => {
  it('contains every point of the box seen from the default view, with the margin', () => {
    const m = camera([-3.7, 0.75, 3.35], [0.7, -0.05, 0]);
    const r = screenRectOfBox(m, FAN, 0.01);
    expect(r.full).toBe(false);
    // a sweep over the box: every point lies inside the rectangle
    for (let i = 0; i <= 4; i++)
      for (let j = 0; j <= 4; j++)
        for (let k = 0; k <= 4; k++) {
          const p: [number, number, number] = [
            FAN.min[0] + ((FAN.max[0] - FAN.min[0]) * i) / 4,
            FAN.min[1] + ((FAN.max[1] - FAN.min[1]) * j) / 4,
            FAN.min[2] + ((FAN.max[2] - FAN.min[2]) * k) / 4,
          ];
          const [u, v] = uvOf(m, p);
          expect(u).toBeGreaterThanOrEqual(r.min[0]);
          expect(u).toBeLessThanOrEqual(r.max[0]);
          expect(v).toBeGreaterThanOrEqual(r.min[1]);
          expect(v).toBeLessThanOrEqual(r.max[1]);
        }
    // and it is a real saving: the fan box covers a fraction of the default frame
    const area = (r.max[0] - r.min[0]) * (r.max[1] - r.min[1]);
    expect(area).toBeGreaterThan(0.02);
    expect(area).toBeLessThan(0.4);
  });

  it('is clamped to the screen and pads by the margin', () => {
    const m = camera([-3.1, 0.45, 1.35], [0, -0.02, 0]);
    const tight = screenRectOfBox(m, FAN, 0);
    const padded = screenRectOfBox(m, FAN, 0.02);
    for (const r of [tight, padded]) {
      expect(r.min[0]).toBeGreaterThanOrEqual(0);
      expect(r.min[1]).toBeGreaterThanOrEqual(0);
      expect(r.max[0]).toBeLessThanOrEqual(1);
      expect(r.max[1]).toBeLessThanOrEqual(1);
    }
    expect(padded.min[0]).toBeLessThanOrEqual(tight.min[0]);
    expect(padded.max[1]).toBeGreaterThanOrEqual(tight.max[1]);
  });

  it('is the whole screen when a corner is at or behind the camera plane', () => {
    // the camera inside the box (an orbit into the intake)
    const m = camera([0.1, 0, 0], [1, 0, 0]);
    expect(screenRectOfBox(m, FAN, 0.01)).toEqual({ full: true, min: [0, 0], max: [1, 1] });
  });

  it('is empty (min > max) when the box is entirely off screen', () => {
    const m = camera([-3.7, 0.75, 3.35], [-3.7, 0.75, 13.35]);
    const r = screenRectOfBox(m, FAN, 0.01);
    // looking away: the box is behind the camera, which cannot be bounded either
    expect(r.full).toBe(true);
    const side = camera([0, 0, 6], [8, 0, 6]);
    const s = screenRectOfBox(side, FAN, 0.01);
    expect(s.full || s.min[0] > s.max[0] || s.min[1] > s.max[1]).toBe(true);
  });
});
