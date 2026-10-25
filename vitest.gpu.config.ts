import { defineConfig } from 'vitest/config';

// GPU tests: WGSL kernels run in Node through Dawn (`webgpu` package) and are compared
// with the f64 reference solver. Forks: each file gets its own process and Dawn instance
// (dawn.node is native code; a crash takes down only that file). Every test file must destroy
// its device in afterAll.
export default defineConfig({
  test: {
    include: ['tests/gpu/**/*.test.ts'],
    environment: 'node',
    pool: 'forks',
    testTimeout: 120_000,
    passWithNoTests: true,
  },
});
