// Santa-loop reviewer B probes (w2/solver @81e9508): Dawn in Node, like vitest.gpu.config.ts.
// From a checkout of w2/solver (with public/mesh and this directory present):
//   for f in docs/reviews/probes/santa-solver-B-*.probe.ts.txt; do cp "$f" "${f%.txt}"; done
//   npx vitest run -c docs/reviews/probes/santa-solver-B-vitest.config.mjs
// The diagnostics (santa-solver-B-diag*.probe.ts, no assertions) run only with SANTA_B_DIAG=1.
import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['docs/reviews/probes/santa-solver-B-*.probe.ts'],
    exclude: [
      ...configDefaults.exclude,
      ...(process.env.SANTA_B_DIAG === '1' ? [] : ['docs/reviews/probes/*-diag*.probe.ts']),
    ],
    environment: 'node',
    pool: 'forks',
    testTimeout: 300_000,
  },
});
