import { defineConfig } from 'vitest/config';

// Unit tests: pure TypeScript in Node. This is the config `npm test`, `npm run coverage`
// and Stryker use. GPU kernels run under vitest.gpu.config.ts, real-Chrome tests under
// vitest.browser.config.ts.
//
// Coverage covers the pure modules. render/, ui/, app/ and the audio worklet are exercised
// by the browser and e2e suites instead, so logic that can be pure must live in a pure
// module (see CLAUDE.md). The spikes' pure helpers (spikes/lib: statistics, protocol, mesh,
// kernel generation) are covered too; their GPU and page code is exercised by test:gpu,
// test:browser and the bench harness.
const CORE = { lines: 90, functions: 90, branches: 85, statements: 90 };

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts', 'src/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts', 'spikes/lib/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/**/*.d.ts',
        'src/render/**',
        'src/ui/**',
        'src/app/**',
        'src/audio/worklet/**',
      ],
      reporter: ['text-summary', 'html', 'json-summary'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 75,
        statements: 80,
        'src/thermo/**': CORE,
        'src/cycle/**': CORE,
        'src/flow/reference/**': CORE,
        'src/flow/coupling/**': CORE,
        'src/geometry/**': CORE,
      },
    },
  },
});
