// L6 (PHYSICS.md 3.3, full size): free vortex and solid-body rotation in a closed annulus:
// radial equilibrium and angular-momentum drift after 1000 tracking iterations.
import { THRESHOLDS } from '../../../src/contracts/thresholds';
import { caloricallyPerfectGas } from '../../../src/flow/reference/gas';
import { ReferenceSolver } from '../../../src/flow/reference/solver';
import { NP, type PhysicalState } from '../../../src/flow/reference/state';
import { BC, rectangle, singleBlock, solverMesh } from '../../unit/flow/helpers';
import type { LadderRow } from '../common';

const GAMMA = 1.4;
const RGAS = 287.05287;
const CP = (GAMMA * RGAS) / (GAMMA - 1);
const NI = 4;
const NJ = 64;

const CASES: Readonly<Record<string, (r: number) => PhysicalState>> = {
  'free vortex': (r) => {
    const w = 75 / r;
    const T = 300 - (w * w) / (2 * CP);
    const p = 1e5 * (T / 300) ** (GAMMA / (GAMMA - 1));
    return { rho: p / (RGAS * T), u: 0, v: 0, w, p, z: 0 };
  },
  'solid body': (r) => {
    const w = 150 * r;
    const p = 1e5 * Math.exp((150 * 150 * (r * r - 0.25)) / (2 * RGAS * 300));
    return { rho: p / (RGAS * 300), u: 0, v: 0, w, p, z: 0 };
  },
};

export function run() {
  const L6 = THRESHOLDS.L6.values;
  const rows: LadderRow[] = [];
  for (const [name, profile] of Object.entries(CASES)) {
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
    const P0 = s.primitives();
    const rw0 = Float64Array.from({ length: mesh.nCells }, (_, c) => P0[NP * c + 3] ?? NaN);
    s.iterate(1000);
    const P = s.primitives();
    // one column (i = 1): the pressure rise against the integral of rho w^2 / r (trapezoid)
    let q = 0;
    let worst = 0;
    let integral = 0;
    let prevR = NaN;
    let prevF = NaN;
    let p0 = NaN;
    for (let j = 0; j < NJ; j++) {
      const c = j * NI + 1;
      const r = mesh.cellR[c] ?? NaN;
      const rho = s.ref.rho + (P[NP * c] ?? NaN);
      const w = (P[NP * c + 3] ?? NaN) / r;
      const p = s.ref.p + (P[NP * c + 4] ?? NaN);
      const f = (rho * w * w) / r;
      q = Math.max(q, 0.5 * rho * w * w);
      if (j === 0) p0 = p;
      else {
        integral += 0.5 * (f + prevF) * (r - prevR);
        worst = Math.max(worst, Math.abs(p - p0 - integral));
      }
      prevR = r;
      prevF = f;
    }
    const eq = worst / q;
    let drift = 0;
    let scale = 0;
    for (let c = 0; c < mesh.nCells; c++) {
      drift = Math.max(drift, Math.abs((P[NP * c + 3] ?? NaN) - (rw0[c] ?? NaN)));
      scale = Math.max(scale, Math.abs(rw0[c] ?? NaN));
    }
    const am = drift / scale;
    rows.push(
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
    );
  }
  return { id: 'L6', rows };
}
