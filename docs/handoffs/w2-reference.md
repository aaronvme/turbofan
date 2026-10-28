w2/reference: round 7 DONE (from c937913; HEAD = the commit of this handoff). D4-36's trials were run, and neither limiter variant is adopted. D4-48 and D4-45 are in. D4-52 has its data, with nothing adopted. W2R-N4 and N9-N14 are done.

DONE (IDs -> commits, round 7)
- D4-48 248d4b9 (TDD) / 40d2fad: SOLVER.md 12.2. The residual check of rows B and E divides by the flux scale, r_flux = sqrt(mean_c (sum_f |b_f F_f,rho| / (b_c V_c))^2). The tolerance stays 1e-3; this is a normalisation only. The other rows keep the residual form.
  - The oracle gives r_flux in f64: `ReferenceSolver.residualFluxScale()`. It covers every block, and multi-block meshes are handled.
  - solver.test.ts checks it against the face-by-face sum, checks that it bounds the residual, and checks that it is 0 at rest.
- D4-45 639936e (TDD) / 6d26165: L8, L9a and L9b read their value row at the end of a 2000-iteration window. The window samples the metric at its start and every 100 iterations (common.ts `steadyWindow`). The row passes only if max - min <= tolerance / 10, and the spread is reported as its own row.
  - Caps are `scaledCap(20000, s.trackingCfl)` = 20000 x 1.5 / CFL. L8 runs at the preconditioned CFL 0.8, so its cap is 37500.
  - L9a and L9b run plain tracking at 1.5, so the same rule keeps their 20000 (see decision b).
  - `ReferenceSolver.trackingCfl` is new. The text is in PHYSICS.md 3.3.
- D4-36 0251fd9 (SOLVER.md 6): the trials were run under the pre-stated rule, with full trees in reports/scratch/trialA, trialB and trialS (sharp at c937913), and logs in reports/scratch/r7. **Neither variant is adopted, and the sharp form stays the contract.**

  | row | sharp | (a) Venkat. eps, plain CFL 1.0 | (b) smooth p', u |
  |---|---|---|---|
  | L1-L7 value rows, L9 values, 12.2 storage | pass | pass | pass |
  | L8 velocity | 0.37 % | **28.3 % FAIL** | **32.7 % FAIL** |
  | W2R-6's three pins pass | no | **0 of 3** (the machCut-1 set-ups stall at 0.06-4 of their first residual) | **2 of 3** (no growth; tracking sits flat at 1.4e-8 > 1e-8, set by the set-up's 1.3e-7 floor) |
  | L9a / L9b converge (reported) | no / no | 5373 / 9299 | 5059 / 9096 |
  | L5 converges (reported) | 948 | 1354 | not (6.5e-2) |
  | R / J at 20000 (reported) | 4.2e-4 / 0.24 | converged at 1566 / 0.25 | converged at 1390 / 0.65 |
  | flow unit suites (reported) | 0 fail | 9 fail | 8 fail |

  - **D4-47.** Both variants resolve R's floor. The L4a/L5 plateau is NOT the limiter. In f64 the sharp oracle takes L4a and L5 to 6e-13 and 6e-12 of the first residual. With f32 storage (`storage: 'f32'`) it plateaus at 1.6e-4 / 1.1e-3, and (a) / (b) at 3.2e-5 / 8.7e-4 and 1.3e-4 / 6.0e-2. The GPU's 4.0e-4 / 7.5e-3 is the f32 floor, and D4-38's stated 4e-5 / 1.7e-4 sit below the oracle's own f32 floor.
- W2R-N13 b86ca92 (SOLVER.md 8): a power iteration about W2R-6's steady state with the switch pattern frozen grows at the live rate, to 5-6 digits.
  - The rates: tracking 1.0718 per iteration; physical time 1.0397 (M 0.06) and 1.0152 (M 0.35).
  - With the switch forced on, the growth is 1.218. So the mode is the linearised one-sided limited slope, not the switching and not the zeroing at extrema.
- D4-52 / W2R-I8 b86ca92 (SOLVER.md 10 table): the pressure-difference cutoff is already in beta^2 at K = 1.
  - K = 10 / 100 give J 0.39 / 0.40, and K = 1000 diverges at iteration 265.
  - The velocity-difference and neighbour-Mach cutoffs bring J to 1.1e-3 - 2.9e-3, short of the 1e-5 rule.
  - A global M_cut of 0.02 / 0.05 (0.4 / 1 x the jet Mach) converges J: 5.8e-5 / 3.8e-6, bouncing.
  - The residual sits in the dead-air recirculation beside the jet, at beta = M_cut.
  - Nothing is adopted; the J pin stays.
