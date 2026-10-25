# Critic findings log

Every critic pass appends here. Each critic reads this file first. Finding IDs are `<wave><branch letter>-<severity><n>` (severity B = blocking, I = important, N = nit), e.g. `W1C-B1`. States: OPEN / FIXED (commit) / WONTFIX (reason). Each pass ends with a verdict: **MERGE** or **FIX FIRST**. Orchestrator decisions are logged as `D<pass>-<n>`.

Never quote personal data (emails, keys, tokens) in this file.

## W0 orchestrator decisions: 2026-10-24

- **D0-1 GPU timing protocol.** The Arc 140T is integrated: it shares memory bandwidth and the power budget with the CPU, so concurrent agents (installs, test runs) or battery power depress GPU timings. Every performance number (P1-P3, L13) is measured on AC power with no other agents, builds or tests running, Chrome in the foreground, 10 s warm-up, then the median of 3 runs of 60 s, with the conditions recorded in GPU_FACTS.md. A downgrade (e.g. P1 below 150 it/s -> ~80k cells) needs a quiet re-run first. The spikes builder writes the benchmark; the orchestrator schedules the timed run in a quiet window.
- **D0-2 Threading spike.** CPU threads do not speed up the GPU-bound solver (WebGPU has one queue), but moving simulation and rendering off the main thread can stop React updates from causing dropped frames. Spike (d): three r186 WebGPURenderer plus a raw compute pass in a dedicated Worker on an OffscreenCanvas, versus the same scene on the main thread, measuring frame-time p50/p95/p99 while the main thread runs a synthetic React load; it also records which three features fail in a worker. Until the decision, contracts keep the sim/UI boundary thread-agnostic: the UI reads immutable state snapshots and sends commands as messages, never touching sim objects directly. Audio stays on its AudioWorklet thread either way.
- **D0-3 Power plan for official timings (Aaron, 2026-10-24: "i can switch to beest performance later").** The laptop runs the Windows "Balanced" plan. The official P1 run happens on Balanced first, as a lower bound: if it clears 150 it/s there, it clears it on Best performance too, so W0 does not wait. If it falls short, no downgrade is decided until a re-run after Aaron switches to Best performance. Every timing records the active power plan.
- **D0-4 Render-texture encoding (w0/contracts question 1): accepted.** The render textures store gauge ratios (p − p∞)/p∞ and (ρ − ρ∞)/ρ∞, not p/p∞: at 1.0 an f16 resolves only ~1e-3 (~100 Pa), which would erase far-field and schlieren detail, while near 0 it resolves far finer and the peak (~30) is well inside f16 range. Consistent with the solver's gauge variables.
- **D0-5 C3 TSFC target (w0/contracts question 2): accepted.** C3 checks against the ICAO emissions databank-derived takeoff TSFC (entry 8CM066: fuel flow / rated thrust, ISA SLS certification data), 1.0648e-5 kg/(N·s) = 0.376 (lb/h)/lbf, marked `estimate` (derived). Aviation Week's 0.386 is recorded beside it in ENGINE_FACTS.md (+2.7%).
- **D0-6 Elliptic smoothing off for W0 (w0/mesh-spike): accepted provisionally.** The plan said TFI + elliptic smoothing; the builder found smoothing moved the fixed singular corner points (P1, P2, O; evidence in docs/MESH.md D3) while plain TFI with tuned distributions already meets every requirement test (stretch ≤ 1.137, skew ≤ 46.5°, all Jacobians > 0). W1's mesh builder may reintroduce corner-constrained smoothing if the real flowpath needs it. The critic checks the evidence.
- **D0-7 Physical-time step (w0/mesh-spike): accepted.** The HPC-rear cells limit the explicit physical-time step to ~1.4 µs at 130k (~1.6 µs at 80k), below the plan's ~2 µs. It affects only physical-time mode (slow-motion bangs, ~30% more wall time per simulated ms); tracking mode uses local time stepping.

