# Santa-loop review A: w2/solver @81e9508

Independent reviewer A of the two-reviewer merge rule for the GPU flow solver (D4-6). Reviewer B reviews separately. 2026-10-27/28, on the Arc 140T laptop, with other agents' CPU tests running at the same time.

- **Diff:** `main...w2/solver`. The branch left main at 7fd5f95 and has 21 commits. It touches 34 files (+7226 / −16).
- **Trial merge:** `git merge-tree --write-tree main w2/solver` is clean.
  - `tests/ladder/oracle.ts` is the same blob on both sides.
  - No branch test imports an oracle API that main changed: `limitedSlopes` gained `rc` and `smooth`, and `slau2Flux` gained `ku`, which defaults to 0.
- **Read:**
  - CLAUDE.md;
  - SOLVER.md, main's and the branch's (the branch adds only §14);
  - PHYSICS.md §3.3-3.4 and GPU_FACTS;
  - the handoff and its term → WGSL map;
  - LOG decisions D0-4, D2-4, D2-6, D4-2, D4-12, D4-20, D4-35..D4-52, and the pass-7 "May w2/solver start" limits.
- **Checklists applied:** typescript-reviewer, silent-failure-hunter, pr-test-analyzer, security-review, and the WebGPU items of GPU_FACTS.
- **Probes** (`docs/reviews/probes/`):
  - `santa-solver-A-cost.probe.ts.txt`: a static traffic count from the layout;
  - `santa-solver-A-mutants.sh.txt` and `santa-solver-A-mutants2.sh.txt`: WGSL mutants. They run in a `git archive` export, never in the builder's worktree. That worktree's tracked files are unchanged (`git status` is clean).

## Verdict: APPROVE (0 Blocking, 10 Important, 9 Nits)

**The kernel implements SOLVER.md term for term.**
- I walked every entry of the term → WGSL map against §3-§11 and the oracle.
- I re-derived the 14.2, 14.4 and 14.5 identities by hand.
- I checked the bitwise (L, R, S) → (R, L, −S) argument for every L/R sum.
- I found no wrong term, sign or order.

**Every gate is green**, except one load timeout per coverage run in tests outside this branch's code.
- My GPU ladder run reproduces the handoff's table row for row.
- L7 matches the oracle's round-5 numbers digit for digit, which is end-to-end evidence for the u∞ ≠ 0 gauge forms.
- There are zero WebGPU validation errors on Dawn and in Chrome.
- The W1F-I1 contract edit is minimal and tested.
- The scheduler implements D4-2.
- The L4a/L5 KNOWN-FAILs are pinned as D4-47 says.

**What keeps this from being a clean pass is test strength, not a defect found.** Four of my eight WGSL mutants survive `test:gpu` for real:
- the resample's values (M2b, M2c), which the renderer will read: W2S-A-I1;
- the free stream's add-back (M3), because every term-for-term oracle row runs at u∞ = 0: W2S-A-I2;
- the low part of half the tracking TwoSum (M4): W2S-A-I5.

Two more do not show a gap:
- M5 survives but is nearly equivalent, because χ = 0 wherever q̄ ≥ c̄.
- M2 was killed only by a validation error, not by a value check.

**Other Important items:**
- The Chrome path has no numerical check (W2S-A-I3).
- The scheduler leaves the resample's 0.7 ms out of D4-2's budget and L13's ceiling (W2S-A-I4).
- D4-38's window check is end-to-end (W2S-A-I6).
- Items owed by decisions taken at or after this tip: D4-45, D4-48, D4-50, D4-44/D4-51 (W2S-A-I7, W2S-A-I8).
- Performance: D4-2's 3 iterations per frame does not hold at 2.2-2.3 ms/it (W2S-A-I9).
- The FlowSolver contract has no status channel for w2/app-ui (W2S-A-I10).

**Recommendation:** merge. I1-I5 are small, test-and-one-line changes, and belong in the next solver round, before w2/flowviz reads the solver's textures or W3 runs a free stream. The orchestrator may prefer I1 and I4 before the merge. I9 needs an official D0-1 measurement and, if P1's 150 it/s is missed, the logged decision P1 asks for.

## Gates at 81e9508 (run in the builder's worktree)

