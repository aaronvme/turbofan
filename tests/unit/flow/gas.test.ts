// The solver's gas model (docs/SOLVER.md section 3): the divided-difference ("gauge") forms must
// equal src/thermo's enthalpy and entropy, invert exactly in 3 Newton steps, and give exact zeros in
// the ambient (the property the f32 kernel relies on).
import { describe, expect, it } from 'vitest';
import {
  STOICH_FAR,
  cp as thermoCp,
  enthalpy,
  entropyFunction,
  gasConstant,
  productsMassFraction,
} from '../../../src/thermo/gas';
import {
  THERMALLY_PERFECT,
  caloricallyPerfectGas,
  cpMix,
  deltaE,
  deltaH,
  enthalpyDelta,
  entropyDelta,
  gasConstantMix,
  pressureGauge,
  productsFraction,
  referenceState,
  soundSpeed,
  temperatureFromPressure,
  temperatureGauge,
} from '../../../src/flow/reference/gas';

const ref = referenceState(THERMALLY_PERFECT, {
  pressure: 101325,
  temperature: 288.15,
  velocity: 0,
});
const FARS = [0, 0.01, 0.025, STOICH_FAR];

const isZero = (x: number): boolean => x === 0;

describe('gas model: mixture', () => {
  it('products fraction and gas constant are src/thermo’s, clamped to [0, f_st]', () => {
    for (const far of FARS) {
      expect(productsFraction(THERMALLY_PERFECT, far)).toBeCloseTo(productsMassFraction(far), 14);
      expect(
        gasConstantMix(THERMALLY_PERFECT, productsFraction(THERMALLY_PERFECT, far)),
      ).toBeCloseTo(gasConstant(far), 10);
    }
    expect(productsFraction(THERMALLY_PERFECT, -0.01)).toBe(0);
    expect(productsFraction(THERMALLY_PERFECT, 0.5)).toBeCloseTo(1, 14);
  });

  it('cp is src/thermo’s, on both polynomial ranges', () => {
    for (const far of FARS) {
      const phi = productsFraction(THERMALLY_PERFECT, far);
      for (const t of [220, 288.15, 999, 1000, 1500, 2200]) {
        expect(cpMix(THERMALLY_PERFECT, t, phi) / thermoCp(t, far) - 1).toBeLessThan(1e-12);
      }
    }
  });
});

describe('gas model: divided differences', () => {
  const pairs: [number, number][] = [
    [288.15, 0],
    [288.15, 1e-3],
    [288.15, -60],
    [288.15, 500],
    [288.15, 1600], // crosses the 1000 K break
    [1200, -400], // crosses it downwards
    [1500, 300],
    [900, 99.999],
  ];

  it.each(pairs)('h(T0 + tau) - h(T0) at T0 = %d, tau = %d equals src/thermo', (t0, tau) => {
    for (const far of FARS) {
      const phi = productsFraction(THERMALLY_PERFECT, far);
      const exact = enthalpy(t0 + tau, far) - enthalpy(t0, far);
      const got = enthalpyDelta(THERMALLY_PERFECT, t0, tau, phi);
      expect(Math.abs(got - exact)).toBeLessThanOrEqual(1e-9 * Math.max(1, Math.abs(exact)));
    }
  });

  it.each(pairs)(
    'phi_s(T0 + tau) - phi_s(T0) at T0 = %d, tau = %d equals src/thermo',
    (t0, tau) => {
      for (const far of FARS) {
        const phi = productsFraction(THERMALLY_PERFECT, far);
        const exact = entropyFunction(t0 + tau, far) - entropyFunction(t0, far);
        const got = entropyDelta(THERMALLY_PERFECT, t0, tau, phi);
        expect(Math.abs(got - exact)).toBeLessThanOrEqual(1e-9 * Math.max(1, Math.abs(exact)));
      }
    },
  );

  it('a zero step is an exact zero (no cancellation)', () => {
    expect(isZero(enthalpyDelta(THERMALLY_PERFECT, 288.15, 0, 0))).toBe(true);
    expect(isZero(entropyDelta(THERMALLY_PERFECT, 288.15, 0, 0))).toBe(true);
  });
});