## Critic pass 1: w0/contracts @e51aff1

Reviewed 2026-10-24 by the pass-1 critic: `src/contracts/*`, `src/engine/{bladeDesign,designPoint,definition,facts}.ts`, `src/mocks/*`, all of their tests, ENGINE_FACTS.md and the PHYSICS.md diff. Checklists applied: typescript-reviewer, silent-failure-hunter, pr-test-analyzer, security-review (no network, eval, storage or secrets in scope; nothing found). Probes are in `docs/reviews/probes/` (`w0c-contracts.probe.ts.txt` pins I1, I2, I3, N2 and N5; `w0c-definition-dump.probe.ts.txt` prints the synthesized rows). Run them as the config header says.

**Gates (rerun in the builder worktree):** `npm test` 718 passed / 0 skipped (17 files). `npm run lint` clean. `npm run typecheck` clean. `npm run coverage`: lines 99.75 %, statements 97.49 %, branches 93.45 %, functions 99.63 %. These match the handoff, and the tracked files are unchanged.

**Mutation testing** (Stryker 10.1.1, perTest, mutate = `src/contracts/engine.ts` and `src/engine/bladeDesign.ts`, 6 min 18 s): 1238 mutants, score 79.16 % in total.
- `engine.ts`: 77.63 % (776 killed, 5 timeouts, 213 survived, 12 without coverage).
- `bladeDesign.ts`: 85.78 % (197 killed, 2 timeouts, 32 survived, 1 without coverage).
- Many survivors are equivalent: `<` vs `<=` at a 1e-9 tolerance, unreachable `undefined` guards under `noUncheckedIndexedAccess`, and the 31 string-literal mutants on messages.
- The ones that matter are listed in I4. I spot-checked two "survivors" by hand-applying them (engine.ts:579 and :583). Both were real sub-expression mutants, and the suite catches the whole-condition variants. Stryker's vitest runner ran the 246 tests related to these files, not all 718.

**Plumbing checks:**
- `thresholds.ts` mirrors PHYSICS.md §3 verbatim. thresholds.test.ts parses the doc for IDs, order, the Check/Pass text and every typed token, and §3 is byte-identical to main.
- The sim/UI boundary is plain data: `findNonPlainData` runs plus `structuredClone`, then `deepFreeze` in `nextSnapshot`, and the probe confirms that mock states and ENGINE_DEFINITION pass. A NaN throws rather than slipping through.
- The mocks carry `label: 'MOCK'` and use the D0-4 gauge encoding: an engine at rest encodes as exact zero bits, which mockFlowField.test.ts checks.
- `rotation` is -1/-1, which matches NTSB "rotates clockwise (aft looking forward)" in the +x-downstream frame.
- Blade counts and angles are plausible: 24 fan blades, HPC R1 35 blades, HPT NGV 47 and rotor 75, compressor rotor angles positive, HPT rotor turning about 120°, NGV exit -76° at Mach 1.02. The flowpath proportions fit the TCDS envelope.

**Figures verified against their sources** (fetched 2026-10-24; copies in the OS temp dir, not in the repo):
- **[TCDS] E.004 Issue 07:**
  - thrust: 12143 daN take-off and 11521 daN max continuous for -7B27/3; dry weight 2386 kg (TI);
  - dimensions: 2508 / 2118 / 1829 mm;
  - stages: 1 fan, 3 LPC, 9 HPC, 1 HPT, 4 LPT;
  - speeds: N1 5382 rpm (104 %), N2 15183 rpm (105 %); 10022 rpm (69.3 %) and 8500 rpm (58.8 %);
  - EGT: 950 / 925 / 725 °C displayed, measured at T49.5 (stage-2 LPT nozzle); +30 °C shunt for TI non-/F, ramped over 8300-8500 rpm N2; note 4, 960 °C for 20 s; trim 0 for -7B27/3;
  - III.10 bleed limits: 2 %, 10 %, 12/7 %, 13/10 %;
  - note 2: 100 % ram recovery.
