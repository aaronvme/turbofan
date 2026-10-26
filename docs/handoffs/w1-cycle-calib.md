w1/cycle-calib: DONE except C10 at MPA (and idle position 2 N2 by 0.03 point), which physically justified changes cannot meet: KNOWN FAIL, needs an orchestrator decision. Every other T1-T4 and C1-C10 check passes. (from main ca0f264; HEAD = the commit that adds this file)

DONE (each "(TDD)" commit came first and failed, except the guard tests noted)
- D3-3 / C10 pre-registered: 6009cdd, its own commit before any tuning. PHYSICS.md 3.2 row C10 and the thresholds.ts mirror (maxEgtErrorK 30 K, maxN2ErrorPoints 1.5), worded as D3-3; thresholds.test counts 4 + 10 + 13 + 3. The WIDURI Table 7 rows (idle 20.5/21.0 % N1, 60.6/60.7 % N2, 466/493 C; MPA 65.0 / 89.3 / 585; takeoff 97.4 / 99.8 / 855; 25 C, 1008 hPa) were already ENGINE_FACTS / facts.ts rows.
- D3-5 / T3 wording: 5242682 (TDD) / 041cf2d. T3's check now reads "... vs JANAF species tables mixed at the frozen stoichiometric Jet-A product composition (the method CEA uses for a frozen mixture)", tolerance unchanged, PHYSICS.md and thresholds.ts together. The T3 reference now uses an independent composition, not PRODUCT_MOLE_FRACTIONS.
  - Cantera: a wheel exists for Python 3.14 (cantera 3.2.0, venv outside the repo). tools/thermo/cantera_crosscheck.py uses Cantera's nasa_gas.yaml (NASA TM-4513 data) and its own equilibrium for the product composition. Recorded values are in gas.test.ts; the model is within 0.05 % (air 200-1500 K, products 1000-2000 K) and the composition within 1e-6 (CO2 13.29 %, H2O 12.71 %, N2 73.12 %, Ar 0.875 %, FAR 0.068173).
  - Dissociation (PHYSICS.md 2 note): 0.23 % in cp at the cycle's hottest gas (1641 K, 2.8 MPa, FAR 0.0245); 19 % only for stoichiometric products at 2000 K, 1 atm.
- W1C-N1: 041cf2d. N2 polynomial from NASA TM-4513 (TPIS78, 200-6000 K) instead of GRI's 300 K one. Air cp at 200 K: -0.90 % -> +0.001 % vs Cantera; extra T1-style JANAF checks at 200 and 250 K.
- W1C-I1 / C10: cde9c8b (TDD) / b918b75, docs 7a36e21. Part-power physics, none of which moves the design point:
  - mechanical loss proportional to N^2 (1 % of the design turbine power at design);
  - bypass duct, core nozzle and combustor cold losses proportional to (W sqrt T / P)^2;
  - the VBV schedule in the gas path;
  - a tip-clearance efficiency loss of 3 / 4 points x (1 - (N2/N2des)^2) on the HPC / HPT;
  - C10 runs with a 40 kW on-wing accessory load and no customer bleed (both ENGINE_FACTS `unknown` rows).
  - Reasons and ranges: ENGINE_FACTS "Cycle model calibration (W1)".
  - Fallout: the accel schedule factor is 2.2 -> 1.8, because the ground-idle slam surged otherwise (FADEC tuning, no threshold). C5 settles for 40 s, not 30, before the lever moves (its stability criterion is unchanged).
