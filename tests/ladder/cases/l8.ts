// L8 (PHYSICS.md 3.3, full size): a static point sink in ambient air at rest, through the volume
// source interface (docs/SOLVER.md section 8): a point-implicit sink s = -k U removing gas at its
// local h0 in the cells within 0.1 m of the origin; |u| against mdot / (4 pi r^2 rho) at 0.2-1 m.
import { THRESHOLDS } from '../../../src/contracts/thresholds';
import { THERMALLY_PERFECT } from '../../../src/flow/reference/gas';
import { ReferenceSolver } from '../../../src/flow/reference/solver';
import { massSourceRates, type SourceModel } from '../../../src/flow/reference/sources';
import { NP } from '../../../src/flow/reference/state';
import { BC, polarMesh, solverMesh } from '../../unit/flow/helpers';
import { converge, geometricGrowth } from '../common';

const R_IN = 0.05;
const R_OUT = 2;
const NR = 64;
const NT = 24;
const K = 225;

/** minMach = M_cut of the preconditioned tracking mode (D4-20): the engine's value, SOLVER.md 7. */
const MACH_CUT = Number(process.env.L8_MACH_CUT ?? 0.003);

function sinkRun(precondition: boolean, machCut = MACH_CUT) {
  const g = geometricGrowth((R_IN * Math.PI) / NT, R_OUT - R_IN, NR);
  const mesh = solverMesh(polarMesh(R_IN, R_OUT, NR, NT, g, BC.SLIP_WALL, BC.FARFIELD));
  const radius = (c: number) => Math.hypot(mesh.cellX[c] ?? NaN, mesh.cellR[c] ?? NaN);
  const sinkCells = Array.from({ length: mesh.nCells }, (_, c) => c).filter((c) => radius(c) < 0.1);
  const sink: SourceModel = (ctx, out) => {
    for (const c of sinkCells) {
      const rho = ctx.ref.rho + (ctx.prim[NP * c] ?? NaN);
      massSourceRates(ctx.ref, ctx.prim, NP * c, mesh.cellR[c] ?? NaN, -K * rho, out.rate, 6 * c);
      for (let m = 0; m < 6; m++) out.damping[6 * c + m] = K;
    }
  };
  const s = new ReferenceSolver(mesh, {
    gas: THERMALLY_PERFECT,
    freeStream: { pressure: 101325, temperature: 288.15, velocity: 0 },
    sources: sink,
    ...(precondition ? { lowMachPreconditioning: { minMach: machCut, machCut } } : {}),
  });
  const conv = converge(s, 1e-5, 20000);
  const P = s.primitives();
  let mdot = 0;
  for (const c of sinkCells)
    mdot += 2 * Math.PI * K * (s.ref.rho + (P[NP * c] ?? NaN)) * (mesh.cellVolR[c] ?? NaN);
  let worst = 0;
  let count = 0;
  for (let c = 0; c < mesh.nCells; c++) {
    const r = radius(c);
    if (r < 0.2 || r > 1.0) continue;
    const rho = s.ref.rho + (P[NP * c] ?? NaN);
    const speed = Math.hypot(P[NP * c + 1] ?? NaN, P[NP * c + 2] ?? NaN);
    worst = Math.max(worst, Math.abs(speed / (mdot / (4 * Math.PI * r * r * rho)) - 1));
    count++;
  }
  return { conv, mdot, worst, count, g };
}

export function run() {
  const L8 = THRESHOLDS.L8.values;
  const { conv, mdot, worst, count, g } = sinkRun(true);
  const plain = sinkRun(false);
  return {
    id: 'L8',
    rows: [
      {
        id: 'L8',
        metric: 'max | |u| / (mdot / (4 pi r^2 rho)) - 1 |, 0.2-1 m',
        threshold: `< ${L8.maxVelocityRelativeError.value}`,
        value: worst,
        pass: worst < L8.maxVelocityRelativeError.value && count > 0,
      },
      {
        id: 'L8',
        metric: 'iterations to converge to 1e-5',
        threshold: '<= 20000',
        value: conv.iterations,
        pass: conv.converged,
      },
      {
        id: 'L8',
        metric: `plain tracking (no preconditioning, unscaled SLAU2): max velocity error (converged: ${String(plain.conv.converged)})`,
        threshold: 'reported',
        value: plain.worst,
        pass: 'reported' as const,
      },
    ],
    extra: { conv, mdot, cells: count, growth: g, machCut: MACH_CUT, plain },
  };
}
