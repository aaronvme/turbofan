# Santa-loop review B: w2/solver @81e9508 (the live GPU flow solver)

Independent reviewer B, 2026-10-28. Scope: `main...w2/solver` (branched at 7fd5f95, 21 commits, 34 files, +7226/−16), read against `docs/SOLVER.md` (the branch's and main's), the oracle `src/flow/reference/`, PHYSICS.md §3.3–3.4, GPU_FACTS, the handoff's term → WGSL map and decisions D0-4, D2-4, D2-6, D4-2, D4-12, D4-20, D4-35..D4-50. I did not read review A.

**Verdict: CHANGES REQUIRED.** There is one Blocking item. The trial merge into main fails `npm run typecheck`, and the fix is three lines. With B1 fixed I would approve: the kernel follows the scheme term for term, and my own probes show the WGSL equal to the oracle at f32 level on unequal states. Several Important items should follow before W3 or as the next solver round, at the orchestrator's choice. The main ones are test gaps: real scheme terms whose mutants survive the whole `test:gpu`.

Counts: **1 Blocking, 6 Important, 10 Nits.**

## Gates

The branch's gates ran in place in the builder's worktree at 81e9508, and its tracked files are unchanged (`git status` is empty). The mutants and the trial merge ran on scratch branches in my own worktree.

| gate | result |
|---|---|
| `npm run typecheck` | clean |
| `npm run lint` | clean (ESLint 0 warnings, Prettier clean) |
| `npm test` | 96 files, **1844 passed + 9 expected fail**, 154 s |
| `npm run coverage` | 1844 + 9 xfail; statements 98.69 %, branches 87.67 %, functions 99.64 %, **lines 99.6 %**; thresholds pass (578 s, machine shared with another builder). `src/flow/gpu` pure modules: 100 % lines. `src/flow/gpu/device/**` is excluded by design (test:gpu covers it). |
| `npm run test:mesh` | 2 files, 29 passed |
| `npm run test:gpu` | 8 files, **41 passed + 1 expected fail**, 31 s. 12.2 rows as the handoff states: C 4.84e-7 / 1.90e-6 / 3.18e-6; C-pre 4.82e-7 / 3.21e-7 / 1.62e-6; C physical 2.34e-7 / 3.23e-7 / 1.58e-5; D 3.66e-8 / 4.56e-8; E-L5 6.19e-6 (residual 1.05e-3 over the residual, 2.67e-8 over the flux scale); E-L9a 5.10e-6; S 4.59e-7 / 3.97e-7 / 1.03e-6 |
| `npm run test:gpu-ladder` | 2 files, **12 passed**, 5 min 50 s. Every row equals the handoff table: L1 uniform 2.132e-5 (plateau 6.8e-5); L7 0.0131 / Cd 0.00159 / ratio 1.048; L8 0.360 %; L9a 7.17e-6; L9b 0.80 %; B 1.954e-5; L2 0.277 % / 0.228 cells; L3 0.211 %; L4a 0.278 % / 0.0996 %; L5 0.0843 %; L6 0.0301 % / 4.9e-8 / 0.0029 % / 8.6e-8. L4a/L5 D4-38 rows: stop at 3.99e-4 / 7.54e-3 (reported). |
| `npm run test:browser` (own Chrome via Playwright, `--browser.api.port=5191`) | 6 files, **22 passed**. flowSolver: 0 WebGPU errors, status running. Indicative: 2.094 ms/it from timestamps, resample 0.635 ms per frame; back to back 2.617 ms wall per iteration including the resample. |
| **Trial merge** main 0c52acf + 81e9508 | Merges cleanly as text. test:gpu gives the same 41 + 1 xfail and the same 12.2 numbers against main's oracle. `tests/unit/flow` + `tests/unit/contracts`: 602 passed + 4 xfail. **`tsc --noEmit`: 1 error (B1).** |

## Blocking

