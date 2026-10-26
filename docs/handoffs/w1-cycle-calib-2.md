w1/cycle-calib-2: STOPPED at D3-11 step 4 (as the brief says when a bound binds). C11 pre-registered; the D3-11 mechanisms are implemented, bounded and fitted, but their bounded optimum misses C11 at approach and idle and C10 at MPA EGT, and adopting it breaks the transient model, so the reference calibration keeps them off. Every other T1-T4 / C1-C9 check passes; C10 (3 checks) and C11 (2 checks) stay KNOWN FAIL. Orchestrator decision needed. (from w1/cycle-calib @1e5e5b7; HEAD = the commit that adds this file)

DONE
- 5f035f3 C11 pre-registered (D3-11), its own commit before any tuning: PHYSICS.md 3.2 row "Fuel flow at the EEDB LTO settings 7 / 30 / 85% rated thrust (ISA SLS) | within ±5% of the databank" plus a note, the verbatim thresholds.ts mirror (maxRelativeError 0.05; idle/approach/climb-out thrust % 7 / 30 / 85), thresholds.test counts 4 + 11 + 13 + 3.
- 94838a6 (TDD) tests/unit/cycle/c11.test.ts: ISA SLS test bed, no bleed or extraction, continuation in thrust to 0.07 / 0.30 / 0.85 x eedbRatedThrust. It failed at approach (-12.4 %) and idle (-10.5 %).
- 0b69ed6 (TDD) / dd13fcd: the D3-11 mechanisms, each zero at the design point (sizing, C1-C3 unchanged; partPower.test checks it):
  - fan part-speed loss (both streams) and booster part-speed loss: full at or below 87.5 % corrected speed, linear to 0 at 100 %. Applied as a fraction of the design efficiency, so the map efficiency is scaled and can never go negative.
  - LPT Reynolds lapse: (1 - eta) x (Re / Re_design)^-n, with Re ~ P45 / (sqrt(T45) mu), Sutherland.
  - the VBV schedule: max dump, fully open below, closed above (corrected N2).
  - an HPC VSV offset from the map's own schedule: knots at 60 / 85 / 95 % N2c, 0 at 95 % and above. It shifts the HPC speed line in flow by 0.688 per rad (1.2 % per deg), from the definition's IGV / rotor-1 velocity triangle (vsvFlowSensitivity). The displayed VSV closure includes the offset.
  - src/cycle/boundedLeastSquares.ts: a projected Levenberg-Marquardt method in variables scaled to [0, 1], forward differences with a fixed step, deterministic, with a backward difference where a solve fails.
  - src/cycle/partPower.ts: PART_POWER_PARAMETERS (bounds and reasons, set before the fit) and the objective. The residuals are C11 x 3 (/5 %), C10 N2 x 4 (/1.5 pt), C10 EGT x 4 (/30 K; idle measured against the 466-493 C range), and guards: C4 ISA idle N1 20-22 %, EGT under 500 C, booster R-line at most 2.9 (its map ends at 3.0).
  - The EGT probe share is re-derived for every candidate as the share that shows 855 C at the 25 C static takeoff run (the W0C-I6 / D2-3 rule).
  - tools/cycle/fit-part-power.ts runs the fit and writes src/cycle/partPowerFit.ts. `--dry-run` skips the write; `--relax` adds the diagnostics below.
  - CYCLE_CALIBRATION keeps the mechanisms off; PART_POWER_FIT_CALIBRATION holds the fit.
- f145488 C11 approach and idle as it.fails KNOWN FAIL (they flip red if they start passing). The C10 W1C-I1 markers stay (D3-11: until C10 genuinely passes).
- 6887828 ENGINE_FACTS: sources [D3-11], [SDT], [QAR], [VBVPAT], [VGV], [AMDC]. A new section, "Part-power calibration (D3-11)": mechanisms, bounds, fitted values and reasons, the fit procedure, C10/C11 at the optimum, what binds and the side effects. C11 is in model vs published. The VBV unknown rows note the fit.

