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
];

export default defineConfig({
  test: {
    include: [
      'tests/unit/thermo/**/*.test.ts',
      'tests/unit/cycle/**/*.test.ts',
      'tests/unit/flow/**/*.test.ts',
    ],
    exclude: SLOW_TRANSIENT_TESTS,
    environment: 'node',
  },
});
