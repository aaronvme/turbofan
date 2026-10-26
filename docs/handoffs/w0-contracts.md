w0/contracts: DONE. Contracts, ENGINE_FACTS (+ code mirror and doc-sync test), the CFM56-7B27/3-class definition, both mocks and the PHYSICS.md section 2 notes are in, all green; ready for the critic. (from fe260dd; HEAD = the commit that adds this file, on top of 709867e)

DONE
- 06a9de7 (TDD) / 7c7b399 src/contracts (previous builder): stations (ARP755/AS755), ambient, EngineDefinition + validator, cycle, flow solver + render textures (gauge encoding, matches D0-4), f16, sim/UI boundary, scenarios, UI schema, thresholds mirrored from PHYSICS.md section 3.
- 04e54a5 (TDD) / 4bbbd74 docs/ENGINE_FACTS.md filled and src/engine/facts.ts mirrors it.
  - 77 published rows (TCDS E.004, EEDB 8CM066, Safran fiche, NTSB AAR-19/03, Widuri 2026, AW 2008, 14 CFR 33.73 quoted verbatim) and 29 `unknown` rows, each with the model assumption and why.
  - Also: sources list, contradictions (airflow 792 vs 782 lb/s, length 2508 mm vs 103.5 in, TSFC 0.376 vs 0.386), the design-point derivation, the flowpath proportions table, and the model-vs-published skeleton.
  - D0-5: tsfcTakeoff = 1.293 / 121430 = 1.0648e-5 kg/(N s) = 0.376 (lb/h)/lbf, `estimate`; AW 0.386 recorded beside it (+2.7 %).
  - tests/unit/engine/facts.test.ts parses both tables. It checks the doc and facts.ts against each other (same IDs, SI, unit, confidence), that each SI value follows from its source value by unit conversion (tolerance 5e-4), that published rows cite a defined [SOURCE], that estimates show "derived", and the derivations themselves (TSFC, 100 % speeds).
- 25adc8c (TDD) / 2adfb4a src/engine:
  - designPoint.ts: constant-cp closure, gas sections calorically perfect with R_AIR. Net thrust +2.0 % of the TCDS figure, A8 0.1778 m², A18 0.9067 m², T4 1746 K. Tests: designPoint.test.ts.
  - bladeDesign.ts: continuity on the subsonic branch; free vortex; rotor frame; Carter's rule (n = 1/2 or 1); no deviation in turbines; counts from solidity. Tests: bladeDesign.test.ts.
  - definition.ts: ENGINE_DEFINITION, plus ENGINE_MEANLINE and ENGINE_DESIGN_ESTIMATE. Tests: definition.test.ts.
    - validateEngineDefinition returns [].
    - Every figure comes from facts.ts.
    - Rotation is -1/-1.
    - 38 rows: fan, OGV, booster IGV + 3 stages, HPC IGV + 9 stages with VSVs on IGV and S1-S3, HPT 1 stage, LPT 4 stages.
    - Fan: 24 blades, tip radius 0.7747 m, tip chord 0.2786 m (published 0.2794).
    - Station axial Mach numbers fall within plausible bands.
    - The mean-line Euler work equals each component's work to 1e-9.
    - The definition is deep-frozen plain data.
- c4c3d9f (TDD) / a1e3bff src/mocks:
  - mockCycle.ts: `createMockCycle(def)` is a CycleModel with `label: 'MOCK'`; `mockSteadyState(def, lever, ambient?)`; `mockN1PercentFromN2`.
    - The working line passes through Widuri's idle, MPA and static takeoff points (N1 exponent fitted, 1.76).
    - EGT corrected by EGT/theta from the 25 °C run-up day.
    - Thrust = TCDS x (N1/N1to)^2; fuel from the EEDB LTO points, so takeoff hits the C3 TSFC exactly.
    - Start: fuel no earlier than 20 %, light-off after 3 s, cut-out at 56 %, idle at about 60 s. Idle to 95 % thrust in 4.4 s (< C5).
    - Faults, shutdown and the EGT shunt are in.
  - mockFlowField.ts: `createMockFlowField(def, state, ambient, {version})` returns a CpuFlowField with `label`, `extents` and `version`, in the exact near/far rgba16float layout with the D0-4 gauge encoding. `createMockFlowModel(...).sample(x, r, smoothing?)` gives point values.
    - Pieces: ducts by continuity, fan free-vortex swirl in -theta, an intake sink, and coaxial jets (erf shear layers to Gaussian, dr1/2/dx = 0.094, momentum decay B about 6.3).
    - An engine at rest encodes as exact ambient bits.
  - Tests: mockCycle.test.ts and mockFlowField.test.ts (determinism, layout, encoding, ranges, walls, swirl sign, jets).
