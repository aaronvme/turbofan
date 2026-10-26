// D3-11: fits the part-power mechanisms (src/cycle/partPower.ts) to C10 and C11 together by
// bounded least squares and writes src/cycle/partPowerFit.ts. Deterministic: a fixed start (the
// middle of every bound), forward differences with a fixed step, no randomness.
//
//   node --import ./tools/mesh/ts-resolve.mjs tools/cycle/fit-part-power.ts [--dry-run] [--relax]
//
// --dry-run prints the fit without writing the file. --relax (diagnostic, never written) refits
// with every bound the fit sits on opened by its own width, to show which bound binds and how far
// the fit would go without it.

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ENGINE_DEFINITION } from '../../src/engine/definition';
import { CYCLE_CALIBRATION, sizeEngine } from '../../src/cycle/engine';
import { boundedLeastSquares, type BoundedLsqResult } from '../../src/cycle/boundedLeastSquares';
import {
  PART_POWER_LOWER,
  PART_POWER_PARAMETERS,
  PART_POWER_START,
  PART_POWER_UPPER,
  evaluatePartPower,
  partPowerCalibration,
  partPowerResiduals,
  withCalibration,
} from '../../src/cycle/partPower';

const args = new Set(process.argv.slice(2));
const log = (line: string): void => {
  process.stdout.write(`${line}\n`);
};
const engine = sizeEngine(CYCLE_CALIBRATION, ENGINE_DEFINITION);
const residuals = (x: readonly number[]) => partPowerResiduals(engine, x);

function report(label: string, r: BoundedLsqResult, lo: readonly number[], hi: readonly number[]) {
  log(
    `\n${label}: cost ${r.cost.toFixed(4)}, ${r.iterations} iterations, converged ${r.converged}`,
  );
  PART_POWER_PARAMETERS.forEach((p, i) => {
    const a = r.active[i];
    const where = a === -1 ? 'ON LOWER BOUND' : a === 1 ? 'ON UPPER BOUND' : '';
    log(
      `  ${p.id.padEnd(26)} ${(r.x[i] ?? NaN).toPrecision(6).padStart(10)} ${p.unit.padEnd(4)} [${lo[i]}, ${hi[i]}]  dcost/du ${(r.gradient[i] ?? NaN).toExponential(2)} ${where}`,
    );
  });
  const cal = partPowerCalibration(engine, r.x);
  const ev = evaluatePartPower(withCalibration(engine, cal));
  for (const p of ev.points) {
    const pass = Math.abs(p.residual) <= 1 ? 'pass' : 'FAIL';
    log(
      `  ${p.id.padEnd(28)} model ${p.model.toFixed(4).padStart(10)} target ${p.target.toFixed(4).padStart(10)} ${p.unit.padEnd(4)} residual ${p.residual.toFixed(3).padStart(7)} ${pass}`,
    );
  }
}

// enough iterations for the narrow valley along the booster-map guard
const progress = {
  maxIterations: 150,
  costTolerance: 1e-7,
  onStep: (k: number, cost: number, x: readonly number[]) => {
    log(`  step ${k}: cost ${cost.toFixed(5)} x ${x.map((v) => v.toPrecision(4)).join(' ')}`);
  },
};
const fit = boundedLeastSquares(
  residuals,
  PART_POWER_START,
  PART_POWER_LOWER,
  PART_POWER_UPPER,
  progress,
);
report('D3-11 fit inside the plausible bounds', fit, PART_POWER_LOWER, PART_POWER_UPPER);

// Hard limits of the diagnostics (not plausible ranges): the VBV must stay shut at the design
// point (100 % N2c), which the sizing assumes; the others only keep the scan finite.
const HARD_LOWER = [0, 0, 0, 0, 61, 80, -0.35, -0.35, 0, 0, 0.2];
const HARD_UPPER = [0.15, 0.15, 0.5, 0.3, 94, 99.5, 0.35, 0.35, 0.5, 0.1, 0.5];

