// Ladder L7-L9 (PHYSICS.md 3.3) on the GPU kernel, with the oracle's current definitions (mirrors
// w2/reference 4553ce2 tests/ladder/cases/l7.ts, l8.ts, l9a.ts, l9b.ts): the same meshes, options
// and metrics, the GPU run from the oracle's f32-rounded state and its state copied back into the
// oracle shell for the metric. Convergence: L7 keeps its pre-registered 1e-4 drop when the GPU
// reaches it; L8 and L9 use D4-38's rule at the f32 floor (the plateau detected, not stated: no
// f32 floor of these cases has been measured; the oracle does not converge them either).
import { afterAll, afterEach, beforeAll, describe, it } from 'vitest';
import { THRESHOLDS } from '../../src/contracts/thresholds';
import type { SimDevice } from '../../src/gpu/device';
import { DEFAULT_CFL_PRECONDITIONED } from '../../src/flow/gpu/params';
import { THERMALLY_PERFECT, caloricallyPerfectGas } from '../../src/flow/reference/gas';
import { ReferenceSolver, type SolverOptions } from '../../src/flow/reference/solver';
import { NP } from '../../src/flow/reference/state';
import { geometricGrowth, graded, type LadderRow } from '../ladder/common';
import { ENGINE_PRECONDITIONING, SINK, sinkCase } from '../ladder/oracle';
import { pOverP0, tOverT0 } from '../ladder/theory';
import { BC, gridBlock, polarMesh, rectangle, singleBlock, solverMesh } from '../unit/flow/helpers';
import { GpuErrorLog, solverDevice } from '../gpu/helpers/solver';
import { back, convergeGpu, onGpu, report, settle, settleRow } from './helpers';

const GAMMA = 1.4;
const RGAS = 287.05287;
const MAX = 20000;