- **[EEDB] v32:**
  - 8CM066: BPR 5.1, PR 29, 121.4 kN, fuel flow 1.293 / 1.031 / 0.343 / 0.110 kg/s;
  - 3CM034: 5.0, 28.63, 1.284.
- **[NTSB] AAR-19/03 §1.3.1:** 24 fan blades, about 11 in chord, about 10.83 lb, and "The engine rotates clockwise (aft looking forward)".
- **[FICHE] (March 2011, archive):** 27,300 lbf, 86 °F flat rating, airflow 792, BPR 5.10, max-climb thrust 5,960 lbf, max-climb OPR 32.70, length 103.50 in, fan 61 in.
- **[WIDURI] (AVITEC 8(1) 2026, exists, DOI matches):**
  - Table 1: idle N1 20-22 %, N2 60-62 %, EGT < 500 °C;
  - Table 3: 25 °C, 1008 hPa, 14 ft;
  - Table 5: fuel on at 25 % N2, cut-out at 56 %, peak EGT 492 °C, start time 60 s;
  - Table 7: idle 20.5/21.0 % N1, 60.6/60.7 % N2, 466/493 °C; MPA 65.0 / 89.3 / 585; take-off 97.4 / 99.8 / 855.
- **[CFR] 33.73:** text matches (15 %, 95 %, 5 s, Amdt. 33-1).
- **Derived values reproduce:** TSFC 1.293/121430 = 1.0648e-5 kg/(N s) = 0.3759 (lb/h)/lbf; 5382/1.04 = 5175 rpm; 15183/1.05 = 14460 rpm.
- **Not re-verified:** [AW08] (paywalled) and [CFMWEB] (cross-check rows only, as the builder says). Every `unknown` row states its assumption.

### Blocking
None.

### Important
- **W0C-I1 OPEN: `nextSnapshot` lets the parts overwrite `version`.**
  - Where: `src/contracts/sim.ts:185-191`. `{ schemaVersion, version, ...structuredClone(parts) }` spreads the parts last.
  - Failure: `SnapshotParts` omits these keys only at the type level, and excess-property checks do not apply to spread members. So `nextSnapshot(prev, { ...prev, cycle })`, the natural way to update one part, compiles and freezes `version` at the previous value forever. The probe shows 1, 1, 1.
  - Consequence: every consumer that de-duplicates snapshots by `version` (D0-2) then drops all updates.
  - Fix: stamp `schemaVersion` and `version` after the spread, or destructure them away, and add a test that passes a full snapshot as parts.
  - Allowed after merge: there is no consumer before W2. Fix it before the W2 app loop.
- **W0C-I2 OPEN: "always" outcomes pass vacuously.**
  - Where: `src/contracts/scenario.ts:177-180` (`decide`) and `:205-214` (`finalizeOutcomes`).
  - Failure 1: an `always` outcome passes when the first snapshot at or after `toS` arrives, even if no snapshot ever fell inside `[fromS, toS]`.
  - Failure 2: `finalizeOutcomes` passes every pending `always` outcome with no snapshots at all. A broken pipeline that never publishes then makes "EGT below the redline throughout" (C6) pass. The probe shows both.
  - Fix: count the in-window samples per outcome and pass only if there was at least one, else fail with "never sampled". Test both cases.
  - Allowed after merge: fix before W3 scenarios or any scenario-driven Vitest/Playwright check.
