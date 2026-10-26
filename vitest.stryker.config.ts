import { defineConfig } from 'vitest/config';

// The test set Stryker runs against the mutated physics cores (stryker.config.mjs `mutate`):
// only the suites that import src/thermo, src/cycle or src/flow. Stryker's vitest runner runs
// the files one after another, so the full unit suite (mesh, geometry, spikes, contracts) made
// the instrumented dry run alone take over 30 minutes for no extra kills: nothing outside these
// directories imports the mutated code (checked with grep, w1/cycle-calib). Add a directory here
// when a new suite starts importing the cores.
export default defineConfig({
  test: {
    include: [
      'tests/unit/thermo/**/*.test.ts',
      'tests/unit/cycle/**/*.test.ts',
      'tests/unit/flow/**/*.test.ts',
    ],
    environment: 'node',
  },
});
