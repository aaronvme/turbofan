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
  // D2-15: mutants reached only while a test file is collected ("static") would each rerun the
  // whole suite; they are reported, not tested. The cycle tests build the reference engine
  // lazily (src/cycle/engine.ts referenceEngine, tests/unit/cycle/fixtures.ts) so the sizing and
  // the solves are covered per test instead. Reruns reuse reports/stryker-incremental.json.
  ignoreStatic: true,
  incremental: true,
  // the instrumented dry run of the unit suite takes minutes, not the default 5
  dryRunTimeoutMinutes: 60,
  reporters: ['clear-text', 'progress', 'html'],
  htmlReporter: { fileName: 'reports/mutation/index.html' },
  thresholds: { high: 90, low: 80, break: null },
};