**W2S-B-B1. The merge into main fails `npm run typecheck`.** At `tests/gpu/oracle.test.ts:162-164`, row A spreads `closedBoxOptions('preconditioned')` into `GpuSolver.create`. On main, `SolverOptions` now carries the oracle's `limiter?: 'sharp' | 'smooth'` (w2/reference round 4). That is not assignable to `GpuSolverOptions.limiter?: LimiterKind`, whose only value is `'vanAlbadaSharp'`. The compiler reports TS2345 at oracle.test.ts(162,58).
- *Scenario:* the orchestrator merges on a critic MERGE, and the gates on main go red.
- *The latent trap behind it:* the two branches name the same contract limiter differently ('sharp' in the oracle, 'vanAlbadaSharp' in the kernel). Forwarding the oracle's options to the kernel then either fails to compile or throws at `fluxWgsl` ("limiter sharp is not implemented").
- *Fix:*
  - In row A, pass the GPU options explicitly (`gas`, `freeStream`, `lowMachPreconditioning`), as `pair()` already does.
  - Better still, give the kernel the oracle's vocabulary: `LimiterKind = 'sharp'` now, with `'smooth'` added when D4-36 decides. `fluxWgsl` keeps throwing for a kind it has not implemented.
  - Re-run typecheck on a trial merge.

## Important

**W2S-B-I1. Real scheme terms that no test pins: their WGSL mutants survive the whole of test:gpu.**
- *Method:* each mutant is one string replacement in `src/flow/gpu/wgsl`, run against `tests/gpu/functions`, `oracle` and `solver-exact`. The script is `docs/reviews/probes/santa-solver-B-mutants.py.txt`.
- *Results:*

| mutant (file:line) | test:gpu | reviewer probes |
|---|---|---|
| SLAU2 mass flux without its g-term `g·sdiff(ρ_L\|vn_L\|, ρ_R\|vn_R\|)` (flux.ts:119) | **survives** | killed |
| positivity fallback: the pressure test `p − ½\|σ\|` → `p + ½\|σ\|` (flux.ts:49) | **survives** | killed |
| preconditioned increment with the velocity gauge u′ for u: `da.y − k·q.y` (kernels.ts:278) | **survives** | killed |
| inflow ghost without `− u∞` (boundary.ts:78) | **survives** | killed |
| slip-wall ghost without `− u∞` (boundary.ts:94) | **survives** | killed |
| 14.6(b): tracking update without the low part, first record (kernels.ts:462) | **survives** | survives |
| preconditioned far field: a₊ without `− β²vn∞` (boundary.ts:23) | **survives** | survives (small at M 0.06) |
| outflow switch `vn < c` → `vn < c/2` (boundary.ts:113) | **survives** | survives |
| 14.6(a): residual without the Neumaier compensation (kernels.ts:422) | "killed" only because the E-L5 `it.fails` pin flips (see I2) | survives |
| 14.5: `3 − M²…` → `2 − M²…` (flux.ts:91) | killed (C, C-pre, C physical, E) | killed |
| β²'s Δp term ÷ 4 (kernels.ts:439) | killed (C-pre, S) | |
| swirl source b ρ w² A dropped (kernels.ts:411) | killed (C, C-pre, E-L9a) | |
| 14.6(b), second record (kernels.ts:463) | killed (solver-exact) | |

- *Why the mutants survive:*
  - `functions.test.ts` checks SLAU2 for antisymmetry and equal-state consistency only, and every dissipation term vanishes for equal states. It checks consToPrim only at U = 0, and deltaE only as a round trip (a wrong deltaE inverts consistently).
  - Every preconditioned row (C-pre, S) and every inflow row (E) runs at u∞ = 0, and no row has a slip wall with u∞ ≠ 0. The u∞ terms of the preconditioned increment, the inflow ghost and the wall ghost are therefore never compared with the oracle.
  - The slope test exercises only the density fallback.
  - The compensated-update test moves ρZ only.