describe('gas model: gauge equation of state about the ambient', () => {
  it('delta h and delta e are measured from the ambient air', () => {
    for (const far of FARS) {
      const phi = productsFraction(THERMALLY_PERFECT, far);
      for (const t of [230, 288.15, 700, 1400, 2000]) {
        const dh = enthalpy(t, far) - enthalpy(ref.t, 0);
        expect(Math.abs(deltaH(ref, t - ref.t, phi) - dh)).toBeLessThan(
          1e-9 * Math.max(1, Math.abs(dh)),
        );
        const de = dh - gasConstant(far) * t + ref.r * ref.t;
        expect(Math.abs(deltaE(ref, t - ref.t, phi) - de)).toBeLessThan(
          1e-9 * Math.max(1, Math.abs(de)),
        );
      }
    }
  });

  it('3 Newton steps invert delta e to below 1e-6 K from 200 to 2200 K', () => {
    for (const far of FARS) {
      const phi = productsFraction(THERMALLY_PERFECT, far);
      for (let t = 200; t <= 2200; t += 50) {
        const tP = temperatureGauge(ref, deltaE(ref, t - ref.t, phi), phi);
        expect(Math.abs(tP - (t - ref.t))).toBeLessThan(1e-6);
      }
    }
  });

  it('pressure and temperature gauges invert each other', () => {
    for (const far of FARS) {
      const phi = productsFraction(THERMALLY_PERFECT, far);
      for (const [rhoP, tP] of [
        [0.3, 400],
        [-0.5, -50],
        [2.1, 1300],
      ] as const) {
        const pP = pressureGauge(ref, rhoP, tP, phi);
        const rho = ref.rho + rhoP;
        const R = gasConstantMix(THERMALLY_PERFECT, phi);
        expect(pP + ref.p).toBeCloseTo(rho * R * (ref.t + tP), 6);
        expect(temperatureFromPressure(ref, rhoP, pP, phi)).toBeCloseTo(tP, 9);
      }
    }
  });

  it('the ambient gives exact zeros everywhere', () => {
    expect(isZero(deltaH(ref, 0, 0))).toBe(true);
    expect(isZero(deltaE(ref, 0, 0))).toBe(true);
    expect(isZero(temperatureGauge(ref, 0, 0))).toBe(true);
    expect(isZero(temperatureFromPressure(ref, 0, 0, 0))).toBe(true);
    expect(isZero(pressureGauge(ref, 0, 0, 0))).toBe(true);
  });

  it('speed of sound is sqrt(gamma R T)', () => {
    const t = 900;
    const g = thermoCp(t, 0) / (thermoCp(t, 0) - gasConstant(0));
    expect(soundSpeed(THERMALLY_PERFECT, t, 0)).toBeCloseTo(Math.sqrt(g * gasConstant(0) * t), 9);
    expect(ref.c).toBeCloseTo(soundSpeed(THERMALLY_PERFECT, ref.t, 0), 12);
  });
});

describe('gas model: calorically perfect table (verification cases)', () => {
  const gas = caloricallyPerfectGas(1.4, 287.05287);
  const cref = referenceState(gas, { pressure: 1e5, temperature: 300, velocity: 50 });

  it('has constant cp = gamma R / (gamma - 1) for any composition', () => {
    for (const t of [50, 300, 1000, 3000]) {
      expect(cpMix(gas, t, 0)).toBeCloseTo((1.4 * 287.05287) / 0.4, 9);
      expect(cpMix(gas, t, 1)).toBeCloseTo((1.4 * 287.05287) / 0.4, 9);
    }
    expect(cref.gamma).toBeCloseTo(1.4, 13);
    expect(cref.c).toBeCloseTo(Math.sqrt(1.4 * 287.05287 * 300), 10);
    expect(cref.h0 - cref.h).toBeCloseTo(0.5 * 50 * 50, 9);
  });

  it('inverts the energy exactly (linear), even far below 200 K', () => {
    const cv = 287.05287 / 0.4;
    for (const t of [60, 150, 300, 2500]) {
      expect(temperatureGauge(cref, cv * (t - 300), 0)).toBeCloseTo(t - 300, 9);
    }
  });
});
