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
    include: ['tests/unit/**/*.test.ts', 'tests/unit/**/*.test.tsx', 'src/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      // tools/mesh is the offline mesher: pure TypeScript, unit-tested like src; its command-line
      // scripts only wire files to the tested modules
      include: ['src/**/*.ts', 'tools/mesh/**/*.ts', 'spikes/lib/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/**/*.d.ts',
        'src/render/**',
        // the look-dev page entry, like src/render (W1G-N5)
        'src/lookdev/**',
        'src/ui/**',
        'src/app/**',
        'src/audio/worklet/**',
        'tools/mesh/scripts/**',
        // the GPU solver's device code (buffers, pipelines, dispatch): it needs a GPUDevice, so
        // test:gpu (Dawn) and test:gpu-ladder exercise it; its pure parts (layout, params, WGSL
        // generation, scheduler, status, resample map) are in src/flow/gpu and covered here
        'src/flow/gpu/device/**',
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
        // the mesh-asset loader and decoder the browser app uses, and the reference solver (w2/reference)
        'src/flow/**': { lines: 90 },
        'src/flow/coupling/**': CORE,
        'src/geometry/**': CORE,
        'tools/mesh/**': { lines: 90 },
        // D5-4: the engine sound's pure modules (the worklet glue, src/audio/worklet, is excluded
        // above: the browser suite runs it)
        'src/audio/**': { lines: 90 },
      },
    },
  },
});
