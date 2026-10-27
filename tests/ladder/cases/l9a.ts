// L9 (a) (PHYSICS.md 3.3, full size): Euler work of a ducted "rotor" disk through the volume
// source interface: an angular-momentum source s_L = rho r F (a tangential force density) with the
// energy source Omega s_L. Mass-averaged Delta h0 against Omega Delta(r u_theta) between x = -0.1 m
// and x = +0.1 m (constant cp, so Delta T0 cp = Delta h0).
import { THRESHOLDS } from '../../../src/contracts/thresholds';
import { caloricallyPerfectGas } from '../../../src/flow/reference/gas';
import { ReferenceSolver } from '../../../src/flow/reference/solver';
import type { SourceModel } from '../../../src/flow/reference/sources';
import { NP } from '../../../src/flow/reference/state';
import { BC, rectangle, singleBlock, solverMesh } from '../../unit/flow/helpers';
import { converge } from '../common';
import { pOverP0, tOverT0 } from '../theory';

const GAMMA = 1.4;
const RGAS = 287.05287;
const OMEGA = 300;
const F_THETA = 3e4;

export function run() {
  const L9 = THRESHOLDS.L9.values;
  const ni = 60;
  const nj = 4;
  const mesh = solverMesh(
    singleBlock(rectangle('duct', -0.3, 0.3, 0.5, 0.6, ni, nj), {
      imin: BC.INFLOW,
      imax: BC.OUTFLOW,
      jmin: BC.SLIP_WALL,
      jmax: BC.SLIP_WALL,
    }),
  );
  const disk = Array.from({ length: mesh.nCells }, (_, c) => c).filter(
    (c) => Math.abs(mesh.cellX[c] ?? NaN) < 0.05,
  );
  const rotor: SourceModel = (ctx, out) => {
    for (const c of disk) {
      const rho = ctx.ref.rho + (ctx.prim[NP * c] ?? NaN);
      const sL = rho * (mesh.cellR[c] ?? NaN) * F_THETA;
      out.rate[6 * c + 3] = sL;
      out.rate[6 * c + 4] = OMEGA * sL;
    }
  };
  const s = new ReferenceSolver(mesh, {
    gas: caloricallyPerfectGas(GAMMA, RGAS),
    freeStream: { pressure: 1e5, temperature: 288.15, velocity: 0 },
    inflowTotal: { p0: 1e5, t0: 288.15 },
    outflowPressure: 0.95e5,
    sources: rotor,
  });
  // start from the isentropic duct flow at the outflow pressure
  let M = 0.3;
  for (let k = 0; k < 60; k++)
    M -= (pOverP0(M, GAMMA) - 0.95) / ((pOverP0(M + 1e-7, GAMMA) - pOverP0(M, GAMMA)) / 1e-7);
  const T = 288.15 * tOverT0(M, GAMMA);
  s.setUniform({
    rho: 0.95e5 / (RGAS * T),
    u: M * Math.sqrt(GAMMA * RGAS * T),
    v: 0,
    w: 0,
    p: 0.95e5,
    z: 0,
  });
  const conv = converge(s, 1e-6, 20000);
  const plane = (i: number) => {
    let m = 0;
    let h = 0;
    let L = 0;
    for (let j = 0; j < nj; j++) {
      const F = s.faceFlux(0, 'i', i, j);
      m += F[0] ?? NaN;
      L += F[3] ?? NaN;
      h += F[4] ?? NaN;
    }
    return { m, h0: h / m, rw: L / m };
  };
  const up = plane(20); // x = -0.1 m
  const down = plane(40); // x = +0.1 m
  const dh0 = down.h0 - up.h0;
  const euler = OMEGA * (down.rw - up.rw);
  const err = Math.abs(dh0 - euler) / Math.abs(euler);
  return {
    id: 'L9a',
    rows: [
      {
        id: 'L9',
        metric: 'Euler work: |Delta T0 - Omega Delta(r u_theta)/cp| relative',
        threshold: `< ${L9.maxEulerWorkRelativeError.value}`,
        value: err,
        pass: err < L9.maxEulerWorkRelativeError.value,
      },
      {
        id: 'L9',
        metric: 'Euler-work case: iterations to converge to 1e-6',
        threshold: '<= 20000',
        value: conv.iterations,
        pass: conv.converged,
      },
    ],
    extra: { conv, up, down, dT0: dh0 / ((GAMMA * RGAS) / (GAMMA - 1)) },
  };
}