| gate | result |
|---|---|
| `npm test` | **1844 passed + 9 expected fail** (96 files), 128 s |
| `npm run lint` | clean (ESLint `--max-warnings 0` + Prettier) |
| `npm run typecheck` | clean |
| `npm run coverage` | **thresholds met**, with lines 99.60 %, branches 87.67 %, statements 98.69 % and functions 99.64 %. `src/flow` lines are at 99.71 % (gate 90). Every `src/flow/gpu` file has 100 % lines; branches range from 67-100 %, mostly the `?? NaN` fallbacks. Each of the two runs hit one load timeout in a test outside this branch's code, because other agents' CPU tests ran in parallel: run 1 the reference's 5 s annulus test (W2R-N14), run 2 `surgeRecovery.test.ts` at 600 s. Both pass in the `npm test` run above. The numbers come from run 2 with `--coverage.reportOnFailure` |
| `npm run test:mesh` | 29 passed (2 files) |
| `npm run test:gpu` | **41 passed + 1 expected fail** (8 files). The 12.2 rows are identical to the handoff's: C 4.84e-7 / 1.90e-6 / 3.18e-6, C-pre 4.82e-7 / 3.21e-7 / 1.62e-6, C physical 2.34e-7 / 3.23e-7 / 1.58e-5, D 3.66e-8 / 4.56e-8, E-L5 6.19e-6 (residual over the residual 1.05e-3, over the flux scale 2.67e-8), E-L9a 5.10e-6, S 4.59e-7 / 3.97e-7 / 1.03e-6. Indicative Dawn time under load: 2.055 ms/it, resample 0.655 ms |
| `npm run test:gpu-ladder` | **12 passed** (2 files). Every accuracy row passes, and the L4a/L5 D4-38 rows are pinned KNOWN-FAIL (see "The ladder rows") |
| `npm run test:browser` | **22 passed** (6 files), on port 5190 with Playwright's own Chrome. `flowSolver.test.ts`: 0 WebGPU errors, status running. Indicative times, with GPU contention from a mutant run: 2.255 ms/it, resample 0.701 ms, and back to back 2.91 ms of wall time per iteration including the resample |

## Fidelity: the term → WGSL map against SOLVER.md and the oracle

I walked every entry of the handoff's map line by line against SOLVER.md §3-§11 and the oracle (`src/flow/reference/*.ts` at the branch point; main's round-4/5 oracle changes only options whose defaults the kernel matches). **Verdict: the kernel implements the scheme term for term.** I found no wrong term, sign, branch condition or expression order.

- **§3 gas (gas.ts).** These match the oracle formula by formula:
  - the secant cp, with P_k = t P_(k−1) + t0^k;
  - the entropy secant, with c_k/k P_(k−1);
  - the range-break splits;
  - Δh = Δh_a + φ(Δh_p − Δh_a + D∞) and Δe = Δh − R∞T′ − (R − R∞)T;
  - the 3-step Newton, from T′_0 = (Δe* − φD∞ + (R − R∞)T∞)/(cp(T∞, φ) − R);
  - T′ from (p′, ρ′);
  - p′ from T′;
  - c² = cp R T/(cp − R).

  The `phi == 0` shortcuts return the same value bitwise. The coefficients are generated from `GAS_TABLES` as exact f32 literals.
- **§4 cons → prim.** These are §4 with the 14.3 gauge:
  - u′ = ((ρu)′ − ρ′u∞)/ρ;
  - Δe* = (η + ρ′R∞T∞ − ½ρ dq2)/ρ;
  - dq2 = u′(u′ + 2u∞) + v² + w².

  Prim → cons stays on the host through the oracle's `primToCons`.
- **§5 ghosts (boundary.ts).** Each matches the oracle:
  - the far field: plain and preconditioned, with the same λ±, a± and outflow test;
  - the inflow: the σ Newton, τ, the isentrope through `expm1f`, the supersonic case;
  - the wall ghost: the extrapolation coefficients (2, 1) / (3, 2), the mirrored normal velocity, and T′ and c from q₀;
  - the axis (v → −v);
  - the outflow: (u, v)·n < c_s;
  - the interface: a bitwise copy.

  No ghost reads another ghost, so the single ghost pass has no ordering hazard.
- **§6 MUSCL (flux.ts `vanAlbada4`, `limitedSlopes`).** These match §6:
  - φ = ab(a + b)/(a² + b² + 1e-30) when ab > 0;
  - the per-cell, per-direction positivity fallback, on q − |σ|/2, which is the smaller of the two face values; NaN also falls back;
  - one slope call site per direction.

  The denominator sorts |a| and |b|, so a fused multiply-add cannot break the odd symmetry.
