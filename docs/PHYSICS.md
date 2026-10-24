# Physics: equations, fidelity ledger, pre-registered thresholds

The thresholds in this file were set by the orchestrator on 2026-10-24, before any physics code existed (plan: `C:\Users\Aaron\.claude\plans\i-think-jet-engine-noble-glacier.md`). A test that checks one of them must import the number from here (via `src/contracts/thresholds.ts` once W0 adds it), never restate a looser one. A threshold changes only through a logged orchestrator decision `D<pass>-<n>` in `docs/reviews/LOG.md` that gives the reason. Changing one to make a failing test pass is not a reason.

## 1. Fidelity ledger

| Thing on screen | Status | Where it comes from |
|---|---|---|
| N1, N2, EGT, fuel flow, thrust, TSFC, station Pt/Tt/W | **Simulated** | 0-D transient cycle model (`src/cycle`) |
| Start sequence, accel/decel, limiters | **Simulated** | FADEC-like controller + shaft dynamics |
| Surge cycles (100-300 ms) | **Simulated** | Greitzer lumped compression-system model |
| Meridional p, T, rho, velocity incl. swirl; choking; jet plume | **Simulated** | 2D axisymmetric + swirl solver (`src/flow`), body-force blade rows, combustor heat source |
| First 10-30 ms of a surge bang / light-off pressure wave | **Simulated** (slow motion) | solver physical-time mode |
| Particles, cut-plane fields, schlieren, heat haze | **Derived** from the simulated field | resampled solver textures |
| Blade-passage flow, rotor wakes, tip vortices | **Synthesized** (labelled in the app) | procedural perturbations scaled by the simulated field |
| Turbulent eddies in the plume/haze | **Synthesized** (labelled) | synthetic eddies scaled by the eddy viscosity (v1) or k (v2) |
| Engine sound | **Synthesized from simulated sources** | blade-pass/shaft-order tones from N1/N2, jet noise from simulated jet velocity |
| Geometry (flowpath, blades) | **Representative** | public dimensions + synthesized camber (Carter's rule); not proprietary data |

## 2. Equations (summary; builders expand each section with the exact form they implement)

- **Gas:** thermally perfect, cp(T, FAR) from NASA 7-coefficient polynomials for air and stoichiometric Jet-A products, frozen composition. One TypeScript module (`src/thermo`) is used by the cycle model and code-generated into WGSL constants.
- **Cycle:** component maps (pyCycle-derived, scaled), Newton–Raphson matching of mass-flow and work residuals; transients integrate `J dω/dt = τ_turbine − τ_compressor` per shaft.
- **Flow:** per-radian, r-weighted finite volume for the axisymmetric Euler equations with swirl. Conserved state (ρ′, ρu_x, ρu_r, ρ r u_θ, η) plus ρZ (fuel-air ratio), with ρ′ = ρ − ρ∞ and η = ρ(h₀ − h₀∞) − p′ (gauge variables). SLAU2 fluxes, MUSCL (van Albada), point-implicit sources, 3-stage RK with local time stepping (steady) or SSP-RK3 (physical time). Hall–Thollet body force with blockage for compressor rows, follow-camber relaxation for turbine rows, heat release `η_b W_f LHV` in the combustor. v1 turbulence: Euler in the engine, Prandtl free-shear eddy viscosity `ν_t = 0.028 ΔU r½` in the plume.

## 3. Pre-registered thresholds

### 3.1 Thermo
| ID | Check | Pass |
|---|---|---|
| T1 | cp of air at 300, 500, 1000, 1500 K vs NASA/JANAF tables | within 0.5% |
| T2 | γ of air at the same temperatures | within 0.5% |
| T3 | cp of stoichiometric Jet-A products at 1000, 1500, 2000 K vs a NASA CEA reference | within 0.5% |
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
