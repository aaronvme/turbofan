w2/reference: round 6 STOP-CLEAN (WIP; orchestrator STOP-CLEAN at 79-80 % usage). From 4553ce2; HEAD = the commit of this handoff.
- D4-43: DONE.
- D4-44 (a): DONE in the code and the contract. Its flow cases R and J FAIL the pre-stated rule, for reasons that neither (a) nor (b) reaches.
- D4-36: the rule and both variants are in SOLVER.md 6 and in scratch copies of the tree. They were NOT run: the runs were stopped at STOP-CLEAN.
- D4-45, the timeout fix and the pass-8 nits: NOT started.
- Gates: NOT run this round.

DONE (IDs -> commits, round 6)
- D4-43 / W2R-I5 9326202 (+ db0ed58 prettier): p_u deleted from the oracle.
  - Removed: slau2Flux's `ku`, `lowMachPreconditioning.velocityDiffusion`, and the p_u tests in slau2.test.ts and precondition.test.ts.
  - SOLVER.md 7 keeps the trial and its table as the record (the code lived from 413b623). acoustic.ts keeps K_u as an analysis parameter.
  - W2R-N8's second half: the C-pre quantity is the density-residual L2.
- D4-44 (a) 37b4d5c (SOLVER.md first) / 7b5a2f1 (TDD) / d9ca099: M_ref = min(1, max(beta_f, M_cut)), with beta_f = (beta_L + beta_R) / 2 of the preconditioner.
  - beta is kept per extended index and frozen at stage 1. A ghost takes its source cell's beta, so interfaces stay bitwise.
  - residual() and faceFlux() evaluate beta from the current state.
  - The signature is now slau2Flux(..., machCut, betaFace); machCut >= 1 gives f_a = 1.
  - The flow unit suites pass: 132 passed, plus 2 new KNOWN-FAIL (R and J).
  - The machCut >= 1 test configuration is documented at the option (W2R-I6 gap 2). W2R-N7 and W2R-N8 are in SOLVER.md 10.
- D4-44 analysis (SOLVER.md 10 tables):
  - Before D4-44 (at rest, 1D, M_cut 0.003), the limit by beta/M_ref was 0.447 at 0.1, 0.608 at 1/4, 0.768 at 1/2, 0.972 at 1, 0.937 at 4 and 0.234 at 16.
  - With (a), every uniform state has M_ref = beta. Over beta in [0.003, 0.6] and M0 in [0, beta], the 1D limit is >= 0.972. The minimum is at rest with beta = M_cut, so 0.8 holds on the whole family.
  - The numbers come from the hand model and from critic pass 8's probe, run on the module's own slau2Flux (reports/scratch/r6/probe.ts).
- D4-44 (c) results. The rule: 1e-5 of the peak within 20000 iterations, at CFL 0.8 with minMach = M_cut = 0.003.

  | case | before D4-44 | (a) | (a), CFL 0.4 | (a) + smooth limiter | (a) + (b) | plain, no preconditioning |
  |---|---|---|---|---|---|---|
  | R, start from rest (blockage duct 24 x 6) | 8e-5 (abs 0.030) | 4.2e-4 (abs 0.031) | 4.0e-4 | converged to 1e-6 at 1763 | 4.4e-4 | |
  | J, M 0.05 jet into dead air (32 x 16) | 3e-2 (abs ~4) | 0.24 (abs ~6) | 0.18 | 0.34 | 0.17 | 4.1e-5 (abs 7.6e-5), falling |

  - R's floor is the sharp limiter's (D4-36). It does not move with the CFL, and the smooth form converges it.
  - J's stall comes from the preconditioned scheme beside a shear layer: the plain scheme goes 5 orders lower. It is not the step, and neither (a) nor (b) fixes it.
  - Both cases are pinned it.fails in precondition.test.ts. Each runs 20000 iterations, which takes minutes (R took 25 min under load in the suite).
- D4-36 rule eacef07 (SOLVER.md 6, written before any run):
  - (a) the smooth form on all six primitives, eps_k = 1e-4 S_k (h_c / 0.01 m)^1.5 with h_c = sqrt(cellArea), at plain CFL 1.0;
  - (b) the smooth form (K_eps 1e-3) on p' and u only, sharp on the rest, at plain CFL 1.0;
  - the rule: adopt the first variant that keeps every round-5 PASS row and makes blockage.test.ts's three it.fails pass.

