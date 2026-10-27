ROUND 5 (in progress; this block is rewritten at the end of the round)
- W2R-I4 DONE f8d539a: SLAU2 value tests against an independent evaluation of the paper formulas (absolute variables, calorically perfect gas), six unequal state pairs at 1e-12 relative. Stryker on slau2.ts with slau2.test.ts alone: 98.80 % (164 killed; the 2 survivors are the equivalent |M| >= 1 -> > 1). W2R-N6 done there (per-call side records).
- W2R-I2 DONE (the commit "W2R-I2/I4 DONE"): SOLVER.md 12.2 states the mesh of every row; tests/ladder/oracle.ts exports the set-ups (closedBoxMesh with f32 metrics, closedBoxOptions, smoothPerturbation, sinkCase, relativeError); new rows C-pre (the closed box at the engine's preconditioning, minMach = M_cut = 0.003) and S (L8's sink, preconditioned). Storage errors 1.1e-7 / 1.7e-7 / 5.1e-7 (C-pre) and 7.3e-8 / 1.8e-7 / 6.3e-7 (S) after 1 / 10 / 100: 93-2000 x below the tolerances.
- D4-32 interim: DEFAULT_CFL_PRECONDITIONED = 0.8 (SOLVER.md 10, the acoustic analysis pinned in rk.test.ts). Found on the way: C-pre at CFL 1.5 goes to NaN at iteration 79. At 0.8, L8's velocity error is 0.36 % (PASS; 40.6 % at 1.5) but it does not converge to 1e-5 in 20000 (3.9e-4 of the first); L7 0.0437 / Cd 0.0096 / ratio 0.89 (3901 / 4371).
- FOR w2/solver NOW: SOLVER.md as of this commit, including the preconditioned default CFL 0.8 and the 12.2 rows (import tests/ladder/oracle.ts). STILL OPEN for the kernel: p_u (D4-32 trial, next), the limiter default (D4-33), W2R-6 (D4-34).

w2/reference: round 3 DONE with open items (from b7eb36d; HEAD = the commit of this handoff).
- D4-20 (the low-Mach dissipation scaling) is in. It removes the L7 sawtooth: L7 converges, and its iteration ratio and Cd now pass. At most M_cut values it also removes L8's axis error.
- D4-19's steadiness check passes, so L4b passes.
- D4-22 is measured and accepted.
- D4-23 examined: the point-implicit Jacobian does nothing, and L9a's stall is the limiter.
- Still open: L7's asymmetry (resolution), L8 at its pre-registered M_cut 0.003 (an instability band), and van Albada's switch (L9a, the D4-20 duct). Decisions below.
- ROUND 4: STOP-CLEAN (usage brake at 85 %), WIP. W2R-B1 DONE at 9d99b04 (gates green there). The rest is partial, below.

ROUND 4 STATUS (WIP; the last commit is the STOP-CLEAN one)
- W2R-B1 DONE 9d99b04: W2R-6 pinned (blockage.test.ts, it.fails x3 + b = 1 control), comment fixed, SOLVER.md 8 + this file.
- W2R-I1 PARTIAL: 1d85b0c (SOLVER.md 6 first), 485b69a (TDD), then the WIP commit. FINDING, decision needed: the smooth van Albada at K_eps 1e-3 (eps rule in SOLVER.md 6) does NOT land as the contract. It converges the D4-20 far-field duct at M_cut = minMach, but on the inflow/outflow blockage duct the residual floors at a level proportional to eps at every CFL 0.8-1.5 (machCut 1: ~10x the first at 1e-3, 0.7 / 5e-2 / 5e-3 at 1e-4 / 1e-5 / 1e-6), and solver.test's plain low-Mach duct leaves its steady state. Cause: below eps the slopes are central and the low-Mach acoustic pair has only the scheme's own damping; the sharp switch's clipping of noise extrema was a hidden first-order dissipation. So the code keeps the sharp form as default and the smooth form is an option (`limiter: 'smooth'`, `smoothVanAlbada`, `limiterEpsilon`, unit-tested). D4-26 (L7 at 96 x 96) NOT started.
- D4-30 PARTIAL: `tests/unit/flow/acoustic.ts` (fully discrete von Neumann of the 3-stage scheme on the at-rest acoustic family, 1D and 2D with cell aspect; NOT yet in a test, and slow: precompute the eigenvalues per wave number before bisecting the CFL). It reproduces the critic's probe. CFL limits (aspect 0 = 1D / 0.25 / 0.5 / 1 = square): plain tracking 1.236 / 1.539 / 1.791 / 1.878; plain SSP-RK3 1.256 (all aspects); preconditioned matched (beta = M_ref = 0.003) 0.972 / 1.210 / 1.408 / 1.550; + p_u K_u 0.25: 1.231 / 1.517 / 1.691 / 1.777; K_u 0.5: 1.413 / 1.726 / 1.885 / 1.958; K_u 0.75: 1.254 / 1.567 / 1.880; preconditioned with machCut 1 at beta 0.06: 0.475 / 0.591 / 0.687. High-aspect cells bind. Proposed (not implemented): preconditioned CFL 0.8 without p_u (0.82 x 0.972; L8 was neutral at 0.9 in the critic's runs), or 1.15 with p_u K_u 0.5. p_u trial NOT run.
- D4-29 PARTIAL (W2R-6 mechanism): the p grad b source IS well-balanced (uniform p' 500 Pa, u = 0, b_min 0.85: max |R|/V 4.4e-12 against p'/dx 2e4, i.e. rounding). The growth does not depend on the CFL (tracking 0.8-1.5 and SSP-RK3 at CFL_phys 0.3-0.9 all reach 5e-3..1e-2; physical time delays it in proportion to dt), so it is an unstable eigenvalue of the SEMI-DISCRETE operator with blockage, not a time-stepping limit. Scratch: reports/scratch/r4/w2r6cfl.ts. Next: find the mode (shape, which BC) and whether b_f = (b_L + b_R)/2 with b_c V against the inflow characteristic BC is the cause.
- W2R-I2, W2R-I4, the nits (except N5, done in the TDD tests): NOT started.

