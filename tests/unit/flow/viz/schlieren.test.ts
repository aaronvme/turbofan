// Schlieren and heat haze (w2/flowviz round 2): the line-of-sight deflection of a ray through
// the axisymmetric field, eps = (1/n) integral grad_perp(n) ds with n - 1 = K rho
// (Gladstone-Dale; Merzkirch, Flow Visualization, 2nd ed., 1987, ch. 3; Settles, Schlieren and
// Shadowgraph Techniques, 2001, eq. 2.4), checked against the closed form for a Gaussian
// density column, plus the knife-edge image and the haze's apparent shift.
import { describe, expect, it } from 'vitest';
import {
  HAZE_MIN_SHIFT_PX,
  hazeShiftPx,
  knifeEdgeIntensity,
  rayCylinderSpan,
  rayDeflection,
  type DensityGradient,
} from '../../../../src/flow/viz/schlieren';

const K = 2.26e-4;
/** rho'(r) = A exp(-r^2 / s^2), uniform in x. */
const A = 0.5;
const S = 0.3;
const gaussian: DensityGradient = (_x, r) => ({
  gx: 0,
  gr: ((-2 * r) / (S * S)) * A * Math.exp(-(r * r) / (S * S)),
});

/** The closed form: eps_y(b) = K d/db integral rho dz = -2 K A sqrt(pi) (b / s) exp(-b^2/s^2). */
const exact = (b: number) =>
  (-2 * K * A * Math.sqrt(Math.PI) * b * Math.exp(-(b * b) / (S * S))) / S;

const basis = { right: [1, 0, 0], up: [0, 1, 0] } as const;

describe('rayDeflection (axisymmetric line-of-sight integral)', () => {
  it.each([0.1, 0.2, 0.3, 0.45])(
    'matches the Gaussian column closed form at impact parameter %s m (rays bend toward dense gas)',
    (b) => {
      const d = rayDeflection(
        {
          origin: [0.5, b, -3],
          dir: [0, 0, 1],
          ...basis,
          xMin: -1,
          xMax: 2,
          rMax: 1.5,
          steps: 96,
        },
        gaussian,
        K,
      );
      expect(d.ex).toBeCloseTo(0, 12);
      expect(Math.abs(d.ey - exact(b))).toBeLessThan(2e-3 * Math.abs(exact(0.3)));
      expect(Math.sign(d.ey)).toBe(-1);
    },
  );

  it('converges at second order in the step count', () => {
    const run = (steps: number) =>
      rayDeflection(
        { origin: [0.5, 0.2, -3], dir: [0, 0, 1], ...basis, xMin: -1, xMax: 2, rMax: 1.5, steps },
        gaussian,
        K,
      ).ey - exact(0.2);
    const e1 = Math.abs(run(12));
    const e2 = Math.abs(run(24));
    expect(e1 / e2).toBeGreaterThan(3);
  });

  it('sees nothing on a ray that misses the field', () => {
    const d = rayDeflection(
      { origin: [0.5, 2, -3], dir: [0, 0, 1], ...basis, xMin: -1, xMax: 2, rMax: 1.5, steps: 32 },
      gaussian,
      K,
    );
    expect(d).toEqual({ ex: 0, ey: 0, centroidM: 0 });
  });

  it("puts the centroid of the deflection where the ray crosses the column (the haze's depth)", () => {
    const d = rayDeflection(
      { origin: [0.5, 0.2, -3], dir: [0, 0, 1], ...basis, xMin: -1, xMax: 2, rMax: 1.5, steps: 96 },
      gaussian,
      K,
    );
    expect(d.centroidM).toBeCloseTo(3, 2);
  });

  it('stops at an opaque surface (tMax): no deflection from gas behind it', () => {
    const d = rayDeflection(
      {
        origin: [0.5, 0.2, -3],
        dir: [0, 0, 1],
        ...basis,
        xMin: -1,
        xMax: 2,
        rMax: 1.5,
        steps: 96,
        tMax: 3,
      },
      gaussian,
      K,
    );
    // the integrand is even in z about the axis crossing (t = 3): half of it remains
    expect(d.ey / exact(0.2)).toBeCloseTo(0.5, 2);
  });
});

describe('rayCylinderSpan', () => {
  it('clips the ray to r <= R and the x slab', () => {
    const s = rayCylinderSpan([0, 0, -3], [0, 0, 1], -1, 1, 1);
    expect(s?.[0]).toBeCloseTo(2, 12);
    expect(s?.[1]).toBeCloseTo(4, 12);
    expect(rayCylinderSpan([0, 2, -3], [0, 0, 1], -1, 1, 1)).toBeNull();
    // along the axis: the slab clips it
    const a = rayCylinderSpan([-3, 0, 0], [1, 0, 0], -1, 1, 1);
    expect(a?.[0]).toBeCloseTo(2, 12);
    expect(a?.[1]).toBeCloseTo(4, 12);
  });
});

describe('knife-edge schlieren image (Settles 2001, eq. 3.5: I/I0 = 1 + eps f / a, 50 % cut-off)', () => {
  it('is mid grey without deflection and saturates at +-a/f', () => {
    expect(knifeEdgeIntensity(0, 1e-4)).toBe(0.5);
    expect(knifeEdgeIntensity(1e-4, 1e-4)).toBe(1);
    expect(knifeEdgeIntensity(-1e-4, 1e-4)).toBe(0);
    expect(knifeEdgeIntensity(5e-5, 1e-4)).toBeCloseTo(0.75, 12);
    expect(knifeEdgeIntensity(-1, 1e-4)).toBe(0);
  });
});

describe('heat-haze shift of the background', () => {
  it('is eps (z_bg - z_gas) / z_bg seen from the camera, in pixels', () => {
    const fov = (30 * Math.PI) / 180;
    const h = 1080;
    const radPerPx = (2 * Math.tan(fov / 2)) / h;
    expect(hazeShiftPx(1e-3, 4, 12, fov, h)).toBeCloseTo((1e-3 * (12 - 4)) / 12 / radPerPx, 9);
    // a background in front of the gas is not displaced by it
    expect(hazeShiftPx(1e-3, 4, 3, fov, h)).toBe(0);
    expect(HAZE_MIN_SHIFT_PX).toBeGreaterThan(0);
  });
});
