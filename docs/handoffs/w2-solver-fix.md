w2/solver-fix: DONE. Critic pass 10's two Important findings are fixed (W2I-I1 as D4-65, W2I-I2 as D4-64) and all eight nits are done. bench:p1 is ready for the orchestrator's quiet P1 run; it was not run here (builders never run `bench:*`). (From main 6ed8d81; HEAD = this handoff's commit.)

DONE (IDs -> commits)
- W2I-I1 / D4-65, 5442ebc: the GPU L9a pin in the critic's split form (`tests/gpu-ladder/l7-l9.test.ts`).
  - The case runs once (`l9aCase()`, memoised) and two tests share it.
  - "L9a: Euler work ... (values row)" passes when the value is finite and < 1e-4, every sample of the 2000-iteration window is finite and the spread is finite. A value regression, a NaN, a GPU error (afterEach) or a timeout fails this test.
  - `it.fails("L9a: the value row's D4-45 steadiness (KNOWN-FAIL, D4-57)")` asserts only spread <= tol/10 and cites D4-57/D4-61/D4-65. It shows as expected-fail, and it fails once the convergence work makes the row steady.
  - The report keeps the spread as a 'reported' row.
  - The CPU ladder is unchanged: L9a there is still a visible FAIL, as D4-57 has it.
- W2I-I2 / D4-64 (bench:p1). The pure parts are in `spikes/lib/p1.ts`; `tests/unit/spikes/p1.test.ts` has 16 tests (TDD daa8229, implementation 491868b).
  - (a) `solverValidity` makes a run INVALID when the device reported any GPU error, the state is non-finite after the run, a frame's density residual read back non-finite (`nonFiniteResiduals`), or the production solver is not `running` at the end (`solverStatus`).
    - It is combined with D3-6's `runValidity` for every kind (throughput, worker, p1), so an invalid run gets the usual single rerun.
    - The browser smoke tests assert it valid on both scenes.
  - (b) The scene is wired and checked:
    - `solver-130k-app` is **the measurement of record**. It runs on the new page `spikes/p1` (`appScene.ts` + `main.ts`): `createEngineView` at 1920 x 1080, DPR 1, with its defaults (high geometry, quality profile, three-quarter front preset). The device requests `FLOW_SOLVER_LIMITS`; the smoke test checks it got >= 9. GpuFlowSolver runs on the view's device, and D4-2's budget comes from the view's rolling GPU median.
    - `solver-130k-bench` (the W0 bench scene) and `spike-130k-16x8` (M34's calibration row) run beside it. The three rotate as one group, and each run gets a fresh page (and device).
    - `sceneOf` throws on an unknown scene. BenchApp throws on `scene: 'app'`, and the P1 page throws on anything but production + 'app'. run.ts throws if a result's `scene` differs from the one asked for.
    - Each result records its `scene`.
  - (c) 3c2f1e0, 0f5d9b8: the `spikes/README.md` P1 section and table rows: the official command, the quick and smoke commands, the rows, the INVALID rule and estimated durations.
  - (d) `RESET_ITERATIONS` (100) is kept, now with the D4-63 reason. The per-frame residual check means a divergence between resets still invalidates the run.
  - Flagged edit outside spikes: `EngineViewOptions.preferredLimits` (additive; it passes through to requestSimDevice).
- W2I-N1, 2a27ceb: `haloPrim` takes a cell's own primitives and a ghost's first source from one `cellPrim` call site.
  - Dawn A/B (`tools/perf/dawn.ts ab --refs b450694,WORKTREE --reps 10`): 0 differing state, U^n and texture words, and no non-finite values.
  - Indicative ms/it (loaded machine): 1.286 -> 1.275.
  - test:gpu prints every 12.2 row identical to critic pass 10's digits.
- W2I-N2, c673d65 (TDD) / 7ee6bd8: `onFrameTiming` now runs after the solver's own updates, inside its own try/catch. Its error goes to console.error and the solver is not marked lost. Test: flow-solver.test.ts "W2I-N2 ...", which failed before the fix with status 'lost'.
- W2I-N3, 6f848ef: `compareSides` (tools/perf/solverPerf.ts) counts each side's non-finite state and half-float texture values beside the differing words.
- W2I-N4, b450694: solver-exact's interface, tile-shape and D4-50 packed tests run plain and preconditioned (`it.each(MODES)`), 13 -> 16 tests. The M4 mutant (every ghost's beta from cell 0, `betaSource` returning 0) is killed by the preconditioned interface variant; I checked by hand and restored the file.
- W2I-N5, 6f848ef: engine-stability.test.ts now gives the 1D limit at beta / M_ref 8.9 as about 0.42 (0.469 at 8, 0.234 at 16). The old handoff text is left as it was.
- W2I-N6, 491868b: productionRun drops every `frameAt` key at or below each resolved frame, so untimed frames no longer pile up.
- W2I-N7, 491868b: every three `resolveTimestampsAsync` (both BenchApp paths) gets a `.catch` that records a GPU error of kind 'unknown', which makes the run INVALID.
- W2I-N8, c673d65: the onFrameTiming test calls `skip()` at its start on a device without timestamps (a visible skip, not a vacuous pass). `it.skipIf` cannot be used because the device exists only after beforeAll.
- Nits skipped: none.

THE OFFICIAL P1 COMMANDS (orchestrator; D0-1 checklist in spikes/README.md)
- Official, measurement of record: `npm run bench:p1`. It runs 3 configurations x 3 repetitions, about 13 min (estimated), and writes docs/bench/p1-<date>-<HHMM>-official.json.
  - The summary's verdict line is `P1 of record (D4-64: >= 150 it/s at 130k inside the app's 1080p engine scene): PASS|FAIL at N it/s (...)`, followed by the W0 bench scene's line. An INVALID record row gives no verdict.
  - D4-66 expects a miss at about 120 it/s. A miss counts only after a quiet re-run.
- Quick smoke of the record row (indicative only): `npm run bench:p1 -- --quick --only=solver-130k-app`, about 1.5 min (estimated).
- All three rows, quick: `npm run bench:p1 -- --quick`, about 3 min (estimated).
- The ids changed: `solver-130k` is now `solver-130k-app` / `solver-130k-bench`, so an old `--only=solver-130k` exits with "no configuration matches".

NEXT
1. The orchestrator's quick smoke, then the official run in a quiet window. The harness path in run.ts (`runP1`: page.goto per run, `window.__p1`) has typechecked and linted, and both pages pass their browser smoke tests, but nobody has driven the harness end to end.
2. If P1 misses under D0-1: P1's logged decision (D4-66: the 80k mesh or a half-rate solver, on measured numbers).
3. Still carried from pass 10: solver-perf FINDINGS 2 (the in-scene slowdown after large allocations) and D4-63 (growth from rest).

GOTCHAS
- The app scene's first frame compiles its pipelines and took seconds here. Without `createAppView`'s 10 primed frames, a 3 s warm-up + 2 s run saw no frame in its window ("statistics of an empty sample"). The harness's P1 timeout adds 60 s for the page load (`P1_PAGE_LOAD_MS`).
- The app view logs `pass timer: unclassified pass "" (...)` once: a three pass with no label (the pass timer sees only three's passes, never the solver's raw ones). It is counted under 'other' and in the render total. Worth naming in a look-dev round; I did not chase it.
- `EngineView.stats()` walks the scene to count draws, so the app scene reads it every 15 frames, not every frame.
- Port 5189 (browser tests: `--browser.api.port=5189 --browser.api.strictPort`). Nothing is left running.

GATES @0f5d9b8 (the code is identical to 1ffd066; 0f5d9b8 changes spikes/README.md only). One suite at a time on a RAM-short machine.
- npm run typecheck: clean (14 s). npm run lint (ESLint + Prettier): clean (51 s).
- npm run coverage: 99 files, 1917 passed + 11 expected fail (787 s).
  - Lines 99.60 %, statements 98.70 %, functions 99.65 %, branches 87.76 %.
  - By directory (lines): src/flow/reference 100, thermo 100, cycle 99.58, geometry 99.59, flow/gpu 99.74, spikes/lib 100 (p1.ts: lines 100 %, branches 97.7 %).
- npm run test:mesh: 29 passed.
- npm run test:gpu: 11 files, 64 passed, 0 expected fail (59 s). That is 60 before, plus the N2 test and N4's 3 preconditioned variants.
  - The 12.2 rows equal critic pass 10's digits: C 4.84e-7 / 1.90e-6 / 3.18e-6; C-pre 5.13e-7 / 4.51e-7 / 1.72e-6; C physical 2.34e-7 / 3.23e-7 / 1.58e-5; D 3.66e-8 / 4.56e-8; E-L5 6.19e-6; E-L9a 5.10e-6; S 4.59e-7 / 2.90e-7 / 1.20e-6.
  - Engine stability: 0.998 ... 1.510.
- npm run test:gpu-ladder: 2 files, **12 passed + 1 expected fail** (312 s). The expected fail is the L9a steadiness pin.
  - L1: 2.13e-5 m/s.
  - L7: 0.0131, Cd 0.00159, ratio 1.048.
  - L8: 0.449 %, spread 1.96e-5.
  - L9a: value 3.56e-6 (passing row), spread 1.31e-5 (the pin).
  - L9b: 0.80 %.
  - B: 1.95e-5, residual row 1.27e-11.
  - L4a/L5 stay KNOWN-FAIL with their companions passing.
  - The same result at 5442ebc (the pin alone): 12 + 1 expected fail, 314 s.
  - An earlier full run at 0f5d9b8, at 1.15 GB free, timed out on 12.2 B at its 1800 s test limit. Its rows had printed true at the same values. Run alone it passed in 250 s, and the full rerun above is green. That was memory pressure, not the code.
- npm run test:browser: 9 files, 26 passed (169 s, port 5189, strictPort). That is 25 before, plus the app-scene P1 smoke. Nothing is left listening.
