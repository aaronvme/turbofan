// The engine's default scheme on the shipped 130k mesh, started from a small disturbance at rest:
// the w2/solver-perf NaN (docs/handoffs/w2-solver-perf.md, FINDINGS 1; the repro was
// `tools/perf/dawn.ts soak --amp 0,0,0,0,0.001,0`). GpuFlowSolver's default is preconditioned
// tracking at minMach = M_cut and the preconditioned CFL 0.8 (SOLVER.md 10): 0.003 when this was
// written (D4-40), the global M_cut 0.02 since D4-89 (the trajectory below is 0.003's; the
// 20000-iteration case at the cut is tests/gpu-ladder/d463.test.ts). Before the
// kernel took M_ref from the face's beta (D4-44, SOLVER.md 7), a 0.1 % pressure wave went NaN
// within 10 iterations, first at cell 0, the inflow-axis corner: there the wave's jump to the
// inflow ghost lifts beta^2 by its dp term while the flow is at rest, so beta / M_ref was 8.9
// (M_ref = M_cut at rest; 94 cells above 8), where SOLVER.md 10's 1D limit before D4-44 is about
// 0.42 (its table: 0.469 at beta / M_ref 8, 0.234 at 16; W2I-N5), below CFL 0.8. The same wave
// stayed finite at CFL 0.5 and below, and the f64 oracle with the face-Mach M_ref put back also
// went NaN within 10 iterations: the step limit of the mismatched family
// (W2R-I6), not f32. With D4-44 the oracle's max |rho'| over its first is 0.998, 0.991, 0.984,
// 0.979, 0.974, 0.970, 0.966, 1.145, 1.343, 1.510 every 10 iterations to 100, and the kernel's
// the same to 3 digits (w2-solver-int handoff).
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { SimDevice } from '../../src/gpu/device';
import { GpuFlowSolver } from '../../src/flow/gpu/device/flowSolver';
import type { GpuSolver } from '../../src/flow/gpu/device/gpuSolver';
import { DEFAULT_CFL_PRECONDITIONED, ENGINE_MACH_CUT } from '../../src/flow/gpu/params';
import type { SolverMesh } from '../../src/flow/reference/solverMesh';
import { ENGINE_DEFINITION } from '../../src/engine/definition';
import { GpuErrorLog, shippedAsset, shippedMesh, solverDevice } from './helpers/solver';

/** The wave's relative amplitude: the soak's 0.1 %. */
const AMPLITUDE = 1e-3;
/** Iterations: 10x the pre-D4-44 time to NaN. */
const ITERATIONS = 100;
const EVERY = 10;
/**
 * A divergence grows geometrically, so it crosses 2x within a few iterations of its onset. The
 * oracle's own trajectory (above) stays below 1.52x to 100 iterations. It is not a bound for
 * longer runs: the scheme's pseudo-time transient lifts the oracle's max |p'| to 20x near the
 * inlet by 270 iterations, and it falls back by 300.
 */
const GROWTH = 2;

/** The soak's pressure wave: perfState's p term alone (tools/perf/solverPerf.ts), at rest. */
function pressureWave(mesh: SolverMesh, s: GpuSolver): void {
  let x0 = Infinity;
  let x1 = -Infinity;
  let r1 = 0;
  for (let c = 0; c < mesh.nCells; c++) {
    x0 = Math.min(x0, mesh.cellX[c] ?? NaN);
    x1 = Math.max(x1, mesh.cellX[c] ?? NaN);
    r1 = Math.max(r1, mesh.cellR[c] ?? NaN);
  }
  const { p, t, r } = s.ref;
  s.setState((x, rc) => {
    const xn = (x - x0) / (x1 - x0);
    const pc = p * (1 + AMPLITUDE * Math.cos(6 * Math.PI * xn) * Math.exp(-((rc / r1 / 0.3) ** 2)));
    return { rho: pc / (r * t), u: s.ref.u, v: 0, w: 0, p: pc, z: 0 };
  });
}

/** Every state word finite (rho', momenta, eta, rho Z, tau, beta^2), and max |rho'|. */
function scan(U: Float32Array): { finite: boolean; maxRho: number } {
  let finite = true;
  let maxRho = 0;
  for (let k = 0; k < U.length; k++) if (!Number.isFinite(U[k] ?? NaN)) finite = false;
  for (let k = 0; k < U.length; k += 8) maxRho = Math.max(maxRho, Math.abs(U[k] ?? NaN));
  return { finite, maxRho };
}

describe('the engine default on the 130k mesh (the w2/solver-perf NaN)', () => {
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
    log.assertNone('engine-stability');
  });

  afterAll(() => {
    flow.dispose();
    sim.destroy();
  });

  it('D4-44: a 0.1 % pressure wave at rest stays finite and bounded for 100 iterations', async () => {
    const s = flow.kernel;
    if (s === null) throw new Error('no kernel');
    pressureWave(mesh, s);
    const first = scan(await s.readState());
    expect(first.finite).toBe(true);
    expect(first.maxRho).toBeGreaterThan(0);
    const trace: string[] = [];
    for (let done = EVERY; done <= ITERATIONS; done += EVERY) {
      s.iterate(EVERY);
      const now = scan(await s.readState());
      trace.push(`${done}: ${now.finite ? (now.maxRho / first.maxRho).toFixed(3) : 'NaN'}`);
      expect(now.finite, `finite after ${done} iterations (${trace.join(', ')})`).toBe(true);
      expect(now.maxRho, `max |rho'| after ${done} iterations`).toBeLessThan(GROWTH * first.maxRho);
    }
    process.stdout.write(`[engine-stability] max |rho'| / first: ${trace.join(', ')}\n`);
  });

  it("D4-89: the adapter's default runs the kernel at minMach = M_cut = the global M_cut 0.02", () => {
    const t = flow.kernel?.params.tracking[0];
    expect(ENGINE_MACH_CUT).toBe(0.02);
    expect(t?.precondition).toBe(1);
    expect(t?.minMach2).toBe(ENGINE_MACH_CUT * ENGINE_MACH_CUT);
    expect(t?.machCut).toBe(ENGINE_MACH_CUT);
    expect(t?.cfl).toBe(DEFAULT_CFL_PRECONDITIONED);
    // at rest the preconditioned far field sits at beta = M_cut (SOLVER.md 5)
    expect(flow.kernel?.params.bcTracking.farFieldBeta2).toBe(ENGINE_MACH_CUT * ENGINE_MACH_CUT);
  });
});
