// D4-63 (SOLVER.md 10, "The rest state on the engine mesh"): the engine's default scheme on the
// shipped 130k asset (f32 metrics), started at rest from tests/gpu/engine-stability.test.ts's 0.1 %
// pressure wave. GpuFlowSolver's defaults: thermally perfect gas, ISA SLS at rest, preconditioned
// tracking at minMach = M_cut = 0.003, the preconditioned CFL 0.8. Checkpoints every 100.
// D4-72: the rule's pressure bound is on the volume-weighted L2 of p' (the acoustic energy's norm: a
// converging cylindrical wave grows pointwise towards the axis, about 1 / sqrt(r), while its energy
// decays); max |p'| is reported. D4-77: the rule's residual is the density residual in the same
// volume-weighted norm (the standard convergence monitor); the cell mean of (R / V)^2, which the
// near-axis cells dominate, is reported beside it. D4-79: rule (b) judges decay in the limit (D4-70's
// "non-growing"): each case runs to 20000 iterations, and the weighted residual at 20000 must be at
// most its value at 10000 and at most its value at 100. Rule (a) keeps D4-45's 1000-2000 window and
// is also checked at 20000. D4-79 applies the rule to each D4-63 case: this file's contract case
// (amplitude 1e-3, isothermal) and the linear part (cases/d463lin.ts: 1e-6, isentropic, round 10's).
import { ISA_SLS } from '../../../src/contracts/ambient';
import { THERMALLY_PERFECT } from '../../../src/flow/reference/gas';
import { ReferenceSolver } from '../../../src/flow/reference/solver';
import { solverMeshFromFile } from '../../../src/flow/reference/solverMesh';
import { NP } from '../../../src/flow/reference/state';
import { engineAsset } from '../engine';

/** The wave's relative amplitude (the soak's 0.1 %). */
export const D463_AMPLITUDE = 1e-3;
/** D4-79: each case runs to 20000 iterations. */
export const D463_ITERATIONS = 20000;
const EVERY = 100;
/** Rule (a)'s window: iterations 1000..2000 (D4-45; the focusing transient comes before it). */
const LATE = 1000;
const LATE_END = 2000;
/** D4-79: rule (b) compares the weighted residual at the end with its value here and at 100. */
const MID = 10000;
/** The rule's bound on the volume-weighted L2 of p' over its first (D4-72). */
export const D463_LATE_PRESSURE_BOUND = 2;
/** The signature (the passing companion): finite, and max |p'| below this many times its first. */
export const D463_SIGNATURE_BOUND = 100;

export interface D463Case {
  /** The result's id (reports/ladder/<id>.json). */
  readonly id: string;
  /** The wave's relative amplitude. */
  readonly amplitude: number;
  /**
   * 'isothermal': rho = p / (R T) at the free-stream temperature (the contract, engine-stability's
   * start). 'isentropic': rho' = p' / c^2 (round 10's linear part; no entropy in the start).
   */
  readonly start: 'isothermal' | 'isentropic';
}

export const D463_CONTRACT: D463Case = {
  id: 'D4-63-rest',
  amplitude: D463_AMPLITUDE,
  start: 'isothermal',
};

/** The checkpoint value at iteration `it` (a multiple of EVERY); NaN past a break. */
const at = (series: readonly number[], it: number): number => series[it / EVERY - 1] ?? NaN;

