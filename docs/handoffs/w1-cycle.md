w1/cycle: STOP-CLEAN at the self-brake, mostly done. Thermo, maps, design point, off-design and the Greitzer model are green. The transient CycleModel works end to end (C9 and start flags green), but C5 fails at 5.16 s against 5.0 s, and src/cycle branch coverage is 80.2 % against the 85 % config gate. (from w1/contracts-fix @3969af7; HEAD = the commit that adds this file)

DONE (TDD: each "(TDD)" commit came first and failed)
- c3a2b58 / 75b1b4e+ src/thermo. species.ts holds the NASA 7-coefficient polynomials for N2, O2, Ar, CO2 and H2O (GRI-Mech 3.0 thermo30.dat, Burcat's data). gas.ts gives cp, h (sensible, relative to 298.15 K), the entropy function, gamma, R, the frozen mixture by FAR (air plus stoichiometric C12H23 products), T(h) and T(s,p) by Newton (stops at 1e-9 K), and isentropicTemperature. h and the entropy function are integrated analytically from cp, with continuity at 1000 K. GAS_TABLES exports two gases x two ranges (5 cp coefficients plus hConst and sConst) for the W2 WGSL generator. Test: tests/unit/thermo/gas.test.ts (33 tests).
- 063cd92 / 4db5442 maps. Fan, LPC, HPC, HPT and LPT were ported from pyCycle commit ee7e161 (Apache-2.0). They were fetched with curl rather than WebFetch, so the bytes are exact (WebFetch summarises). A script parsed them with ast and never executed them. Each file has a header, and NOTICE is at the repo root. componentMaps.ts provides a C1 tensor-product Hermite lookup and pure pyCycle-style scaling (s_Wc, s_PR on PR-1, s_eff pinned at the map's design Nc/R-line). It also has the surge margin at equal corrected flow, sub-map similarity extension (Gaudet & Gauthier GT2007-27193) and Stodola below the turbine PR range. Test: maps.test.ts.
- cf4e4d2 / 2358d59 engine.ts. Sizing per D1-2: the fan bypass PR (1.537) is solved so that thrust is 121430 N at the EEDB 1.293 kg/s. The outputs are A8 = 0.1852 m² (+4.2 % vs the 0.1778 placeholder) and A18 = 0.9161 m² (+1.0 %). The gas path has 6 unknowns: fan R, BPR, LPC R, HPC R, HPT PR and LPT PR. solveSteady adds N1, N2 and Wf, with a fuel, N1, N2 or thrust spec. groundIdle() reaches idle by continuation. balances() is the C8 check. Test: engine.test.ts.
- bda44d4 / (WIP commit) greitzer.ts (C9) and model.ts (CycleModel, `createCycleModel()`).
  - J dw/dt with inertias LP 60 and HP 10 kg m², derived in the header.
  - FADEC: a single Wf/P3 integrator with a lowest-wins selector (N1 target, idle floor N2 61 %, N1/N2/EGT limiters with EGT at the 960 C transient limit), between accel and decel schedules (2.2-2.5x and 0.6x the steady Wf/P3).
  - Below 57 % N2, or unlit: a similarity sub-idle model anchored at ground idle (Agrawal & Yunis 81-GT-202).
  - Start: starter torque, fuel at the 20 % FADEC minimum (the test moves the lever at 25 %), light-off 3 s after fuel, cut-out at 56 %, idle in 38.5 s, EGT peak about 370 C. Flags for hung, hot and no-light-off starts.
  - Surge: the HPC beyond its surge line, or injectFault, runs a Greitzer episode (0.3 s, 25 % fuel cut).
  - Test: model.test.ts.
- ENGINE_FACTS.md: the "Model vs published" table is filled, and a new "Cycle model calibration (W1)" section records the calibration.

THRESHOLDS
- T1 cp air 300/500/1000/1500 K vs NIST-JANAF (fetched): pass, < 0.5 %. T2 gamma: pass. T3 products at 1000/1500/2000 K vs a frozen JANAF mixture formed the CEA way: pass. T4 h vs a Gauss-Legendre integral of cp: pass, < 1e-6 (including across 1000 K). The exact error values were not printed (budget). T3's reference is JANAF species data mixed as CEA does, not a CEA run.
- C1, C2 (BPR, OPR, W) and C3 are 0.0 % at the design point: the sizing closure is exact, and off-design reproduces it to 1e-6.
- C4 at ISA ground idle: N1 20.5 %, N2 61.0 %, EGT 319 C displayed. All pass. Idle thrust is 1.0 % of takeoff (at most 15 % is allowed).
- C5: FAIL, 5.16 s from ground idle to 95 % thrust, with the lever moved 0 to 1 in 1 s, no surge, and minimum HPC surge margin 0.03. Fuel is limited early by the accel schedule against the HPC surge margin at 61-75 % N2. 2.6x gave surge.
- C6 (D1-1, 30 C, rated thrust): 922.5 C displayed, 27.5 K under the 950 C redline. Pass. N1 is 103.4 %, under 104 %.
- C7: idle plus 16 sweep points all converge, max 6 iterations, residual < 1e-10. Pass.
- C8: mass and energy imbalance at most about 1e-10. Pass.
- C9: B 1.0 > B_crit 0.661 gives deep surge (min Phi -0.039) with a period 1.174 x the Helmholtz period (+17.4 %, limit 20 %). B 0.5 recovers. Pass.

CALIBRATION (W0C-I6)
- Thermally perfect gas alone takes the ISA EGT from 931 C to about 893 C.
- Energy balance pins T45 to the fuel flow and T25, so the remaining 36 K at the 25 C run was closed with two unpublished parameters:
  - ISA takeoff N1 = 101 %. With it, N2 at the run is 99.9 % against 99.8 % measured; with 100 % it is 100.3 %.
  - EGT probe at 0.35 of the LPT work. Equal stage work would give 0.25; the extra stands in for the probe's low reading.
- Result: 853.1 C against the measured 855 C. Everything else is unchanged.

NEXT (orchestrator decisions first)
1. DECIDE C5. Options:
   - accept a TBV model (HPC 9th-stage bleed to the LPT during accels; the CFM56-7 has one) to buy HPC margin;
   - revisit the HP/LP inertia estimates (both unpublished);
   - accept that a ground-idle start point is harsher than 33.73(b)'s flight-idle point.
   The threshold was not touched.
2. DECIDE A8/A18. The sized values differ from the definition's flowpath (`PLUG_R_AT_CORE_LIP` and `COWL_R_AT_FAN_NOZZLE` still give 0.1778 and 0.9067). The cycle uses its own sized areas. Updating the definition and the facts rows (bypassNozzleArea, coreNozzleArea) moves geometry under w1/mesh and w1/geometry and breaks designPoint.test.ts expectations.
3. DECIDE whether the probe-fraction calibration (0.35) is acceptable or wants a radiation-error term instead.
4. Branch coverage of src/cycle: add tests for the model's abort, shutdown, flameout/relight, ambient change and invalid-input paths.
5. Run `npm run mutate` on src/thermo and src/cycle. Not run (budget).
6. Not done: a thermocouple lag on EGT (validateCycleState pins egtMeasured = T49.5); VBV and TBV fed to the gas path (VBV is reported only); a combustion-efficiency drop at idle; customer bleed taken from HPC exit rather than stage 5/9.

GOTCHAS
- The model's n1Percent is relative to the definition's 100 % speed (5175 rpm). The design point is 5227 rpm (101 %), held in CycleCalibration n1Rpm vs n1ReferenceRpm.
- Idle EGT is about 150 K below the measured ground run (466-493 C): the model has no customer bleed, accessory load or VBV flow at idle.
- StationState cannot express reverse flow. During a Greitzer episode, station 3 W shows 0 when Phi < 0. This is a contract question for later.
- Similarity sub-idle pressures are floored at ambient (documented in the code).
- The model's simulation tests take about 40 s under coverage. The describe blocks have a 120 s timeout.
- Each CycleModel reset or ambient change runs about 25 steady solves (about 0.1-0.3 s).
- No new dependencies. No dev server, Chrome or GPU device was started. Scratch scripts are outside the repo.

GATES @ the WIP commit (this commit adds docs only)
- npm test: 1007 passed / 1 failed (C5) / 0 skipped (34 files)
- npm run lint: clean. npm run typecheck: clean.
- coverage: lines 99.3 %, statements 98.2 %, branches 87.9 %, functions 99.9 %; src/thermo 100 % lines, src/cycle 98.6 % lines. src/cycle branches 80.2 % < 85 %, so the gate FAILS.
- mutate: not run.
