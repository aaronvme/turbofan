w2/cycle-hold ROUND 2 (D4-92, critic pass 15 FIX FIRST): W2H-B1 and W2H-I3 fixed and tested; W2H-I2's test written (kills hand mutant B1); N6 and B2's tests NOT written (usage brake). Merged main ca0a3aa first (32654d2). HEAD = the commit that adds this section.

DONE
- 32654d2: `git merge main`; the W2A-N6 conflict resolved as critic pass 15 did (our `model.ts` lines, both tests). Lockfile unchanged.
- 56279fc (TDD): `tests/unit/cycle/heldRecovery.test.ts`, D4-92 (b)'s row before the fix: critic pass 15's scenario on the default model (ISA SLS, take-off at 3 s, Surge 10 s, Flameout 20 s, auto relight, 35 s) at dt 1/120, 1/60, 0.020, 0.0205, 0.021, 0.025, 1/30: every held episode (consecutive held steps x dt) <= 0.5 s, N1 <= the 104 % redline while held. It failed at all seven. In the slow mutation set. `tools/cycle/held-reach.ts` prints the scenario table (any checkout, `--ambient-k`, `--unbounded`).
- 0f9af06, the fix:
  - **(a) the spools are bounded, not frozen.** While held they follow D4-17's held balance but never past n1MaxRpm / n2MaxRpm (`model.ts` substep). Freezing (dN/dt = 0) was tried first and fails: the relight's entry state (N1 32 %, N2 80 %) has no root reachable from the anchor, so frozen it holds 12 s at every frame step (`reports/cycle-hold/scratch/variants.txt`). It is the spools moving that lets D4-13 find a root within 0.15 s. The clamp never engages in the critic's scenario once (c) is in; it bounds the fit (below).
  - **(c) escalation, needed:** a held episode that has lasted `ESCALATE_AFTER_S` = 0.25 s runs D4-13's whole walk (`solveMatched`) once, unbudgeted, in one snapshot; it counts as a walk start. **0.25 s, not D4-92's "past 0.5 s":** escalating at 0.5 s cannot meet a <= 0.5 s bound counted in whole steps. 0.25 s is half the bound. `heldRetryEscalations()` (CycleDiagnostics) counts them. `heldFrame.test.ts`'s P5 rows exempt the escalated step (the exception beside P5, like the sub-idle entry) and pin at most one per episode. Cost: 3100-4400 gas-path evaluations, 50-240 ms in Node, once per episode (fit ramp: 4355 evaluations, 60 ms).
  - **W2H-I3:** a surge starts only from a solved gas path. The detected start skips a held snapshot; an injected surge on a held snapshot stays pending until the solve recovers (bounded by (b)).
- 80fbcae: heldFrame P5 exemption + the escalation pin.
- W2H-I2 (heldRetry.test.ts, last describe): a fakeNewton walk sliced every 3 iterations whose solves never converge ends lost, each solve refused after exactly 25 iterations in all. Hand mutant B1 (a resumed solve gets the full 25) fails it: the walk never ends.

SCENARIO TABLE (tools/cycle/held-reach.ts; longest hold / max N1 while held; before = f2c0779 policy, after = 0f9af06)
| dt | 1/120 | 1/60 | 0.020 | 0.0205 | 0.021 | 0.025 | 1/30 |
|---|---|---|---|---|---|---|---|
| ISA before | 0.54 s / 33.2 % | 0.58 / 32.6 | **7.88 / 198.2** | **4.49 / 217.9** | **4.14 / 205.3** | **4.78 / 168.0** | 1.23 / 31.9 |
| ISA after | 0.26 / 35.4 | 0.27 / 34.6 | 0.26 / 35.2 | 0.35 / 36.2 | 0.36 / 36.2 | 0.28 / 34.6 | 0.27 / 34.7 |
| ISA UNBOUNDED_RETRY (D4-13) | 0.35 / 37.3 | 0.13 / 35.4 | 0.12 / 35.8 | 0.33 / 37.2 | 0.36 / 37.2 | 0.38 / 37.2 | 0.13 / 35.2 |
| ISA+30 before | 0.54 / 36.4 | 0.57 / 35.3 | **throws 25.46 s** | 0.64 / 35.6 | 0.65 / 35.6 | 0.80 / 33.8 | 1.43 / 33.7 |
| ISA+30 after | 0.26 / 39.1 | 0.27 / 36.9 | 0.26 / 37.7 | 0.27 / 39.2 | 0.25 / 39.2 | 0.28 / 37.3 | 0.27 / 37.3 |
Raw: `reports/cycle-hold/reach/before.txt`, `after-isa.txt`, `after-isa30.txt` (also dt 0.05 / 0.1 before).

