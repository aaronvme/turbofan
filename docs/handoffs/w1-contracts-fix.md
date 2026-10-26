w1/contracts-fix: DONE. Every W0C Important finding (I1-I5) and the cross-branch W0M-I5 are fixed, plus nits N1-N7 and N9; I6 and N8 are left to W1 calibration (see below). All gates green. (from 6619a45; HEAD = the commit that adds this file)

DONE (finding -> red test commit / fix commit; each red commit failed for the critic's reason)
- W0C-I1 4c85c70 / 18fcf0d `nextSnapshot` stamps `schemaVersion` and `version` after copying the parts, so parts spread from the previous snapshot (or forged ones) can no longer freeze the counter. Test: sim.test.ts "W0C-I1" (the critic's probe, 1/2/3 and a forged 99 -> 4).
- W0C-I2 a8c2c8f / f667360 `OutcomeResult.samples` counts the snapshots evaluated inside the window. An "always" outcome passes only with at least one sample; otherwise it fails with "never sampled in [from, to] s", both when a later snapshot closes the window and in `finalizeOutcomes`. Tests: scenario.test.ts "W0C-I2" (both probe cases, the count, a sample exactly on the window end). An "eventually" failure also says "never sampled" when nothing fell in its window.
- W0C-I3 7a77e73 / 068f9e4 provenance crosses D0-2: `SimSnapshot.sources: { cycle: 'mock' | 'model'; flow: 'none' | 'mock' | 'solver' }` (checked by `nextSnapshot`), `snapshotHasMockData()`, `'sources'` in `SNAPSHOT_ROOTS`, `CycleModel.source`, and `source: 'mock' | 'solver'` on both `CpuFlowField` and `FlowField`. The mocks stamp `'mock'`. `SIM_SCHEMA_VERSION` is now 2. Tests: sim.test.ts "W0C-I3", mockCycle/mockFlowField tests.
- W0C-I5 5d2d4ed / 64e12ce solver failure channel: `FlowStatus.status: 'unavailable' | 'initialising' | 'running' | 'diverged' | 'lost'` plus `error: string | null` (it replaces `available`). Diverged and lost must carry a message. `sanitizeFlowStatus` runs inside `nextSnapshot`: a non-finite residual or GPU time becomes null, stats with a non-finite counter and a reduction with any non-finite value are dropped, and the status becomes diverged with the path in `error`. A solver that already reports diverged or lost keeps its own status and message. The snapshot is still published, with the cycle and the incremented version. A NaN in the cycle state still throws. Tests: sim.test.ts "W0C-I5".
- W0M-I5 8407d55 / 11ee1ec render extents vs. the mesh domain: `SolverDomain {xIn, xOut, rOut}` (also on `MeshAsset.domain`), `SOLVER_DOMAIN_MIN_D` (MESH.md: 5 D upstream of the highlight, 5 D above the nacelle, 20 D behind the core lip), `minimumSolverDomain(def)` (D = 2 x the fan rotor's leading-edge tip radius) and `fieldExtentDomainProblems(extent, domain)` for the W2 loader to reject a mesh. The far extent is now r 0..8.4375 m in 108 square rows (78 mm texels kept), inside both the reference engine's minimum domain (r_out 8.81 m) and the generated meshes (8.75 m). Tests: flow.test.ts "W0M-I5" (also reads docs/mesh/metrics-{130k,80k}.json).
- W0C-I4 a4c2902 one case per unexercised `validateEngineDefinition` check (tests/unit/contracts/engineChecks.test.ts: curve helpers at their edges, trailing edges and knife edges, unknown hub/casing curves, coverage at the start and at the end, interior hub/casing spikes, the start/end planes, duplicate stations, rotor without a spool, edge below the hub, tip clearance on rotor tips only, hub r >= tip r, chords, the 90 deg / thickness / lean limits, empty row id, row order, touching rows, rows in different components, swept overlap, schedules and bleeds, each positive() field name, the efficiency/loss/cooling/EGT/shunt/start ranges with their accepted edges, both rotation signs). Also the two blade-design throws (swirl beyond the enthalpy, with an exact-zero case; Carter's "no solution" by message), the exit-velocity check, and zero turning at a tiny solidity. These are characterisation tests, green when they landed; Stryker shows what they killed (below). dbb1cb4 adds the cases the first post-fix Stryker run still found: empty trailing-edge curves, a row through the casing with no hub radius, and the pass budgets.
- W0C-N1 45082fa: the TCDS references in ENGINE_FACTS.md are now III.6 / III.2 / III.4 / III.5 (values untouched), and so is the definition.test.ts name.
- W0C-N2 77616cd / 2e8fd7d: `rasterizeField` throws when |v| > HALF_MAX instead of writing infinity.
- W0C-N3 3cddcf5 `FlowTargets.n1RadPerS/n2RadPerS` are documented as unsigned; multiply by `rotation[spool]`.
- W0C-N4 77616cd / 4a28b72, 452e7af / 3c727d5, 8296ccc / 2205104: `designRow(edges, aero, shape, limits?)` with `DESIGN_LIMITS {maxIterations 200, maxCountPasses 10}`. It throws when the stagger does not converge or the count does not settle. The 90 deg exit-metal check moved into the iteration: an 85 deg IGV used to run 200 iterations unconverged first. The throw exposed three reference rows (booster-igv 60/61, hpc-r1 35/36, hpc-r9 59/60) whose count flips between two neighbours, because the target solidity sits on a rounding boundary. The old loop silently returned whichever count the 10th pass left. The flip-flop now settles on the member whose own mid solidity is nearest the target (`nearestInCycle`, pure and exported; counts visited on the way into the cycle are not candidates). That reproduces the old counts, and ENGINE_DEFINITION + ENGINE_MEANLINE are byte-identical to 6619a45 (sha256 compared).
- W0C-N5 77616cd / 479e1d6: VSV closure in [0, pi/2). `validateCycleState` checks `egtMeasuredK === stations['49.5'].ttK` (1e-9 K) and that the switches and the 8 flags are booleans. The cycle fixture's EGT was made consistent (1100 measured, 1130 displayed).
- W0C-N6 77616cd / 7b966a5: `mockCycle.step` rejects dt > 1 s; the sim never asks for more than 0.4 s. A zero (paused) step takes the new inputs.
- W0C-N7 3cddcf5: sim.ts header caveat: the flow solver lives on the render thread, and only `FlowStatus` crosses.
- W0C-N9 77616cd / 94f6782: `findNonPlainData` rejects non-enumerable properties (structuredClone drops them) and non-index keys on arrays (structuredClone keeps them, so they escaped the check).

NOT FIXED HERE
- W0C-I6 (design-point EGT 931 C): WONTFIX in contracts. It is W1 cycle calibration with A8/A18 held, per D1-1 and D1-2. No threshold or fact changed.
- W0C-N8 (booster IGV inlet at Mach 0.84 / 44 deg): WONTFIX in contracts. It is a W1 calibration choice (fan-root work split); the geometry is representative and the critic agrees it is not a fault.

MUTATION (Stryker 10.1.1, perTest, mutate overridden to src/contracts/engine.ts + src/engine/bladeDesign.ts; local config reports/stryker.contracts.mjs, gitignored)
- before (6619a45 code): 80.86 % total; engine.ts 78.43 % (776 killed, 13 timeout, 205 survived, 12 no coverage), bladeDesign.ts 91.38 % (176 killed, 36 timeout, 19 survived, 1 no coverage). The critic measured 77.63 / 85.78 %; the difference is timeouts, which vary with machine load.
- after (2205104, the code at HEAD): 96.93 % total; engine.ts 96.67 % (971 killed, 15 timeout, 34 survived, 0 no coverage), bladeDesign.ts 97.88 % (241 killed, 36 timeout, 6 survived; it has more mutants now because of the convergence and flip-flop code).
- Remaining survivors, all equivalent:
  - Tolerance edges (`<` vs `<=` at X_TOL / R_TOL / 1e-6 / OPR_TOL, and the bisection stop): engine.ts 321, 371, 382, 399:41, 430, 509, 579 x2, 583, 598, 619, 652:49, 721; bladeDesign.ts 85, 221. They differ only when a float difference lands exactly on the tolerance.
  - engine.ts 292: `x < first.x` is reached only when radiusAt returned null, i.e. never at x = first.x.
  - engine.ts 316: Number.isFinite already rejects non-numbers.
  - engine.ts 350, 352: optional chaining behind a `!== undefined` test.
  - engine.ts 399:26: a null ri makes the test `ro < -1e-9`, impossible for r >= 0.
  - engine.ts 454, 459 x4: hubRadiusAt is null outside the component, so the unfiltered x are skipped anyway.
  - engine.ts 463 x4: hub and casing were checked to cover both ends, so a polyline covers every x between.
  - engine.ts 649, 652 x4: index guards required by noUncheckedIndexedAccess.
  - engine.ts 791 x2: NaN and +-Infinity already fail the inequalities that follow `every(isFiniteNumber)`.
  - bladeDesign.ts 83 x2: the bisection also stops on its interval width, with the same result.
  - bladeDesign.ts 250: a junk first entry never matches a numeric count and is never in a cycle.
  - bladeDesign.ts 254: without the explicit settle, nearestInCycle finds a one-member cycle at the current count, with the same result.

NEXT
1. Critic: review this branch (contracts API changes listed under GOTCHAS).
2. Orchestrator: merge. W1 cycle sets `source: 'model'` on its CycleModel and keeps `egtMeasuredK` exactly equal to `stations['49.5'].ttK`.
3. W2: build `FlowStatus` with status/error and call `fieldExtentDomainProblems(FIELD_EXTENTS.far, mesh.domain)` when loading a mesh. Upload the far textures at 512 x 108 and stamp `FlowField.source`.
4. W3: scenario runners must carry `OutcomeResult.samples` through, as `initialOutcomeResults`/`updateOutcomes` do.

GOTCHAS
- Breaking contract changes (no consumer existed yet):
  - `FlowStatus.available` is gone (use `status`/`error`);
  - `SimSnapshot` has `sources`, and `SIM_SCHEMA_VERSION` is 2;
  - `OutcomeResult.samples`, `CycleModel.source`, `CpuFlowField/FlowField.source`, `MeshAsset.domain`;
  - the far extent is 108 rows high, not 128;
  - `nextSnapshot` now throws on missing or unknown sources and on a failed flow status without a message.
- The test of the far extent against the generated meshes reads `docs/mesh/metrics-*.json` `report.domain`. If w1/mesh renames that field, update the test (the minimum-domain test from the definition stays the contract).
- `vitest run` prints "Tests N passed" even when a whole file fails to import. Check the "Test Files" line too. The N4 throw broke the definition build that way on commits 4a28b72 through 452e7af, and 3c727d5 fixed it. Do not bisect into that range expecting green.
- Python heredocs through the Bash tool turned `'\\n'` into a real newline in two test edits. Use the Edit tool for strings with escapes.
- The critic's probe file now fails on purpose for I1, I2, I3, N2 and N5 (each probe pinned the old behaviour).
- No dev server, Chrome page or GPU device was started. No new dependencies.

GATES @2205104 (this commit adds only this file)
- npm test: 934 passed / 0 skipped (30 files)
- npm run lint: clean (eslint --max-warnings 0 + prettier --check)
- npm run typecheck: clean
- coverage: lines 99.42 %, statements 98.28 %, branches 89.03 %, functions 99.82 %; src/contracts 99.67 % lines, src/engine 99.51 %, src/mocks 100 %, tools/mesh 99.14 %
- gpu/browser suites: not touched, not run