- ea36195 docs/PHYSICS.md: new sections 2.1 (frame, rotation, angle, curve conventions, D0-4 encoding, EGT shunt), 2.2 (station table with the reference-engine x) and 2.3 (design-point estimate, blade synthesis). Section 3 is untouched; thresholds.test.ts still passes.
- 709867e coverage: tests/unit/contracts/validators.test.ts covers the remaining validator branches (cycle, engine, scenario, UI, describeValue). src/contracts went from 95.8 % to 99.75 % lines.

NEXT
1. Critic pass 1: review contracts, facts, definition and mocks. The points most worth a look are under GOTCHAS.
2. Orchestrator: merge after MERGE. The plan's W1 builders read src/engine/facts.ts, src/engine/definition.ts and src/mocks.
3. W1 cycle: replace the design-point estimate as the truth. Fill the "Model" column of the ENGINE_FACTS model-vs-published table. Recalibrate if T49.5 stays hot (see GOTCHAS).
4. W2 flowviz: upload CpuFlowField with device.queue.writeTexture into rgba16float textures to build FlowField (bytesPerRow = 8 x width = 8192 near / 4096 far). Show a MOCK badge while `label === 'MOCK'`.

GOTCHAS
- Gas sections are calorically perfect with R_AIR, so the sonic speed and the energy equation agree: cold gamma 1.4 gives cp 1004.69; hot cp 1150 gives gamma 1.3326. The doc says so.
- The design-point closure is rough. FPR 1.55 closes at +2.0 % thrust; 1.60 would give +3.4 %, outside C1. T49.5 comes out at 1174 K, i.e. 931 °C displayed, which is only 19 K under the 950 °C redline and hotter than the 855 °C measured on a 25 °C day. W1 will likely need lower T4 or higher efficiencies. No threshold changed.
- Uniform-work free vortex behind the fan puts about 44 deg of swirl and Mach 0.84 at the booster IGV inlet. That follows from the method (representative geometry); W3's body-force calibration absorbs it.
- Widuri's fuel-flow columns (Tables 1, 5, 7) carry impossible exponents (e.g. 1.18e-3 kg/s at takeoff). They are not used; EEDB fuel flows are.
- [CFMWEB] (airflow 782 lb/s, length 98.7 in) could not be re-opened: web.archive.org is blocked from this environment. Only cross-check rows cite it. All other sources were re-read from the local copies in %TEMP%\tf-research (untrusted; not in the repo).
- "Fills the exact FlowField layout" is read as CpuFlowField (raw f16 texel data plus reference, extents and version). Creating GPUTextures is left to W2 so the mocks stay unit-testable in Node.
- mockCycle.test.ts: the green commit lengthened one settle from 20 s to 30 s. That is a tighter check: the 6-digit compare was borderline at 20 s.
- Full-resolution rasters (330k texels) are about 0.15 s warm but several seconds under coverage, so those tests have a 60 s timeout and use a byte compare (a deep toEqual on 1M-element typed arrays is very slow).
- Commit 2adfb4a's message says 41 rows; there are 38.
- Integer-like object keys ('2', '3', ...) enumerate numerically, so compare station-keyed records as sets. Scenario paths are string arrays (station '49.5' has a dot).
- `python -I` hides user site-packages here; use `python -P -E` for research scripts.
- No dev server or Chrome page was started. No new dependencies.

GATES @709867e (this commit adds only this file)
- npm test: 718 passed / 0 skipped (17 files)
- npm run lint: clean (eslint --max-warnings 0 + prettier --check)
- npm run typecheck: clean
- coverage (npm run coverage): lines 99.75 %, stmts 97.49 %, branches 93.45 %, funcs 99.63 %; src/contracts 99.75 % lines, src/mocks 100 %, src/engine 99.2 %
- gpu/browser suites: not touched, not run
