w2/reference-9: STOP-CLEAN at the self-brake (test:ladder not run). D4-63 diagnosed (the round-8 hypothesis refuted), pinned and its rule stated; no fix (it is a scheme change: decision needed); D4-62's 12.2 tolerances written. (From main 22655d3; HEAD = the commit of this handoff.)

DONE
- 3de1b43 (TDD) the D4-63 repro on the 130k asset as a ladder case: `tests/ladder/cases/d463.ts` (the engine default, the 0.1 % wave of engine-stability.test.ts, 2000 iterations, checkpoints every 100) and `tests/ladder/d463.test.ts`: a passing signature (finite, max |p'| < 100x its first) beside the rule as `it.fails` (D4-65's split form, one shared run).
- ac52db7 SOLVER.md 10, "D4-63, the rest state on the engine mesh": the checks, the diagnosis and the pre-stated rule (below).
- e1436e2 SOLVER.md 12.2, D4-62: the f32 error-model derivation, then the flux-scale rows B <= 2e-10, E-L5 <= 3e-7, E-L9a <= 3e-11 (10x the measured GPU errors 1.27e-11 / 2.67e-8 / 2.46e-12, rounded up; was 1e-3). Tightening only; SOLVER.md only.

DIAGNOSIS (D4-63; numbers in SOLVER.md 10)
- The oracle reproduces the GPU: max |rho'| / first 1.51 at 100, 10.4 at 1000, 13.6 at 2000; residual 12.4 -> 129.
- Refuted: the inflow ghost's beta jump / face M_ref / physical rho c characteristic. Where the max sits the column has beta 0.03-0.06 and beta / M_ref 0.82-1.08 (no jump). On the upstream-block stand-in (engine numbers to 4 digits at 100) the inflow remapped to the far field, a preconditioned inflow characteristic, the dp term blind to physical ghosts and face beta max/min all change max |p'| at 200 by <= 5 %. CFL 0.4 follows CFL 0.8 in pseudo-time: semi-discrete, so a step limit cannot help.
- Part 1, nonlinear (amp 1e-3, preconditioned): the dp-lifted beta gives pseudo-velocities 5-15 m/s; the radial wave focuses on the axis (20x at 270 upstream, 12x at 600 in plume-core) and deposits entropy, frozen at rest (rho' 13.6x against p' 8x at 2000). In the upstream block alone the pulse decays (0.23 at 2000).
- Part 2, linear (amp 1e-6, and the plain scheme at 1e-3): max |p'| 2.8-4x and the residual x6-7 by 1000 in the core duct (x 0.6-1.6 m), no entropy. Transient or slow mode: open (round 8's "1e-6 does not grow" stopped at 100).
- No fix ran: none of the brief's local remedies reaches either part. A remedy is a scheme change -> decision.

THE RULE (SOLVER.md 10, stated before any fix)
- Adopt a D4-63 fix only if (1) the d463 case keeps max |p'| <= 2x its first over 1000-2000, the residual over 1000-2000 <= its value at 100, finite; and (2) every passing row still passes (L1-L7, L8 velocity + steadiness, L9 values, 12.1/12.2).
- Outcome now: fails (1) (late max 8.0x, residual 10.4x). The plain scheme fails it too (3.3x at 1000, residual 6.7x), so the bound goes to the orchestrator.

DECISIONS NEEDED
- (a) D4-63's remedy, a scheme change: candidates are a beta^2 rule without the dp-driven nonlinearity at rest (or a larger floor: minMach 0.02 cut the stand-in's focus from 5.4x to 2.3x), and, for part 2, the plain scheme's core-duct behaviour (first: a power iteration about rest on the 130k mesh, the N13 method).
- (b) Whether the rule's 2x late bound stands, given that the plain scheme fails it.
- (c) D4-62's GPU side: the solver round applies the new rows (below).

KERNEL MIRROR (for w2/solver)
- No kernel change: the oracle's scheme is unchanged this round.
- D4-62: `tests/gpu/oracle.test.ts` E-L5 / E-L9a `fluxScaleError` against 3e-7 / 3e-11 (in place of TOL_RESIDUAL 1e-3 and E-L5's 1e-6); `tests/gpu-ladder/ladder.test.ts` B's residual row against 2e-10.
- D4-63: when a fix is decided, its oracle change is mirrored in WGSL and the GPU engine-stability test gets the d463 rule.

NEXT
1. The orchestrator's decisions (a)-(c).
2. The power iteration about rest on the 130k mesh, amplitude-independent (isentropic start, renormalised), to settle part 2.
3. Carried: W2R-I9/I10/I12, N15-N19 (pass 9/10).

GOTCHAS
- Scratch (gitignored, on disk): reports/scratch/r9/{grow2.ts, standin.ts, ref/ (switchable oracle copy: R9_BETA nophys|noin, R9_FACE max|min, R9_INFLOW pre), logs/}. Run from the worktree root with `node --import ./tools/mesh/ts-resolve.mjs`. 130k: ~240 ms/it alone, ~800 with three runs; the stand-in: ~14 ms/it.
- The d463 ladder case runs 2000 iterations on 130k: ~6-8 min alone in test:ladder.
- max |rho'| mixes entropy (frozen at rest) and acoustics; grow2.ts prints the entropy part rho' - p'/c^2 separately.

GATES @eb5f92b (src/ unchanged since main 22655d3; this round adds tests/ladder d463 and SOLVER.md text)
- npm run typecheck: clean
- npm run lint: clean (ESLint --max-warnings 0, Prettier)
- npm run coverage: 99 files passed; 1917 passed / 11 expected fail; thresholds met (exit 0)
- npm run test:mesh: 2 files, 29 passed
- npm run test:ladder: NOT RUN (self-brake at 82 % usage; STOP-CLEAN). The new d463 case is the only change to it: run it first (`npx vitest run -c vitest.ladder.config.ts tests/ladder/d463.test.ts`, ~6-8 min); expected: the signature passes and the it.fails rule fails as pinned (the scratch run of the same computation: late max |p'| 8.0x, residual 10.4x its value at 100).
