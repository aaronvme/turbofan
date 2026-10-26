w1/cycle-calib-2: D3-14 round DONE (timeboxed).
- Added the core-side mechanisms and made the probe share a fitted parameter.
- The bounded fit meets C10, C4, and C11 at climb-out and idle. It misses C11 approach.
- The fit breaks the transient model, so it is REJECTED (D3-14 adoption rule). The reference calibration adds only the EEDB combustion-efficiency table, which is data, not a fit.
- KNOWN FAIL markers stay (C10 ×3, C11 ×2). The gap and its likely cause are in the PHYSICS.md ledger.

(from w1/cycle-calib @1e5e5b7; HEAD = the commit that adds this file)

DONE
- First round (D3-11), stopped at 4748705:
  - 5f035f3 pre-registered C11; 94838a6 (TDD) the C11 test.
  - 0b69ed6 (TDD) / dd13fcd the part-power mechanisms, the bounded least-squares solver and tools/cycle/fit-part-power.ts.
  - f145488 C11 KNOWN FAIL markers; 6887828 ENGINE_FACTS.
- D3-14 round, in the commit after this handoff's predecessor:
  - (a) Combustion efficiency vs power, as data:
    - New [EEDB] 8CM066 emission-index rows in ENGINE_FACTS and facts.ts (eiCoTakeoff ... eiHcIdle): CO 0.31 / 0.17 / 2.82 / 29.39 g/kg, HC 0.03 / 0.02 / 0.05 / 1.54 g/kg (85 / 30 / 7 % order: takeoff, climb-out, approach, idle). Test engine status NME. facts.test now converts g/kg.
    - eta = 1 - (EI_CO Q_CO + EI_HC Q_fuel) / (1000 Q_fuel). This is the energy balance behind SAE ARP1533's combustion efficiency, with Q_CO = 10.10 MJ/kg from the JANAF heats of formation.
    - The table is relative to takeoff and keyed on corrected fuel flow at the databank flows: idle -0.83 %, approach -0.06 %. It acts in the reference too.
  - (b) HPC part-speed falloff: a Reynolds lapse on the HPC inlet, exponent 0-0.2. No compressor correlation was verified, so the turbine bound is reused (`estimate`).
  - (c) HPT tip-clearance loss: now fitted, 2-4 points at standstill (the W1C-I1 range, [LS02]).
  - Probe share fitted in 0.25-0.45.
  - partPower.test pins the outcome.
  - ENGINE_FACTS: the section "Part-power calibration (D3-11, D3-14)" and the [D3-14], [ARP1533], [JANAF], [LS02] sources.
  - PHYSICS.md: a fidelity-ledger row for the known part-power gap.

C10 / C11, model vs measured
| Point | Measured | Reference (adopted) | D3-14 fit (rejected) | Limit |
|---|---|---|---|---|
| C11 85 / 30 / 7 % fuel flow | 1.031 / 0.343 / 0.110 kg/s | -2.5 / **-12.3 / -9.7 %** | +0.6 / **-6.4** / -4.3 % | ±5 % |
| C10 takeoff N2 / EGT | 99.8 % / 855 C | 99.88 / 856.0 | 100.32 / 866.6 | ±1.5 / ±30 K |
| C10 MPA N2 / EGT | 89.3 % / 585 C | **86.71 / 536.4** | 87.89 / 564.8 | ±1.5 / ±30 K |
| C10 idle pos. 2 / 1 N2 | 60.7 / 60.6 % | **62.23** / 61.52 | 61.21 / 60.47 | ±1.5 |
| C10 idle pos. 2 / 1 EGT | 466-493 C | 461.3 / 466.0 | 475.1 / 479.6 | 436-523 C |
| C4 ISA idle N1 / EGT | 20-22 % / < 500 C | 20.09 / 414.4 | 20.75 / 422.0 | inside |

Each mechanism: bound, then fitted value (sources in ENGINE_FACTS)
- Combustion efficiency: EEDB data, not fitted.
- Fan part-speed loss: 3.2-4.2 pt, fitted 4.2 ([SDT]).
- Booster part-speed loss: 0-4.2 pt, fitted 4.2.
- LPT Reynolds exponent: 0-0.2, fitted 0.2 ([AMDC]).
- HPC Reynolds exponent: 0-0.2, fitted 0.2.
- HPT clearance loss: 2-4 pt, fitted 4 ([LS02]).
- Probe share: 0.25-0.45, fitted 0.385.
- VBV dump: 0.10-0.30, fitted 0.284 (held by the booster-map guard).
- VBV fully open below / closed above: 61-75 / 80-95 % N2c, fitted 75 / 95 ([QAR], [VBVPAT]).
- VSV offset at 60 / 85 % N2c: ±6 deg, fitted -6 / +6 ([VGV]).
- The fit ran 15 iterations to a cost of 2.06.

What binds
- Every bound binds, except the VBV dump (held by the guard) and the probe share.
- One lever at a time past its bound reaches the C11 approach edge only at:
  - fan 6.3 pt (bound 4.2), booster 14.3 (4.2);
  - LPT exponent 0.47 (0.2), HPC exponent 0.45 (0.2);
  - HPT clearance 8.1 pt (4), VSV at 85 % +15.8 deg (6).
- No VBV setting gets there.
- Opening every bound by its own width passes all checks, but it needs the VBV open up to 99 % N2c, against the QAR record.
- The adopted fit, tried on a scratch copy, failed 10 transient tests plus the offdesign pin:
  - no 95 % thrust inside the 33.73(a) or C5 windows (10.7 kN after the 10 s slam);
  - the limiters do not engage;
  - the booster passes its map's choke edge in a slam decel and on a 45 C day.
- An earlier fit's 6 deg-open VSVs at idle gave the slam a -0.6 % HPC surge margin.

NEXT
1. Orchestrator: accept the documented gap, or rule on a mechanism that lowers idle N2 without opening the VSVs.
2. If a wide-open VBV must work in transients, the booster map needs a physical extension past R-line 3.0.

GOTCHAS
- Run `node --import ./tools/mesh/ts-resolve.mjs tools/cycle/fit-part-power.ts [--dry-run] [--relax]`. Under the Stryker load it takes about 4 min, plus about 6 more for `--relax`.
- withCalibration needs a real SizedEngine (referenceEngine()), not the lazy REF proxy.
- CO_HEATING_VALUE_J_PER_KG must stay above CYCLE_CALIBRATION, because of the temporal dead zone at import.
- Scratch is C:\Users\Aaron\scratch\w1cc2: fit4.log, test4.log (the adopted-fit run) and eedb/ (the databank, parsed by xlsx_row.py).
- No dev server, Chrome or GPU device was started. No new dependencies.

GATES (the D3-14 code commit; lint was rerun after a prettier fix to engine.ts)
- npm test: 1538 passed, 5 expected fail (C10 ×3, C11 ×2), 67 files.
- npm run lint: clean. npm run typecheck: clean.
- npm run coverage: lines 98.55 %, statements 97.62 %, branches 87.43 %, functions 98.46 %; src/cycle lines 99.45 % (branches 89.35 %), src/thermo 100 %.
- npm run test:mesh: 29 passed.
