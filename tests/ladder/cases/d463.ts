// D4-63 (SOLVER.md 10, "The rest state on the engine mesh"): the engine's default scheme on the
// shipped 130k asset (f32 metrics), started at rest from tests/gpu/engine-stability.test.ts's 0.1 %
// pressure wave. GpuFlowSolver's defaults: thermally perfect gas, ISA SLS at rest, preconditioned
// tracking at minMach = M_cut = 0.003, the preconditioned CFL 0.8. The rule's window is D4-45's
// 2000 iterations (W2R-N16); checkpoints every 100.
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
/** The rule's bound on max |p'| over the late window, over its first (engine-stability's GROWTH). */
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
  const maxP = (): number => {
    const P = s.primitives();
    let m = 0;
    for (let c = 0; c < mesh.nCells; c++) {
      const q = Math.abs(P[NP * c + 4] as number);
      m = Number.isNaN(q) ? NaN : Math.max(m, q);
    }
    return m;
  };
  const first = maxP();
  const pressure: number[] = [];
  const residual: number[] = [];
  for (let done = EVERY; done <= D463_ITERATIONS; done += EVERY) {
    s.iterate(EVERY);
    pressure.push(maxP() / first);
    residual.push(s.stats.residualDensityL2);
    if (!Number.isFinite(pressure[pressure.length - 1])) break;
  }
  const finite = pressure.length === D463_ITERATIONS / EVERY && pressure.every(Number.isFinite);
  const peak = Math.max(...pressure);
  const late = pressure.slice(LATE / EVERY - 1);
  const latePeak = Math.max(...late);
  const res100 = residual[0] as number;
  const lateRes = Math.max(...residual.slice(LATE / EVERY - 1));
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
        metric: "rule (a): max |p'| / first over iterations 1000-2000",
        threshold: `<= ${D463_LATE_PRESSURE_BOUND}`,
        value: latePeak,
        pass: finite && latePeak <= D463_LATE_PRESSURE_BOUND,
      },
      {
        id: 'D4-63',
        metric: 'rule (b): max residual over 1000-2000 / residual at 100',
        threshold: '<= 1',
        value: lateRes / res100,
        pass: finite && lateRes <= res100,
      },
    ],
    extra: { pressure, residual },
  };
}