export async function runD463(k: D463Case) {
  const { file } = await engineAsset();
  const mesh = solverMeshFromFile(file);
  const s = new ReferenceSolver(mesh, {
    gas: THERMALLY_PERFECT,
    freeStream: { pressure: ISA_SLS.pressurePa, temperature: ISA_SLS.temperatureK, velocity: 0 },
    lowMachPreconditioning: { minMach: 0.003 },
  });
  let x0 = Infinity;
  let x1 = -Infinity;
  let r1 = 0;
  for (let c = 0; c < mesh.nCells; c++) {
    x0 = Math.min(x0, mesh.cellX[c] as number);
    x1 = Math.max(x1, mesh.cellX[c] as number);
    r1 = Math.max(r1, mesh.cellR[c] as number);
  }
  const { p, t, r, rho: rho0, c: c0 } = s.ref;
  s.setState((x, rc) => {
    const xn = (x - x0) / (x1 - x0);
    const dp = p * k.amplitude * Math.cos(6 * Math.PI * xn) * Math.exp(-((rc / r1 / 0.3) ** 2));
    const rho = k.start === 'isothermal' ? (p + dp) / (r * t) : rho0 + dp / (c0 * c0);
    return { rho, u: 0, v: 0, w: 0, p: p + dp, z: 0 };
  });
  // max |p'| and the volume-weighted L2 sqrt(sum_c V_c p'_c^2) (V per radian; blockage 1 here)
  const norms = (): { max: number; l2: number } => {
    const P = s.primitives();
    let m = 0;
    let e = 0;
    for (let c = 0; c < mesh.nCells; c++) {
      const q = P[NP * c + 4] as number;
      m = Number.isNaN(q) ? NaN : Math.max(m, Math.abs(q));
      e += (mesh.cellVolR[c] as number) * q * q;
    }
    return { max: m, l2: Math.sqrt(e) };
  };
  const first = norms();
  const pressure: number[] = [];
  const energy: number[] = [];
  const residual: number[] = []; // volume-weighted (D4-77), the rule's
  const residualMean: number[] = []; // the cell mean (SOLVER.md 11), reported
  for (let done = EVERY; done <= D463_ITERATIONS; done += EVERY) {
    s.iterate(EVERY);
    const now = norms();
    pressure.push(now.max / first.max);
    energy.push(now.l2 / first.l2);
    residual.push(s.stats.residualDensityL2Volume);
    residualMean.push(s.stats.residualDensityL2);
    if (!Number.isFinite(pressure[pressure.length - 1])) break;
  }
  const finite =
    pressure.length === D463_ITERATIONS / EVERY &&
    pressure.every(Number.isFinite) &&
    energy.every(Number.isFinite) &&
    residual.every(Number.isFinite);
  const window = (series: readonly number[], from: number, to: number): number =>
    Math.max(...series.slice(from / EVERY - 1, to / EVERY));
  const peak = Math.max(...pressure);
  const lateEnergy = window(energy, LATE, LATE_END);
  const endEnergy = at(energy, D463_ITERATIONS);
  const res100 = at(residual, EVERY);
  const resMid = at(residual, MID);
  const resEnd = at(residual, D463_ITERATIONS);
  const reported = 'reported' as const;
  return {
    id: k.id,
    rows: [
      {
        id: 'D4-63',
        metric: `signature: finite to ${D463_ITERATIONS}, peak max |p'| / first`,
        threshold: `< ${D463_SIGNATURE_BOUND}`,
        value: peak,
        pass: finite && peak < D463_SIGNATURE_BOUND,
      },
      {
        id: 'D4-63',
        metric: "rule (a, D4-72): volume-weighted L2 of p' / first, max over 1000-2000",
        threshold: `<= ${D463_LATE_PRESSURE_BOUND}`,
        value: lateEnergy,
        pass: finite && lateEnergy <= D463_LATE_PRESSURE_BOUND,
      },
      {
        id: 'D4-63',
        metric: `rule (a, D4-79): volume-weighted L2 of p' / first at ${D463_ITERATIONS}`,
        threshold: `<= ${D463_LATE_PRESSURE_BOUND}`,
        value: endEnergy,
        pass: finite && endEnergy <= D463_LATE_PRESSURE_BOUND,
      },
      {
        id: 'D4-63',
        metric: `rule (b, D4-79): volume-weighted residual at ${D463_ITERATIONS} / at ${MID}`,
        threshold: '<= 1',
        value: resEnd / resMid,
        pass: finite && resEnd <= resMid,
      },
      {
        id: 'D4-63',
        metric: `rule (b, D4-79): volume-weighted residual at ${D463_ITERATIONS} / at ${EVERY}`,
        threshold: '<= 1',
        value: resEnd / res100,
        pass: finite && resEnd <= res100,
      },
      {
        id: 'D4-63',
        metric: `reported: volume-weighted L2 of p' / first, max over 1000-${D463_ITERATIONS}`,
        threshold: 'reported',
        value: window(energy, LATE, D463_ITERATIONS),
        pass: reported,
      },
      {
        id: 'D4-63',
        metric: "reported (D4-77's window): volume-weighted residual, max over 1000-2000 / at 100",
        threshold: 'reported',
        value: window(residual, LATE, LATE_END) / res100,
        pass: reported,
      },
      {
        id: 'D4-63',
        metric: "reported (round 9's measure): max |p'| / first, max over 1000-2000",
        threshold: 'reported',
        value: window(pressure, LATE, LATE_END),
        pass: reported,
      },
      {
        id: 'D4-63',
        metric: `reported: max |p'| / first at ${D463_ITERATIONS}`,
        threshold: 'reported',
        value: at(pressure, D463_ITERATIONS),
        pass: reported,
      },
      {
        id: 'D4-63',
        metric: `reported (SOLVER.md 11): cell-mean residual at ${D463_ITERATIONS} / at ${EVERY}`,
        threshold: 'reported',
        value: at(residualMean, D463_ITERATIONS) / at(residualMean, EVERY),
        pass: reported,
      },
    ],
    extra: { amplitude: k.amplitude, start: k.start, pressure, energy, residual, residualMean },
  };
}

/** The contract case (the ladder's, tests/ladder/d463.test.ts). */
export function run() {
  return runD463(D463_CONTRACT);
}
