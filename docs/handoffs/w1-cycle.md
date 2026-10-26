w1/cycle: DONE except mutation testing (partial: see MUTATION; it needs an orchestrator decision on cost). Every threshold (T1-T4, C1-C9) is green. C5 now starts at 15 % of rated takeoff thrust per D2-1 and takes 2.60 s. src/cycle branch coverage is 99.3 %. (from w1/contracts-fix @3969af7; previous pass @b4acf7f; HEAD = the commit that adds this file)

DONE, earlier passes (each "(TDD)" commit came first and failed)
- src/thermo: thermally perfect air and frozen Jet-A products from NASA 7-coefficient polynomials (GRI-Mech 3.0, Burcat). Provides cp, h, the entropy function, gamma, R, the T(h) and T(s,p) Newton inverses, and GAS_TABLES for the W2 WGSL generator. Test: tests/unit/thermo/gas.test.ts.
- src/cycle/maps + componentMaps.ts:
  - pyCycle ee7e161 maps (Apache-2.0, NOTICE), with a C1 Hermite lookup and pyCycle-style scaling.
  - The surge margin is taken at equal corrected flow.
  - Below the map: similarity laws (Gaudet & Gauthier GT2007-27193) and Stodola.
  - Test: maps.test.ts.
- engine.ts:
  - Design-point sizing (D1-2): the fan bypass PR of 1.537 closes thrust at the EEDB fuel flow. Sizing outputs A8 0.1852 and A18 0.9161 m².
  - Gas path: 6 unknowns, Newton with an FD Jacobian. solveSteady takes a fuel, N1, N2 or thrust spec.
  - groundIdle() runs a continuation down to idle; balances() is the C8 check.
  - Test: engine.test.ts.
- greitzer.ts (C9) and model.ts (createCycleModel):
  - Shafts: J dw/dt with LP 60 and HP 10 kg m² (estimates, derived in the header).
  - FADEC: one Wf/P3 integrator with a lowest-wins selector (N1 target, the 61 % N2 idle floor, N1/N2/EGT limiters) between the accel and decel schedules.
  - Sub-idle: a similarity model (Agrawal & Yunis 81-GT-202).
  - Start: a sequence with hung, hot and no-light-off flags.
  - Surge: a Greitzer episode.

DONE this pass
- 6b84dc0 (TDD) / f842817 / 012cc38 / 0ef1a6f: C5 per D2-1.
  - The test now starts from a stabilised 14.9 % of rated takeoff thrust. 33.73(b) starts the 5 s clock at not more than 15 % when there is no flight-idle stop. The 0.1-point margin under the ceiling means a settling residual can never put the start above 15 %.
  - The test checks that N1 moved less than 0.05 points over the last second before the lever moves. The lever then reaches maximum in 1 s (33.73(a)).
  - `leverForNetThrust()` in model.ts gives the lever for a steady thrust. It is the inverse of the FADEC's lever-to-N1 schedule, which is now the single function `leverToN1`.
  - RED: the time passed straight away, but displayed EGT went past the 960 C transitory limit. That is the "without overtemperature" part of 33.73(a), which the old test never reached because it failed on time first.
  - Fix, all in the FADEC; no threshold, inertia or bleed was touched. The EGT limiter gets rate feedback (TD 0.3 s, the same as the overspeed limiters). That derivative is filtered first-order with TF = TD/3 (Astrom & Hagglund, PID Controllers, 3.3). Without the filter, an EGT-limited steady point chattered 12 K under its target, because EGT follows Wf almost algebraically.
  - The EGT error scale goes from 300 to 150 K, because 2212e7f (TDD) adds a 33.73(a) check: a slam from ground idle with no surge and EGT under 960 C. It failed at 960.05 C and now passes at 958.3 C. 100 K would make the steady point chatter.
  - Tests: model.test.ts (C5, 33.73(a), leverForNetThrust); modelPaths.test.ts covers the EGT limiter settling on its target.
