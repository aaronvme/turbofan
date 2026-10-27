# Mutation scores (D3-13)

Stryker 10.1.1, vitest runner, `coverageAnalysis: perTest`, `ignoreStatic: true`, incremental per file (`reports/inc-<file>.json`), concurrency 6, the runner's default `related` test selection. Test set: `vitest.mutation.config.ts`, the fast core suites without the slow whole-engine transient files (`model.test.ts`, `modelPaths.test.ts`, `surgeRecovery.test.ts`). Each run was in the foreground, under 10 min, on 2026-10-26/27 at w2/followups 4d4ce90. Another builder was running, so timeouts are inflated by contention.

Columns:
- **killed**: a test failed.
- **survived**: covered by a fast test, nothing failed.
- **no fast coverage**: no test in the mutation set reaches the mutant. For `model.ts` these are the paths only the slow transients run. Never counted as killed.
- **timeout**: counted as detected by Stryker, listed separately because contention inflates it.
- **static**: reached only while a file is collected, ignored (D2-15).
- **score** = (killed + timeout) / (killed + survived + no fast coverage + timeout).

| File | Mutants | Killed | Survived | No fast coverage | Timeout | Static | Score |
|---|---|---|---|---|---|---|---|
| src/cycle/surgeDetection.ts | 36 | 31 | 4 | 0 | 0 | 1 | 88.57 % |
| src/cycle/greitzer.ts | 134 | 116 | 15 | 0 | 3 | 0 | 88.81 % |
| src/cycle/surgeSystem.ts | 220 | 136 | 75 | 4 | 4 | 1 | 63.93 % |
| src/cycle/boundedLeastSquares.ts | 314 | 206 | 69 | 9 | 28 | 2 | 75.00 % |
| src/cycle/partPower.ts | 187 | 72 | 40 | 0 | 12 | 63 | 67.74 % |
| src/cycle/model.ts | 1041 | 96 | 264 | 675 | 1 | 5 | 9.36 % (26.87 % of covered) |
| src/cycle/partPowerFit.ts | 0 | - | - | - | - | - | constants only |
| src/thermo/gas.ts, src/thermo/species.ts, src/cycle/componentMaps.ts, newton.ts, engine.ts, at.ts | | | | | | | **not run** (below) |

## Not run yet

- `gas.ts`: the run was stopped at the 10 min limit (214 mutants, the dry run alone 77 s). These functions sit in every solve's inner loop, so instrumenting them makes each cycle test tens of times slower.
- The other hot files (`componentMaps.ts`, `newton.ts`, `at.ts`, `engine.ts`, `species.ts`) were not started: the round stopped at the usage limit.
- Next: run them with `MUTATION_TESTS` set to their direct suites (e.g. `MUTATION_TESTS=tests/unit/thermo/**/*.test.ts` for src/thermo; the config reads it), or with Stryker line ranges (`--mutate src/cycle/engine.ts:1-300`). Each run should stay under 10 min.

## Survivors and what to do with them

- **surgeDetection.ts (4).**
  - Equivalent: the `lastPa === null` guard; without it the first sample gives a drop of -Infinity, which is never integrated.
  - Cheap to kill (next round):
    - the error-message text (assert `/must be > 0/`);
    - `>` vs `>=` at the rate threshold, with a sample at exactly 10/s (last 8, next 3, dt 0.0625 s);
    - `>=` vs `>` at the drop threshold, with exactly 0.1 (last 10, next 9).
- **greitzer.ts (15).**
  - 11 are equivalent:
    - the bisection's iteration count and `>`/`>=` boundaries;
    - `psi >= 0` at 0, where both branches give 0;
    - `slope <= 0` at 0, where both give Infinity;
    - the bracket start `2 * w` vs `2 / w`, since bisection converges either way;
    - the crossing-time offset `(i - 1)`, which cancels in the period;
    - `i >= n / 2`, `>=` vs `>` on the crossing, and `nc > 2`, which differ only by one sample or on an exact equality.
  - 4 are cheap to kill:
    - `Math.max` to `Math.min` for maxPhi (assert maxPhi > Phi_eq in the deep surge);
    - the period divisor `nc + 1` (check the period against crossings counted in the test);
    - the perturbation's direction, twice (a 4-step run must stay below Phi_eq).
- **surgeSystem.ts (75).** Mostly one test-design gap. `surge.test.ts` builds `compressionSystem(def)` at describe level, so Stryker maps none of its compression-system tests to those mutants (the D2-15 pattern). Fixes for the next round:
  - make it a lazy fixture;
  - add an independent numeric check of `ductVariables` (rho, phi, psi);
  - pin `hpcCubic`'s H and rms against residuals computed in the test;
  - assert that `engineGreitzerParams` puts the equilibrium at the requested flow.
  - The `stallRlineForLoss` bisection boundaries are equivalent.
- **boundedLeastSquares.ts (69).**
  - Defensive shape guards (`bad shape`, a singular pivot at exactly 1e-300) and `?? 0` / optional-chaining fallbacks that the solver's own callers never reach. Not worth a test each.
  - The forward-difference direction at the upper bound (`ui + step <= 1`) and the active-set signs are worth a direct test with a bound-touching quadratic (next round).
  - The 28 timeouts are loop mutants (`r--` and similar), detected.
- **partPower.ts (40).** The fit evaluation and reporting paths are reached by `partPower.test.ts`, but most of its assertions are on the fit outcome, not on each residual's normalisation. Not triaged one by one this round.
- **model.ts (264 survived, 675 no fast coverage).** As D3-13 expects, the FADEC, the shaft dynamics, the start sequence and the surge recovery are checked only by the slow transient files. The survivors are paths a fast test reaches (the constructor, `reset`, schedule building, through `surge.test.ts`'s margin test) without checking them. This file needs either a targeted run with the transient files included (hours at the current speed) or fast unit tests of the pure pieces: the lever schedule, `leverForNetThrust`, the accel limit and the recovery sequence factored out of the class. That is the main follow-up.