C10 and C11, model vs measured (C10: WIDURI Table 7, 25 C, 1008 hPa, 40 kW accessory load; C11: EEDB 8CM066, ISA SLS test bed)
| Point | Measured | Reference (mechanisms off) | D3-11 bounded fit (not adopted) | Limit |
|---|---|---|---|---|
| C11 climb-out 85 % fuel flow | 1.031 kg/s | 1.006 (-2.5 %) pass | 1.036 (+0.4 %) pass | ±5 % |
| C11 approach 30 % fuel flow | 0.343 kg/s | 0.300 (-12.4 %) FAIL | 0.317 (-7.6 %) FAIL | ±5 % |
| C11 idle 7 % fuel flow | 0.110 kg/s | 0.0985 (-10.5 %) FAIL | 0.102 (-7.2 %) FAIL | ±5 % |
| C10 takeoff N2 / EGT | 99.8 % / 855 C | 99.88 / 856.0 pass | 100.36 / 856.3 pass | ±1.5 pt / ±30 K |
| C10 MPA N2 / EGT | 89.3 % / 585 C | 86.71 / 536.4 FAIL both | 88.02 pass / 550.7 FAIL (-34.3 K) | ±1.5 pt / ±30 K |
| C10 idle pos. 2 N2 / EGT | 60.7 % / 466-493 C | 62.23 FAIL / 461.4 | 61.53 / 459.4 pass | ±1.5 pt / 436-523 C |
| C10 idle pos. 1 N2 / EGT | 60.6 % / 466-493 C | 61.53 / 466.1 pass | 60.76 / 463.9 pass | ±1.5 pt / 436-523 C |
| C4 ISA ground idle N1 / EGT | 20-22 % / <500 C | 20.09 / 414.5 | 20.55 / 409.8 | inside |

Fitted parameters (bound; fitted; reason, full text and sources in ENGINE_FACTS)
- Fan part-speed loss: 3.2-4.2 pt; 4.2 (upper bound). [SDT] R4 fan: -0.8 to -1.2 pt at 87.5 % speed and -1.8 to -2.6 pt at 61.7 % against design, where the scaled pyCycle map rises +3.1 / +1.4 pt on the model's operating line.
- Booster part-speed loss: 0-4.2 pt; 4.2 (upper bound). No booster data; capped at the fan's falloff.
- LPT Reynolds exponent: 0-0.2; 0.2 (upper bound). [AMDC]: Dunham-Came (Re/2e5)^-0.2; Kacker-Okapuu none at Re 2e5-1e6. The LPT's Re is about 5.5e5 at the inlet and 2.6e5 at the exit at takeoff (estimate).
- VBV max dump: 0.10-0.30; 0.276, held by the booster-map guard. The upper end is the ISA-idle booster at the choke edge of its map.
- VBV fully open below: 61-75 % N2c; 75 (upper bound). Fully open at ground idle ([QAR], [VBVPAT]).
- VBV closed above: 80-95 % N2c; 95 (upper bound). [QAR]: closed in climb and cruise, partly open in descent.
- VSV offset at 60 % N2c and below: ±6 deg; -6 deg (lower bound, more open). Within the 6 deg IGV mis-rig of [VGV].
- VSV offset at 85 % N2c: ±6 deg; +6 deg (upper bound, more closed). Same reason.
- EGT probe share: re-derived, not fitted; 0.416 (was 0.35).
- The fit converged in 11 iterations at cost 3.48.

What binds, and by how much
- Every bound binds.
- One lever at a time past its bound, the others at the fit (`--relax`): only the fan loss reaches the C11 edge, at 8.0 pt for approach and 8.7 pt for idle, about 2x the SDT-derived 4.2 pt.
  - The booster (to 15 pt), the LPT exponent (to 0.5), the VBV closing speed (to 99.5 % N2c) and the VSV offsets (to ±20 deg) never get there.
  - Opening the VBV fully above 78.8 % N2c drives the booster off its map.
- All binding bounds opened by their own width at once: C10 passes and C11 approach passes (-2.2 %), but C11 idle is still -5.8 %. That run needs the fan at 5.2 pt, the LPT exponent at 0.4, the VSVs at -10 / +16 deg, and the VBV open up to 86 % N2c and shut only above 99.2 %, which contradicts [QAR].
- C10 MPA EGT depends on the probe rule:
  - with the share re-derived to 855 C (0.416), MPA misses by 4.3 K;
  - with the share held at 0.35, the same fit meets every C10 check (MPA 560.5 C) but shows 873.5 C at the 25 C static run, outside W0C-I6's 15 K;
  - shares of 0.375-0.383 pass both (0.38: 865.6 / 556.0 C).
