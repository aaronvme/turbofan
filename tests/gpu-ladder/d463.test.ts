// D4-63's contract case on the GPU kernel (D4-89: the kernel round reports the GPU's residual trend
// to 20000 iterations at the global M_cut 0.02, and D4-63 reopens if it grows). The CPU case is
// tests/ladder/cases/d463.ts on w2/reference-9 (d05e16d), mirrored here: the engine default
// (GpuFlowSolver's own: thermally perfect gas, ISA SLS at rest, preconditioned tracking at the
// adapter's minMach = M_cut, the preconditioned CFL 0.8) on the shipped 130k asset, started at rest
// from engine-stability.test.ts's 0.1 % pressure wave, isothermal (rho = p / (R T_inf)), u = 0.
//
// The norms are D4-72's and D4-77's: the volume-weighted L2 of p', sqrt(sum_c V_c p'_c^2) (V per
// radian; the blockage is 1), and the density residual in the same weighting, sqrt(sum bV (R/(bV))^2
// / sum bV). The GPU reduces only the cell mean of (R/(bV))^2 (SOLVER.md 11), so at each checkpoint
// the GPU's state (its f32 copy plus the low parts, readConserved) goes into an oracle shell with
// the GPU's own scheme parameters, and the shell evaluates p' and R(U^n) in f64. The GPU's own cell
// mean (its last stage 1, R(U^(n-1))) is reported beside the shell's cell mean of the same run as a
// check of that evaluation.
//
// D4-79's rule, pre-registered (SOLVER.md 10; LOG D4-72, D4-77, D4-79): (a) the L2 of p' over its
// first is <= 2, as its max over 1000-2000 and at 20000; (b) the weighted residual at 20000 is <= its
// value at 10000 and <= its value at 100. The signature: finite throughout, max |p'| below 100x its
// first at every checkpoint. Reported, not gating (D4-89): the trend over 15000-20000, and, with
// D463_GPU_EXTEND=<iterations>, the same past 20000.
import { afterAll, afterEach, beforeAll, describe, it } from 'vitest';
import { ENGINE_DEFINITION } from '../../src/engine/definition';
import { GpuFlowSolver } from '../../src/flow/gpu/device/flowSolver';
import type { GpuSolver } from '../../src/flow/gpu/device/gpuSolver';
import { THERMALLY_PERFECT } from '../../src/flow/reference/gas';
import { ReferenceSolver, type SolverOptions } from '../../src/flow/reference/solver';
import type { SolverMesh } from '../../src/flow/reference/solverMesh';
import { NP, NU } from '../../src/flow/reference/state';
import type { SimDevice } from '../../src/gpu/device';
import type { LadderRow } from '../ladder/common';
import { GpuErrorLog, shippedAsset, shippedMesh, solverDevice } from '../gpu/helpers/solver';
import { report } from './helpers';

/** The wave's relative amplitude (the soak's 0.1 %, the CPU contract case's). */
const AMPLITUDE = 1e-3;
/** D4-79: the case runs to 20000 iterations, checkpoints every 100. */
const ITERATIONS = 20000;
const EVERY = 100;
/** Rule (a)'s window (D4-45) and rule (b)'s middle checkpoint (D4-79). */
const LATE = 1000;
const LATE_END = 2000;
const MID = 10000;
/** D4-89's question: does the weighted residual keep decaying past 15000? */
const TREND_FROM = 15000;
/** Rule (a)'s bound (D4-72) and the signature's (cases/d463.ts). */
const PRESSURE_BOUND = 2;
const SIGNATURE_BOUND = 100;
/** Reported only: more iterations past 20000 (D4-89: "if it grows past 20k"). */
const EXTEND = Number(process.env.D463_GPU_EXTEND ?? 0);

/** The value at iteration `it` (a multiple of EVERY) of a series sampled every EVERY. */
const at = (s: readonly number[], it: number): number => s[it / EVERY - 1] ?? Number.NaN;
const windowMax = (s: readonly number[], from: number, to: number): number =>
  Math.max(...s.slice(from / EVERY - 1, to / EVERY));

/**
 * The least-squares trend of log(series) over [from, to], as the factor per 1000 iterations (< 1:
 * decaying, > 1: growing).
 */
function trendPer1000(s: readonly number[], from: number, to: number): number {
  const xs: number[] = [];
  const ys: number[] = [];
  for (let it = from; it <= to; it += EVERY) {
    xs.push(it);
    ys.push(Math.log(at(s, it)));
  }
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  for (let k = 0; k < n; k++) {
    sxy += ((xs[k] ?? 0) - mx) * ((ys[k] ?? 0) - my);
    sxx += ((xs[k] ?? 0) - mx) ** 2;
  }
  return Math.exp((1000 * sxy) / sxx);
}

