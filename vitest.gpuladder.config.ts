import { defineConfig } from 'vitest/config';

// The validation ladder on the GPU kernel (`npm run test:gpu-ladder`): Dawn in Node, like
// test:gpu, but slow (L1's 20k iterations on the 130k asset, the 12.2 row B oracle run on the
// 130k mesh), so it is a separate suite that the critic and the orchestrator run at merges.
// Results go to reports/gpu-ladder/*.json.
export default defineConfig({
  test: {
    include: ['tests/gpu-ladder/**/*.test.ts'],
    environment: 'node',
    pool: 'forks',
    testTimeout: 1_800_000,
    hookTimeout: 600_000,
  },
});
