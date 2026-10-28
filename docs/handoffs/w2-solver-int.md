w2/solver-int: DONE, gates green except GPU L9a's D4-57 steadiness row (W2R-B2 resolved: the kernel mirrors D4-44). The w2/solver-perf NaN is W2R-I6, the beta / M_ref mismatch, and D4-44 fixes it. (From f875e7a = main c661d5c + w2/solver-perf @5e23c56 + w2/reference @0c87da8; HEAD = this handoff's commit.)

DONE (IDs -> commits)
- NaN (solver-perf FINDINGS 1): ea0cfcd (TDD) / 57687e4. Test: tests/gpu/engine-stability.test.ts. It uses GpuFlowSolver's default on the shipped 130k mesh with the soak's 0.1 % pressure wave at rest (`--amp 0,0,0,0,0.001,0`), runs 100 iterations, and checks every state word finite and max |rho'| < 2x its first.
  - Before: NaN at 10 iterations. After: 0.998 ... 1.510 at 100.
- W2R-I13 (D4-44 in WGSL): b337535 (TDD: the forms) / 57687e4 (the kernel).
- W2R-I14, I15, I16, I9 (my tests): cdf7a14.

THE NaN: CAUSE AND FIX
- Cause: W2R-I6. On the repro's first state, cell 0 (the inflow-axis corner, x -8.21 m, where it went NaN first) has beta / M_ref = 8.9 before D4-44. The wave's 101 Pa jump to the inflow ghost lifts beta^2 by its dp term, beta = 2.67e-2, while M_ref = max(face Mach, M_cut) = M_cut = 0.003 at rest. 94 cells are above 8 and 157 above 4. SOLVER.md 10's 1D limit there is about 0.47, below CFL 0.8.
- Evidence (scratch scripts in test-results/scratch, not committed):
  - The old kernel at CFL 0.8 gives NaN at 10 iterations. At CFL 0.5 / 0.4 / 0.3 / 0.2 it stays finite for 300.
  - The f64 oracle with the pre-D4-44 M_ref put back (one line, a scratch copy) also gives NaN at 10. So it is the scheme, not f32.
  - The oracle with D4-44 stays finite for 300 iterations at CFL 0.8.
  - The kernel with D4-44 follows the oracle's max |rho'| trajectory to 3 digits (0.998 / 0.991 / 0.984 / 0.979 / 0.974 / 0.970 / 0.966 / 1.145 / 1.343 / 1.510 every 10 iterations).
- Fix: D4-44 in the kernel (below).
- NOTE for the orchestrator: with D4-44, the oracle's own run from this state has a large pseudo-time transient. Max |p'| reaches 20x its first by 270 iterations, in block 0 near x -6.9 m, moving towards the axis, and falls back to 3.6x by 300. It is the scheme's, not the kernel's, so the test bound covers 100 iterations only.

W2R-I13: THE D4-44 MIRROR
- A beta pass, `betaKernelWgsl` (one dispatch per tracking iteration with preconditioning, before stage 1):
  - per tile, the p' of the tile and its first ring (a ghost's after its BC, the stage kernel's haloPrim);
  - each cell's beta^2 = min(1, max(M^2, minMach^2, dpMax / (rho c^2))) into a per-cell f32 buffer (binding 11), frozen for the iteration's three stages, like tau.
  - The stage kernel no longer computes beta^2; it reads the buffer.
- The stage kernel:
  - loads beta = sqrt(beta^2) for the tile and its first ring into workgroup memory (wbeta, (TX + 2)(TY + 2) floats). A ghost takes its source cell's beta (`betaSource`: the oracle's ghostSrc, layout.ts source 0, or source 1 for a slip wall's layer-2 ghost). That replaces a separate ghost-copy pass.
  - Each SLAU2 face gets betaFace = 0.5 * sadd(beta_L, beta_R), which is symmetric bitwise.
  - flux.ts: mRef = select(min(1, max(betaFace, machCut)), 1, machCut >= 1), the oracle's guard (W2R-N18). The plain scheme and physical time keep M_ref = 1 bitwise.
