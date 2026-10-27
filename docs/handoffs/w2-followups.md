w2/followups: STOP-CLEAN at 82 % usage. Done: W1K-I1, W1K-I2, D3-17 / C12 (passes) and the bench harness (D3-6, N6, N7). D3-13 partly done: the mutation config is in, and 7 of 13 core files are scored; the hot files are not run yet. (from main e1ca8a2; HEAD = the commit that adds this file)

DONE
- 2a2f145 W1K-I1 / W1K-I2:
  - Both KNOWN FAIL marker sets now read "KNOWN FAIL (D3-15: accepted part-power gap, PHYSICS.md ledger)". The stale fit comments are fixed (engine.ts, partPower.ts), and so are the facts rows (0.284, D3-15).
  - `tests/unit/cycle/surgeRecovery.test.ts` pins the rejected fit's 33.73(a) slam: it surges, then makes no 95 % thrust.
  - **New finding, with the true cause:**
    - The surges at 1.5 s recover on their own.
    - The hang starts at about 4 s, at N2 about 74 % with the VBV fully open: `solveGasPath` stops converging, and `model.ts snapshot()` silently falls back to the sub-idle similarity model far above sub-idle. Fuel and P3 then chatter between the two models.
    - So it is a lost gas-path solution, not a locked stall (ENGINE_FACTS "What binds", PHYSICS ledger).
- fe2e294: C12 pre-registered in PHYSICS.md §3.2 and thresholds.ts before any code, with the doc-sync test and a rationale per clause. Sources [GE74], [GE91], [UTC77], [UTC93], [RR06] and [ARP1420] are in ENGINE_FACTS; no CFM56-7B surge logic is public.
- 98683d9 (TDD) the C12 tests:
  - the `hpcSurgeMarginLoss` hook (Delta PRS lowers the reported margin and moves the Greitzer peak down the speed line);
  - the detector tests;
  - 8 tests red on the W1 oracle fuel cut.
- 8998462 green (`surgeDetection.ts`, `model.ts`):
  - Detection uses only the decay of the sensed P3.
  - Recovery: fuel to the decel schedule, VBVs open below their closing speed, igniters on, a 0.5 s hold, a 1 s ramp to a biased accel schedule (0.8 of the excess, multiplied again by 0.8 on a repeat surge).
  - The W1 oracle cut (25 % at every onset, which read the true margin) is gone.
  - C12 result: one surge at 0.74 s, detected in the same 20 ms step; 95 % thrust at 8.4 s; back at idle N1 20.26 / N2 60.99.
  - Every existing transient test is unchanged and green.
- 235258b (TDD) / 29c7e24 the harness:
  - D3-6: INVALID only on the occlusion signature (rAF intervals of 500 ms or more, consecutive ones spanning at least 1 s), a hidden page, or a window blur. A slow load is a warning with its numbers.
  - N6: a per-run timeout (warm-up + run + 30 s, then INVALID "stalled" and a page reload), and the warm-up fallback held to the probe's 24-500 Hz check.
  - N7: `timestamp-ring.test.ts` compares medians at 8x the work.
  - The README is updated. The `--quick` smoke command is in spikes/README.
- 4d4ce90 D3-13:
  - `vitest.mutation.config.ts` leaves out the slow files; a guard test pins the list.
  - The C9 tests moved to `greitzer.test.ts` and the slow surge transient to `surgeRecovery.test.ts`.
  - Stryker uses the config, with a JSON report.
  - Then `MUTATION_TESTS` for targeted sets, and the scores in `docs/MUTATION.md`.

NEXT
1. D3-13: run the hot files with `MUTATION_TESTS` or line ranges, each under 10 min (MUTATION.md "Not run yet"). Kill the listed cheap survivors (surgeDetection 3, greitzer 4, the surgeSystem lazy-fixture fix). Factor model.ts's pure FADEC pieces out for fast tests.
2. Orchestrator decisions:
   - (a) the silent sub-idle fallback above sub-idle in `model.ts snapshot()`: flag it or fail it;
   - (b) whether the recovery's VBV rule (shut above vbvClosedAboveN2c, because opening them at high power drives the booster off its map) is acceptable;
   - (c) the idle-floor loop undershoots N2 to 57.4 % (0.4 points above the sub-idle switch) after a takeoff chop and takes about 25 s to settle. It is not new, and C12 passes.
3. Bench harness: a `--quick --only=130k-16x8` smoke run in a quiet window before the next official run. It was not run here: another builder was active.

GOTCHAS
- Stryker's vitest runner overrides `testNamePattern`, so slow tests can be excluded by file only.
- Mutants in code a test builds at describe level never reach that test's per-test coverage (surge.test.ts); use `lazy()`.
- A Bash timeout moves a command to the background rather than killing it: use the `timeout 560` wrapper and stop Stryker's child node processes by command line (scratch script C:\Users\Aaron\scratch\w2f\mut.sh).
- The tools' heredocs: long `python - <<EOF` blocks broke the shell twice; write scripts to files instead.
- `src/contracts/thresholds.ts` was edited only to add C12, as the task asked. Nothing else in src/contracts was touched. No new dependencies. No dev server or Chrome was started (port 5187 unused). Nothing is left running.

GATES @4d4ce90 (plus the docs commit)
- npm test: 1639 passed, 5 expected fail (C10 x3, C11 x2), 77 files.
- npm run lint: clean. npm run typecheck: clean.
- coverage: lines 99.52 %, statements 98.59 %, branches 88.12 %, functions 99.59 %; src/cycle lines 99.48 %, src/thermo 100 %.
- npm run test:mesh: 29 passed. npm run test:gpu: 15 passed (@29c7e24; GPU code unchanged since). test:browser not run (no render/ui/app change).