- W1C-I2 / D3-4: 3b8d096 (TDD) / be51d01. New src/cycle/surgeSystem.ts:
  - The duct runs from HPC station 25 to 3, with A_c the inlet annulus and L_c = A_c * integral dx/A = 1.251 m. The plenum runs from station 3 to 4: 0.0391 m^3. The tip is HPC rotor 1, 0.313 m.
  - B = U/(2 omega_H L_c) at the current N2. The cubic is fitted to the scaled HPC speed line with its peak on the stall point; the shut-off head is bounded below at the Moore-Greitzer example ratio, 0.3/0.66.
  - The throttle line runs through the matched HPC point. The episode ends when the Greitzer state settles on a stable equilibrium, with a 5 s cap.
  - An injected fault holds the equilibrium 10 % inside the surge line for 0.1 s.
  - The PHYSICS.md ledger row now says "period from the derived Helmholtz frequency".
  - Also tested: the criticalB closed form, RK4 order 4, and Helmholtz with L != 1 (the critic's greitzer survivors).
- W1C-I3: 10c3d79 (guard test, no red phase). The sized A8/A18 must match the facts within 5e-4, and the station 8/18 annuli within 1e-9. The message says to redo D2-2.
  - The TM-4513 N2 data moved the sizing by -0.08 % (A8), so D2-2 was redone: facts 0.1852 -> 0.1851 m^2 and 0.9161 -> 0.9162 m^2, then `npm run mesh`. The worst metrics are unchanged (130k: stretch 1.140, skew 55.2 deg, min J 2.61e-6, dt 1.22 us; 80k stretch 1.143), the manifest was regenerated and test:mesh is 29/29.
  - The stale ENGINE_FACTS text is fixed.
- W1C-I4: dd715b3 (guard tests) plus the product composition in 5242682.
  - C7/C8 at bleed 5 % + extraction 150 kW + VBV 0.15, at Mach 0.25, and at 35 kft M 0.8 at the published max-climb thrust (both nozzles choked; the pressure thrust is recomputed independently).
  - Surge margins are pinned at the loaded point (HPC 0.331, fan 0.182) and at a hand-computed map point.
  - Also: the design residual is < 1e-9 at the design unknowns (this kills the wCool mutant), the choked flux matches an independent max-flux search to 1e-9, and the shunt ramp is checked at 8200-9000 rpm.
  - Validation: OPR at max climb is 32.63 vs FICHE 32.7.
- W1C-N3: d5c9ab5 (TDD) / a66e554. sizeEngine throws when the secant does not converge or returns a non-finite value.
- W1C-N4: a66e554 / b918b75. The comment rot is fixed and at() replaces the `= 0` defaults.
- W1C-N5: e7e1c6a (TDD) / f4f45fd.
  - The EGT limiter aims at 955 C for at most 20 s above the redline, then at 945 C. The allowance renews below the max-continuous limit (925 C).
  - egtExceedance is time-aware: it fires above 960 C, or above 950 C for longer than 20 s.
  - The N1 limiter sits 0.5 point under 104 %, with TD_LIMIT 0.3 -> 0.5 s. A corner slam peaks at 103.60 %, and the 30 C corner makes rated thrust in the transient model.
- D2-15: 856b296. referenceEngine() is lazy and memoized (REFERENCE_ENGINE is gone), tests/unit/cycle/fixtures.ts holds the lazy test fixtures, and stryker.config.mjs has ignoreStatic, incremental and dryRunTimeoutMinutes 60. Mutation results: see MUTATION.

C10, model vs measured (WIDURI Table 7; OAT 25 C, 1008 hPa; 40 kW accessory load, no bleed)
| Point | N1 % | N2 model / measured (limit +-1.5) | displayed EGT model / measured (limit +-30 K) | Before (ca0f264) |
|---|---|---|---|---|
| Ground idle, pos. 1 | 20.5 | 61.53 / 60.6 (+0.93, pass) | 466.1 / 466-493 C (pass) | 61.04, 338.3 C |
| Ground idle, pos. 2 | 21.0 | 62.23 / 60.7 (+1.53, FAIL by 0.03) | 461.4 / 466-493 C (pass) | -, ~340 C |
| MPA | 65.0 | 86.71 / 89.3 (-2.59, FAIL) | 536.4 / 585 C (-48.6 K, FAIL) | 87.16, 503.7 C |
| Static takeoff | 97.4 | 99.88 / 99.8 (+0.08, pass) | 856.0 / 855 C (+1.0 K, pass) | 99.92, 853.4 C |

What limits C10 (decision needed)
- At the MPA N1 the measured EGT (585 C displayed, T49.5 = 828 K) is above the model's own T45 (826 K). No probe position or probe model can reach it: the core itself is too cold at 65 % N1, by about 50-80 K at T45, and N2 is 2.6 points low.
- Closing that takes about 20 % more heat release per kg of core flow at a fixed N1, and a higher N2/N1. The only levers that raise N2 at a fixed N1 are LP-side losses: fan, booster or LPT efficiency 4-7 points below the scaled pyCycle maps at 65 % N1. No public data supports that.
- Within their plausible ranges, the physical candidates do not close the gap: customer bleed (5 %: +39 K, but +54 K at takeoff), a larger accessory load (+8 K per 100 kW at MPA), combustion efficiency, the probe's radiation error (about 10 K), the VBV (it lowers N2), and a blade-speed-ratio turbine extrapolation (it lowers idle N2 by 4 points).
- The EEDB test-bed fuel flows point the same way: the model is 12 % low at 30 % thrust and 10 % low at 7 % (it was 15 % and 16.5 % low). The generic maps make the part-power engine too efficient.
- Options for the orchestrator:
  - (a) accept C10 as partly met: idle and takeoff pass, MPA and idle pos. 2 N2 stay KNOWN FAIL (it.fails markers in c10.test.ts flip red if they start passing);
  - (b) authorise LP-side map scalars or efficiency trends fitted to the MPA and EEDB points, as an explicit calibration with C10 reduced to a fit check;
  - (c) re-word C10 (for example MPA EGT only from a hotter-core source, or a wider MPA band). The idle pos. 2 miss is numerical sensitivity: idle sits where every map is extrapolated.

THRESHOLDS (this HEAD)
- T1: max 0.162 % at 1000 K; at 200 / 250 K, 0.0x % vs JANAF. T2 passes. T3 passes (max 0.21 %). T4: 2e-15.
- C1-C3: exact (sizing closure). C4 at ISA idle: N1 20.09 %, N2 61.00 %, 414.5 C displayed, 2.9 % of rated thrust.
- C5: 2.68 s. Peak EGT 953.9 C, min HPC margin 0.096. The 33.73(a) slam: peak 958.2 C, min margin 0.034, 95 % thrust at 5.84 s.
- C6: 920.3 C at the 30 C corner, N1 103.50 %.
- C7: max 6 iterations, residual 2.2e-11. C8: 1.1e-10.
- C9: the generic tests are unchanged.
- Engine surge (D3-4): at SLS takeoff B = 0.187 and omega_H = 1012 rad/s, so the Helmholtz period is 6.2 ms. The deep surge has reverse flow and a period of about 15 ms (2.2-3.0 Helmholtz periods; B < 1 makes it a relaxation oscillation). An injected surge lasts about 0.11 s, or 7 cycles.
- C10: see the table.

MUTATION
- (filled in below)

NEXT
1. The orchestrator decides on C10 (options above).
2. The plan file still says "100-300 ms" surge cycles (D3-4 wording). It is outside the repo, so it was not edited here.
3. The critic's probes under docs/reviews/probes import REFERENCE_ENGINE, which is now referenceEngine(); they need that rename to run on this branch.

GOTCHAS
- The idle match is sensitive to the map extrapolation rules. The fan runs below its lowest speed line and the LPT far below its pressure-ratio range. A blade-speed-ratio turbine rule (tried, not kept) moved idle N2 by -4 points.
- vitest.config is unchanged. Stryker uses the same suite. The ignored static mutants are the import-time GAS_TABLES build and the module constants.
- No new npm dependencies. The Cantera venv is at C:\Users\Aaron\scratch\w1cc\venv-cantera (outside the repo). Scratch probe scripts are in C:\Users\Aaron\scratch\w1cc. No dev server, Chrome or GPU device was started.

GATES @<filled in>
