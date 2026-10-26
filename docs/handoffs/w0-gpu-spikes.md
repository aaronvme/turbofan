w0/gpu-spikes: DONE, fix round for critic pass 2 (FIX FIRST @8e4ffdc); every W0G finding fixed or documented, all gates green (from 8e4ffdc + main b5c2736 merged in; HEAD = the commit of this handoff)

DONE (W0G ID -> commit)
- W0G-I3 -> 175078a: main (b5c2736) merged into the branch once (orchestrator-authorized exception to CLAUDE.md). Both conflicts resolved as unions: `.prettierignore` ignores `docs/bench/` and `docs/mesh/`; the coverage include is `src`, `tools/mesh`, `spikes/lib`.
- W0G-I1 -> f363280 (TDD, RED), 9d7bd60 (GREEN), 9a75238 (comment); D2-13 -> 0a81fe0 (TDD, RED), a0f162f (GREEN).
  - `spikes/lib/validity.ts` (pure, 100% covered, `tests/unit/spikes/validity.test.ts`). Frames are judged against the display interval, never the run's own median.
    - long frame: over 1.5 intervals;
    - throttled: over 2.5 intervals.
  - A run is INVALID if:
    - throttled frames last more than 500 ms in a row;
    - or the page was hidden.
  - D2-13: a median frame over 1.5 intervals is a "below display rate" WARNING, not INVALID (`Validity.warnings`, `BELOW_RATE_MEDIAN_FACTOR`). It is printed next to the numbers and stored per repetition; the config keeps its aggregate.
  - Tests:
    - a synthetic 1 Hz run (the old rule reported 0 long frames: the RED evidence);
    - the official 80k-16x8 shape (60 Hz, then 1 Hz from 52 s) is invalid in all 3 runs;
    - the official main-react60 shape (scattered 2-4-interval frames) stays valid.
  - `RunRecorder` takes the display interval, falls back to the warm-up's median, and refuses to guess with neither. `RunResult` gains `displayIntervalMs`, `throttledMs`, `longestThrottledMs`.
  - The harness (`spikes/bench/run.ts`):
    - measures the display interval with an idle rAF probe on about:blank and refuses to start if the probe is throttled;
    - sends CDP `Page.bringToFront` before every run;
    - reruns an invalid run once;
    - stores and prints an invalid configuration as INVALID with `aggregate: null` and the reasons, instead of numbers. Rejected attempts are kept in `rejectedAttempts`.
  - The 80k-16x8 official row is annotated in `docs/bench/README.md`; the recorded JSON is untouched.
- W0G-I2 -> f363280, 9d7bd60.
  - `spikes/lib/order.ts` (pure, tests in `tests/unit/spikes/order.test.ts`).
    - The protocol's 3 runs are now 3 repetitions of the whole sweep. Compared configurations stay together (the tiles of a grid; main vs worker at a load).
    - The order rotates between repetitions: a Latin square for groups of 3, so each tile takes each in-grid position once, and the grids rotate too. A mulberry32-seeded shuffle picks the base order.
    - `orderEffect` fits the drift of ms/it with sweep position, within each configuration.
  - The harness records `order: { seed, repetitions, effectOnMsPerIt }` and prints the effect. `--seed=N` replays an order; otherwise a random seed is drawn and recorded.
- W0G-I4 -> 1e4535a: `passWithNoTests` removed from `vitest.gpu.config.ts` and `vitest.browser.config.ts`.
- D2-7 -> 1e4535a: `npm run test:mesh` added to `.github/workflows/ci.yml` (it reads only the committed manifest and rebuilds in memory). The GPU and browser suites stay out of CI.
- W0G-B1 -> f375a68.
  - `docs/GPU_FACTS.md` "Measured" now opens with "Official D0-1 runs":
    - M34, throughput: conditions, the valid rows, 80k-16x8 INVALID per D2-8 with the evidence, P1 PASS, 16x8 a default (not a best);
    - M35, worker: the full table and the D2-9 caveats.
  - M29 corrected: the worker drops ~60 frames/min at 60 Hz.
  - M31 corrected: `pageHiddenMs` is blind under Playwright; the new gate is the mitigation.
  - The stale "P1 needs the official run" lines are gone. The broken `spikes/README.md` pointer is fixed: the file now exists, with every spike, the official commands and durations, the JSON layout and the D0-1 checklist. `docs/bench/README.md` indexes and annotates every recorded file.
