w2/followups: DONE (round 2). D4-13 (lost-solve flag) green, D4-14/D4-15 in the ledger, D3-13 mutation round done (true pause scores, cheap kills, FADEC laws factored out of model.ts). Round 1 (W1K-I1/I2, D3-17/C12, bench harness) is unchanged. (from main e1ca8a2; round 2 from 5a0cf72; HEAD = the commit that adds this file)

DONE (round 2)
- 0302e83, 81666c3: the orchestrator's D3-6 harness smoke run (`--quick --only=130k-16x8`: valid, 240 it/s) committed byte for byte and annotated in docs/bench/README.md.
- D4-13, a lost gas-path solve is flagged, never patched over:
  - 2403afc (TDD), cbe666f, a90987a (TDD), 1105b36 green.
  - **Contract (flag for the critic): the only `src/contracts` change** is `src/contracts/cycle.ts`: `CycleState.gasPathSolve: { status: 'matched' | 'subIdle' | 'held'; lostSolves }` (`GAS_PATH_SOLVE_STATUSES`), with the `validateCycleState` checks. The mock and the contract fixture fill it.
  - **Design** (`model.ts snapshot()`): the sub-idle model runs only unlit, unfuelled or below 57 % N2. Above the switch the matched solve is warm-started on the last converged point, then retried by continuation from it (`src/cycle/matchedSolve.ts`: the step halves on a failure down to 1/256 and doubles after a success, at most 64 solves; a throw or a BPR <= 1 root counts as a failure). If that fails too, the state holds the last converged gas path (status `held`; `lostSolves` counts since the reset). The spools then run on the held power balance (not physics), and every substep retries.
  - The zero-lost checks found real losses: the start, the hot start and the flameout relight lost 435/46/136 solves at N2 57-61 %. Cause: at the reset's idle unknowns below about 60.6 % N2 one residual stops depending on the unknowns (a map edge), so the Jacobian is singular. The continuation fixes all three.
  - Every transient test now asserts zero lost solves (`expectNoLostSolves`, in the run helpers of model/modelPaths/surgeRecovery).
  - The fast hold tests (`gasPathHold.test.ts`) use the `gasPathSolver` test hook.
  - The W1K-I2 pin now names the cause: the fit loses the gas path from 5.7 s to 8.5 s (N2 74-88 %, VBV fully open), lost and held, no 95 % thrust in 10 s (about 94 kN at 10 s).
- 7e1aeb0: PHYSICS.md §1 rows for D4-13, D4-14 (the recovery's VBV opening above the closing speed is not modeled, linked to the booster map backlog) and D4-15 (the idle-floor loop's slow settling). ENGINE_FACTS W1K-I2 note.
- D3-13 mutation:
  - 1109c98, ff02ac8, 84d3cf4, fa45524: the cheap kills (surgeDetection 3, greitzer 4; surgeSystem built per test, unmemoized; gas, newton, componentMaps, engine).
  - 5794941 (TDD), 7bb37c7: `src/cycle/fadec.ts` holds the pure FADEC laws with fast tests. A hash of 4200 transient states is bit-identical before and after.
  - e7b3829, b19ee84: docs/MUTATION.md has the true per-file scores and every survivor with its reason.

NEXT
1. Orchestrator decisions:
   - (a) The start test's C4 check (model.test.ts) moved from the hand-over instant to the settled idle: N1 within 0.1 over 20 s, about 100 s after the hand-over. At the hand-over N1 is 19.91 % now, against C4's 20; it was 20.20 only through the old silent model chatter. The thresholds are unchanged. Accept, or require a FADEC change (e.g. hand over on N1 too).
   - (b) While held, the spools integrate the held power balance. Accept, or freeze them while held.
   - (c) D4-15 grew: after a start the idle floor swings N2 by 59.7-62.6 % for 1-2 min, and after a flameout relight it overshoots to N2 69.5 %. Both were there before D4-13 (checked on 5a0cf72's model). Fix now or in W3.
2. UI (not touched): show `gasPathSolve.status === 'held'` as a visible annunciator.
3. Mutation:
   - Factor the sub-idle model and the start state machine out of model.ts (the largest survivor blocks: start 126/43, sub-idle 55/0).
   - Test hpcCubic's unclamped least squares on a synthetic map.
   - Run engine.ts with partPower/c10/c11 (36 part-power survivors).
   - boundedLeastSquares and partPower were not re-run.

GOTCHAS
- A memoized `lazy()` fixture maps a mutant to the first test that calls it only. Build per test where mutants matter (surge.test.ts).
- Runs that share a Stryker incremental file report a running total in their "All files" line. Use a per-file `--incrementalFile`, and read the file's own row.
- Stryker on model.ts with gasPathHold.test.ts takes over 10 min. Split it into `--mutate src/cycle/model.ts:1-640` and `:641-1039` (about 5 min each). Scratch runner: `C:\Users\Aaron\scratch\w2f\mut.sh <name> <spec> <tests>`.
- Probes: `node --import ./tools/mesh/ts-resolve.mjs <probe.ts>`. The behaviour fingerprint for pure refactors of model.ts is `C:\Users\Aaron\scratch\w2f\fingerprint.ts` (before/after txt there).
- The first snapshot of a step is taken before the substep applies the inputs. A cutoff or a flameout still tries one matched solve on the lit engine (see the gasPathHold sub-idle tests).
- No new dependencies. Dev port 5187 unused; no dev server or Chrome started; no processes left running.

GATES @b19ee84
- npm test: 1700 passed, 5 expected fail (C10 x3, C11 x2), 80 files.
- npm run lint: clean. npm run typecheck: clean.
- coverage: lines 99.53 %, statements 98.62 %, branches 88.31 %, functions 99.6 %; src/cycle lines 99.58 %, src/thermo 100 %.
- npm run test:mesh: 29 passed. npm run test:gpu: 15 passed. test:browser not run (no render/ui/app change).
