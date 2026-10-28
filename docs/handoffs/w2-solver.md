w2/solver round 2: DONE, ready for the two-reviewer (santa-loop) critic pass.
- L1 uniform now meets its pre-registered 1e-4 m/s: 2.1e-5, plateaued.
- L7-L9 run on the GPU and pass their accuracy rows.
- The solver runs in Chrome with 0 WebGPU errors.
- Two items go back to the critic with data: the D4-38 stated plateaus, which L4a and L5 do not reach, and the D4-39 normalisation.

(From d5c87df. HEAD = this handoff's commit.)

DONE (round 2)
- 679e16b (TDD) / 538bc0a, **D4-37, L1 uniform.** The mitigations and what each bought (130k asset, M 0.5, walls remapped to far field; max |u − u∞| in m/s):

  | forms | 1 it | 100 its | 2000 its | 20k its |
  |---|---|---|---|---|
  | round 1 (literal) | 7.4e-5 | 1.1e-4 | 1.7e-4 | 2.0e-4 |
  | + gauge flux differences (14.4) | 1.8e-5 | 6.3e-5 | 1.1e-4 | - |
  | + compensated update (14.6b) | 1.8e-5 | 6.3e-5 | 7.8e-5 | - |
  | + momentum/velocity gauges (14.3) | 1.4e-5 | 2.8e-5 | 2.8e-5 | 2.9e-5 |
  | + Neumaier residual (14.6a) | 1.4e-5 | 2.6e-5 | 2.8e-5 | 3.1e-5 |
  | + M_L − M_R from the gauges (14.5) = HEAD | 1.3e-5 | 1.9e-5 | 2.1e-5 | **2.1e-5** |

  - **It plateaus.** 2.07e-5 at 200 its, 2.13e-5 at 20k (|20k / 10k − 1| = 6.8e-5), at the same cell from iteration 25.
  - The density residual now falls from 7.5e-4 to 6.4e-7. Before, it was stuck at 3e-3, driven by noise.
  - **Against the oracle at 100 its** (the same f32-rounded start): the GPU gives 1.7e-5 and the oracle 1.44e-5. The per-cell difference GPU − oracle is 8.4e-6. That is the f32 rounding of the free stream itself: fround(u∞) − u∞ = 2.2e-6, plus fround(ρ∞)/ρ∞.
  - 12.2 row B: 1.95e-5 against the oracle's 1.49e-5. It was 7.4× the oracle; it is now 1.3×.
  - With 14.3-14.5 in place, the compensated update changes L1 by less than 1e-8 (an ablation run). What it does is tighten the physical-time rows (D: 7.7e-7 → 3.7e-8).
- 0fadb3c, **D4-41: SOLVER.md 14, "f32 implementation forms"**, appended.
  - D4-41 said §13, but §13 already holds "Notes for W3", so the new section is §14 (flag).
  - Six forms, each with its identity:
    - 14.1 R(φ) − R∞ = φ dR;
    - 14.2 the preconditioned density increment;
    - 14.3 the momentum and velocity gauges;
    - 14.4 gauge flux differences;
    - 14.5 p̃'s β term from the gauges;
    - 14.6 compensated sums: the Neumaier residual, and the TwoSum update with per-cell low parts (SSP-RK3 accumulated in its Butcher form).
  - `tests/unit/flow/f32forms.test.ts` transcribes each WGSL form in f64 and checks it against the oracle's literal form to f64 rounding (6 tests).
  - **14.3-14.6 are new forms beyond round 1's two. The critic should rule them in.**
- 538bc0a, **D4-39, E-L5.** The row divides by the residual itself. The solver proposes the flux-scale normalisation for the critic to rule on: |r_GPU − r_ref| / r_flux, with r_flux = sqrt(mean_c (Σ_f |b_f F_f,ρ| / (b_c V_c))²) taken from the oracle (`fluxScaleError`, tests/gpu/oracle.test.ts).
  - **E-L5:** 1.05e-3 over the residual, still KNOWN-FAIL (`it.fails`, tolerance kept); **2.7e-8 over the flux scale.**
    - The f64 residuals of the two states now differ by only 3.1e-4.
    - What is left is the f32 evaluation of a residual that is about 1e-4 of the face fluxes.
  - **E-L9a:** 6.6e-9 over the residual, 2.5e-12 over the flux scale.
  - **Row B:** it has no residual row. Its velocity form now passes with margin (1.3× the oracle, limit 10×). The per-cell GPU − oracle difference is 8.4e-6 / u∞ = 5e-8.
- 1fe8867 / f1bfa1e, **D4-38, the GPU stopping rule** (`settle`, tests/gpu-ladder/helpers.ts).
  - The rule: the residual is at the stated plateau, and every accuracy metric changes by less than 1e-4 relative over the last 2000 iterations (checked every 250).
  - For a case with no stated plateau, the plateau is detected: the residual has not fallen by 2× over 2000 iterations.
  - **L4a and L5 do not reach the stated plateaus** (data for the critic; pinned KNOWN-FAIL).
    - The residual stops falling at 3.99e-4 on L4a (stated 4e-5) and 7.5e-3 on L5 (stated 1.7e-4).
    - The metrics settle: 7.1e-5 and 5.5e-5, both below 1e-4.
    - The accuracy rows pass at that state.
  - **Reading:** the GPU iteration does not reach the residual of the f32-rounded oracle state. The likely cause is the sharp van Albada switch flipping on f32 noise (D4-36 found that switch behind the oracle's own stalls). The smooth-limiter trials of D4-36 would test this.
- 9f6aa84 (TDD) / 44ebfab, the cell source's force power (`work`: s_η += u·f, with f = rate0 + ρ aRho), for L9b.
- 1fe8867, **L7-L9 on the GPU** (tests/gpu-ladder/l7-l9.test.ts), with the oracle's definitions at w2/reference 4553ce2. Results in the table below.
- 1fe8867, **the solver in Chrome** (tests/browser/flowSolver.test.ts).
  - The run: the FlowSolver contract on the shipped 130k asset, 300 frames of step + resample.
  - **0 WebGPU validation errors (P3)**, and the status is 'running'.
  - The timing prints as test annotations (`--reporter=verbose`).

GPU LADDER (Dawn: `npm run test:gpu-ladder`, both files, at f1bfa1e)
| case | metric | threshold | GPU | result |
|---|---|---|---|---|
| L1 | quiescent, 130k, 20k its | < 1e-4 m/s, bitwise 0 | 0, bitwise | PASS |
| L1 | uniform M 0.5, 130k f32 asset, 20k its | < 1e-4 m/s | 2.13e-5 (plateau) | **PASS** (was KNOWN-FAIL) |
| 12.2 B | uniform, 100 its, vs oracle | ≤ 10× (1.49e-5) | 1.95e-5 | PASS |
| L2 | Sod L1(ρ) / shock offset | < 1% / ≤ 1 cell | 0.28% / 0.23 | PASS |
| L3 | radial Sod L1(ρ) | < 2% | 0.21% | PASS |
| L4a | Mach / choked mass flow | < 1% / < 0.5% | 0.28% / 0.10% | PASS |
| L4a | D4-38 rule within 8000 its | plateau 4e-5 | stops at 3.99e-4 | **KNOWN-FAIL (data)** |
| L5 | mass flow | < 1% | 0.084% | PASS |
| L5 | D4-38 rule within 8000 its | plateau 1.7e-4 | stops at 7.5e-3 | **KNOWN-FAIL (data)** |
| L6 | free vortex: radial eq. / ang-mom drift | < 0.1% / < 1e-4 | 0.030% / 4.9e-8 | PASS |
| L6 | solid body: radial eq. / ang-mom drift | < 0.1% / < 1e-4 | 0.0029% / 8.6e-8 | PASS |
| L7 | M 0.01, 96 × 96: asymmetry, falling over 24/48/96 | < 0.02, monotone | 0.0131 (0.135 / 0.044 / 0.0131) | PASS |
| L7 | M 0.01, 96 × 96: Cd | < 0.01 | 0.0016 | PASS |
| L7 | iterations M 0.01 / M 0.3 (the 1e-4 drop) | ≤ 3 | 8675 / 8280 = 1.05 | PASS |
| L8 | velocity, 0.2-1 m | < 1% | 0.36% | PASS |
| L8 | D4-38 rule | reported | not met in 20k (metric still moves 18% per 2000 its) | reported |
| L9a | Euler work | < 1e-4 | 7.2e-6 | PASS |
| L9a | D4-38 rule | reported | 4000 its (detected plateau 3.0e-2 of the peak) | reported |
| L9b | actuator disk vs momentum theory | < 2% | 0.80% | PASS |
| L9b | D4-38 rule | reported | 6250 its (detected plateau 0.77 of the peak) | reported |

- **L7 reproduces the oracle's round-5 numbers digit for digit:** asymmetry 0.135 / 0.044 / 0.0131, Cd 0.057 / 0.0096 / 0.0016, and 8675 / 8280 iterations.
- The oracle's L8 and L9 convergence rows fail too (w2/reference round 5).

12.2 ORACLE ROWS (Dawn, tests/gpu/oracle.test.ts; after 1 / 10 / 100 iterations, round 1 in brackets)
- A: bitwise 0 (plain, preconditioned, physical).
- C tracking: 4.8e-7 / 1.9e-6 / 3.2e-6 (1.1e-5 at 100).
- C-pre: 4.8e-7 / 3.2e-7 / 1.6e-6 (4.9e-6).
- C physical: 2.3e-7 / 3.2e-7 / 1.6e-5 (1.0e-5).
  - The 100-step value moves between runs of different forms: an intermediate form gave 1.3e-6.
  - That fits a sharp-limiter flip (12.1).
- D Sod: 3.7e-8 (ρ′) and 4.6e-8 (p′); round 1 was 7.7e-7 / 8.4e-7.
- E: L5 6.2e-6, L9a 5.1e-6.
- S: 4.6e-7 / 4.0e-7 / 1.0e-6 (4.9e-5).
- Residual rows: within 1e-3, except E-L5 (above).

TIMING (indicative only: not D0-1, no bench:* run, and other work may have been running on the machine)
- **Chrome (D3D12, Arc 140T), HEAD:**
  - 2.21-2.43 ms/iteration at 130k, from GPU timestamps.
  - The resample takes 0.67-0.70 ms per frame.
  - Back to back (no rAF pacing): 2.75 ms of wall time per iteration, including one resample every 2 iterations.
  - Under rAF pacing, the scheduler runs 2 iterations per frame at the 5 ms budget.
- **Dawn (Node), HEAD:** 1.97-2.01 ms/it, resample 0.59 ms. Round 1 was 1.83-1.85.
  - So round 2's forms cost about 8% (+0.15 ms/it).
  - The cost comes from:
    - the low parts: 64 B per cell per tracking iteration, three times that in physical time;
    - the Neumaier sums;
    - the gauge terms.
- **Against P1's official 1.28 ms/it:**
  - P1 timed W0's spike kernel, not this one. The production kernel adds:
    - the MUSCL slopes with the positivity fallback;
    - SLAU2 with the D4-20 scaling;
    - three passes per stage (prim, ghost, stage);
    - the b-weighted metrics;
    - the forms above.
  - On Dawn the production kernel went from 1.83 (round 1) to 2.0 (round 2).
- **Chrome against Dawn:** Chrome adds 10-20% over Dawn-in-Node on the same kernel. Plausible causes, not isolated:
  - Chrome's shader toolchain and robustness settings;
  - the GPU-process command path;
  - DVFS under frame pacing. D4-24: the timestamps stretch with the clock governor; here rAF gives 2.4 ms/it against 2.2-2.3 back to back.
- **Not measured: the round-1 kernel in Chrome.**
  - The repo's hook blocks the temporary `git checkout` of src/flow/gpu that this would need.
  - The critic can run `tests/browser/flowSolver.test.ts` against 978ddf2's src/flow/gpu.

SCHEME TERM → WGSL (src/flow/gpu/wgsl; generated per solver)
- **§3 gas** (gas.ts):
  - segCp, secantCp, secantS, log1pf, expm1f;
  - dh_air / dh_prd, ds_*;
  - productsFraction, gasR, gasRDelta (14.1), cpMix, enthalpyDelta, entropyDelta, soundSpeed;
  - deltaH, deltaE, temperatureGauge (3 Newton steps), temperatureFromPressure, pressureGauge;
  - dq2 (14.3: from the velocity gauge).
- **§4 cons → prim:** gas.ts consToPrim (14.3: u′ = ((ρu)′ − ρ′u∞)/ρ) and kernels.ts primMain.
  - Prim → cons is on the host: gpuSolver.ts setState calls the oracle's primToCons, then setConserved applies the momentum gauge and the low parts.
- **§5 ghosts** (boundary.ts ghostMain):
  - interface (a copy);
  - wallGhost (slip wall);
  - axis (case 2);
  - farField (plain and preconditioned characteristics);
  - inflow (stagnationOffset, isentropePressure, the σ Newton);
  - outflow (case 5).
  - Every velocity is u∞ + u′ (14.3).
- **§6 MUSCL** (flux.ts):
  - vanAlbada4, the sharp switch. It is `LimiterKind` 'vanAlbadaSharp', the only kind.
  - limitedSlopes, with the positivity fallback.
  - The call site is kernels.ts stageMain step 2 (one slope call site).
- **§7 SLAU2** (flux.ts slau2):
  - sideOf, betaPlus / betaMinus, betaSumM1 (14.5);
  - the D4-20 f_a / M_cut scaling;
  - the gauge mass and x-momentum flux (14.4);
  - sadd / sadd4 / sdiff, the fma-proof L/R sums.
  - The slip-wall flux is in kernels.ts tileFace.
- **§8 blockage and sources:**
  - b_f: in tileFace.
  - The pressure/swirl source: stageMain step 4, as an acc6 term (cb.y, cb.z, b ρ w² A).
  - The volume sources: cellSourceKernelWgsl sourceMain (rate0, ρ aRho, kU U, the kMass sink at the local h0, and work, the force power).
  - CELL_B and CELL_GEO.w: layout.ts blockageData, in f64.
- **§9 residual:** stageMain step 4. It adds the Neumaier terms acc6 / neumaier4 (14.6a) and the free-stream add-back mInf · CELL_GEO.w (14.4).
- **§10 time stepping:**
  - Local dt: cellLambda / spectralRadius, at stage 1.
  - β²: in stageMain (dpMax from the 4 neighbours, minMach²).
  - Tracking RK, α = (0.2, 0.5, 1), with the point-implicit divide; preconditionIncrement (14.2) when β² < 1; twoSum4 into lo at stage 3 (14.6b).
  - Physical time:
    - lambdaMain, then dtMain (CFL_phys · min);
    - SSP-RK3's Shu-Osher stages, with the Butcher accumulation into lo (P.wInc);
    - advanceTime (the Kahan clock).
- **§11 diagnostics:** stageMain step 5 (tile sums of (R_ρ/(bV))²), and kernels.ts residualFromPartials.
- **The render resample (D0-4):** resampleMain (u = u∞ + u′), with resampleMap.ts on the host.

DECISIONS NEEDED (critic / orchestrator)
- (a) **D4-38 on L4a/L5.**
  - The GPU residual stops at 3.99e-4 / 7.5e-3, above the stated plateaus 4e-5 / 1.7e-4.
  - The accuracy metrics have settled (less than 1e-4 change per 2000 its) and pass.
  - Options: state the plateaus as the GPU's measured ones, or wait for the limiter trials (D4-36).
- (b) **D4-39.** Whether to adopt the flux-scale normalisation for the residual rows. E-L5 is 2.7e-8 in that form, against 1.05e-3 over the residual.
- (c) **SOLVER.md 14.** The section number (14, not 13), and the four new forms 14.3-14.6, beyond D4-41's two.
- (d) **The device limit.** The stage kernel now binds 8 storage buffers: 9 with the cell source, 10 with the face dump.
  - WebGPU's default maxStorageBuffersPerShaderStage is 8.
  - So a device for the engine with sources must request the adapter's limit. tests/gpu/helpers/solver.ts and the browser test already do this.
  - w2/app-ui's device request has to do the same.

NEXT
1. The critic's rulings on (a)-(d).
2. The limiter trials (D4-36), added as a LimiterKind once the reference adopts one. They are expected to change the convergence rows of L4a, L5, L8 and L9.
3. W3:
   - station reductions (latestReduction is still null);
   - body forces through a source module like cellSource (work and aRho already cover the shape of the Hall-Thollet terms);
   - setTargets.
4. In-app timing once w2/app-ui exists. Candidates: merge the ghost pass; resample every other frame.

GOTCHAS
- **The state is in gauge form.**
  - readState() returns the raw copy: (ρu)′ = ρu − ρ∞u∞, with no low parts.
  - readConserved() returns the oracle's absolute ρu plus the low parts, in f64.
  - readPrimitives() returns a Float64Array with absolute u = fround(u∞) + u′.
  - Tests that build states should go through setConserved or setState.
- **The low parts.** setConserved stores U − fround(U) in them, so an f64 state keeps about 48 bits; an f32-representable U has zero low parts.
- **The kernel's free stream is the f32 one.** fround(u∞) differs from u∞ by up to half an ulp (2.2e-6 m/s at M 0.5). Comparisons against the f64 u∞ include that offset.
- **Keep new L/R expressions fma-proof.**
  - The risk: a product feeding an add or subtract whose operands swap sides under (L, R, S) → (R, L, −S). That breaks bitwise conservation.
  - Use sadd or sdiff (flux.ts).
  - tests/gpu/solver-exact.test.ts now also checks the interfaces at u∞ = 170 m/s.
- **Round-1 gotchas still hold.** WGSL reserves `active`. In Node, take the WebGPU enums inside functions. Run `npm run mesh` first.
- **Browser test output.** Console output from browser tests does not reach the terminal; use `annotate` and `--reporter=verbose`.
- **A known load timeout.** Under load, the reference's `solver.test.ts` can time out at 5 s in a coverage run. It happened again while the GPU ladder ran in parallel. A quiet rerun passes.
- **Nothing left running.** No dev server, Chrome page or background process. Port 5189 was not used, because the browser suite runs its own vitest server.

GATES (code at f1bfa1e; this commit adds only the handoff)
- npm run typecheck: clean. npm run lint (ESLint + Prettier): clean, at f1bfa1e.
- npm test: 1838 passed + 9 expected fail (95 files) at 538bc0a, a quiet run.
  - Later commits add tests/unit/flow/f32forms.test.ts (6 passed) and one host test (passed).
- **npm run coverage: not completed at the final hash.**
  - The machine was heavily loaded by other agents' processes. Cycle tests that normally take seconds ran for 25 minutes (modelPaths, model.test.ts), and the reference's solver.test.ts hit its 5 s timeout.
  - None of these touch src/flow/gpu.
  - Run 1 (1fe8867): 1843 passed, 1 load timeout. The second run was stopped.
  - Round 1's figures were lines 99.6%, branches 87.7%. src/flow/gpu's CPU parts gain only blockageData's flow-face sum (unit-tested) and the SSP_RK3_BUTCHER table.
  - **The critic should rerun coverage in a quiet window.**
- npm run test:mesh: 29 passed.
- npm run test:gpu: 40 passed + 1 expected fail (8 files) at 538bc0a. After that:
  - solver-exact.test.ts: 10 passed, with the work test;
  - oracle.test.ts: 8 passed + 1 expected fail;
  - flow-solver.test.ts: passed.
- npm run test:gpu-ladder: 12 tests at f1bfa1e.
  - Every accuracy row passes.
  - The L4a/L5 D4-38 rows are pinned KNOWN-FAIL (1fe8867's run: 10 passed, and L4a/L5 failed on that row; f1bfa1e reran L4a/L5: passed with the pins).
- npm run test:browser: 6 files, 22 tests passed, including tests/browser/flowSolver.test.ts (0 WebGPU errors).
- No new dependencies.