NEXT (round 4 continued, in order)
1. W2R-I4 (SLAU2 value tests from an independent script) and W2R-I2 (12.2 C-pre rows, shared perturbation module, mesh per row, measured storage error): w2/solver's oracle comparisons wait for both.
2. D4-30: pin acoustic.ts in rk.test.ts (precompute eigenvalues), set DEFAULT_CFL for preconditioned tracking, implement p_u (preconditioned tracking only, off at machCut >= 1 so the plain flux stays bitwise), run L8 / L7 / L2 / L4.
3. Decision on D4-25 given the finding above (smooth form only with the acoustic damping of step 2?).
4. D4-29 continued; D4-26 (L7 96 x 96 + PHYSICS.md CPU variants first).

GATES @ the WIP commit: npx vitest run tests/unit/flow: 116 passed + 4 expected fail; typecheck clean; eslint on the touched files clean. Full gates and the ladder were NOT rerun after 9d99b04.

OPEN ITEMS
- W2R-6 (open since round 2, b7eb36d; critic pass 7 W2R-B1; decision D4-29: investigate and fix before W3). With blockage the plain scheme is linearly unstable about its own steady state, in tracking AND in physical time (SSP-RK3 at the default dt, the mode of surge and light-off events).
  - Duct of precondition.test.ts (24 x 3, b_min 0.85), converged preconditioned (machCut 1) to 1e-11, then iterated plain. Relative drift from 1e-12: tracking 8e-3 at 1000 iterations (M 0.06); physical time 1e-2 at 1000 steps (M 0.06), 4e-9 at 1000 and 8e-3 at 2000 (M 0.35). It saturates near 1 % of the state.
  - Control: the same duct with b = 1 stays at 1e-12 in both modes for 2000 iterations.
  - Pinned: `tests/unit/flow/blockage.test.ts`, three `it.fails` (KNOWN-FAIL, tracking and physical time) and two passing tests (the set-ups converge; the b = 1 control). SOLVER.md 8 carries it as open.
  - First suspect (D4-29): the well-balancedness of the p grad b source (face pressures against the cell p').

DONE (W2R-n IDs -> commits; W2R-1..10 are in b7eb36d's handoff)
- W2R-11 f87ffcc (SOLVER.md first) / 27b6bff (TDD) / 66164a5: D4-20.
  - SLAU2's mass-flux pressure diffusion is divided by f_a(M_ref) = M_ref (2 - M_ref), with M_ref = min(1, max(qbar/cbar, M_cut)).
  - It applies only in preconditioned tracking: `lowMachPreconditioning.machCut`, default minMach; >= 1 gives the plain flux bitwise. Physical time and unpreconditioned tracking stay unscaled.
  - Bitwise antisymmetry and the exact ambient hold.
  - The engine's value is minMach = M_cut = 0.003, the ~1 m/s far-field suction of the static engine (SOLVER.md 7).
  - Tests: slau2.test.ts (only the diffusion scales, by exactly 1/f_a; the local Mach above M_cut; transonic faces unchanged) and precondition.test.ts (the tracking residual changes, physical time does not, the default cut is minMach).
- W2R-12 ffbf367: D4-19. L4b samples the shock position every 100 iterations over the last 2000. The position row passes only if max - min <= 0.1 % of the length. The convergence row is now reported. Pre-registered in PHYSICS.md 3.3 (27b6bff).
- W2R-13 3560d60: D4-22, measured on the M 0.3 sphere, preconditioned (machCut 1) against plain, both converged to 1e-6.
  - max |dCp| 4.0e-4 against a tenth of the tolerance, 2e-3. dCd 2.8e-6 against 1e-3. d(asymmetry) 8.7e-6. Accepted.
  - L1-L6 and L9 run plain, so they have no shift.
  - The earlier 2.3e-3 was the 1e-4 convergence level, not the BC.
- W2R-14 f87ffcc (SOLVER.md 10): D4-23 examined; nothing added to the kernel.
  - In these variables the swirl source b A (rho r w)^2/(rho r^2) sits only in the rho v row. Its Jacobian is nilpotent, so it adds no damping, and there is no u_r u_theta source.
  - L9a at CFL 1.5, 6000 iterations: 3.0e-4 of the peak without the Jacobian, 3.2e-4 with it.
  - The fallback Delta t <= C r/|u_theta| would bind only for C < 0.002.
  - The cause is the limiter. L9a converges to 1e-10 at CFL 1.5 when the u or p' slopes are unlimited, with central slopes, at first order, or with the smooth van Albada (a+b)(ab+eps^2)/(a^2+b^2+2 eps^2) at eps 1e-3 or 1e-4 of the reference scale. The sharp form stalls at CFL 1.0, 1.2 and 1.4 too.

LADDER (CPU; full run @3560d60, the code of ffbf367; reports/ladder/*.json; 9 files pass, 4 fail, 339 s)
| case | metric | threshold | value | |
|---|---|---|---|---|
| L1 | quiescent, 130k f32 asset (bitwise 0) / uniform M 0.5, 50 its | < 1e-4 m/s | 0 / 2.0e-13 | PASS |
| L2 | L1(rho) / shock offset | < 1 % / <= 1 cell | 0.28 % / 0.23 | PASS |
| L3 | L1(rho) vs 1D | < 2 % | 0.21 % | PASS |
| L4a | Mach / choked mdot | < 1 % / < 0.5 % | 0.28 % / 0.10 % | PASS |
| L4b | shock position (170 x 17) + D4-19 steadiness | < 2 %, <= 0.1 % | 1.64 %, 0.026 % | PASS |
| L4b | convergence (reported, open) | - | 0.146 of the first at 17000 | reported |
| L5 | mdot | < 1 % | 0.084 % | PASS |
| L6 | radial equilibrium free / solid; drift | < 0.1 % q; < 1e-4 | 0.030 % / 0.0029 %; 4.7e-15 / 5.4e-8 | PASS |
| L7 | M 0.01 Cp asymmetry | < 0.02 | 0.043 (was 0.35) | FAIL |
| L7 | M 0.01 Cd | < 0.01 | 0.0092 | PASS |
| L7 | iterations M 0.01 / M 0.3 | <= 3 | 0.89 (2081 / 2332; was > 8.6) | PASS |
| L8 | velocity error, M_cut 0.003 (pre-registered) | < 1 % | 40.6 %, unstable | FAIL |
| L8 | plain tracking (reported) | - | 19.0 % | reported |
| L9a | Euler work / convergence | < 1e-4 / 1e-6 of the peak | 7.8e-6 / not converged (limiter) | PASS / FAIL |
| L9b | Rankine-Froude / convergence | < 2 % / 1e-5 of the peak | 0.80 % / not converged | PASS / FAIL |
| f32 | closed-box storage error 1 / 10 / 100 its | <= tol / 10 | 1.9e-7 / 4.4e-7 / 1.4e-6 | PASS |

STUDIES (scratch drivers, reports/scratch; outputs in reports/scratch/out)
- L7 grid at M 0.01 (M_cut 0.01):
  - Asymmetry 0.134 / 0.043 / 0.013 at 24 / 48 / 96 cells (order about 1.7). Cd 0.057 / 0.0092 / 0.0017. 96 x 96 converges in 4625 iterations.
  - The sawtooth is gone. What remains is the rear-stagnation deficit (Cp 0.970 at the rear, 1.013 at the front) plus the equator minimum. The M 0.3 sphere converged to 1e-6 shows the same pattern (0.036), so it is discretisation error.
- L7 M_cut sensitivity:
  - At M 0.01, M_cut 0.005 / 0.01 / 0.02 give asymmetry 0.047 / 0.043 / 0.039, Cd 0.0094 / 0.0092 / 0.0083, and 2080 / 2081 / 2082 iterations.
  - At M 0.3, the scaling itself (M_cut 0.3 against off) moves Cp by up to 5.7e-3 and Cd by 6.2e-4.
- L8 (preconditioned, minMach = M_cut), worst error over 0.2-1 m:
  - M_cut 0.0015: 0.36 %. 0.006: 0.66 %. 0.01: 0.81 %. None reaches 1e-5 (1.9e-5 / 5.9e-5 / 1.2e-4 at 8000 iterations).
  - The axis-row means drop from -7.4 % to -0.3 %, so D4-20 removes the axis error and D4-21 is not needed for it.
  - M_cut 0.0025 / 0.003 / 0.004 grow a large-scale polar mode: the residual reaches 0.1-0.3 of the first and the error 27-88 %. This also happens at CFL 1.0 (more slowly), at 48 polar cells, and with the smooth limiter.
- Far-field duct (precondition.test.ts):
  - With the sharp van Albada, D4-20 converges only while M_cut is above the flow's Mach. At 0.02 it reaches 1e-12, faster than unscaled. At <= 0.015 it cycles at 5e-4 to 4e-3, at any CFL.
  - With central slopes or the smooth van Albada, M_cut 0.01 and 0.005 converge to 1e-12 in 1800 iterations. Pinned as `it.fails`.

CAUSES FOUND
- The sharp van Albada switch (phi = 0 when ab <= 0) causes L9a's stall (the u and p' slopes at a radial extremum behind the disk) and the D4-20 duct's cycling. It is the likely cause of L4b's axis-row stall (untested).
- L7's asymmetry is resolution: it falls 3.3x per refinement and passes at 96 x 96.
- The L8 instability band is unexplained. Candidates: the max(M_local, M_cut) switch sits inside the measured region (1 m/s, which is M 0.003, at r = 0.27 m); or beta > M_ref near the sink because of beta's pressure term.

NEXT
1. If decision (a) allows: the smooth limiter (SOLVER.md 6, in the bitwise-symmetric order above, eps per variable). Then re-run L9a, L9b, L4b and the duct; the `it.fails` should flip.
2. L8's band: try M_ref^2 = M_local^2 + M_cut^2, and M_ref >= sqrt(beta^2), each on L8 at 0.003 and on the duct.
3. If decision (b) allows: L7 at 96 x 96, plus the M 0.3 sphere at 96 x 96 for the iteration ratio.

ORCHESTRATOR DECISIONS NEEDED
- (a) Replace van Albada's ab > 0 switch with the smooth eps form (van Albada 1982)? It is a scheme change beyond D4-20. It is the real remedy for D4-23 and for the D4-20 duct.
- (b) L7 resolution: the asymmetry passes at 96 x 96 (0.013) but not at the pre-registered 48 x 48 (0.043). Should there be a D4-9-style study, with the case moving to 96 x 96?
- (c) L8 fails at its pre-registered M_cut 0.003, inside an unstable band (0.0025-0.004). 0.0015 and 0.006 pass the velocity row but do not reach 1e-5. Investigate (NEXT 2) or reconsider the engine's M_cut?
- (d) Confirm that D4-23's point-implicit Jacobian (nilpotent, no effect) stays out of the contract.

FOR w2/solver (what the kernel must implement; SOLVER.md is the contract)
- D4-20: preconditioned tracking only. mdot's diffusion uses chi / (cbar * fa), with fa = mRef * (2 - mRef) and mRef = min(1, max(qAvg / cbar, machCut)). Physical time uses machCut = 1.
- No swirl Jacobian. The limiter stays the sharp van Albada until (a) is decided.
- The round-2 list stands: RK (0.2, 0.5, 1) at CFL 1.5; the pressure-only wall; the inflow characteristic BC; preconditioning with the dp term and the preconditioned far field (D4-22 accepted); the gauge EOS; positivity per cell and direction; the SLAU2 expression order; skipped axis faces; the 12.2 tolerances.

GOTCHAS
- reports/scratch/ref is a copy of src/flow/reference whose imports are rewritten to ../../../src/ by sed, with VAR switches in muscl.ts (central, first, c<k>, and eps with EPS). Re-copy it before use: cp -f, then the sed.
- Drivers:
  - l7run.ts: mach pre machCut tol cap
  - l7grid.ts: NR/NT env
  - l8axis.ts: MC, CFL, NR, NT, VAR
  - l9adiag2.ts: VAR, CFL
  - ductff3.ts: MC, MM, CFL, VAR
- L8 now runs twice (preconditioned and plain). L4b's cap includes the 2000-iteration window.
- A python heredoc containing apostrophes broke the Bash tool here; use the Write tool for prose files.
- Earlier gotchas still apply (b7eb36d's handoff).

GATES @3560d60
- npm test: 1704 passed + 6 expected fail (83 files; the new expected fail is the D4-20 duct at M_cut = minMach).
- npm run lint: clean. npm run typecheck: clean.
- npm run coverage: passes. Overall lines 99.57 %, branches 88.05 %. src/flow/reference lines 99.49 %, branches 89.11 % (gate 85 %).
- npm run test:mesh: 29 passed.
- npm run test:ladder: 9 files passed, 4 failed (L7 asymmetry, L8, the L9a and L9b convergence rows), 339 s.
- No new dependencies. No GPU, browser, bench or dev server used.
