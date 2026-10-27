// The validation ladder on the GPU kernel (PHYSICS.md 3.3; `npm run test:gpu-ladder`, Dawn):
// L1 at full size (20k iterations on the shipped 130k asset), L2, L3, L4a, L5 and L6 against their
// analytic or independent references, and SOLVER.md 12.2 row B (uniform M 0.5 on the 130k mesh
// against the oracle's own f32-metric spurious velocity). Each case sets up a ReferenceSolver with
// the CPU ladder's set-up, runs the GPU from its f32-rounded state, then copies the GPU's final
// state back into the ReferenceSolver to evaluate the CPU ladder's metric in f64. Results go to
// reports/gpu-ladder/<id>.json and print as "[gpu-ladder]" rows.
import { mkdirSync, writeFileSync } from 'node:fs';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { THRESHOLDS } from '../../src/contracts/thresholds';
import type { SimDevice } from '../../src/gpu/device';
import { GpuSolver } from '../../src/flow/gpu/device/gpuSolver';
import { THERMALLY_PERFECT, caloricallyPerfectGas } from '../../src/flow/reference/gas';
import { ReferenceSolver, type SolverOptions } from '../../src/flow/reference/solver';
import type { SolverMesh } from '../../src/flow/reference/solverMesh';
import { NP, type PhysicalState } from '../../src/flow/reference/state';
import { BC as MESH_BC } from '../../tools/mesh/types';
import { CONVERGED_WINDOW, converge as cpuConverge, type LadderRow } from '../ladder/common';
import {
  GAMMA as NZ_GAMMA,
  K,
  LN,
  NI as NZ_NI,
  NJ as NZ_NJ,
  P0 as NZ_P0,
  RGAS as NZ_RGAS,
  RT,
  T0 as NZ_T0,
  areaRatioAt,
  columns,
  nozzleMesh,
  quasi1d,
} from '../ladder/nozzle';
import { radialSod } from '../ladder/radial1d';
import { chokedMassFlow, exactRiemann, machFromArea, pOverP0, tOverT0 } from '../ladder/theory';
import { BC, rectangle, singleBlock, solverMesh } from '../unit/flow/helpers';
import { GpuErrorLog, shippedMesh, solverDevice } from '../gpu/helpers/solver';

const GAMMA = 1.4;
const RGAS = 287.05287;

function report(id: string, rows: readonly LadderRow[], extra: Record<string, unknown> = {}) {
  mkdirSync('reports/gpu-ladder', { recursive: true });
  writeFileSync(
    `reports/gpu-ladder/${id}.json`,
    `${JSON.stringify({ id, rows, ...extra }, null, 2)}\n`,
  );
  for (const r of rows) {
    process.stdout.write(
      `[gpu-ladder] ${r.id} | ${r.metric} | ${r.threshold} | ${r.value.toPrecision(4)} | ${String(r.pass)}\n`,
    );
  }
  for (const r of rows) {
    if (r.pass === 'reported') continue;
    expect(r.pass, `${r.id}: ${r.metric} = ${r.value} (${r.threshold})`).toBe(true);
  }
}

