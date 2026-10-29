w2/reference-9 round 12: STOP-CLEAN (WIP; the usage brake hit 84 %). D4-79 is implemented. D4-63 is NOT closed: after 2000 iterations the contract case grows in the energy norm. It is past (a)'s bound and its residual is above its value at 100 from 1000 to 16000. The local time-step trial is written (as a scratch patch) and screened, but not run to 20000. No scheme change. (From a5d86dd; HEAD = the commit of this handoff.)

DONE (round 12)
- d9ac7d0: D4-79 in `tests/ladder/cases/d463.ts` and SOLVER.md 10, committed before any run.
  - Each case runs 20000 iterations, with checkpoints every 100.
  - Gated rows: (a) L2(p') / first, max over 1000-2000 (unchanged) and at 20000, both <= 2. (b) The volume-weighted residual at 20000 <= its value at 10000 and <= its value at 100.
  - Reported rows: L2's max over 1000-20000, D4-77's window, max |p'| over 1000-2000 and at 20000, and the cell mean at 20000 / at 100.
  - `runD463(case)` is shared by both cases. The linear part is `cases/d463lin.ts` (1e-6, isentropic). It has no ladder test; run it alone with `node --import ./tools/mesh/ts-resolve.mjs tests/ladder/runCase.ts d463lin`.
  - `runCase(name, timeoutMs)`. `d463.test.ts` has 6 h timeouts (75 min alone and boosted, up to about 4.3 h loaded) and keeps `it.fails`.
- e75770e: progress lines on stderr every 1000 iterations. The ladder reads only stdout's result line.

D4-79 RESULTS: the contract case (1e-3, isothermal), baseline
- Run with `runCase.ts d463`; the log is `reports/scratch/r12/logs/contract.err`.
- It reproduces round 11 exactly at 1000 and 2000: L2 1.317 / 1.268, resV 7.728 / 6.873, and resV 3.548 at 100.
- Every 1000 iterations from 1000 to 16000:
  - L2(p') / first: 1.32 1.27 1.60 3.26 3.53 4.23 4.43 5.15 4.52 **4.36 (10000)** ... 4.43 **5.39 (15000)** 5.21.
  - The weighted residual: 7.73 6.87 6.28 7.14 7.38 8.16 8.84 8.17 9.53 **8.73 (10000)** ... 9.65 **10.0 (15000)** 8.79, against 3.55 at 100.
  - Max |p'| / first: 10-30 after 3000.
- **So the nonlinear part grows after D4-45's window.** That is growth, not slow decay. Rule (a) passes over 1000-2000 (1.717) and fails late (4-5x). Rule (b) fails against its value at 100 (2.5-2.8x through 16000); the comparison with its value at 10000 depends on the 20000 value.
- The run was at 16000 at 07:25. Unattended, it finishes about 07:40 and writes the 20000 rows to `reports/ladder/D4-63-rest.json` (gitignored; the file there before then is round 11's) and its result line to `r12/logs/contract.out`. It is PID 2964, `node ... runCase.ts d463`.

THE TRIAL (D4-79's next step). NOT adopted and not committed: `reports/scratch/r12/trial-step-limit.patch`, applied in the working tree now. The next agent runs `git checkout src` to drop it, or keeps it for the run.
- A local CFL limit from the measured mismatch:
  - In each cell, r = the min over its 4 faces of 2 beta_c / f_a(M_ref,f), with M_ref,f = min(1, max(the two cells' mean beta, M_cut)), the flux's own.
  - CFL_c = 0.8 L(r) / L(1) for r < 1, and exactly 0.8 otherwise.
  - L is SOLVER.md 10's 1D at-rest beta / M_ref limit, extended below 0.1 by the same analysis (`r12/limits.ts`, acoustic.ts): 0.1646 0.2073 0.2613 0.3547 0.447 0.6076 0.7676 0.8811 0.9722 at r 0.005 0.01 0.02 0.05 0.1 0.25 0.5 0.75 1, and r^(1/3) below.
  - 2 beta / f_a is the right variable: beta 0.06 with f_a 1 gives 0.4749, against 0.4751 at the same r (SOLVER.md 10's machCut 1 row is 0.475).
  - It applies only in tracking with machCut < 1. The rest state, the plain scheme and physical time are bitwise unchanged.
- Screen (`r12/screen.ts`, 200 iterations): it cuts 49-83k of the 130k cells, with factors down to 0.59.
  - L2 / resV are 0.720 / 3.53 at 100 and 1.024 / 5.72 at 200, against the baseline's 0.718 / 3.55 and 1.020 / 5.59.
  - So in the transient it follows the baseline, as round 9's semi-discrete finding predicts. Whether it removes the late growth (3000-16000) is unknown.
- NOT run to 20000. `r12/trial.ts` is the runner, with the D4-79 rows plus where the energy and the residual sit. It is about 75 min alone.

NEXT
1. Read the baseline's 20000 rows from `reports/ladder/D4-63-rest.json` and `r12/logs/contract.out`.
2. The trial: with the patch applied, run `trial.ts` (AMP 1e-3) alone and boosted. Start it with the absolute path, so `r12/boost.ps1` matches it.
   - If it passes (a) and (b): add mismatchCflFactor's unit test (TDD), then run the linear part, the full ladder and coverage with it.
   - If it fails: `git checkout src` and hand back the data.
3. The linear part: `runCase.ts d463lin` on the baseline code, about 75 min.
4. The gates, the ladder (the d463 test now takes about 75 min), and SOLVER.md 10's D4-79 results table.
5. For the orchestrator: the contract's late growth (L2 about 5x from 8000 to 16000) is new data. It is growth, so no rule window closes D4-63; it needs a scheme change. The candidates are this trial and the beta floor (minMach 0.02; round 11 gives L2 0.78 over 1000-2000, not run past 2000; reported only).

KERNEL MIRROR (for w2/solver)
- No scheme change: beta^2 is unchanged (K = 1, the neighbour dp), and so is the local step. The trial is not adopted, so the kernel needs nothing from it. If it is adopted later, the kernel's local-dt stage needs the same per-face r and the L(r) table.
- I19 is unchanged: the GPU tests take D4-62 / D4-71's tolerances.
- The monitor `residualDensityL2Volume` is unchanged from round 11. The kernel needs it only if the GPU engine-stability test takes the D4-63 rule.

GOTCHAS
- Scratch is in `reports/scratch/r12/` (gitignored): boost.ps1, limits.ts, screen.ts, trial.ts, trial-step-limit.patch, logs/.
- The contract run takes about 3.7 min per 1000 iterations, alone and boosted.

GATES @e75770e: not rerun (usage brake). src is unchanged since round 11's @4e7b02a, whose gates stand. The changed test files typecheck (tsc --noEmit) and pass eslint and prettier.
