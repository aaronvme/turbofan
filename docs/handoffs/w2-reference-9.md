w2/reference-9 round 11: DONE. D4-77 is implemented, and D4-63 is NOT closed: the restated rule (b) still fails, for the contract case (2.61x) and narrowly for the linear part (1.09x). No scheme change. (From a1313a3; HEAD = the commit of this handoff.)

DONE (round 11)
- 2d3a592 (TDD) / 8ed4497: `IterationStats.residualDensityL2Volume` in the oracle, sqrt(sum_c bV (R_rho/(bV))^2 / sum_c bV) of stage 1, beside the cell mean `residualDensityL2`. A monitor only: R, the update and every other stat are unchanged. Test: `tests/unit/flow/solver.test.ts` "reports the density residual of stage 1 in both norms" (both norms against a brute-force sum of residual() to 1e-14, plain and preconditioned, with blockage; 0 at rest; the two norms differ). After the TDD commit, its preconditioned branch is taken at the pulse, as in the flux-scale test, because the 10 % wave at M_cut is NaN after 3 iterations. That was a setup fix, not a tolerance change.
- 0a61c73: D4-77 in `tests/ladder/cases/d463.ts`. Row 2 (rule b) is the volume-weighted residual, and the new row 4 reports the cell mean. `d463.test.ts` prints row 4 and keeps `it.fails`. SOLVER.md 10 states the rule in force (D4-72 + D4-77), and 11 defines the monitor.
- 4e7b02a: SOLVER.md 10, D4-77's results, the location, the minMach 0.02 scratch trial, and the candidates.

