w2/solver round 3 (santa-loop fix round, D4-53): DONE except A-I3 (Chrome numbers, see the table). Each reviewer re-verifies its own IDs.
- B1 fixed: the trial merge `git merge-tree --write-tree main HEAD`, exported and typechecked, is clean (81e9508's trial merge gives B1's TS2345).
- Every surviving WGSL mutant of both reviews is now killed by test:gpu, except A-M5 (equivalent).
- Round 2's content (the L1 table, the 12.2 rows, the term -> WGSL map, timing) still holds: `git show 81e9508:docs/handoffs/w2-solver.md`. The 12.2 numbers are unchanged bit for bit.

(Round 3 from 81e9508. HEAD = this handoff's commit.)

ID -> COMMIT
| ID | what | commit / reason |
|---|---|---|
| B-B1 | merge typecheck | 3cfbe06 (TDD) / d874978: `LimiterKind = 'sharp'` (the oracle's vocabulary; 'smooth' comes with D4-36, and fluxWgsl throws for an unimplemented kind); row A names `gas`, `freeStream`, `lowMachPreconditioning` instead of spreading SolverOptions |
| B-I1 | mutants of real terms | 9387657 (tests/gpu/oracle-moving.test.ts: every BC's ghosts at u_inf 100 on random states; a duct moving with u_inf with a blockage bump, plain and preconditioned; E-L5 at 60 m/s with its inflow ghosts; S at 20 m/s); fc1cca5 (TDD) / 141639c (tests/gpu/forms.test.ts: B's probe tests moved in, + 14.2 and 14.6a); 77bed04 (TwoSum, both records) |
| B-I2 | §14 tests on the WGSL; 14.6(a) | fc1cca5 / 141639c: the probes call the kernel's own WGSL functions. The residual is one function, `cellResidual`, which the stage kernel and probeResidual share (the numbers are bitwise unchanged); probePrecondition calls `preconditionIncrement`. 14.6(a): fluxes cancelling to 1e-6 / 1e-5 of their size give the exact sum of the f32 terms (0 ulp seen, limit 8; uncompensated ~1e5 ulp). The E-L5 over-residual `it.fails` pin stays until reference round 7 rewrites E/B (D4-48) |
| B-I3 | resample in the budget | d785f93 (TDD) / 1be863f: `observe(n, solverMs, resampleMs)`; n = floor((budget - resample) / ms), ceiling floor((7 - resample) / ms); `FlowStepStats.gpuTimeMs` = solver + resample (contract doc, flagged) |
| B-I4 | throughput | D4-54: the post-merge performance round (official P1 under D0-1) |
| B-I5 | D4-45, plateau wording | db3c57f: L8/L9 caps 37500; the value rows PASS only when steady to a tenth of the tolerance over the last 2000 its; a detected plateau needs < 10 % fall per 2000 its |
| B-I6 | D4-50 | a3bfa83 (TDD) / 837e7ab: `FLOW_SOLVER_LIMITS` + `preferredLimits` in src/gpu/device.ts (min of the want and the adapter, so the request never fails). `GpuSolver` checks `device.limits` (layout.ts `stageStorageBuffers`); on an 8-buffer device it packs geo + topo into one binding (bitwise equal to the unpacked: a Dawn test on a default-limits device); short by more, it throws "needs N storage buffers ... request maxStorageBuffersPerShaderStage". engineView.ts is not touched (main changed it): w2/app-ui passes `preferredLimits: FLOW_SOLVER_LIMITS`. GPU_FACTS M1 has the Arc's 16 (Dawn); Chrome's adapter value is not recorded (A-I3's test was to print it) |
| B-N1, A-N1 (CFL) | import main's DEFAULT_CFL_PRECONDITIONED | after the merge: the branch's oracle has no such export |
| B-N2, A-N1 (comments) | stale KNOWN-FAIL numbers | 196954c |
| B-N3, A-N6 | a real device loss | b081663: device.destroy() under the solver gives lost, 0 iterations, and the snapshot publishes; device.lost keeps an earlier message (`??=`) |
| B-N4 | fields() after dispose | b081663 |
| B-N5 | physical mode's double prim + ghost | skipped: the same change as D4-54's prim-reuse item |
| B-N6, A-I6 | settle window | db3c57f: the largest change over every sample of the window |
| B-N7 | cfl < 0 | 196954c + the STOP-CLEAN commit: a negative or non-finite CFL throws; 0 stays legal (solver-exact's M 0.5 test freezes tau with it) |
| B-N8 | source stage time | noted: the built-in model is time-independent; W3's scheduled sources need t, t + dt, t + dt/2 per stage (main's W2R-N3) |
| B-N9 | M_ref from the face's beta | follows reference round 6 (D4-51) when it merges |
| B-N10 | moving-reference rows | 9387657: the rows use flows that move with u_inf, as B suggests; margins 20-100x (below) |
| A-I1 | resample values | b081663: tests/gpu/flow-solver.test.ts, a smooth state with swirl and fuel at u_inf 40 m/s (`GpuFlowSolverOptions.freeStreamVelocity`, default 0); every texel of both extents against the host map on readPrimitives, to f16 |
| A-I2 | u_inf != 0 rows | 9387657; probeFlux values at u_inf 170, machCut 1 and 0.003 (fc1cca5) |
| A-I3 | numbers in Chrome | NOT DONE: tests/ladder/oracle.ts pulls in node:fs (the ladder's report writer), so the oracle does not load in the browser suite. It needs a browser-safe split of the oracle shell first. Chrome still shows 0 errors and the timing |
| A-I4 | resample in the budget | as B-I3 |
| A-I5 | TwoSum low part | 77bed04: the sub-ulp test on rho' as well as rho Z, in both modes |
| A-I7 | L8/L9 under D4-45 | as B-I5 |
| A-I8 | D4-48 / D4-50 / D4-44 | (a) waits for reference round 7; (b) as B-I6; (c) as B-N9 |
| A-I9 | throughput | as B-I4 |
| A-I10 | status channel | 5c3a5b3: `FlowSolver.status()` and `reportGpuError()` (a minimal contract edit, flagged; there is no mock FlowSolver). The app routes SimDevice's onError to reportGpuError |
| A-N2 | "KNOWN-FAIL (D4-47)" in the row text | skipped (out of round time): the comments say it, the JSON rows do not |
| A-N3 | 14.2, all six components | fc1cca5 / 141639c (probePrecondition) |
| A-N4 | setConserved length; init cleanup | skipped: a short array writes NaN, which the next readback reports as diverged; init's partial buffers go with dispose() |
| A-N5 | scheduler reset on setMode | skipped (small, next round) |
| A-N7 | device/** coverage exclusion | for the merge note: src/flow/gpu/device/** is covered by test:gpu, as in round 1 |
| A-N8 | stageWorkgroupBytes against the device | skipped: with D4-54's tile re-sweep |
| A-N9 | GPU_FACTS: fma, compensated sums | skipped: the evidence is tests/gpu/solver-exact (interfaces) and tests/gpu/forms (14.6a) |

MUTANTS
- Method: a scratch runner on a `git archive HEAD` export inside test-results/ (never the worktree's files). Each mutant is one exact replacement from the reviewers' scripts, then the whole test:gpu.
- Previously surviving, now KILLED:
  - B: g-term, positivity-p, neumaier (new text: `return Flux(acc.sa + acc.ca, ...)` -> `acc.sa`), precond-u, farfield-a, inflow-uinf, wall-uinf, twosum-lo (= A-M4), outflow-switch;
  - A: M2b, M2c, M3 (new text: `vec4f(mInf * flowSx, ...)` negated).
- Still killed: B beta-sum, beta2-dp (= A-M6), swirl-src, twosum-lo-b; A-M1, A-M2.
- A-M5 (M_ref without min(1, .)): equivalent. chi = 0 wherever qAvg >= cbar; only the 0/0 at exactly qAvg = 2 cbar differs.

NEW ROWS (Dawn)
- Ghosts at u_inf 100 m/s against the oracle (limit 1e-5), worst per BC:
  - wall 1.3e-7, outflow 1.3e-7, inflow 8.2e-8, axis 8.2e-8;
  - far field 8.7e-8 plain, 8.2e-8 preconditioned (beta_inf^2 = M_inf^2);
  - the outflow column spans vn < c/2, c/2 to c, and > c.
- The duct moving with u_inf 100 (blockage bump): plain 4.3e-7 / 5.5e-7 / 1.0e-6; preconditioned 3.7e-7 / 3.9e-7 / 3.7e-6.
- E-L5 at 60 m/s 3.3e-6 (inflow ghost u 6.7e-8). S at 20 m/s 1.9e-6 / 4.4e-7 / 5.9e-7.
- WGSL forms: SLAU2 <= 5e-8 (machCut 1 and 0.003; 48-61 expansions and |M| > 1 faces each); gas <= 9e-7; slopes 2.1e-7 with 22 pressure fallbacks; 14.2 <= 7.6e-7; 14.6(a) 0 ulp; the add-back 5.5e-8.
- GPU ladder under D4-45:
  - L8 0.447 % at 37500 its, steady (moved 6.1e-5, limit 1e-3; the oracle gives 0.449 %);
  - L9a 7.17e-6, steady (moved 7.1e-6, limit 1e-5: a thin margin);
  - L9b 0.80 %, steady (8.4e-5, limit 2e-3).
  - The D4-38 rows stay `reported`.

DECISIONS NEEDED
- None new. Flagged contract edits: `FlowSolver.status()` / `reportGpuError()` (A-I10) and the `gpuTimeMs` doc (the whole frame, B-I3).

NEXT
1. A-I3: make the oracle shell browser-safe (tests/ladder's node:fs report writer), then run row C and the interface dump in Chrome and record the adapter limit.
2. D4-54's performance round: prim reuse (which also does B-N5), the ghost merge, a slim halo, and the tile re-sweep (with A-N8).
3. After the merge: B-N1, reference round 7's E/B rows (D4-48), D4-51's M_ref.

GOTCHAS
- The residual is `cellResidual` in wgsl/kernels.ts `UPDATE_WGSL`, shared with the probes. The reviewers' neumaier and M3 mutant strings moved there.
- Packed mode (D4-50) reads topo through `topoAt` everywhere: never index `topo[` directly.
- Browser tests cannot import tests/ladder/oracle.ts (node:fs).
- I used port 5189 for my own browser run. Nothing is left running.

STOP-CLEAN at the usage limit (84 %): this is the last commit of the round.

GATES (code at 196954c + the STOP-CLEAN fix of the CFL check)
- npm run typecheck: clean. npm run lint (ESLint + Prettier): clean.
- npm run test:mesh: 29 passed.
- npm run test:gpu: 10 files, 56 passed + 1 expected fail, and 1 failure (solver-exact's M 0.5 free stream used cfl 0, which B-N7's first check rejected); after the fix solver-exact passes alone (12 passed). A full rerun is owed.
- npm run test:gpu-ladder: 2 files, 12 passed (at db3c57f; later commits do not touch the ladder's code).
- npm run test:browser: 6 files, 22 passed (port 5189).
- npm run coverage and npm test: the coverage run was still going at STOP-CLEAN (machine shared with the mutant runs). Not reported; owed.
- Mutants: the round's first full run (all-1) and the HEAD run (all-2) were partial at STOP-CLEAN; each killed mutant above was verified (oracle-moving, forms, solver-exact and flow-solver runs). twosum-lo, M2b and M2c were verified killed by their new tests only in the targeted runs of this round's tests: the reviewers should re-run them.