describe('D4-63 on the GPU: the engine default at rest on the 130k mesh, 20000 iterations', () => {
  const log = new GpuErrorLog();
  let sim: SimDevice;
  let flow: GpuFlowSolver;
  let mesh: SolverMesh;

  beforeAll(async () => {
    sim = await solverDevice(log);
    mesh = await shippedMesh();
    flow = new GpuFlowSolver();
    const { asset } = await shippedAsset();
    await flow.init({ device: sim.device, mesh: asset, definition: ENGINE_DEFINITION });
  }, 300_000);

  afterEach(() => {
    log.assertNone('gpu-ladder d463');
  });

  afterAll(() => {
    flow.dispose();
    sim.destroy();
  });

  it("D4-79's rule (a) and (b) on the GPU, the trend over 15000-20000 reported", async () => {
    const g: GpuSolver | null = flow.kernel;
    if (g === null) throw new Error('no kernel');
    // the oracle shell takes the GPU's own scheme: its preconditioning as its uniforms hold it
    const t = g.params.tracking[0];
    if (t === undefined) throw new Error('no tracking params');
    const options: SolverOptions = {
      // GpuFlowSolver's default gas
      gas: THERMALLY_PERFECT,
      freeStream: { pressure: g.ref.p, temperature: g.ref.t, velocity: g.ref.u },
      ...(t.precondition === 1
        ? { lowMachPreconditioning: { minMach: Math.sqrt(t.minMach2), machCut: t.machCut } }
        : {}),
    };
    const shell = new ReferenceSolver(mesh, options);
    let x0 = Infinity;
    let x1 = -Infinity;
    let r1 = 0;
    for (let c = 0; c < mesh.nCells; c++) {
      x0 = Math.min(x0, mesh.cellX[c] ?? NaN);
      x1 = Math.max(x1, mesh.cellX[c] ?? NaN);
      r1 = Math.max(r1, mesh.cellR[c] ?? NaN);
    }
    const { p, t: tInf, r } = g.ref;
    g.setState((x, rc) => {
      const xn = (x - x0) / (x1 - x0);
      const dp = p * AMPLITUDE * Math.cos(6 * Math.PI * xn) * Math.exp(-((rc / r1 / 0.3) ** 2));
      return { rho: (p + dp) / (r * tInf), u: 0, v: 0, w: 0, p: p + dp, z: 0 };
    });
    // the GPU's state in the shell: max |p'|, the weighted L2 of p', and both residual norms of R(U^n)
    const measure = async () => {
      shell.U.set(await g.readConserved());
      const P = shell.primitives();
      let max = 0;
      let e = 0;
      for (let c = 0; c < mesh.nCells; c++) {
        const q = P[NP * c + 4] ?? NaN;
        max = Number.isNaN(q) ? NaN : Math.max(max, Math.abs(q));
        e += (mesh.cellVolR[c] ?? NaN) * q * q;
      }
      const R = shell.residual();
      let mean = 0;
      let weighted = 0;
      let volume = 0;
      for (let c = 0; c < mesh.nCells; c++) {
        const bv = (shell.blockage[c] ?? NaN) * (mesh.cellVolR[c] ?? NaN);
        const q = (R[NU * c] ?? NaN) / bv;
        mean += q * q;
        weighted += bv * q * q;
        volume += bv;
      }
      return {
        max,
        l2: Math.sqrt(e),
        resV: Math.sqrt(weighted / volume),
        resMean: Math.sqrt(mean / mesh.nCells),
      };
    };
    const first = await measure();
    const total = ITERATIONS + (Number.isInteger(EXTEND) && EXTEND > 0 ? EXTEND : 0);
    const pressure: number[] = [];
    const energy: number[] = [];
    const residual: number[] = [];
    const residualMean: number[] = [];
    const gpuResidualMean: number[] = [];
    for (let done = EVERY; done <= total; done += EVERY) {
      g.iterate(EVERY);
      const now = await measure();
      pressure.push(now.max / first.max);
      energy.push(now.l2 / first.l2);
      residual.push(now.resV);
      residualMean.push(now.resMean);
      gpuResidualMean.push(await g.readResidual());
      if (done % 1000 === 0)
        process.stderr.write(
          `[d463 gpu] ${done}: L2(p') x${(now.l2 / first.l2).toFixed(4)} max |p'| x${(now.max / first.max).toFixed(3)} resV ${now.resV.toExponential(4)} mean ${now.resMean.toExponential(3)} (GPU ${(gpuResidualMean[gpuResidualMean.length - 1] ?? NaN).toExponential(3)})\n`,
        );
      if (!Number.isFinite(energy[energy.length - 1])) break;
    }
    const n = ITERATIONS / EVERY;
    const finite =
      energy.length >= n &&
      [pressure, energy, residual].every((s) => s.slice(0, n).every(Number.isFinite));
    const peak = Math.max(...pressure.slice(0, n));
    const res100 = at(residual, EVERY);
    const resMid = at(residual, MID);
    const resEnd = at(residual, ITERATIONS);
    const resTrendFrom = at(residual, TREND_FROM);
    const rows: LadderRow[] = [
      {
        id: 'D4-63 GPU',
        metric: `signature: finite to ${ITERATIONS}, peak max |p'| / first`,
        threshold: `< ${SIGNATURE_BOUND}`,
        value: peak,
        pass: finite && peak < SIGNATURE_BOUND,
      },
      {
        id: 'D4-63 GPU',
        metric: "rule (a, D4-72): volume-weighted L2 of p' / first, max over 1000-2000",
        threshold: `<= ${PRESSURE_BOUND}`,
        value: windowMax(energy, LATE, LATE_END),
        pass: finite && windowMax(energy, LATE, LATE_END) <= PRESSURE_BOUND,
      },
      {
        id: 'D4-63 GPU',
        metric: `rule (a, D4-79): volume-weighted L2 of p' / first at ${ITERATIONS}`,
        threshold: `<= ${PRESSURE_BOUND}`,
        value: at(energy, ITERATIONS),
        pass: finite && at(energy, ITERATIONS) <= PRESSURE_BOUND,
      },
      {
        id: 'D4-63 GPU',
        metric: `rule (b, D4-79): volume-weighted residual at ${ITERATIONS} / at ${MID}`,
        threshold: '<= 1',
        value: resEnd / resMid,
        pass: finite && resEnd <= resMid,
      },
      {
        id: 'D4-63 GPU',
        metric: `rule (b, D4-79): volume-weighted residual at ${ITERATIONS} / at ${EVERY}`,
        threshold: '<= 1',
        value: resEnd / res100,
        pass: finite && resEnd <= res100,
      },
      {
        id: 'D4-63 GPU',
        metric: `reported (D4-89): weighted residual at ${ITERATIONS} / at ${TREND_FROM}`,
        threshold: 'reported',
        value: resEnd / resTrendFrom,
        pass: 'reported',
      },
      {
        id: 'D4-63 GPU',
        metric: `reported (D4-89): weighted residual, max over ${TREND_FROM}-${ITERATIONS} / at ${TREND_FROM}`,
        threshold: 'reported',
        value: windowMax(residual, TREND_FROM, ITERATIONS) / resTrendFrom,
        pass: 'reported',
      },
      {
        id: 'D4-63 GPU',
        metric: `reported (D4-89): weighted residual's log-linear trend over ${TREND_FROM}-${ITERATIONS}, factor per 1000 iterations`,
        threshold: 'reported',
        value: trendPer1000(residual, TREND_FROM, ITERATIONS),
        pass: 'reported',
      },
      {
        id: 'D4-63 GPU',
        metric: `reported (D4-89): L2 of p' / first, log-linear trend over ${TREND_FROM}-${ITERATIONS}, factor per 1000 iterations`,
        threshold: 'reported',
        value: trendPer1000(energy, TREND_FROM, ITERATIONS),
        pass: 'reported',
      },
      {
        id: 'D4-63 GPU',
        metric: `reported: max |p'| / first at ${ITERATIONS}`,
        threshold: 'reported',
        value: at(pressure, ITERATIONS),
        pass: 'reported',
      },
      {
        id: 'D4-63 GPU',
        metric: `reported (check of the shell's evaluation): the GPU's own cell-mean residual (R(U^(n-1))) / the shell's (R(U^n)) at ${ITERATIONS}`,
        threshold: 'reported',
        value: at(gpuResidualMean, ITERATIONS) / at(residualMean, ITERATIONS),
        pass: 'reported',
      },
    ];
    const end = energy.length * EVERY;
    if (end > ITERATIONS) {
      rows.push(
        {
          id: 'D4-63 GPU',
          metric: `reported (extension): weighted residual at ${end} / at ${ITERATIONS}, max over ${ITERATIONS}-${end} / at ${ITERATIONS}`,
          threshold: 'reported',
          value: at(residual, end) / resEnd,
          pass: 'reported',
        },
        {
          id: 'D4-63 GPU',
          metric: `reported (extension): weighted residual, max over ${ITERATIONS}-${end} / at ${ITERATIONS}`,
          threshold: 'reported',
          value: windowMax(residual, ITERATIONS, end) / resEnd,
          pass: 'reported',
        },
        {
          id: 'D4-63 GPU',
          metric: `reported (extension): weighted residual's trend over ${ITERATIONS}-${end}, factor per 1000 iterations`,
          threshold: 'reported',
          value: trendPer1000(residual, ITERATIONS, end),
          pass: 'reported',
        },
        {
          id: 'D4-63 GPU',
          metric: `reported (extension): L2 of p' / first at ${end}`,
          threshold: 'reported',
          value: at(energy, end),
          pass: 'reported',
        },
      );
    }
    report('D4-63-gpu', rows, {
      amplitude: AMPLITUDE,
      start: 'isothermal',
      preconditioning: options.lowMachPreconditioning ?? null,
      every: EVERY,
      pressure,
      energy,
      residual,
      residualMean,
      gpuResidualMean,
    });
  }, 3_600_000);
});
