w2/reference: DONE with open items. D4-8..D4-12 worked through: the RK pin, preconditioning (with a preconditioned far field), a characteristic inflow BC, a stricter convergence driver, the L4b grid study (L4b now passes at 170 x 17), the closed-box f32 experiment, coverage 89 %. L7, L8 and three convergence rows (L4b, L9a, L9b) still fail; causes located, decisions below (from 9640d89; HEAD = the commit of this handoff)

DONE (W2R-n IDs -> commits)
- W2R-1 bf43f6a `tests/unit/flow/rk.test.ts` (D4-8): von Neumann analysis of the tracking RK3 on the kappa = 0 MUSCL symbol. (0.2, 0.5, 1) is stable to CFL 1.541 at second order and 1.859 at first order; the spike's (0.1918, 0.4929, 1) grows long waves at every CFL (1.3e-4 per iteration at CFL 1, 1.5e-3 at 1.5). SOLVER.md 10 had 1.85 and 3e-4 (b61d2eb fixes them).
- W2R-2 bf43f6a (TDD) / 0f576a9 / b61d2eb: `converge` (tests/ladder/common.ts) needs the residual to stay below the target for 50 iterations (CONVERGED_WINDOW). L8's first run had stopped at iteration 1017 on a one-iteration dip of an oscillating residual. PHYSICS.md 3.3 "converged" was tightened to match.
- W2R-3 a2ab516 (SOLVER.md first) / c30e79e (TDD) / 1d91aeb: low-Mach preconditioning, tracking mode only (D4-10). Turkel alpha = 0 in (p, u, v, rw, s, Z), the Weiss-Smith form for this gas. beta^2 = min(1, max(M^2, minMach^2, dp_nb/(rho c^2))). The pressure term (Weiss, Maruszewski & Smith) was needed: without it a duct started from rest diverged. The preconditioned spectral radius sets the local dt. The increment correction scales the pressure increment by beta^2 and keeps u, v, rw, s and Z (`src/flow/reference/precondition.ts`). Tests: identity at beta 1 (bitwise), exact ambient, the pressure scaling to 1e-5, the preconditioned dt, and the low-Mach blockage duct: converges from rest to 1e-11 in < 4000 iterations, and the plain scheme started there stays there (residual < 1e-10, state within 1e-9).
- W2R-4 50ecd2f (TDD) / 1d91aeb: the inflow BC carries the cell's outgoing characteristic p' + rho c u_n (SOLVER.md 5). Before, the static pressure came from inside, and the ghost's speed answered a pressure change with -dp/(rho u): a feedback 1/M times faster than the acoustic dt covers. The plain scheme left its own steady state by 1e13 in 10 iterations (M 0.06 duct, any CFL). Test: the plain scheme holds the steady state of that duct (growth < 10x in 100 iterations).
- W2R-5 3fa6c39 (TDD) / 9e48987: under preconditioning, the far field uses the preconditioned pseudo-time characteristics (SOLVER.md 5). The physical ones reflect the slow waves, and the preconditioned iteration diverged: a far-field duct at M 0.01 grew 7000x, and with an axis it gave NaN at iteration 12; the L7 sphere at M 0.01 gave NaN at 74. With them the duct converges to 1e-12. Consequence: the steady state changes at the far-field boundary (see L7 below). The physical-time mode keeps the physical far field.
- W2R-6 (open, found here): blockage destabilises the plain scheme slowly. In a duct with b_min 0.85, from the converged state: x1e3 in 300 iterations at M 0.06 and x1e12 in 1000 at M 0.3. Without blockage the same duct is stable at M 0.3. The mode sits in the blockage region. W3's body-force rows will meet it. The preconditioned scheme converges these ducts.
- W2R-7 0c7cc4d / bfaf7c6: the L9 "stalls" were partly the criterion. The first-iteration density residual is exactly 0 for L9b and 1.4e-12 for L9a (the forces have no mass source), so "below 1e-6 of the first" could never hold. L9 now converges against its peak residual (PHYSICS.md 3.3, pre-stated).
- W2R-8 0c7cc4d (pre-registered before the runs) / bfaf7c6: the L4b grid study (D4-9), `tests/ladder/cases/l4bgrid.ts`: 120 x 12, 170 x 17 and 240 x 24 cells, with a Richardson extrapolation. Results under LADDER.
- W2R-9 bfaf7c6 / ce41402: the f32-storage experiment runs in a closed box (D4-12). Tracking 1.9e-7 / 4.4e-7 / 1.4e-6 after 1 / 10 / 100 iterations; physical 8.4e-8 / 2.4e-7 / 1.3e-5. Every row of SOLVER.md 12.2, N = 100 included, is backed by a margin of 54x or more.
- W2R-10 bfaf7c6: `tests/unit/flow/edges.test.ts` (faceFlux both directions, f32 storage, supersonic inflow, the beta = 1 increment, solver-mesh input checks). src/flow/reference branch coverage is 89.1 %, against the 85 % gate.

