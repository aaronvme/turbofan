import { defineConfig } from 'vitest/config';

// The flow-solver validation ladder L1-L9 on the CPU (`npm run test:ladder`): the f64 reference
// solver (src/flow/reference) against PHYSICS.md 3.3's thresholds, in the reduced "CPU variants"
// that section defines. One file per case so the cases run in parallel worker processes. The
// full-size checks of record (L1 at 20k iterations on the 130k mesh, and the GPU kernel) are
// w2/solver's. Results go to reports/ladder/*.json.
export default defineConfig({
  test: {
    include: ['tests/ladder/**/*.test.ts'],
    environment: 'node',
    pool: 'forks',
    testTimeout: 900_000,
    hookTimeout: 900_000,
  },
});