- *Scenario:* a later edit (D4-36's limiter, D4-44's M_ref, W3 sources) breaks one of these terms, the suite stays green, and the kernel leaves its contract unnoticed.
- *Fix:* move the reviewer probes into `tests/gpu`.
  - `santa-solver-B-functions`: SLAU2 values against `slau2Flux` on 1200 unequal faces (expansions, |M| > 1, machCut 1 and 0.003); consToPrim, deltaE, deltaH, cp, entropy and enthalpy deltas against the oracle; slopes, including lines through a non-positive neighbour. Van Albada keeps \|σ\|/2 ≤ 0.604 min(\|a\|, \|b\|), so the fallback is reachable only through an extrapolated wall ghost or a non-physical state.
  - `santa-solver-B-moving`: C-pre at u∞ 30 m/s, S at u∞ 20 m/s, E-L5 at u∞ 60 m/s.
  - All of these pass at HEAD and kill the five mutants above.
  - Also add a momentum component to the compensated-update test, and a far-field row with a larger M∞.

**W2S-B-I2. The §14 forms: the identities are right, but the tests don't pin the WGSL, and 14.6(a) has no test.** D4-49 requires an identity test for every form.
- *What is tested and what is not:*
  - `tests/unit/flow/f32forms.test.ts` checks a hand transcription of the WGSL in TS. If the WGSL departs from that transcription, those tests cannot see it (the g-term mutant above passes f32forms and all of test:gpu).
  - 14.6(a) (the Neumaier residual) has no test at all.
- *The E-L5 pin:*
  - The only thing that "kills" the no-compensation mutant is the E-L5 `it.fails` pin (oracle.test.ts:348-357) flipping.
  - Without compensation, the residual-over-residual row drops below 1e-3 and the pinned test starts passing.
  - So the pin sits on a rounding coin flip around 1.05e-3. It is not a check of anything.
- *What I verified myself:*
  - I re-derived the identities:
    - 14.2's n with Y = R∞T′ + (R−R∞)T − ½(u∞² + q²) + Δe;
    - 14.4's 2G₀ expansion through V̄±;
    - 14.5's β⁺(M_L) + β⁻(M_R) − 1 = ¼(M_L − M_R)(3 − M_L² − M_L M_R − M_R²);
    - 14.6's Butcher form equals Shu-Osher.
  - The probes show the WGSL equal to the oracle to 5e-8 (SLAU2) and 9e-7 (gas).
- *Fix:*
  - A Dawn value test of the WGSL forms against the oracle (the probe above).
  - A 14.6(a) test, for example a cell whose face fluxes cancel to 1e-6 of their size, with the residual compared to the f64 sum.
  - Retire the E-L5 over-residual pin once reference round 7 rewrites the E/B rows to the flux scale (D4-48). The flux-scale row is already asserted at 1e-6.

**W2S-B-I3. The D4-2 budget leaves out the resample, so the solver's real per-frame GPU time exceeds the 5 ms cap.**
- *The code:*
  - `flowSolver.ts:228-245` encodes n iterations and then the resample pass: prim + ghost + 2 resample dispatches.
  - The scheduler learns its per-iteration cost from the solver pass alone (`observe(n, solverMs)`, line 258).
  - `iterationsFor` (scheduler.ts:69-80) fits n·ms to the budget.
  - `FlowStepStats.gpuTimeMs` reports only the solver pass. `resampleGpuMs` is not in the contract, so the app's 15 − render − visuals split never sees the resample.
- *Measured:*
  - The resample costs 0.635 ms in Chrome (0.67-0.70 ms in the handoff), about 30 % of an iteration.
  - At the handoff's 2.2-2.4 ms/it, a frame costs 2 × 2.3 + 0.7 = 5.3 ms of solver GPU time against the 5 ms cap.
  - Back to back, the browser test measured 5.23 ms of wall time per 2-iteration frame.
  - L13's 7 ms ceiling can be broken where the floor of 2 binds: at 3.15-3.5 ms/it, 2·ms + 0.7 > 7.
- *Fix:*
  - Plan n = floor((budget − measured resample) / ms).
  - Report the whole frame (solver + resample) in `gpuTimeMs`, or add the resample to the contract.
  - Pin both in `scheduler.test.ts`.

**W2S-B-I4. Performance: 2 it/frame (about 120 it/s) undercuts P1's 150 and D4-2's premise. This is a measured follow-up, not a blocker.**
- *Why it is not a blocker:*
  - The numbers are indicative.
  - PHYSICS P1 counts only after an official quiet re-run.
  - The solver is not yet wired into the app.
