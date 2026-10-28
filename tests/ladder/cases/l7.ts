// L7 (PHYSICS.md 3.3, full size): the inviscid sphere at M 0.01 (and M 0.3 for the iteration
// ratio): Cp fore/aft symmetry, Cd, iterations to converge. Production gas, polar mesh from the
// 0.5 m sphere to 10 m, converged to 1e-4 of the first residual. Both Mach numbers run with the
// tracking mode's low-Mach preconditioning (D4-10, minMach = the free-stream Mach); the M 0.3 case
// also runs without it, to show the same steady state. D4-26: the pass rows run at 96 x 96, and the
// M 0.01 refinement sequence 24 / 48 / 96 must show the asymmetry falling (D4-9's rule); the plain
// rows (reported) stay at 48 x 48.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { THRESHOLDS } from '../../../src/contracts/thresholds';
import { THERMALLY_PERFECT } from '../../../src/flow/reference/gas';
import { ReferenceSolver } from '../../../src/flow/reference/solver';
import { BC, polarMesh, solverMesh } from '../../unit/flow/helpers';
import { converge, geometricGrowth } from '../common';

const RS = 0.5;
/** The pass rows' grid (D4-26) and the refinement sequence. */
const N_PASS = 96;
const SEQUENCE = [24, 48, 96] as const;
/** The sphere runs' iteration cap (PHYSICS.md 3.3 L7: at most 20000 iterations). */
export const SPHERE_CAP = 20000;
/**
 * W2R-N12: the time budget per cell-iteration of a sphere child, so that a hung child fails in about
 * its run's time instead of the ladder's 30 minutes. Measured 4.8 us per cell-iteration (96 x 96,
 * plain Node, under a ladder's load, 2026-10-27); the budget is 8 us, 1.7x that, plus a minute.
 */
const US_PER_CELL_ITERATION = 8;

/** The child's timeout for an n x n sphere run to the full cap. */
export function sphereTimeoutMs(n: number): number {
  return 60_000 + Math.ceil((SPHERE_CAP * n * n * US_PER_CELL_ITERATION) / 1000);
}

/** One sphere run; machCut is the D4-20 M_cut (default: minMach = the free-stream Mach). */
export function sphere(
  mach: number,
  precondition: boolean,
  machCut = mach,
  tol = 1e-4,
  cap = SPHERE_CAP,
  n = N_PASS,
) {
  const NR = n;
  const NT = n;
  // square wall cells: the first radial spacing equals the polar spacing at the wall
  const g = geometricGrowth((RS * Math.PI) / NT, 10 - RS, NR);
  const mesh = solverMesh(polarMesh(RS, 10, NR, NT, g, BC.SLIP_WALL, BC.FARFIELD));
  const probe = new ReferenceSolver(mesh, {
    gas: THERMALLY_PERFECT,
    freeStream: { pressure: 101325, temperature: 288.15, velocity: 0 },
  });
  const u = mach * probe.ref.c;
  const s = new ReferenceSolver(mesh, {
    gas: THERMALLY_PERFECT,
    freeStream: { pressure: 101325, temperature: 288.15, velocity: u },
    ...(precondition ? { lowMachPreconditioning: { minMach: mach, machCut } } : {}),
  });
  s.setUniform({ rho: s.ref.rho, u, v: 0, w: 0, p: 101325, z: 0 });
  const conv = converge(s, tol, cap);
  // wall faces: i-faces i = 0, j = 0 (theta = 0, the rear) .. NT - 1 (the front)
  const q = 0.5 * s.ref.rho * u * u;
  const cp: number[] = [];
  let fx = 0;
  for (let j = 0; j < NT; j++) {
    const F = s.faceFlux(0, 'i', 0, j);
    const nx = s.mesh.iNx[j * (NR + 1)] ?? NaN;
    const nr = s.mesh.iNr[j * (NR + 1)] ?? NaN;
    const area = s.mesh.iArea[j * (NR + 1)] ?? NaN;
    cp.push(((F[1] ?? NaN) * nx + (F[2] ?? NaN) * nr) / area / q);
    fx += F[1] ?? NaN;
  }
  let asym = 0;
  for (let j = 0; j < NT; j++)
    asym = Math.max(asym, Math.abs((cp[j] ?? NaN) - (cp[NT - 1 - j] ?? NaN)));
  // the force of the gas on the sphere is minus the momentum flux into the gas, per radian x 2 pi
  const cd = (-2 * Math.PI * fx) / (q * Math.PI * RS * RS);
  return { conv, asym, cd, cpFront: cp[NT - 1] ?? NaN, cpSide: cp[NT / 2] ?? NaN, cp };
}

type Sphere = ReturnType<typeof sphere>;
const exec = promisify(execFile);

/** One sphere run in its own Node process (tests/ladder/sphereRun.ts), so the seven run at once. */
async function sphereChild(mach: number, precondition: boolean, n: number): Promise<Sphere> {
  const { stdout } = await exec(
    process.execPath,
    [
      '--import',
      './tools/mesh/ts-resolve.mjs',
      'tests/ladder/sphereRun.ts',
      String(mach),
      precondition ? '1' : '0',
      String(n),
    ],
    { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: sphereTimeoutMs(n) },
  );
  const line = stdout.split('\n').find((l) => l.startsWith('@@SPHERE@@'));
  if (line === undefined) throw new Error(`sphere ${mach} ${precondition} ${n}: no result`);
  return JSON.parse(line.slice('@@SPHERE@@'.length)) as Sphere;
}

