w2/cycle-hold: DONE. D4-84, a held gas path stays inside the frame budget: the held retry is bounded per step (a work budget, resumed walks) and the walk runs at most once per 0.5 s; (c) not done, as decided. (from main 42cf8e9; HEAD = the commit that adds this file)

DONE
- 1f61cab: `tools/cycle/held-cost.ts`, the W2F-N5 cross-check in Node: the W1K-I2 part-power fit at ground idle, the lever ramped to take-off over 1 s from 3 s (the browser row's case), stepped at 60 Hz. It prints per-step wall time, solver calls, gas-path evaluations and the held episodes, and runs on any checkout (it reads only the public model API).
- fb7340c (TDD), c0ce953: D4-84.
  - **Design.**
    - `src/cycle/newton.ts`: an optional `stop`, asked before each iteration, ends the solve there (`stopped: true`). Between iterations Newton's state is only x, so a solve resumed from the returned x with the iterations left takes the same iterates.
    - `src/cycle/engine.ts`: `solveGasPath(..., lit, control?)` takes a `SolveControl` (`stop`, `maxIterations`) and reports `stopped`. `gasPathEvaluations()` counts every gas-path evaluation. That count is the budget's meter: deterministic, and close to the CPU time, since an evaluation is the unit of a solve's work (6 finite differences plus the line search per Newton iteration).
    - `src/cycle/matchedSolve.ts`: the walk is now resumable. `startWalk` fixes its target when it sets out; `advanceWalk` runs it until it is solved, lost, or `stop` fires ('paused'), and a solve the stop interrupts keeps its iterate and the iterations it has used. A walk spread over several steps therefore makes the same solves, to the bit, as the walk run at once. `solveDirect` is the direct try. `solveMatched` is direct + the whole walk, the same calls as before.
    - `src/cycle/heldRetry.ts` (new, pure), `retryMatched`, per snapshot:
      - (a) the direct solve is tried every step;
      - a walk sets out at most once per `WALK_INTERVAL_S` = 0.5 s of sim time (start to start), and a walk in flight resumes;
      - (b) both spend the step's budget, `HELD_RETRY_BUDGET` = 120 gas-path evaluations. While a walk is in flight the direct solve gets `DIRECT_SHARE` = half of it, so the walk always moves on;
      - a walk that converges on its own (older) target, while the state has moved on, gives the model a fresher anchor and held point, and the state stays held;
      - a direct solve that converges is not charged while the model is not holding (the matched path). Once it holds, everything is charged, so a step that starts held costs at most the budget plus `RETRY_OVERSHOOT` = 17 evaluations (the Newton iteration in flight and the point).
    - `src/cycle/model.ts`: `snapshot()` calls `retryMatched`. The budget is per `step()`, which the app calls once a frame. `CycleModelOptions.heldRetry` sets `budget`, `walkIntervalS` and `meter` (a test passes its own count, a host could pass a clock), and the constructor rejects a budget ≤ 0 and a negative interval. `UNBOUNDED_RETRY` is D4-13's retry. **The entry from the sub-idle model** (a start, a relight; `entering`) keeps D4-13's whole walk in one snapshot, unbudgeted: it is not a held retry, and the zero-lost start tests need it (see NEEDS A DECISION 2).
    - **The default, justified:** 120 evaluations is 1.5× the largest converged direct solve in the whole cycle suite: 77 evaluations, 10 Newton iterations. I counted it with a scratch instrumented run of tests/unit/cycle and tests/unit/shell, not committed. Most are 1-3 iterations. So the budget never cuts the matched path. A held step then costs 120-137 evaluations: about 3-5 ms at the 0.025-0.034 ms per evaluation measured in Node (a microbenchmark 0.020-0.025; the ramp's step time over its evaluations 0.034; 0.055 under the heaviest load). That sits beside the 1.3-1.6 ms matched step, and with the worker's ~5 ms of render submit the frame is about 8-10 ms, inside 16.7 ms.
  - **Visible, never silent:** `solve: 'held'`, the lost count (each held snapshot), `lostSolveCause()` and the once-per-episode warning all stay. A direct solve the budget cuts, when nothing else said why, gives the cause `not converged within the held-retry budget (residual X after k iterations)`. A snapshot with no attempt left in the step keeps the episode's last cause.
  - **W2A-N6 fixed:** the sub-idle path ends a held episode (`holding = false`) and drops its walk, so a relight that holds again logs again (`lostSolveCause.test.ts`).
  - **Tests:**
    - `heldRetry.test.ts` (fast, 20 tests): Newton's stop and exact resume; the solve control and the counter; the start's walk sliced at 5/23/60 evaluations ends on the unsliced root bit for bit, through the same points; the policy on a Newton double (the matched direct not charged, charged while holding, never cut up to the budget, a failing direct cut at the budget, DIRECT_SHARE, a paused solve resuming, `reached`, a lost walk, the 0.5 s interval with the direct every step); the unbounded policy is `solveMatched`, call for call; the budgeted start walk on a fixed state converges on the unbudgeted root bit for bit.
    - `heldFrame.test.ts` (slow, ~40 s; added to the slow mutation set), on the fit ramp at 60 Hz:
      - **the bar row:** every step that starts held is ≤ budget + overshoot (137 evaluations), and every step is ≤ that plus one converged direct solve (80);
      - the hold is visible (the warnings sit between the step-level episode bounds and are far fewer than the lost solves);
      - the recovering solve is the root an unbudgeted solve finds from the same warm start (bit for bit) and from a perturbed start (within 1e-6);
      - the matched path is bit-identical to `UNBOUNDED_RETRY` on a slam/chop, a flameout relight and a start from shutdown (zero lost);
      - the option checks.
    - `gasPathHold.test.ts`: the "9 calls per lost solve" pin of D4-13's policy now runs with `UNBOUNDED_RETRY` (the non-physical test too). The default policy's test asserts that the held step spends ≤ budget + overshoot. **This is the one existing assertion D4-84 changes** (it pinned the retry that D4-84 replaces).
  - **Docs:** the PHYSICS.md ledger row "Gas path above the sub-idle switch", the ENGINE_FACTS W1K-I2 note, the `surgeRecovery.test.ts` comment (88 kN now), and MUTATION.md (heldFrame in the slow set).

MEASURED (Node, `tools/cycle/held-cost.ts --seconds=20`, the shared machine with the reference-9 solver and app-ui running: wall times indicative; evaluations exact)

| Fit ramp at 60 Hz | before (42cf8e9) | after (c0ce953) |
|---|---|---|
| held step, N1 ≤ 105 % (the engine still in its envelope) | median 439 ms, p95 554, max 643 (n 204) | median 2.39 ms, p95 2.97, max 4.45 (n 230) |
| held step, all (includes the runaway, below) | median 4.1 ms, p95 498, max 643 | median 0.07 ms, p95 2.60, max 4.45 |
| held step evaluations | median 62, p95 9173, max 10804 | median 2, p95 133, max 136 |
| held step solver calls | median 18, p95 34, max 54 | median 2, p95 3, max 10 |
| matched step | median 1.59 ms, max 77 ms (1273 evaluations: a walk recovering in one snapshot) | median 1.34 ms, max 5.77 ms (95 evaluations) |
| lost solves | 1584 | 1594 |
| episode 1 (8.68 s, N2 73.9 %) | 177 held steps, recovered after 2.97 s | 201 held steps, recovered after 3.37 s |
| episode 2 | from 12.72 s (N2 88.8 %), never recovers | from 13.05 s (N2 87.5 %), never recovers |

- The browser numbers (D4-84: 411-602 ms held, 8-31 fps) were not re-measured: that is app-ui's suite (NEXT 1).
- **Bit-identity (`docs/reviews/probes/w2f-fingerprint.probe.ts.txt`, 42cf8e9 against this branch):** slam-chop, c12, start and part-lever give the same hashes (677bc456…, c34d477c…, dd082a71…, 0b0723fc…). hot-surge-flameout differs (63915b7e… → c9b5371f…): it holds after its relight (17 lost solves on 42cf8e9 already). The difference starts at the first held snapshot that the old whole walk recovered, at 21.12 s; now that state is held until 21.66 s.
- **The W1K-I2 slam (dt 0.02):** the same held stretch, 5.70-8.56 s, then a new one from 9.78 s (N2 87.7 %). Lost solves 281 → 306, peak thrust 94.3 → 88.3 kN (still no 95 %, so the pin holds). The worst step went from 1187 ms to 25 ms (the first step's warm-up).
- **The entry from the sub-idle model at 60 Hz (not budgeted):** a start from shutdown costs 448 evaluations, 18.6 ms, at its entry (29.55 s); a flameout relight costs 654 evaluations, 58.5 ms (8.18 s). Both are matched frames, once per start or relight.

NEEDS AN ORCHESTRATOR DECISION
1. The bar's home. D4-84's "held frame ≤ 16.7 ms on the same ramp" has no PHYSICS.md row. Here it is gated in Node in the budget's unit (`heldFrame.test.ts`), and the browser row (`tests/browser/app.test.tsx` W2F-N5, app-ui's file) still only records. Should it become a §3.4 row (P5, mirrored in thresholds.ts: a flagged contract edit) and a gate in app-ui's browser suite? I did not touch `src/contracts` or the app.
2. The sub-idle entry is over the frame budget once per start or relight: 448-654 evaluations, 19-59 ms in Node. It is a matched frame, so D4-84 does not cover it, and budgeting it would hold the start for a few frames, which every start test's zero-lost assertion forbids. Options:
   - (i) accept it, a once-per-start hitch;
   - (ii) slice the entry walk too, under a new non-held status (for example `entering`), which is a contract change;
   - (iii) a better entry anchor than the last matched point (W2F-N2's area).
3. Recovery comes later: a walk waits 0.5 s after the last one set out. On the fit ramp, episode 1 recovers after 3.37 s instead of 2.97 s. On the critic's hot-day relight, the state holds 0.62 s instead of 0.08 s. Accept it as (a)'s trade, or shorten WALK_INTERVAL_S: the budget bounds the frame either way. With the interval at 0 the walks run back to back, still inside the budget.
4. Seen, not mine (D4-17): while held, the spools run on the held power balance without limit. The fit ramp's second episode never recovers, and N1 reaches 260-275 % by 23 s. The app would show that. Freeze the spools while held, or let the FADEC's N1/N2 limiters act on a held state?

NEXT
1. app-ui: re-measure the W2F-N5 browser row on this branch's model, and gate it at 16.7 ms if decision 1 says so. Show the cause text as it is, since the budget cause names itself.
2. If decision 2 picks (ii): an `entering` status and the entry walk sliced like the held one, TDD.
3. Read the coverage result, then run the targeted Stryker run (GATES). model.ts's retry wiring is reached fully only by the slow `heldFrame.test.ts`.

GOTCHAS
- The meter is a process-wide count (`gasPathEvaluations`); read it as a difference. A test double that does no gas-path evaluation spends nothing, so give it its own meter (`heldRetry.meter`), as `heldRetry.test.ts` does.
- The budget is per `step()`, not per substep: a test at dt 0.1 (6 snapshots) gets the same retry work per step as the app's 60 Hz frame (2 snapshots), so a held episode lasts longer in sim time at large dt.
- A 60 Hz step has two snapshots, so a held episode can start and end inside one step (lost, then matched). The step-level status undercounts episodes; the warnings count them exactly.
- `UNBOUNDED_RETRY` reproduces D4-13 call for call, which is the way to compare old and new behaviour (and what the bit-identity tests use).
- `Start-Process` with `cmd /c` and a `.cmd` script worked for the detached runs; the reaper never hit them.

GATES @c0ce953 (the code; this file adds only the handoff)
- npm run typecheck: clean
- npm run lint (ESLint + Prettier): clean
- npm run test:mesh: 2 files, 29 passed
- tests/unit/cycle + tests/unit/shell (detached, before the doc touch-ups): 25 files, 292 passed + 5 expected fail
- npm run coverage (detached, --coverage.reportsDirectory=reports/cycle-hold/coverage, PID 40304, log reports/cycle-hold/gates.log): STILL RUNNING at handoff, result not read. Re-run or read the log before the merge
- Stryker on the changed functions: NOT RUN (the script is ready: reports/cycle-hold/mutate.cmd, the fast suites heldRetry/matchedSolve/numerics/gasPathHold/lostSolveCause, concurrency 3)