if (args.has('--relax')) {
  const width = PART_POWER_UPPER.map((h, i) => h - (PART_POWER_LOWER[i] ?? 0));
  const lo = PART_POWER_LOWER.map((l, i) =>
    fit.active[i] === -1 ? Math.max(HARD_LOWER[i] ?? l, l - (width[i] ?? 0)) : l,
  );
  const hi = PART_POWER_UPPER.map((h, i) =>
    fit.active[i] === 1 ? Math.min(HARD_UPPER[i] ?? h, h + (width[i] ?? 0)) : h,
  );
  const relaxed = boundedLeastSquares(residuals, fit.x, lo, hi, progress);
  report('DIAGNOSTIC ONLY: the binding bounds opened by their own width', relaxed, lo, hi);

  // one lever at a time, the others at the fit: how far past its bound it must go for each
  // failing C11 point to reach the -5 % edge (residual -1), up to the hard limit
  const failing = fit.residuals
    .map((r, k) => ({ r, k }))
    .filter(({ r, k }) => k < 3 && Math.abs(r) > 1);
  for (const { k } of failing) {
    for (let i = 0; i < PART_POWER_PARAMETERS.length; i++) {
      const a = fit.active[i];
      if (a === 0) continue;
      const limit = a === 1 ? (HARD_UPPER[i] ?? 0) : (HARD_LOWER[i] ?? 0);
      const value = (t: number) => {
        const x = [...fit.x];
        x[i] = (fit.x[i] ?? 0) + t * (limit - (fit.x[i] ?? 0));
        return { x: x[i] ?? NaN, r: residuals(x) };
      };
      const id = PART_POWER_PARAMETERS[i]?.id ?? '';
      const bound = PART_POWER_PARAMETERS[i]?.[a === 1 ? 'upper' : 'lower'];
      // march out in tenths of the way to the hard limit; bisect the first crossing
      let prev = 0;
      let found = false;
      let last = { x: fit.x[i] ?? NaN, r: fit.residuals[k] ?? NaN };
      for (let t = 0.1; t <= 1 + 1e-9; t += 0.1) {
        const v = value(t);
        const rk = v.r?.[k];
        if (rk === undefined) {
          log(
            `  point ${k}: ${id} (bound ${bound}): the solves fail beyond ${last.x.toPrecision(4)}, residual there ${last.r.toFixed(3)}`,
          );
          found = true;
          break;
        }
        if (rk >= -1) {
          let [t0, t1] = [prev, t];
          for (let it = 0; it < 12; it++) {
            const tm = 0.5 * (t0 + t1);
            const rm = value(tm).r?.[k];
            if (rm === undefined || rm < -1) t0 = tm;
            else t1 = tm;
          }
          log(
            `  point ${k}: ${id} (bound ${bound}) must reach ${value(t1).x.toPrecision(4)} for the C11 edge`,
          );
          found = true;
          break;
        }
        prev = t;
        last = { x: v.x, r: rk };
      }
      if (!found) {
        log(
          `  point ${k}: ${id} (bound ${bound}): at the hard limit ${limit} the residual is still ${last.r.toFixed(3)}`,
        );
      }
    }
  }
}

if (!args.has('--dry-run')) {
  const v = (i: number) => {
    const x = fit.x[i];
    if (x === undefined || !Number.isFinite(x)) throw new Error(`fit value ${i} is not finite`);
    return Number(x.toPrecision(8));
  };
  const lines = [...PART_POWER_PARAMETERS.map((p, i) => `  ${p.id}: ${v(i)},`)].join('\n');
  const out = `// GENERATED by tools/cycle/fit-part-power.ts (D3-11). Do not edit: rerun the script.
// The bounded least-squares fit of the part-power mechanisms (src/cycle/partPower.ts) to C10 and
// C11 together; tests/unit/cycle/partPower.test.ts checks that these are its bounded optimum.
// Fit cost ${fit.cost.toFixed(6)} after ${fit.iterations} iterations (converged: ${fit.converged}).

export const PART_POWER_FIT = {
${lines}
} as const;
`;
  const path = fileURLToPath(new URL('../../src/cycle/partPowerFit.ts', import.meta.url));
  writeFileSync(path, out);
  log(`\nwrote ${path}`);
}
