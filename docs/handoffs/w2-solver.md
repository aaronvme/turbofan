w2/solver: STOP-CLEAN (orchestrator, usage cap). The GPU solver runs and meets SOLVER.md 12.1 and the 12.2 oracle rows, with three KNOWN-FAILs that need decisions. Not done: test:browser, the smooth limiter, L7-L9 on the GPU, timing inside the app. (from 7fd5f95; HEAD = this handoff's commit, code at 978ddf2)

DONE
- 33b6765 (TDD) / 8da168b, W1F-I1 (D2-6). CONTRACTS EDIT, for the critic: `src/contracts/sim.ts` `sanitizeFlowStatus`.
  - A failed status with an empty or null message now gets `FLOW_DEFAULT_ERRORS` instead of making nextSnapshot throw.
  - A non-finite gpuTimeMs on its own becomes null and the status stays as it was. Only the residual, the counters or the reduction mark divergence.
  - Two pinned tests in `tests/unit/contracts/sim.test.ts` were rewritten to match the decided behaviour.
- 6b1a699 (TDD) / 9e9aa01, D4-2 scheduler, `src/flow/gpu/scheduler.ts`.
  - `solverBudgetMs` = min(5, 15 − render − visuals). A measurement that is missing or non-finite counts as 0.
  - `IterationScheduler`: an EMA of the timestamp ms/it, a floor of 2 iterations, and the L13 7 ms ceiling, which wins over the floor (never below 1 iteration). maxIterations 0 pauses the solver.
- e04d887 (TDD) / d1925db, the kernel in `src/flow/gpu/`.
  - Pure modules:
    - `layout.ts`: geo/topo buffers and blockage sums, f64 → f32 as in the oracle.
    - `params.ts`: one field list generates both the WGSL struct and the packer.
    - `wgsl/gas.ts`: generated from GasModel / GAS_TABLES, with series log1p/expm1.
    - `wgsl/flux.ts`: SLAU2 plus the sharp van Albada behind `LimiterKind`.
    - `wgsl/boundary.ts`, `wgsl/kernels.ts`.
  - Device code: `device/gpuSolver.ts`.
  - Per stage the passes are prim → ghost (interface ghosts are bitwise copies) → [sources] → a fused 16×8 stage kernel (halo, slopes, one face-flux call site, residual, dt/β², update, residual partials). Physical dt is reduced on the GPU and the clock is a Kahan sum.
  - fma-proof L/R sums: `sadd` = max + min, and a sorted limiter denominator.
- 3a5fb27 (TDD) / 526837f, oracle comparisons (orchestrator go; `tests/ladder/oracle.ts` copied verbatim from w2/reference c1094fc). Two f32 fixes, both algebraically identical to SOLVER.md and needing its text updated (decision e):
  - **R(φ) − R∞ is computed as φ(R_p − R_a)** (`gasRDelta`). `gasR(φ) − R∞` cancelled in f32 and put an error of 3e-8 p∞ into every p′.
  - **A cancellation-free preconditioned density increment**: n + β²(δρ − n), with n the non-acoustic part (comment in kernels.ts). The literal order lost about 1e-7/β², which gave 2.7e-2 on S.
  - Also `DEFAULT_CFL_PRECONDITIONED` = 0.8 (mirrors c1094fc), and the built-in cell source model (constant, ρ-proportional, kU·U, a mass sink at the local h0).
- 8883b02, the GPU ladder: `npm run test:gpu-ladder` (`vitest.gpuladder.config.ts`, `tests/gpu-ladder/`).
- 2011ca8 (TDD) / c7f28a5 (TDD) / 978ddf2, the contract layer.
  - `resampleMap.ts`: point location, cell-centred bilinear weights across interfaces, fluid fraction from the centre and corners.
  - The resample kernel writes 4 rgba16float textures. Out-of-domain texels are the exact ambient.
  - `device/flowSolver.ts` implements FlowSolver.
  - `status.ts`: solverFlowStatus (W1F-I1), and snapshotSources (W1F-N1: copied from the CycleModel and FlowField sources).
  - `device/timestampRing.ts`.
  - `vitest.config.ts` excludes `src/flow/gpu/device/**` from unit coverage, because test:gpu covers it. Flag for the critic.

12.2 ORACLE ROWS (Dawn, tests/gpu/oracle.test.ts; after 1 / 10 / 100 iterations)
- A: the 130k ambient stays bitwise 0 in plain, preconditioned and physical modes.
- C tracking: 5.3e-7 / 2.8e-6 / 1.1e-5.
- C-pre (CFL 0.8): 1.2e-6 / 6.6e-7 / 4.9e-6.
- C physical: 2.5e-7 / 6.8e-7 / 1.0e-5.
- D, Sod L1: 7.7e-7 (ρ′), 8.4e-7 (p′).
- E (10 iterations): L5 4.3e-6, L9a 7.4e-6.
- S, the sink: 3.1e-6 / 1.3e-5 / 4.9e-5.
- B (gpu-ladder): GPU 1.1e-4 against oracle 1.5e-5. 7.4×, within the 10× allowed.
- Residual within 1e-3 everywhere except **E-L5: 1.5e-3 (KNOWN-FAIL `it.fails`)**. The f64 residuals of the two states already differ by 2.5e-3, so this is state sensitivity, not the f32 evaluation.

GPU LADDER (Dawn, 2026-10-27)
| case | metric | threshold | GPU | result |
|---|---|---|---|---|
| L1 | quiescent, 130k asset, 20k its | < 1e-4 m/s, bitwise 0 | 0, bitwise | PASS |
| L1 | uniform M 0.5, 130k f32 asset, 20k its | < 1e-4 m/s | 2.0e-4 (1.1e-4 at 25 its) | **KNOWN-FAIL (a)** |
| L2 | Sod L1(ρ) / shock offset | < 1% / ≤ 1 cell | 0.28% / 0.23 | PASS |
| L3 | radial Sod L1(ρ) | < 2% | 0.21% | PASS |
| L4a | Mach / choked mass flow | < 1% / < 0.5% | 0.28% / 0.10% | PASS |
| L5 | mass flow | < 1% | 0.084% | PASS |
| L4a, L5 | converged to 1e-5 within 8000 its | 1e-5 | stalls at 3.9e-4 / 5.1e-3 | **KNOWN-FAIL (b)** |
| L6 | radial equilibrium / ang-mom drift, free vortex | < 0.1% / < 1e-4 | 0.030% / 4.4e-6 | PASS |
| L6 | radial equilibrium / ang-mom drift, solid body | < 0.1% / < 1e-4 | 0.0029% / 1.3e-6 | PASS |

For (b): the rounded oracle state's own f32 floor is 4.0e-5 (L4a) and 1.7e-4 (L5), both above 1e-5.

TIMING (indicative only: Dawn in Node, other builders running, not D0-1)
- 1.83-1.85 ms/iteration at 130k, standalone (tests/gpu/flow-solver.test.ts `[timing]`). P1's official figure is 1.28 ms/it (spike kernel, Chrome).
- Resample: 0.52-0.59 ms per frame for both extents. The spike's was 0.13 ms.
- There is no app render loop yet (w2/app-ui), so this was not measured in-app. bench:* was not run.

ORCHESTRATOR DECISIONS NEEDED
- (a) L1 uniform: 2.0e-4 against 1e-4 m/s.
  - The f32 metrics are not the cause: the oracle with the same metrics reaches 1.5e-5. The cause is f32 arithmetic on absolute momenta, and 1e-4 m/s is about 7 ulp of u∞ = 170 m/s. So D4-12's asset fix would not help.
  - The options are a threshold decision, or momentum/flux gauges (a scheme change).
- (b) The "converged to 1e-5" rule of the CPU variants is below the f32 residual floor for L4a and L5, although their accuracy rows pass. A GPU convergence rule is needed.
- (c) The 12.2 "any row, residual within 1e-3" fails on E-L5 (1.5e-3), for the reason given above.
- (d) Defaults for the engine adapter: GpuFlowSolver uses minMach = M_cut = 0.003 at CFL 0.8 (interim).
- (e) SOLVER.md should take the two f32 reorderings (`gasRDelta`, and the n + β²m density increment). Ask the reference builder.

NEXT
1. Run `npm run test:browser`: not run, because of STOP-CLEAN. No browser code was touched.
2. The smooth limiter as a LimiterKind if D4-33 adopts it.
   - ε needs r_c per halo cell (the ghost's source cell).
   - The workgroup memory is 14.5 KB, so there is room for one more f32 per position.
3. L7-L9 on the GPU (the ladder pattern in tests/gpu-ladder), and p_u once decided.
4. Timing inside the app loop once w2/app-ui exists. Possible speed-ups: merge the ghost pass, resample less often.
5. W3: station reductions (latestReduction is null for now), body forces through a source module like cellSource, and setTargets (stored only).

GOTCHAS
- WGSL reserves `active`. The WebGPU enums are not defined at import time in Node, so take buffer usage flags inside functions.
- Interface conservation is bitwise only because of one call site per face/slope and copied ghost prims. Keep that: `tests/gpu/solver-exact.test.ts` checks it with a face dump.
- `tests/gpu/helpers/solver.ts` reads public/mesh/mesh-130k.bin, so run `npm run mesh` first.
- No dev server, Chrome page or background process is left running. Port 5189 was not used.

GATES @978ddf2
- npm test: 1837 passed + 9 expected fail (95 files). One coverage run hit a load timeout in the reference's solver.test.ts; the rerun passed.
- npm run lint: clean. npm run typecheck: clean.
- coverage: lines 99.6%, branches 87.7%. src/flow/gpu (CPU parts) lines 100%; src/flow/reference 100%.
- test:mesh: 29 passed.
- test:gpu: 38 passed + 1 expected fail (8 files).
- test:gpu-ladder: L1q, L2, L3, L4a, L5, L6 and B pass; L1u fails at 2.0e-4 (run before it was pinned as reported).
- test:browser: NOT RUN.
- No new dependencies.
