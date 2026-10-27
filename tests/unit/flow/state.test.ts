// Conserved gauge state <-> primitives (docs/SOLVER.md section 4).
import { describe, expect, it } from 'vitest';
import {
  THERMALLY_PERFECT,
  caloricallyPerfectGas,
  referenceState,
} from '../../../src/flow/reference/gas';
import { NP, NU, consToPrim, physicalToPrim, primToCons } from '../../../src/flow/reference/state';
import { STOICH_FAR } from '../../../src/thermo/gas';

const ambient = referenceState(THERMALLY_PERFECT, {
  pressure: 101325,
  temperature: 288.15,
  velocity: 0,
});
const flight = referenceState(THERMALLY_PERFECT, {
  pressure: 2.4e4,
  temperature: 220,
  velocity: 230,
});

describe('gauge state', () => {
  it('has 6 conserved and 8 primitive slots', () => {
    expect(NU).toBe(6);
    expect(NP).toBe(8);
  });

  it.each([
    [
      'ambient, hot swirling fuel-air',
      ambient,
      { rho: 0.45, u: 310, v: -42, w: 120, p: 2.3e5, z: 0.024 },
    ],
    ['ambient, cold', ambient, { rho: 1.6, u: -20, v: 5, w: -3, p: 1.2e5, z: 0 }],
    ['flight, stoichiometric', flight, { rho: 0.2, u: 500, v: 10, w: 0, p: 5e4, z: STOICH_FAR }],
  ] as const)('round-trips primitives -> conserved -> primitives (%s)', (_, ref, phys) => {
    const rc = 0.37;
    const q = physicalToPrim(ref, phys, rc);
    const U = new Float64Array(NU);
    primToCons(ref, q, 0, rc, U, 0);
    const back = new Float64Array(NP);
    consToPrim(ref, U, 0, rc, back, 0);
    for (let k = 0; k < NP; k++) {
      const scale = Math.max(1, Math.abs(q[k] ?? 0));
      expect(Math.abs((back[k] ?? NaN) - (q[k] ?? NaN)) / scale).toBeLessThan(1e-9);
    }
    expect(ref.rho + (q[0] ?? 0)).toBeCloseTo(phys.rho, 12);
    expect(q[3]).toBeCloseTo(phys.w * rc, 12);
    expect(ref.p + (q[4] ?? 0)).toBeCloseTo(phys.p, 6);
  });

  it('the ambient at rest is exact zeros, both ways', () => {
    const q = physicalToPrim(
      ambient,
      { rho: ambient.rho, u: 0, v: 0, w: 0, p: ambient.p, z: 0 },
      1,
    );
    for (let k = 0; k < 7; k++) expect(q[k] === 0).toBe(true);
    const U = new Float64Array(NU);
    primToCons(ambient, q, 0, 1, U, 0);
    for (let k = 0; k < NU; k++) expect(U[k] === 0).toBe(true);
    const back = new Float64Array(NP);
    consToPrim(ambient, new Float64Array(NU), 0, 1, back, 0);
    for (let k = 0; k < 7; k++) expect(back[k] === 0).toBe(true);
    expect(back[7]).toBeCloseTo(ambient.c, 12);
  });

  it('the moving free stream has eta = 0 and rho prime = 0 exactly', () => {
    const q = physicalToPrim(
      flight,
      { rho: flight.rho, u: flight.u, v: 0, w: 0, p: flight.p, z: 0 },
      2,
    );
    const U = new Float64Array(NU);
    primToCons(flight, q, 0, 2, U, 0);
    expect(U[0] === 0).toBe(true);
    expect(U[4] === 0).toBe(true);
    expect(U[1]).toBe(flight.rho * flight.u);
  });

  it('calorically perfect: p = (gamma - 1) rho e', () => {
    const gas = caloricallyPerfectGas(1.4, 287.05287);
    const ref = referenceState(gas, { pressure: 1e5, temperature: 300, velocity: 0 });
    const q = physicalToPrim(ref, { rho: 0.125, u: 0, v: 0, w: 0, p: 1e4, z: 0 }, 1);
    const U = new Float64Array(NU);
    primToCons(ref, q, 0, 1, U, 0);
    // eta = rho E - rho h0inf + pinf with E = p / (rho (gamma - 1)) + const datum
    const e = 1e4 / (0.125 * 0.4) - (287.05287 / 0.4) * 300 + ref.h - ref.r * ref.t;
    expect(U[4]).toBeCloseTo(0.125 * e - 0.125 * ref.h0 + ref.p, 6);
  });
});
