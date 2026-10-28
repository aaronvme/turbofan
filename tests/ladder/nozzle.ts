// The L4 nozzle (PHYSICS.md 3.3 CPU variants): R(x) = R_t sqrt(1 + k (x/L)^2), its mesh, a
// quasi-1D initial field, and the per-column averages the checks use.
import type { MultiBlockMesh } from '../../tools/mesh/types';
import { caloricallyPerfectGas } from '../../src/flow/reference/gas';
import { ReferenceSolver } from '../../src/flow/reference/solver';
import { NP } from '../../src/flow/reference/state';
import { BC, gridBlock, singleBlock, solverMesh } from '../unit/flow/helpers';
import { machFromArea, pOverP0, tOverT0 } from './theory';

export const GAMMA = 1.4;
export const RGAS = 287.05287;
export const RT = 0.1;
export const LN = 0.4;
export const K = 0.5;
export const NI = 120;
export const NJ = 12;
export const P0 = 2e5;
export const T0 = 300;

export const radius = (x: number): number => RT * Math.sqrt(1 + K * (x / LN) ** 2);
export const radiusSlope = (x: number): number =>
  (RT * K * x) / (LN * LN * Math.sqrt(1 + K * (x / LN) ** 2));
export const areaRatioAt = (x: number): number => 1 + K * (x / LN) ** 2;

export function nozzleMesh(ni = NI, nj = NJ): MultiBlockMesh {
  const b = gridBlock('nozzle', ni, nj, (i, j) => {
    const x = -LN + (2 * LN * i) / ni;
    return { x, r: j === 0 ? 0 : (radius(x) * j) / nj };
  });
  return singleBlock(b, { imin: BC.INFLOW, imax: BC.OUTFLOW, jmin: BC.AXIS, jmax: BC.SLIP_WALL });
}

/** Quasi-1D state at x: p0 and A* may change at a shock (p0Of, aStarOf). */
export function quasi1d(
  x: number,
  r: number,
  branch: (x: number) => { p0: number; aStar: number; supersonic: boolean },
) {
  const { p0, aStar, supersonic } = branch(x);
  const M = machFromArea(Math.max(1, areaRatioAt(x) / aStar), GAMMA, supersonic);
  const T = T0 * tOverT0(M, GAMMA);
  const p = p0 * pOverP0(M, GAMMA);
  const speed = M * Math.sqrt(GAMMA * RGAS * T);
  const slope = radiusSlope(x) * (r / radius(x));
  const u = speed / Math.sqrt(1 + slope * slope);
  return { rho: p / (RGAS * T), u, v: u * slope, w: 0, p, z: 0 };
}

export function nozzleSolver(
  outflowPressure: number,
  ni = NI,
  nj = NJ,
  storage: 'f64' | 'f32' = 'f64',
): ReferenceSolver {
  return new ReferenceSolver(solverMesh(nozzleMesh(ni, nj)), {
    gas: caloricallyPerfectGas(GAMMA, RGAS),
    freeStream: { pressure: 1e5, temperature: T0, velocity: 0 },
    inflowTotal: { p0: P0, t0: T0 },
    outflowPressure,
    storage,
  });
}

/** Per cell column: x (volume-weighted), mass-averaged Mach, area-averaged pressure. */
export function columns(s: ReferenceSolver): { x: number; mach: number; p: number }[] {
  const P = s.primitives();
  const m = s.mesh;
  const out: { x: number; mach: number; p: number }[] = [];
  const blk = m.blocks[0];
  const ni = blk?.ni ?? NI;
  const nj = blk?.nj ?? NJ;
  for (let i = 0; i < ni; i++) {
    let wv = 0;
    let wx = 0;
    let wm = 0;
    let wmM = 0;
    let wp = 0;
    for (let j = 0; j < nj; j++) {
      const c = j * ni + i;
      const vol = m.cellVolR[c] ?? NaN;
      const rho = s.ref.rho + (P[NP * c] ?? NaN);
      const u = P[NP * c + 1] ?? NaN;
      const v = P[NP * c + 2] ?? NaN;
      const mach = Math.hypot(u, v) / (P[NP * c + 7] ?? NaN);
      wv += vol;
      wx += vol * (m.cellX[c] ?? NaN);
      wm += vol * rho * u;
      wmM += vol * rho * u * mach;
      wp += vol * (s.ref.p + (P[NP * c + 4] ?? NaN));
    }
    out.push({ x: wx / wv, mach: wmM / wm, p: wp / wv });
  }
  return out;
}