LADDER (CPU; full run @6eb4a30 except the L7 and L4b-grid rows; reports/ladder/*.json)
| case | metric | threshold | value | |
|---|---|---|---|---|
| L1 | quiescent, 130k f32 asset, residual bitwise 0 | < 1e-4 m/s | 0 | PASS |
| L1 | uniform M 0.5, 130k f64 metrics, 50 its | < 1e-4 m/s | 2.0e-13 | PASS |
| L1 | same, shipped f32-metric asset (reported) | - | 1.4e-5 (GCL defect 1.3e-7) | reported |
| L2 | L1(rho) / shock offset | < 1 % / <= 1 cell | 0.28 % / 0.23 | PASS |
| L3 | L1(rho) vs 1D reference | < 2 % | 0.21 % | PASS |
| L4a | Mach vs quasi-1D / choked mdot vs ideal x Cd | < 1 % / < 0.5 % | 0.28 % / 0.10 % (was 0.0026 %: the new inflow BC) | PASS |
| L4b | shock position / length, 170 x 17 (from the grid study) | < 2 % | 1.64 % | PASS |
| L4b | converged to 1e-5 (170 x 17) | <= 17000 | residual stalls at 0.15 of the first | FAIL |
| L4b grid | 120 x 12 / 170 x 17 / 240 x 24 / Richardson limit (order 1.46) | < 2 % | 2.38 / 1.64 / 1.19 / 0.51 % | reported |
| L5 | mdot vs b_min A rho* u* | < 1 % | 0.084 % | PASS |
| L6 | radial equilibrium free vortex / solid body | < 0.1 % q | 0.030 % / 0.0029 % | PASS |
| L6 | angular-momentum drift | < 1e-4 | 4.7e-15 / 5.4e-8 | PASS |
| L7 | M 0.01 Cp fore/aft asymmetry (preconditioned) | < 0.02 | 0.35 (not converged in 20000: 3.3e-4 of the first) | FAIL |
| L7 | M 0.01 Cd (preconditioned) | < 0.01 | 0.0073 | PASS |
| L7 | iterations M 0.01 / M 0.3 (both preconditioned) | <= 3 | > 8.6 (20000 cap / 2332) | FAIL |
| L7 | M 0.01 plain (reported): asymmetry / Cd / iterations | - | 0.35 / 0.0043 / not converged in 20000 | reported |
| L7 | M 0.3: preconditioned vs plain: max dCp / Cd / iterations | - | 2.3e-3 / 0.0060 vs 0.0069 / 2332 vs 3555 | reported |
| L8 | max over 0.2-1 m of abs(abs(u) / (mdot/(4 pi r^2 rho)) - 1) | < 1 % | 19.0 % at the criterion (1454 its); 15.1 % fully converged (8000 its, 1.3e-8) | FAIL |
| L9a | Euler work dT0 vs Omega d(r u_theta)/cp | < 1e-4 | 7.8e-6 | PASS |
| L9a | converged to 1e-6 of the peak | <= 20000 | residual stalls at 3.5e-3 of the peak | FAIL |
| L9b | disk velocity vs Rankine-Froude | < 2 % | 0.80 % | PASS |
| L9b | converged to 1e-5 of the peak | <= 20000 | residual 2.7e-2 of the peak at 20000 | FAIL |
| f32 | closed box, storage error 1 / 10 / 100 its | <= tol / 10 | 1.9e-7 / 4.4e-7 / 1.4e-6 (tracking) | PASS |

CAUSES FOUND
- L8 (D4-11), three separate things:
  1. Fake convergence: the criterion fired on a residual dip (W2R-2). Converged for real, the error falls from 20.9 % to 15.1 %.
  2. The axis cells of the polar mesh carry the 15 %. The mean over j = 0 is -7.4 %; j = 1 is -2.5 %; off the axis it is <= 2.6 %. The mass flux through every sphere is right to 1e-6, so the flow is redistributed in theta: it is pushed off the axis in the last ~6 cells before the far field (a tangential flux of 2-7 % of the radial flux per cell) and drifts back towards the axis further in. It gets worse with theta refinement (axis worst 9.5 / 15 / 21.5 % at 12 / 24 / 48 cells at fixed radial cells), while the axis cells' truncation error converges as dtheta^2 (6.6e-2, 1.7e-2, 4.2e-3, 1.0e-3 of rho U^2 / R at 12..96). So it is a conditioning problem of the axis cells at M 2e-4..5e-3, not a local truncation error. Ruled out: the axis cells' limited slopes (an unlimited central slope changes nothing), the far-field ghost layering, SLAU2's q-bar pressure term, a smooth instead of a sharp sink. First order doubles it. A wedge without the axis (slip-wall cones at 45 and 135 degrees) has -0.3 % at its wall cells.
  3. A radial odd-even mode of +-1.4 % in velocity (p' sawtooth of 65 Pa at the sink edge, 0.1 Pa at 1 m). It shrinks with radial refinement (0.46 % at 128 cells) and when the far field moves out (0.79 % at 6 m). It is the weak pressure-velocity coupling of SLAU2 at M 1e-4 (the mass-flux dissipation dp/(2c) is O(M) of a Rhie-Chow-like coupling).
  Preconditioning cannot change any of these, because they are steady-state properties.
- L7 Cp (D4-11): the 0.35 is not at the rear stagnation point. Both stagnation Cp agree (1.012 / 1.013). It is an odd-even sawtooth of the wall pressure in theta around the equator: Cp along j = 19..27 reads -1.14, -1.04, -1.32, -1.10, -1.42, -1.08, -1.36, -1.06, -1.23, with an amplitude of 0.15 q, i.e. 1 Pa at M 0.01. Plain and preconditioned give the same pattern to 3 decimals. It is the same weak low-Mach pressure-velocity coupling as L8's item 3. The asymmetry metric picks it up as Cp(23) - Cp(24).
- L7 iterations (D4-10): preconditioning works where nothing else limits it. The blockage duct converges from rest at M 0.01-0.3 to 1e-11 in < 4000 iterations, where the plain scheme does not converge at all. The far-field duct converges at M 0.01 once the far field is preconditioned (W2R-5). The M 0.3 sphere takes 2332 iterations against 3555. It does not accelerate the M 0.01 sphere (3.3e-4 of the first after 20000, the same as plain). The slow mode is the wall sawtooth above. Its only damping is SLAU2's mass-flux term dp/(2c). Under preconditioning the pressure update is scaled by beta^2 while dt grows only as 1/beta, so the sawtooth decays slower still: about beta/2 per iteration, against 1/2 without. This is the D4-10 "SLAU2 keeps its dissipation" constraint: a preconditioned scheme normally scales that dissipation by 1/beta. Without the W2R-5 far field, the combination diverged (NaN at 74).
- L4b stall (D4-9): the residual sits in the axis row (j = 0) behind the shock (i = 93-117, 2e3-3e3 kg/(m^3 s) against an rms of 375), and the residual stays at 0.18 of the first. The shock position is steady to +-0.01 % of the length over 12000 iterations (2.36-2.38 %), so the metric is converged although the residual is not. Not the cause: the inflow BC (W2R-4 did not change it), the axis cells' slopes (zero or central: no change), the CFL (0.6 / 1.0 / 1.5: 0.15-0.18).
- L9a stall: it needs the swirl. Without the rotor source the same duct converges to 6e-11 (with W2R-4). With it, the stall level grows as swirl^2 (3.3e-6 / 3.5e-5 / 3e-4 of the peak at F_theta 3e3 / 1e4 / 3e4), and it sits behind the disk at the walls. At CFL 0.8 it converges (1.2e-6 at 6000 iterations, still falling). So a swirl-dependent term makes the scheme unstable at CFL 1.5 and is not in the time-step estimate. Isolation (reports/scratch/l9adiag2.ts, 6000 iterations at CFL 1.5): dropping the centrifugal source rho w^2 A lowers the stall 30x (3e-4 to 9.4e-6). Copying the wall cell's scalars into the wall ghosts instead of extrapolating them lowers it 4x (7.6e-5). Copying only rw changes nothing. The centrifugal source, explicit and cell-centred, is the main term. The inertial rate 2w/r times dt is only 0.003, so it is not a plain stiffness; it most likely forces a weakly damped odd-even mode across the 4 cells.
- L9b: the case is non-converging only by the criterion's first = 0 (W2R-7). Against the peak it reaches 2.7e-2 in 20000 iterations; not investigated further.

NEXT
1. Fill in / act on the L4b grid study (decision (a)).
2. L9a: isolate the swirl term (switch off the centrifugal source, then the wall rw extrapolation, at CFL 1.5) and either add it to lambda or treat it point-implicitly; then L9b.
3. W2R-6 blockage instability: linearise the p grad b source with face pressures versus the cell p'_c, and test the duct at M 0.3 with b_min 0.85 from its converged state (scratch: reports/scratch/duct2.ts).
4. L8 axis conditioning: try a pressure-based coupling at the axis (or the AUSM+-up pressure diffusion, which is O(1/M), for the mass flux), but only through an orchestrator decision, because it changes SLAU2's dissipation (D4-10 keeps it).
5. L4b axis-row residual: print the time history of one axis cell behind the shock to tell a limit cycle from a slow drift.

ORCHESTRATOR DECISIONS NEEDED
- (a) L4b: per D4-9 the error converges below 2 % (Richardson 0.51 %), so the case now runs at 170 x 17 and passes at 1.64 %. Its residual still stalls at 0.15 of the first at every resolution, while the shock position is steady. Is the shock-position row enough, or must the stall be gone before L4b counts as passed?
- (b) Preconditioning changes the steady state at the far field (W2R-5): the preconditioned far field has a different non-reflecting relation. The M 0.3 sphere numbers (L7 rows) give the size. Accept it (tracking only; the physical-time mode keeps the physical far field), or ask for a far-field formulation that does not change the steady state. In the app, the static engine's far field is exactly where preconditioning is wanted.
- (c') L7: the 3x ratio is not met with SLAU2's own dissipation (M 0.01 does not converge in 20000, preconditioned or not), and the 0.35 asymmetry is a low-Mach wall-pressure sawtooth. Both point at the same SLAU2 property as L8 item 3. Options: scale SLAU2's mass-flux pressure dissipation by 1/beta in preconditioned tracking mode (this changes the steady state, so it needs your decision); or accept L7 as reported.
- (c) L8 fails at 15 % in the axis cells, for a conditioning reason SLAU2 alone does not fix. A remedy changes the scheme's low-Mach dissipation (D4-10 keeps SLAU2's), so this needs a decision: keep SLAU2 and report; add an axis-specific coupling; or adopt AUSM+-up-type pressure diffusion.
- (d) L9's convergence reference is the peak residual, because its first one is zero (W2R-7). Please confirm.
- (e) L9a converges at CFL 0.8 but not at 1.5. Until the swirl term is found: should the default tracking CFL be lowered where swirl is strong, or should the case wait for the term?

FOR w2/solver (what the kernel must implement; SOLVER.md is the contract)
- RK alpha (0.2, 0.5, 1) at CFL 1.5; the pressure-only slip wall with extrapolated ghosts; each wall ghost needs both wall cells (D4-8).
- The inflow BC of SOLVER.md 5: the outgoing characteristic, 3 Newton steps on sigma, each with 3 on T, then T and p' once more at the final sigma. Not the old static-pressure-from-inside form.
- Low-Mach preconditioning (tracking only): beta^2 per cell from the stage-1 primitives with the neighbour pressure term (frozen for the 3 stages, like tau); the preconditioned face spectral radius in lambda; the increment correction after the point-implicit division; and the far field with the preconditioned characteristics at beta_inf^2. Physical time uses none of it.
- Unchanged from before: the gauge EOS (secant cp, the 1000 K break, exactly 3 Newton steps); positivity fallback per cell and per direction; the SLAU2 expression order (bitwise antisymmetry); skip zero-area axis faces; the pressure source is p' times the b-weighted face-vector sum; lambda takes the max over each face pair; the far field is linearised; s_eta = s_E - h0inf s_m.
- SOLVER.md 12.2 tolerances stand; the closed-box experiment backs them (W2R-9).

GOTCHAS
- Scratch investigation scripts live in reports/scratch (git-ignored). reports/scratch/ref is a patchable copy of src/flow/reference with switches through globalThis.VAR; re-copy it before use, because it goes stale.
- The L8 criterion "1e-5 of the first residual" is met (1454 iterations) well before the field is steady (8000), because the first residual is the sink start-up. The window does not change that.
- converge(..., 'peak') rewrites `first` in the returned record to the peak.
- Coverage under CPU load: one heavy unit test timed out once while the ladder ran in parallel. The heavy flow tests have 120 s timeouts; run the gates on an idle machine.
- `python` writing docs on Windows needs encoding='utf-8' and newline='' (cp1252 otherwise).
- Vitest's module runner slows this numeric code 3-10x; heavy cases run through tests/ladder/spawn.ts (plain Node). Node's type stripping forbids enums and parameter properties in anything the cases import.

GATES @GATEHASH
- npm test: GATETEST
- npm run lint: clean. npm run typecheck: clean.
- npm run coverage: GATECOV
- npm run test:mesh: 29 passed.
- npm run test:ladder: LADDERGATE
- No new dependencies. No GPU, browser, bench or dev server used.