- W0G-N1 -> 9d7bd60: `conditions.chromeCommandLine` and `chromeFlags` come from chrome://version, so Playwright's ~45 switches are recorded, including the two that hide occlusion. `conditions.display` holds the probe's interval and Hz, and `gpu[].currentRefreshHz` the Windows refresh rate.
- W0G-N2 -> 9d7bd60: `gitDirty` uses `--untracked-files=no`.
- W0G-N3 -> f375a68: M4 and M6 are labelled "observed, no repro".
- W0G-N4 -> b303263: DEFERRED to W2 (the test belongs to the production kernel). M32 records the one-iteration, absolute-tolerance limit and what W2's kernel test should do.

NEXT
1. Critic pass 3 on this branch.
2. The orchestrator updates D0-1's wording on main (D2-12).
3. After the merge, the orchestrator's next official runs (P2/P3, L13) use the fixed harness. Before them, a `--quick` smoke run in a quiet window. No benchmark was run in this round (D0-1); the live harness path is untested end to end. Smoke-checked in a throwaway script:
   - chrome://version `#command_line` (45 switches);
   - CDP `Page.bringToFront` across navigations;
   - the about:blank rAF probe: 16.70 ms.

ORCHESTRATOR DECISIONS (answered: D2-11..D2-13)
- (a) Gate rule: accepted (D2-11). The critic's "fps < 0.95 x refresh" would have invalidated the valid official main-react60 row (56.6 fps); the gate is the sustained-throttle rule (more than 500 ms in a row of frames over 2.5 intervals) or a hidden page.
- (b) Protocol shape: accepted (D2-12). Each of the 3 runs has its own 10 s warm-up, interleaved across the sweep; official durations ~33 min (throughput) and ~23 min (worker). The orchestrator updates D0-1's wording on main.
- (c) Median rule: a WARNING, not INVALID (D2-13), done in 0a81fe0/a0f162f. A 30 Hz throttle now shows only as that warning (see the D0-1 checklist in `spikes/README.md`).

GOTCHAS
- Node runs `spikes/bench/run.ts` with type stripping. Every `spikes/lib` module it imports at runtime (benchRun, validity, order, stats, protocol, system) must use `.ts` extensions in its relative imports.
- If rAF stopped entirely (rather than dropping to ~1 Hz), `page.evaluate` would wait forever: there is no per-run timeout. Under Playwright's switches rAF throttles rather than stops, so this was not seen.
- An invalid configuration has `aggregate: null` in new JSON files. Readers must check `validity.valid` and never fall back to the per-repetition numbers.
- Ports: harness default 5181 (+1 for COOP/COEP). This round started no dev server; no Chrome or server is left running.

GATES @a0f162f (npm test, lint, typecheck rerun after D2-13; the commits after it are docs only)
- npm test: 1107 passed (48 files)
- npm run lint: clean (eslint --max-warnings 0 + prettier)
- npm run typecheck: clean
- The suites below ran @9a75238; D2-13 touched only `spikes/lib/validity.ts` (unit-tested), the harness and docs
- npm run coverage: lines 99.5%, statements 98.55%, branches 87.42%, functions 99.39%; all thresholds pass. New modules: validity.ts 100% on all four metrics, order.ts lines 100% / branches 87.5%, benchRun.ts lines 100% / branches 92.2%.
- npm run test:mesh: 29 passed (2 files)
- npm run test:gpu: 15 passed (4 files)
- npm run test:browser: 14 passed (2 files)
