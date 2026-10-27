// L7 (PHYSICS.md 3.3, full size): the inviscid sphere at M 0.01 (and M 0.3 for the iteration
// ratio): Cp fore/aft symmetry, Cd, iterations to converge. Production gas, polar mesh 48 x 48 from
// the 0.5 m sphere to 10 m, converged to 1e-4 of the first residual. Both Mach numbers run with the
// tracking mode's low-Mach preconditioning (D4-10, minMach = the free-stream Mach); the M 0.3 case
// also runs without it, to show the same steady state.
import { THRESHOLDS } from '../../../src/contracts/thresholds';
import { THERMALLY_PERFECT } from '../../../src/flow/reference/gas';
import { ReferenceSolver } from '../../../src/flow/reference/solver';
import { BC, polarMesh, solverMesh } from '../../unit/flow/helpers';
import { converge, geometricGrowth } from '../common';

const RS = 0.5;
const NR = 48;
const NT = 48;

function sphere(mach: number, precondition: boolean) {
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
    ...(precondition ? { lowMachPreconditioning: { minMach: mach } } : {}),
  });
  s.setUniform({ rho: s.ref.rho, u, v: 0, w: 0, p: 101325, z: 0 });
  const conv = converge(s, 1e-4, 20000);
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

export function run() {
  const L7 = THRESHOLDS.L7.values;
  const low = sphere(L7.mach.value, true);
  const ref = sphere(L7.referenceMach.value, true);
  const plain = sphere(L7.referenceMach.value, false);
  const lowPlain = sphere(L7.mach.value, false);
  const ratio = low.conv.iterations / ref.conv.iterations;
  let dCp = 0;
  for (let j = 0; j < NT; j++)
    dCp = Math.max(dCp, Math.abs((ref.cp[j] ?? NaN) - (plain.cp[j] ?? NaN)));
  return {
    id: 'L7',
    rows: [
      {
        id: 'L7',
        metric: 'M 0.01: max |Cp(theta) - Cp(pi - theta)|',
        threshold: `< ${L7.maxCpAsymmetry.value}`,
        value: low.asym,
        pass: low.asym < L7.maxCpAsymmetry.value,
      },
      {
        id: 'L7',
        metric: 'M 0.01: |Cd|',
        threshold: `< ${L7.maxDragCoefficient.value}`,
        value: Math.abs(low.cd),
        pass: Math.abs(low.cd) < L7.maxDragCoefficient.value,
      },
      {
        id: 'L7',
        metric: 'iterations to 1e-4: M 0.01 / M 0.3',
        threshold: `<= ${L7.maxIterationRatio.value}`,
        value: ratio,
        pass: ratio <= L7.maxIterationRatio.value && low.conv.converged && ref.conv.converged,
      },
      {
        id: 'L7',
        metric: 'M 0.01 plain (no preconditioning): max |Cp(theta) - Cp(pi - theta)|',
        threshold: 'reported',
        value: lowPlain.asym,
        pass: 'reported' as const,
      },
      {
        id: 'L7',
        metric: 'M 0.01 plain: |Cd|',
        threshold: 'reported',
        value: Math.abs(lowPlain.cd),
        pass: 'reported' as const,
      },
      {
        id: 'L7',
        metric: `M 0.01 plain: iterations to 1e-4 (converged: ${String(lowPlain.conv.converged)})`,
        threshold: 'reported',
        value: lowPlain.conv.iterations,
        pass: 'reported' as const,
      },
      {
        id: 'L7',
        metric: `M 0.01 preconditioned: iterations (converged: ${String(low.conv.converged)}, finite: ${String(Number.isFinite(low.conv.last))})`,
        threshold: 'reported',
        value: low.conv.iterations,
        pass: 'reported' as const,
      },
      {
        id: 'L7',
        metric: 'M 0.3: max |Cp| difference, preconditioned vs plain (both to 1e-4)',
        threshold: 'reported',
        value: dCp,
        pass: 'reported' as const,
      },
      {
        id: 'L7',
        metric: 'M 0.3 plain: iterations to 1e-4',
        threshold: 'reported',
        value: plain.conv.iterations,
        pass: 'reported' as const,
      },
      {
        id: 'L7',
        metric: 'M 0.3: max |Cp(theta) - Cp(pi - theta)|',
        threshold: 'reported',
        value: ref.asym,
        pass: 'reported' as const,
      },
    ],
    extra: { low, ref, plain, lowPlain },
  };
}