- 012cc38 / 2645274: branch coverage of src/cycle went from 80.2 % to about 99 %, without coverage-only tests.
  - New src/cycle/at.ts (checked indexing) replaces the silent `?? 0` / `?? []` fallbacks in componentMaps, newton, engine (solveSteady) and model. An indexing bug now throws instead of feeding a plausible 0 into a Newton solve. solveLinear also checks that A is square.
  - New tests in tests/unit/cycle/modelPaths.test.ts:
    - step() rejects bad inputs and time steps without advancing.
    - A 40 C day rebuilds the schedules, and the N1 limiter caps N1 at 103 %, with thrust under rated.
    - The N2 limiter works against a lowered redline, and so does the EGT limiter.
    - A slam decel rides the decel schedule without a flameout, then the idle floor takes over.
    - On a slam accel the selected loop goes accel schedule, then n1Target.
    - A definition without VSVs reports zero closure.
    - After a flameout, auto ignition relights at the 3 s light-off delay and recovers to idle. With the igniters off, the engine stays out and runs down.
    - Fuel cutoff gives shutdown and a monotonic run-down; the starter during the run-down re-enters a start.
    - Start aborts: releasing the starter while cranking, and fuel cutoff after light-off (a dry crank while the starter is held).
    - A surge cuts fuel at onset, shows a negative HPC margin, and ends after the episode.
  - New tests in tests/unit/cycle/numerics.test.ts: at, solveLinear (pivoting, singular, shape), and Newton's exits on a singular Jacobian, a non-finite line search (thrown or NaN), the maxStep cap and contract, and a flat spot.
  - engine.test.ts: an unlit combustor makes T4 fall below T3.
- 0d93ac3 (TDD) / 0d43dbb: greitzer equilibrium() only bracketed [0, 2W]. With a wide-open throttle it returned the characteristic's peak, which is not an equilibrium. It now doubles the bracket until it crosses the throttle line. criticalB is Infinity on the falling branch, as its doc already said. The surge parameters in use are unchanged.
- 0ef1a6f / 3670124, docs/ENGINE_FACTS.md:
  - C5 per D2-1, in the "Flight-idle N1" note and the 33.73 note.
  - D2-2: A8 0.1852 m² and A18 0.9161 m² are `estimate`, with their derivation. They replace the definition's placeholders only after w1/mesh merges; definition.ts is not touched.
  - D2-3: the EGT probe share of 0.35 is a calibrated `estimate`. Station 49.5 sits after LPT stage 1 of 4, and stage 1 does more than an equal share because the last stage is lightly loaded for low exit swirl. The rising mean radius pulls the other way and no split is published, which is recorded too.
  - The model-vs-published table is updated, including a 33.73(a) ground-idle slam row.
- ec51f27: the simulation tests' describe timeouts are 600 s; a 120 s one failed under Stryker.
- D2-10: `source: 'model'` was already set (model.ts), and model.test.ts asserts it.

THRESHOLDS (measured on this HEAD)
- T1 cp air: max 0.162 % at 1000 K (300 / 500 / 1500 K: 0.131 / 0.141 / 0.065 %). Limit 0.5 %: pass.
- T2 gamma: max 0.054 %: pass.
- T3 products: max 0.211 % at 2000 K (1000 / 1500 K: 0.144 / 0.001 %): pass. The reference is JANAF species mixed the CEA way, not a CEA run.
- T4: max 2.0e-15. Limit 1e-6: pass.
- C1 thrust 4.6e-10, C2 BPR / OPR / airflow 0, C3 TSFC 1.0e-5 relative. Limit 3 %: pass (the sizing closure is exact).
- C4 ISA ground idle: N1 20.54 %, N2 61.00 %, EGT 319.1 C displayed, thrust 1.0 % of takeoff: pass.
- C5: 2.60 s from 14.9 % to 95 %. Peak displayed EGT 946.5 C, min HPC surge margin 0.106, no surge. Limit 5.0 s: pass.
  - For information, from ground idle (33.73(a), no time limit): 95 % at 5.22 s, peak 958.3 C, min margin 0.025.
- C6 at the 30 C corner: 922.5 C displayed, N1 103.44 %. Limit 950 C: pass.
- C7: 16-point sweep, max 7 iterations, max residual 7.2e-12: pass.
- C8: max imbalance 3.4e-11: pass.
- C9: B 1.0 > B_crit 0.661 gives deep surge (min Phi -0.039) with a period +17.4 % of the Helmholtz period (limit 20 %). B 0.5 recovers (amplitude 5e-14): pass.

MUTATION (Stryker 10.1.1, stryker.config.mjs unchanged): NOT COMPLETE, and no survivor has been killed yet
- Run 1: `npm run mutate -- --incremental --concurrency 12` over all 14 files (2271 mutants). The dry run failed because the C5 test timed out at 120 s under instrumentation. Fixed in ec51f27 (600 s).
- Run 2: `npx stryker run --incremental --concurrency 8 --dryRunTimeoutMinutes 90 --mutate "src/thermo/**/*.ts,src/cycle/at.ts,src/cycle/newton.ts,src/cycle/greitzer.ts"` (549 mutants).
  - 394 of the 549 are static (72 %).
  - The dry run took 19 min.
  - I stopped it at 292/549 after 65 min. It still estimated about 2 h, and the shared 5-hour usage was at 74 %.
  - At the stop: 33 survived and 7 timed out, so 259/292 = 88.7 % were detected. That figure covers the tested part only and is not a score.
  - Stryker writes the survivor list and the incremental file only at the end, so there is no per-file report and no reports/stryker-incremental.json.
