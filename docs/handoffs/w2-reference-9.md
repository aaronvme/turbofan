w2/reference-9 round 10: STOP-CLEAN at the self-brake (usage 79-84 %). D4-68 has no adoptable form, D4-69 is a decaying non-normal transient, and D4-72's rule is in the d463 case. coverage, test:mesh and test:ladder were not run (no src/ change). (From bcacc0a; HEAD = the commit of this handoff.)

DONE (round 10)
- 9a9dd28 D4-68 in SOLVER.md 10 (table there). Not adopted. K = 0: the D4-63 case is NaN at ~190 iterations, C-pre is NaN by 10, and L8 fails (velocity 11.1 %, steadiness 0.071). L7 is unchanged (0.0131 / 0.0016 / 1.048). The face-limited Δp (max |p'_R - p'_L| of the MUSCL face states) keeps C-pre and S, but fails rule 1 like the contract (max |p'| 8.05x, residual 11.2x). The Δp term is not the nonlinear part's cause: at beta = M_cut a wave p' carries u ~ p'/(rho beta c), and the pseudo-time nonlinearity p'/(rho beta^2 c^2) is bounded only by the M^2 term or a floor.
- 0d7ec78 D4-72: `tests/ladder/cases/d463.ts` rule (a) is now the volume-weighted L2 of p' (<= 2x its first over 1000-2000), (b) is unchanged (residual <= its value at 100), and row 3 reports max |p'|. `d463.test.ts` keeps `it.fails`, because the contract fails (b) (round 9's log: L2 1.72x, inside the bound; residual 11.9x). D4-69's verdict is in SOLVER.md 10. D4-71: SOLVER.md 12.2 E-L9a is 1e-10.

D4-69 VERDICT (SOLVER.md 10 has the numbers)
- A non-normal transient, not a mode. On the 130k mesh, engine default, isentropic 1e-6, 20k iterations renormalised: the pseudo-energy E_tau falls in 99 of 100 windows (one rise of 3e-4). L2(p') is 0.47-0.51 over 1000-2000 and 0.022 at 20k. Max |p'| peaks at 4.98x (3600) and is 0.35x at 20k. The residual is 12.9x its value at 100 over 1000-2000, 28x at its peak, and 2.1x at 20k.
- Spectral radius 1, from the neutral entropy/vortical family. Core-duct stand-in Arnoldi (linear, wall/outflow ends): leading 1 + 4.5e-7 per iteration, pressure-free. Every Ritz value that carries pressure is <= 0.99999. The late vector of the full-mesh run sits in the core duct beside the plug, core(492,0), and decays at 0.999984 per iteration.
- Rule under D4-72: (a) passes for the contract (1.72) and for the linear part (0.51). (b) fails for both, because the residual (the unweighted mean of (R/V)^2) is not an energy norm and weights the small core cells.

DECISIONS NEEDED
- (a) Rule 1b's residual: keep it as stated (then D4-63 stays open, since the linear transient alone fails it), or restate it in an energy-weighted residual (D4-70/D4-72 logic). Not changed here.
- (b) The nonlinear part has no local Δp fix. Candidates (scheme/contract changes): a larger floor (round 9: minMach 0.02 cut the stand-in's focus 5.4x -> 2.3x) or an amplitude-aware beta^2.
- (c) Found on the way: the smooth limiter (D4-25) with a far field has a real growing pressure-free mode, 1.00289 per iteration at the far-field/wall corner (the sharp limiter decays). The core block alone, with a far field at imin, goes to NaN from the 1e-3 pulse at K = 1 too (the far field under a finite pseudo-velocity at M_cut).

KERNEL MIRROR (for w2/solver)
- beta^2 unchanged: min(1, max(M^2, minMach^2, K |dp|/(rho c^2))), K = 1, dp = the largest |p'_nb - p'_c| over the four face neighbours (ghosts included). No D4-63 fix was adopted, so there is no scheme change to mirror.
- D4-62 / D4-71: `tests/gpu/oracle.test.ts` E-L5 / E-L9a `fluxScaleError` against 3e-7 / **1e-10**; `tests/gpu-ladder/ladder.test.ts` B's residual row against 2e-10.
- The GPU engine-stability test takes the d463 rule in D4-72's form (L2 of p', residual) when D4-63 is decided.

NEXT
1. The face-limited d463 rerun with both norms was running at the stop (`reports/scratch/r10/logs/d463_face2.log`): read its rows 1-3.
2. Gates at this HEAD: coverage, test:mesh, test:ladder. test:ladder's d463 now prints the L2 row; expected (a) ~1.7 pass, (b) ~12x fail (the pin holds).
3. The orchestrator's decisions (a)-(c).

GOTCHAS
- Scratch (gitignored): `reports/scratch/r10/`. It holds `ref/solver.ts` (a copy with `R10_K`, `R10_DP=face`, and public tau/beta2) and `redirect.mjs` (a resolve hook: run `node --import ./tools/mesh/ts-resolve.mjs --import ./reports/scratch/r10/redirect.mjs ...`, or NODE_OPTIONS for the ladder's child processes, as in `rows.sh`). It also holds `power.ts` (the renormalised power iteration, E_tau), `arnoldi.ts` + `eig.ts` (hqr, self-tested), `bound.ts`, and `logs/`.
- **This machine runs background node on the E-cores: 775 ms/it on 130k. Raise to AboveNormal (`r10/boost.sh`) for 215 ms/it.**
- Arnoldi is invalid with a far field at rest (the sign switch on u_n) and with the sharp limiter (only homogeneous). Use the power iteration there. Scale matvec vectors by their full amplitude, not by p' (a velocity-only vector leaves the linear range).

GATES @0d7ec78 (src/ unchanged since bcacc0a; tests/ladder d463 and docs only)
- npm run typecheck: clean
- npm run lint: clean (ESLint --max-warnings 0, Prettier)
- npm run coverage / test:mesh / test:ladder: NOT RUN (self-brake). Last: coverage 1917 passed / 11 expected fail, test:mesh 29 passed (@eb5f92b; src/ is unchanged since).