- **W0C-I3 OPEN: MOCK provenance does not cross the D0-2 boundary.**
  - Where: `src/mocks/mockCycle.ts:47-50` and `src/mocks/mockFlowField.ts:41`. The label exists only on the model object and on `MockCpuFlowField`.
  - Gap: `CycleState`, `SimSnapshot` (`sim.ts`) and the GPU `FlowField` (`flow.ts:264`) carry no source.
  - Failure: under D0-2 the UI reads only snapshots, so it cannot show the MOCK badge the mock headers require. The probe finds no "MOCK" in a snapshot built from `mockSteadyState`. Once W2 uploads the mock raster into a `FlowField`, its label is gone.
  - Fix: add `sources: { cycle: 'mock' | 'model'; flow: 'none' | 'mock' | 'solver' }` to `SimSnapshot` (bump `SIM_SCHEMA_VERSION`) and a `source` field to `FlowField`. Put it on the snapshot, not in `CycleState`, so W1's cycle model is unaffected.
  - Allowed after merge: W2, the first UI consumer.
- **W0C-I4 OPEN: validator and blade-design branches with no negative test** (the surviving mutants that matter).
  - `engine.ts`, checks no test exercises:
    - nacelle trailing-edge mismatch (`:368-376`: the push itself is removable);
    - core-lip `cowl.r < casing.r` (`:382`);
    - unknown hub/casing curve and hub not covering its component (`:438-452`);
    - duplicate station (`:481`);
    - rotor without spool (`:542`);
    - blade edge below the hub (`:579`);
    - edge hub r >= tip r (`:589`);
    - chord not finite or <= 0 (`:597`, `:602`);
    - empty row id (`:634`);
    - axial row overlap (sorting and the comparison mutate freely, `:641-652`);
    - duplicate VSV schedule and a one-point schedule (`:666-668`);
    - duplicate bleed, bleed on an unknown component, and `maxFraction <= 0` (`:681-690`);
    - efficiencies outside (0, 1] (`:722`);
    - combustor loss and cooling-fraction ranges (`:726-735`);
    - EGT positivity (`:765`), shunt fields (`:775-779`), start-schedule ordering (`:786-790`), empty name (`:805`).
  - `bladeDesign.ts`: the swirl-exceeds-enthalpy throw (`:70`) and Carter's "no solution" throw (`:190`).
  - Failure: W1 (geometry, mesh adapter, cycle) edits or derives definitions, and a regression in any of these checks would pass the suite.
  - Fix: one negative case per check, in the `validators.test.ts` / `engine.test.ts` pattern.
  - Allowed after merge: fix in W1, by a short contracts follow-up or by w1/mesh (the first heavy consumer).
- **W0C-I5 OPEN: no failure channel for the solver in the snapshot.**
  - Where: `FlowStatus` (`sim.ts:61-65`) has only `available: boolean`. `FlowStepStats.residualDensityL2` (`flow.ts:62`) is `number | null`.
  - Failure 1: a device loss, a WGSL validation error or a divergence has nowhere to go (CLAUDE.md: surface, never swallow).
  - Failure 2: a single NaN residual makes `nextSnapshot` throw (`findNonPlainData` rejects non-finite numbers). One bad solver number would stop snapshot publication for the cycle and the UI as well, instead of being reported.
  - Fix: `FlowStatus.status: 'unavailable' | 'initialising' | 'running' | 'diverged' | 'lost'` plus `error: string | null`. The solver maps a non-finite residual to `diverged` and null.
  - Allowed after merge: W2.
- **W0C-I6 OPEN: design-point EGT 931 °C (the builder's flag).** My assessment: **W1 calibration, not contracts**, with two conditions.
  - The arithmetic:
    - The estimate gives T49.5 = 1174 K, so 931 °C displayed at ISA SLS.
    - Widuri's 855 °C was measured on a 25 °C day; corrected to ISA with EGT/θ (the mock's own correction) it is about 817 °C, so the estimate runs about 114 K hot.
    - At the 30 °C flat-rating corner the same EGT/θ scaling gives about 994 °C, above the 950 °C redline.
  - Why W1: the inputs that set the EGT (η, cooling, T4, FPR split) are all `unknown` model assumptions, and the definition only uses the estimate to size A8/A18 and set the velocity triangles.
  - Condition 1: A8 = 0.1778 m² and A18 = 0.9067 m² are frozen into the flowpath (`definition.ts` `PLUG_R_AT_CORE_LIP` and `COWL_R_AT_FAN_NOZZLE`). The W1 cycle must calibrate with A8/A18 held, the normal practice. Changing them would move geometry under w1/mesh and w1/geometry, so that needs a logged decision.
  - Condition 2: C6 does not say at which ambient the take-off EGT is judged. The orchestrator should pin it (see the decisions needed below).
  - Allowed after merge: W1.

