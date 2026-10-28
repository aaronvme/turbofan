w2/reference: round 8 STOP-CLEAN (from 9a0f31a; the work is done, but the coverage and test:mesh gates were not verified, and L7 needs a rerun; HEAD = the commit of this handoff). D4-59's global M_cut = 0.02 trial was run under its pre-stated rule, and **0.02 is NOT adopted**: the engine setting stays minMach = M_cut = 0.003, with J pinned. D4-58's floors are restated, and D4-56/D4-57 are in the docs and tests.

DONE (IDs -> commits, round 8)
- D4-59 1c5319a (the rule, committed before the runs) / 9002963 (the results, SOLVER.md 10). Trial tree: reports/scratch/trialM. Logs and reports: reports/scratch/r8. R/J driver: trialM/rm/rj.ts, built as precondition.test.ts builds them.
  - The trial: minMach = M_cut = 0.02 wherever the engine's 0.003 is used (L8, the 12.2 C-pre and S rows, R, J). L7's M 0.01 sphere also runs at max(M_inf, 0.02).

  | row | 0.003 | 0.02 |
  |---|---|---|
  | L1-L6, L9a, L9b (not preconditioned) | below | bitwise the same |
  | L7 asymmetry (96), sequence falling | 0.0131 | 0.0109: pass |
  | L7 Cd | 0.0016 | 0.0013: pass |
  | L7 iteration ratio (<= 3) | 1.048 | 1.779: pass |
  | L8 velocity / spread | 0.449 % / 2.0e-5 | 0.754 % / 3.2e-5: pass |
  | L8 convergence | not at 37500 | not at 37500 |
  | 12.2 C-pre (1/10/100) | 1.43e-7 / 1.80e-7 / 2.26e-6 | 1.43e-7 / 1.79e-7 / 1.06e-6: pass |
  | 12.2 S (1/10/100) | 7.3e-8 / 1.6e-7 / 4.7e-7 | 1.2e-7 / 1.1e-7 / 2.0e-6: pass |
  | R | 4.2e-4 at 20000: FAIL | **4.3e-4 at 20000: FAIL** |
  | J | 0.24 at 20000: FAIL | meets the rule at 9441 (8.4e-6), then rebounds to 9.9e-5 (5.8e-5 at 20000) |

  - Rule 1 holds. Rule 2 fails on R: R's floor is the sharp limiter's (round 6) and does not move with M_cut. J passes the rule's letter but does not stay converged.
- D4-58 3ba1e88: `GPU_CONVERGENCE_FLOOR = { L4a: 1.6e-4, L5: 1.1e-3 }` in tests/ladder/oracle.ts, the module the GPU tests import; the text is SOLVER.md 12.4, and 6's D4-47 bullet is corrected.
  - The new ladder file floor.test.ts re-measures the floors with f32 storage: 1.590e-4 and 1.096e-3, the minimum over the last 2000 of 20000 iterations.
  - It checks that the stated values equal the measurement to 2 significant figures, and that f64 falls at least 100x lower (6.4e-13 and 5.9e-12).
  - l4aSolver and l5Solver are factored out of the cases, with no change in behaviour (L4a 915 and L5 948 iterations, as before).
- D4-56 / D4-57 3ba1e88: PHYSICS.md 3.3 and the L9 cases now cite the decisions. The L9 caps stay 20000, since L9 runs at the plain CFL 1.5. L9a's steadiness rule is unchanged (tol / 10), so its row stays a visible FAIL.
- 07511fb: the R/J pin comment carries the D4-59 outcome.

LADDER (`npm run test:ladder` at 07511fb, 1082 s, under load: coverage and the other builder's GPU tests ran beside it): 10 files passed, 4 failed.
- Value rows: the same as round 7 (L1-L6, L8 0.449 %, L9b 0.80 %, 12.2 all pass). The new floor file passes: 1.590e-4 / 1.096e-3, f64 6.4e-13 / 5.9e-12.
- L8 conv, L9a (D4-57), L9a conv and L9b conv fail as in round 7.
- **L7 FAILED on a child timeout, not on a row.** The reported plain M 0.01 48 x 48 sphere child, which runs to the 20000 cap, hit N12's 429 s budget under load. L7 printed no rows. L7 passed in round 7 at the same code, and in the trial ladder. Needs a rerun on a quieter machine. If it recurs, N12's 8 us budget is too tight under load.

NEXT
1. W2R-I8 / R: both are limiter-bound. R's floor is the sharp limiter's, and a cutoff does not touch it. J needs either a cure for the post-convergence bounce or a local cutoff that reaches more than one cell into the dead air (SOLVER.md 10).
2. W2R-6 and the L9 stalls: the sharp limiter's linearisation (N13). `b_f = min(b_L, b_R)` is a candidate (SOLVER.md 8).

ORCHESTRATOR DECISIONS NEEDED
- (a) D4-59: confirm 0.003 stays. 0.02 passes every ladder and 12.2 row, but it fails R, whose floor is the limiter's, so no cutoff can pass the rule as written. If R is moved to the limiter work, J at 0.02 meets the rule but does not stay converged.

FOR w2/solver (mirror)
- **M_cut: no change.** The adapter default stays minMach = M_cut = 0.003 (D4-40, D4-59 not adopted). The limiter stays sharp van Albada, beta^2's dp term stays at K = 1, and the plain DEFAULT_CFL stays 1.5 (preconditioned 0.8).
- D4-38's GPU stopping floors are now 1.6e-4 (L4a) and 1.1e-3 (L5). Import `GPU_CONVERGENCE_FLOOR` from tests/ladder/oracle.ts. The GPU's 3.99e-4 / 7.5e-3 stay KNOWN-FAIL with the gap (D4-58).
- Unchanged from round 7: M_ref from the face's beta (D4-44); the 12.2 B/E rows against r_flux = `residualFluxScale()`; L8/L9 steadiness windows; L8 cap 37500; L9 caps 20000 (D4-56).

GOTCHAS
- reports/scratch/trialM is a full copy with a node_modules junction. Its edits are in tests/ladder/oracle.ts, cases/l7.ts, cases/l8.ts and unit/flow/precondition.test.ts.
- Run ladder cases from the worktree root. runCase writes reports/ladder relative to the cwd.
- floor.test.ts adds about 7 min under load. It runs in parallel with L7, so the ladder's wall time is barely changed.
- npm test takes about 5.5 min. No process of this branch is left running.

GATES (the code at 07511fb; the later commits are docs only)
- npm test: 84 files, 1735 passed + 11 expected fail (335 s)
- npm run lint: clean. npm run typecheck: clean.
- coverage: NOT VERIFIED. It ran beside the ladder, but its log is missing and coverage/coverage-summary.json was not rewritten. Rerun it.
- test:mesh: NOT RUN (it was chained after coverage). Rerun it.
- test:ladder: 10 passed / 4 failed (above).
