// Ladder L6 (PHYSICS.md 3.3): free vortex and solid-body rotation in an annulus: radial
// equilibrium and angular-momentum drift.
import { describe, expect, it } from 'vitest';
import { THRESHOLDS } from '../../src/contracts/thresholds';
import { caloricallyPerfectGas } from '../../src/flow/reference/gas';
import { ReferenceSolver } from '../../src/flow/reference/solver';
import { NP } from '../../src/flow/reference/state';
import { BC, rectangle, singleBlock, solverMesh } from '../unit/flow/helpers';
import { report } from './common';

const L6 = THRESHOLDS.L6.values;
const GAMMA = 1.4;
const RGAS = 287.05287;
const CP = (GAMMA * RGAS) / (GAMMA - 1);
const NI = 4;
const NJ = 64;

const cases = {
  'free vortex': (r: number) => {
    const w = 75 / r;
    const T = 300 - (w * w) / (2 * CP);
    const p = 1e5 * (T / 300) ** (GAMMA / (GAMMA - 1));
    return { rho: p / (RGAS * T), u: 0, v: 0, w, p, z: 0 };
  },
  'solid body': (r: number) => {
    const w = 150 * r;
    const p = 1e5 * Math.exp((150 * 150 * (r * r - 0.25)) / (2 * RGAS * 300));
    return { rho: p / (RGAS * 300), u: 0, v: 0, w, p, z: 0 };
  },
};

describe('L6: swirl in an annulus', () => {
  it.each(Object.entries(cases))('%s: radial equilibrium and angular momentum', (name, profile) => {
    const mesh = solverMesh(
      singleBlock(rectangle('annulus', 0, 0.05, 0.5, 1.0, NI, NJ), {
        imin: BC.SLIP_WALL,
        imax: BC.SLIP_WALL,
        jmin: BC.SLIP_WALL,
        jmax: BC.SLIP_WALL,
      }),
    );
    const s = new ReferenceSolver(mesh, {
      gas: caloricallyPerfectGas(GAMMA, RGAS),
      freeStream: { pressure: 1e5, temperature: 300, velocity: 0 },
    });
    s.setState((_, r) => profile(r));
    const rw0 = Float64Array.from(s.primitives().subarray(0, NP * mesh.nCells)).filter(
      (_, k) => k % NP === 3,
    );
    s.iterate(1000);
    const P = s.primitives();
    // one column (i = 1): p, rho, w at the cell centres
    let q = 0;
    let worst = 0;
    let integral = 0;
    let prev: { r: number; f: number; p: number } | undefined;
    let p0 = NaN;
    for (let j = 0; j < NJ; j++) {
      const c = j * NI + 1;
      const r = mesh.cellR[c] ?? NaN;
      const rho = s.ref.rho + (P[NP * c] ?? NaN);
      const w = (P[NP * c + 3] ?? NaN) / r;
      const p = s.ref.p + (P[NP * c + 4] ?? NaN);
      const f = (rho * w * w) / r;
      q = Math.max(q, 0.5 * rho * w * w);
      if (prev === undefined) p0 = p;
      else {
        integral += 0.5 * (f + prev.f) * (r - prev.r);
        worst = Math.max(worst, Math.abs(p - p0 - integral));
      }
      prev = { r, f, p };
    }
    const eq = worst / q;
    let drift = 0;
    let scale = 0;
    for (let c = 0; c < mesh.nCells; c++) {
      drift = Math.max(drift, Math.abs((P[NP * c + 3] ?? NaN) - (rw0[c] ?? NaN)));
      scale = Math.max(scale, Math.abs(rw0[c] ?? NaN));
    }
    const am = drift / scale;
    report(`L6-${name.replace(' ', '-')}`, [
      {
        id: 'L6',
        metric: `${name}: radial-equilibrium error / q`,
        threshold: `< ${L6.maxRadialEquilibriumErrorFractionOfQ.value}`,
        value: eq,
        pass: eq < L6.maxRadialEquilibriumErrorFractionOfQ.value,
      },
      {
        id: 'L6',
        metric: `${name}: angular-momentum drift`,
        threshold: `< ${L6.maxAngularMomentumDrift.value}`,
        value: am,
        pass: am < L6.maxAngularMomentumDrift.value,
      },
    ]);
    expect(eq).toBeLessThan(L6.maxRadialEquilibriumErrorFractionOfQ.value);
    expect(am).toBeLessThan(L6.maxAngularMomentumDrift.value);
  });
});
