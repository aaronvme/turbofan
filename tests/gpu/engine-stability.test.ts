// The engine's default scheme on the shipped 130k mesh, started from a small disturbance at rest:
// the w2/solver-perf NaN (docs/handoffs/w2-solver-perf.md, FINDINGS 1; the repro was
// `tools/perf/dawn.ts soak --amp 0,0,0,0,0.001,0`). GpuFlowSolver's default is preconditioned
// tracking at minMach = M_cut = 0.003 and the preconditioned CFL 0.8 (SOLVER.md 10). Before the
// kernel took M_ref from the face's beta (D4-44, SOLVER.md 7), a 0.1 % pressure wave went NaN
// within 10 iterations at the inflow-axis corner, where the wave's jump to the inflow ghost lifts
// beta^2 by its dp term while the flow is at rest: beta / M_ref about 9 there, whose 1D acoustic
// limit (SOLVER.md 10, before D4-44) is below 0.8. The same wave stayed finite at CFL 0.5 and
// below, so the cause is the step limit of the mismatched family, as W2R-I6 found.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { SimDevice } from '../../src/gpu/device';
import { GpuFlowSolver } from '../../src/flow/gpu/device/flowSolver';
import type { GpuSolver } from '../../src/flow/gpu/device/gpuSolver';
import type { SolverMesh } from '../../src/flow/reference/solverMesh';
import { ENGINE_DEFINITION } from '../../src/engine/definition';
import { GpuErrorLog, shippedAsset, shippedMesh, solverDevice } from './helpers/solver';

/** The wave's relative amplitude: the soak's 0.1 %. */
const AMPLITUDE = 1e-3;
/** Iterations: 10x the pre-D4-44 time to NaN. */
const ITERATIONS = 100;
const EVERY = 10;
/**
 * A pseudo-time march toward rest must not amplify the wave. The bound is loose on purpose (a
 * divergence grows geometrically, so 2x is crossed within a few iterations of the onset), and the
 * oracle with D4-44 stays within 1.3x of its first max |p'| over the same iterations (handoff).
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
      expect(now.maxRho, `max |rho'| after ${done} iterations`).toBeLessThan(
        GROWTH * first.maxRho,
      );
    }
    process.stdout.write(`[engine-stability] max |rho'| / first: ${trace.join(', ')}\n`);
  });
});