export async function run() {
  const L7 = THRESHOLDS.L7.values;
  const M = L7.mach.value;
  const M3 = L7.referenceMach.value;
  const [s24, s48, s96, ref, ref48, plain, lowPlain] = await Promise.all([
    sphereChild(M, true, 24),
    sphereChild(M, true, 48),
    sphereChild(M, true, N_PASS),
    sphereChild(M3, true, N_PASS),
    // the reported plain rows and the preconditioned-vs-plain M 0.3 comparison, at 48 x 48
    sphereChild(M3, true, 48),
    sphereChild(M3, false, 48),
    sphereChild(M, false, 48),
  ]);
  const seq = [s24, s48, s96].map((r, k) => ({ n: SEQUENCE[k] ?? NaN, ...r }));
  const low = s96;
  const ratio = low.conv.iterations / ref.conv.iterations;
  let dCp = 0;
  for (let j = 0; j < 48; j++)
    dCp = Math.max(dCp, Math.abs((ref48.cp[j] ?? NaN) - (plain.cp[j] ?? NaN)));
  const asym = seq.map((r) => r.asym);
  const monotone = asym.every((a, k) => k === 0 || a < (asym[k - 1] ?? NaN));
  const converged = seq.every((r) => r.conv.converged);
  const order = asym.slice(1).map((a, k) => Math.log2((asym[k] ?? NaN) / a));
  const sequenceRows = seq.flatMap((r) => [
    {
      id: 'L7',
      metric: `M 0.01 at ${r.n} x ${r.n}: max |Cp(theta) - Cp(pi - theta)| (converged: ${String(r.conv.converged)}, ${r.conv.iterations} its)`,
      threshold: 'reported (D4-26 sequence)',
      value: r.asym,
      pass: 'reported' as const,
    },
    {
      id: 'L7',
      metric: `M 0.01 at ${r.n} x ${r.n}: |Cd|`,
      threshold: 'reported (D4-26 sequence)',
      value: Math.abs(r.cd),
      pass: 'reported' as const,
    },
  ]);
  return {
    id: 'L7',
    rows: [
      {
        id: 'L7',
        metric: `M 0.01 (${N_PASS} x ${N_PASS}): max |Cp(theta) - Cp(pi - theta)|, the sequence falling`,
        threshold: `< ${L7.maxCpAsymmetry.value}, monotone over ${SEQUENCE.join(' / ')}`,
        value: low.asym,
        pass: low.asym < L7.maxCpAsymmetry.value && monotone && converged,
      },
      {
        id: 'L7',
        metric: `M 0.01 (${N_PASS} x ${N_PASS}): |Cd|`,
        threshold: `< ${L7.maxDragCoefficient.value}`,
        value: Math.abs(low.cd),
        // W2R-N9: an unconverged run must not pass Cd either
        pass: Math.abs(low.cd) < L7.maxDragCoefficient.value && low.conv.converged,
      },
      {
        id: 'L7',
        metric: `iterations to 1e-4 (${N_PASS} x ${N_PASS}): M 0.01 / M 0.3`,
        threshold: `<= ${L7.maxIterationRatio.value}`,
        value: ratio,
        pass: ratio <= L7.maxIterationRatio.value && low.conv.converged && ref.conv.converged,
      },
      ...sequenceRows,
      {
        id: 'L7',
        metric: `observed order of the asymmetry, ${SEQUENCE.join(' -> ')}: ${order.map((o) => o.toFixed(2)).join(', ')} (the last shown)`,
        threshold: 'reported (D4-26)',
        value: order[order.length - 1] ?? NaN,
        pass: 'reported' as const,
      },
      {
        id: 'L7',
        metric: 'M 0.01 plain (no preconditioning, 48 x 48): max |Cp(theta) - Cp(pi - theta)|',
        threshold: 'reported',
        value: lowPlain.asym,
        pass: 'reported' as const,
      },
      {
        id: 'L7',
        metric: 'M 0.01 plain (48 x 48): |Cd|',
        threshold: 'reported',
        value: Math.abs(lowPlain.cd),
        pass: 'reported' as const,
      },
      {
        id: 'L7',
        metric: `M 0.01 plain (48 x 48): iterations to 1e-4 (converged: ${String(lowPlain.conv.converged)})`,
        threshold: 'reported',
        value: lowPlain.conv.iterations,
        pass: 'reported' as const,
      },
      {
        id: 'L7',
        metric: 'M 0.3 (48 x 48): max |Cp| difference, preconditioned vs plain (both to 1e-4)',
        threshold: 'reported',
        value: dCp,
        pass: 'reported' as const,
      },
      {
        id: 'L7',
        metric: 'M 0.3 plain (48 x 48): iterations to 1e-4',
        threshold: 'reported',
        value: plain.conv.iterations,
        pass: 'reported' as const,
      },
      {
        id: 'L7',
        metric: `M 0.3 (${N_PASS} x ${N_PASS}): max |Cp(theta) - Cp(pi - theta)|`,
        threshold: 'reported',
        value: ref.asym,
        pass: 'reported' as const,
      },
    ],
    extra: { sequence: seq, ref, ref48, plain, lowPlain, order },
  };
}