D4-77 RESULTS (SOLVER.md 10 has the table; `reports/scratch/r11/diag.ts`, logs in `r11/logs`)
- The contract case (1e-3, isothermal; the ladder gives the same numbers): (a) L2(p') 1.717, pass. (b) weighted residual **2.614, FAIL** (3.55 at 100, 9.28 at 1500). Reported: cell mean 11.95, max |p'| 8.39. These reproduce round 9 (2.44 / 5.43 / 12.44).
- The linear part (1e-6, isentropic): (a) 0.505, pass. (b) **1.092, FAIL**: flat at 0.81-1.09 from 200 to 2000. Reported: cell mean 12.19, max 3.57. On round 10's 20k vector the weighted residual is **0.14x** its value at 100, while the cell mean is still 2.10x. So it is non-growing in D4-70's sense, and fails the window only because it decays slowly.
- Where the weighted residual sits (the contract, 1000-2000): the far-field block's interior, 31-55 % (r 2.4-4.7 m, x 1.8-7.9 m, not the outer boundary row). Then plume-bypass, 15-19 %, and plume-outer, 9-14 %. Per unit volume the plume blocks carry 8-12x the mean, and no cell carries more than 2 %. The cell mean sits in the core block instead (40-78 %, V ~ 1e-6).
- Scratch trial, not the contract: minMach = M_cut = 0.02 (D4-59's setting). (a) 0.778: the nonlinear L2 growth is gone. (b) **1.435, FAIL**: flat at 1.2-1.4 from 300 on. Max 4.21, cell mean 15.85.

DECISIONS NEEDED (D4-63)
- (a) Rule (b)'s window. Every run whose energy decays (the linear part, the floored case) fails (b), with a weighted residual that is flat over 1000-2000. A decay-in-the-limit test (D4-70's definition) would separate them from growth, for example: the weighted residual's max over 2000-4000 at most its max over 1000-2000. That is a window change, which D4-70 reserves to a logged decision. The contract would still have to pass it.
- (b) The nonlinear part: its L2(p') goes to 1.72x while the linear part halves, and its residual to 2.6x. The candidates:
  - a beta floor: minMach 0.02 fixes (a) but not (b), and R fails its rule 2 at 0.02 (D4-59). An amplitude-aware beta^2 is the narrower form, not run.
  - a local time-step limit (cap tau where p'/(rho beta^2 c^2) per step is large, or limit tau's neighbour ratio): not run. It cannot change the linear part's transient.

KERNEL MIRROR (for w2/solver)
- No scheme change. beta^2 is unchanged: min(1, max(M^2, minMach^2, K |dp|/(rho c^2))), K = 1, dp the largest |p'_nb - p'_c| over the four face neighbours.
- I19: the kernel takes D4-62 / D4-71's tolerances in its GPU tests only. `tests/gpu/oracle.test.ts` E-L5 / E-L9a `fluxScaleError` against 3e-7 / **1e-10**, and `tests/gpu-ladder/ladder.test.ts` B's residual row against 2e-10.
- New monitor (oracle-side, SOLVER.md 11): `residualDensityL2Volume`. The kernel needs it only if the GPU engine-stability test takes the D4-63 rule (D4-72 + D4-77) once D4-63 is decided. It would be a second reduction in stage 1 (sum R^2/(bV) and sum bV) or a host-side sum over a read-back. `FlowStepStats` (src/contracts/flow.ts) has only the cell mean, so adding it there is a contracts change. Not done here.

NEXT
1. The orchestrator's decisions (a) and (b) above.
2. If (a) moves the window: run the d463 case to 4000 (about 15 min alone, boosted), and flip the pin only if the rule as decided passes.

GOTCHAS
- Scratch (gitignored), `reports/scratch/r11/`:
  - `diag.ts` (env AMP, START iso | isentropic, MINMACH, N, EVERY) is the case's start and norms, plus residual() per block. residual() does not perturb the run, because the next stage 1 recomputes the same.
  - `bin20k.ts` reads r10's 20k vector.
  - `blocks.ts` gives block sizes.
  - `boost.ps1` / `boosttree.ps1` raise only this worktree's node processes: diag runs, and the ladder's forks with their runCase children under this worktree's vitest. The r10 `boost.sh` raises EVERY node process on the machine, so don't use it beside other builders.
- Boosted speed is 216-223 ms/it on 130k (2000 iterations in about 7.5 min). Unboosted it is 680-775 ms/it. With the tree booster the full ladder took 722 s.

GATES @4e7b02a (the src change is the oracle's monitor only)
- npm run typecheck: clean
- npm run lint: clean (ESLint --max-warnings 0, Prettier)
- npm run coverage: 99 files, 1918 passed / 11 expected fail. Lines 99.6 % overall; src/flow/reference 100 %, src/thermo 100 %, src/cycle 99.58 %, src/geometry 99.59 % (781 s)
- npm run test:mesh: 29 passed
- npm run test:ladder: 12 files passed, 3 failed (15). Tests: 13 passed, 3 failed, 1 expected fail (722 s). These are the known failures of record, unchanged:
  - L8: convergence 37500 at the cap. Velocity 0.449 % and steadiness 1.96e-5 pass.
  - L9a: Euler work 8.86e-6, but steadiness 1.062e-5 against 1e-5 (D4-57) and convergence at the cap 20000.
  - L9b: disk 0.80 % and steadiness 2.5e-5 pass, convergence at the cap 20000.
- Ladder table (the main rows):
  - L1 quiescent 0.000; L1 M 0.5 f64 2.0e-13; L2 L1(rho) 0.0028 and shock offset 0.23; L3 0.0021; L4 supersonic 0.0028 and choked 0.0010; L4 shock 0.0164 with steadiness 2.6e-4; L5 8.4e-4 (948 its); L6 3.0e-4 / 4.7e-15 / 2.9e-5 / 5.4e-8.
  - L7 0.0131 falling (0.135 / 0.044 / 0.013), Cd 0.0016, ratio 1.048. The 12.2 C / C-pre / C physical / S rows all pass; floor 1.59e-4 / 1.10e-3.
  - D4-63: signature 12.26 (pass); (a) 1.717 (pass); (b) 2.614 (fail, the expected fail as pinned); reported max |p'| 8.393 and cell mean 11.95.
