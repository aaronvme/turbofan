import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { defineConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';

// The GPU flow solver's indicative profile in the installed Chrome (D4-54; tools/perf/chrome.perf.ts).
// Not part of any gate and not a D0-1 timing (the official P1 run is `npm run bench:p1`).
//   PERF_MODE=profile npx vitest run -c vitest.perf.config.ts --browser.api.port=5189
//   PERF_MODE=ab PERF_REFS=c661d5c,WORKTREE npx vitest run -c vitest.perf.config.ts --browser.api.port=5189
// A ref other than WORKTREE has its src/ exported once under test-results/perf-ab/<sha7> (git
// archive), which the page imports.
const refs = (process.env.PERF_REFS ?? 'c661d5c,WORKTREE').split(',').map((side) => {
  // a side is REF or REF@TXxTY (a tile)
  const ref = side.split('@')[0] ?? 'WORKTREE';
  if (ref === 'WORKTREE') return { ref: side, path: '' };
  const sha = execFileSync('git', ['rev-parse', '--short=7', ref], { encoding: 'utf8' }).trim();
  const dir = resolve('test-results', 'perf-ab', sha);
  if (!existsSync(join(dir, 'src'))) {
    mkdirSync(dir, { recursive: true });
    execFileSync('git', ['archive', '-o', join(dir, 'src.tar'), sha, 'src']);
    // relative to cwd: GNU tar reads "C:..." as a remote host
    execFileSync('tar', ['-xf', 'src.tar'], { cwd: dir });
  }
  return { ref: side, path: `/test-results/perf-ab/${sha}` };
});

export default defineConfig({
  define: {
    __PERF_MODE__: JSON.stringify(process.env.PERF_MODE ?? 'profile'),
    __PERF_REFS__: JSON.stringify(refs),
    __PERF_REPS__: JSON.stringify(Number(process.env.PERF_REPS ?? '12')),
  },
  test: {
    include: ['tools/perf/**/*.perf.ts'],
    testTimeout: 900_000,
    browser: {
      enabled: true,
      headless: false,
      provider: playwright({
        launchOptions: { channel: 'chrome', args: ['--enable-unsafe-webgpu'] },
      }),
      instances: [{ browser: 'chromium' }],
    },
  },
});
