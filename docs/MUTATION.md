# Mutation scores (D3-13)

Stryker 10.1.1, vitest runner, `coverageAnalysis: perTest`, `ignoreStatic: true`, concurrency 6, the runner's default `related` test selection. The base test set is `vitest.mutation.config.ts`: the fast core suites without the slow whole-engine transient files (`model.test.ts`, `modelPaths.test.ts`, `surgeRecovery.test.ts`, and since D4-84 `heldFrame.test.ts`). A targeted run narrows it with `MUTATION_TESTS` (comma-separated globs; the config reads it), and each row below names its set. A score measured on a narrow set is a lower bound for the full fast set. Every run was in the foreground and under 10 min.

Columns:
- **killed**: a test failed.
- **survived**: covered by a test of the set, nothing failed.
- **no cov**: no test in the set reaches the mutant. For `model.ts` these are the paths only the slow transients run. Never counted as killed.
- **timeout**: counted as detected by Stryker, listed separately (contention and runaway loops inflate it).
- **static**: reached only while a file is collected, ignored (D2-15).
- **score** = (killed + timeout) / (killed + survived + no cov + timeout).

## Current scores (2026-10-27, w2/followups after the kills below)

| File | Test set | Mutants | Killed | Survived | No cov | Timeout | Static | Score | Before |
|---|---|---|---|---|---|---|---|---|---|
| src/cycle/fadec.ts (new) | fadec.test.ts | 113 | 109 | 2 | 0 | 0 | 2 | 98.20 % | - |
| src/cycle/matchedSolve.ts (new) | matchedSolve.test.ts, gasPathHold.test.ts | 46 | 44 | 0 | 0 | 1 | 1 | 100.00 % | - |
| src/cycle/surgeDetection.ts | surgeDetection.test.ts | 36 | 34 | 1 | 0 | 0 | 1 | 97.14 % | 88.57 % |
| src/cycle/greitzer.ts | greitzer.test.ts, surge.test.ts | 134 | 121 | 10 | 0 | 3 | 0 | 92.54 % | 88.81 % |
| src/cycle/surgeSystem.ts | surge.test.ts | 220 | 198 | 16 | 0 | 5 | 1 | 92.69 % | 63.93 % |
| src/thermo/gas.ts | gas.test.ts | 214 | 147 | 6 | 1 | 0 | 60 | 95.45 % | 88.96 % |
| src/thermo/species.ts | gas.test.ts | 51 | 0 | 0 | 0 | 0 | 51 | n/a (static tables only) | n/a |
| src/cycle/componentMaps.ts | maps.test.ts | 261 | 222 | 32 | 0 | 5 | 2 | 87.64 % | 81.85 % |
| src/cycle/newton.ts | numerics.test.ts | 146 | 132 | 10 | 0 | 2 | 2 | 93.06 % | 86.11 % |
| src/cycle/at.ts | numerics.test.ts, offdesign.test.ts | 5 | 5 | 0 | 0 | 0 | 0 | 100.00 % | (not re-run) |
| src/cycle/engine.ts | engine.test.ts, offdesign.test.ts | 639 | 457 | 108 | 9 | 2 | 63 | 79.69 % | 75.69 % |
| src/cycle/model.ts | gasPathHold.test.ts, surge.test.ts (two line ranges, 1-640 and 641-1039) | 954 | 269 | 349 | 187 | 145 | 4 | 43.58 % (54.26 % of covered) | 9.36 % |
| src/cycle/boundedLeastSquares.ts | base set | 314 | 206 | 69 | 9 | 28 | 2 | 75.00 % | (not re-run) |
| src/cycle/partPower.ts | base set | 187 | 72 | 40 | 0 | 12 | 63 | 67.74 % | (not re-run) |
| src/cycle/partPowerFit.ts | - | 0 | - | - | - | - | - | constants only | - |

