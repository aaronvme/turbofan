// L9 (b) (PHYSICS.md 3.3, full size): Rankine-Froude momentum theory for a uniformly loaded open
// actuator disk (radius 0.5 m, C_T = 0.5, axial force only, energy source u . f) in a M 0.1 free
// stream: the disk-averaged axial velocity against u_inf (1 + a), C_T = 4 a (1 + a).
import { THRESHOLDS } from '../../../src/contracts/thresholds';
import { caloricallyPerfectGas } from '../../../src/flow/reference/gas';
import { ReferenceSolver } from '../../../src/flow/reference/solver';
import type { SourceModel } from '../../../src/flow/reference/sources';
import { NP } from '../../../src/flow/reference/state';
import { BC, gridBlock, singleBlock, solverMesh } from '../../unit/flow/helpers';
import { STEADY_WINDOW, converge, graded, scaledCap, steadyWindow } from '../common';

const GAMMA = 1.4;
const RGAS = 287.05287;
const RD = 0.5;
const CT = 0.5;
const H = 0.04;

export function run() {
  const L9 = THRESHOLDS.L9.values;
  // x: uniform 0.04 m over [-0.4, 0.4] (the disk is the two cells |x| < 0.04), graded to -6 and 10 m
  const core = Array.from({ length: 21 }, (_, k) => -0.4 + H * k);
  const up = graded(-0.4, -6, H, 20).reverse();
  const down = graded(0.4, 10, H, 40);
  const xs = [...up.slice(0, -1), ...core, ...down.slice(1)];
  // r: uniform 0.05 m to 0.75 m (the disk edge r = 0.5 m is a grid line), graded to 6 m
  const rCore = Array.from({ length: 16 }, (_, k) => 0.05 * k);
  const rs = [...rCore, ...graded(0.75, 6, 0.05, 25).slice(1)];
  const ni = xs.length - 1;
  const nj = rs.length - 1;
  const mesh = solverMesh(
    singleBlock(
      gridBlock('disk', ni, nj, (i, j) => ({ x: xs[i] ?? NaN, r: rs[j] ?? NaN })),
      { imin: BC.INFLOW, imax: BC.OUTFLOW, jmin: BC.AXIS, jmax: BC.FARFIELD },
    ),
  );
  const probe = new ReferenceSolver(mesh, {
    gas: caloricallyPerfectGas(GAMMA, RGAS),
    freeStream: { pressure: 1e5, temperature: 288.15, velocity: 0 },
  });
  const u = 0.1 * probe.ref.c;
  const dP = CT * 0.5 * probe.ref.rho * u * u;
  const thickness = 2 * H;
  const diskCells = Array.from({ length: mesh.nCells }, (_, c) => c).filter(
    (c) => Math.abs(mesh.cellX[c] ?? NaN) < H && (mesh.cellR[c] ?? NaN) < RD,
  );
  const force: SourceModel = (ctx, out) => {
    for (const c of diskCells) {
      const f = dP / thickness;
      out.rate[6 * c + 1] = f;
      out.rate[6 * c + 4] = f * (ctx.prim[NP * c + 1] ?? NaN);
    }
  };
  const s = new ReferenceSolver(mesh, {
    gas: caloricallyPerfectGas(GAMMA, RGAS),
    freeStream: { pressure: 1e5, temperature: 288.15, velocity: u },
    sources: force,
  });
  s.setUniform({ rho: s.ref.rho, u, v: 0, w: 0, p: 1e5, z: 0 });
  // D4-45: the cap scales as 1.5 / CFL (plain tracking at the default 1.5 keeps 20000)
  const cap = scaledCap(20000, s.trackingCfl);
  const conv = converge(s, 1e-5, cap, 'peak');
  const a = (-1 + Math.sqrt(1 + CT)) / 2;
  const measure = () => {
    const P = s.primitives();
    let vol = 0;
    let ux = 0;
    for (const c of diskCells) {
      const v = mesh.cellVolR[c] ?? NaN;
      vol += v;
      ux += v * (P[NP * c + 1] ?? NaN);
    }
    const uDisk = ux / vol;
    return { uDisk, err: Math.abs(uDisk / (u * (1 + a)) - 1) };
  };
  // D4-45: the row is read at the end of a 2000-iteration steadiness window
  const steady = steadyWindow(s, () => measure().err);
  const { uDisk, err } = measure();
  const tol = L9.maxMomentumTheoryRelativeError.value;
  return {
    id: 'L9b',
    rows: [
      {
        id: 'L9',
        metric: 'actuator disk: disk velocity vs momentum theory u_inf (1 + a)',
        threshold: `< ${tol}, and steady (next row)`,
        value: err,
        pass: err < tol && steady.spread <= tol / 10,
      },
      {
        id: 'L9',
        metric: `D4-45 steadiness: momentum-theory error max - min over the last ${STEADY_WINDOW} iterations`,
        threshold: `<= ${tol / 10}`,
        value: steady.spread,
        pass: steady.spread <= tol / 10,
      },
      {
        id: 'L9',
        metric: 'actuator-disk case: iterations to converge to 1e-5 (cap 20000 x 1.5 / CFL, D4-45)',
        threshold: `<= ${cap}`,
        value: conv.iterations,
        pass: conv.converged,
      },
    ],
    extra: {
      conv,
      cap,
      steady,
      uDisk,
      uInf: u,
      a,
      cells: mesh.nCells,
      diskCells: diskCells.length,
    },
  };
}