- Nits 0ab5f65:
  - N14: 60 s timeouts on solver.test.ts's iterating tests (9f4bd51 also gives blockage.test.ts 600 s; its set-ups exceeded 120 s under coverage beside two ladders).
  - N9: L7's Cd row also needs the 96 x 96 run converged.
  - N10: the duct bound is restated as < 5500.
  - N11: tests/ladder/globalSetup.ts clears reports/ladder/*.json first.
  - N12: the sphere child times out at 60 s + cap x n^2 x 8 us (4.8 us was measured under load). That is 25.6 min at 96, 7 min at 48 and 2.5 min at 24.
  - N4: L4b keeps its 20 samples and reports starts at 0.16 and 0.24 m. Both reach x_s 0.2132 m, the target start's equilibrium: 1.644 / 1.655 % against 1.64 %.
- 960862f: the R/J pin comments. The handoff commit adds PHYSICS.md 3.3's first D4-45 result.

LADDER (`npm run test:ladder` @0e1bdba, 905 s): 10 files passed, 3 failed
- Value rows that pass:
  - L1: quiescent 0; uniform f64 2.0e-13.
  - L2: 0.28 %, offset 0.23 cells.
  - L3: 0.21 %.
  - L4a: 0.28 % / 0.10 %, 915 iterations.
  - L4b: 1.64 %, steady 2.6e-4.
  - L5: 0.084 %, 948 iterations.
  - L6: 3.0e-4 / 2.9e-5.
  - L7 (96 x 96): asymmetry 0.0131 (24/48/96 falling, order 1.62 / 1.74), Cd 0.0016, ratio 1.048.
  - All 12 rows of 12.2's f32 storage.
- L8:
  - velocity 0.449 %, spread 2.0e-5: PASS;
  - **convergence FAIL**: 9.3e-6 at the cap of 37500, missing by the 50-iteration window. The critic measured about 32500 before D4-44.
- L9a:
  - Euler work 8.9e-6, but **spread 1.06e-5 > 1e-5: FAIL** (the samples run 4.7e-7 to 1.1e-5);
  - convergence FAIL (3.5e-3).
- L9b:
  - 0.80 %, spread 2.5e-5: PASS;
  - convergence FAIL (2.7e-2).

NEXT
1. The orchestrator's decisions below.
2. W2R-6 and the L9 stalls: the sharp limiter's linearisation (N13). Round 5's term table found `b_f = min(b_L, b_R)` stable, and that is a candidate that does not touch the limiter (SOLVER.md 8).
3. W2R-I8: a global cutoff tied to the flow, or a wider local one (SOLVER.md 10).

ORCHESTRATOR DECISIONS NEEDED
- (a) D4-36: confirm that sharp stays. (b) passes everything except L8's velocity and one W2R-6 pin, and that pin fails on the machCut-1 set-up's floor, not on growth.
- (b) D4-45 for L9: L9a/L9b run at plain CFL 1.5, so 1.5 / CFL keeps their caps at 20000. Applying 1.5 / 0.8 to them literally would be a cap increase without a CFL change.
- (c) D4-45 has made L9a's value row a FAIL on steadiness: the spread is 1.06e-5 against 1e-5, with the value 9x inside its tolerance. L8's convergence row misses its 37500 cap by a hair.
- (d) D4-47 / D4-38: the GPU's L4a/L5 plateaus are the f32 floor (oracle f32 storage 1.6e-4 / 1.1e-3), not the limiter. The stated floors need restating from the oracle's f32-storage runs.
- (e) W2R-I8: which form to try next. Under M_cut = minMach = 0.003, J does not converge with any local cutoff tried.

FOR w2/solver (mirror)
- The limiter: sharp van Albada (unchanged). Do not implement either D4-36 variant. The plain DEFAULT_CFL stays 1.5.
- M_ref from the face's beta (D4-44, unchanged since round 6): min(1, max(0.5 (beta_L + beta_R), M_cut)), with beta frozen at stage 1 and a ghost taking its source cell's.
- beta^2's dp term stays at K = 1 (W2R-I8 not adopted).
- 12.2 rows B and E: |r_GPU - r_ref| / r_flux <= 1e-3, with r_flux from `ReferenceSolver.residualFluxScale()` (every block). This replaces the single-block faceFlux helper.
- The ladder's L8/L9 value rows carry D4-45's 2000-iteration steadiness window, and L8's cap is 37500.

GOTCHAS
- The scratch trees reports/scratch/trialA, trialB, trialS, trialJ, trialN13, fS, fA and fB are full copies; trialJ and the f* trees have env hooks (BETA_K, BETA_KU, BETA_NB, STORAGE, PLATEAU). Drivers are in r7/ (w2r6.ts, trialtable.py, tab.py) and in trialJ/rj (cases.ts, diag.ts).
- `python -I` ignores PYTHONIOENCODING; use `-X utf8` for unicode output.
- npm test takes about 6 min under load, because the R/J pins iterate 20000 each.
- Running a single ladder file now clears the other reports (N11).
- A hook blocks recursive deletes. No process of this branch is left running.

GATES @0e1bdba (the code; the handoff commit adds docs only)
- npm test: 84 files, 1735 passed + 11 expected fail (305 s)
- npm run lint: clean. npm run typecheck: clean.
- coverage: 84 files pass; lines 99.58 %, branches 88.07 %; src/flow/reference lines 99.51 %, branches 89.23 % (gate 85 %); thresholds met
- test:mesh: 29 passed.
- test:ladder: 10 passed / 3 failed (above).