"Before" is the previous measurement: the 2026-10-26 round at 4d4ce90 on the base set (surgeDetection, greitzer, surgeSystem, model, boundedLeastSquares, partPower), or the orchestrator's pause runs below (gas, componentMaps, newton, at, engine), on the same targeted sets as now. model.ts's "before" was 1041 mutants on the base set; it now has 954 (the pure FADEC laws moved out to fadec.ts, the D4-13 hold came in).

## The orchestrator's pause runs (2026-10-27 00:03-00:05, w2/followups 5a0cf72)

Job `pause_jobs_w2.ps1`, results in the job tmp `pause_w2/`. The six runs shared one incremental file (`reports/stryker-incremental.json`), so each run's report carries the results of the runs before it, and its "All files" summary line is the running total over all files run so far, not the score of the file just run: the at.ts run's 85.05 % is at + componentMaps + newton + gas, the newton run's 84.92 % is newton + componentMaps + gas. The true per-file scores, from each file's own rows in the JSON reports:

| File | Test set | Mutants | Killed | Survived | No cov | Timeout | Static | Score |
|---|---|---|---|---|---|---|---|---|
| src/thermo/species.ts | gas.test.ts | 51 | 0 | 0 | 0 | 0 | 51 | n/a: all static (tables built at load) |
| src/thermo/gas.ts | gas.test.ts | 214 | 137 | 16 | 1 | 0 | 60 | 88.96 % |
| src/cycle/componentMaps.ts | maps.test.ts | 261 | 207 | 47 | 0 | 5 | 2 | 81.85 % |
| src/cycle/newton.ts | numerics.test.ts | 146 | 122 | 20 | 0 | 2 | 2 | 86.11 % |
| src/cycle/at.ts | numerics.test.ts, offdesign.test.ts | 5 | 5 | 0 | 0 | 0 | 0 | 100.00 % |
| src/cycle/engine.ts | engine.test.ts, offdesign.test.ts | 639 | 429 | 131 | 9 | 7 | 63 | 75.69 % |

The targeted sets made these runs fast (gas 12 s, engine 83 s): with the base set, gas.ts did not finish in 10 min, since its functions sit in every solve's inner loop.

## What this round killed (w2/followups, after 5a0cf72)

