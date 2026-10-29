w2/reference-9: STOP-CLEAN early (orchestrator, for an official timing). Investigation only: no code, test or SOLVER.md change yet. (From main 22655d3; HEAD = the commit of this handoff.)

DONE
- Setup: `npm ci` and `npm run mesh` ran clean in this worktree (public/mesh/*.bin and manifest.json are generated, not committed).
- Read: CLAUDE.md, SOLVER.md (all of it), the w2-reference and w2-solver-int handoffs, LOG.md D4-29/34/36/51/52/55/62/63, critic passes 9/10 on R/J (W2R-I9..I12, N16).
- A D4-63 repro in the f64 oracle (scratch only, gitignored, still on disk in this worktree):
  - reports/scratch/r9/common.ts: the shipped 130k asset (f32 metrics) at GpuFlowSolver's defaults (THERMALLY_PERFECT, ISA SLS at rest, minMach = M_cut = 0.003, CFL 0.8), and engine-stability.test.ts's wave (isothermal 0.1 % p wave, cos(6 pi x_n) exp(-(r / 0.3 r_max)^2)). Env switches: PRE (0/1), MINMACH, MACHCUT, CFL, LIMITER (sharp/smooth), AMP.
  - reports/scratch/r9/grow.ts: prints max |rho'| and max |p'| over their first, the residual and the block/(i, j)/x/r of max |p'| every EVERY iterations.
  - reports/scratch/r9/blocks.ts: the 12 blocks, sizes, extents and BC per face.
  - Run as `N=2000 EVERY=50 node --import ./tools/mesh/ts-resolve.mjs reports/scratch/r9/grow.ts` from the worktree root.
  - 240 ms/iteration alone; 640-730 ms with three runs side by side (2000 iterations: 8 min alone).

FINDINGS SO FAR (partial runs, stopped at 100-150 iterations)
| run | 50 | 100 | 150 | where max abs p' sits |
|---|---|---|---|---|
| engine default, AMP 1e-3 (the repro) | rho 0.974, p 0.979, res 9.08 | rho 1.510, p 2.439, res 12.4 | rho 2.367, p 3.702, res 22.4 | upstream block, i = 2 (next to the INFLOW face imin), x -6.9 m, r 1.76 -> 1.13 -> 0.90 (moving to the axis) |
| the same at AMP 1e-6 | rho 0.960, p 0.944, res 2.5e-2 | rho 0.903, p 0.962, res 4.7e-2 | (stopped) | plume-core at the axis (no inlet growth) |
| plain scheme (PRE=0, CFL 1.5), AMP 1e-3 | rho 0.907, p 0.928 | rho 0.829, p 1.005 | (stopped) | plume-core / upstream axis |
- The oracle reproduces the GPU numbers (1.510 at 100 = engine-stability's trace).
- **It is amplitude-dependent, so not a linear mode of the scheme about rest.** At 1e-6 nothing grows by 100 iterations, and the residual ratio between the two amplitudes is 361, not 1000, at 50 iterations.
- **It sits at the inflow boundary**, not at the lips, interfaces or far field: the upstream block's first cells beside imin (INFLOW, BC 4), moving towards the axis. (The upstream block is 42 x 97, x [-8.22, -0.80], r [0.015, 8.39]; imin inflow, jmin axis, jmax far field.)
- The plain scheme does not grow by 100.
- Working hypothesis (NOT yet tested). It is W2R-I12's beta jump at the inflow boundary.
  - Linearised at rest the inflow ghost is pressure-release: p0 = p_inf gives p'_b = -rho sigma^2 / 2, which is second order. The ghost velocity is the characteristic's sigma = max(0, -(p'_s / (rho c) + u_n,s)), with the physical rho c, not the preconditioned characteristics the far field got (D4-22).
  - With a 101 Pa wave the cell-to-ghost jump lifts beta^2 by its dp term in the first column (beta 2.7e-2, critic pass 10), while the interior stays at beta = M_cut = 0.003.
  - The face between them gets M_ref = (beta_L + beta_R) / 2, about 0.015. The interior cell then sits at beta / M_ref of about 0.2, under-damped, where SOLVER.md 10's 1D limit is about 0.5 to 0.6, below CFL 0.8.
  - At AMP 1e-6 the dp term is below minMach^2 everywhere, so there is no jump, and nothing grows.

NEXT (in order)
1. Confirm the hypothesis cheaply, with 300-iteration runs at AMP 1e-3, one at a time or at most 2 in parallel (the machine has ~1.6 GB free; each run is ~150 MB):
   - CFL 0.4;
   - MACHCUT = 1 and/or limiter smooth;
   - the inflow face remapped to the far field (`bcRemap: { 4: 3 }`) or given the preconditioned characteristics;
   - the beta^2 dp term off for faces to physical ghosts (or beta_face = min / max instead of the mean).
   Also log beta per cell in upstream i = 0..4 and beta / M_ref on their faces.
2. A power iteration about rest (renormalise U every iteration; the rest state is an exact zero). Use an isentropic start, so that the neutral, frozen entropy mode (delta eta is frozen to first order at rest) does not mask the result. Do it at small amplitude, where it is linear, and at 1e-3 with beta frozen from the 1e-3 state, to separate the linear beta-jump mode from the nonlinearity.
3. Pin the repro as an `it.fails` in the oracle unit suite (a coarse stand-in if 130k x 2000 is too slow for `npm test`: a small inflow + axis + far-field box at the same settings that shows the same growth). TDD commit first.
4. The pre-stated rule into SOLVER.md before any fix. Use D4-45's 2000-iteration window (W2R-N16). Then the fix and the rule. Then D4-62 (the 12.2 E/B derivation first, then the rows) and the gates.

GOTCHAS
- Kill only your own runs: `Get-CimInstance Win32_Process -Filter "Name='node.exe'"`, filtered on the command line containing `reports/scratch/r9`.
- The repro's wave is isothermal. Its entropy part (about 0.29 of the density amplitude) is frozen at rest, so max |rho'| should relax towards about 0.29 of the first, not 0.
- Self-brake usage was 51 % at the stop.

GATES
- Not run (no code changed since main 22655d3).
