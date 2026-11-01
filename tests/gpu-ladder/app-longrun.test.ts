// W2S-B1 (D4-100): the app's own GpuFlowSolver run long on the shipped 130k asset. In the official
// P4flow capture the look-dev page's solver (src/lookdev/flowPanel.ts: GpuFlowSolver's default,
// started from its timing state perfState, stepped at about 2 iterations per frame) went NaN: "the
// density residual is NaN after 6759 iterations". The GPU contract cases (d463 at rest, 40k) did
// not catch it, because nothing ran a moving, hot start state past 1000 iterations (the
// w2-solver-int soak).
//
// The configuration is the app's: GpuFlowSolver() with no options (thermally perfect gas, ISA SLS at
// rest, preconditioned tracking at minMach = M_cut = ENGINE_MACH_CUT, the preconditioned CFL 0.8),
// a device with the app's FLOW_SOLVER_LIMITS (src/app/simWorker.ts, createEngineView), and the
// page's frame: step() at the floor of 2 iterations, each frame with its resample pass.
// - The app's start (src/app/simWorker.ts): the ambient at rest. Uncoupled, it is an exact zero of
//   every flux and source (SOLVER.md 4, row A), so it must stay bitwise ambient however long it runs.
// - The look-dev page's start (perfState: an axial jet, swirl, a 2 % pressure wave and a hot fuel-air
//   plume; not a solution). Headless (Dawn, 2026-11-01) it reproduces the page: the first
//   non-finite state at iteration 6756 (the page read it back at 6759), in the core duct's outer
//   wall row (block 5, i 509-511, j 15, x 2.53 m), after hot plume gas that the outflow boundary
//   took back in had flowed upstream into the core nozzle (SOLVER.md 5, the outflow's backflow).
//
// The rule is D4-79's, as tests/gpu-ladder/d463.test.ts applies it to the rest state (SOLVER.md 10;
// LOG D4-72, D4-77, D4-79), with the norms evaluated in f64 by an oracle shell from the GPU's state:
// finite throughout and peak max |p'| < 100x its first (the signature); (a) the volume-weighted L2
// of p' over its first <= 2, as its max over 1000-2000 and at 20000; (b) the volume-weighted density
// residual at 20000 <= its value at 10000 and <= its value at 100. Reported: max T' against its
// start (the hot spot's signature), the GPU's own residual.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ENGINE_DEFINITION } from '../../src/engine/definition';
import { GpuFlowSolver } from '../../src/flow/gpu/device/flowSolver';
import type { GpuSolver } from '../../src/flow/gpu/device/gpuSolver';
import { THERMALLY_PERFECT } from '../../src/flow/reference/gas';
import { ReferenceSolver, type SolverOptions } from '../../src/flow/reference/solver';
import type { SolverMesh } from '../../src/flow/reference/solverMesh';
import { NP, NU } from '../../src/flow/reference/state';
import { FLOW_SOLVER_LIMITS, requestSimDevice, type SimDevice } from '../../src/gpu/device';
import { perfState } from '../../tools/perf/solverPerf';
import type { LadderRow } from '../ladder/common';
import { createDawnGpu } from '../gpu/helpers/dawn';
import { GpuErrorLog, shippedAsset, shippedMesh } from '../gpu/helpers/solver';
import { report } from './helpers';

/** D4-79: the case runs to 20000 iterations, checkpoints every 100. */
const ITERATIONS = 20000;
const EVERY = 100;
/** Rule (a)'s window (D4-45) and rule (b)'s middle checkpoint (D4-79). */
const LATE = 1000;
const LATE_END = 2000;
const MID = 10000;
/** Rule (a)'s bound (D4-72) and the signature's (cases/d463.ts). */
const PRESSURE_BOUND = 2;
const SIGNATURE_BOUND = 100;
/** The page's frame: the scheduler's floor of 2 iterations (D4-2) at the app's measured budget. */
const PER_FRAME = 2;

const at = (s: readonly number[], it: number): number => s[it / EVERY - 1] ?? Number.NaN;
const windowMax = (s: readonly number[], from: number, to: number): number =>
  Math.max(...s.slice(from / EVERY - 1, to / EVERY));

