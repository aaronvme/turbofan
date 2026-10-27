# Physics: equations, fidelity ledger, pre-registered thresholds

The thresholds in this file were set by the orchestrator on 2026-10-24, before any physics code existed (plan: `C:\Users\Aaron\.claude\plans\i-think-jet-engine-noble-glacier.md`). A test that checks one of them must import the number from here (via `src/contracts/thresholds.ts` once W0 adds it), never restate a looser one. A threshold changes only through a logged orchestrator decision `D<pass>-<n>` in `docs/reviews/LOG.md` that gives the reason. Changing one to make a failing test pass is not a reason.

## 1. Fidelity ledger

| Thing on screen | Status | Where it comes from |
|---|---|---|
| N1, N2, EGT, fuel flow, thrust, TSFC, station Pt/Tt/W | **Simulated** | 0-D transient cycle model (`src/cycle`) |
| Start sequence, accel/decel, limiters | **Simulated** | FADEC-like controller + shaft dynamics |
| Part-power performance: C10 MPA N2/EGT and idle position 2 N2, C11 at 30 and 7 % thrust | **Simulated, known gap** (KNOWN FAIL markers) | With every D3-11/D3-14 mechanism at its plausible bound, the bounded fit meets C10 and C11 except approach fuel flow (-6.4 %, against ±5 %). It breaks the transient model, so it is rejected, and the reference keeps the gap: MPA 536 vs 585 C and N2 2.6 points low; EEDB fuel -12 % at 30 %, -10 % at 7 %. Likely cause: the generic, scaled pyCycle maps are too efficient at part power. The two datasets also differ: [EEDB] 8CM066 is a newly manufactured engine on a test bed, while the [WIDURI] ground run is an on-wing engine of unknown, likely deteriorated condition, which runs hotter at a given N1 (ENGINE_FACTS "Part-power calibration") |
| Surge cycles (period from the derived Helmholtz frequency) | **Simulated** | Greitzer lumped compression-system model on the engine's own HPC system (D3-4, `src/cycle/surgeSystem.ts`): B from the HPC duct, the combustor plenum and the rotor tip speed at the current N2, the post-surge characteristic a cubic extension of the scaled HPC map. At SLS takeoff B = 0.19 and the Helmholtz period is 6.2 ms; a surge is a deep surge (reverse flow) with a period of about 15 ms |
| Meridional p, T, rho, velocity incl. swirl; choking; jet plume | **Simulated** | 2D axisymmetric + swirl solver (`src/flow`), body-force blade rows, combustor heat source |
| First 10-30 ms of a surge bang / light-off pressure wave | **Simulated** (slow motion) | solver physical-time mode |
| Particles, cut-plane fields, schlieren, heat haze | **Derived** from the simulated field | resampled solver textures |
| Blade-passage flow, rotor wakes, tip vortices | **Synthesized** (labelled in the app) | procedural perturbations scaled by the simulated field |
| Turbulent eddies in the plume/haze | **Synthesized** (labelled) | synthetic eddies scaled by the eddy viscosity (v1) or k (v2) |
| Engine sound | **Synthesized from simulated sources** | blade-pass/shaft-order tones from N1/N2, jet noise from simulated jet velocity |
| Geometry (flowpath, blades) | **Representative** | public dimensions + synthesized camber (Carter's rule); not proprietary data |

## 2. Equations (summary; builders expand each section with the exact form they implement)

- **Gas:** thermally perfect, cp(T, FAR) from NASA 7-coefficient polynomials for air and stoichiometric Jet-A products, frozen composition. One TypeScript module (`src/thermo`) is used by the cycle model and code-generated into WGSL constants. Frozen means complete combustion and no dissociation. Cantera 3.2.0 (`tools/thermo/cantera_crosscheck.py`, NASA TM-4513 species data, D3-5) puts the error of that at 0.23 % in cp at the cycle's hottest gas (combustor exit at SLS takeoff, 1641 K, 2.8 MPa, FAR 0.0245); it grows to 19 % for stoichiometric products at 2000 K and 1 atm, a state the engine never reaches. The same script reproduces the model's frozen cp within 0.05 % (air 200-1500 K, products 1000-2000 K) and its product composition within 1e-6.
- **Cycle:** component maps (pyCycle-derived, scaled), Newton–Raphson matching of mass-flow and work residuals; transients integrate `J dω/dt = τ_turbine − τ_compressor` per shaft.
- **Flow:** per-radian, r-weighted finite volume for the axisymmetric Euler equations with swirl. Conserved state (ρ′, ρu_x, ρu_r, ρ r u_θ, η) plus ρZ (fuel-air ratio), with ρ′ = ρ − ρ∞ and η = ρ(h₀ − h₀∞) − p′ (gauge variables). SLAU2 fluxes, MUSCL (van Albada), point-implicit sources, 3-stage RK with local time stepping (steady) or SSP-RK3 (physical time). Hall–Thollet body force with blockage for compressor rows, follow-camber relaxation for turbine rows, heat release `η_b W_f LHV` in the combustor. v1 turbulence: Euler in the engine, Prandtl free-shear eddy viscosity `ν_t = 0.028 ΔU r½` in the plume.

### 2.1 Coordinates and conventions (W0 contracts; `src/contracts/engine.ts`, `src/contracts/stations.ts`)

- **Frame:** meridional (x, r, θ), SI units. x is axial, **x = 0 at the station 2 plane (fan face)**, positive downstream; r ≥ 0 from the engine axis; θ right-handed about +x. Every module (definition, mesh, solver, geometry, cycle stations) uses this frame.
- **Rotation:** `rotation[spool]` is the sign of the shaft angular velocity about +x (+1 = counter-clockwise seen from behind, looking upstream along −x). The CFM56-7B "rotates clockwise (aft looking forward)" (NTSB AAR-19/03 §1.3.1), so both spools are **−1** (co-rotating). Absolute swirl from the fan and compressors is therefore in −θ.
- **Angles:** blade and flow angles are geometric, measured from the meridional (+x) direction, positive toward +θ, and do not depend on the rotation sign: a rotor turning in −θ simply has the mirror image of the angles of one turning in +θ. Compressor rotor angles are positive (relative flow toward +θ), turbine rotor inlet angles negative.
- **Curves:** flowpath walls are (x, r) polylines with strictly increasing x and linear interpolation; a hub curve that starts on the axis (the spinner) counts as the axis upstream of its nose.
- **Render textures (decision D0-4):** the state texture stores the gauge ratios (p − p∞)/p∞ and (ρ − ρ∞)/ρ∞, then T (K) and FAR; the velocity texture stores u_x, u_r, u_θ (m/s) and the fluid fraction. An ambient texel encodes as exact zeros. f16 keeps 11 bits of the perturbation itself, where p/p∞ would quantise at about 1e-3 (about 100 Pa).
- **EGT:** the cockpit EGT is the measured T49.5 plus the FADEC display shunt (+30 K, ramped over 8300–8500 rpm N2 for "TI" engines; EASA TCDS E.004 IV.1.1). The TCDS limits are displayed values.

### 2.2 Stations (SAE ARP755, superseded by AS755)

| Station | Plane | x in the reference engine (m) |
|---|---|---|
| 0 | free stream (not a plane) | — |
| 1 | inlet highlight | −0.775 |
| 2 | fan face (defines x = 0) | 0 |
| 13 | bypass stream behind the fan OGVs | 0.600 |
| 18 / 19 | bypass nozzle throat / exit (convergent: same plane) | 1.550 |
| 21 | core stream behind the fan root, booster inlet | 0.265 |
| 24 | booster exit | 0.640 |
| 25 | HPC inlet (after the transition duct; P25 = P24 by the OPR convention) | 0.860 |
| 3 | HPC exit (OPR = P3/P2) | 1.460 |
| 4 | combustor exit / HPT NGV inlet (T4) | 1.740 |
| 41 | HPT rotor inlet, cooling air mixed in | 1.793 |
| 45 | LPT inlet | 1.970 |
| 49.5 | LPT stage 2 nozzle: the EGT probe plane (TCDS E.004 IV.1.1) | 2.065 |
| 5 | LPT exit | 2.370 |
| 8 / 9 | core nozzle throat / exit (convergent: same plane) | 2.750 |

Upstream-to-downstream order along the core: 1, 2, 21, 24, 25, 3, 4, 41, 45, 49.5, 5, 8, 9; along the bypass: 1, 2, 13, 18, 19. The solver reduces its field to the cycle at stations 2, 13, 18, 25, 3, 4, 45, 5, 8. The x values come from `src/engine/definition.ts` (flowpath proportions justified in ENGINE_FACTS.md).

### 2.3 Synthesized blade rows and design-point estimate (W0)

- **Design-point estimate** (`src/engine/designPoint.ts`): constant-cp, calorically perfect sections (cold γ = 1.4; hot cp = 1150 J/(kg K)), isentropic compressor and turbine efficiencies, fuel energy `η_b W_f LHV` into the combustor air, shaft balances with a 0.99 mechanical efficiency, convergent nozzles. It gives the blade mean line its totals; since D2-2 A8 and A18 come from the w1/cycle sizing (thermally perfect), 4.0 % / 1.0 % above this estimate's. It is not the cycle model.
- **Blade synthesis** (`src/engine/bladeDesign.ts`): free vortex (r c_θ and c_x uniform across the span at each edge), equal stage work with a chosen mean-line reaction, c_x from continuity on the subsonic branch, zero incidence, Carter's rule δ = m θ / σⁿ with m = 0.23 (2a/c)² + ξ°/500 (a/c = 0.5), n = 1/2 for decelerating and 1 for accelerating rows; no deviation in turbine rows (follow-camber); stagger = mean of the metal angles; chord = meridional length / cos(stagger); counts from a target mid-span solidity except the 24 published fan blades. The Euler work Ω Δ(r c_θ) on the mean line equals each component's design work exactly.

## 3. Pre-registered thresholds

### 3.1 Thermo
| ID | Check | Pass |
|---|---|---|
| T1 | cp of air at 300, 500, 1000, 1500 K vs NASA/JANAF tables | within 0.5% |
| T2 | γ of air at the same temperatures | within 0.5% |
| T3 | cp of stoichiometric Jet-A products at 1000, 1500, 2000 K vs JANAF species tables mixed at the frozen stoichiometric Jet-A product composition (the method CEA uses for a frozen mixture) | within 0.5% |
| T4 | h(T) integrates cp(T): h(T2) − h(T1) vs numeric integral | within 1e-6 relative |

### 3.2 Cycle (targets come from `docs/ENGINE_FACTS.md`, each with its source)
| ID | Check | Pass |
|---|---|---|
| C1 | SLS takeoff thrust | within 3% of published |
| C2 | SLS takeoff BPR, OPR, total airflow | each within 3% of published |
| C3 | SLS takeoff TSFC | within 3% of published (or of the cited estimate, if no official figure) |
| C4 | Ground-idle N1, N2, EGT | inside the published ranges |
| C5 | Flight idle to 95% takeoff thrust (14 CFR 33.73) | ≤ 5.0 s |
| C6 | Takeoff EGT | below the redline in the type certificate data sheet |
| C7 | Off-design matching converges (residual < 1e-8 relative) at every point of a throttle sweep idle → takeoff | 100% of points, ≤ 25 Newton iterations each |
| C8 | Mass and energy balance across the whole engine at every matched point | within 1e-6 relative |
| C9 | Greitzer model, B above critical: deep-surge limit cycle appears; B below critical: rotating-stall-free recovery | qualitative, plus cycle period within 20% of the Helmholtz estimate |
| C10 | Measured ground-run points, [WIDURI] Table 7 (OAT 25 °C, 1008 hPa, 14 ft): at the measured N1 of ground idle (20.5 / 21.0 %), MPA (65.0 %) and takeoff (97.4 %) | the model's displayed EGT within ±30 K of the measured value (idle: inside the measured 466-493 °C range widened by 30 K on each side, i.e. 436-523 °C; MPA 585 ± 30 °C; takeoff 855 ± 30 °C) and N2 within ±1.5 points of the measured value (idle 60.6 / 60.7 %, MPA 89.3 %, takeoff 99.8 %) |
| C11 | Fuel flow at the EEDB LTO settings 7 / 30 / 85% rated thrust (ISA SLS) | within ±5% of the databank |

C10 was added by decision D3-3 (critic pass 3, question l) before any code was tuned to it; it adds a check and loosens none. The ±30 K band roughly covers engine-to-engine scatter and the measurement itself. The measured values are ENGINE_FACTS rows (idleN1Low ... staticTakeoffEgt, runUpOat, runUpPressure).

C11 was added by decision D3-11 before any part-power calibration was tuned to it; it adds a check and loosens none. The three settings are the ICAO LTO thrust settings of the engine's databank row ([EEDB] 8CM066, test bed, ISA SLS, no bleed or power extraction): the model runs at 0.07, 0.30 and 0.85 x eedbRatedThrust and its fuel flow is compared with fuelFlowIdle, fuelFlowApproach and fuelFlowClimbOut (ENGINE_FACTS rows). The 100 % setting is the sizing point (C3) and is not repeated here. D3-11 also says how C10 and C11 may be met: only through bounded, physically real part-power mechanisms (the VBV schedule, the HPC VSV schedule, the part-speed efficiency trends of the fan, booster and LPT maps), fitted to both datasets at once.

### 3.3 Flow solver validation ladder
| ID | Case | Pass |
|---|---|---|
| L1 | Quiescent ambient and uniform M 0.5 flow on the real mesh (axis + block interfaces) | spurious velocity < 1e-4 m/s after 20k iterations |
| L2 | Axial Sod shock tube, 400 cells | L1(ρ) < 1%; shock within 1 cell of exact |
| L3 | Cylindrical (radial) Sod vs a 1D f64 reference | L1(ρ) < 2% |
| L4 | Axisymmetric converging-diverging nozzle | Mach within 1% of quasi-1D theory; normal-shock position within 2% of nozzle length; choked mass flow within 0.5% of ideal × the contour's Cd |
| L5 | Choking through a blockage-only row | mass flow within 1% of area theory |
| L6 | Free vortex and solid-body rotation in an annulus | radial-equilibrium error < 0.1% of dynamic pressure; angular-momentum drift < 1e-4 |
| L7 | Inviscid sphere at M 0.01 | Cp fore/aft symmetric within 2%; Cd < 0.01; iterations to converge within 3× the M 0.3 case |
| L8 | Static point sink in ambient at rest | velocity within 1% of ṁ/(4πr²ρ) |
| L9 | Actuator disk | ΔT₀ = ΩΔ(r u_θ)/cp to 1e-4 relative; momentum theory within 2% |
| L10 | NASA Rotor 67 speedline (TP-2879), stretch goal | pressure ratio within 3%; choke flow within 1% |
| L11 | Jets | round-jet spreading rate 0.086–0.096 ±15%; centreline decay constant B ≈ 5.8 ±15%; cold M 0.9 potential core 6–7 D ±1 D; hot-jet trend matches Bridges & Wernet; coaxial centreline velocity ±15% vs NASA separate-flow nozzle data |
| L12 | Calibrated engine vs the cycle model | station flows ±0.5%; T₄ ±10 K; thrust ±2%; 1% lag < 1 s on a throttle ramp |
| L13 | 10-minute soak on the laptop (Arc 140T) | solver p95 ≤ 7 ms per frame while holding 60 fps at the default preset |

### 3.4 Performance (measured in real Chrome on the Arc 140T)
| ID | Check | Pass |
|---|---|---|
| P1 | Solver throughput at ~130k cells inside a 1080p three.js scene (W0 spike a) | ≥ 150 iterations/s, else a logged decision (≈80k cells or a half-rate solver). Measurement protocol (D0-1): on AC power, no other agents/builds/tests running, Chrome in the foreground, 10 s warm-up then the median of 3 runs of 60 s; the conditions (power source, CPU load, GPU clock if readable) are recorded with the number. A result below 150 counts only after a quiet re-run under this protocol. |
| P2 | Default preset frame rate | ≥ 55 fps (performance trace) |
| P3 | WebGPU validation errors during any test or scenario | zero |
| P4 | Render GPU time (engine plus post, excluding the solver and flow visuals) at the default preset, 1080p, default three-quarter front view (D4-2) | ≤ 8.0 ms median under D0-1. The cutaway and hero views are reported (target ≤ 10 ms) but not gated. |