- *The arithmetic:*
  - D4-2 assumed W0's 1.28 ms/it: 3 it/frame, 180 it/s, settling 1.7× slower than full rate.
  - The production kernel runs at 2.09 ms/it in Chrome here (2.41 on a loaded Dawn), so 2 it/frame, about 120 it/s, settling about 2.5× slower.
  - For 3 it/frame inside 5 ms with the resample counted, it needs ≤ 1.45 ms/it.
  - P1's 2.5 it/frame (150 it/s at 60 Hz) needs ≤ 1.74 ms/it if the scheduler carries the fractional remainder (below).
- *Cost drivers, from the kernel's structure (not profiled):*
  1. **9 dispatches per iteration** (3 × prim, ghost, stage). Each boundary drains the GPU.
  2. **Halo and redundancy at 16×8.** Each tile loads 240 halo records for 128 cells (1.875×). It computes 304 slope sets and 280 SLAU2 faces per 128 cells (2.4× and 2.2×).
  3. **Full 32-B primitive records in the halo,** of which only 24 B are used (T′ and c are needed for the tile's own cells only).
  4. **Face thermodynamics.** `sideOf` costs per face side: temperatureFromPressure, cpMix (two polynomials when Z > 0), deltaH (a secant polynomial with the T_BREAK branch) and a sqrt. That is about 4.4 sides per cell per stage, on top of the prim pass's 3 Newton steps.
  5. **The §14 forms,** about 8 % per the handoff.
- *Concrete optimizations, scheme-neutral unless noted:*
  - (a) **Reuse the resample's prim + ghost pass** as the next frame's stage-1 prim + ghost. In tracking mode it is the same copy with the same BCs, so the skip is exact when nothing called setState or setBlockage in between. This saves one prim + ghost per frame.
  - (b) **Carry the fractional budget** across frames, bounded by the L13 ceiling, instead of `floor` dropping 0.2-0.8 ms every frame. At 2.09 ms/it this gives 2.39 it/frame (143 it/s) without counting the resample, and 2.09 it/frame with it.
  - (c) **Split the primitive record** into (ρ′, u′, v, rw) + (p′, Z) + a per-cell (T′, c) array: −25 % halo bytes.
  - (d) **Re-sweep tiles with the production kernel.** 16×16 cuts the halo factor to 1.56 at about 26 KB of workgroup memory (`stageWorkgroupBytes` 26048 B); the Arc has 32 KB and the device already requests it. The bitwise tile-independence test makes this safe.
  - (e) **Merge the ghost pass into the prim pass** (ghosts from their source cells' U): −3 dispatches per iteration.
  - (f) **A §14-style form:** evaluate cp and h once, on mixture coefficients c_a,k + φ(c_p,k − c_a,k). It is linear in φ, so the identity holds, and it halves the polynomial work where Z > 0. It needs its identity test and a decision.
  - (g) **Resample every other frame** (the handoff's candidate).
- *Owed:* an official P1 run of the production kernel, then either these optimizations or P1's logged decision.

**W2S-B-I5. The GPU ladder's convergence and value rows predate D4-45, and D4-38's "detected plateau" calls a slow fall a floor.**
- *D4-45 not applied:*
  - `l7-l9.test.ts:23` caps L8, L9a and L9b at 20000 iterations, with no steadiness rule.
  - D4-45, which landed after these tests were written (a337d4e at 20:04, the tests at 1fe8867, 19:22), sets 37500 for L8 at CFL 0.8, the same scaling for L9, and "constant within a tenth of its tolerance over 2000 its".
  - The L8 value (0.360 %) is taken while its metric still moves 17.6 % per 2000 iterations ("plateau not reached"). The oracle reaches 0.449 % at about 32500.
- *The weak plateau test:*
  - `helpers.ts:111-123` detects a plateau when the last 2000 iterations' minimum is at least ½ of the previous 2000's.
  - That is a less-than-2× fall, so a run that is still converging slowly qualifies.
  - L9a stops at 4000 iterations with "plateau 3.04e-2 (detected)", although its last residual (2.63e-2) is below that "plateau".
  - SOLVER.md §10 reports the oracle's L9a at 3.0e-4 of the peak by 6000 iterations at the same CFL.
- *Honesty:* the rows are `reported`, so nothing passes falsely. But the handoff and D4-38 data present f32 floors that have not been shown to be floors.
- *Fix:*
  - Apply D4-45 (the steadiness rule and the caps).
  - Call the detected value "fell less than 2× in 2000 its", or require the fall to stop (for example < 10 % per 2000) before calling it a plateau.

**W2S-B-I6. D4-50 is not in the device module yet.**
- *What is missing:*
  - `src/gpu/device.ts` is unchanged. Only the test helpers and the browser test request the adapter's `maxStorageBuffersPerShaderStage`.
  - `GpuFlowSolver` with `cellSource` binds 9 storage buffers (10 with the face dump).
  - On a default-limits device, `createComputePipelineAsync` rejects. That surfaces as `unavailable` with Dawn's message, not with "needs ≥ 9 storage buffers".
  - The tested fallback (pack two read-only buffers into one) is missing.
  - The shipped adapter binds 8 and works today. D4-50 came after the tip.
- *Scenario:* W3 turns on sources inside w2/app-ui's worker device, and init fails with an opaque message.
- *Fix:*
  - Request the limit in `requestSimDevice`'s engine path.
  - Check `device.limits` in `GpuSolver.create` and fail with a stated reason.
  - Add the fallback with its test.
  - GPU_FACTS M1 already records 16 on the Arc (Dawn/D3D12).

## Nits

- **W2S-B-N1.** `params.ts:17` keeps its own `DEFAULT_CFL_PRECONDITIONED` "until main has it". Main now exports it from `src/flow/reference/solver.ts`, so import it after the merge.
- **W2S-B-N2.** Stale KNOWN-FAIL comments. `ladder.test.ts:389` says "3.6e-4 against 4e-5"; the run stops falling at 3.99e-4 (last 3.64e-4). `ladder.test.ts:454` says "4.9e-3"; that is the last value, and it stopped falling at 7.54e-3, the figure the handoff quotes. Align them.
- **W2S-B-N3. The W1F-I1 test never loses a device.** `flow-solver.test.ts:131-148` simulates the loss with `reportGpuError('')`, so the real `device.lost` path (`flowSolver.ts:93-95`) is untested.
  - Add a case that destroys `other.device`, awaits `device.lost`, then asserts `lost` and that `nextSnapshot` still publishes.
  - The `lost` handler also overwrites an earlier, more informative "readback failed: …" message with an empty `info.message`, which then becomes the generic default. Keep the earlier message when the new one is empty.
- **W2S-B-N4.** After `dispose()`, `fields()` throws "fields() before init()" (`flowSolver.ts:335`). Say "disposed".
- **W2S-B-N5.** Physical mode encodes prim + ghost twice per step on the same Uⁿ: `encodeGlobalDt` at gpuSolver.ts:493, then stage 1 at :468. That is one redundant pair per step.
- **W2S-B-N6.** `settle` compares the metric only with the value exactly 2000 iterations back (`helpers.ts:150`). A metric oscillating with a period near 2000 passes. Use the maximum change over the window.
- **W2S-B-N7.** `stageParams` does not reject cfl or cflPhysical ≤ 0. A zero CFL would freeze the state silently.
- **W2S-B-N8.** The GPU source kernel has no stage time. Main's W2R-N3 gives the oracle's sources t, t + dt and t + dt/2. That is fine for the built-in time-independent model, but W3's scheduled sources need it; note it in §14 or the handoff.
- **W2S-B-N9.** When w2/reference round 6 merges (D4-44(a)/D4-51, M_ref from the face's β), `flux.ts:117`'s `mRef` must follow. It is not yet in main's §7.
- **W2S-B-N10. Moving-reference data** (`santa-solver-B-moving`, `-diag`, `-diag2`). The rows pass, but by small margins:
  - C-pre at u∞ 30 m/s: 4.1e-6 / **9.6e-5** / 8.4e-6, against 1e-5 / 1e-4 / 1e-3. At rest the same row is 3.2e-7 after 10 iterations.
  - At u∞ 100 m/s: 1.9e-4 after 10 iterations (above 1e-4).
  - Plain tracking at u∞ 30: 5.2e-3 after 100 iterations (above 1e-3).
  - *Why:* the closed box is the same physical problem at any u∞. The oracle against itself (u∞ 0 against 30; the f32-rounded start differs, presumably through η's gauge on h0∞) already differs by 8.6e-4 after 100 plain iterations, so plain CFL 1.5 amplifies start differences about 10⁴× in 100 iterations. On the GPU a gauge that doesn't match the flow seeds that with ulp(u∞) noise instead of exact zeros.
  - *What it is not:* not a term error. Every u∞ term matches the oracle in value.
  - *Implication:* flight conditions (u∞ ≠ 0 with stagnant regions) will run at a larger f32 noise floor than SLS. A moving-reference 12.2 row should use a flow that moves with u∞.
- **Not measured:** the round-1 kernel in Chrome. The repository hook blocks the scratch `git checkout 978ddf2 -- src/flow/gpu`, as it did for the builder.

## Fidelity verdict

I read every WGSL term against SOLVER.md and the oracle, through the handoff's map:
- §3-4: gas, gauges, consToPrim with 14.3;
- §5: interface, wall, axis, plain and preconditioned far field, inflow with the σ Newton, outflow;
- §6: the sharp van Albada with its sorted, bitwise-odd denominator, and the per-cell, per-direction fallback;
- §7: SLAU2 with D4-20's f_a, and the pressure-only wall face;
- §8-9: b_f, the p∇b/swirl source, the cell source with `work`, and the residual with the F∞ add-back over flow faces only;
- §10: local τ and λ with b-weighted max-per-direction, β² with the Δp term, α = (0.2, 0.5, 1), the point-implicit divide before the 14.2 update, and SSP-RK3 in Butcher form;
- §11: the residual partials.

**Every term matches.** Values confirm it:
- SLAU2 against `slau2Flux` on unequal states: ≤ 5e-8 of scale, including expansions, |M| > 1 and machCut 0.003.
- consToPrim and the gas deltas: ≤ 9e-7.
- Slopes: ≤ 2.1e-7, with 22 pressure fallbacks agreeing.
- Moving-reference rows: within tolerance.
- Trial merge against main's oracle: the same 12.2 numbers.

**The §14 forms.** All six identities hold (I re-derived them), and D4-49 accepted the section. Their tests pin a TS transcription plus the end-to-end rows; the WGSL itself is pinned only through rows that cannot see several terms (I1, I2).

**GPU correctness.**
- *Fused kernel:* barriers after the halo load, the slopes, the face fluxes (held in registers across the barrier before they overwrite the slope arrays) and the overwrite. The tile-reduction barrier is under a uniform `P.stage` condition.
- *Halo and partial tiles:* the halo has no corners, and the validity flags cover partial tiles.
- *Bindings:* stage 1 binds Uⁿ twice, both read-only, which is legal; Uout never aliases. τ and β² are carried in the state record's .zw lanes, and the low parts zero those lanes.
- *Bitwise conservation:* sadd and sdiff, and the fma-safe argument, hold under (L, R, S) → (R, L, −S). I checked each product-sum.
- *Readbacks:* non-blocking, with a 3-slot residual ring and a 4-slot timestamp ring.
- *W1F-I1:* `sanitizeFlowStatus` nulls a NaN GPU time without marking divergence and gives an empty failure message the default.
- *Provenance (W1F-N1):* copied from the field.
- *Validation errors:* zero in Chrome and Dawn.

## Ladder rows

The table is honest, and every accuracy row reproduces on my run. The L4a/L5 KNOWN-FAIL pins are correct as data (D4-47): `expect(converged).toBe(false)` turns red when the limiter fix lets them converge. The weak spots are I5 (D4-45 caps and steadiness rule, the "detected plateau" wording) and N2 (stale numbers in the comments).
