import { defineConfig } from 'vitest/config';

// D3-13: the test set Stryker runs against the mutated physics cores (stryker.config.mjs). Only
// the suites that import src/thermo, src/cycle or src/flow, WITHOUT the slow whole-engine
// transient and scenario files below: each of their tests runs a CycleModel for 10-75 s of
// simulation (1-35 s of wall time, several times more under instrumentation), which stalled the
// full Stryker run at 957/2283 mutants after 2 h (docs/reviews/LOG.md D3-13). Mutants that only
// those files reach come out as "no coverage": docs/MUTATION.md reports them as "no fast
// coverage", a separate count, never as killed. A new transient test belongs in one of these
// files (or a new one added here); a fast test of the cores belongs in any other file.
export const SLOW_TRANSIENT_TESTS = [
  'tests/unit/cycle/model.test.ts',
  'tests/unit/cycle/modelPaths.test.ts',
  'tests/unit/cycle/surgeRecovery.test.ts',
  // D4-84: the part-power fit ramp at 60 Hz and three bit-identity scenarios, run twice each
  'tests/unit/cycle/heldFrame.test.ts',
];

/**
 * A targeted run (D3-13: per file) may narrow the set further with MUTATION_TESTS, a comma-separated
 * list of test globs, e.g. the thermo suite alone for src/thermo, whose functions sit in every
 * solve's inner loop, so that instrumenting them makes each cycle test tens of times slower.
 * docs/MUTATION.md records the set each score was measured with.
 */
const targeted = process.env.MUTATION_TESTS?.split(',').filter((g) => g.length > 0);

export default defineConfig({
  test: {
    include:
      targeted !== undefined && targeted.length > 0
        ? targeted
        : [
            'tests/unit/thermo/**/*.test.ts',
            'tests/unit/cycle/**/*.test.ts',
            'tests/unit/flow/**/*.test.ts',
          ],
    exclude: SLOW_TRANSIENT_TESTS,
    environment: 'node',
    // Stryker's instrumented runs are several times slower than npm test: a test that builds two
    // models' schedules (about 1 s plain) took over vitest's default 5 s in the dry run
    testTimeout: 120_000,
  },
});