describe('W2S-B1: the app’s GpuFlowSolver on the 130k mesh, 20000 iterations', () => {
  const log = new GpuErrorLog();
  let sim: SimDevice;
  let flow: GpuFlowSolver;
  let mesh: SolverMesh;

  /** n iterations as the page steps them: frames of step() at the floor, each with its resample. */
  async function frames(n: number): Promise<void> {
    for (let done = 0; done < n; done += PER_FRAME) {
      const st = flow.step({ gpuTimeBudgetMs: 0, maxIterations: Math.min(PER_FRAME, n - done) });
      expect(st.iterationsThisStep).toBe(Math.min(PER_FRAME, n - done));
    }
    await sim.device.queue.onSubmittedWorkDone();
  }

  beforeAll(async () => {
    // the app's device: its preferred limits (createEngineView), not the test helper's maxima
    sim = await requestSimDevice(createDawnGpu(), {
      powerPreference: 'high-performance',
      preferredLimits: FLOW_SOLVER_LIMITS,
      onError: log.sink,
    });
    mesh = await shippedMesh();
    flow = new GpuFlowSolver();
    const { asset } = await shippedAsset();
    await flow.init({ device: sim.device, mesh: asset, definition: ENGINE_DEFINITION });
  }, 300_000);

  afterEach(() => {
    log.assertNone('gpu-ladder app-longrun');
  });

  afterAll(() => {
    flow.dispose();
    sim.destroy();
  });

  it('the app’s start, the ambient at rest, stays bitwise ambient for 20000 iterations', async () => {
    const g: GpuSolver | null = flow.kernel;
    if (g === null) throw new Error('no kernel');
    for (let done = 0; done < ITERATIONS; done += 5000) {
      await frames(5000);
      const U = await g.readConserved();
      let nonZero = 0;
      for (const v of U) if (v !== 0) nonZero++;
      expect(nonZero, `state words not exactly 0 after ${done + 5000} iterations`).toBe(0);
    }
    expect(flow.status().status).toBe('running');
    expect(await g.readResidual()).toBe(0);
  }, 600_000);

  it('the look-dev page’s start (perfState) stays finite and meets D4-79’s rule to 20000', async () => {
    const g: GpuSolver | null = flow.kernel;
    if (g === null) throw new Error('no kernel');
    const t = g.params.tracking[0];
    if (t === undefined) throw new Error('no tracking params');
    // the oracle shell takes the GPU's own scheme: its preconditioning as its uniforms hold it
    const options: SolverOptions = {
      gas: THERMALLY_PERFECT,
      freeStream: { pressure: g.ref.p, temperature: g.ref.t, velocity: g.ref.u },
      ...(t.precondition === 1
        ? { lowMachPreconditioning: { minMach: Math.sqrt(t.minMach2), machCut: t.machCut } }
        : {}),
    };
    const shell = new ReferenceSolver(mesh, options);
    // src/lookdev/flowPanel.ts startSolver
    g.setConserved(perfState(mesh, g.ref));
    const measure = async () => {
      shell.U.set(await g.readConserved());
      const P = shell.primitives();
      let max = 0;
      let e = 0;
      let tMax = -Infinity;
      for (let c = 0; c < mesh.nCells; c++) {
        const q = P[NP * c + 4] ?? NaN;
        max = Number.isNaN(q) ? NaN : Math.max(max, Math.abs(q));
        e += (mesh.cellVolR[c] ?? NaN) * q * q;
        const tp = P[NP * c + 6] ?? NaN;
        tMax = Number.isNaN(tp) ? NaN : Math.max(tMax, tp);
      }
      const R = shell.residual();
      let weighted = 0;
      let volume = 0;
      for (let c = 0; c < mesh.nCells; c++) {
        const bv = (shell.blockage[c] ?? NaN) * (mesh.cellVolR[c] ?? NaN);
        const q = (R[NU * c] ?? NaN) / bv;
        weighted += bv * q * q;
        volume += bv;
      }
      return { max, l2: Math.sqrt(e), resV: Math.sqrt(weighted / volume), tMax };
    };
    const first = await measure();
    expect(Number.isFinite(first.l2) && first.l2 > 0).toBe(true);
    const pressure: number[] = [];
    const energy: number[] = [];
    const residual: number[] = [];
    const gpuResidual: number[] = [];
    const tMax: number[] = [];
    let nonFiniteAt: number | null = null;
    for (let done = EVERY; done <= ITERATIONS; done += EVERY) {
      await frames(EVERY);
      const now = await measure();
      pressure.push(now.max / first.max);
      energy.push(now.l2 / first.l2);
      residual.push(now.resV);
      tMax.push(now.tMax);
      gpuResidual.push(await g.readResidual());
      if (done % 1000 === 0)
        process.stderr.write(
          `[app-longrun] ${done}: L2(p') x${(now.l2 / first.l2).toFixed(4)} max |p'| x${(now.max / first.max).toFixed(3)} resV ${now.resV.toExponential(4)} max T' ${now.tMax.toFixed(1)} K (GPU residual ${(gpuResidual[gpuResidual.length - 1] ?? NaN).toExponential(3)})\n`,
        );
      if (![now.max, now.l2, now.resV, now.tMax].every(Number.isFinite)) {
        nonFiniteAt = done;
        break;
      }
    }
    const n = ITERATIONS / EVERY;
    const finite =
      nonFiniteAt === null &&
      energy.length >= n &&
      [pressure, energy, residual].every((s) => s.slice(0, n).every(Number.isFinite));
    const peak = Math.max(...pressure.slice(0, n));
    const res100 = at(residual, EVERY);
    const resMid = at(residual, MID);
    const resEnd = at(residual, ITERATIONS);
    const rows: LadderRow[] = [
      {
        id: 'W2S-B1 look-dev start',
        metric: `signature: finite to ${ITERATIONS} (first non-finite checkpoint: ${nonFiniteAt ?? 'none'}), peak max |p'| / first`,
        threshold: `< ${SIGNATURE_BOUND}`,
        value: peak,
        pass: finite && peak < SIGNATURE_BOUND,
      },
      {
        id: 'W2S-B1 look-dev start',
        metric: "rule (a, D4-72): volume-weighted L2 of p' / first, max over 1000-2000",
        threshold: `<= ${PRESSURE_BOUND}`,
        value: windowMax(energy, LATE, LATE_END),
        pass: finite && windowMax(energy, LATE, LATE_END) <= PRESSURE_BOUND,
      },
      {
        id: 'W2S-B1 look-dev start',
        metric: `rule (a, D4-79): volume-weighted L2 of p' / first at ${ITERATIONS}`,
        threshold: `<= ${PRESSURE_BOUND}`,
        value: at(energy, ITERATIONS),
        pass: finite && at(energy, ITERATIONS) <= PRESSURE_BOUND,
      },
      {
        id: 'W2S-B1 look-dev start',
        metric: `rule (b, D4-79): volume-weighted residual at ${ITERATIONS} / at ${MID}`,
        threshold: '<= 1',
        value: resEnd / resMid,
        pass: finite && resEnd <= resMid,
      },
      {
        id: 'W2S-B1 look-dev start',
        metric: `rule (b, D4-79): volume-weighted residual at ${ITERATIONS} / at ${EVERY}`,
        threshold: '<= 1',
        value: resEnd / res100,
        pass: finite && resEnd <= res100,
      },
      {
        id: 'W2S-B1 look-dev start',
        metric: `reported (the hot spot): max T' over the run, K (start ${first.tMax.toFixed(1)} K)`,
        threshold: 'reported',
        value: Math.max(...tMax.filter(Number.isFinite)),
        pass: 'reported',
      },
      {
        id: 'W2S-B1 look-dev start',
        metric: `reported: max T' at ${ITERATIONS}, K`,
        threshold: 'reported',
        value: at(tMax, ITERATIONS),
        pass: 'reported',
      },
      {
        id: 'W2S-B1 look-dev start',
        metric: `reported: the GPU's own cell-mean residual at ${ITERATIONS} / at ${EVERY}`,
        threshold: 'reported',
        value: at(gpuResidual, ITERATIONS) / at(gpuResidual, EVERY),
        pass: 'reported',
      },
    ];
    report('W2S-B1-app-longrun', rows, {
      start: 'perfState (src/lookdev/flowPanel.ts)',
      preconditioning: options.lowMachPreconditioning ?? null,
      every: EVERY,
      nonFiniteAt,
      pressure,
      energy,
      residual,
      gpuResidual,
      tMax,
    });
  }, 3_600_000);
});
