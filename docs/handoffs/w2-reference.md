w2/reference: WIP, stopped clean at the usage cap. The f64 oracle, its spec (docs/SOLVER.md), the mesh loader and the CPU ladder are in; 4 ladder cases fail and need an orchestrator decision; coverage branch gate open (from e1ca8a2; HEAD = the commit of this handoff)

DONE
- 507f35d docs/SOLVER.md: the discrete scheme, term by term (gauge state and gauge EOS, BCs, MUSCL/positivity, SLAU2, blockage and volume-source interface for W3, residual, RK3/SSP-RK3, diagnostics, f32 notes and the w2/solver tolerance table). The mesh-file decoder moved to src/flow/mesh/meshFile.ts (tools/mesh/format.ts re-exports it and keeps meshFileFromMesh). npm run mesh regenerates byte-identically.
- 7a3e569 (TDD) / 9b61408 gas (src/thermo tables in divided-difference "gauge" form: exact ambient zeros, 3 fixed Newton steps), state, SLAU2 (bitwise F(L,R,S) = -F(R,L,-S)), MUSCL/van Albada with a per-cell, per-direction positivity fallback, BCs.
- c5208d0 (TDD) / 6feb21a solver mesh, source interface (rates + point-implicit damping per gas volume, s_eta = s_E - h0inf s_m), ReferenceSolver (tracking RK3 with local dt, SSP-RK3, blockage, bcRemap, f32-storage option). Unit tests: quiescent bitwise exact with every BC, GCL on a curvilinear axisymmetric 3-block mesh, interface conservation (min/max, max/max, min/min) and 3-rotated-blocks = 1 block, blockage well-balance, RK amplification factors, mass source.
- 1d3ea3a (TDD) / next: src/flow/mesh/loader.ts: manifest parse, length + SHA-256 (Web Crypto), the decoder's W0M-N3 structural checks, W1M-N3 numeric checks, W1M-N4 domain from the INFLOW/OUTFLOW/FARFIELD patch nodes (real asset: x -8.54..33.75, r 8.82; FIELD_EXTENTS and minimumSolverDomain inside).
- a1aa697, d237f69 PHYSICS.md 3.3 "CPU variants" pre-registered before any ladder run (L8 resolution amended before running). Only L1 is reduced (2 / 50 iterations); the 20k-iteration L1 of record is w2/solver's.
- bd927f3 (TDD) / dd4c2d2 slip walls changed from the W0 mirror ghost to a pressure-only wall flux with linearly extrapolated ghosts. Reason, found by the ladder: the mirror imposes dp/dn = 0, leaving an odd-even wall mode wherever swirl or wall curvature sets a normal pressure gradient (first L6 run: 1.3 % / 0.45 % of q, 72 Pa at the inner wall), and it leaked mass through walls not aligned with x or r (unit test). After: L6 3.0e-4 / 2.9e-5.
- 8ae6d16 ladder cases as plain-Node child processes (tests/ladder/cases, spawn.ts): vitest's module runner ran the solver at 4.7 us/cell-it, degrading to ~17; plain Node 1.4 us. `npm run test:ladder` takes 6 min 38 s (13 files in parallel). Not added to `npm run gates` (too long, and it fails today). src/flow 90 % lines added to the coverage thresholds.
- RK coefficients: the spike's (0.1918, 0.4929, 1) are linearly unstable with kappa = 0 MUSCL (alpha_2 < 1/2); now (0.2, 0.5, 1), stable to CFL 1.54 (second order) / 1.85 (first order). Default tracking CFL 1.5. The brief's 1.5-1.8 is stable only where the limiter is first order.