- Costs:
  - Storage buffers: 8, 9 with sources (FLOW_SOLVER_LIMITS' 9: the solver-perf question 3 is answered, keep 9). Packed: 7 / 8.
  - Workgroup memory: 16272 B at 16x8 (Chrome's default limit is 16384).
  - One dispatch more per iteration. Indicative only (Dawn, `tools/perf/dawn.ts profile --reps 20`, under load): the beta pass is 0.111 ms, the stages 0.346 / 0.328 / 0.396, one pass 1.17 ms/it. Solver-perf measured 1.04-1.09, so this is about +0.1 ms/it (10 %). Not measured in Chrome.
- Rows against the new oracle (Dawn):
  - C-pre 5.13e-7 / 4.51e-7 / 1.72e-6 (main's kernel: 1.5e-2 after 1);
  - S 4.59e-7 / 2.90e-7 / 1.20e-6;
  - moving duct, preconditioned: 3.04e-7 / 3.43e-7 / 3.65e-6;
  - S at u_inf 20: 2.07e-6 / 4.31e-7 / 5.05e-7;
  - forms 14.3-14.5 at machCut 0.003, with a random betaFace (log-uniform 1e-3..1): <= 4.5e-8 (main's kernel: 3.0e-3);
  - f32forms (npm test) passes with betaFace.
- MUTANTS (scratch runner test-results/scratch/mut/mutants.py: one exact replacement in the worktree, then the targeted GPU tests, then `git checkout`). 7 of 8 are KILLED:
  - ghost beta = 1: C-pre and the moving duct;
  - face beta from one side only: C-pre, S, the moving duct, S at 20 m/s;
  - M_ref from the face Mach (pre-D4-44): those four, plus forms 14.3-14.5 and engine-stability;
  - beta^2 used as beta (no sqrt): five rows, engine-stability among them;
  - the beta pass without its dp term: C-pre, S, S at 20 m/s;
  - the stage ignoring the pass's beta^2 (beta^2 = 1): five rows, engine-stability among them;
  - the beta pass on the wrong copy (U^(2) instead of U^n): four rows.
  - EQUIVALENT: a ghost's beta from the other source, i.e. r0.y and r0.x swapped. They differ only for slip-wall ghosts, whose faces carry the pressure-only wall flux and never read beta.

I14-I16, I9, I11 (cdf7a14)
- I14: ladder.test.ts PLATEAU = GPU_CONVERGENCE_FLOOR (1.6e-4 / 1.1e-3). The KNOWN-FAIL comments give the gap: 3.99e-4 is 2.5x the floor, 7.54e-3 is 6.9x.
- I9: the L4a/L5 KNOWN-FAIL pins gain companions: a finite residual, below 10x the floor.
- I15:
  - fluxScaleError is `ref.residualFluxScale()` (every block). The numbers are unchanged: E-L5 2.67e-8, E-L9a 2.46e-12.
  - The E rows assert 12.2's form of record (<= 1e-3).
  - The over-residual `it.fails` (E-L5 1.05e-3) is retired, so test:gpu has no expected fails now.
  - Row B gets its residual row over the flux scale.
- I11: on E-L5 the 1e-3 row cannot fail (r_flux / r_ref ~ 4e4). Round 2's tighter 1e-6 check stays beside it, as does E-L9a's over-residual check. B's row reports r_flux / r_ref and the over-residual value; no new tolerance was added (question ee).
- I16:
  - steadyWindowGpu mirrors the oracle's steadyWindow: 2000 more iterations after the stop, sampled every 100, spread max - min, the value of record the last sample. It replaces max |v - v_end| over the window before the stop.
  - The L9a/L9b rows are labelled with their 20000 cap (D4-56), and L8 keeps 37500.
  - Result: the GPU L9a value row now FAILs on D4-57's steadiness rule, 1.31e-5 against 1e-5 (the oracle's own is 1.062e-5: FAIL too). Under the old reading (max |v - v_end| before the stop) it passed at 7.1e-6. The value itself is 3.6e-6 against 1e-4. Not pinned: D4-57 keeps the row visible. That makes test:gpu-ladder red, see DECISIONS (hh).
- Also 1cd4f3b: solver-exact's D4-50 packed test. On a default-limits (8) device the engine with sources now packs (bitwise equal to unpacked), and with the face dump it throws "needs 10 storage buffers (9 packed)".
- Also d75bc88: tools/perf/solverPerf.ts's timing-state comment (after the fix).

DECISIONS NEEDED
- (dd, critic pass 9) The merge order. This branch is option (1): the kernel's D4-44 round on top of w2/reference and w2/solver-perf. It needs the critic's review of solver-perf (unreviewed) and of this round.
- (hh) The GPU L9a value row FAILs D4-57's steadiness, as the oracle's does. Pin it KNOWN-FAIL citing D4-57 (a passing companion with the value < 1e-4 and finite), or keep test:gpu-ladder red like the CPU ladder's visible FAIL rows?
- (ee, critic pass 9) The flux-scale rows cannot fail at 1e-3:
  - r_flux / r_ref is 3.9e4 on E-L5 and 1.15e10 on B. B is over the flux scale 1.27e-11, and over r_ref 0.145 (r_GPU 4.37e-6 against r_ref 3.81e-6).
  - E-L5 keeps round 2's 1e-6 check beside it. B has none, because adding a tolerance is the orchestrator's call.
- (ii) The scheme's slow growth from a 0.1 % wave at rest on the engine mesh (NEXT 3): a reference-round item?
- Flagged edits:
  - stageStorageBuffers' count (+1: beta^2) and the stage kernel's binding 11;
  - FLOW_SOLVER_LIMITS stays 9, now needed: solver-perf's question 3 is answered, keep 9;
  - GpuSolver has a new 'beta' pipeline.
  - No contract file changed.

NEXT
1. The critic's re-review of w2/solver-perf + this round (W2R-B2), then the merge order (question dd).
2. The pseudo-time transient above (20x at ~270 iterations from a 0.1 % wave): does the app's settling see it? The engine starts from rest, so watch the app's first seconds.
3. The soak states with D4-44 (`tools/perf/dawn.ts soak`) are all finite for 1000 iterations: the hot plume (amp 0,300,0,0.025,0,0; before: NaN by 100), the timing state (the defaults; before: NaN at 150-200) and the 0.1 % wave.
   - The wave does not decay, though. Its max |rho'| is 1.5x its first at 100 iterations, 10x at 1000 and 13.6x at 2000, still rising slowly.
   - Its max |p'| on the kernel is the oracle's to 4 digits through 300 iterations (2.439 / 5.427 / 19.59 / 3.645 at 100 / 200 / 270 / 300). So it is the scheme's, not the kernel's.
   - For the reference round: a slow growth from a disturbance at rest on the engine mesh at the engine settings (perhaps D4-27's polar mode, or W2R-I12's beta jump). The oracle was checked to 300 iterations only.
4. Solver-perf's owed items: P1 in the app scene (its NEXT 1), docs (spikes/README, GPU_FACTS tile sweep), A-I3.

GOTCHAS
- The beta pass reads U^n, the copy of parity `roles[0]`. A beta from the stage's input copy at stages 2/3 would not be the frozen one; the stage kernel reads the buffer at every stage.
- wbeta is (TX + 2) x (TY + 2). Only the tile and its first ring are valid, `ringOf(t)` maps a halo index there, and corners are never read.
- Workgroup memory is 112 B under Chrome's 16384 at 16x8. A bigger tile or one more workgroup array needs `maxComputeWorkgroupStorageSize` requested (the app does not request it).
- Python on Windows writes CRLF in text mode. Write files with newline='' or in binary (.gitattributes is eol=lf).
- A hook (Fact-Forcing Gate) stops `rm -rf`; state the files, the rollback and the instruction.
- Port 5189. Nothing is left running.

GATES @d75bc88 (the code; later commits are this handoff only). One suite at a time, on a loaded machine (Aaron gaming, on battery), so the durations are indicative.
- npm run typecheck: clean. npm run lint (ESLint + Prettier): clean.
- npm run coverage (= npm test with coverage): 98 files, 1901 passed + 11 expected fail (777 s).
  - Lines 99.59 %, statements 98.70 %, functions 99.64 %, branches 87.68 %.
  - src/flow/reference 100 %, src/thermo 100 %, src/cycle 99.58 %, src/geometry 99.59 %, src/flow/gpu 99.74 % (lines).
- npm run test:mesh: 29 passed.
- npm run test:gpu: 11 files, 60 passed, 0 expected fail (42 s). Main's kernel on the merged oracle: 5 failed.
- npm run test:gpu-ladder: 12 tests, 11 passed, 1 FAILED (340 s). The failure is L9a's value row on D4-57's steadiness (above, (hh)). Every other row passes, at the values of round 3:
  - L1: 2.13e-5;
  - L7: 0.0131 / Cd 0.00159 / ratio 1.048;
  - L8: 0.449 %, steady 1.96e-5;
  - L9b: 0.80 %, steady 3.4e-5;
  - B: 1.95e-5 against the oracle's 1.49e-5, with its residual row 1.27e-11;
  - L2-L6 as before.
  - L4a/L5 stay KNOWN-FAIL (3.64e-4 and 4.91e-3 at 8000, against 1.6e-4 and 1.1e-3), and their companions pass.
- npm run test:ladder (CPU): 14 files, 11 passed, 3 failed (885 s). L8, L9a and L9b fail on their convergence rows, and L9a also on D4-57's steadiness (1.062e-5). That is the same as critic pass 9's run at the reference tip.
- npm run test:browser: 9 files, 25 passed (port 5189, `--browser.api.port=5189 --browser.api.strictPort`). Nothing left running.