- **§7 SLAU2 (flux.ts `slau2`).** I re-derived 14.4's G_0 from §7's ṁ:
  - ρ_L V̄⁺ − ρ_R V̄⁻ = (1 − g)V̄(ρ′_L − ρ′_R) + g(ρ_L|vn_L| − ρ_R|vn_R|);
  - ρ_L vn_L + ρ_R vn_R = ρ′_L vn_L + ρ′_R vn_R + ρ∞(2vn∞ + δvn_L + δvn_R).

  The code matches both. G_1 = G_0 u∞ + ṁ⁺u′_L + ṁ⁻u′_R + p̃n_x is correct because ṁ⁺ + ṁ⁻ = ṁ. I re-derived 14.5 as well: β⁺(M) = ¼(2 + 3M − M³) and β⁺ + β⁻ ≡ 1. The D4-20 term is in the stated order (`fa = mRef * (2 - mRef)`, then `chi / (cbar * fa)`), and machCut = 1 gives f_a = 1 exactly.

  For bitwise antisymmetry, I checked each L/R sum under (L, R, S) → (R, L, −S): `sadd`, `sdiff`, `betaSumM1`'s dm, and g, which is symmetric. Each one negates or stays exactly. The slip-wall face takes the interior cell's reconstructed p′ (`select(qLb.x, qRb.x, bl < 0)`) times b_f.
- **§8 blockage and sources.** These match §8, and the host computes them in f64 (`blockageData`):
  - b_f = ½(|b_L| + |b_R|), where a negative b marks a wall ghost;
  - P_c = p′ Σ b_f S_f + (0, b ρ w² A);
  - the volume source −bV s;
  - the point-implicit factor (1 + α dt_c d).

  `blockageData` refuses b outside (0, 1], as W2R-N1 has the oracle do.
- **§9 residual.** The outward signs are −west, +east, −south, +north. 14.4's add-back is (ρ∞u∞, ρ∞u∞²) × CELL_GEO.w. CELL_GEO.w is the f64 sum of b S_x over the faces that are not slip walls, taken after the BC remap (`layout.wall`), and it is the same test the kernel's wall branch uses.
- **§10 time stepping.** These match §10:
  - λ_c, the max over the two faces per direction, with b_f |S| and the preconditioned spectral radius;
  - β², including the Weiss-Maruszewski-Smith Δp term from the four halo neighbours, ghosts included;
  - τ and β² frozen through the U.zw slots;
  - RK α = (0.2, 0.5, 1) from U^n;
  - the preconditioned increment, whose 14.2 form I re-derived: δp/c² = δρ′ − n, with Y = R∞T′ + (R − R∞)T − ½(u∞² + q²) + Δe;
  - SSP-RK3 (Shu-Osher stages; the Butcher sum ⅙, ⅙, ⅔ in the low part; checked);
  - the physical dt = CFL_phys · min(bV/λ) with β = 1;
  - the Kahan clock.

  Physical time is never preconditioned, and its far field is the plain one (uniform block 3).
- **§11.** The stage-1 tile sums of (R_ρ/(bV))² use a correct non-power-of-two tree reduction.
- **The resample (D0-4).** These match the contract:
  - (p′/p∞, ρ′/ρ∞, T∞ + T′, Z) and (u∞ + u′, v, rw/r_c, fluid);
  - NO_CELL texels give the exact ambient.

**§14 (D4-49: every form needs its identity test).**

| form | identity checked by me | test |
|---|---|---|
| 14.1 φ dR | yes | f32forms 14.1 |
| 14.2 n + β²(δρ′ − n) | yes (re-derived) | f32forms 14.2 checks only component 0, though the kernel's components 1-5 also use m = δρ′ − n (W2S-A-N3) |
| 14.3 the momentum/velocity gauges | yes | f32forms 14.3; solver-exact "f32 free stream bitwise zero" |
| 14.4 the gauge flux differences | yes (re-derived) | f32forms "SLAU2 as G = F − F∞(S)", 400 faces, g ≠ 0, \|M\| ≥ 1, machCut 0.01; host test for CELL_GEO.w |
| 14.5 β⁺ + β⁻ − 1 from the gauges | yes (re-derived) | inside the 14.4 test (both branches) |
| 14.6 (a) the Neumaier sum, (b) TwoSum / Butcher | (a) is a summation algorithm, with no algebraic identity to test; (b) yes | f32forms "Butcher form"; solver-exact "sub-ulp increments", which checks only (η, ρZ) (W2S-A-I5) |

The f32forms tests are f64 *transcriptions* of the WGSL. They prove the algebra, not the WGSL text. The WGSL is checked by the Dawn rows, and those rows all run at u∞ = 0 (W2S-A-I2).

## GPU correctness

- **Barriers and races in the fused kernel.** The sequence is:
  1. load;
  2. barrier;
  3. slopes;
  4. barrier;
  5. the face fluxes into registers;
  6. a barrier before the slopes' workgroup memory is overwritten with fluxes;
  7. barrier;
  8. the residual and update.

  The §11 reduction's barriers sit under `P.stage`, a uniform, so control flow is uniform. `lo` is read and written only by its own cell. Uin and U0 alias only at stage 1, where both bindings are read-only (valid). Uout is always a third copy. There are no races.
