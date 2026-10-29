// D4-63 (SOLVER.md 10, "The rest state on the engine mesh"): the engine's default scheme on the
// shipped 130k asset (f32 metrics), started at rest from tests/gpu/engine-stability.test.ts's 0.1 %
// pressure wave. GpuFlowSolver's defaults: thermally perfect gas, ISA SLS at rest, preconditioned
// tracking at minMach = M_cut = 0.003, the preconditioned CFL 0.8. The rule's window is D4-45's
// 2000 iterations (W2R-N16); checkpoints every 100. D4-72: the rule's pressure bound is on the
// volume-weighted L2 of p' (the acoustic energy's norm: a converging cylindrical wave grows
// pointwise towards the axis, about 1 / sqrt(r), while its energy decays); max |p'| is reported.
// D4-77: the rule's residual is the density residual in the same volume-weighted norm (the
// standard convergence monitor); the cell mean of (R / V)^2, which the near-axis cells dominate,
// is reported beside it.
import { ISA_SLS } from '../../../src/contracts/ambient';
import { THERMALLY_PERFECT } from '../../../src/flow/reference/gas';
import { ReferenceSolver } from '../../../src/flow/reference/solver';
import { solverMeshFromFile } from '../../../src/flow/reference/solverMesh';
import { NP } from '../../../src/flow/reference/state';
import { engineAsset } from '../engine';

/** The wave's relative amplitude (the soak's 0.1 %). */
export const D463_AMPLITUDE = 1e-3;
export const D463_ITERATIONS = 2000;
const EVERY = 100;
/** The rule's late window: iterations 1000..2000 (the focusing transient comes before it). */
const LATE = 1000;
/** The rule's bound on the volume-weighted L2 of p' over the late window, over its first (D4-72). */
export const D463_LATE_PRESSURE_BOUND = 2;
/** The signature (the passing companion): finite, and max |p'| below this many times its first. */
export const D463_SIGNATURE_BOUND = 100;

export async function run() {
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
  const { p, t, r } = s.ref;
  s.setState((x, rc) => {
    const xn = (x - x0) / (x1 - x0);
    const pc =
      p * (1 + D463_AMPLITUDE * Math.cos(6 * Math.PI * xn) * Math.exp(-((rc / r1 / 0.3) ** 2)));
    return { rho: pc / (r * t), u: 0, v: 0, w: 0, p: pc, z: 0 };
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
    energy.every(Number.isFinite);
  const peak = Math.max(...pressure);
  const latePeak = Math.max(...pressure.slice(LATE / EVERY - 1));
  const lateEnergy = Math.max(...energy.slice(LATE / EVERY - 1));
  const res100 = residual[0] as number;
  const lateRes = Math.max(...residual.slice(LATE / EVERY - 1));
  const lateResMean =
    Math.max(...residualMean.slice(LATE / EVERY - 1)) / (residualMean[0] as number);
  return {
    id: 'D4-63-rest',
    rows: [
      {
        id: 'D4-63',
        metric: "signature: finite to 2000, peak max |p'| / first",
        threshold: `< ${D463_SIGNATURE_BOUND}`,
        value: peak,
        pass: finite && peak < D463_SIGNATURE_BOUND,
      },
      {
        id: 'D4-63',
        metric: "rule (a, D4-72): volume-weighted L2 of p' / first over iterations 1000-2000",
        threshold: `<= ${D463_LATE_PRESSURE_BOUND}`,
        value: lateEnergy,
        pass: finite && lateEnergy <= D463_LATE_PRESSURE_BOUND,
      },
      {
        id: 'D4-63',
        metric: 'rule (b, D4-77): volume-weighted residual, max over 1000-2000 / at 100',
        threshold: '<= 1',
        value: lateRes / res100,
        pass: finite && lateRes <= res100,
      },
      {
        id: 'D4-63',
        metric: "reported (round 9's measure): max |p'| / first over iterations 1000-2000",
        threshold: 'reported',
        value: latePeak,
        pass: 'reported' as const,
      },
      {
        id: 'D4-63',
        metric: "reported (round 9's residual): cell-mean residual, max over 1000-2000 / at 100",
        threshold: 'reported',
        value: lateResMean,
        pass: 'reported' as const,
      },
    ],
    extra: { pressure, energy, residual, residualMean },
  };
}
