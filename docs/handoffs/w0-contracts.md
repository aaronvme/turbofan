w0/contracts: STOP-CLEAN (usage brake). Deliverable 1 (src/contracts) is done and green; deliverables 2-4 (mocks, definition.ts, ENGINE_FACTS.md) are not started in code. The research for them is done and recorded below. (from fe260dd; HEAD = the commit that adds this file, on top of 7c7b399)

DONE
- 06a9de7 (TDD) contract tests, RED: the 9 test files failed to import the missing modules.
- 7c7b399 src/contracts GREEN (312 tests):
  - stations.ts: ARP755 (superseded by AS755) stations 0,1,2,13,18,19,21,24,25,3,4,41,45,49.5,5,8,9; SOLVER_REDUCTION_STATIONS = 2,13,18,25,3,4,45,5,8; STREAM_ORDER.
  - ambient.ts: ISA_SLS, R_AIR, validateAmbient.
  - engine.ts: EngineDefinition (7 curves, 11 components, station planes, blade rows, VSV schedules, bleeds, design point, ratings, limits incl. EGT shunt, start schedule) and validateEngineDefinition (about 60 checks, each tested against tests/unit/contracts/fixtures/engineFixture.ts). Angles are geometric (from +x, positive toward +theta); rotation[spool] = +-1 about +x.
  - cycle.ts: CycleInputs, CycleState (egtDisplayedK = T49.5 + shunt), CycleModel {reset, step, injectFault, state}, validateCycleInputs/State.
  - flow.ts: FlowSolver, MeshAsset header, FlowTargets plus flowTargetsFromCycleState, StationReduction, render textures. near is 1024x256 over x[-2,5] r[0,1.75]; far is 512x128 over x[-8,32] r[0,10]; both rgba16float. Channels: state = (p-pinf)/pinf, (rho-rhoinf)/rhoinf, T K, FAR; velocity = ux, ur, utheta, fluidFraction. rasterizeField and sampleCpuField (bilinear, axis mirror) are the CPU sampling interface.
  - half.ts: f16 conversion; all 65536 bit patterns round-trip, and it matches Math.f16round.
  - sim.ts: SimSnapshot, SimCommand (16 types), SimCommandMessage, validators, findNonPlainData (rejects class instances, functions, NaN, cycles, holes), deepFreeze, nextSnapshot, SimClock plus advanceClock.
  - scenario.ts: timeline + outcomes as data (array paths, eventually/always/at windows), a pure reducer, and validateScenario.
  - ui.ts: view modes, overlays, fields, colormaps (perceptual only), quality presets, RenderState, validators.
  - thresholds.ts: all 29 IDs. thresholds.test.ts parses docs/PHYSICS.md §3 and asserts Check, Pass and section verbatim, and that every typed number is parsed from its own text token.