- **Halo and tile edges.** The halo loads cells, plus the ghosts ≤ 2 cells out in one direction, and never corners. The slope and face validity masks match the stencil (the slope of ghost layer 1 is valid; layer 2 is only read). Partial tiles produce no faces, updates or residual. Tile-shape and block-split independence are tested bitwise.
- **Buffers and bindings.**
  - The usages are minimal and correct. rgba16float storage textures are core WebGPU.
  - The stage kernel binds 8 storage buffers without sources, which is the default limit, and 9-10 with sources or the dump. An over-limit device fails at pipeline creation with a validation error, so it is not silent. D4-50's request and fallback are owed (W2S-A-I8).
- **Readback and async.**
  - Three readback slots and four timestamp slots. A busy slot skips that frame's readback, so nothing stalls.
  - A rejected `mapAsync` becomes `lost` unless the solver is disposed.
  - `dispose()` aborts pending maps quietly.
  - These are correct.
- **Out-of-domain texels:** exact ambient, tested at rest.
- **Device loss / W1F-I1 (D2-6).**
  - `device.lost` → `lost`. The status trims the message and uses `FLOW_DEFAULT_ERRORS.lost` when it is empty. A lost solver queues nothing.
  - A non-finite GPU time becomes `null`, never `diverged`. Only a non-finite residual or counter diverges.
  - The `sanitizeFlowStatus` contract edit is **minimal and validated**: `withFailureMessage`, plus the time-only branch. Unit tests cover both W1F-I1 cases and the combinations (lost + NaN residual, NaN time + NaN residual), and the healthy status is returned by identity.
  - The Dawn test fakes the loss through `reportGpuError('')` rather than a real `device.lost` (W2S-A-N6).
- **Provenance (W1F-N1).** `snapshotSources` copies `field.source` ('solver') and `cycle.source`. It is tested.
- **Validation errors:** zero in every Dawn file (`assertNone` after each test) and in the browser run (0 reports in 300 frames plus the back-to-back stretch).

## Scheduler (D4-2)

`solverBudgetMs` = min(5, 15 − render − visuals), with an unmeasured or non-finite input counted as 0. `iterationsFor` behaves as follows:
- before the first measurement: the floor of 2;
- then floor(budget / ms) iterations, but at least 2;
- the 7 ms ceiling wins over the floor, with at least 1 iteration;
- `maxIterations` caps the result, and 0 pauses the solver.

Each rule has a unit test, and the Dawn test checks the formula against measured timestamps. The behaviour matches D4-2. One gap: **the solver's own resample pass (0.66-0.70 ms per frame) is in neither the budget nor the ceiling** (W2S-A-I4).

## Performance

The measured figures are indicative only. I ran no `bench:*`, and the machine was loaded. Dawn gives 2.06 ms/it, and the handoff's Chrome figure is 2.2-2.4 ms/it. P1's official 1.28 ms/it timed the W0 spike, not this kernel.

**What the kernel moves** (probe `santa-solver-A-cost`, a static count from the layout). The mesh:
- 130,034 cells and 22,188 ghosts;
- 1,076 stage workgroups of 16 × 8, with 94.4 % thread occupancy;
- 1.905 halo loads per cell, against 1.75 for an interior tile;
- 2.19 faces per cell;
- 14.5 KB of workgroup memory;
- 9 dispatches per iteration: prim, ghost and stage, three times.

Without reuse across workgroups, one iteration moves at most **161 MB**: per stage, the prim pass 10.4 MB, the ghost pass 2.5 MB and the stage kernel 35.2 MB, plus lo and the stage-1 face reads. That is **70 GB/s at 2.3 ms/it and 80 GB/s at 2.0**, the same order as this iGPU's shared LPDDR/DDR5 bandwidth. The working set per stage (three U copies 12.5 MB, prim 4.9 MB, geo 9.4 MB) is far larger than the GPU's L2. **So the kernel is most likely bound by memory traffic and dispatch drains, not ALU.**

That is consistent with the handoff's own ablation: the §14 forms, the compensated sums included, cost only about 8 % (+0.15 ms/it). The other costs, in order:
- **The dispatches.** Nine per iteration, plus 2-3 for the resample. On D3D12 each is followed by a UAV barrier that drains the GPU. The ghost pass covers only 22k threads, so it is almost pure drain, three times per iteration.
- **Register pressure.** The face-flux register arrays hold 18 floats, `Acc6` holds 16, and SLAU2's temporaries add more. That probably makes Intel's compiler choose SIMD8 for the stage kernel. This is not verified; a shader dump would show it.