OPEN / NEXT (in order)
1. The D4-36 runs.
   - reports/scratch/trialA and trialB are full-tree copies (src, tests, tools, public, configs) with the variant as the default: DEFAULT_CFL 1.0 and loadLine smooth + hExtOf in solver.ts, and the eps form in muscl.ts.
   - In each, run `npx vitest run -c vitest.ladder.config.ts` and `npx vitest run tests/unit/flow/blockage.test.ts`. Logs go to reports/scratch/r6/ladder_trialX.log and w2r6_trialX.log.
   - Apply the rule. If a variant is adopted, port it into src with TDD.
2. The D4-44 decisions (below). Then decide where R and J go: they are slow. Move them to the ladder, or keep them as pins with a lower cap.
3. D4-45.
   - A steadiness rule for L8's velocity row and the L9a/L9b value rows: max - min over the last 2000 iterations, sampled every 100, must be <= tolerance / 10. It is its own row, and the PASS depends on it.
   - Caps x 1.5 / 0.8: L8 becomes 37500, and L9a/L9b scale from their current caps the same way.
4. W2R-N14: explicit timeouts on solver.test.ts's iterating tests (the annulus test at 30_000 or more). Then the nits:
   - N9: L7's Cd row also needs low.conv.converged.
   - N10: restate the duct bound in precondition.test.ts as < 5500 at CFL 0.8.
   - N11: clear reports/ladder at the start of test:ladder.
   - N12: give sphereChild a timeout derived from its cap.
   - N13: the frozen-switch power iteration.
   - N4.
5. The gates and the full ladder (L7/L8 values move with D4-44, since M_ref now comes from beta), the coverage gate, then the handoff.

ORCHESTRATOR DECISIONS NEEDED
- (a) D4-44. (a) is in, and the analysis shows the matched family is stable at 0.8 by construction. The (c) cases fail on things outside the step: R on the limiter, J on the preconditioned scheme beside a shear layer. My proposal: keep (a) as the contract with R and J pinned. Should J's stall become a new item (W2R-N15)?
- (b) Option (b) changes nothing in R or J. Please confirm it is not adopted.

FOR w2/solver (mirror now)
- p_u is gone (it was never in the contract).
- D4-44 (SOLVER.md 7):
  - M_ref = min(1, max(0.5 (beta_L + beta_R), M_cut)), with beta = sqrt(beta^2) per cell, frozen at stage 1;
  - a ghost takes its source cell's beta;
  - f_a = 1 when machCut >= 1 or when not preconditioned.
  - This changes the preconditioned steady state at the Delta-p-jump level, so the C-pre and S rows of 12.2 need re-measuring against the new oracle.
- Do NOT implement either limiter variant (D4-36 is not decided).

GOTCHAS
- Scratch drivers:
  - reports/scratch/r6/cases.ts (env: CASE jet|rest, CFL, CAP, MC, LIM, PRE=0, DROP, NI/NJ, MJ);
  - cases_b.ts with ref6b (option (b));
  - probe.ts (the critic's probe plus the D4-44 sweep);
  - ac.ts (the hand-model tables).
- A hook (Fact-Forcing Gate) blocks recursive deletes and process kills until you state the facts. Use new folder names instead of deleting.
- A test's vitest timeout does not interrupt synchronous iteration: R ran 25 min against a 600 s timeout.
- Parallel `>>` appends from Git-Bash background processes overwrite each other (MSYS has no atomic O_APPEND). Give every process its own log.
- No test or process of this branch is left running.

GATES: not run at this HEAD (STOP-CLEAN).
- The last gates of record are round 5's, @4927332: npm test 1735 passed + 9 expected fail; lint and typecheck clean; coverage lines 99.57 %, branches 88.07 %; test:mesh 29 passed; ladder 10 files passed, 3 failed.
- Since then: tsc is clean at d9ca099, and the flow suites give 132 passed + 4 expected fail.
