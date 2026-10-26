# Engine facts (CFM56-7B27-class reference data)

Every figure the model is checked against lives here, with its source. The engine in the app is a *generic CFM56-7B27-class* turbofan: it uses public figures and synthesized blade shapes, not proprietary data, and the UI never uses CFM branding.

Rules (same as meridian's `ALPACA_FACTS.md`):
- Each figure has: value in the source's units, SI value, source (title + URL or document number), and how sure it is (`official` = type certificate data sheet / manufacturer; `published` = reputable secondary source; `estimate` = derived, show the derivation).
- Never invent a figure. If no source exists, write `unknown` and say what the model assumes instead.
- Contradicting sources: list both, say which one the model uses and why.

Reference variant: **CFM56-7B27/3** (Tech Insertion, "TI"), the 27,300 lbf rating of the 737NG engine. All sources below were fetched and read on 2026-10-24.

**Code mirror.** `src/engine/facts.ts` holds every row of the two fact tables below (ID, SI value, unit, confidence). `tests/unit/engine/facts.test.ts` parses this file and fails if a row and its mirror differ, if either side has a row the other lacks, or if an SI value does not follow from its source value by unit conversion. `src/engine/definition.ts`, the mocks and later the cycle tests read their numbers from `facts.ts`, never from literals, so the doc, the code and the tests cannot drift apart. Table format: `| ID | Figure | Source value | SI | Source | Confidence |`; the SI cell is `<number> <unit>` (no unit = dimensionless).

## Sources

- [TCDS] EASA Type-Certificate Data Sheet E.004, CFM International CFM56-7B series engines, Issue 07, 9 January 2023. https://www.easa.europa.eu/en/downloads/7795/en
- [EEDB] ICAO Aircraft Engine Emissions Databank v32 (hosted by EASA), UID 8CM066 (CFM56-7B27/3, Tech Insertion) and UID 3CM034 (CFM56-7B27). https://www.easa.europa.eu/en/downloads/131424/en
- [FICHE] Snecma / Safran, CFM56-7B product data sheet (fiche_cfm56-7b_ang.pdf), March 2011, archived copy: https://web.archive.org/web/20161220201436/http://www.safran-aircraft-engines.com/file/download/fiche_cfm56-7b_ang.pdf
- [CFMWEB] CFM International, CFM56-7B technology page, 2010 archive of http://www.cfm56.com/products/cfm56-7b/cfm56-7b-technology, read by the W0 research pass on 2026-10-24. The archive could not be re-opened from this environment, so only cross-check rows cite it.
- [AW08] Aviation Week & Space Technology, Gas Turbine Engines specifications tables, 28 January 2008 (CFM56-7B27 and -7B27/3 rows).
- [NTSB] NTSB Aircraft Accident Report AAR-19/03 (Southwest Airlines flight 1380, CFM56-7B fan-blade-out), section 1.3.1. https://www.ntsb.gov/investigations/AccidentReports/Reports/AAR1903.pdf
- [WIDURI] A. Widuri et al., "CFM56-7B Electronic Engine Control System Performance ...", AVITEC 8(1), 125-137, February 2026, doi:10.28989/avitec.v8i1.3415. Table 1 (AMM 737NG ch. 70-80 ground-run limits), Tables 3, 5 and 7 (an on-wing ground run at OAT 25 °C, 1008 hPa, 14 ft).
- [CFR] 14 CFR 33.73, Power or thrust response (Amdt. 33-1, 36 FR 5493, Mar. 24, 1971), eCFR version of 2026-10-01. https://www.ecfr.gov/current/title-14/chapter-I/subchapter-C/part-33/subpart-E/section-33.73
- [D0-5] Orchestrator decision D0-5 (docs/reviews/LOG.md on main): the C3 TSFC target is the EEDB-derived takeoff TSFC, marked `estimate`.
- [D2-2] Orchestrator decision D2-2 (docs/reviews/LOG.md on main): the design-point-sized A8 = 0.1852 m² and A18 = 0.9161 m² (w1/cycle, D1-2) replace the definition's placeholder nozzle areas, marked `estimate`.

## Published figures

| ID | Figure | Source value | SI | Source | Confidence |
|---|---|---|---|---|---|
| takeoffThrust | Takeoff thrust, SLS, flat rated (-7B27/3) | 12143 daN | 121430 N | [TCDS] III.6 Ratings | official |
| maxContinuousThrust | Maximum continuous thrust (-7B27/3) | 11521 daN | 115210 N | [TCDS] III.6 Ratings | official |
| takeoffThrustFiche | Takeoff thrust, manufacturer sheet (cross-check of takeoffThrust, +0.005 %) | 27300 lbf | 121436 N | [FICHE] | official |
| flatRatingTemperature | Flat-rating temperature (takeoff thrust held up to it) | 86 °F | 303.15 K | [FICHE] | official |
| bypassRatio | Bypass ratio, SLS takeoff (fiche: 5.10) | 5.1 | 5.1 | [EEDB] 8CM066; [FICHE] | official |
| overallPressureRatio | Overall pressure ratio P3/P2, SLS takeoff | 29.0 | 29 | [EEDB] 8CM066 | official |
| overallPressureRatioAvWeek | Overall pressure ratio at max power (cross-check, -0.3 %) | 28.9 | 28.9 | [AW08] | published |
| overallPressureRatioMaxClimb | Overall pressure ratio at max climb, 35,000 ft, M 0.8, ISA | 32.70 | 32.7 | [FICHE] | official |
| totalAirflow | Total airflow at takeoff (model value; see Contradictions) | 792 lb/s | 359.245 kg/s | [FICHE] | official |
| totalAirflowCfmWeb | Total airflow at takeoff, -7B27 (contradicts totalAirflow by -1.3 %) | 782 lb/s | 354.709 kg/s | [CFMWEB] | official |
| maxClimbThrust | Max climb thrust, 35,000 ft, M 0.8, ISA | 5960 lbf | 26511 N | [FICHE] | official |
| eedbRatedThrust | Rated thrust in the emissions databank | 121.4 kN | 121400 N | [EEDB] 8CM066 | official |
| fuelFlowTakeoff | Fuel flow at the LTO takeoff setting (100 % rated thrust) | 1.293 kg/s | 1.293 kg/s | [EEDB] 8CM066 | official |
| fuelFlowClimbOut | Fuel flow at the LTO climb-out setting (85 %) | 1.031 kg/s | 1.031 kg/s | [EEDB] 8CM066 | official |
| fuelFlowApproach | Fuel flow at the LTO approach setting (30 %) | 0.343 kg/s | 0.343 kg/s | [EEDB] 8CM066 | official |
| fuelFlowIdle | Fuel flow at the LTO idle setting (7 %) | 0.110 kg/s | 0.11 kg/s | [EEDB] 8CM066 | official |
| tsfcTakeoff | TSFC, SLS takeoff: the C3 target | 0.376 (lb/h)/lbf | 1.0648e-5 kg/(N s) | derived: fuelFlowTakeoff / takeoffThrust = 1.293 / 121430 = 1.0648e-5 kg/(N s) = 0.3759 (lb/h)/lbf, per [D0-5] | estimate |
| tsfcTakeoffAvWeek | TSFC at max power (2.7 % above tsfcTakeoff; not the model target) | 0.386 (lb/h)/lbf | 1.0934e-5 kg/(N s) | [AW08] | published |
| coreNozzleArea | Core nozzle throat area A8 = A9 (convergent, choked at SLS takeoff) | sized | 0.1851 m² | derived: the w1/cycle design-point sizing per [D2-2] (0.1852 until the NASA TM-4513 N2 data of w1/cycle-calib moved it by -0.08 %), A8 = W5 / (choked mass flux at P8, T5), thermally perfect gas, ISA SLS takeoff at fuelFlowTakeoff and takeoffThrust; the constant-cp estimate below gives 0.1778 m² (-4.0 %) | estimate |
| bypassNozzleArea | Bypass nozzle exit area A18 = A19 (convergent, unchoked at SLS) | sized | 0.9162 m² | derived: the w1/cycle design-point sizing per [D2-2] (0.9161 before the TM-4513 N2 data, +0.01 %), A18 = W13 / (mass flux at P18, T13, p0), unchoked at SLS takeoff; the constant-cp estimate below gives 0.9067 m² (-1.0 %) | estimate |
| accelStartMaxThrustFraction | 33.73(b) start point when there is no flight-idle stop: at most this fraction of rated takeoff thrust | 15 % | 0.15 | [CFR] 33.73(b) | official |
| fanDiameter | Fan diameter (blade tip) | 61 in | 1.5494 m | [FICHE] | official |
| fanBladeCount | Fan blades (wide chord, Ti-6-4) | 24 | 24 | [NTSB] 1.3.1 | published |
| fanBladeChord | Fan blade chord at its widest point | 11 in | 0.2794 m | [NTSB] 1.3.1 ("about 11 inches") | published |
| fanBladeMass | Fan blade nominal weight | 10.83 lb | 4.9124 kg | [NTSB] 1.3.1 ("about 10.83 pounds") | published |
| fanStages | Fan stages | 1 | 1 | [TCDS] III.2 | official |
| boosterStages | Low-pressure compressor (booster) stages | 3 | 3 | [TCDS] III.2 | official |
| hpcStages | High-pressure compressor stages | 9 | 9 | [TCDS] III.2 | official |
| hptStages | High-pressure turbine stages | 1 | 1 | [TCDS] III.2 | official |
| lptStages | Low-pressure turbine stages | 4 | 4 | [TCDS] III.2 | official |
| engineLength | Overall engine length (model value; see Contradictions) | 2508 mm | 2.508 m | [TCDS] III.4 | official |
| engineLengthFiche | Engine length, manufacturer sheet (contradicts engineLength by +4.8 %) | 103.5 in | 2.6289 m | [FICHE] | official |
| engineWidth | Overall width | 2118 mm | 2.118 m | [TCDS] III.4 | official |
| engineHeight | Overall height | 1829 mm | 1.829 m | [TCDS] III.4 | official |
| dryWeight | Dry weight, "TI" engines | 2386 kg | 2386 kg | [TCDS] III.5 | official |
| envelopeDiameterAvWeek | Maximum envelope diameter | 65 in | 1.651 m | [AW08] | published |
| rotationSense | Rotation sense, "The engine rotates clockwise (aft looking forward)": the angular velocity about +x (downstream) is negative | clockwise, aft looking forward | -1 | [NTSB] 1.3.1 | published |
| n1MaxRpm | Maximum N1 (104 %) | 5382 rpm | 5382 rpm | [TCDS] IV.2 | official |
| n2MaxRpm | Maximum N2 (105 %) | 15183 rpm | 15183 rpm | [TCDS] IV.2 | official |
| n1ReferenceRpm | N1 at 100 % | the 100 % N1 speed | 5175 rpm | derived: 5382 rpm / 1.04 = 5175 rpm ([TCDS] IV.2) | estimate |
| n2ReferenceRpm | N2 at 100 % | the 100 % N2 speed | 14460 rpm | derived: 15183 rpm / 1.05 = 14460 rpm; consistent with 10022 rpm = 69.3 % and 8500 rpm = 58.8 % in [TCDS] IV.2 | estimate |
| egtTakeoffLimit | Max displayed EGT, takeoff (the C6 redline) | 950 °C | 1223.15 K | [TCDS] IV.1.1 | official |
| egtMaxContinuousLimit | Max displayed EGT, maximum continuous | 925 °C | 1198.15 K | [TCDS] IV.1.1 | official |
| egtStartLimit | Max displayed EGT, starting | 725 °C | 998.15 K | [TCDS] IV.1.1 | official |
| egtTransientLimit | Transitory displayed EGT at takeoff | 960 °C | 1233.15 K | [TCDS] VI note 4 | official |
| egtTransientDuration | Duration allowed at egtTransientLimit | 20 s | 20 s | [TCDS] VI note 4 | official |
| egtShuntOffset | Display shunt added to the measured T49.5, "TI" non-/F | +30 °C | 30 K | [TCDS] IV.1.1 | official |
| egtShuntRampStartN2 | N2 where the shunt starts its linear ramp ("TI") | 8300 rpm | 8300 rpm | [TCDS] IV.1.1 | official |
| egtShuntFullN2 | N2 above which the full shunt applies | 8500 rpm | 8500 rpm | [TCDS] IV.1.1 | official |
| egtTrim | EGT "trim" value for -7B27/3 (M 0 to 0.4, above 11200 rpm N2) | +0 °C | 0 K | [TCDS] IV.1.1 trim table | official |
| idleN1Min | Ground idle N1, lower limit (a C4 target) | 20 % | 20 % | [WIDURI] Table 1 (AMM-based) | published |
| idleN1Max | Ground idle N1, upper limit (a C4 target) | 22 % | 22 % | [WIDURI] Table 1 (AMM-based) | published |
| idleN2Min | Ground idle N2, lower limit (a C4 target) | 60 % | 60 % | [WIDURI] Table 1 (AMM-based) | published |
| idleN2Max | Ground idle N2, upper limit (a C4 target) | 62 % | 62 % | [WIDURI] Table 1 (AMM-based) | published |
| idleEgtMax | Ground idle displayed EGT, upper limit (a C4 target) | 500 °C | 773.15 K | [WIDURI] Table 1 (AMM-based, "<500 °C") | published |
| runUpOat | Ambient temperature of the measured ground run | 25 °C | 298.15 K | [WIDURI] Table 3 | published |
| runUpPressure | Barometric pressure of the measured ground run | 1008 hPa | 100800 Pa | [WIDURI] Table 3 | published |
| idleN1Low | Measured ground idle N1, position 1 | 20.5 % | 20.5 % | [WIDURI] Table 7 | published |
| idleN1High | Measured ground idle N1, position 2 | 21.0 % | 21 % | [WIDURI] Table 7 | published |
| idleN2Low | Measured ground idle N2, position 1 | 60.6 % | 60.6 % | [WIDURI] Table 7 | published |
| idleN2High | Measured ground idle N2, position 2 | 60.7 % | 60.7 % | [WIDURI] Table 7 | published |
| idleEgtLow | Measured ground idle EGT, position 1 | 466 °C | 739.15 K | [WIDURI] Table 7 | published |
| idleEgtHigh | Measured ground idle EGT, position 2 | 493 °C | 766.15 K | [WIDURI] Table 7 | published |
| mpaN1 | Maximum Power Assurance run: N1 | 65.0 % | 65 % | [WIDURI] Table 7 | published |
| mpaN2 | Maximum Power Assurance run: N2 | 89.3 % | 89.3 % | [WIDURI] Table 7 | published |
| mpaEgt | Maximum Power Assurance run: EGT | 585 °C | 858.15 K | [WIDURI] Table 7 | published |
| staticTakeoffN1 | Static takeoff run: N1 | 97.4 % | 97.4 % | [WIDURI] Table 7 | published |
| staticTakeoffN2 | Static takeoff run: N2 | 99.8 % | 99.8 % | [WIDURI] Table 7 | published |
| staticTakeoffEgt | Static takeoff run: EGT | 855 °C | 1128.15 K | [WIDURI] Table 7 | published |
| startFuelOnN2 | Start: start lever to idle (fuel and ignition on) at | 25 % | 25 % | [WIDURI] Table 5 | published |
| starterCutoutN2 | Start: starter cut-off at | 56 % | 56 % | [WIDURI] Table 5 | published |
| startPeakEgt | Start: peak EGT | 492 °C | 765.15 K | [WIDURI] Table 5 | published |
| startTime | Start: starting time | 60 s | 60 s | [WIDURI] Table 5 | published |
| bleedBypassMax | Max bypass-duct bleed, above 20 % N1K, fraction of secondary airflow | 2 % | 0.02 | [TCDS] III.10 | official |
| bleedHpc5Max | Max HPC 5th-stage bleed, above 20 % N1K, fraction of primary airflow | 10 % | 0.1 | [TCDS] III.10 | official |
| bleedHpc9MaxLow | Max HPC 9th-stage bleed, 20 to 61 % N1K (linear to bleedHpc9MaxHigh at 82.5 % N1K) | 12 % | 0.12 | [TCDS] III.10 | official |
| bleedHpc9MaxHigh | Max HPC 9th-stage bleed, above 82.5 % N1K | 7 % | 0.07 | [TCDS] III.10 | official |
| bleedCombinedMaxLow | Max HPC 5th + 9th combined, 20 to 61 % N1K (linear to bleedCombinedMaxHigh at 82.5 % N1K) | 13 % | 0.13 | [TCDS] III.10 | official |
| bleedCombinedMaxHigh | Max HPC 5th + 9th combined, above 82.5 % N1K | 10 % | 0.1 | [TCDS] III.10 | official |

## Unknown figures: what the model assumes

No public source gives these. The SI column is the **model assumption**, not a fact; the Source column says why it was chosen.

| ID | Figure | Source value | SI (model assumption) | Source | Confidence |
|---|---|---|---|---|---|
| fanBypassPressureRatio | Fan pressure ratio, bypass (outer) stream, SLS takeoff | unknown | 1.55 | none; closes the design-point estimate below at +2.0 % thrust (1.60 gives +3.4 %, outside C1's 3 %) | unknown |
| fanCorePressureRatio | Fan pressure ratio, core (root) stream | unknown | 1.5 | none; a fan root does less work than the tip | unknown |
| boosterPressureRatio | Booster (3-stage LPC) pressure ratio | unknown | 1.75 | none; typical 3-stage booster loading. The HPC pressure ratio follows as 29 / (1.5 x 1.75) = 11.048 | unknown |
| etaFanBypass | Fan isentropic efficiency, bypass stream | unknown | 0.9 | none; typical of a wide-chord fan of this era | unknown |
| etaFanCore | Fan isentropic efficiency, core stream | unknown | 0.89 | none | unknown |
| etaBooster | Booster isentropic efficiency | unknown | 0.89 | none | unknown |
| etaHpc | HPC isentropic efficiency | unknown | 0.87 | none | unknown |
| etaHpt | HPT isentropic efficiency | unknown | 0.9 | none | unknown |
| etaLpt | LPT isentropic efficiency | unknown | 0.91 | none | unknown |
| combustionEfficiency | Combustion efficiency | unknown | 0.995 | none; near-complete combustion at takeoff | unknown |
| combustorPressureLoss | Combustor total-pressure loss, fraction of P3 | unknown | 0.05 | none | unknown |
| turbineCoolingFraction | Core air that bypasses the combustor to cool the turbines | unknown | 0.12 | none | unknown |
| fuelLhv | Jet-A lower heating value | unknown | 4.32e7 J/kg | none; the plan's value, inside the usual 42.8-43.5 MJ/kg band | unknown |
| t4Takeoff | Combustor exit temperature T4, SLS takeoff | unknown | 1746 K | none; result of the design-point estimate below (energy balance on fuelFlowTakeoff) | unknown |
| fanHubRadius | Fan hub (spinner base) radius at the fan face; hub/tip 0.296 | unknown | 0.229 m | none; a hub/tip ratio about 0.3 is typical of CFM56-class fans | unknown |
| fanTipClearance | Fan tip clearance to the casing | unknown | 0.002 m | none | unknown |
| inletHighlightRadius | Intake highlight radius (axisymmetric; the real 737NG intake has a flattened lower lip) | unknown | 0.8 m | none; highlight area 1.07 x the fan tip area | unknown |
| nacelleMaxDiameter | Nacelle maximum outer diameter | unknown | 2.12 m | none; just encloses the TCDS width of 2.118 m in an axisymmetric nacelle | unknown |
| fanCaseFlangeX | x of the fan-case forward flange, where engineLength starts | unknown | -0.09 m | none; puts the turbine rear frame aft flange at -0.09 + 2.508 = 2.418 m, just behind the LPT | unknown |
| minFuelOnN2 | Lowest N2 at which the FADEC admits fuel during a start | unknown | 20 % | none; the plan's 20-25 % window, below startFuelOnN2 | unknown |
| lightOffDelay | Light-off delay after fuel and ignition on | unknown | 3 s | none; middle of a 2-4 s window | unknown |
| vsvRowCount | Variable stator rows (HPC IGV + S1 to S3) | unknown | 4 | secondary only: CFM56-7B training material (not verified) | unknown |
| vsvMaxClosure | VSV closure from the open setting at low corrected N2 | unknown | 0.7 rad | none; about 40 deg | unknown |
| vsvClosedBelowN2c | Corrected N2 below which the VSVs are fully closed | unknown | 60 % | none | unknown |
| vsvOpenAboveN2c | Corrected N2 above which the VSVs are fully open | unknown | 95 % | none | unknown |
| vbvMaxFraction | Booster variable bleed valve (VBV) maximum dump, fraction of booster flow | unknown | 0.25 | none; the VBV itself is known from secondary sources only | unknown |
| tbvMaxFraction | Transient bleed valve (TBV, HPC 9th stage to the LPT) maximum, fraction of core flow | unknown | 0.05 | none; the TBV itself is known from secondary sources only | unknown |
| vbvOpenBelowN2c | Corrected N2 below which the VBVs are fully open (vbvMaxFraction dumped) | unknown | 70 % | none; with vbvClosedAboveN2c, the linear schedule the W1 model already displays, now fed to the gas path (W1C-I1) | unknown |
| vbvClosedAboveN2c | Corrected N2 above which the VBVs are closed | unknown | 85 % | none; open at ground idle, closed well before takeoff, as the VBV's booster-stall role needs | unknown |
| groundRunCustomerBleed | Customer (pack) bleed during the measured ground run, fraction of HPC inlet flow | unknown | 0 | none; [WIDURI] does not state the bleed configuration. 0 assumes the AMM power-assurance practice of packs off (not verified for this run) | unknown |
| groundRunAccessoryLoad | Aircraft accessory load on the HP gearbox during the measured ground run (IDG electrical load, engine-driven hydraulic pump pressurised) | unknown | 40000 W | none; an on-wing run carries the aircraft's electrical and hydraulic loads, which a test bed (EEDB) does not. The engine's own bearings, seals, windage and fuel/lube pumps are the speed-dependent mechanical loss, not this | unknown |

Not known and not needed as a model input (the model reports them; nothing checks them):
- **Cruise TSFC.** No primary source for the -7B27/3. The cycle model reports its own value; no threshold uses it.
- **Flight-idle N1.** No published figure. C5 uses the 33.73(b) alternative instead (decision D2-1): with no flight-idle stop, the 5 s clock starts from a stabilized point at not more than `accelStartMaxThrustFraction` (15 %) of rated takeoff thrust. The test holds the lever at 14.9 % (0.1 point under the ceiling, so a settling residual cannot put it above) until N1 is steady, then moves it to maximum in 1 s. Ground idle (1.0 % of rated thrust) would also qualify but is a harsher start than 33.73(b) requires.
- **N1 at rated takeoff, ISA SLS.** Not published; the measured static takeoff run (`staticTakeoffN1`, OAT 25 °C) is the nearest point.
- **Blade counts other than the fan, VBV/TBV valve counts, the VSV schedule shape.** Not published; definition.ts picks counts from a target solidity and the schedule from the rows above.

## Contradictions and choices

- **Total airflow:** [FICHE] 792 lb/s for -7B27/3 vs [CFMWEB] 782 lb/s for -7B27. The model uses 792 lb/s: the fiche names the /3 (Tech Insertion) variant and is the newer document.
- **Engine length:** [TCDS] 2508 mm vs [FICHE] 103.5 in (2629 mm). The model uses the TCDS value: it is the certified figure, and [CFMWEB] gives 98.7 in (2507 mm), which agrees with it.
- **TSFC:** the derived EEDB value 0.376 (lb/h)/lbf vs [AW08] 0.386 (lb/h)/lbf. Per [D0-5] the C3 target is the derived value; AW is recorded, 2.7 % higher.
- **-7B27 (SAC) vs -7B27/3 (TI):** [EEDB] 3CM034 gives BPR 5.0, OPR 28.63 and a takeoff fuel flow of 1.284 kg/s for the earlier -7B27; the model uses the /3 row (8CM066).
- **Ground-run fuel flows:** [WIDURI] Tables 1, 5 and 7 print fuel flows with exponents that make no physical sense (e.g. 1.18 x 10^-3 kg/s at takeoff). They are not used; the EEDB fuel flows are.

## 14 CFR 33.73 (verbatim, [CFR])

> § 33.73 Power or thrust response.
> The design and construction of the engine must enable an increase—
> (a) From minimum to rated takeoff power or thrust with the maximum bleed air and power extraction to be permitted in an aircraft, without overtemperature, surge, stall, or other detrimental factors occurring to the engine whenever the power control lever is moved from the minimum to the maximum position in not more than 1 second, except that the Administrator may allow additional time increments for different regimes of control operation requiring control scheduling; and
> (b) From the fixed minimum flight idle power lever position when provided, or if not provided, from not more than 15 percent of the rated takeoff power or thrust available to 95 percent rated takeoff power or thrust in not over 5 seconds. The 5-second power or thrust response must occur from a stabilized static condition using only the bleed air and accessories loads necessary to run the engine. This takeoff rating is specified by the applicant and need not include thrust augmentation.
> [Amdt. 33-1, 36 FR 5493, Mar. 24, 1971]

PHYSICS.md C5 (≤ 5.0 s to 95 % takeoff thrust) is 33.73(b), timed from the stabilized 15 % start point above (D2-1). The lever movement in at most 1 second from 33.73(a) is the input the C5 test applies, and 33.73(a)'s "without overtemperature, surge, stall" is checked along the way: no surge flag, and displayed EGT below the 960 °C transitory limit (egtTransientLimit).

## Design-point estimate (derivation of the assumed values)

`src/engine/designPoint.ts` reproduces this and `tests/unit/engine/designPoint.test.ts` checks it. SLS ISA static (101325 Pa, 288.15 K), total airflow 359.245 kg/s, BPR 5.1 (bypass 300.353 kg/s, core 58.893 kg/s), OPR 29, fuel flow 1.293 kg/s, and the pressure ratios and efficiencies above. Constant-cp, calorically perfect sections with R = 287.053 J/(kg K): cold γ 1.4, so cp = γR/(γ-1) = 1004.7 J/(kg K); hot cp 1150 J/(kg K), so γ = cp/(cp-R) = 1.3326. Losses: bypass duct 1.5 % of Pt, core nozzle 1 %, combustor 5 %; mechanical efficiency 0.99; 100 % ram recovery (TCDS note 2); the cooling air mixes in at the HPT rotor inlet.

| Quantity | Value |
|---|---|
| T13 / T21 / T24 / T3 | 330.9 / 327.9 / 391.8 / 836.0 K |
| FAR in the combustor | 0.0250 |
| T4 / T41 (cooling mixed) | 1746 / 1627 K |
| T45 / T49.5 / T5 | 1243 / 1174 / 965 K |
| HP / LP shaft work | 26.3 / 19.0 MW |
| P5 / p0 (core nozzle pressure ratio) | 2.64, choked |
| A8 / A18 | 0.1778 / 0.9067 m² (this constant-cp estimate; the definition carries the w1/cycle sizing 0.1851 / 0.9162 m², [D2-2]) |
| Net thrust | 123.9 kN, +2.0 % of takeoffThrust |
| TSFC | 1.043e-5 kg/(N s), -2.0 % from tsfcTakeoff |

T49.5 (after LPT stage 1, equal stage work) comes out at 1174 K = 901 °C, i.e. 931 °C displayed with the 30 K shunt: under the 950 °C redline but hotter than the 855 °C measured on a 25 °C day ([WIDURI]). The W1 cycle calibration (efficiencies, cooling) is expected to bring it down. Since [D2-2] this estimate fixes only the blade velocity triangles: the nozzle areas come from the w1/cycle sizing (thermally perfect gas), 4.0 % (A8) and 1.0 % (A18) above the constant-cp values here.

## Representative flowpath (proportions and why)

`src/engine/definition.ts` builds the meridional flowpath in metres, x = 0 at the fan face (station 2), positive downstream. Published anchors: the fan tip radius 0.7747 m (fanDiameter), 24 fan blades with a tip chord near 0.279 m, the stage counts, the engine length of 2.508 m (placed from the fan-case flange at x = -0.09 m to the turbine rear frame flange at x = 2.418 m), and the TCDS width (the nacelle encloses it). Everything else is a proportion chosen so the design-point estimate sees plausible axial Mach numbers; tests/unit/engine/definition.test.ts checks those Mach numbers and the nozzle areas.

| Region | x range (m) | Hub / casing radius (m) | Why |
|---|---|---|---|
| Intake | -0.775 to 0 | highlight 0.800, throat 0.735, fan casing 0.7767 | throat Mach about 0.65 at takeoff; highlight area 1.07 x the fan tip area |
| Spinner | -0.42 to 0 | 0 to 0.229 | conical nose; hub/tip 0.296 at the fan face, fan-face Mach about 0.6 |
| Fan | 0 to 0.26 | hub rises 0.229 to 0.316 | the hub climbs to the booster radius, as in CFM56-class fans |
| Bypass duct | 0.26 to 1.55 | core cowl 0.430 to 0.535, nacelle 0.777 to 0.757 | Mach about 0.5 behind the OGVs, accelerating to the nozzle; A18 = 0.9162 m² (core cowl r = 0.5305 at the fan nozzle exit) |
| Booster | 0.26 to 0.64 | 0.316 to 0.345 / 0.430 to 0.410 | entry Mach about 0.5; 7 rows (IGV + 3 stages) |
| Transition duct | 0.64 to 0.86 | gooseneck down to 0.222 / 0.316 | brings the core flow down to the HPC radius |
| HPC | 0.86 to 1.46 | 0.222 to 0.262 / 0.316 to 0.281 | entry Mach about 0.45, exit about 0.3 (19 mm blades at the exit); 19 rows |
| Combustor | 1.46 to 1.74 | about 0.26 / up to 0.365 | low-Mach dump and liner annulus; NGV inlet Mach about 0.15 |
| HPT | 1.74 to 1.88 | 0.298 / 0.342 to 0.348 | NGV + rotor |
| Inter-turbine duct | 1.88 to 1.97 | rises to 0.330 / 0.388 | the LPT sits at a larger radius than the HPT |
| LPT | 1.97 to 2.37 | 0.330 to 0.335 / 0.388 to 0.452 | 8 rows; exit Mach about 0.4 |
| Exhaust and plug | 2.37 to 3.40 | plug 0.335 to 0 / casing 0.452 to 0.390 | core nozzle lip at x = 2.75, A8 = 0.1851 m² (plug r = 0.3053 at the lip) |
| Nacelle | -0.775 to 1.55 | outer radius up to 1.06 | nacelleMaxDiameter |

## Model vs published (updated every wave)

Model: the W1 cycle model (`src/cycle`, w1/cycle-calib), ISA SLS static unless stated. Tests: tests/unit/cycle/engine.test.ts, c10.test.ts, offdesign.test.ts, surge.test.ts, model.test.ts and modelPaths.test.ts.

| Figure | Published | Model | Delta | Threshold (PHYSICS.md) |
|---|---|---|---|---|
| SLS takeoff thrust | 121430 N (takeoffThrust) | 121430 N | 0.0 % (sizing closure) | C1: within 3 % |
| SLS takeoff BPR | 5.1 (bypassRatio) | 5.100 | 0.0 % | C2: within 3 % |
| SLS takeoff OPR | 29 (overallPressureRatio) | 29.00 | 0.0 % | C2: within 3 % |
| SLS takeoff total airflow | 359.245 kg/s (totalAirflow) | 359.245 kg/s | 0.0 % | C2: within 3 % |
| SLS takeoff TSFC | 1.0648e-5 kg/(N s) (tsfcTakeoff, estimate) | 1.0648e-5 kg/(N s) | 0.0 % | C3: within 3 % |
| Ground idle N1 | 20-22 % (idleN1Min, idleN1Max) | 20.09 % | inside | C4: inside the range |
| Ground idle N2 | 60-62 % (idleN2Min, idleN2Max) | 61.0 % (FADEC floor) | inside | C4: inside the range |
| Ground idle EGT | below 773.15 K (idleEgtMax) | 687.7 K (414.5 C displayed), at 2.9 % of rated thrust | inside | C4: inside the range |
| 15 % to 95 % rated takeoff thrust, lever to maximum in 1 s (33.73(b), D2-1) | 5.0 s | 2.68 s; peak displayed EGT 953.9 C (limit 960 C), min HPC surge margin 0.096, no surge | 2.32 s margin | C5: ≤ 5.0 s |
| Ground idle (2.9 % thrust) to rated takeoff, lever to maximum in 1 s (33.73(a)) | no overtemperature (displayed EGT below 960 C, egtTransientLimit) or surge | peak 958.2 C, min HPC surge margin 0.034, no surge; 95 % thrust at 5.84 s (no time limit applies) | 1.8 K under | 33.73(a) check in model.test.ts (not a PHYSICS.md threshold) |
| Takeoff EGT (displayed), 30 C corner (D1-1) | below 1223.15 K (egtTakeoffLimit) | 1193.5 K (920.3 C), N1 103.50 % | 29.7 K margin | C6: below the redline |
| Static takeoff run, OAT 25 C, N1 97.4 % | 855 C EGT, N2 99.8 % (staticTakeoffEgt, staticTakeoffN2) | 856.0 C, N2 99.88 % | +1.0 K, +0.08 pt | C10: ±30 K, ±1.5 points (pass; the calibration point, W0C-I6) |
| Ground-run idle, position 1, OAT 25 C, N1 20.5 % | 466-493 C, N2 60.6 % (idleEgtLow/High, idleN2Low) | 466.1 C, N2 61.53 % | inside, +0.93 pt | C10: 436-523 C, ±1.5 points (pass) |
| Ground-run idle, position 2, OAT 25 C, N1 21.0 % | 466-493 C, N2 60.7 % (idleEgtLow/High, idleN2High) | 461.4 C, N2 62.23 % | inside, +1.53 pt | C10: N2 fails by 0.03 pt (KNOWN FAIL, W1C-I1) |
| MPA run, OAT 25 C, N1 65.0 % | 585 C, N2 89.3 % (mpaEgt, mpaN2) | 536.4 C, N2 86.71 % | -48.6 K, -2.59 pt | C10: fails both (KNOWN FAIL, W1C-I1) |
| Fuel flow at 85 / 30 / 7 % of rated thrust (EEDB LTO points, test bed) | 1.031 / 0.343 / 0.110 kg/s (fuelFlowClimbOut, fuelFlowApproach, fuelFlowIdle) | 1.006 / 0.300 / 0.0985 kg/s | -2.5 / -12.4 / -10.5 % | none (validation; -3.0 / -15.0 / -16.5 % before W1C-I1) |
| OPR at max climb thrust, 35,000 ft, M 0.8, ISA | 32.7 (overallPressureRatioMaxClimb), at 26511 N (maxClimbThrust) | 32.63 | -0.2 % | none (validation, offdesign.test.ts, 1 %) |

## Cycle model calibration (W1)

The W1 model is thermally perfect (src/thermo) and map-based (pyCycle maps, NOTICE). It takes every W0 assumption above unchanged at the design point (pressure ratios, efficiencies, losses, cooling, LHV) except the two calibrated rows below; off design it adds the part-power physics at the end of this section. Its own sized outputs replace the W0 estimate's derived values for the cycle; since D2-2 the definition's flowpath carries the sized nozzle areas too (coreNozzleArea, bypassNozzleArea).

Sized at ISA SLS takeoff (D1-2): the fan bypass pressure ratio is solved so that net thrust equals takeoffThrust at fuelFlowTakeoff, so C1 and C3 close exactly and BPR, OPR and airflow are inputs.

| Quantity | W0 estimate | W1 cycle | How |
|---|---|---|---|
| Fan bypass pressure ratio | 1.55 (assumed) | 1.537 | sizing output: thrust closure at the EEDB fuel flow |
| Core nozzle area A8 | 0.1778 m² | 0.1851 m² (+4.1 %), `estimate` | sizing output: A8 = W5 / (choked flux at P8, T5), thermally perfect, at ISA SLS takeoff with fuelFlowTakeoff |
| Bypass nozzle area A18 | 0.9067 m² | 0.9162 m² (+1.0 %), `estimate` | sizing output: A18 = W13 / (flux at P18, T13, p0), unchoked at SLS |
| T3 / T4 / T41 / T45 | 836 / 1746 / 1627 / 1243 K | 810.6 / 1641 / 1551 / 1200.6 K | thermally perfect cp(T, FAR) instead of cold 1004.7 and hot 1150 J/(kg K) |
| T49.5 at ISA takeoff, displayed EGT | 1174 K, 931 C | 1112 K, 866.5 C | thermally perfect gas plus the two calibrations below |

Decision D2-2: the sized A8 and A18 replace the definition's placeholders (coreNozzleArea and bypassNozzleArea above set the plug radius at the core nozzle lip and the core cowl radius at the fan nozzle in definition.ts), so the cycle, the flowpath, the mesh and the 3D geometry share one pair of areas. tests/unit/cycle/engine.test.ts (W1C-I3) fails if the sizing moves more than the facts' four-digit rounding (5e-4 relative) from them, or if the definition's station 8 and 18 annuli differ from the facts; the fix is to redo D2-2 (the facts, then `npm run mesh`).

Calibrated parameters (W0C-I6), each a model assumption with no public value, both `estimate` (calibrated):

| Parameter | W0 | W1 | Confidence | Plausible range and why |
|---|---|---|---|---|
| N1 at ISA SLS rated takeoff | 100 % (5175 rpm) | 101 % (5227 rpm) | estimate (calibrated) | not published. With 100 % the model's N2 at the measured run (N1 97.4 %, 25 C) is 100.3 % against 99.8 % measured; 101 % gives 99.9 %. Above about 101.5 % the 30 C corner would exceed the 104 % TCDS N1 limit. |
| Share of LPT work upstream of the EGT probe (station 49.5) | 0.25 (equal work over 4 stages) | 0.35 | estimate (calibrated; accepted by D2-3) | Station 49.5 is the LPT stage 2 nozzle ([TCDS] IV.1.1), so the probe sees the gas after stage 1 of 4. Stage 1 does more than an equal share of the LPT work: the last stage is usually lightly loaded to keep the exhaust swirl low, so the first stages carry more than 0.25 each (the flowpath's rising mean radius pulls the other way, and no stage split is published). 0.35 is fitted to the measured 855 C ([WIDURI]); per D2-3 it is a stage-work share, not a thermocouple error term. An energy balance pins T45 (1200.6 K at ISA takeoff) from the fuel flow and T25 alone, so efficiencies and cooling flows cannot move the EGT by the 36 K needed without leaving their ranges. |

Part-power physics (W1C-I1, w1/cycle-calib). None of them changes the design point, so the sizing, C1-C3 and the 0.35 probe share are untouched; each is a model assumption (`estimate`) with its reason and range:

| Parameter | Before | Now | Plausible range and why |
|---|---|---|---|
| Mechanical loss off design | (1 - 0.99) of the turbine power at every point | (1 - 0.99) of the design turbine power x (N / N_design)^2 per spool | Bearings, seals, windage, the gearbox and the engine's own pumps lose power as a drag torque that rises with speed (viscous friction ~ N^2, windage ~ N^3, rolling bearings ~ N^1.5), not in proportion to the turbine's power. Exponent 1.5-3; 2 is the middle. At ground idle the HP loss is ~85 kW instead of ~8 kW. |
| Bypass duct, core nozzle and combustor pressure losses | fixed fractions of Pt (1.5 / 1 / 5 %) | the same at design, x (W sqrt(Tt) / Pt / design)^2 off design | Cold friction and dump losses scale with the dynamic head (Walsh & Fletcher 5.10-5.11). With the fixed 1.5 % the bypass duct ate the whole fan pressure rise at idle (fan PR 1.018) and put the fan past its stall line (R-line 0.92); now the fan sits at R-line 1.7 and ground idle makes 2.9 % of rated thrust (was 1.0 %). |
| VBV in the gas path | reported, not fed | vbvMaxFraction of the booster flow below vbvOpenBelowN2c (70 %), closed above vbvClosedAboveN2c (85 %), linear between | The schedule the model already displayed; the dumped air leaves the core at booster exit and enters the bypass stream. |
| Tip-clearance efficiency loss, HPC / HPT | none | 3 / 4 points x (1 - (N2 / N2_design)^2) | Running clearances open as the rotor's centrifugal growth (~ N^2) falls; ~1 % SFC and ~10 C EGT per 0.010 in of extra HPT clearance (Lattime & Steinetz, NASA/TM-2002-211794). 2-4 points at standstill; the upper half is used because HPC 2 / HPT 3 leaves C4's ISA idle N1 at 19.92 % (0.08 under the minimum) once the duct losses scale with the dynamic head. |
| Ground-run loads for C10 | none | groundRunAccessoryLoad 40 kW, groundRunCustomerBleed 0 (unknown rows above) | An on-wing run carries the aircraft's electrical and hydraulic loads; [WIDURI] does not state the bleed configuration. |

What limits C10 (see docs/handoffs/w1-cycle-calib.md). At the MPA N1 the measured EGT (585 C displayed, T49.5 = 828 K) is above the model's own T45 (826 K), so no probe position can reach it: the model's core is about 50-80 K too cold at 65 % N1 and its N2 2.6 points low. That needs roughly 20 % more heat release per kg of core flow at a given N1, which the physical part-power mechanisms above (and customer bleed, a larger accessory load, the EGT probe's radiation error) do not supply within their ranges: the levers that raise N2 at a fixed N1 are LP-side losses (fan, booster, LPT efficiency 4-7 points below the scaled pyCycle maps at 65 % N1), which no public data supports. The EEDB fuel flows at 30 % and 7 % thrust (12 and 10 % above the model) point the same way: the generic maps make the part-power engine too efficient. Ground idle now matches within the band at position 1 and misses N2 by 0.03 point at position 2; idle sits where every map is extrapolated (fan below its lowest speed line, LPT far below its pressure-ratio range), so the idle match is sensitive to the extrapolation rules.
