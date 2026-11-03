// W3's coupling sources on the kernel (PHYSICS.md 3.3 CP1, CP2), on the shipped 130k mesh: the
// blade rows' Hall-Thollet and follow-camber body forces with the metal blockage and the
// combustor's heat and fuel, against the f64 oracle at SOLVER.md 12.2's conventions (the same
// f32-representable start on both, e_q after 1 and 10 iterations at rows C and E's 1e-5 and
// 1e-4), and CP1's Euler work integrated per row from the kernel's own source rates.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { THRESHOLDS } from '../../src/contracts/thresholds';
import { CYCLE_CALIBRATION } from '../../src/cycle/engine';
import { ENGINE_DEFINITION as DEF } from '../../src/engine/definition';
import { factValue } from '../../src/engine/facts';
import {
  BODY_FORCE_STRIDE,
  addBodyForceRates,
  bodyForceCoefficients,
} from '../../src/flow/coupling/bodyForce';
import {
  combustorRates,
  combustorSourceFromCycle,
  combustorZone,
} from '../../src/flow/coupling/combustor';
import { UNIT_KNOBS } from '../../src/flow/coupling/knobs';
import { meshRows, rowBlockageField } from '../../src/flow/coupling/rows';
import { GpuSolver } from '../../src/flow/gpu/device/gpuSolver';
import { THERMALLY_PERFECT } from '../../src/flow/reference/gas';
import { ReferenceSolver, type SolverOptions } from '../../src/flow/reference/solver';
import type { SourceModel } from '../../src/flow/reference/sources';
import { NU } from '../../src/flow/reference/state';
import type { SimDevice } from '../../src/gpu/device';
import { relativeError } from '../ladder/oracle';
import {
  ENGINE_PRECONDITIONING_CUT,
  GpuErrorLog,
  shippedMesh,
  solverDevice,
} from './helpers/solver';

/** SOLVER.md 12.2: rows C (after 1) and E (after 10, blockage and source sets). */
const TOL = { 1: 1e-5, 10: 1e-4 } as const;

describe('the coupling sources on the kernel against the oracle (CP1, CP2; 130k mesh)', () => {
  const log = new GpuErrorLog();
  let sim: SimDevice;

  beforeAll(async () => {
    sim = await solverDevice(log);
  });
  afterEach(() => log.assertNone('coupling'));
  afterAll(() => sim.destroy());

  it('matches the oracle with the body forces at the design speeds and the take-off fuel', async () => {
    const mesh = await shippedMesh();
    const rows = meshRows(mesh, DEF);
    const blockage = rowBlockageField(mesh, rows);
    const op = {
      n1RadPerS: (DEF.designPoint.n1Rpm * 2 * Math.PI) / 60,
      n2RadPerS: (DEF.designPoint.n2Rpm * 2 * Math.PI) / 60,
      vsvClosureRad: 0.1,
    };
    const k = bodyForceCoefficients(mesh, rows, DEF, op, UNIT_KNOBS, blockage);
    const options: Omit<SolverOptions, 'sources'> = {
      gas: THERMALLY_PERFECT,
      freeStream: { pressure: 101325, temperature: 288.15, velocity: 0 },
      lowMachPreconditioning: ENGINE_PRECONDITIONING_CUT,
    };
    const wf = factValue('fuelFlowTakeoff');
    const fire = combustorSourceFromCycle(CYCLE_CALIBRATION, {
      fuelFlowKgPerS: wf,
      combustorLit: true,
      p2Pa: 101325,
      t2K: 288.15,
    });
    const probe = new ReferenceSolver(mesh, options);
    const rate0 = combustorRates(
      mesh,
      combustorZone(mesh, DEF),
      blockage,
      probe.ref,
      fire.heatW,
      fire.fuelKgPerS,
    );
    const sources: SourceModel = (ctx, out) => {
      out.rate.set(rate0);
      addBodyForceRates(k, ctx.mesh, ctx.ref.rho, ctx.prim, out.rate, out.damping);
    };
    const ref = new ReferenceSolver(mesh, { ...options, sources });
    ref.setBlockage(blockage);
    // a smooth through-flow in the engine (axial 120 m/s in its ducts, fading outside), at rest
    // in the far field, with a swirl that puts the rotors off their camber
    ref.setState((x, r) => {
      const env = Math.exp(-(((x - 1.2) / 1.6) ** 4)) * Math.exp(-(Math.max(0, r - 0.9) / 0.3) ** 2);
      const p = 101325 * (1 + 0.02 * env);
      return { rho: p / (287.05 * (288.15 + 40 * env)), p, u: 120 * env, v: 0, w: -30 * env, z: 0 };
    });
    for (let c = 0; c < ref.U.length; c++) ref.U[c] = Math.fround(ref.U[c] ?? NaN);
    const gpu = await GpuSolver.create(sim.device, mesh, {
      gas: options.gas,
      freeStream: options.freeStream,
      lowMachPreconditioning: ENGINE_PRECONDITIONING_CUT,
      cellSource: true,
    });
    gpu.setBlockage(blockage);
    gpu.setConserved(ref.U);
    gpu.setCellSource({ rate0, bodyForce: k });

    let done = 0;
    const seen: string[] = [];
    for (const n of [1, 10] as const) {
      ref.iterate(n - done);
      gpu.iterate(n - done);
      done = n;
      const e = relativeError(await gpu.readPrimitives(), ref.primitives(), mesh.cellR, ref.ref.u);
      seen.push(e.toExponential(2));
      expect(e, `e_q after ${n}`).toBeLessThanOrEqual(TOL[n]);
    }

    // CP1 on the kernel: each row's energy source against Omega x its torque, from the kernel's
    // own rates (the last stage's), integrated in f64
    const { rate } = await gpu.readSources();
    let worst = 0;
    for (const r of rows) {
      let energy = 0;
      let torque = 0;
      for (const c of r.cells) {
        const bv = (blockage[c] ?? NaN) * (mesh.cellVolR[c] ?? NaN);
        energy += bv * (rate[NU * c + 4] ?? NaN);
        torque += bv * (rate[NU * c + 3] ?? NaN);
      }
      const omega = k[BODY_FORCE_STRIDE * (r.cells[0] ?? 0)] ?? NaN;
      expect(Math.abs(torque), r.row.id).toBeGreaterThan(0);
      if (omega === 0) {
        expect(energy, r.row.id).toBe(0);
        continue;
      }
      const err = Math.abs(energy - omega * torque) / Math.abs(omega * torque);
      worst = Math.max(worst, err);
      expect(err, r.row.id).toBeLessThanOrEqual(THRESHOLDS.CP1.values.maxEulerWorkRelativeError.value);
    }
    process.stdout.write(
      `[CP1/CP2 kernel] e_q after 1 / 10: ${seen.join(' / ')}; worst rotor Euler work ${worst.toExponential(2)}\n`,
    );
    gpu.destroy();
  }, 300_000);
});