**Optimizations I would try, in order** (each one keeps the arithmetic bit for bit, unless stated):
1. **Merge the ghost pass into the prim pass.** Append the ghost threads, each recomputing its source cells' primitives from U. This saves 3 dispatches and drains per iteration.
2. **Reuse the resample's prim + ghost pass as the next frame's stage-1 prim + ghost pass** when nothing has written U in between. This saves one full prim + ghost pass per frame, about 0.2-0.3 ms.
3. **Split prim into a 24-byte halo record (ρ′, u′, v, rw, p′, Z) and a cell-only (T′, c).** The halo is loaded 1.9× per cell. Read `extB` as a scalar array instead of a dynamic vec4 component.
4. **Request `maxComputeWorkgroupStorageSize` 32 KB** (the Arc offers it, GPU_FACTS M1) **and try 32 × 8 tiles.** The halo factor falls from 1.9 to about 1.7, and there are half as many workgroups.
5. **Ablate the Neumaier residual (14.6a).** The handoff's own table shows it bought nothing on L1 (2.9e-5 → 3.1e-5), so if the 12.2 rows hold without it, it is pure cost. This changes rounding, not the scheme.
6. **Skip the resample on a frame with 0 iterations** (paused).

**Assessment: not a merge blocker; a measured follow-up with a decision owed.**
- No pre-registered gate fails:
  - L13 (p95 ≤ 7 ms per frame) holds: 2 × 2.3 + 0.7 = 5.3 ms;
  - P1 is the W0 spike's row, and its "else a logged decision" clause needs an official D0-1 measurement.
- But D4-2's arithmetic (3 it/frame, about 180 it/s) does not hold for this kernel. At 2.3 ms/it the scheduler gives 2 it/frame, about 120 it/s at 60 fps, so tracking settles about 1.5× slower than D4-2 planned (W2S-A-I9).
- A 28 % speed-up (to ≤ 1.66 ms/it) restores 3 it/frame. Items 1-3 plausibly give a good part of that.

## The ladder rows

My run reproduces every row of the handoff's table, with the same numbers.
- L1:
  - quiescent: bitwise 0;
  - uniform: 2.132e-5 m/s, plateau |20k/10k − 1| = 6.8e-5.
- 12.2 row B: 1.954e-5 against the oracle's 1.49e-5.
- L2: 0.277 % / 0.228 cells. L3: 0.211 %.
- L4a: 0.278 % / 0.0996 %. L5: 0.0843 %.
- L6: 0.0301 % / 4.9e-8 and 0.00289 % / 8.6e-8.
- L7, digit for digit with the oracle's round 5:
  - asymmetry 0.135 / 0.0437 / 0.0131;
  - Cd 0.0569 / 0.00961 / 0.00159;
  - 8675 / 8280 iterations, ratio 1.048.
- L8: 0.360 %. L9a: 7.17e-6. L9b: 0.799 %.

**Honest and pre-registered.**
- Each threshold comes from `THRESHOLDS` (PHYSICS.md), unchanged.
- The CPU ladder's set-ups and metrics are reused through the oracle shell, which evaluates the GPU's own state in f64.
- The L1 uniform row is gated at the pre-registered 1e-4 (D4-37), not relaxed.
- The plateau numbers 4e-5 and 1.7e-4 are D4-38's, written down before the round-2 runs (8883b02).

**Pinned correctly (D4-38/D4-47).** L4a and L5 report the D4-38 row as "reported" and `expect(conv.converged).toBe(false)`. Each is a visible KNOWN-FAIL that fails loudly once the limiter fixes it.
- L4a: the residual is 3.64e-4 at the end, and the detector sees a plateau at 3.99e-4 against the stated 4e-5. The metrics settle at 7.1e-5.
- L5: the residual is 4.91e-3 at the end, plateau seen at 7.54e-3, against the stated 1.7e-4. The metrics settle at 5.5e-5.
- The accuracy rows, which D4-47 keeps as the checks of record, pass.

**Two weaknesses**, both in rows that are reported, not gated:
- **The window check.** The "metric change" is an end-to-end difference (W2S-A-I6).
- **The detected plateau certifies states that are not converging.** L9b's D4-38 rule "settles" at 0.77 of the peak residual, and L9a's at 3.0e-2. L8's metric still moves 17.6 % per 2000 iterations while its velocity row passes at 0.36 % (W2S-A-I7, D4-45).

## Findings

### Blocking

None.

### Important

**W2S-A-I1. The resample kernel's values are never checked, only its exact ambient.**
- *Where:* `src/flow/gpu/wgsl/kernels.ts:739-778`. The only checks are `tests/gpu/flow-solver.test.ts:103-129`, an engine at rest where every texel is ambient, and the browser test, which does not read the textures.
- *Failure:* the following could all be wrong and every test would still pass:
  - the packing of the map (`flowSolver.ts:132-137`);
  - the fourth weight 1 − Σw;
  - w = rw/r_c;
  - the gauge-ratio channels;
  - T∞ + T′;
  - u∞ + u′.

  Mutant M2b (u_θ = rw·r_c) **survived**, and M2c (the p and ρ gauge ratios swapped) **survived**. M2, which drops the `/ r_c`, was killed only by a bind-group validation error: `geo` became unused, so the 'auto' layout dropped binding 2. It was not killed by a value check.
