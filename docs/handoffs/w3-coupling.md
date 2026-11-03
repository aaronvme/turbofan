w3/coupling session 1, STOP (partial: the brief's steps 1-3 in part; CP1 and CP2's sources in the oracle and the kernel, the coupling state and the station reduction; no calibrator yet, so no CP3-CP5 or L12) (from c8b9482; HEAD = the commit of this handoff)

DONE
- 3de589d (TDD), efc5100: `src/contracts/thresholds.ts` mirrors PHYSICS.md 3.3's CP1-CP5 verbatim (the contract test now reads two-letter IDs: 41 rows). The token parser reads "0.1 %" (a space before %, never before k). CP4's "a tenth" has no number; the test pins its text.
- 44d6b58 (TDD), 053374c: `src/flow/coupling` (the f64 form of record):
  - `rows.ts`: the definition's 38 rows on the mesh zones. Per cell: chord fraction from the edge lines at its radius, span fraction, a linear camber line, pitch, and the metal blockage 1 − B t / (2π r |cos κ|) with a biconvex t (so b = 1 at both edges). VSV rows turn by rotation_hp × closure × gain.
  - `bodyForce.ts`: Hall-Thollet on the 28 compressor rows (normal force ⊥ W, the stall saturation, Thollet's K_M capped at M_rel 0.8, friction + off-design + reversed-flow loss); follow-camber on the 10 turbine rows at 20 |W| / s; s_4 = Ω s_3; point-implicit. `cellForce` is per cell; `bodyForceCoefficients` (8 per cell) takes the speeds, the VSV closure, the 16 knobs and the blockage.
  - `knobs.ts`: the 16 knob ids and the row → knob families. The nozzle knobs are declared but not applied yet.
  - `combustor.ts`: the core cells between stations 3 and 4 with a sin² profile; rate0 with s_0 = s_5 = s_m and s_4 = q − h0∞ s_m (per radian, × 2π).
  - `src/cycle/engine.ts`: η_b moves into the exported `combustionEfficiency`, behaviour-preserving (cycle suite 299 passed + 5 expected fail).
- 6d5c425 (TDD), 2bec764, f62af16, f1599d6 (TDD), cd6b8b1: the kernel.
  - `src/flow/gpu/wgsl/bodyForce.ts` is the WGSL transcription (same order).
  - The cell-source coefficients go to 10 vec4 per cell (`setCellSource({ bodyForce })`), plus a test-only `readSources()`.
  - The damping of each force is its rank-one eigenvalue on every momentum component. The diagonal d n_i² is neutral at a large dt·d.
  - A rotor's energy takes its torque's damping, so the Euler work holds through a stiff stage. Without it the undamped energy took Ω × the undamped torque and overheated.
  - `tests/gpu/coupling.test.ts`: 130k asset, the body forces at 30 % speed and the take-off fuel, against the oracle.
- f5c6fc6 (TDD), e7a497f, 59f6b34 (TDD), 0401aaf: `FlowCoupling` adds 'calibrating' (contract, `flowCouplingProblems`, the legend's `provenanceLabel`, the HUD's field badge "FIELD: solver (calibrating)").
- 11ca1d0 (TDD), 2bec764: `src/flow/coupling/stations.ts`:
  - each station's grid line, with its cells (`stationCells` for a gather readback);
  - mass-averaged Pt and Tt (thermally perfect), W, area-averaged ps, swirl;
  - the gross thrust over stations 18 and 8, and `reduceStations` → the contract's `StationReduction`.
- f62af16: the PHYSICS.md 1 ledger has a W3 row: what is simulated, and every assumed constant. SOLVER.md 8 gets a short W3-sources paragraph.

RESULTS (CP rows of PHYSICS.md 3.3; no threshold changed)

| row | part | result |
|---|---|---|
| CP1 | Euler work per row, oracle, 130k (f64 metrics) | **PASS**, all 38 rows: rotors ≤ 1e-4 (s_4 = Ω s_3 per cell, so it holds to rounding), stators exactly 0 |
| CP1 | Euler work per row, kernel, 130k asset | **PASS**: worst rotor 2.77e-8 (f32 rates integrated in f64) |
| CP1 | blockage from the metal thickness | **PASS** (recomputed independently; b = 1 at both edges; HPT NGV min < 0.8) |
| CP1 | mass flux continuous through the edges (≤ 1e-3 between columns) | **NOT RUN**: it needs a converged coupled field (NEXT 2) |
| CP1 | stall saturation and reversed-flow loss continuous | **PASS** (the force across δ_s, across u = 0 and across the ±π wrap, to 1e-6 of its scale at ±1e-9) |
| CP1 | kernel vs oracle (SOLVER.md 12.2, rows C/E's 1e-5 / 1e-4) | **PASS** at 30 % speed: 9.93e-6 / 6.13e-6 after 1 / 10 (velocity 9.93e-6, p′ 4.45e-6, T′ 3.42e-6, ρ′ 2.72e-6, Z 2.45e-7). The 1-iteration margin is 1 % (decision 2) |
| CP2 | heat = η_b W_f LHV, fuel = W_f, within 0.1 % at the EEDB idle, approach, climb and take-off fuel flows | **PASS** (to rounding), oracle. Kernel: the same rate0, in the coupling test above |
| CP3, CP4, CP5, L12 | | not started |

FOR THE ORCHESTRATOR
1. **Z is the FAR in the gas model, but ρZ is transported as a conserved scalar (SOLVER.md 3-4).** CP2 puts W_f into ρ′ and ρZ (the fuel's mass), so downstream Z = W_f / (W_air + W_f), 2.4 % below the cycle's FAR4 at take-off. Estimated effect: Δφ ≈ 0.009, about 1.5 K in T4 (L12 allows ±10 K).
   - Options: (a) keep this, as CP2 reads; (b) put W_f (1 + FAR4) into ρZ, so Z4 = FAR4 exactly (then ρZ's source is no longer "W_f"); (c) redefine Z as the fuel mass fraction in §3's φ(Z). (c) is a contract change in oracle and kernel.
   - I recommend (a) now and revisiting it if L12's T4 shows the bias.
2. **The kernel comparison's 1-iteration margin.** e_q after 1 is 9.93e-6 against row C's 1e-5, and it is the velocity field. The same start without any source gave velocity errors of the same order in the inlet-lip region, so it reads as the base scheme's f32 on this sharp start state, not the coupling. A smoother start would give more margin. No bar was changed.
3. **A design-speed start from a non-rotating field is not robust.** Scratch probe, the coupling test at 100 % speed:
   - before the work damping, oracle and kernel were both non-finite within 10 iterations. The HPT rotor sat 2.3 rad off its camber at 1514 rad/s;
   - with it, finite at 10 iterations (max T′ 702 K), and non-finite again by 50 (2000 cells).
   - So CP4's warm start and CP5's ramp must start from a matched field and move the speeds and fuel by continuation. A rate or force limiter is the other option; it would change the model, so it needs a decision.
4. The assumed constants (the ledger row) are model choices with no public CFM56 data: stall incidence 0.15 rad, M_rel cap 0.8, reversed-flow loss 3, follow-camber rate 20/pitch, the biconvex thickness, the sin² heat release. The knobs trim their effect.

NEXT (in order)
1. **A stable path to a coupled field on the GPU.** Start from rest (or the look-dev start) and ramp the rows' speeds and the fuel to an idle point over N iterations, with `setCellSource` recomputed per step. Then go up the working line. Find the first stable ramp rate, and report P1 with the sources on (CP5's ≥ 150 it/s, indicative).
2. **CP1's mass-flux row** on that converged field. Read back the GPU state, set the oracle's U, then sum `ReferenceSolver.faceFlux(block, 'i', i, j)[0]` × 2π over each column of each row, one column before its LE to one after its TE. Max relative step between neighbouring columns ≤ 1e-3.
3. **Calibrator** (`src/flow/coupling/calibrator.ts`, pure, ≥ 90 %):
   - the trim log K_i += g_i e_i Δn, with knob → target pairings: fanTip → P13, fanHub → P25 (with the booster), hpcRotor/hpcStator → P3, hptNozzle → W25, lptNozzle → P45 or T45, the loss knobs → the Tts, bypassNozzle → W13, coreNozzle → W8;
   - the feedforward at the working-line points, computed in-process (the full table bake is w3/plume-bake's);
   - CP3 (the feedforward alone within 10 %), then CP4 (< 300 iterations, then 2000 with a spread ≤ a tenth). If CP4 can't be met, stop and report the data.
   - The nozzle knobs need their blockage applied (`knobs.ts` declares them).
4. **Station reduction in the app.** A gather of `stationCells` primitives with an async readback every ~10 iterations in `GpuFlowSolver`, then `reduceStations`. The body-force torques (lp/hp) come from the same gather or a reduction kernel.
5. **The app's solver path:**
   - `setTargets` → `bodyForceCoefficients` at the cycle's N1, N2 and VSV, plus the combustor's rates from `combustorSourceFromCycle`;
   - the coupling state uncoupled → calibrating → coupled from L12's check;
   - the worker; `test:browser` for the label and the field.
6. L12 at the working-line points; CP5's throttle ramp; then the ledger again.

GOTCHAS
1. **The detached runner.** `reports/scratch/detach.ps1` (gitignored, copied from w3-scheme). Start it as `Start-Process powershell -WindowStyle Hidden -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File \`"<ps1>\`" -Name <tag> -Cmd \`"<cmd ;; cmd>\`""`, with the argument list as ONE quoted string. As an array, the spaced -Cmd is split and the job silently never starts (no log). Logs and status files are in `reports/scratch/run/`.
2. **Timeouts and key order.** The 130k-mesh unit tests take about 5 s each on this laptop, so vitest's 5 s default timeout bit once; the heavy one has 60 s. Station ids are integer-like keys, so `Object.keys` orders them '2', '3', '4', '5', '8', '13', … (the test compares sets).
3. **Primitive layouts.** The oracle's u is absolute. The kernel's prim holds u′ = u − u∞, and the source kernel adds `P.uInf` before the body force.
4. **The kernel's source layout.** The 8-per-cell body-force record sits in slots 8-9 of the 10-vec4 coefficients. A cell with kind 0 adds exactly nothing, so E-L5 (2.67e-8) and E-L9a (K2 2.202e-11) are unchanged.
5. **Dependencies and files.**
   - `rowKnobs` throws for a row outside fan/bypassDuct/booster/hpc/hpt/lpt. `bodyForce.ts` imports `ENGINE_MEANLINE` (each row's design chord Reynolds number), so the kernel's WGSL module now pulls in the definition.
   - `npm run mesh:assets` before test:gpu (`public/mesh` is gitignored).
   - No dev server, Chrome or detached job is left running.

GATES @b713aab (on battery, detached one at a time)
- npm run typecheck: GATE_TYPECHECK
- npm run lint: GATE_LINT
- coverage: GATE_COVERAGE
- npm run test:gpu: GATE_GPU
- npm run test:gpu-ladder: GATE_GPULADDER
- test:ladder (CPU): not run. `src/flow/reference` is unchanged since c8b9482 (`git diff c8b9482 -- src/flow/reference` is empty), and the coupling's oracle-side code is unit-tested. test:browser: not run (no render/ui/app change; the legend and HUD changes are unit-tested). test:mesh: not touched.