FINDINGS (need a decision)
1. **The real mechanism of B1 and I3 is a non-physical matched root.** After the long relight hold the spools have integrated the stale (unlit, sub-idle) balance, N1 lags N2, and the matched path tracks a branch where the booster cools the flow: T25 < T2 by up to 61 K at ISA (226.8 K at 27.1 s, where B1's episode starts) and 82 K at ISA+30. `attempt()` accepts it (only the residual and BPR > 1 are checked). At ISA+30 that branch reaches HPC corrected speed 1.22, where `hpcCubic`'s fit is degenerate (psi0 20014, H -10002): a surge started there from a MATCHED point integrates to NaN. So the throw's surge was not from a held point; the held-start guard is right but not the cause. With (c) the trajectory stays physical (UNBOUNDED min T25 - T2 is +2.4 K). Proposed: refuse a root with a compressor temperature rise <= 0 as non-physical (like BPR <= 1), and make `hpcCubic` reject H <= 0 with a named error. Neither is done: both change the matched-path acceptance.
2. **ESCALATE_AFTER_S = 0.25 s instead of 0.5 s** (above). Please confirm, or set it.
3. **W2H-I1 (fit):** not fixed by (a)+(c). Fit ramp at 60 Hz: episode 1 still 3.37 s (its escalation fails), episode 2 (13.05 s) never recovers, but N1 ends at **104.00 %** (was 260-275 %). Stays on the part-power backlog.
4. The (b) bound lives in the test (D4-92), not in P5 / PHYSICS.md. Say if it should be a P5 row.

NEXT
1. B2 (W2H-N4 143:7): a walk in flight past 0.5 s keeps its walkStartedS (small budget so it spans > 25 steps).
2. N6/B4: assert in heldFrame that a held episode's held P3 changes mid-episode (a walk reached its old target).
3. A fast test of the I3 start condition (an injected surge on a held snapshot waits; the clamp at the redline with a double that always loses mid-acceleration). Today only the slow ISA+30 sweep and heldRecovery exercise them.
4. N1-N5: not touched. Fingerprint probe and Stryker not rerun.

GOTCHAS
- The escalation is per held episode and only in `retried()` (not the sub-idle entry, which already walks whole). `UNBOUNDED_RETRY` stays call-for-call D4-13 (an escalation is the same solveMatched).
- Step-level episode length can include one frame on each side: compare with the bound in whole frame steps.

GATES @ the commit adding this section (shared machine, usage brake: partial)
- typecheck clean; ESLint + Prettier clean on src/cycle, tests/unit/cycle, tools/cycle.
- heldRecovery.test.ts 9 passed (@0f9af06); heldFrame.test.ts 11 passed (@80fbcae). heldRetry, gasPathHold, lostSolveCause, surgeDetection, surge: 5 files, 68 passed.
- surgeRecovery (incl. the W1K-I2 fit slam pin), model, modelPaths (the other slow transient files): 3 files, 37 passed (@2ccab8d).
- NOT RUN: full `npm run coverage`, `test:mesh`, the fingerprint probe, Stryker.

---

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

DECIDED (D4-90, main c2dc8da)
1. The bar is P5: 2027bb1 adds it as a flagged contract addition to `src/contracts/thresholds.ts` and a PHYSICS.md §3.4 row. The gate is deterministic, in Node, on the fit ramp at 60 Hz: every step that starts held is ≤ 137 gas-path evaluations, and every step ≤ 217. The browser's held-frame wall time (≤ 16.7 ms) is recorded beside it and counts only in an official D0-1 run, like P1/P4. `heldFrame.test.ts` reads the bar from P5 (plus a check that the retry's own bounds, 120 + 17 and + 80, fit the row), and `thresholds.test.ts` counts P1-P5.
2. The sub-idle entry's cost is accepted for W2 (GOTCHAS); W3's start scenario revisits it with a better entry anchor.
3. The later recovery is accepted (GOTCHAS); the 0.5 s walk interval stays.
4. The spool runaway while held is W2H-I1 (NEXT 1), for the part-power round.