- *Fix:* a Dawn test that sets a smooth non-ambient state, including swirl, fuel and u∞ ≠ 0, then resamples. It reads both textures and compares each texel with the host map applied to `readPrimitives()` in f64, to f16 rounding.

**W2S-A-I2. The term-for-term oracle rows in `test:gpu` all run at u∞ = 0, so the u∞-dependent parts of 14.3-14.5 and the add-back are untested there.**
- *Where:* `tests/ladder/oracle.ts` `AMBIENT_AT_REST`; `tests/gpu/oracle.test.ts:227, 285, 378` (the D, E-L5 and E-L9a free streams are at rest); `tests/gpu/functions.test.ts:19-22` (`probeFlux` at rest). `solver-exact.test.ts:215-246` checks the M 0.5 free stream at `cfl: 0` (τ = 0), so the add-back cannot act.
- *Failure:* mutant M3, which flips the sign of the free stream's add-back (`kernels.ts:410`), **survives every `test:gpu` file** (oracle, solver-exact). In the ladder, row B lets it through (2.07e-5 against 1.95e-5 unmutated, both well inside 10× the oracle). Only L7 kills it, grossly: asymmetry 554, Cd 0.29. So only the slow, merge-time `test:gpu-ladder` would see a wrong add-back, never the routine `test:gpu`.

  Separately, `probeFlux` checks only antisymmetry and equal-state consistency, never an SLAU2 value for unequal states. This is the gap W2R-I4 closed on the oracle side. Mutant M5, which removes the min(1, ·) of D4-20's M_ref, also survives. It is nearly equivalent: χ = 0 wherever q̄ ≥ c̄, so the only difference is 0/0 at exactly q̄ = 2c̄. Still, nothing in `test:gpu` would notice a wrong transonic preconditioned flux.
- *Fix:*
  - (a) A 12.2-style row with u∞ ≠ 0 in `test:gpu`: for example, case C's pulse on a free stream at M 0.3 in a box with far-field ends and slip-wall sides, so that CELL_GEO.w is nonzero at the walls. Tracking and C-pre, 1 / 10 iterations.
  - (b) `probeFlux` values against `slau2Flux − F∞(S)` for main's W2R-I4 state pairs, at u∞ = 0 and 170 m/s and machCut 0.01 and 1, including the transonic M̂-clamp face. Tolerance about 1e-5 of the face's flux scale.

**W2S-A-I3. The production path (Chrome) has no numerical check.**
- *Where:* `tests/browser/flowSolver.test.ts`. It runs 300 frames of the engine **at rest**, a field that stays exactly zero, and asserts no errors and `status === 'running'`.
- *Failure:* the bitwise interface symmetry relies on the compiler not fusing L/R sums (`sadd` / `sdiff`). The 14.6 compensated sums rely on it not reassociating TwoSum or Neumaier. Both are verified only in Dawn-in-Node, which ships both `dxcompiler.dll` and `d3dcompiler_47.dll` (GPU_FACTS M2). The handoff itself names "Chrome's shader toolchain" as a difference. A Chrome-only miscompile of either would be invisible.
- *Fix:*
  - Run, in `test:browser`:
    - the face-dump interface check (bitwise equal or negated) on the three-block row and on 130k at u∞ 170 m/s;
    - the sub-ulp accumulation check;
    - one 12.2 row (C, 10 iterations).
  - Record the result in GPU_FACTS as Measured (D3D12 Chrome vs Dawn-in-Node), with the fma finding that made `sadd` necessary.

**W2S-A-I4. The scheduler leaves out the solver's resample, so the frame plan and the L13 ceiling are each exceeded by about 0.7 ms.**
- *Where:* `src/flow/gpu/scheduler.ts:69-80` and `src/flow/gpu/device/flowSolver.ts:293-298`. `resampleGpuMs` is measured (`flowSolver.ts:256`) but nothing uses it.
- *Failure:*
  - At 2.3 ms/it the solver takes 2 × 2.3 + 0.7 = 5.3 ms of D4-2's 5 ms.
  - With P4's measured 8.5 ms render, the frame plan is 15.8 ms against D4-2's 15.
  - The 7 ms ceiling counts iterations only. At 3.2 ms/it the floor and the ceiling allow 2 iterations, 6.4 ms + 0.7 = 7.1 ms over L13's 7.
- *Fix:* pass the measured resample time to `iterationsFor` and plan iterations against `budget − resample` and `7 − resample` (or state in D4-2 that flow visuals include it). Add unit tests for both.

