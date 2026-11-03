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
- [D3-11] Orchestrator decision D3-11 (docs/reviews/LOG.md on main): C10 at MPA and the EEDB part-power fuel flows are met only through bounded, physically real part-power mechanisms (VBV schedule, HPC VSV schedule, part-speed efficiency trends of the fan, booster and LPT), fitted to both datasets at once; new threshold C11.
- [SDT] C. E. Hughes, R. J. Jeracki, R. P. Woodward, C. J. Miller, "Fan Noise Source Diagnostic Test: Rotor Alone Aerodynamic Performance Results", NASA/TM-2005-211681, 2005, Table 3 (the GE-designed R4 "current technology high bypass fan", 1/5-scale bypass stage, PR 1.51 at takeoff). https://ntrs.nasa.gov/citations/20050175875 (PDF read 2026-10-26)
- [QAR] Yan Tan, "Fitting Operation Curve of Civil Aviation Turbo-fan Engine's Variable Bleed Valve based on MATLAB", J. Phys.: Conf. Ser. 1176 (2019) 052040, doi:10.1088/1742-6596/1176/5/052040: quick-access-recorder data of two CFM56-7B26E on a 737-800 (38 flights). Section 2.1 (the CFM manual's VBV = F(N1K12, N2K25, VSV, TAT, T2.5, TLA, N1ACT, P0)), Table 5 (VBV = 1.214 VSV - 0.065, rad), Fig. 1 (VBV about 0.6 rad on the ground, near 0 in climb and cruise, 0.1-0.4 rad in descent). Read 2026-10-26.
- [VBVPAT] US 9,982,598 B2, "Gas turbine engine variable bleed valve for ice extraction", General Electric, 29 May 2018: the fully open VBV position "is typically done at idle and part power engine operation"; "minimizing the amount of airflow bleed from the booster discharge and thereby minimizing the exhaust gas temperature (EGT)". https://patents.google.com/patent/US9982598B2/en (read 2026-10-26)
- [VGV] A. Tsalavoutas, K. Mathioudakis, A. Stamatis, M. K. Smith, "Identifying Faults in the Variable Geometry System of a Gas Turbine Compressor", ASME GT2000-0033 (NTUA presentation slides): individual-vane and IGV mis-rig faults implanted on a test engine, up to an IGV +6 deg mis-rigging, whose signature is mainly a loss of compressor flow capacity. https://www.ltt.ntua.gr/images/PaperPresentations/GT2000-0033-pre.pdf (read 2026-10-26)
- [AMDC] Turbine-loss Reynolds corrections. J. Dunham, P. M. Came, "Improvements to the Ainley-Mathieson method of turbine performance prediction", ASME J. Eng. Power 92 (1970) 252-256: profile and secondary loss x (Re / 2e5)^-0.2 for Re below 2e5 (the exponent as it is commonly cited; its reproduction in Taylor's Eq. 2-26 below is garbled in the PDF text, which does say the correction is for Re < 2e5). S. C. Kacker, U. Okapuu, "A Mean Line Prediction Method for Axial Flow Turbine Efficiency", ASME J. Eng. Power 104 (1982) 111-119: profile loss x (Re / 2e5)^-0.4 below Re 2e5, x 1 from 2e5 to 1e6, x (Re / 1e6)^-0.2 above (verified in the code listing of A. M. Taylor, "One Dimensional Mean Line Performance Prediction Program for Turbocharger Axial Turbines", PhD thesis, The University of Sheffield, White Rose eTheses 30828, read 2026-10-26).
- [D3-14] Orchestrator decision D3-14 (on w1/cycle-calib-2's stop): add core-side mechanisms (combustion efficiency vs power from the EEDB emission indices, an HPC part-speed falloff, turbine tip-clearance growth), fit the EGT probe share in [0.25, 0.45], adopt a fit only if every other threshold and transient test still passes.
- [ARP1533] SAE ARP1533, "Procedure for the Analysis and Evaluation of Gaseous Emissions from Aircraft Engines": derives emission indices and combustion efficiency from the measured CO, CO2, total hydrocarbon and NOx (https://www.sae.org/standards/content/arp1533c/; not read here; the relation used is the energy balance written out in "Part-power calibration (D3-11)").
- [JANAF] M. W. Chase, NIST-JANAF Thermochemical Tables, 4th ed., J. Phys. Chem. Ref. Data Monograph 9, 1998: heats of formation at 298.15 K of CO2 (-393.52 kJ/mol) and CO (-110.53 kJ/mol).
- [LS02] B. M. Lattime, B. M. Steinetz, "Turbine Engine Clearance Control Systems: Current Practices and Future Directions", NASA/TM-2002-211794 (the W1C-I1 clearance source).
- [D3-17] Orchestrator decision D3-17 (docs/reviews/LOG.md on main): before W3's surge scenarios, a surge-recovery test on the reference model (a slam with reduced HPC margin, FADEC surge detection, fuel reduction and bleed opening, recovery to idle without a hang); pre-registered as C12.
- [GE74] US 3,852,958 A, M. M. Adams, V. R. Duncan, "Stall protector system for a gas turbine engine", General Electric, filed 28 Sep 1973, granted 10 Dec 1974: the rate of decrease of compressor discharge pressure P3 is compared with a reference, and the signal is integrated so that a stall needs a minimum P3 drop, to reject fast decelerations and brief transients; the fuel is then interrupted. https://patents.google.com/patent/US3852958A/en (read 2026-10-26)
- [GE91] US 5,012,637 A, "Method and apparatus for detecting stalls", General Electric, priority 13 Apr 1989, granted 7 May 1991, Background: in a stall "the compressor discharge pressure [decays] rapidly" and the turbine temperature rises; recoverable ("surge") stalls return to normal operation without operator intervention, nonrecoverable ("hung" or "rotating") stalls need the operator to clear them and to keep temperatures from becoming excessive. https://patents.google.com/patent/US5012637A/en (read 2026-10-26)
- [UTC77] US 4,060,979 A, F. L. Elsaesser, J. H. Hall, "Stall warning detector for gas turbine engine", United Technologies, filed 19 Nov 1975, granted 6 Dec 1977: stall detection from a turbine temperature above a reference together with a rotor deceleration beyond a negative rate; the stall signal may de-rich or shut off the fuel, open the compressor bleeds or change the stator vane angles, and drive an automatic recovery that shuts off the fuel, starts the ignition and restores the fuel in a timed sequence. https://patents.google.com/patent/US4060979A/en (read 2026-10-26)
- [UTC93] US 5,269,136 A, "Sub-idle stability enhancement and rotating stall recovery", United Technologies, priority 30 Mar 1992, granted 14 Dec 1993, Abstract: on a rotating stall "fuel flow is decremented but not below a minimum flow"; when the stall ends the fuel flow is restored to the normal level. https://patents.google.com/patent/US5269136A/en (read 2026-10-26)
- [RR06] US 7,065,973 B2, "Stall detection and recovery system", Rolls-Royce, priority 26 Feb 2003, granted 27 Jun 2006: a surge ends in natural recovery, stall ("a quasi-steady state ... characterised by low efficiency and flow capacity", with overheat and large thrust loss) or flameout; surges are detected from combustor pressure; the recovery interrupts the fuel momentarily and relights; a confirmation delay of "most preferably, substantially 0.5 seconds" after the surge signal. https://patents.google.com/patent/US7065973B2/en (read 2026-10-26)
- [ARP1420] SAE ARP1420, "Gas Turbine Engine Inlet Flow Distortion Guidelines": the loss in surge pressure ratio Delta PRS = (PRS_clean - PRS_reduced) / PRS_clean as the measure of the stability margin that distortion uses up (not read here; the definition as it is commonly cited).
- [MAKRIS] K. Makris (licensed aircraft engineer), "Jet Engine Pneumatic Starter", https://www.k-makris.gr/?p=1574 (read 2026-11-03): "The spin speed of the turbine rotor reaches 40,000 to 50,000 rpm"; a reduction gear set follows; the starter is disconnected once the engine runs faster than it can drive. Generic, not CFM56-7B data.
- [HON19] Honeywell Aerospace, "Engine insights", 17 April 2019, https://www.honeywellaerospace.com/us/en/insights/articles/engine-insights (read 2026-11-03): "the ignition unit (exciter) normally produces a spark rate of 2 sparks per second" (a burst of 4 per second in the first 15-20 s of some units). Generic (the article's engine is the TFE731), not CFM56-7B data.

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
| eiCoTakeoff | CO emission index at the LTO takeoff setting (100 %) | 0.31 g/kg | 0.00031 kg/kg | [EEDB] 8CM066, "CO EI T/O (g/kg)" (test engine status NME, newly manufactured) | official |
| eiCoClimbOut | CO emission index at the LTO climb-out setting (85 %) | 0.17 g/kg | 0.00017 kg/kg | [EEDB] 8CM066, "CO EI C/O (g/kg)" (test engine status NME, newly manufactured) | official |
| eiCoApproach | CO emission index at the LTO approach setting (30 %) | 2.82 g/kg | 0.00282 kg/kg | [EEDB] 8CM066, "CO EI App (g/kg)" (test engine status NME, newly manufactured) | official |
| eiCoIdle | CO emission index at the LTO idle setting (7 %) | 29.39 g/kg | 0.02939 kg/kg | [EEDB] 8CM066, "CO EI Idle (g/kg)" (test engine status NME, newly manufactured) | official |
| eiHcTakeoff | HC emission index at the LTO takeoff setting (100 %) | 0.03 g/kg | 0.00003 kg/kg | [EEDB] 8CM066, "HC EI T/O (g/kg)" (test engine status NME, newly manufactured) | official |
| eiHcClimbOut | HC emission index at the LTO climb-out setting (85 %) | 0.02 g/kg | 0.00002 kg/kg | [EEDB] 8CM066, "HC EI C/O (g/kg)" (test engine status NME, newly manufactured) | official |
| eiHcApproach | HC emission index at the LTO approach setting (30 %) | 0.05 g/kg | 0.00005 kg/kg | [EEDB] 8CM066, "HC EI App (g/kg)" (test engine status NME, newly manufactured) | official |
| eiHcIdle | HC emission index at the LTO idle setting (7 %) | 1.54 g/kg | 0.00154 kg/kg | [EEDB] 8CM066, "HC EI Idle (g/kg)" (test engine status NME, newly manufactured) | official |
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
| vbvMaxFraction | Booster variable bleed valve (VBV) maximum dump, fraction of booster flow | unknown | 0.25 | none; the VBV itself is known from secondary sources only ([QAR], [VBVPAT] give its behaviour, not its flow). The D3-14 fit, rejected (D3-15), puts it at 0.284 inside 0.10-0.30 ("Part-power calibration (D3-11, D3-14)") | unknown |
| tbvMaxFraction | Transient bleed valve (TBV, HPC 9th stage to the LPT) maximum, fraction of core flow | unknown | 0.05 | none; the TBV itself is known from secondary sources only | unknown |
| vbvOpenBelowN2c | Corrected N2 below which the VBVs are fully open (vbvMaxFraction dumped) | unknown | 70 % | none; with vbvClosedAboveN2c, the linear schedule the W1 model already displays, now fed to the gas path (W1C-I1) | unknown |
| vbvClosedAboveN2c | Corrected N2 above which the VBVs are closed | unknown | 85 % | none; open at ground idle, closed well before takeoff, as the VBV's booster-stall role needs. [QAR] shows it closed in climb and cruise and partly open in descent; the D3-14 fit, rejected (D3-15), puts it at 95 % (with fully open below 75 %) | unknown |
| groundRunCustomerBleed | Customer (pack) bleed during the measured ground run, fraction of HPC inlet flow | unknown | 0 | none; [WIDURI] does not state the bleed configuration. 0 assumes the AMM power-assurance practice of packs off (not verified for this run) | unknown |
| groundRunAccessoryLoad | Aircraft accessory load on the HP gearbox during the measured ground run (IDG electrical load, engine-driven hydraulic pump pressurised) | unknown | 40000 W | none; an on-wing run carries the aircraft's electrical and hydraulic loads, which a test bed (EEDB) does not. The engine's own bearings, seals, windage and fuel/lube pumps are the speed-dependent mechanical loss, not this | unknown |
| starterSpeedRatio | Air turbine starter's turbine speed per N2 rpm (the starter's reduction gear and the gearbox drive to the HP spool); sets the engine sound's starter whine (A5) | unknown | 5.557 | none for the CFM56-7B (searched 2026-11-03: patents give generic planetary reductions of 5:1 to 30:1). Estimate: the starter's turbine at 45,000 rpm, the middle of the 40,000-50,000 rpm [MAKRIS] gives, at the starter cut-out (starterCutoutN2 56 % of n2ReferenceRpm = 8098 rpm): 45000 / 8098 = 5.557 | unknown |
| igniterSparkRate | Igniter spark rate (the engine sound's igniter clicks, A5) | unknown | 2 Hz | none for the CFM56-7B (searched 2026-11-03). A generic exciter "normally produces a spark rate of 2 sparks per second" [HON19]; its 4 per second start burst is not modelled | unknown |

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

### Exhaust plug against public data (D3-9, w1/lookdev-3, 2026-10-26)

The definition's plug (`src/engine/definition.ts`, curve `plug`): base radius 0.3052 m at the core-nozzle lip (x = 2.75 m, set by A8 = 0.1852 m² inside the lip radius 0.39 m), a protrusion of 0.65 m beyond the lip (tip at x = 3.40 m, 0.98 m aft of the turbine-rear-frame flange), so 0.83 core-lip diameters; the mean half-angle from the lip to the tip is 25°, steepening from 12° near the lip to 45° at the tip (an ogive).

| Plug figure | Published | Model | Source / status |
|---|---|---|---|
| Plug length (protrusion beyond the core-nozzle lip) | unknown | 0.65 m | none found |
| Plug base diameter | unknown | 0.610 m (from A8) | none found; the model's value follows from A8 and the lip radius, both `estimate` |
| Plug cone angle | unknown | 25° mean half-angle | none found |
| Engine envelope that contains the plug | 2.508 m flange to flange (TCDS); the plug and the core nozzle hang aft of the TRF flange | plug tip 0.98 m aft of the TRF flange | [TCDS] |

Searched on 2026-10-26: CFM56-7B plug, centerbody and primary-nozzle dimensions (web search; the [TCDS], [FICHE] and [AW08] tables give the engine envelope only; a 737NG exhaust-plug listing on shop.boeing.com is a protective cover whose size is its packaging, and a parts listing for the primary nozzle P/N 314A2610-62 gives no dimensions). No public figure exists for the plug's length, base diameter or cone angle, so under the facts rule the plug is **not reshaped**: changing one unsourced shape for another would not make it more correct, and A8 (pinned by tests/unit/engine/definition.test.ts) and the mesh are untouched. The orchestrator can reopen this with a source (the engine or airframe maintenance manuals, or a dimensioned public drawing).

## Model vs published (updated every wave)

Model: the W1 cycle model (`src/cycle`, w1/cycle-calib; w1/cycle-calib-2 added the D3-11/D3-14 part-power mechanisms and keeps only the EEDB combustion-efficiency table, which moved only the 7 % fuel flow), ISA SLS static unless stated. Tests: tests/unit/cycle/engine.test.ts, c10.test.ts, c11.test.ts, offdesign.test.ts, surge.test.ts, model.test.ts and modelPaths.test.ts.

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
| Ground-run idle, position 2, OAT 25 C, N1 21.0 % | 466-493 C, N2 60.7 % (idleEgtLow/High, idleN2High) | 461.4 C, N2 62.23 % | inside, +1.53 pt | C10: N2 fails by 0.03 pt (KNOWN FAIL, D3-15) |
| MPA run, OAT 25 C, N1 65.0 % | 585 C, N2 89.3 % (mpaEgt, mpaN2) | 536.4 C, N2 86.71 % | -48.6 K, -2.59 pt | C10: fails both (KNOWN FAIL, D3-15) |
| Fuel flow at 85 / 30 / 7 % of rated thrust (EEDB LTO points, ISA SLS test bed) | 1.031 / 0.343 / 0.110 kg/s (fuelFlowClimbOut, fuelFlowApproach, fuelFlowIdle) | 1.005 / 0.301 / 0.0993 kg/s (with the D3-14 EEDB combustion-efficiency table) | -2.5 / -12.3 / -9.7 % | C11 (D3-11): ±5 %. Climb-out passes; approach and idle FAIL (KNOWN FAIL, D3-15, c11.test.ts). The D3-14 fit, rejected, gives +0.6 / -6.4 / -4.3 % ("Part-power calibration (D3-11, D3-14)"); -3.0 / -15.0 / -16.5 % before W1C-I1 |
| OPR at max climb thrust, 35,000 ft, M 0.8, ISA | 32.7 (overallPressureRatioMaxClimb), at 26511 N (maxClimbThrust) | 32.63 | -0.2 % | none (validation, offdesign.test.ts, 1 %) |

## Surge detection and recovery (D3-17)

No CFM56-7B control logic for surges is public. The web search for it on 2026-10-26 (CFM training manuals, accident reports on 737NG surges, the b737.org.uk CFM56 page, which could not be opened) found only an unverified training-flashcard line. So the model's surge detection and recovery follow the generic, published gas-turbine practice of the patents above. Each constant is a model assumption, not a CFM figure. The pass criteria are PHYSICS.md C12 [D3-17].

| Step | Published practice | Model (src/cycle/surgeDetection.ts, src/cycle/model.ts) |
|---|---|---|
| Detect | A rapid decay of compressor discharge pressure, integrated so that only a sufficient drop counts ([GE74]); P3 decays and turbine temperature rises in a stall ([GE91]); combustor pressure ([RR06]); rotor deceleration with high temperature ([UTC77]) | The sensed P3 (the HPC exit pressure, which the Greitzer state modulates during a surge) feeds a decay detector: while the relative decay rate exceeds a threshold the drop is integrated, and a surge is detected once the integrated drop is large enough. Normal decelerations stay under the rate threshold. The controller never reads the true surge margin. |
| Fuel | De-rich or interrupt the fuel ([GE74], [UTC77], [RR06]), but not below a minimum flow ([UTC93]) | The fuel demand drops to the deceleration schedule (the minimum the control allows while running), so the flame stays lit. |
| Bleed, vanes | Open the compressor bleeds or change the stator angles ([UTC77]) | The VBVs are commanded fully open while recovering, wherever their schedule has them open at all (below vbvClosedAboveN2c). Above that they stay shut: the booster has no stall to guard there, and a quarter of its flow dumped at high power pushes it past its map's choke edge (the D3-14 fit's failure). The VSV schedule is unchanged. |
| Ignition | Start the ignition, relight ([UTC77], [RR06]) | The igniters are on while recovering (unless ignition is selected off). |
| Restore | Restore the fuel in a timed sequence ([UTC77]); normal fuel once the stall has ended ([UTC93]) | The fuel is held on the deceleration schedule for the confirmation time ([RR06]: about 0.5 s), then the acceleration limit ramps back over 1 s to a biased schedule: the steady line plus 0.8 of the acceleration schedule's excess over it. The bias holds until the acceleration is over (another loop takes the fuel). A detection during the hold is the same surge; one after it restarts the sequence and multiplies the bias by 0.8 again. |

Why the bias: the surge line does not move after a surge, so going back to the full schedule surges again at the same speed. With only the hold and the ramp, the C12 slam cycled surge, cut-back and re-surge at 62-63 % N2 for as long as it ran, which is the hang D3-17 asks about. The 0.8 is control tuning, not a source figure: it is the largest round value that keeps the C12 slam to one surge with margin inside C12's 10 s to 95 % thrust.

Result (tests/unit/cycle/surgeRecovery.test.ts, ISA SLS, Delta PRS 6 %):
- One surge at 0.74 s (N2 61.8 %), detected in the same 20 ms step. Fuel flow 0.138 to 0.039 kg/s, igniters on, VBVs open (already open by schedule at that speed).
- 95 % rated thrust at 8.4 s, surge-free to the end of the 30 s. At minimum lever the engine is back at N1 20.26 %, N2 60.99 %.
- Delta PRS 2 % does not surge (95 % at 5.8 s, as the clean engine). 4 % gives one surge (8.4 s), 8 % two (11.6 s), 10 % three (15.5 s), 12 % four (20.2 s). Every case recovers and returns to idle.
- Injected surges at 15, 45 and -20 C ambient, levers 0.15-1 (a scratch sweep, not a test): each is detected once and the episode ends; 10 s later the thrust is within 10 % of its pre-surge value. The test pins the takeoff case.
- The W1 control instead cut 25 % of the fuel at every model surge onset, reading the true margin, and ramped straight back. In the C12 slam it surged 13 times.


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

What limited C10 after W1C-I1 (see docs/handoffs/w1-cycle-calib.md; D3-11 then authorised the part-power mechanisms of the next section, which do not close it either). At the MPA N1 the measured EGT (585 C displayed, T49.5 = 828 K) is above the model's own T45 (826 K), so no probe position can reach it: the model's core is about 50-80 K too cold at 65 % N1 and its N2 2.6 points low. That needs roughly 20 % more heat release per kg of core flow at a given N1, which the physical part-power mechanisms above (and customer bleed, a larger accessory load, the EGT probe's radiation error) do not supply within their ranges: the levers that raise N2 at a fixed N1 are LP-side losses (fan, booster, LPT efficiency 4-7 points below the scaled pyCycle maps at 65 % N1), which no public data supports. The EEDB fuel flows at 30 % and 7 % thrust (12 and 10 % above the model) point the same way: the generic maps make the part-power engine too efficient. Ground idle now matches within the band at position 1 and misses N2 by 0.03 point at position 2; idle sits where every map is extrapolated (fan below its lowest speed line, LPT far below its pressure-ratio range), so the idle match is sensitive to the extrapolation rules.

## Part-power calibration (D3-11, D3-14)

Decisions [D3-11] and [D3-14]: C10 at MPA and the EEDB part-power fuel flows (the pre-registered C11) may be met only through physically real part-power mechanisms, each bounded to a plausible range with a stated reason and fitted to both datasets at once. A fit becomes the reference calibration only if every other threshold and transient test still passes.

w1/cycle-calib-2 did the following:
- It implemented the mechanisms in `src/cycle/engine.ts`, each zero at the design point, so the sizing and C1-C3 do not depend on them.
- It set their bounds before fitting (`src/cycle/partPower.ts`, `PART_POWER_PARAMETERS`).
- It fitted them with `tools/cycle/fit-part-power.ts`, which writes `src/cycle/partPowerFit.ts`. `tests/unit/cycle/partPower.test.ts` checks that the written values are the bounded optimum and pins its outcome.

**Inside the bounds the fit meets C10 and C4 but not C11 at approach. It is not adopted: the transient model fails with it (below).** The reference calibration (CYCLE_CALIBRATION) carries only the EEDB combustion-efficiency table, which is data rather than a fit. The fitted calibration is PART_POWER_FIT_CALIBRATION, recorded as rejected.

### Mechanisms, bounds and reasons

| Parameter | Bound | Fitted | Why this range (source) |
|---|---|---|---|
| Combustion efficiency vs corrected fuel flow (D3-14, data) | not fitted | idle -0.83 %, approach -0.06 %, climb-out and takeoff ~0, relative to takeoff | [EEDB] 8CM066 emission indices (rows eiCoTakeoff ... eiHcIdle). The inefficiency is the chemical energy left as CO and unburnt hydrocarbons over the fuel's: 1 - (EI_CO Q_CO + EI_HC Q_fuel) / (1000 Q_fuel), EI in g/kg, the energy balance behind [ARP1533]'s combustion efficiency. Q_CO = (393.52 - 110.53) kJ/mol / 28.01 g/mol = 10.10 MJ/kg [JANAF]; the hydrocarbons are taken at the fuel's heating value. The knots are the databank fuel flows (ISA SLS, so corrected = actual), held beyond them; the design point keeps its 0.995. |
| Fan part-speed efficiency loss, both streams: full at or below 87.5 % corrected speed, linear to 0 at 100 % (a fraction of the design efficiency, so the map efficiency is scaled, never negative) | 3.2-4.2 points | 4.2 (upper bound) | [SDT] Table 3: the R4 fan's operating-line efficiency falls from 100 % to 87.5 % speed by 1.16 (fan/OGV) or 0.82 (rotor alone) points, and to 61.7 % by 2.56 or 1.83 points. On the model's own ISA SLS operating line, the scaled pyCycle fan map instead rises 3.1 points at 87.5 % and 1.4 at 61.7 %. Matching the SDT shape takes 3.2-4.2 points; below 61.7 % there are no data, so the loss is held. `published` / `estimate` |
| Booster part-speed loss, the same form on its own corrected speed | 0-4.2 points | 4.2 (upper bound) | No booster data; capped at the fan's measured falloff (same LP shaft). `estimate` |
| LPT Reynolds lapse exponent n: (1 - eta) x (Re / Re_design)^-n at the design efficiency's level, Re ~ P / (sqrt(T) mu), Sutherland | 0-0.2 | 0.2 (upper bound) | [AMDC]: Dunham-Came (Re / 2e5)^-0.2; Kacker-Okapuu applies none between 2e5 and 1e6. This LPT's Re is about 5.5e5 at its inlet and 2.6e5 at its exit at takeoff (estimate, from definition.ts chords). `estimate` |
| HPC Reynolds lapse exponent (D3-14 HPC part-speed falloff), the same form on the HPC inlet (P25, T25) | 0-0.2 | 0.2 (upper bound) | No compressor correlation was verified this round, so the turbine bound [AMDC] is reused as the upper end and 0 as the lower. `estimate` |
| HPT tip-clearance loss (D3-14), points at standstill x (1 - (N2 / N2_design)^2) | 2-4 points | 4 (upper bound) | The W1C-I1 range: [LS02], about 1 % SFC and 10 C EGT per 0.010 in of HPT clearance, with the running clearance opening as the rotor's centrifugal growth falls. `estimate` |
| EGT probe share of the LPT work (D3-14, fitted) | 0.25-0.45 | 0.385 | Station 49.5 sits after LPT stage 1 of 4 ([TCDS] IV.1.1), so at least an equal share; 0.45 is D3-14's upper bound. It replaces the single-point W0C-I6 value 0.35 only if the fit is adopted. |
| VBV maximum dump, fraction of booster flow | 0.10-0.30 | 0.284 (held by the booster-map guard) | Up to the ISA ground-idle booster on the choke edge of its map (R-line 2.92 at 0.30, map edge 3.0); at least enough to move the idle booster off its stall line (R-line 1.60 shut, 1.94 at 0.10). Every fitted booster point is kept at R-line 2.9 or less. `estimate` |
| VBV fully open below / closed above (corrected N2) | 61-75 % / 80-95 % | 75 / 95 (upper bounds) | Fully open at ground idle ([QAR] Fig. 1, [VBVPAT]); closed in climb and cruise and partly open in descent ([QAR]; model cruise N2c 98 %, descent 78-88 %). `estimate` |
| HPC VSV offset from the map's schedule at <= 60 % / 85 % N2c (0 at >= 95 %) | ±6 deg each | -6 deg (lower) / +6 deg (upper) | The map's donor schedule is not this engine's; a difference beyond the 6 deg IGV mis-rig that [VGV] implant as a detectable fault would show as one. Flow effect: 0.688 per rad (1.2 %/deg), from the IGV (38.1 deg) / rotor-1 (57.4 deg) velocity triangle at fixed incidence; the efficiency effect is second order and left out. `estimate` |

### Fit procedure

Bounded least squares (`src/cycle/boundedLeastSquares.ts`): a projected Levenberg-Marquardt method in variables scaled to [0, 1], forward differences with a fixed step, deterministic, started at the middle of every bound.

The residuals are each divided by their threshold's tolerance:
- C11 at 85 / 30 / 7 % (/ 5 %);
- C10 N2 at four points (/ 1.5 points);
- C10 EGT at takeoff and MPA (/ 30 K), and at idle as the distance outside the measured 466-493 C (/ 30 K);
- three guards: C4 N1 inside 20-22 %, C4 EGT under 500 C, and the booster R-line at most 2.9.

Every point is solved by continuation from the design point. Result: 15 iterations, cost 2.06.

### Result: model vs measured

| Point | Measured / databank | Reference model | Bounded fit (rejected) | Threshold |
|---|---|---|---|---|
| C11 climb-out 85 % fuel flow | 1.031 kg/s | 1.005 (-2.5 %) | 1.037 (+0.6 %) | ±5 %: pass |
| C11 approach 30 % | 0.343 kg/s | 0.301 (-12.3 %) | 0.321 (-6.4 %) | ±5 %: FAIL in both |
| C11 idle 7 % | 0.110 kg/s | 0.0993 (-9.7 %) | 0.105 (-4.3 %) | ±5 %: reference FAIL, fit passes |
| C10 takeoff N2 / EGT | 99.8 % / 855 C | 99.88 / 856.0 | 100.32 / 866.6 | pass |
| C10 MPA N2 / EGT | 89.3 % / 585 C | 86.71 / 536.4 | 87.89 / 564.8 | reference FAIL both, fit passes |
| C10 idle pos. 2 N2 / EGT | 60.7 % / 466-493 C | 62.23 / 461.3 | 61.21 / 475.1 | reference N2 FAIL, fit passes |
| C10 idle pos. 1 N2 / EGT | 60.6 % / 466-493 C | 61.53 / 466.0 | 60.47 / 479.6 | pass |
| C4 ISA ground idle N1 / EGT | 20-22 % / < 500 C | 20.09 / 414.4 | 20.75 / 422.0 | pass |

(Reference: CYCLE_CALIBRATION with the EEDB combustion table, which moved the 7 % fuel flow from -10.5 to -9.7 % and nothing else visibly.)

### What binds, and by how much

- Every fitted bound binds except the VBV dump, which the booster-map guard holds, and the probe share.
- One lever at a time past its bound, the others at the fit: C11 approach reaches its -5 % edge only if
  - the fan loss reaches 6.3 points (bound 4.2),
  - or the booster loss 14.3 (4.2),
  - or the LPT exponent 0.47 (0.2),
  - or the HPC exponent 0.45 (0.2),
  - or the HPT clearance loss 8.1 points (4),
  - or the VSV offset at 85 % N2c +15.8 deg (6).

  The VBV schedule cannot reach the edge: fully open above 78.8 % N2c, the booster leaves its map.
- With every binding bound opened by its own width at once, C10 and C11 all pass (approach -4.5 %). That run uses fan 4.4, booster 5.7, LPT 0.21, HPC 0.22, clearance 4.2, VSV -6.2 / +9.1 deg, and a VBV fully open below 81 % and shut only above 99.1 % N2c, against [QAR], which shows it closed in cruise.
- Why the fit is rejected (W1K-I2): the committed fit itself **surges in the 33.73(a) ground-idle slam and then hangs**. `tests/unit/cycle/surgeRecovery.test.ts` pins this in the repo.
  - About 1.5 s into the slam the HPC working line crosses the surge line twice (min margin below zero, the surge flag raised). Both episodes end on their own.
  - At about 4 s, with N2 near 74 % and the VBV still fully open (the fit opens it below 75 % N2c), the matched gas path stops converging under the slam's acceleration fuel. The model then falls back to its sub-idle similarity model although N2 is far above sub-idle, and fuel flow and P3 chatter between the two. The engine hangs at N1 about 35 % and 10.7 kN for the rest of the 10 s (the reference: 95 % thrust at 5.8 s, min margin 0.034, no surge).
  - So the hang is a lost gas-path solution after a recovered surge, not a locked stall. The reference never meets it, so no reference test covers it. It belongs to the D3-15 part-power backlog item, together with the booster map extension past R-line 3.0.
  - Since D4-13 (w2/followups) a lost solve is held and flagged, never the sub-idle model above the switch, and a failed warm start is retried by continuation first. The fit still has no matched solution from about 5.7 s (N2 74 %, the VBV fully open) to about 8.5 s (N2 88 %): the pin now asserts the lost and held solves there, and no 95 % thrust in the 10 s (about 94 kN at 10 s, on the held power balance, which is not physics). Since D4-84 (w2/cycle-hold) the retry is bounded per step: the same held stretch (5.7-8.56 s), then a second one from 9.8 s (N2 88 %), at most 88 kN in the 10 s.
  - Adopting the fit on a scratch copy (not committed) also failed 10 transient-model tests in model.test.ts and modelPaths.test.ts and a regression pin in offdesign.test.ts. C5's window was missed, and the steady-thrust and limiter tests no longer settled where they did. In a slam deceleration and on a 45 C day, the VBV (open up to 75 %, shut only above 95 % N2c) drove the booster past its map's choke edge (thermo range errors).
  - An earlier fit with the same VSV offsets left the HPC a -0.6 % surge margin in the slam: opening the VSVs 6 deg at idle spends the stall margin that the low-speed schedule exists to keep. So the fit fails D3-14's adoption rule.

### Likely cause of the residual gap

See the PHYSICS.md fidelity ledger. [EEDB] 8CM066 is a newly manufactured engine on a test bed (test engine status NME), while the [WIDURI] run is an on-wing engine with an unknown and likely deteriorated condition. Deterioration raises EGT and fuel flow at a given N1, which is consistent with the model reading cold at MPA. The new-engine databank fuel flows at 30 and 7 % are not explained that way. There, the generic, scaled pyCycle maps make the part-power engine more efficient than the real one by more than the published part-speed trends allow.