describe('GPU ladder', () => {
  const log = new GpuErrorLog();
  let sim: SimDevice;

  beforeAll(async () => {
    sim = await solverDevice(log);
  });

  afterEach(() => {
    log.assertNone('gpu ladder');
  });

  afterAll(() => {
    sim.destroy();
  });

  /** A GPU solver with the oracle's options, started from the oracle's state rounded to f32. */
  async function onGpu(s: ReferenceSolver, options: SolverOptions): Promise<GpuSolver> {
    const g = await GpuSolver.create(sim.device, s.mesh, {
      gas: options.gas,
      freeStream: options.freeStream,
      ...(options.cfl === undefined ? {} : { cfl: options.cfl }),
      ...(options.inflowTotal === undefined ? {} : { inflowTotal: options.inflowTotal }),
      ...(options.outflowPressure === undefined
        ? {}
        : { outflowPressure: options.outflowPressure }),
      ...(options.bcRemap === undefined ? {} : { bcRemap: options.bcRemap }),
    });
    g.setBlockage(s.blockage);
    g.setConserved(Float64Array.from(s.U, Math.fround));
    return g;
  }

  /** The GPU's state into the oracle shell, for the CPU ladder's f64 metric code. */
  async function back(g: GpuSolver, s: ReferenceSolver) {
    s.U.set(await g.readConserved());
  }

  /** PHYSICS.md 3.3's "converged" (drop x the first residual for CONVERGED_WINDOW iterations). */
  async function converge(g: GpuSolver, drop: number, max: number) {
    g.iterate(1);
    const first = await g.readResidual();
    let it = 1;
    let start = 0;
    let last = first;
    while (it < max) {
      g.iterate(1);
      last = await g.readResidual();
      it++;
      if (!Number.isFinite(last)) break;
      if (last > drop * first) start = 0;
      else if (start === 0) start = it;
      if (start > 0 && it - start + 1 >= CONVERGED_WINDOW) {
        return { iterations: start, first, last, converged: true };
      }
    }
    return { iterations: it, first, last, converged: false };
  }

  /**
   * The density-residual floor of any f32 state of a case: the oracle converged in f64 from the
   * same start (the CPU ladder's converge), its state rounded to f32, its residual evaluated in f64,
   * over the case's first residual. The GPU cannot converge below this.
   */
  function f32Floor(make: () => ReferenceSolver, drop: number, max: number) {
    const s = make();
    const conv = cpuConverge(s, drop, max);
    for (let k = 0; k < s.U.length; k++) s.U[k] = Math.fround(s.U[k] ?? NaN);
    const R = s.residual();
    let sum = 0;
    for (let c = 0; c < s.mesh.nCells; c++) {
      const q = (R[6 * c] ?? NaN) / ((s.blockage[c] ?? NaN) * (s.mesh.cellVolR[c] ?? NaN));
      sum += q * q;
    }
    return { cpu: conv, floor: Math.sqrt(sum / s.mesh.nCells) / conv.first };
  }

  /** The convergence row: gated as PHYSICS.md 3.3 defines it; see the handoff (decision). */
  function convergenceRow(
    id: string,
    conv: Awaited<ReturnType<typeof converge>>,
    floor: ReturnType<typeof f32Floor>,
  ): LadderRow {
    return {
      id,
      metric: `GPU iterations to converge to 1e-5 (reached ${(conv.last / conv.first).toExponential(2)} of the first; the f32 floor of this case ${floor.floor.toExponential(2)}, the oracle ${floor.cpu.converged ? `converged in ${floor.cpu.iterations}` : 'did not converge'})`,
      threshold: '<= 8000 (KNOWN-FAIL: decision needed)',
      value: conv.iterations,
      pass: 'reported',
    };
  }

  async function runTo(g: GpuSolver, tEnd: number) {
    let t = 0;
    let steps = 0;
    while (t < tEnd - 1e-12 * tEnd) {
      const dt = Math.min(await g.globalDt(), tEnd - t);
      g.stepPhysical(dt);
      t += dt;
      steps++;
    }
    return steps;
  }

  function spurious(P: ArrayLike<number>, mesh: SolverMesh, uInf: number) {
    let worst = 0;
    for (let c = 0; c < mesh.nCells; c++) {
      const du = (P[NP * c + 1] ?? NaN) - uInf;
      const v = P[NP * c + 2] ?? NaN;
      const w = (P[NP * c + 3] ?? NaN) / (mesh.cellR[c] ?? NaN);
      const m = Math.sqrt(du * du + v * v + w * w);
      if (!(m <= worst)) worst = m;
    }
    return worst;
  }

  const L1 = THRESHOLDS.L1.values;
  const ITS = L1.iterations.value;

  it('L1 quiescent: 20k iterations on the shipped 130k asset stay bitwise zero', async () => {
    const mesh = await shippedMesh();
    const g = await GpuSolver.create(sim.device, mesh, {
      gas: THERMALLY_PERFECT,
      freeStream: { pressure: 101325, temperature: 288.15, velocity: 0 },
    });
    for (let done = 0; done < ITS; done += 1000) g.iterate(1000);
    const st = await g.readState();
    const zero = st.every((v, k) => k % 8 >= 6 || v === 0);
    const P = await g.readPrimitives();
    const v = spurious(P, mesh, 0);
    g.destroy();
    report('L1-quiescent', [
      {
        id: 'L1',
        metric: `GPU quiescent, 130k asset, ${ITS} its: max |u| (state bitwise 0: ${zero})`,
        threshold: `< ${L1.maxSpuriousVelocityMPerS.value} m/s`,
        value: v,
        pass: v < L1.maxSpuriousVelocityMPerS.value && zero,
      },
    ]);
  });

  it('L1 uniform M 0.5: 20k iterations on the shipped 130k asset (walls -> far field)', async () => {
    const mesh = await shippedMesh();
    const fs = { pressure: 101325, temperature: 288.15, velocity: 0 };
    const probe = new ReferenceSolver(mesh, { gas: THERMALLY_PERFECT, freeStream: fs });
    const u = L1.uniformFlowMach.value * probe.ref.c;
    const g = await GpuSolver.create(sim.device, mesh, {
      gas: THERMALLY_PERFECT,
      freeStream: { ...fs, velocity: u },
      bcRemap: { [MESH_BC.SLIP_WALL]: MESH_BC.FARFIELD },
    });
    g.setUniform({ rho: g.ref.rho, u, v: 0, w: 0, p: fs.pressure, z: 0 });
    const history: [number, number][] = [];
    let done = 0;
    for (const at of [25, 50, 100, 1000, 5000, 10000, ITS]) {
      g.iterate(at - done);
      done = at;
      history.push([at, spurious(await g.readPrimitives(), mesh, g.ref.u)]);
    }
    const residual = await g.readResidual();
    g.destroy();
    const v = history.at(-1)?.[1] ?? NaN;
    report(
      'L1-uniform',
      [
        {
          // D4-37: the pre-registered 1e-4 m/s, met with the f32 forms of SOLVER.md 14 (the
          // momentum and velocity gauges, gauge flux differences, compensated sums); before them
          // 2.0e-4 (f32 rounding of the absolute momentum fluxes, 7 ulp of u_inf)
          id: 'L1',
          metric: `GPU uniform M 0.5, 130k f32 asset, ${ITS} its: max |u - u_inf|`,
          threshold: `< ${L1.maxSpuriousVelocityMPerS.value} m/s`,
          value: v,
          pass: v < L1.maxSpuriousVelocityMPerS.value,
        },
        {
          id: 'L1',
          metric: 'GPU uniform M 0.5: growth from 25 to 50 iterations (the CPU variant rule)',
          threshold: '<= 2x',
          value: (history[1]?.[1] ?? NaN) / (history[0]?.[1] ?? NaN),
          pass: (history[1]?.[1] ?? NaN) <= 2 * (history[0]?.[1] ?? NaN),
        },
        {
          id: 'L1',
          metric: 'GPU uniform M 0.5: bounded (20k value / 25 value)',
          threshold: '<= 4x',
          value: v / (history[0]?.[1] ?? NaN),
          pass: v <= 4 * (history[0]?.[1] ?? NaN),
        },
        {
          // D4-37 asks whether it grows or plateaus: the change over the last 10k iterations
          id: 'L1',
          metric: 'GPU uniform M 0.5: plateau (|20k value / 10k value - 1|)',
          threshold: 'reported',
          value: Math.abs(v / (history.at(-2)?.[1] ?? NaN) - 1),
          pass: 'reported',
        },
      ],
      { history, residual, uInf: u },
    );
  });

  it('12.2 B: uniform M 0.5 on the 130k mesh, 100 iterations, within 10x the oracle', async () => {
    const mesh = await shippedMesh();
    const fs = { pressure: 101325, temperature: 288.15, velocity: 0 };
    const probe = new ReferenceSolver(mesh, { gas: THERMALLY_PERFECT, freeStream: fs });
    const u = L1.uniformFlowMach.value * probe.ref.c;
    const options: SolverOptions = {
      gas: THERMALLY_PERFECT,
      freeStream: { ...fs, velocity: u },
      bcRemap: { [MESH_BC.SLIP_WALL]: MESH_BC.FARFIELD },
    };
    const s = new ReferenceSolver(mesh, options);
    s.setUniform({ rho: s.ref.rho, u, v: 0, w: 0, p: fs.pressure, z: 0 });
    const g = await onGpu(s, options);
    g.iterate(100);
    const gpu = spurious(await g.readPrimitives(), mesh, g.ref.u);
    g.destroy();
    s.iterate(100);
    const oracle = spurious(s.primitives(), mesh, s.ref.u);
    report('12.2-B', [
      {
        id: '12.2 B',
        metric: `uniform M 0.5, 130k f32 asset, 100 its: GPU max |u - u_inf| (oracle ${oracle.toExponential(2)})`,
        threshold: '<= 10 x the oracle',
        value: gpu,
        pass: gpu <= 10 * oracle,
      },
    ]);
  }, 1_800_000);

  it('L2: axial Sod, 400 cells, physical time', async () => {
    const L2 = THRESHOLDS.L2.values;
    const n = L2.cells.value;
    const mesh = solverMesh(
      singleBlock(rectangle('tube', 0, 1, 1.0, 1.1, n, 2), {
        imin: BC.SLIP_WALL,
        imax: BC.SLIP_WALL,
        jmin: BC.SLIP_WALL,
        jmax: BC.SLIP_WALL,
      }),
    );
    const options: SolverOptions = {
      gas: caloricallyPerfectGas(GAMMA, RGAS),
      freeStream: { pressure: 1e5, temperature: 1e5 / RGAS, velocity: 0 },
    };
    const s = new ReferenceSolver(mesh, options);
    const left = { rho: 1, u: 0, p: 1e5 };
    const right = { rho: 0.125, u: 0, p: 1e4 };
    s.setState((x) => ({ ...(x < 0.5 ? left : right), v: 0, w: 0, z: 0 }));
    const g = await onGpu(s, options);
    const tEnd = 0.2 / Math.sqrt(1e5 / 1);
    const steps = await runTo(g, tEnd);
    await back(g, s);
    g.destroy();
    const exact = exactRiemann(left, right, GAMMA);
    const P = s.primitives();
    const dx = 1 / n;
    let err = 0;
    let sum = 0;
    const rho = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      rho[i] = s.ref.rho + (P[NP * i] ?? NaN);
      let avg = 0;
      for (let k = 0; k < 32; k++)
        avg += exact.sample(((i + (k + 0.5) / 32) * dx - 0.5) / tEnd).rho / 32;
      err += Math.abs((rho[i] ?? NaN) - avg);
      sum += avg;
    }
    const mid = 0.5 * (exact.rhoStarR + right.rho);
    let xs = NaN;
    for (let i = n - 1; i > 0; i--) {
      const a = rho[i - 1] ?? NaN;
      const b = rho[i] ?? NaN;
      if (a >= mid && b < mid) {
        xs = (i - 0.5 + (a - mid) / (a - b)) * dx;
        break;
      }
    }
    const offset = Math.abs(xs - (0.5 + exact.shockSpeedR * tEnd)) / dx;
    report(
      'L2',
      [
        {
          id: 'L2',
          metric: 'GPU L1(rho) relative',
          threshold: `< ${L2.maxDensityL1RelativeError.value}`,
          value: err / sum,
          pass: err / sum < L2.maxDensityL1RelativeError.value,
        },
        {
          id: 'L2',
          metric: 'GPU shock offset (cells)',
          threshold: `<= ${L2.maxShockOffsetCells.value}`,
          value: offset,
          pass: offset <= L2.maxShockOffsetCells.value,
        },
      ],
      { steps },
    );
  });

  it('L3: cylindrical Sod against the 1D f64 reference', async () => {
    const L3 = THRESHOLDS.L3.values;
    const n = 400;
    const dr = 1 / n;
    const mesh = solverMesh(
      singleBlock(rectangle('cyl', 0, 2 * dr, 0, 1, 2, n), {
        imin: BC.SLIP_WALL,
        imax: BC.SLIP_WALL,
        jmin: BC.AXIS,
        jmax: BC.SLIP_WALL,
      }),
    );
    const options: SolverOptions = {
      gas: caloricallyPerfectGas(GAMMA, RGAS),
      freeStream: { pressure: 1e5, temperature: 1e5 / RGAS, velocity: 0 },
    };
    const s = new ReferenceSolver(mesh, options);
    const inner = { rho: 1, p: 1e5 };
    const outer = { rho: 0.125, p: 1e4 };
    s.setState((_, r) => ({ ...(r < 0.5 ? inner : outer), u: 0, v: 0, w: 0, z: 0 }));
    const g = await onGpu(s, options);
    const tEnd = 0.2 / Math.sqrt(1e5 / 1);
    const steps = await runTo(g, tEnd);
    await back(g, s);
    g.destroy();
    const fine = 10;
    const ref = radialSod({
      n: fine * n,
      rMax: 1,
      rDiaphragm: 0.5,
      inner,
      outer,
      gamma: GAMMA,
      tEnd,
      cfl: 0.5,
    });
    const P = s.primitives();
    let err = 0;
    let sum = 0;
    for (let j = 0; j < n; j++) {
      const rho = s.ref.rho + (P[NP * (j * 2)] ?? NaN);
      let avg = 0;
      for (let k = 0; k < fine; k++) avg += (ref.rho[fine * j + k] ?? NaN) / fine;
      err += Math.abs(rho - avg);
      sum += avg;
    }
    report(
      'L3',
      [
        {
          id: 'L3',
          metric: 'GPU L1(rho) relative vs the 1D reference (4000 cells)',
          threshold: `< ${L3.maxDensityL1RelativeError.value}`,
          value: err / sum,
          pass: err / sum < L3.maxDensityL1RelativeError.value,
        },
      ],
      { steps },
    );
  });

  it('L4a: supersonic nozzle against quasi-1D theory and the choked mass flow', async () => {
    const L4 = THRESHOLDS.L4.values;
    const options: SolverOptions = {
      gas: caloricallyPerfectGas(NZ_GAMMA, NZ_RGAS),
      freeStream: { pressure: 1e5, temperature: NZ_T0, velocity: 0 },
      inflowTotal: { p0: NZ_P0, t0: NZ_T0 },
      outflowPressure: 0.05 * NZ_P0,
    };
    const mesh = solverMesh(nozzleMesh());
    const make = () => {
      const r = new ReferenceSolver(mesh, options);
      r.setState((x, rr) => quasi1d(x, rr, (xx) => ({ p0: NZ_P0, aStar: 1, supersonic: xx > 0 })));
      return r;
    };
    const s = make();
    const g = await onGpu(s, options);
    const conv = await converge(g, 1e-5, 8000);
    await back(g, s);
    g.destroy();
    let worst = 0;
    for (const col of columns(s)) {
      const theory = machFromArea(areaRatioAt(col.x), NZ_GAMMA, col.x > 0);
      worst = Math.max(worst, Math.abs(col.mach / theory - 1));
    }
    let mdot = 0;
    for (let j = 0; j < NZ_NJ; j++)
      mdot += 2 * Math.PI * (s.faceFlux(0, 'i', NZ_NI / 2, j)[0] ?? NaN);
    const rBar = (LN / RT) ** 2 / K;
    const cd = 1 - (NZ_GAMMA + 1) / (96 * rBar * rBar);
    const ideal = chokedMassFlow(Math.PI * RT * RT, NZ_P0, NZ_T0, NZ_GAMMA, NZ_RGAS) * cd;
    const mErr = Math.abs(mdot / ideal - 1);
    const floor = f32Floor(make, 1e-5, 8000);
    report(
      'L4a',
      [
        {
          id: 'L4',
          metric: 'GPU supersonic: max |M / M_quasi1D - 1| over columns',
          threshold: `< ${L4.maxMachRelativeError.value}`,
          value: worst,
          pass: worst < L4.maxMachRelativeError.value,
        },
        {
          id: 'L4',
          metric: 'GPU choked mass flow vs ideal x Cd',
          threshold: `< ${L4.maxChokedMassFlowRelativeError.value}`,
          value: mErr,
          pass: mErr < L4.maxChokedMassFlowRelativeError.value,
        },
        convergenceRow('L4', conv, floor),
      ],
      { conv, floor },
    );
    // KNOWN-FAIL pin: the f32 residual floor sits above 1e-5 of the first residual
    expect(conv.converged).toBe(false);
    expect(floor.floor).toBeGreaterThan(1e-5);
  });

  it('L5: choking through a blockage-only row', async () => {
    const L5 = THRESHOLDS.L5.values;
    const P0 = 1e5;
    const T0 = 288.15;
    const B_MIN = 0.8;
    const blockage = (x: number): number =>
      Math.abs(x) < 0.1 ? 1 - (1 - B_MIN) * Math.cos((Math.PI * x) / 0.2) ** 2 : 1;
    const ni = 90;
    const nj = 4;
    const mesh = solverMesh(
      singleBlock(rectangle('duct', -0.3, 0.3, 0.5, 0.6, ni, nj), {
        imin: BC.INFLOW,
        imax: BC.OUTFLOW,
        jmin: BC.SLIP_WALL,
        jmax: BC.SLIP_WALL,
      }),
    );
    const options: SolverOptions = {
      gas: caloricallyPerfectGas(GAMMA, RGAS),
      freeStream: { pressure: P0, temperature: T0, velocity: 0 },
      inflowTotal: { p0: P0, t0: T0 },
      outflowPressure: 0.2 * P0,
    };
    const make = () => {
      const r = new ReferenceSolver(mesh, options);
      r.setBlockage(Float64Array.from(mesh.cellX, blockage));
      r.setState((x): PhysicalState => {
        const M = machFromArea(blockage(x) / B_MIN, GAMMA, x > 0);
        const T = T0 * tOverT0(M, GAMMA);
        const p = P0 * pOverP0(M, GAMMA);
        return { rho: p / (RGAS * T), u: M * Math.sqrt(GAMMA * RGAS * T), v: 0, w: 0, p, z: 0 };
      });
      return r;
    };
    const s = make();
    const g = await onGpu(s, options);
    const conv = await converge(g, 1e-5, 8000);
    await back(g, s);
    g.destroy();
    let mdot = 0;
    for (let j = 0; j < nj; j++) mdot += 2 * Math.PI * (s.faceFlux(0, 'i', ni / 2, j)[0] ?? NaN);
    const theory = chokedMassFlow(B_MIN * Math.PI * (0.6 ** 2 - 0.5 ** 2), P0, T0, GAMMA, RGAS);
    const err = Math.abs(mdot / theory - 1);
    const floor = f32Floor(make, 1e-5, 8000);
    report(
      'L5',
      [
        {
          id: 'L5',
          metric: 'GPU mass flow vs b_min A rho* u*',
          threshold: `< ${L5.maxMassFlowRelativeError.value}`,
          value: err,
          pass: err < L5.maxMassFlowRelativeError.value,
        },
        convergenceRow('L5', conv, floor),
      ],
      { conv, floor },
    );
    expect(conv.converged).toBe(false);
    expect(floor.floor).toBeGreaterThan(1e-5);
  });

  it('L6: free vortex and solid-body rotation in a closed annulus', async () => {
    const L6 = THRESHOLDS.L6.values;
    const CP = (GAMMA * RGAS) / (GAMMA - 1);
    const NI = 4;
    const NJ = 64;
    const cases: Record<string, (r: number) => PhysicalState> = {
      'free vortex': (r) => {
        const w = 75 / r;
        const T = 300 - (w * w) / (2 * CP);
        const p = 1e5 * (T / 300) ** (GAMMA / (GAMMA - 1));
        return { rho: p / (RGAS * T), u: 0, v: 0, w, p, z: 0 };
      },
      'solid body': (r) => {
        const w = 150 * r;
        const p = 1e5 * Math.exp((150 * 150 * (r * r - 0.25)) / (2 * RGAS * 300));
        return { rho: p / (RGAS * 300), u: 0, v: 0, w, p, z: 0 };
      },
    };
    const rows: LadderRow[] = [];
    for (const [name, profile] of Object.entries(cases)) {
      const mesh = solverMesh(
        singleBlock(rectangle('annulus', 0, 0.05, 0.5, 1.0, NI, NJ), {
          imin: BC.SLIP_WALL,
          imax: BC.SLIP_WALL,
          jmin: BC.SLIP_WALL,
          jmax: BC.SLIP_WALL,
        }),
      );
      const options: SolverOptions = {
        gas: caloricallyPerfectGas(GAMMA, RGAS),
        freeStream: { pressure: 1e5, temperature: 300, velocity: 0 },
      };
      const s = new ReferenceSolver(mesh, options);
      s.setState((_, r) => profile(r));
      const P0 = Float64Array.from(s.primitives());
      const g = await onGpu(s, options);
      g.iterate(1000);
      await back(g, s);
      g.destroy();
      const P = s.primitives();
      let q = 0;
      let worst = 0;
      let integral = 0;
      let prevR = NaN;
      let prevF = NaN;
      let p0 = NaN;
      for (let j = 0; j < NJ; j++) {
        const c = j * NI + 1;
        const r = mesh.cellR[c] ?? NaN;
        const rho = s.ref.rho + (P[NP * c] ?? NaN);
        const w = (P[NP * c + 3] ?? NaN) / r;
        const p = s.ref.p + (P[NP * c + 4] ?? NaN);
        const f = (rho * w * w) / r;
        q = Math.max(q, 0.5 * rho * w * w);
        if (j === 0) p0 = p;
        else {
          integral += 0.5 * (f + prevF) * (r - prevR);
          worst = Math.max(worst, Math.abs(p - p0 - integral));
        }
        prevR = r;
        prevF = f;
      }
      let drift = 0;
      let scale = 0;
      for (let c = 0; c < mesh.nCells; c++) {
        drift = Math.max(drift, Math.abs((P[NP * c + 3] ?? NaN) - (P0[NP * c + 3] ?? NaN)));
        scale = Math.max(scale, Math.abs(P0[NP * c + 3] ?? NaN));
      }
      rows.push(
        {
          id: 'L6',
          metric: `GPU ${name}: radial-equilibrium error / q`,
          threshold: `< ${L6.maxRadialEquilibriumErrorFractionOfQ.value}`,
          value: worst / q,
          pass: worst / q < L6.maxRadialEquilibriumErrorFractionOfQ.value,
        },
        {
          id: 'L6',
          metric: `GPU ${name}: angular-momentum drift`,
          threshold: `< ${L6.maxAngularMomentumDrift.value}`,
          value: drift / scale,
          pass: drift / scale < L6.maxAngularMomentumDrift.value,
        },
      );
    }
    report('L6', rows);
  });
});