**W2S-A-I5. The sub-ulp test covers only half of the tracking TwoSum.**
- *Where:* `tests/gpu/solver-exact.test.ts:425-473` measures only ρZ, which is in the (η, ρZ) vec4 `sb`.
- *Failure:* mutant M4, `twoSum4(ba, d.a)` at `kernels.ts:462`, drops the low part of (ρ′, (ρu)′, ρv, ρrw) in tracking mode, and **survives**. The 14.6(b) form for those components is unpinned.
- *Fix:* add a sub-ulp source in one of components 0-3 to the same test. A uniform ρrw or ρv rate in the closed box is a quiet state, like ρZ. Check both modes.

**W2S-A-I6. D4-38's "the metric changes by less than 1e-4 over the last 2000 iterations" is implemented as an end-to-end difference.**
- *Where:* `tests/gpu-ladder/helpers.ts:148-152` compares m(it) with m(it − 2000) only. The docstring at line 103 says "largest relative change over the last" window.
- *Failure:* the sharp limiter's limit cycles (D4-36) can repeat with a period that divides the 250-iteration sampling. An oscillating metric then reads as settled. L9b's rule "settles" at a detected plateau of 0.77 of the peak residual, which is a state that is not converging at all. That makes the window check matter.
- *Fix:* the max over the window's 9 samples of |m − m_end| / |m_end|. The samples are already in `hist`.

**W2S-A-I7. The GPU L8/L9a/L9b value rows pass without D4-45's steadiness rule, and L8 stops at 20000 iterations instead of 37500.**
- *Where:* `tests/gpu-ladder/l7-l9.test.ts:23` (`MAX = 20000`) and `:138-187`.
- *Failure:* the handoff reports that L8's metric "still moves 18 % per 2000 its" when the velocity row passes at 0.36 %. D4-45 (decided on main after this branch started) requires the value to be constant within a tenth of its tolerance over the last 2000 iterations, and scales L8's cap to 37500 (L9a/L9b likewise). The rows are honestly reported, but they are not of record under D4-45.
- *Fix:* apply D4-45's rule to the GPU value rows and its cap scaling to MAX, and report each value as PASS only when steady.

**W2S-A-I8. Owed by decisions taken at this tip (D4-48, D4-50), and the pending D4-44/D4-51.**
- (a) **D4-48.** The E-L5 residual row is still the KNOWN-FAIL over-the-residual form (`oracle.test.ts:351`). The flux-scale form asserts an unregistered 1e-6 (`:344`). Row B has no residual row at all, although 12.2's "any | any" row applies to it.
  - Follow reference round 7's rewrite: flux scale at 1e-3, row B included.
  - I checked that the proposal is a normalisation only: the numerator |r_GPU − r_ref| is unchanged, the denominator is the oracle's Σ|b_f F_f,ρ| L2, and `faceFlux` includes b_f.
- (b) **D4-50.** `GpuSolver.create` does not check `device.limits.maxStorageBuffersPerShaderStage` against 9/10 before compiling. The production device module does not request it. The pack-two-buffers fallback and its test do not exist.
  - The Arc value is already in GPU_FACTS M1 (16, Dawn). Chrome's still needs recording.
- (c) **D4-44/D4-51.** M_ref from the face's β is decided and waits only for w2/reference round 6 to merge. The kernel's `slau2` (`flux.ts:117`) must follow it in the same merge window. C-pre, S, L7 and L8 will catch the mismatch, so this is a scheduling item.

**W2S-A-I9. Performance: D4-2's 3 iterations per frame does not hold for the production kernel.**
- *Evidence:* see Performance above.
- *Fix (orchestrator):* an official D0-1 measurement of this kernel in the next quiet window; P1's "logged decision" if it is under 150 it/s; and optimizations 1-3 above as the next solver round's first items.

**W2S-A-I10. The FlowSolver contract has no status channel, so W1F-I1's behaviour cannot be reached through the contract.**
- *Where:* `src/contracts/flow.ts:151-163` (`FlowSolver`) has no `status()` and no GPU-error sink. `GpuFlowSolver.status()` and `reportGpuError()` (`flowSolver.ts:212-215, 320-328`) are class-only, and nothing wires `reportGpuError` to the device's error sink.
- *Failure:* w2/app-ui written against the contract cannot publish `lost` or `diverged`. An uncaptured validation error during `step()` would leave the solver `running`.
- *Fix:* a minimal contract edit, `status(): FlowStatus`, with the mock implementing it, and a note in the handoff that the app must route `SimDevice`'s `onError` to the solver. Or decide that the app depends on `GpuFlowSolver` concretely. Either way, flag it for the w2/app-ui brief.

### Nits