- surgeDetection: the error text, the rate threshold at exactly 10/s (8 to 3 Pa in 1/16 s), the drop threshold at exactly 0.1.
- greitzer: maxPhi and minPhi bracket the equilibrium; the period against crossings counted in the test; the perturbation's sign.
- surgeSystem: surge.test.ts built the compression system at describe level, then (first fix) in a memoized `lazy()`. Both map its mutants to one test only (at collection, or the first test that calls it), so it is now built inside each test, unmemoized. Independent checks of `ductVariables`, `hpcCubic` (H, the shut-off head, rms) and `engineGreitzerParams`; the malformed-definition guards.
- gas: the inversions' range check at both ends and the inversion's name in the message; FAR at the stoichiometric tolerance.
- newton: a single short row; the line search on atan(x) from 2 (the full Newton step diverges); the step cap under and over; a partly non-finite trial residual; the smallest-step fallback runs the whole budget.
- componentMaps: hermite1 against hand-worked values on uneven nodes, both extrapolations; hermite2 in the last interval of a long table; surgeMargin above design speed (the speed bracket grows) and its (1 + m) PR identity; the turbine's sub-minimum-speed efficiency factor; a design efficiency of exactly 1.
- engine: vbvScheduleFraction, vsvOffsetRad, Sutherland and the Reynolds index, correctedN2Percent, the nozzle below ambient, the point's map positions.
- model.ts: the pure FADEC laws moved to fadec.ts with fast tests (the lever schedule, the loop law, the selector, the schedule clamp, the accel factor, the recovery's acceleration limit and bias cap, the EGT limit and its timer). A hash of 4200 transient states is unchanged by the move. The D4-13 fast tests (gasPathHold.test.ts) run the model for a few seconds and reach much of the rest.

## Survivors left, with the reason

- **fadec.ts (2), equivalent.** `el < SURGE_HOLD_S` vs `<=`: at the boundary the ramp starts at the decel schedule, the same value. `/ SURGE_RESTORE_S` vs `*`: the constant is 1.
- **surgeDetection.ts (1), equivalent.** The `lastPa === null` guard: without it the first sample gives a drop of -Infinity, which is never integrated.
- **greitzer.ts (10), equivalent.** The equilibrium bisection's bracket start (`2 * w` vs `2 / w`) and its `>`/`>=` boundaries and iteration count; `psi >= 0` at 0 and `slope <= 0` at 0, where both branches agree; the crossing-time offset `(i - 1)`, which cancels in the period; `i >= n / 2`, `>=` vs `>` on the crossing and `nc > 2`, which differ only by a sample or on an exact equality.
- **surgeSystem.ts (16).** Equivalent: the annulus lookup at a component's end (both neighbours agree there), the panel count `(b + a)` (more panels, the same integral within the tests' 1e-4), the defensive `rc > rh` guard on the reference flowpath, and the stallRlineForLoss bisection's boundaries. Unreached: `hpcCubic`'s unclamped least squares (`num`, `psi0`): the shut-off bound binds on every HPC speed line of the reference map tested (0.7, 0.8, design), so a synthetic map would be needed.
- **gas.ts (6 survived, 1 no cov), equivalent.** The NASA segment switch at exactly 1000 K (the polynomials are continuous there); `phi === 0` (the mixture of air with zero products is air); the inversion's secant guess and its loop bound and tolerance (Newton converges in a few steps from any guess in range). The no-cov mutant is the non-convergence throw, unreachable (`c8 ignore`).
- **componentMaps.ts (32), equivalent.** surgeMargin's speed bracket and bisection loop bounds (it converges on the same speed); `<` vs `<=` at exact equalities where both branches agree (lowerIndex, the hermite1 ends, the compressor and turbine low-speed and low-PR edges); the turbine's `pressureRatio <= 1` guard (Stodola gives zero flow at PR 1 anyway); hermite2's sub-table and its edge branch, which agree with the full-table extrapolation by construction (the end slopes are the same).
- **newton.ts (10), equivalent.** `>`/`>=` at exact equalities (the pivot choice, the singular threshold, the tolerance, the step cap, the line-search acceptance, converged); the solution array created empty (filled by assignment); the forward-difference step size (Newton converges either way); the row initialiser (`["Stryker was here"]` is overwritten element by element); the loop guard replaced by true (every tested problem leaves through a break or convergence).
- **engine.ts (108 survived, 9 no cov).** The part-power loss terms (36) and the part-speed ramp (5) are checked by partPower.test.ts, c10.test.ts and c11.test.ts, which are not in this targeted set. The sizing's design-point evaluation and the map scale factors (32) and the sizing loop (7) are absorbed by the sizing itself, which re-solves the design point to its targets, and the residual normalisations (3, plus 4 in the steady specs) only scale a residual whose root does not move. The nozzle's sonic-throat Newton (9): it converges either way, and the general path gives the same zero-flow state at pt = p_amb. tsfc's `fn > 0` (2): no matched point has a non-positive thrust. groundIdle's path specs (4): the IDLE_PATH continuation reaches the same idle from a different start. The no-cov mutants are `solveGasPath` (8), which only the transient's tests call (matchedSolve, gasPathHold), and one error string.
- **model.ts (349 survived, 187 no cov).** By region (survived / no cov): the start sequence 126 / 43, the sub-idle similarity model 55 / 0, compose 36 / 17, the surge episode 31 / 66, the shaft dynamics and start supervision 32 / 8, the fuel loops 30 / 1, surgeAt 0 / 22, the recovery 2 / 16, reset and the schedules 15 / 9, the rest 24 / 5. The fast tests run the model only in the D4-13 cases (a slam's first 2 s, a dry crank, an idle flameout and a fuel cutoff); the start, the surge and the recovery are checked by the slow transient files. The 145 timeouts are mostly mutants that make a run loop or the continuation walk longer. The next cheap step: factor the sub-idle model (a pure function of the idle anchor) and the start sequence's state machine out of the class, as was done for the FADEC laws.
- **boundedLeastSquares.ts, partPower.ts:** not re-run this round; see the 2026-10-26 notes in the git history of this file (shape guards and fallbacks the callers never reach; the forward-difference direction at the upper bound; partPower's residual normalisations).

## cycle-hold round 3 (2026-10-31, w2/cycle-hold be61d28): the held retry's targeted run

`reports/cycle-hold/mutate.cmd`, concurrency 3, the branch's ranges over rounds 1-3: `heldRetry.ts`, `matchedSolve.ts`, `newton.ts:86-96`, `engine.ts:1066-1090,1118-1146`, `surgeSystem.ts:137-178` (hpcCubic and its D4-94 guard), and `model.ts:395-419,540-548,722-752,867-947`. Test set (`MUTATION_TESTS`): heldRetry, heldModel, matchedSolve, numerics, gasPathHold, lostSolveCause and surge. The slow heldFrame and heldRecovery stay out (`vitest.mutation.config.ts` excludes them, and with per-test coverage nearly every mutant here would run them, hours at concurrency 3). The hand mutants in `reports/cycle-hold/mutants3.sh` stand in for them: 15 of 16 are killed by the fast set, and B3 (the sub-idle entry through the budgeted retry) is killed by heldFrame.

| File | Mutants | Killed | Timeout | Survived | No cov | Score |
|---|---|---|---|---|---|---|
| heldRetry.ts | 97 | 94 | 0 | 3 | 0 | 96.9 % |
| matchedSolve.ts | 157 | 148 | 2 | 7 | 0 | 95.5 % |
| surgeSystem.ts (137-178) | 48 | 45 | 0 | 3 | 0 | 93.8 % |
| newton.ts (86-96) | 23 | 21 | 0 | 2 | 0 | 91.3 % |
| engine.ts (two ranges) | 14 | 12 | 0 | 2 | 0 | 85.7 % |
| model.ts (four ranges) | 205 | 147 | 0 | 50 | 8 | 71.7 % |
| **total (544; 3 ignored)** | | **467** | **2** | **67** | **8** | **86.2 %** (87.5 % of covered) |

Before the round's survivor tests (be61d28) the same run gave 445 / 2 / 84 / 13, 82.2 %.

The survivors:
- **Equivalent, or a boundary of measure zero (17):**
  - `heldRetry.ts` 156 `<=`: a direct solve started with its cap already reached stops before its first iteration. 172 (both): `advanceWalk`'s own check before a solve pauses at once.
  - `matchedSolve.ts` 138, 201 (3) and 203 (2): a control of `{ stop: undefined }` is no control, and `maxIterations` of 25 − 0 is the default. 251: a default `why` of `{}` reads the same as `{ cause: null }`.
  - `surgeSystem.ts` 170 `>=`: H exactly 0.
  - `engine.ts` 1130/1134, `newton.ts` 89/95: as in round 1.
- **Outside the round's code, inside its line ranges:**
  - `surgeSystem.ts` 158/165: the least-squares lines, which no fast test reaches off the shut-off bound.
  - `model.ts` 732-742: the shaft rates and the start supervision, about 35 survivors, which only the slow start tests reach.
  - `model.ts` 545/746/748/749/751: the pre-existing parts of the surge-start conditions (the N2 boundary, a surge already running, the forced flag).
  - `model.ts` 869/871: the recovery's VBV and the sub-idle switch.
- **The round's own code:**
  - `model.ts` 722 (the clamp also on matched snapshots): equivalent on every tested path, since the FADEC keeps a matched N1 under the redline.
  - 876: B3, killed by heldFrame.
  - 881: equivalent.
  - 893: the fallback cause, reached only by a reset's first lost snapshot with no attempt left.
  - 918 `>`: the 0.25 s boundary.