NEXT (in order)
1. docs/ENGINE_FACTS.md: write the figures below as table rows (ID | Figure | Source value | SI | Source | Confidence). Then add src/engine/facts.ts and a test that each fact's SI text matches the doc row.
2. src/engine/definition.ts (+ src/engine/bladeDesign.ts: free-vortex velocity triangles + Carter's rule δ = mθ/σ^n, n=0.5 for decelerating rows, n=1 for accelerating IGVs, δ=0 in turbines; stagger = mean of metal angles; counts from a target solidity). Test that validateEngineDefinition(def) returns []. The planned flowpath polylines, row specs and work split are in the GOTCHAS.
3. src/mocks/mockCycle.ts. Data-driven: N1 = N1idle + (N1to − N1idle)·s^1.75 with s = the N2 fraction. The exponent is fitted to Widuri's 65 % N1 / 89.3 % N2 point. Fuel flow is interpolated linearly through the EEDB LTO points; the start sequence goes 25 % fuel-on, light-off, 56 % cut-out, idle. Then src/mocks/mockFlowField.ts: a point sink at the highlight, two Gaussian jets with spreading 0.094 and a potential core, and free-vortex swirl between the fan TE and the OGV/booster IGV. Internal ducts take their state by interpolating the stations along x and inverting the flow function.
4. docs/PHYSICS.md §2: add the coordinate and station notes (from the stations.ts and engine.ts headers).
5. Coverage polish: cycle.ts 90.7 %, describe.ts 67 %, scenario.ts 92.6 %, ui.ts 93 % lines. The aim is ≥ 95 % in contracts.

Researched figures (all fetched 2026-10-24). Reference variant: CFM56-7B27/3 (Tech Insertion).
- EASA TCDS E.004 Issue 07 (9 Jan 2023), https://www.easa.europa.eu/en/downloads/7795/en (official):
  - takeoff 12143 daN; max continuous 11521 daN;
  - stages: 1 fan, 3 LPC, 9 HPC, 1 HPT, 4 LPT, annular combustor;
  - length 2508 mm, width 2118 mm, height 1829 mm; dry weight 2386 kg;
  - N1 max 5382 rpm = 104 %, N2 max 15183 rpm = 105 %, so 100 % = 5175 / 14460 rpm;
  - displayed EGT: takeoff 950 °C, max continuous 925 °C, start 725 °C, transient 960 °C for 20 s;
  - EGT is measured at T49.5 (LPT stage 2 nozzle); display shunt +30 °C (SAC/TI non-/F), ramped linearly over 8300–8500 rpm N2 for TI;
  - bleed limits (III.10): bypass 2 % of secondary flow; HPC 5th stage 10 %; HPC 9th stage 12 %→7 %; 5th + 9th combined 13 %→10 %.
- ICAO Engine Emissions Databank v32 (EASA, https://www.easa.europa.eu/en/downloads/131424/en), UID 8CM066 (-7B27/3) (official):
  - BPR 5.1, OPR 29.0, rated thrust 121.4 kN;
  - fuel flow at T/O 1.293, C/O 1.031, App 0.343, Idle 0.110 kg/s.
  - UID 3CM034 (-7B27 SAC): BPR 5.0, OPR 28.63, T/O fuel flow 1.284 kg/s.
  - Derived TSFC (estimate) = 1.293/121430 = 1.0648e-5 kg/(N s) = 0.3759 (lb/h)/lbf. Aviation Week 28 Jan 2008 gives 0.386 for -7B27, 2.7 % higher; it also lists OPR 28.9 and a max envelope diameter of 65 in.
- Safran/Snecma CFM56-7B fiche, Mar 2011 (archived: https://web.archive.org/web/20161220201436/http://www.safran-aircraft-engines.com/file/download/fiche_cfm56-7b_ang.pdf) (official):
  - 27,300 lbf, flat rated to 86 °F (30 °C);
  - airflow 792 lb/s (359.25 kg/s), BPR 5.10;
  - max climb thrust 5,960 lb at 35,000 ft, M0.8, ISA; OPR at max climb 32.70;
  - fan diameter 61 in (1.5494 m); length 103.5 in, which conflicts with the TCDS (use 2508 mm).
- CFM technology page 2010 (archived cfm56.com/products/cfm56-7b/cfm56-7b-technology), for -7B27: airflow 782 lb/s, BPR 5.1, OPR at max climb 32.8, max cruise thrust 5,480 lb, length 98.7 in, weight 5,216 lb.
- NTSB AAR-19/03 §1.3.1 (published):
  - 24 Ti-6-4 wide-chord fan blades, chord about 11 in (0.279 m), about 10.83 lb each;
  - "The engine rotates clockwise (aft looking forward)", so rotation = −1 about +x (co-rotating spools assumed).
- Widuri et al. 2026, AVITEC 8(1) 125-137, doi:10.28989/avitec.v8i1.3415 (published):
  - AMM-based ground-idle limits: N1 20–22 %, N2 60–62 %, EGT < 500 °C;
  - measured idle: N1 20.5–21.0 %, N2 60.6–60.7 %, EGT 466–493 °C (OAT 25 °C);
  - start: start lever to idle at 25 % N2, starter cut-out 56 % N2, peak EGT 492 °C, starting time 60 s;
  - static takeoff: N1 97.4 %, N2 99.8 %, EGT 855 °C; MPA: 65 % N1, 89.3 % N2, 585 °C.
- 14 CFR 33.73: fetched verbatim from the eCFR API, version 2026-10-01; quote it in ENGINE_FACTS.
- Unknown (state the model assumption in ENGINE_FACTS):
  - cruise TSFC;
  - flight-idle N1: C5 starts from ground idle, which is under 15 % of takeoff thrust (33.73(b) alternative);
  - light-off time: assume 2–4 s after fuel on;
  - fan PR, T4, component efficiencies;
  - nacelle max diameter: assume 2.12 m so the axisymmetric nacelle encloses the TCDS width;
  - VSV stages: IGV + S1–S3 per CFM training material (secondary only); VBV and TBV counts unknown.
- Design-point estimates, from my rough closure (constant-cp sections, 12 % turbine cooling, LHV 43.2 MJ/kg):
  - PRs: fan bypass 1.60, fan core 1.50, booster 1.75, HPC 11.048 (OPR 29);
  - isentropic efficiencies: fan bypass 0.90, fan core 0.89, booster 0.89, HPC 0.87, HPT 0.90, LPT 0.91; combustor efficiency 0.995, combustor ΔP 5 %;
  - T3 about 836 K, T4 about 1745 K;
  - thrust closes within +1 % to +3 % for FPR 1.55–1.60;
  - fan tip speed at 100 % N1 = 419.8 m/s; fan-face specific flow 208.8 kg/(s m²) at hub/tip 0.296.

GOTCHAS
- Integer-like object keys ('2', '3', …) enumerate numerically, so compare station-keyed records as sets.
- Scenario paths are string arrays, because station '49.5' contains a dot.
- The render textures store gauge ratios (p − p∞)/p∞, not the plan's p/p∞. At 1.0, f16 quantises p/p∞ to about 1e-3 (about 100 Pa). Flagged for the orchestrator; the flow.ts comments explain it.
- MAX_CUSTOMER_BLEED_FRACTION = 0.13 (TCDS combined limit); validators use it.
- Planned flowpath (m, fan face x = 0):
  - inlet highlight (−0.775, 0.800); throat r 0.735; fan casing 0.7747; spinner from (−0.42, 0) to (0, 0.229);
  - splitter lip (0.26, 0.430); nacelle TE x 1.55 (inner 0.757, outer 0.775); max outer r 1.06;
  - HPC [0.84, 1.44], hub 0.222→0.262, casing 0.316→0.281; combustor [1.44, 1.72]; HPT [1.72, 1.86]; LPT [1.95, 2.30], casing up to 0.48;
  - core nozzle lip x 2.75, r 0.39/0.405; plug tail (3.25, 0);
  - resulting areas: A8 about 0.346 m², A18 about 0.84 m².
  - The 19 HPC rows are tight; the LPT may need [1.95, 2.33].
- Engine length: place the 2.508 m from the fan-case flange (x ≈ −0.09) to the TRF aft flange (≈ 2.42).
- `python -I` hides user site-packages here (no openpyxl); use `python -P -E` for research scripts.
- Research downloads are in %TEMP%\tf-research (untrusted; not in the repo).
- The Chrome page I opened (isolated context w0-contracts) is closed. No dev server was started.

GATES @7c7b399 (run just before the STOP; this commit adds only this file)
- npm test: 312 passed / 0 skipped (10 files)
- npm run lint: clean (eslint --max-warnings 0 + prettier --check)
- npm run typecheck: clean
- coverage (vitest --coverage, same config as npm run coverage): lines 95.9 %, stmts 93.6 %, branches 91.0 %, funcs 99.2 %; src/contracts 95.8 % lines
- gpu/browser suites: not touched, not run
- No new dependencies.