- The C4 conflict: the C11 fan loss also raises N2 at a given N1 at idle. The SDT loss alone (3.2 pt) puts the ISA idle N1 at 19.83 % (C4 minimum 20 %) and idle pos. 2 N2 at 62.6 %. The fit compensates by opening the VSVs 6 deg at idle, which spends the HPC stall margin: an earlier fit gave -0.6 % in the 33.73(a) slam.
- Adopting the fit (scratch copy) fails 11 transient tests in model.test / modelPaths.test, besides a regression pin:
  - no 95 % thrust inside the 33.73(a) or C5 windows (10.4 kN after 10 s of the slam);
  - the limiter and steady-thrust tests no longer settle;
  - the VBV (open to 75 %, shut above 95 % N2c) drives the booster past its map's choke edge in a slam decel and on a 45 C day (thermo range errors).

Decision needed (options, not chosen)
- (a) Keep this state: the mechanisms off; C10 MPA N2/EGT and idle pos. 2 N2, and C11 approach and idle, stay KNOWN FAIL.
- (b) Authorise more physics outside D3-11's list. Candidates, not fitted here:
  - core-side part-speed losses (the same Reynolds lapse on the HPC and HPT). A probe in this round: an HPT clearance loss of 8 points instead of 4 gives +1.5 / +3.4 % fuel at 30 / 7 % and lowers idle N2 by 0.55 point, the direction C4 and C10 idle need;
  - combustion efficiency at low power taken from the EEDB's own CO/HC emission indices (published data, not fitted; not computed here);
  - the test bed's own parasitic loads.
- (c) Re-examine what C4 and the idle checks assume. The FADEC idle floor of 61 % N2 is a model assumption; the VSV schedule at idle conflicts with the 33.73(a) margin.
- (d) A wider fan bound needs about 2x the published SDT falloff. Nothing supports it; not done.
- The probe-share rule (W0C-I6 / D2-3) needs a ruling whichever path is chosen.

NEXT
1. The orchestrator decides (above).
2. If a mechanism is added: put it in partPower.ts with its bound and reason (before fitting), rerun `node --import ./tools/mesh/ts-resolve.mjs tools/cycle/fit-part-power.ts --relax`, then adopt by pointing CYCLE_CALIBRATION at the fit. Then drop the matching it.fails markers in c10/c11.test.ts and check the transient suite (model.test, modelPaths.test), the regression pin in offdesign.test (HPC 0.331 / fan 0.182 at the loaded point) and C6.
3. Mutation: untouched (the brief: no own Stryker runs; the detached run lives in w1-cycle-calib).

GOTCHAS
- withCalibration(e, cal) spreads the SizedEngine. The tests' lazy REF proxy cannot be spread (its target is {}), so pass referenceEngine() instead.
- Under the Stryker load, a full fit takes 2-4 min and `--relax` adds about 5 min. The full unit suite takes about 8 min.
- The booster map ends at R-line 3.0 on the choke side, where the pyCycle LPC efficiency at its 0.3 speed line is 0 (PR 1.0). Past it, compress() sees a non-positive efficiency and the thermo inversion throws. The fit's guard keeps the fitted points at 2.9 or less; transients with a wide-open VBV can still cross it.
- The VSV offset keeps the HPC operating point and stall line in the map's frame (surge margins and the Greitzer cubic are unchanged); only the continuity residual sees the physical flow (hpcVsvFlowFactor).
- Scratch probes are in C:\Users\Aaron\scratch\w1cc2 (fit logs fit3.log, the side-effect run test2.log, downloaded PDFs in dl/). No dev server, Chrome or GPU device was started. No new dependencies.

GATES @6887828 (the code and doc commits; the handoff commit adds only this file)
- npm test: 1513 passed, 5 expected fail (the 3 C10 and 2 C11 KNOWN FAIL markers), 0 failed, 67 files.
- npm run lint: clean (eslint --max-warnings 0, prettier). npm run typecheck: clean.
- npm run coverage: 1513 passed / 5 expected fail; lines 98.57 %, statements 97.62 %, branches 87.37 %, functions 98.46 %. src/cycle: lines 99.54 %, branches 88.79 % (partPower.ts lines 100 %, boundedLeastSquares.ts 97.4 %). src/thermo: lines 100 %, branches 87.5 %. A first coverage run, made while test:mesh ran beside it and under the Stryker load, timed out two slow setups (mesh report hook 10 s, a modelPaths test 5 s); the rerun alone passed.
- npm run test:mesh: 29 passed.
