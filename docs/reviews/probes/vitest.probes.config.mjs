// Critic probes. Probe sources are stored as *.probe.ts.txt so that `npm run lint` (typed
// ESLint, Prettier) on main never sees them. To run them, from a checkout of the branch
// under review (with this directory copied in):
//   for f in docs/reviews/probes/*.probe.ts.txt; do cp "$f" "${f%.txt}"; done
//   npx vitest run -c docs/reviews/probes/vitest.probes.config.mjs
// Each probe asserts the behaviour the critic observed for a finding, so a probe that starts
// failing after a fix means that finding is fixed.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['docs/reviews/probes/**/*.probe.ts'],
    environment: 'node',
  },
});
