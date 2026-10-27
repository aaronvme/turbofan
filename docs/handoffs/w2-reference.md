w2/reference: round 5 DONE with open items (from 28fb768; HEAD = the commit of this handoff). W2R-I2/I4 DONE at c1094fc (w2/solver unblocked). D4-32 decided by its rule: preconditioned CFL 0.8, no p_u. D4-34: W2R-6 located (the sharp limiter's switch). D4-33: the smooth limiter is NOT ready as the default (L8, L1). D4-26: L7 at 96 x 96 passes in scratch; the ladder run of record is in GATES below.

DONE (IDs -> commits, round 5)
- W2R-I4 f8d539a: SLAU2 value tests in slau2.test.ts. Six unequal state pairs (a subsonic jump with m < 0, an expansion with g != 0, swirl with large rho' at r_f != 1, a transonic face at the M-hat clamp, D4-20 below and above M_cut) are checked against an independent evaluation of the paper formulas. The evaluation uses absolute variables of a calorically perfect gas and none of the module's gauge code, at 1e-12 relative, both ways round. Also: physicalFlux after an unrelated flux, and the zero-area face over a NaN-filled output. Stryker on slau2.ts with slau2.test.ts alone: 98.80 % (164 killed; the 2 survivors are the equivalent |M| >= 1 -> > 1).
- W2R-N6 f8d539a: per-call side records in slau2.ts.
- W2R-I2 cd45726 (SOLVER.md first) / e03f2c9 (TDD) / c1094fc "W2R-I2/I4 DONE".
  - tests/ladder/oracle.ts exports the 12.2 set-ups that both the f32-storage experiment and the GPU tests import: closedBoxMesh (f32 metrics), closedBoxOptions('tracking' | 'preconditioned' | 'physical'), smoothPerturbation, sinkCase (L8; l8.ts uses it too), relativeError (a field the oracle leaves at exactly 0 must stay exactly 0).
  - SOLVER.md 12.2 states every row's mesh, plus the new rows C-pre (the closed box at the engine's minMach = M_cut = 0.003) and S (L8's sink, preconditioned).
  - Measured storage errors after 1 / 10 / 100: C 1.7e-7 / 1.1e-6 / 7.8e-7; C-pre 1.1e-7 / 1.7e-7 / 5.1e-7; C physical 8.0e-8 / 2.4e-7 / 4.2e-6; S 7.3e-8 / 1.8e-7 / 6.3e-7. That is 59-2000 x below the tolerances.
- D4-32 (W2R-I3) cd45726 / e03f2c9 / c1094fc / 7faa5ef / 2252ed6 / 413b623 / 02c3323.
  - acoustic.ts (eigenvalues once per case) is pinned in rk.test.ts: plain 1.236; matched preconditioned 0.972 (1D) / 1.550 (square), independent of beta; with p_u K_u 0.5 1.413 / 1.958.
  - DEFAULT_CFL_PRECONDITIONED = 0.8 (minMach < 1; minMach >= 1 keeps 1.5). Found: C-pre at CFL 1.5 goes to NaN at iteration 79.
  - The p_u trial (AUSM+-up, K_u 0.5, option lowMachPreconditioning.velocityDiffusion, default 0): L8 1.38 % at CFL 1.15 and 2.27 % at 0.8 (0.36 % without; NaN at 1.5); L7 Cd 0.0117 (FAIL; 0.0096 without); C-pre NaN at 758 at 1.15. So, by D4-32's rule: 0.8 without p_u. p_u is NOT in the contract; the option stays in the oracle for the record.
  - L2/L4 run plain, and p_u is off there by construction.
- D4-34 (W2R-6) 84002b0, SOLVER.md 8 (tables there).
  - p_u does not remove W2R-6. In preconditioned tracking the duct is already stable. In the plain scheme (f_a = 1), p_u moves the steady state by 16 %.
  - The power-iterated mode is acoustic, x 20 per 80 SSP-RK3 steps (sigma ~ 590 1/s ~ c/L).
  - Term switches (scratch: reports/scratch/r5/w2r6.ts on reports/scratch/ref5):
    - Removed by: first-order, zero p' slopes, zero u slopes, central p' slopes, b_f = min(b_L, b_R), and the smooth limiter (24 x 6 cells; at M 0.35 with v kept sharp).
    - Not removed by: zero rho' or v slopes, or the pressure force as b_c grad p.
  - The plain steady state has a +-50 Pa grid-scale pressure sawtooth at the throat (plain SLAU2 at M 0.06). At those extrema the sharp van Albada switches, and its linearisation grows.
  - Not fixed in the contract (see decisions). The it.fails pins stand.
- D4-33 eb89898 (SOLVER.md 6): the smooth limiter as the default of every case (an uncommitted experiment, the full ladder and the flow suites).
  - Fixes: L9a converges (3428 its to 1e-6) and L9b converges (6169 its to 1e-5); W2R-6 goes away.
  - Keeps: L2 (0.29 %), L3, L4a, L4b, L5, L6 and f32 green.
  - Breaks: L8 (27-30 % at CFL 0.4, 0.6 and 0.8, i.e. independent of the CFL, so semi-discrete); L1's uniform M 0.5 growth row (round-off grows at the plain CFL 1.5 > 1.236, the central-slope acoustic limit); four unit tests (the 24 x 3 annulus does not converge because v at noise level is reconstructed centrally; solver.test's plain low-Mach duct).
- D4-26 9589a0b (PHYSICS.md 3.3 first) / 3c9e7c9.
  - L7's pass rows run at 96 x 96. The M 0.01 sequence 24 / 48 / 96 is reported and must fall monotonically. The plain rows stay at 48 x 48.
  - The seven sphere runs go in parallel child processes (tests/ladder/sphereRun.ts). The ladder test timeout is now 30 min.
  - Scratch at CFL 0.8: asymmetry 0.135 / 0.0437 / 0.0131 (order 1.62, 1.74); Cd 0.057 / 0.0096 / 0.0016; iterations 8675 (M 0.01) / 8280 (M 0.3), ratio 1.05.
- W2R-N1 068b955 / 7d58197: setBlockage throws on b outside (0, 1], on NaN or on a short field.
- W2R-N2 7d58197: SOLVER.md 5 says a ghost's T' and c are don't-care.
- W2R-N3 f9f8d73 / 9080a64: SSP-RK3 gives the sources each stage's time (t, t + dt, t + dt/2).
- Earlier: W2R-B1 9d99b04; W2R-I1 (the smooth form as an option) 1d85b0c / 485b69a / 28fb768; W2R-N5 485b69a; W2R-1..14 in earlier handoffs.

OPEN
- W2R-6: the it.fails x 3 in blockage.test.ts are still KNOWN-FAIL. Cause found (above); no fix in the contract.
- L8 at CFL 0.8: velocity 0.36 % PASS, but it does not converge to 1e-5 in 20000 (3.9e-4 of the first). This is likely the sharp limiter's floor (critic pass 7).
- L4b convergence row (0.15 of the first; reported); L9a/L9b convergence rows FAIL (the sharp limiter).
- W2R-N4 (keep L4b's D4-19 samples; an offset-shock start): not done.

ORCHESTRATOR DECISIONS NEEDED
- (a) The limiter (D4-33/D4-34). The sharp form causes W2R-6 and the L9 stalls. The smooth form (K_eps 1e-3) fixes both but breaks L8 (semi-discrete) and needs a plain tracking CFL <= 1.0 (0.8 x 1.236). Options:
  - (i) keep sharp; accept W2R-6 into W3 with a workaround (not recommended: physical time is the event mode);
  - (ii) smooth with a smaller K_eps (1e-4 / 1e-5), plus plain tracking CFL 1.0, re-tested on L1/L8/W2R-6/L9;
  - (iii) smooth for p' and u only (the W2R-6 variables) and sharp for rho', v, rw, Z.
  - My proposal: (ii) or (iii) as the next trial, with L8 as the gate.
- (b) b_f = min(b_L, b_R) also removed W2R-6 (M 0.06 and 0.35). Worth a decision only if (a) fails: it is first order in b.
- (c) p_u stays out. Should the option be deleted from the oracle, or kept as the record?

FOR w2/solver
- Implement NOW (SOLVER.md at HEAD): everything round 4 listed, plus:
  - the preconditioned tracking default CFL 0.8 (minMach < 1);
  - the 12.2 rows A, B, C, C-pre, C physical, D, E, S, with tests/ladder/oracle.ts imported for the set-ups, the perturbation and relativeError;
  - the stage times for sources;
  - the setBlockage range check.
  - Ghost T'/c need not be filled.
- Do NOT implement: p_u; the smooth limiter (the sharp form stays the contract until decision (a)).
- LATER: the limiter decision (it may change section 6 and the plain CFL); any W2R-6 fix (section 8).

GOTCHAS
- Parallel `>>` appends from several Git-Bash background processes overwrite each other (MSYS has no atomic O_APPEND). Give every process its own log file.
- reports/scratch/ref5 is a scratch copy of the oracle with env switches. VAR: first, first<k>, central<k>, firstuv, smoothnov, bcp, bfmin. globalThis.KUP is p_u in the plain scheme. Drivers: r5/w2r6.ts (MODE, OUT, N, NJ, LIM, CFLPRE, CAPPRE, FF, UINF, MODEDUMP), r5/trial.ts (CASE l7 | l8 | cpre, KU, CFL, LIM, MACH, NR/NT).
- A Bash hook blocks `rm -rf` ("Fact-Forcing Gate"). Use new folder names instead.
- With the smooth limiter, machCut-1 preconditioning (a test configuration) needs CFL <= 0.4 (limit 0.475 at beta 0.06).
- The ladder takes much longer now: L7 at 96 x 96 runs about 8700 iterations at CFL 0.8 (more under load).

GATES: see the GATES block (filled in at the end of the round, at the hash it names).