### Nits
- **W0C-N1 OPEN: wrong TCDS section numbers** (values correct).
  - `ENGINE_FACTS.md:30-31` cite "I.6 Ratings", `:53-57` "I.2", `:58-61` "I.4" and `:62` "I.5". The sections are III.6, III.2 (Description), III.4 and III.5.
  - Same in the test name at `tests/unit/engine/definition.test.ts:134`.
- **W0C-N2 OPEN: f16 overflow is silent.** `flow.ts:291-298`: `rasterizeField` checks f64 finiteness, but |v| ≥ 65520 encodes as ±Inf with no error (probe). Check `|v| <= HALF_MAX` and throw.
- **W0C-N3 OPEN: shaft-speed sign is undocumented.** `FlowTargets.n1RadPerS/n2RadPerS` (`flow.ts:42`, `:381`) are magnitudes from rpm, while blade design uses a signed ω and `StationReduction` torques are "sign about +x". Document "unsigned; multiply by `definition.rotation`" so that W3 body forces do not drop the sign.
- **W0C-N4 OPEN: silent non-convergence in blade design.** `bladeDesign.ts:196` and `:209`: the fixed-point and count loops end after 200 and 10 passes without saying whether they converged. The surviving mutants 200:60, 203 and 211 show the convergence test has no observable effect. Throw when not converged.
- **W0C-N5 OPEN: small validator gaps.**
  - A VSV schedule's closure sign and range are unchecked (`engine.ts:669`); the probe accepts -2 rad.
  - `validateCycleState` does not check `egtMeasuredK === stations['49.5'].ttK` or that `flags` are booleans.
- **W0C-N6 OPEN: `mockCycle.step` edge cases.** At `:620-622`, dt is unbounded (n = ceil(dt / 0.02) substeps, so a huge dt hangs), and `dt === 0` returns before storing new inputs (inputs sent while paused are dropped). Mock only.
- **W0C-N7 OPEN: the thread-agnostic claim needs a caveat.** `sim.ts:3` says the same code runs on the main thread or in a Worker. True for cycle and snapshots, but `FlowSolver.fields()` returns `GPUTexture`s, which cannot cross threads, so the solver has to live on the render thread. Say so before the D0-2 spike result lands.
- **W0C-N8 OPEN: booster IGV inlet conditions.** Uniform-work free vortex behind the fan (FPR core 1.5) gives 44° swirl and Mach 0.84 at the booster IGV inlet, with a 43° IGV turning, also as the handoff says. W1 calibration could lower the fan-root work (lower core FPR, higher booster PR) so the IGV and its body force start subsonic. Representative geometry, not a fault.
- **W0C-N9 OPEN: `findNonPlainData` edge cases.** It visits non-enumerable own properties, which `structuredClone` drops, and ignores extra non-index keys on arrays. Harmless today.

**Verdict w0/contracts @e51aff1: MERGE.** No blocking items. I explicitly allow the Important items after the merge: I4 and I6 in W1; I1, I3 and I5 before the W2 app/UI work that consumes them; I2 before W3 scenarios. The nits can go to any later contracts touch.

**Orchestrator decisions needed (contracts):**
- (a) C6 ambient: ISA SLS only, or also the 30 °C flat-rating corner. See I6; the current estimate would fail the corner.
- (b) Confirm that W1 calibrates with A8/A18 held fixed.
- (c) Who fixes I1-I5. One small contracts follow-up is cheaper than spreading them across W1/W2 builders.