LADDER (CPU, @8ae6d16 except where noted; reports/ladder/*.json)
| case | metric | threshold | value | |
|---|---|---|---|---|
| L1 | quiescent, 130k f32 asset, residual bitwise 0 | < 1e-4 m/s | 0 | PASS |
| L1 | uniform M 0.5, 130k f64 metrics, 50 its | < 1e-4 m/s | 2.0e-13 | PASS |
| L1 | same on the shipped f32-metric asset (reported) | - | 1.4e-5 (GCL defect 1.3e-7) | see GOTCHAS |
| L2 | L1(rho) / shock offset | < 1 % / <= 1 cell | 0.28 % / 0.23 cell | PASS |
| L3 | L1(rho) vs 1D 4000-cell reference | < 2 % | 0.21 % | PASS |
| L4a | Mach vs quasi-1D / choked mdot vs ideal x Cd | < 1 % / < 0.5 % | 0.34 % / 0.0026 % | PASS |
| L4b | shock position / length | < 2 % | 2.26 %, residual stalls (12000 its) | FAIL |
| L5 | mdot vs b_min A rho* u* | < 1 % | 0.084 % | PASS |
| L6 | radial equilibrium (free vortex / solid body) | < 0.1 % q | 0.030 % / 0.0029 % | PASS |
| L6 | angular-momentum drift | < 1e-4 | 4.7e-15 / 5.4e-8 | PASS |
| L7 | Cp fore/aft asymmetry at M 0.01 | < 0.02 | 0.35 | FAIL |
| L7 | Cd at M 0.01 | < 0.01 | 0.0043 | PASS |
| L7 | iterations M 0.01 / M 0.3 | <= 3 | 6.46 | FAIL |
| L8 | |u| vs mdot/(4 pi r^2 rho), 0.2-1 m | < 1 % | 20.9 % (converged) | FAIL |
| L9a | Euler work Delta T0 vs Omega Delta(r u_theta)/cp | < 1e-4 | 2.8e-6 (residual stalls before 1e-6) | value PASS |
| L9b | disk velocity vs Rankine-Froude | < 2 % | 0.71 % (residual stalls before 1e-5) | value PASS |

NEXT
1. Orchestrator decisions (below). Do not tune the failing cases.
2. Investigate L8 first (most likely a set-up or BC problem, not the scheme): print the error by cell; check the axis cells of the polar mesh and the far-field steady offset; the max over 0.2-1 m may be dominated by a few cells.
3. L7: the Cp asymmetry is local to the rear stagnation point (Cd is small); check the entropy error from the front stagnation point and the polar mesh's axis cells. The iteration ratio needs low-Mach preconditioning or acceptance (SLAU2 is all-speed in accuracy, not in stiffness).
4. f32 experiment (tests/ladder/cases/f32.ts) is mis-designed: by 100 iterations the pulse has left the open domain, so the relative error divides by a vanishing scale (1.2 / 0.12). After 1 and 10 iterations it is 1.3e-7 / 1.3e-6 (tracking), 9e-8 / 2.6e-7 (physical), at least 10x under the table. Fix: a closed box (walls + axis), then confirm or revise SOLVER.md 12.2's N = 100 row.
5. Coverage: src/flow/reference branches 80.2 % < the existing 85 % gate (lines 99 %). Cover the remaining branches (inflow supersonic branch, BC remap, faceFlux on walls, temperature range-break branches) with unit tests.
6. L9a/L9b/L4b residual stalls: look for limiter cycling (residual plateaus while the metrics are steady).

ORCHESTRATOR DECISIONS NEEDED
- (a) L4b fails at 2.26 % (threshold 2 %): the case is ill-conditioned (a 1.5 % change in back pressure moves this weak shock, M1 1.43, by 2.2 % of the length); the residual also stalls. Keep the case, choose a stronger shock position, or accept after the residual stall is understood.
- (b) L7 iteration ratio 6.5 (threshold 3): without low-Mach preconditioning the M 0.01 case converges slower; preconditioning changes the scheme the kernel implements.
- (c) L7 Cp asymmetry and L8: under investigation (NEXT 2, 3), not yet a verdict.
- (d) Accept the slip-wall change (pressure-only wall flux, extrapolated ghosts) and the RK coefficient change (0.2, 0.5, 1): both differ from the W0 spike kernel, and w2/solver must implement them.
- (e) f32 metrics: the shipped asset's GCL defect (1.3e-7 relative) gave 1.4e-5 m/s after 50 iterations on the f64 oracle and may grow towards L1's 1e-4 over 20k iterations. If w2/solver's L1 fails, the remedy is in the asset (f64 metrics, ~5 MB more, or GCL-exact f32 face vectors), not the kernel.

FOR w2/solver
- The contract is docs/SOLVER.md; tolerance table in 12.2 (relative errors over 1/10/100 iterations, bitwise zero for the quiescent case). The N = 100 rows are not yet backed by the f32 experiment (NEXT 4).
- Trickiest terms: the gauge EOS (secant cp divided differences, the 1000 K break, exactly 3 Newton steps); per-cell-per-direction positivity fallback (not per face, not across directions); SLAU2 expression order (bitwise antisymmetry for max/max interfaces); skip zero-area axis faces (no 1/r_f); slip-wall faces are pressure-only, and each wall ghost needs both wall cells (SolverMesh.ghostPartner); the pressure source is p' times the b-weighted face-vector sum, not p' A; lambda uses the max over each face pair; RK alpha (0.2, 0.5, 1); far field linearised; inflow uses log1p/expm1 (WGSL replacements in SOLVER.md 5); s_eta = s_E - h0inf s_m.
- The oracle uses the asset's f32 metrics upcast, never recomputed, so both see the same numbers.

GOTCHAS
- Vitest's module runner slows this numeric code 3-10x; run heavy cases through tests/ladder/spawn.ts (plain Node + tools/mesh/ts-resolve.mjs). Node's type stripping forbids enums and parameter properties in anything the cases import.
- `?? NaN` index guards count as untaken branches in V8 coverage; src/flow/reference uses `as number` instead.
- /tmp in Git Bash is not /tmp for Node on Windows (use cygpath -w). `rm -rf` is blocked by a hook; scratch lives in the ignored reports/.
- The usage file read 20 % for most of the session, then jumped to 71-80 %.

GATES @8ae6d16
- npm test: 1676 passed + 5 expected fail (79 files)
- npm run lint: clean. npm run typecheck: clean.
- npm run coverage: lines 99.25 %, branches 87.59 % overall; FAILS the src/flow/reference branch gate (80.16 % < 85 %); src/flow lines >= 90 %.
- npm run test:mesh: 29 passed.
- npm run test:ladder: 7 files passed, 6 failed (L4b, L7, L8, the f32 experiment, and the L9a/L9b convergence rows), 6 min 38 s.
- No new dependencies. No GPU, browser, bench or dev server used.
