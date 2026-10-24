// Mutation testing for the physics cores. The critic runs `npm run mutate` on every
// pass that touches these paths; surviving mutants are findings.
/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  testRunner: 'vitest',
  vitest: { configFile: 'vitest.config.ts' },
  mutate: [
    'src/thermo/**/*.ts',
    'src/cycle/**/*.ts',
    'src/flow/reference/**/*.ts',
    'src/flow/coupling/**/*.ts',
    '!src/**/*.test.ts',
  ],
  coverageAnalysis: 'perTest',
  reporters: ['clear-text', 'progress', 'html'],
  htmlReporter: { fileName: 'reports/mutation/index.html' },
  thresholds: { high: 90, low: 80, break: null },
};