- **W2S-A-N1. Stale or ambiguous comments and docs.**
  - `ladder.test.ts:390` ("3.6e-4") and `:454` ("4.9e-3") quote the *final* residual, while the handoff quotes the *detected plateau* (3.99e-4, 7.5e-3). Say which one each is.
  - `params.ts:11-17` duplicates `DEFAULT_CFL_PRECONDITIONED`, which main's oracle now exports: import it after the merge.
  - `params.ts:118-123` and `flowSolver.ts:38-41` still say "not final (D4-30, D4-32)", although D4-35/D4-40 decided 0.8 and 0.003.
  - The branch's SOLVER.md 12.2 still calls case C "the real mesh". Main's text (W2R-I2) has the closed box, and the merge takes it.
- **W2S-A-N2.** The KNOWN-FAIL pins of D4-47 are correct: `expect(conv.converged).toBe(false)` fails loudly once the limiter fixes them. But the rows print as `reported`. Put "KNOWN-FAIL (D4-47)" in the row text, so `reports/gpu-ladder/*.json` says so.
- **W2S-A-N3.** The 14.2 identity test checks only δρ′ (`f32forms.test.ts:141-175`), while the kernel's other five components also use the new m. Compare all six with the oracle's `preconditionIncrement`.
- **W2S-A-N4. Silent failure.**
  - `setConserved` (`gpuSolver.ts:411-426`) does not check `U.length`. A short array writes NaN state through `?? NaN`, which surfaces only later as divergence. `setCellSource` does check its lengths.
  - `GpuFlowSolver.init` leaves the solver's buffers allocated when a later build step throws (`flowSolver.ts:81-89`). Destroy them in the catch.
- **W2S-A-N5.** `setMode` (`flowSolver.ts:208-210`) keeps the tracking-mode cost average for physical steps, which cost more because of the extra λ, dt and prim passes. The first physical frames then overshoot until the average adapts. Reset the scheduler on a mode change. Also, the physical clock is not reset when the mode changes.
- **W2S-A-N6.** The W1F-I1 Dawn test fakes loss with `reportGpuError('')`. Add a real `device.destroy()` without `dispose()` first, and check `lost`, the zero-iteration step and the published snapshot. Note that `device.lost`'s `reason` ('destroyed') is ignored, unlike `requestSimDevice`'s intentional-destroy handling (M17).
- **W2S-A-N7. Pure logic in the coverage exclusion.** `src/flow/gpu/device/**` is excluded from unit coverage (`vitest.config.ts`). Three pieces in it could be pure and unit-tested in `layout.ts`:
  - `setConserved`'s hi/lo split with the momentum gauge;
  - `readConserved`'s recombination;
  - `setCellSource`'s packing.

  The exclusion should be named in the merge note, because it extends CLAUDE.md's list.
- **W2S-A-N8.** `checkTile` does not check `stageWorkgroupBytes` against the device's `maxComputeWorkgroupStorageSize`. A 16 × 16 tile needs 26 KB and fails at pipeline creation. Check it up front, with a clear message.
- **W2S-A-N9. GPU_FACTS is missing two measured facts the round found.**
  - The fma contraction that breaks the L/R bitwise symmetry (why `sadd` exists). The face-dump tests are the evidence.
  - TwoSum and Neumaier surviving the D3D12 compile. The sub-ulp test is the evidence.

## Mutants (WGSL, in a `git archive` export; `santa-solver-A-mutants*.sh.txt`)

| id | mutant | files run | result |
|---|---|---|---|
| M1 | SLAU2's χ pressure diffusion with the wrong sign (`flux.ts:121`) | oracle, functions | **killed** (7 tests fail): a wrong flux fails the Dawn rows |
| M2 | resample u_θ = rw, `/ r_c` dropped | flow-solver | killed, but by a bind-group validation error (binding 2 unused), not by a value |
| M2b | resample u_θ = rw · r_c | flow-solver | **survived** |
| M2c | the state texture's p and ρ gauge ratios swapped | flow-solver | **survived** |
| M3 | the free stream's add-back with the wrong sign (`kernels.ts:410`) | oracle, solver-exact | **survived**. Ladder: row B survived (2.07e-5); L7 **killed** (asymmetry 554) |
| M4 | the tracking TwoSum drops the low part of components 0-3 (`kernels.ts:462`) | solver-exact | **survived** |
| M5 | D4-20's M_ref without min(1, ·) (`flux.ts:117`) | oracle, functions | survived; nearly equivalent (χ = 0 for q̄ ≥ c̄, except 0/0 at q̄ = 2c̄) |
| M6 | β² without the Δp term (`kernels.ts:439`) | oracle | **killed** (2 tests fail: C-pre and S) |

M1 failed C, C-pre, C physical, D, E-L5, E-L9a and S: a wrong flux cannot pass the 12.2 rows at u∞ = 0.