describe('GPU ladder L7-L9', () => {
  const log = new GpuErrorLog();
  let sim: SimDevice;

  beforeAll(async () => {
    sim = await solverDevice(log);
  });

  afterEach(() => {
    log.assertNone('gpu ladder L7-L9');
  });

  afterAll(() => {
    sim.destroy();
  });

  /** One L7 sphere on the GPU (l7.ts sphere(): preconditioned, minMach = M_cut = M). */
  async function sphere(mach: number, n: number) {
    const RS = 0.5;
    const g0 = geometricGrowth((RS * Math.PI) / n, 10 - RS, n);
    const mesh = solverMesh(polarMesh(RS, 10, n, n, g0, BC.SLIP_WALL, BC.FARFIELD));
    const probe = new ReferenceSolver(mesh, {
      gas: THERMALLY_PERFECT,
      freeStream: { pressure: 101325, temperature: 288.15, velocity: 0 },
    });
    const u = mach * probe.ref.c;
    const options: SolverOptions = {
      gas: THERMALLY_PERFECT,
      freeStream: { pressure: 101325, temperature: 288.15, velocity: u },
      lowMachPreconditioning: { minMach: mach, machCut: mach },
      cfl: DEFAULT_CFL_PRECONDITIONED,
    };
    const s = new ReferenceSolver(mesh, options);
    s.setUniform({ rho: s.ref.rho, u, v: 0, w: 0, p: 101325, z: 0 });
    const q = 0.5 * s.ref.rho * u * u;
    const metric = () => {
      const cp: number[] = [];
      let fx = 0;
      for (let j = 0; j < n; j++) {
        const F = s.faceFlux(0, 'i', 0, j);
        const f = j * (n + 1);
        const nx = mesh.iNx[f] ?? NaN;
        const nr = mesh.iNr[f] ?? NaN;
        cp.push(((F[1] ?? NaN) * nx + (F[2] ?? NaN) * nr) / (mesh.iArea[f] ?? NaN) / q);
        fx += F[1] ?? NaN;
      }
      let asym = 0;
      for (let j = 0; j < n; j++)
        asym = Math.max(asym, Math.abs((cp[j] ?? NaN) - (cp[n - 1 - j] ?? NaN)));
      return [asym, Math.abs((-2 * Math.PI * fx) / (q * Math.PI * RS * RS))];
    };
    const g = await onGpu(sim.device, s, options);
    const conv = await convergeGpu(g, 1e-4, MAX);
    let rule = 'the 1e-4 drop';
    let iterations = conv.iterations;
    let converged = conv.converged;
    if (!conv.converged) {
      // fall back to D4-38 at the f32 floor (from the current state), reported as such
      const st = await settle(g, s, metric, { max: MAX });
      rule = `D4-38 after ${conv.iterations} (${settleRow('L7', st, MAX).metric})`;
      iterations = conv.iterations + st.iterations;
      converged = st.converged;
    }
    await back(g, s);
    g.destroy();
    const [asym = NaN, cd = NaN] = metric();
    return { n, mach, asym, cd, iterations, converged, rule, last: conv.last / conv.first };
  }

  it('L7: the M 0.01 sphere (96 x 96, the 24 / 48 / 96 sequence) and the M 0.3 iteration ratio', async () => {
    const L7 = THRESHOLDS.L7.values;
    const M = L7.mach.value;
    const seq = [];
    for (const n of [24, 48, 96]) seq.push(await sphere(M, n));
    const ref = await sphere(L7.referenceMach.value, 96);
    const low = seq[2];
    if (low === undefined) throw new Error('no 96 x 96 run');
    const asym = seq.map((r) => r.asym);
    const monotone = asym.every((a, k) => k === 0 || a < (asym[k - 1] ?? NaN));
    const ratio = low.iterations / ref.iterations;
    const rows: LadderRow[] = [
      {
        id: 'L7',
        metric: `GPU M 0.01 (96 x 96): max |Cp(theta) - Cp(pi - theta)|, the sequence falling (${asym.map((a) => a.toExponential(2)).join(' / ')})`,
        threshold: `< ${L7.maxCpAsymmetry.value}, monotone over 24 / 48 / 96`,
        value: low.asym,
        pass: low.asym < L7.maxCpAsymmetry.value && monotone && seq.every((r) => r.converged),
      },
      {
        id: 'L7',
        metric: 'GPU M 0.01 (96 x 96): |Cd|',
        threshold: `< ${L7.maxDragCoefficient.value}`,
        value: low.cd,
        pass: low.cd < L7.maxDragCoefficient.value,
      },
      {
        id: 'L7',
        metric: `GPU iterations to converge (96 x 96): M 0.01 / M 0.3 (${low.iterations} / ${ref.iterations}; ${low.rule})`,
        threshold: `<= ${L7.maxIterationRatio.value}`,
        value: ratio,
        pass: ratio <= L7.maxIterationRatio.value && low.converged && ref.converged,
      },
      ...seq.map((r) => ({
        id: 'L7',
        metric: `GPU M 0.01 at ${r.n} x ${r.n}: |Cd| (asymmetry ${r.asym.toExponential(2)}, ${r.iterations} its, ${r.rule})`,
        threshold: 'reported',
        value: r.cd,
        pass: 'reported' as const,
      })),
    ];
    report('L7', rows, { seq, ref });
  });

  it('L8: the static point sink (minMach = M_cut = 0.003, CFL 0.8): velocity row', async () => {
    const L8 = THRESHOLDS.L8.values;
    const sc = sinkCase(ENGINE_PRECONDITIONING);
    const { mesh, sinkCells } = sc;
    const options = { ...sc.options, cfl: DEFAULT_CFL_PRECONDITIONED };
    const s = new ReferenceSolver(mesh, options);
    const n = mesh.nCells;
    const kMass = new Float64Array(n);
    const damping = new Float64Array(6 * n);
    for (const c of sinkCells) {
      kMass[c] = SINK.k;
      for (let m = 0; m < 6; m++) damping[6 * c + m] = SINK.k;
    }
    const radius = (c: number) => Math.hypot(mesh.cellX[c] ?? NaN, mesh.cellR[c] ?? NaN);
    const metric = () => {
      const P = s.primitives();
      let mdot = 0;
      for (const c of sinkCells)
        mdot += 2 * Math.PI * SINK.k * (s.ref.rho + (P[NP * c] ?? NaN)) * (mesh.cellVolR[c] ?? NaN);
      let worst = 0;
      for (let c = 0; c < n; c++) {
        const r = radius(c);
        if (r < 0.2 || r > 1.0) continue;
        const rho = s.ref.rho + (P[NP * c] ?? NaN);
        const speed = Math.hypot(P[NP * c + 1] ?? NaN, P[NP * c + 2] ?? NaN);
        worst = Math.max(worst, Math.abs(speed / (mdot / (4 * Math.PI * r * r * rho)) - 1));
      }
      return [worst, mdot]; // worst is 0.4 %: its relative change is well posed
    };
    const g = await onGpu(sim.device, s, options, { cellSource: true });
    g.setCellSource({ kMass, damping });
    const conv = await settle(g, s, metric, { max: MAX });
    await back(g, s);
    g.destroy();
    const [worst = NaN] = metric();
    report(
      'L8',
      [
        {
          id: 'L8',
          metric: 'GPU max | |u| / (mdot / (4 pi r^2 rho)) - 1 |, 0.2-1 m',
          threshold: `< ${L8.maxVelocityRelativeError.value}`,
          value: worst,
          pass: worst < L8.maxVelocityRelativeError.value,
        },
        { ...settleRow('L8', conv, MAX), pass: 'reported' },
      ],
      { conv },
    );
  });

  it('L9a: Euler work of a ducted rotor disk (values row)', async () => {
    const L9 = THRESHOLDS.L9.values;
    const OMEGA = 300;
    const F_THETA = 3e4;
    const ni = 60;
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
      freeStream: { pressure: 1e5, temperature: 288.15, velocity: 0 },
      inflowTotal: { p0: 1e5, t0: 288.15 },
      outflowPressure: 0.95e5,
    };
    const s = new ReferenceSolver(mesh, options);
    let M = 0.3;
    for (let k = 0; k < 60; k++)
      M -= (pOverP0(M, GAMMA) - 0.95) / ((pOverP0(M + 1e-7, GAMMA) - pOverP0(M, GAMMA)) / 1e-7);
    const T = 288.15 * tOverT0(M, GAMMA);
    s.setUniform({
      rho: 0.95e5 / (RGAS * T),
      u: M * Math.sqrt(GAMMA * RGAS * T),
      v: 0,
      w: 0,
      p: 0.95e5,
      z: 0,
    });
    const aRho = new Float64Array(6 * mesh.nCells);
    for (let c = 0; c < mesh.nCells; c++) {
      if (Math.abs(mesh.cellX[c] ?? NaN) >= 0.05) continue;
      aRho[6 * c + 3] = (mesh.cellR[c] ?? NaN) * F_THETA;
      aRho[6 * c + 4] = OMEGA * (mesh.cellR[c] ?? NaN) * F_THETA;
    }
    const plane = (i: number) => {
      let m = 0;
      let h = 0;
      let L = 0;
      for (let j = 0; j < nj; j++) {
        const F = s.faceFlux(0, 'i', i, j);
        m += F[0] ?? NaN;
        L += F[3] ?? NaN;
        h += F[4] ?? NaN;
      }
      return { m, h0: h / m, rw: L / m };
    };
    const metric = () => {
      const up = plane(20);
      const down = plane(40);
      // the quantities, not their 1e-7 difference (whose relative change is rounding noise)
      return [down.h0 - up.h0, OMEGA * (down.rw - up.rw)];
    };
    const g = await onGpu(sim.device, s, options, { cellSource: true });
    g.setCellSource({ aRho });
    const conv = await settle(g, s, metric, { max: MAX, reference: 'peak' });
    await back(g, s);
    g.destroy();
    const [dh0 = NaN, euler = NaN] = metric();
    const err = Math.abs(dh0 - euler) / Math.abs(euler);
    report(
      'L9a',
      [
        {
          id: 'L9',
          metric: 'GPU Euler work: |Delta T0 - Omega Delta(r u_theta)/cp| relative',
          threshold: `< ${L9.maxEulerWorkRelativeError.value}`,
          value: err,
          pass: err < L9.maxEulerWorkRelativeError.value,
        },
        { ...settleRow('L9', conv, MAX), pass: 'reported' },
      ],
      { conv },
    );
  });

  it('L9b: the Rankine-Froude actuator disk (values row)', async () => {
    const L9 = THRESHOLDS.L9.values;
    const RD = 0.5;
    const CT = 0.5;
    const H = 0.04;
    const core = Array.from({ length: 21 }, (_, k) => -0.4 + H * k);
    const up = graded(-0.4, -6, H, 20).reverse();
    const down = graded(0.4, 10, H, 40);
    const xs = [...up.slice(0, -1), ...core, ...down.slice(1)];
    const rCore = Array.from({ length: 16 }, (_, k) => 0.05 * k);
    const rs = [...rCore, ...graded(0.75, 6, 0.05, 25).slice(1)];
    const mesh = solverMesh(
      singleBlock(
        gridBlock('disk', xs.length - 1, rs.length - 1, (i, j) => ({
          x: xs[i] ?? NaN,
          r: rs[j] ?? NaN,
        })),
        { imin: BC.INFLOW, imax: BC.OUTFLOW, jmin: BC.AXIS, jmax: BC.FARFIELD },
      ),
    );
    const probe = new ReferenceSolver(mesh, {
      gas: caloricallyPerfectGas(GAMMA, RGAS),
      freeStream: { pressure: 1e5, temperature: 288.15, velocity: 0 },
    });
    const u = 0.1 * probe.ref.c;
    const dP = CT * 0.5 * probe.ref.rho * u * u;
    const diskCells = Array.from({ length: mesh.nCells }, (_, c) => c).filter(
      (c) => Math.abs(mesh.cellX[c] ?? NaN) < H && (mesh.cellR[c] ?? NaN) < RD,
    );
    const options: SolverOptions = {
      gas: caloricallyPerfectGas(GAMMA, RGAS),
      freeStream: { pressure: 1e5, temperature: 288.15, velocity: u },
    };
    const s = new ReferenceSolver(mesh, options);
    s.setUniform({ rho: s.ref.rho, u, v: 0, w: 0, p: 1e5, z: 0 });
    const rate0 = new Float64Array(6 * mesh.nCells);
    const work = new Float64Array(mesh.nCells);
    for (const c of diskCells) {
      rate0[6 * c + 1] = dP / (2 * H);
      work[c] = 1;
    }
    const a = (-1 + Math.sqrt(1 + CT)) / 2;
    const metric = () => {
      const P = s.primitives();
      let vol = 0;
      let ux = 0;
      for (const c of diskCells) {
        const v = mesh.cellVolR[c] ?? NaN;
        vol += v;
        ux += v * (P[NP * c + 1] ?? NaN);
      }
      return [ux / vol];
    };
    const g = await onGpu(sim.device, s, options, { cellSource: true });
    g.setCellSource({ rate0, work });
    const conv = await settle(g, s, metric, { max: MAX, reference: 'peak' });
    await back(g, s);
    g.destroy();
    const [uDisk = NaN] = metric();
    const err = Math.abs(uDisk / (u * (1 + a)) - 1);
    report(
      'L9b',
      [
        {
          id: 'L9',
          metric: 'GPU actuator disk: disk velocity vs momentum theory u_inf (1 + a)',
          threshold: `< ${L9.maxMomentumTheoryRelativeError.value}`,
          value: err,
          pass: err < L9.maxMomentumTheoryRelativeError.value,
        },
        { ...settleRow('L9', conv, MAX), pass: 'reported' },
      ],
      { conv },
    );
  });
});
