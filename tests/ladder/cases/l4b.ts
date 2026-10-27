// L4 (b) (PHYSICS.md 3.3, full size): normal shock in the diverging section at the back pressure
// quasi-1D theory gives for a shock at x = 0.2 m.
import { THRESHOLDS } from '../../../src/contracts/thresholds';
import { converge } from '../common';
import { GAMMA, LN, P0, areaRatioAt, columns, nozzleSolver, quasi1d } from '../nozzle';
import { machFromArea, normalShock, pOverP0 } from '../theory';

const XS = 0.2;

/** The L4b set-up on ni x nj cells: converged state, shock position and its error / length. */
export function shockCase(ni: number, nj: number, maxIterations: number) {
  const M1 = machFromArea(areaRatioAt(XS), GAMMA, true);
  const shock = normalShock(M1, GAMMA);
  const aStar2 = 1 / shock.p02p01;
  const Me = machFromArea(areaRatioAt(LN) / aStar2, GAMMA, false);
  const pExit = P0 * shock.p02p01 * pOverP0(Me, GAMMA);
  const s = nozzleSolver(pExit, ni, nj);
  s.setState((x, r) =>
    quasi1d(x, r, (xx) =>
      xx < XS
        ? { p0: P0, aStar: 1, supersonic: xx > 0 }
        : { p0: P0 * shock.p02p01, aStar: aStar2, supersonic: false },
    ),
  );
  // D4-19: the last STEADY_WINDOW iterations of the run sample the shock position every 100
  const conv = converge(s, 1e-5, maxIterations - STEADY_WINDOW);
  const p1 = P0 * pOverP0(M1, GAMMA);
  const mid = 0.5 * (p1 + p1 * shock.p2p1);
  const samples: number[] = [];
  for (let k = 0; k < STEADY_WINDOW / 100; k++) {
    s.iterate(100);
    samples.push(shockPosition(s, mid));
  }
  const xs = samples[samples.length - 1] ?? NaN;
  const frac = Math.abs(xs - XS) / (2 * LN);
  // max - min of the sampled position over the nozzle length (D4-19: <= 0.1 %)
  const drift = (Math.max(...samples) - Math.min(...samples)) / (2 * LN);
  return { conv, xs, frac, pExit, drift, samples, residualEnd: s.stats.residualDensityL2 };
}

/** D4-19's steadiness window: the last 2000 iterations of the run (PHYSICS.md 3.3). */
export const STEADY_WINDOW = 2000;

/** Where the column-averaged pressure first crosses `mid` in the diverging section. */
function shockPosition(s: ReturnType<typeof nozzleSolver>, mid: number): number {
  const cols = columns(s);
  for (let i = 1; i < cols.length; i++) {
    const a = cols[i - 1];
    const b = cols[i];
    if (a === undefined || b === undefined || a.x <= 0) continue;
    if (a.p < mid && b.p >= mid) return a.x + ((mid - a.p) / (b.p - a.p)) * (b.x - a.x);
  }
  return NaN;
}

/**
 * The case's resolution, from the D4-9 grid study (l4bgrid.ts, PHYSICS.md 3.3): the error is 2.38 %
 * at 120 x 12, 1.64 % at 170 x 17 and 1.19 % at 240 x 24 (observed order 1.46, Richardson limit
 * 0.51 %), so it converges below 2 % and the case runs at the first resolution that meets it.
 */
export const SHOCK_GRID = { ni: 170, nj: 17, maxIterations: 17000 } as const;

/** D4-19: 0.1 % of the nozzle length (PHYSICS.md 3.3). */
const STEADY_TOLERANCE = 1e-3;

export function run() {
  const L4 = THRESHOLDS.L4.values;
  const { conv, xs, frac, pExit, drift, residualEnd } = shockCase(
    SHOCK_GRID.ni,
    SHOCK_GRID.nj,
    SHOCK_GRID.maxIterations,
  );
  return {
    id: 'L4b',
    rows: [
      {
        id: 'L4',
        metric: 'normal-shock position error / nozzle length (170 x 17)',
        threshold: `< ${L4.maxShockPositionFractionOfLength.value}`,
        value: frac,
        pass: frac < L4.maxShockPositionFractionOfLength.value && drift <= STEADY_TOLERANCE,
      },
      {
        id: 'L4',
        metric: `D4-19 steadiness: shock position max - min over the last ${STEADY_WINDOW} iterations / length`,
        threshold: `<= ${STEADY_TOLERANCE}`,
        value: drift,
        pass: drift <= STEADY_TOLERANCE,
      },
      {
        id: 'L4',
        metric: `shock case (170 x 17): iterations to 1e-5 (converged: ${String(conv.converged)}; open, D4-19/D4-21)`,
        threshold: 'reported',
        value: conv.iterations,
        pass: 'reported' as const,
      },
      {
        id: 'L4',
        metric: 'shock case (170 x 17): final residual / first',
        threshold: 'reported',
        value: residualEnd / conv.first,
        pass: 'reported' as const,
      },
    ],
    extra: { conv, xs, pExit, drift },
  };
}