NEXT
1. **W2H-I1 (important, the part-power round, not here):** while held, the spools integrate the held power balance without limit (D4-17). On the fit ramp's second episode (from 13 s, N2 87.5 %) the solve never recovers and N1 reaches 260-275 % by 23 s. A held point must not integrate the spools past their limits on a stale balance. Fix it before the fit ships, together with that never-recovering episode. The default model does not hold on the ramp.
2. app-ui: re-measure the W2F-N5 browser row on this branch's model and record the held-frame wall time beside P5 (official D0-1 run). The cause text can be shown as it is: the budget cause names itself.
3. Read the targeted Stryker run (GATES), and kill its survivors if any are cheap. model.ts's retry wiring is reached fully only by the slow `heldFrame.test.ts`.

GOTCHAS
- The meter is a process-wide count (`gasPathEvaluations`); read it as a difference. A test double that does no gas-path evaluation spends nothing, so give it its own meter (`heldRetry.meter`), as `heldRetry.test.ts` does.
- The budget is per `step()`, not per substep: a test at dt 0.1 (6 snapshots) gets the same retry work per step as the app's 60 Hz frame (2 snapshots), so a held episode lasts longer in sim time at large dt.
- A 60 Hz step has two snapshots, so a held episode can start and end inside one step (lost, then matched). The step-level status undercounts episodes; the warnings count them exactly.
- **Accepted (D4-90), the sub-idle entry is unbudgeted:** a start or relight runs D4-13's whole walk in one matched snapshot, 448-654 gas-path evaluations, 19-59 ms in Node: one hitch per start or relight, over the frame budget. Budgeting it would hold the start for a few frames, against every start test's zero-lost assertion.
- **Accepted (D4-90), recovery comes later:** a walk waits 0.5 s after the last one set out. Fit ramp episode 1 recovers after 3.37 s instead of 2.97 s; the critic's hot-day relight holds 0.62 s instead of 0.08 s (the only fingerprint scenario that changes, and only on its held path).
- `UNBOUNDED_RETRY` reproduces D4-13 call for call, which is the way to compare old and new behaviour (and what the bit-identity tests use).
- `Start-Process` with `cmd /c` and a `.cmd` script worked for the detached runs; the reaper never hit them.

GATES
- @c0ce953 (the code before P5): npm run coverage (detached, own reportsDirectory reports/cycle-hold/coverage): 120 files, 2154 passed + 11 expected fail, exit 0. Statements 98.36 %, branches 87.5 %, functions 99.35 %, lines 99.32 %. src/cycle: lines 99.46 %, branches 92.34 %; heldRetry.ts 100/100, matchedSolve.ts 100/97.56, newton.ts 100/100.
- @c0ce953: npm run typecheck clean; npm run lint clean; npm run test:mesh 2 files, 29 passed; tests/unit/cycle + tests/unit/shell 25 files, 292 passed + 5 expected fail.
- @2027bb1 (P5): typecheck clean; ESLint and Prettier clean on the changed files; tests/unit/contracts/thresholds.test.ts + heldFrame.test.ts + heldRetry.test.ts: 3 files, 118 passed. The full cycle suite was not re-run after P5: the only cycle change is heldFrame.test.ts reading its bounds from P5 (same numbers, the same 60 Hz ramp).
- Stryker (targeted: heldRetry.ts, matchedSolve.ts, newton.ts:86-96, engine.ts:1066-1090 and 1118-1146, model.ts:393-406 and 833-904; tests heldRetry/matchedSolve/numerics/gasPathHold/lostSolveCause; concurrency 3): LAUNCHED DETACHED at handoff (usage 55 %, 2.75 GB free), result NOT READ. Status: reports/cycle-hold/mutate.status; log: reports/cycle-hold/mutate.log; report: reports/mutation/mutation.json.