- componentMaps, engine and model: not run.
- DECIDE how to make mutation testing affordable on the cycle code:
  - (a) a quiet multi-hour window running `npm run mutate -- --incremental --dryRunTimeoutMinutes 90`;
  - (b) `--ignoreStatic`, which scores only the non-static mutants and drops most of thermo/engine/componentMaps, because the import-time sizing runs them;
  - (c) a lazily built reference engine instead of the REFERENCE_ENGINE constant, so perTest coverage maps each mutant to the tests that use it (an API change other branches import);
  - (d) a second Stryker config with a fast test subset for thermo and the numerics.

NEXT
1. Mutation testing at a usable cost (see GOTCHAS), then kill the remaining meaningful survivors.
2. After w1/mesh merges (D2-2): put A8 0.1852 / A18 0.9161 into definition.ts (PLUG_R_AT_CORE_LIP, COWL_R_AT_FAN_NOZZLE) and the bypassNozzleArea fact row, then update designPoint.test.ts expectations.
3. FADEC tuning found while writing the limiter tests (none is a threshold):
   - A slam decel from takeoff undershoots the idle floor to N2 58.5 % (below the 60 % idle minimum) for about 3 s before settling. The idle-floor loop runs at K_LOOP; a 4x gain only brings the undershoot to 60.0 %.
   - On a slam to an N2 redline set 1 % under the takeoff N2, the N2 limiter overshoots the redline by up to 0.85 % (0.2 % with TD_LIMIT 0.5). A 10 s lever advance stays under it. The reference redline is 5 % above takeoff N2, so it is not reached in practice.
   - The Wf/P3 integrator winds up to the accel schedule while the engine is unlit in run mode (a flameout with the igniters off), so a relight would start rich.
   - egtExceedance compares against the 950 C redline. The ground-idle slam peaks at 958.3 C for about 1 s, which TCDS VI note 4 allows (960 C for 20 s), but the flag fires.
4. Still open from the earlier pass:
   - a thermocouple lag on EGT (the contract pins egtMeasured = T49.5);
   - VBV and TBV fed to the gas path;
   - a combustion-efficiency drop at idle;
   - customer bleed from stage 5/9;
   - shutdown -> 'off' (N2 < 1 rpm is never reached: the viscous friction time constant is about 570 s and there is no Coulomb bearing term).

GOTCHAS
- Stryker on this code is slow:
  - REFERENCE_ENGINE is sized at import, so every mutant in thermo, engine or componentMaps code reached by the sizing is "static" (72 % of the thermo+numerics set) and runs the whole suite.
  - The instrumented dry run of the unit suite takes about 19 min, so the default 5-minute dryRunTimeoutMinutes fails. Pass `--dryRunTimeoutMinutes 90`.
  - Use `--incremental` (reports/stryker-incremental.json) so a re-run re-tests only what changed.
- The model's n1Percent is relative to the definition's 100 % speed (5175 rpm). The design point is 101 % (5227 rpm).
- Idle EGT is about 150 K under the measured ground run: the model has no customer bleed, accessory load or VBV flow at idle.
- StationState cannot express reverse flow, so station 3 W shows 0 during a Greitzer episode while Phi < 0. This is a contract question.
- Each CycleModel reset or ambient change runs about 25 steady solves (0.1-0.3 s); leverForNetThrust runs about 10.
- The cycle tests take about 45 s plain. The whole suite takes about 150 s under coverage.
- No new dependencies. No dev server, Chrome or GPU device was started. Scratch scripts live outside the repo.

GATES @8de6587 (this commit adds the handoff only)
- npm test: 1036 passed / 0 failed / 0 skipped (36 files, 62 s).
- npm run lint: clean (eslint --max-warnings 0, prettier). npm run typecheck: clean.
- npm run coverage: all 1036 tests pass, and every threshold passes.
  - Overall: lines 99.53 %, statements 98.58 %, branches 90.05 %, functions 99.85 %.
  - src/cycle: lines 100 %, branches 99.3 %, statements 99.9 %, functions 100 %.
  - src/thermo: lines 100 %, branches 87.5 %.
- npm run mutate: partial (see MUTATION).
- The gitignored .stryker-tmp/ sandbox from the stopped run is still in the worktree. No Stryker, vitest, dev-server or Chrome process is left running.
