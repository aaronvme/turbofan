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

## Pass-1 orchestrator decisions: 2026-10-24 (on the critic's questions a-f)
- **D1-1 (a):** C6 (takeoff EGT below the redline) is judged at the flat-rating corner, 30 °C SLS takeoff, the hottest certified takeoff point; EGT margin is conventionally quoted there.
- **D1-2 (b):** A8/A18 are outputs of the W1 design-point sizing (standard engine-deck practice), then held fixed for off-design; the definition's current values are placeholders, replaced by the sized values (marked `estimate` with the derivation).
- **D1-3 (c):** yes: a small contracts fix round for W0C-I1..I5 runs before W1 builders depend on those contracts.
- **D1-4 (d):** a mesh-side adapter (tools/mesh) closes blunt trailing edges into knife edges for the solver geometry; `EngineDefinition` keeps the true thickness for rendering. w1/mesh also fixes the 1.39 stretch at the plug tip.
- **D1-5 (e):** D0-6 reads: smoothing keeps the singular corner points pinned but degrades the cells around them; the evidence is real and the decision stands.
- **D1-6 (f):** w1/mesh's brief adds station planes and a station map; its first task is the W0M-I2/I3 test gaps, before any retuning.
- Merged w0/contracts and w0/mesh-spike (MERGE). The suite was not rerun on main after the merges (usage cap); the critic's trial merge of the same pair gave 833 passed with all gates green. Rerun at the next start.

## W1 orchestrator decisions: 2026-10-25 night (Aaron away; autopilot)
- **D1-7 (w1/mesh):** at the final real-geometry resolution the explicit physical-time step is ~1.22 µs at 130k (D0-7 said ~1.4 µs). Accepted; physical-time mode only.
- **D2-1 (w1/cycle C5 at 5.16 s):** the test start point was wrong, not the threshold. 14 CFR 33.73(b) starts the 5 s clock at flight idle, or at ≤ 15% of rated takeoff thrust when there is no flight-idle stop (ENGINE_FACTS `accelStartMaxThrustFraction`); the builder started from ground idle, which is harsher than the rule. The C5 test starts at 15% of rated takeoff thrust. The ≤ 5.0 s threshold is unchanged. If it still fails, revisit the transient bleed model and the spool inertias (both estimates), with justification.
- **D2-2 (sized nozzle areas):** the design-point-sized A8 = 0.1852 m² and A18 = 0.9161 m² replace the definition's placeholders (one source of truth, D1-2), applied after w1/mesh merges; then regenerate the mesh (`npm run mesh`) and rerun its requirement suite.
- **D2-3 (EGT probe fraction 0.35):** accepted. It models station 49.5 sitting after LPT stage 1 of 4, with stage 1 doing more than an equal share of the LPT work (typical). Recorded in ENGINE_FACTS as a calibrated `estimate`, not a thermocouple error term.

- **D2-4 Threading (D0-2 decided): simulation + rendering run in a dedicated Worker on an OffscreenCanvas; the React overlay stays on the main thread.** Official worker runs (2026-10-25 22:47, D0-1 protocol, Balanced, AC, no agents): at a realistic 15 Hz React load neither drops frames, but main-thread rAF delay p99 is 10.0 ms vs 0.3 ms in the worker; at a heavy 60 Hz load the main thread has 177 long frames per run vs 60 in the worker. W2 adopts the worker with the three.js workarounds the spike found (ImageBitmapLoader, an OrbitControls event proxy, `setSize(w, h, false)`, DPR/resize from the main thread). The sim/UI boundary stays message-based (contracts already comply).
- **D2-5 P1 official: PASS, 16x8 tiles.** Clean rerun (2026-10-25 22:18, Balanced plan + mode, AC, no agents, 2.5 GB free RAM): 130k cells 16x8 = 299 it/s (1.277 ms/it), 8x8 = 265, 32x4 = 251, all at 60 fps; 80k ≈ 384-427; 256k ≈ 121. The earlier halving (run 1) came from a game sharing the GPU, not throttling. The first config of the run (80k 16x8) reported 5 it/s with frame p99 1017 ms despite a normal 1.33 ms/it GPU time: a harness warm-up bug for critic pass 2 to confirm and the gpu-spikes fix round to fix. JSON: w0/gpu-spikes `docs/bench/*-official.json`.

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

## Critic pass 1: w0/mesh-spike @a72c771

Reviewed 2026-10-24 by the pass-1 critic: `tools/mesh/**`, `tests/unit/mesh/**`, docs/MESH.md, the SVGs and metrics JSON, and the vitest/package changes. Checklists applied: typescript-reviewer, silent-failure-hunter, pr-test-analyzer, security-review. The generator writes only `docs/mesh/` and two fixed-name files in the OS temp dir; the resolve hook only appends `.ts` to relative specifiers; SVG labels are XML-escaped. Nothing found.

Probes:
- `docs/reviews/probes/w0m-mesh.probe.ts.txt`: metric identities and the ghost map on the production mesh, the D3 smoothing rerun, a split-vs-single smoother check, and N2.
- `docs/reviews/probes/w0x-adapter.probe.ts.txt` (needs both branches merged): EngineDefinition → mesher.

**Gates (rerun in the builder worktree):**
- `npm test`: 120 passed / 0 skipped (13 files).
- `npm run lint`: clean. `npm run typecheck`: clean.
- `npm run coverage`: lines 99.14 %, statements 98.17 %, branches 80.38 %, functions 100 %. The new `tools/mesh/**` lines ≥ 90 threshold passes.
- `npm run mesh`, run in a detached checkout, reproduces every reported number:
  - cells: 129,913 (130k) / 79,769 (80k);
  - worst stretching: 1.137 / 1.135 (upstream);
  - worst skew: 46.5° / 46.4°;
  - min Jacobian: 2.60e-6 / 3.46e-6 m²;
  - smallest edge: 1.39 mm;
  - binary v1 round trip: ok for f64 and f32.
- The SVGs and metrics JSON regenerate byte-identically (git status clean afterwards), so the generator is deterministic.

**Requirements checked:**
- **Topology:** 12 blocks, a C-block lip, point-matched interfaces (bitwise, via `validateMesh` plus face vectors), the axis at r = 0.
- **Cells across:** 16 core, 48 fan, 32 bypass, checked wall-to-wall at every column.
- **Cells per chord:** ≥ 4 everywhere (8 at the HPC rear for 130k, 6 for 80k).
- **Domain:** 5.006 D upstream of the highlight, r_out = 5.65 D, 20.006 D downstream.
- **Stretching:** ≤ 1.15, including across interfaces. But see I2: the test cannot detect a broken in-block measurement.

**My own checks on the 130k production mesh:**
- The FV identities hold in every cell: outward Σ n·L closes to 3.4e-16 relative, and Σ n_r r̄ L equals the planar area A to 9.9e-14 (Green). No cell has a non-positive area.
- All 6922 interface ghosts are adjacent: each layer-1 source cell owns the ghost's face, and each layer-2 source shares exactly one edge with layer 1.
- The ghost index map, the face-vector sign convention and the binary layout match MESH.md.

**D0-6 evidence:** my rerun is 300 sweeps, ω 0.8, Thomas-Middlecoff control, all blocks.
- Floating interfaces: stretching reaches 3.83 at P2 (-0.78, 0.96) and around O (1.68, 0.96), with lip skew up to 79.5°.
- Fixed interfaces: upstream/inlet/lip stretching reaches 2.27-3.99 next to P1/P2, the far-field skew goes from 46.3° to 39.5°, and the afterbody/plume-outer stretching at O reaches 1.49.
- The duct blocks are unchanged.
- The smoother is not at fault: a distorted block split into two with a floating interface converges to the single-block result to 2.2e-16 (pure Winslow).
- **The evidence is real and D0-6 stands.** Details in N1.

**Mutation testing** (Stryker 10.1.1). With the full suite, 85 % of the 1050 mutants of `tfi.ts`, `distribution.ts` and `metrics.ts` count as static (the engine builds in `beforeAll`), so a full run would take more than 20 min. I ran it in two stages:
- **Stage 1** (all mutants, the mesh unit tests without `engineMesh`/`report`, 1 min 56 s): 77.52 %.
- **Stage 2** (the full suite on every line with a stage-1 survivor, 471 mutants, 8 min 34 s).
- **Combined final scores:**
  - `distribution.ts` 71.4 % (98 of 343 surviving);
  - `metrics.ts` 87.6 % (59 of 475);
  - `tfi.ts` 80.6 % (45 of 232);
  - overall 80.8 % (848 of 1050 killed or timed out).
- Many survivors are equivalent: convergence-loop bounds, unreachable `?? 0` guards, the cosmetic `where` locations.
- The ones that matter are I2 and I3. I confirmed both by hand-applying the mutants to the full suite.

### Blocking
None.

### Important
- **W0M-I1 OPEN: the real EngineDefinition does not swap in cleanly.**
  - Where: `tools/mesh/geometry/flowpath.ts:106` and `:110`.
  - The probe: an adapter maps the contracts curves onto the mesher's (hub = spinner ⊕ coreInner ⊕ plug; the other four 1:1; rows by component; combustor extent). `validateFlowpath` then rejects ENGINE_DEFINITION with "coreCowl must end at the core lip" and "nacelleOuter must end at the bypass lip".
  - Why: the definition has blunt trailing edges (core cowl 0.405 over a 0.390 lip; nacelle 0.775 over 0.757), which the contracts validator allows, but the mesher requires knife edges.
  - With both edges pinched: the build succeeds (127,679 / 78,099 cells, all Jacobians positive) but violates the stretching requirement. Max stretch is 1.393 in the plug block at the plug tip (3.39, 0.02), and far-field skew is 59.8°. This is R1 coming true.
  - Fix: an orchestrator decision on trailing-edge topology, either (a) close both edges in the definition (cheapest: a contracts edit; the validator already allows outer = inner) or (b) give the mesher a finite-thickness base. Then w1/mesh retunes the plug tip and boattail.
  - Allowed after merge: W1, after the decision.
- **W0M-I2 OPEN: the quality-metric tests cannot catch a broken metric.**
  - Where: `tools/mesh/metrics.ts:312` and `:317-321`.
  - Failure: disabling both in-block stretching loops (`:317-321`), or recording the last value instead of the maximum (`:312`), leaves all 120 tests green (hand-applied). The headline "stretching ≤ 1.15 everywhere" test in engineMesh.test.ts therefore cannot fail for in-block stretching, only across interfaces.
  - The same holds for the reported maximum skew (`:291`) and aspect ratio (`:301`).
  - Fix: unit tests on small blocks with a known geometric ratio q ≠ 1 along i and along j, placed away from the last cell (expect exactly q), plus a known skewed corner and a known aspect ratio.
  - Allowed after merge: this must be **w1/mesh's first task, before any retuning** (I1). Retuning against an unverified metric is exactly how a violation would slip through.
- **W0M-I3 OPEN: geometry formulas the tests do not pin.**
  - Cell centroid x (`metrics.ts:55-59`): mutants such as `x0 - cx` survive the full suite (hand-applied). `CELL_X` ships in the binary and the solver will use it for reconstruction distances and resampling. `centreR` is pinned only through `volR`.
  - TFI arc-length blending (`tfi.ts:77-79`): `den = 1 + …`, `a - c(b - a)` and others survive, because every TFI test uses edges whose opposite fractions coincide, where the Soni formula degenerates.
  - Vinokur interior (`distribution.ts:104`): `A - (1 - A) u` survives, because the Newton loop restores the end spacings and the tests check only the ends.
  - Fix: an exact-centroid test on a trapezoid; a TFI test with different clustering on opposite edges against the analytic line intersection; a Vinokur interior check against the closed form.
  - Allowed after merge: W1 (w1/mesh).
- **W0M-I4 OPEN: no station planes for the solver reductions.**
  - Gap 1: `FlowpathGeometry` (`flowpath.ts:33`) carries no stations.
  - Gap 2: the core H-block's i-lines follow smoothed mean-line normals, so they are radial only at the four fixed planes (fan face, splitter, both nozzle exits).
  - Gap 3: binary v1 has no section that maps contracts `SOLVER_REDUCTION_STATIONS` (2, 13, 18, 25, 3, 4, 45, 5, 8) to grid lines.
  - Failure: the W2/W3 `StationReduction` (mass flow and area per plane, checked to ±0.5 % in L12) would have to integrate across oblique cells by interpolation, which is not exactly conservative.
  - Fix: pass `EngineDefinition.stations` through `FlowpathGeometry`, force exact radial i-lines at those x (as for the fixed planes), and add a STATIONS section (block, i, x) in binary v2.
  - Allowed after merge: W1 (w1/mesh).
- **W0M-I5 OPEN (cross-branch, found in the trial merge): the far render extent reaches past the mesh.**
  - `FIELD_EXTENTS.far` (`src/contracts/flow.ts`) covers r ≤ 10 m. The mesh ends at r_out = 8.75 m (placeholder) or 8.82 m (definition). The x range is covered: -8.46..34.01 contains -8..32.
  - Failure: far texels with r > r_out have no solver data, and the contract does not say what they hold.
  - Fix: either flow.ts defines out-of-domain texels as exact ambient (gauge 0, u = 0, fluidFraction 1) for the W2 resample to write, or the far extent is sized from the mesh domain.
  - Allowed after merge: W2.

### Nits
- **W0M-N1 OPEN: the D0-6 record is overstated in places.** The conclusion holds, but:
  - MESH.md D3's numbers do not reproduce with the default options. It says 4.3 and "folded cells" with floating interfaces; I measure at most 3.83 and every Jacobian positive. It says O mismatch 1.31 and far-field skew 38°; I measure 1.49 and 39.5°.
  - D0-6 in this log says smoothing "moved the fixed singular corner points". It does not: P1, P2 and O stay pinned, and the cells around them deteriorate.
  - Fix: record the exact options or a script in MESH.md D3, and reword D0-6.
- **W0M-N2 OPEN: `maxRatio` misses folds.** `distribution.ts:197-202`: it returns 1 for the folded distribution [0, 0.5, 0.4, 1] (probe), and its direction branch is unpinned (mutants at `:202` survive). The distribution tests' own stretching checks rely on it. Fix: return Infinity (or throw) on a non-positive spacing, and test both orientations.
- **W0M-N3 OPEN: `decodeMeshFile` does no structural validation.**
  - Where: `format.ts:368`, `:413`.
  - Gaps: a section's declared element type is not checked against the precision flag (an F64 real section in an f32 file passes the length check and is read as twice as many f32 values); block offsets and Σ ni·nj, ghost sources < cells, and face/BC codes are not checked either.
  - Consequence: a bad asset would upload out-of-range indices that WGSL clamps silently.
  - Fix: add the checks in the decoder or the W2 loader.
- **W0M-N4 OPEN: no corner ghosts.** `ghost.ts:6`: that is fine for dimension-split MUSCL. But the v1 plume eddy viscosity (and v2 k-ω) needs face cross-derivatives that read diagonal neighbours at block corners. W2/W3 must add corner ghosts or build face gradients from the available cells.
- **W0M-N5 OPEN: the TFI corner check is not exercised.** `tfi.ts:28`: the corner-coincidence check can be deleted without a test failing, because the existing "corners do not coincide" case trips another check first.

**Verdict w0/mesh-spike @a72c771: MERGE.** No blocking items: the spike meets every requirement on its placeholder, deterministically. I explicitly allow the Important items after the merge:
- I2, then I3, as w1/mesh's first tasks, before any retuning;
- I1 after the orchestrator's trailing-edge decision, in W1;
- I4 in W1;
- I5 in W2.

## Critic pass 1: trial merge (w0/contracts @e51aff1 + w0/mesh-spike @a72c771)

- **Merge:** octopus `git merge --no-ff --no-commit` into `critic`. Clean, no conflicts; the two branches touch disjoint files.
- **Gates on the combined tree:**
  - `npm test`: 833 passed (29 files; 718 + 120, minus the 5 shared main tests).
  - `npm run lint`: clean. `npm run typecheck`: clean.
  - `npm run coverage`: lines 99.43 %, statements 97.84 %, branches 87.85 %, functions 99.81 %; every threshold passes.
  - `npm run build`: ok.
- **Restore:** `git merge --abort`. The worktree is back on its own HEAD.
- **Cross-branch findings:** W0M-I1 (trailing-edge topology) and W0M-I5 (far extent vs. domain) above.

**Orchestrator decisions needed (mesh / cross-branch):**
- (d) Trailing-edge topology: knife edges in the definition, or a base block in the mesher (W0M-I1).
- (e) Reword D0-6. The conclusion stands (W0M-N1).
- (f) Add "station planes as exact radial grid lines plus a station map in the asset" to w1/mesh's brief (W0M-I4).

## Critic pass 2: w1/contracts-fix @3969af7

Reviewed 2026-10-26 by the pass-2 critic: the branch diff from 6619a45 (`src/contracts/{sim,flow,scenario,cycle,engine}.ts`, `src/engine/bladeDesign.ts`, `src/mocks/*`, the tests, the ENGINE_FACTS references). Checklists applied: typescript-reviewer, silent-failure-hunter, pr-test-analyzer, security-review (no I/O, network, eval, storage or secrets in scope; nothing found). New probe: `docs/reviews/probes/w1f-contracts.probe.ts.txt` (6 tests; all pass, so each observed behaviour is confirmed).

**Gates (rerun in the builder worktree; tracked files unchanged):** `npm test` 934 passed / 0 skipped (30 files). `npm run lint` clean. `npm run typecheck` clean. `npm run coverage`: lines 99.42 %, statements 98.28 %, branches 89.03 %, functions 99.82 %; every threshold passes. These match the handoff.

**Pass-1 probes rerun** (`w0c-contracts.probe.ts.txt`): the five probes that pinned I1, I2 (both cases), N2 and N5 now fail, which means those findings are fixed. The NaN-throws and plain-data probes still pass, as intended. The provenance probe still passes only because it searches for the upper-case label; the new `sources` field is lower case and declared by the caller (W1F-N1).

**Pass-1 findings, verified:**
- I1 FIXED (18fcf0d): stamped after the spread; a forged `version: 99` gives 4.
- I2 FIXED (f667360): in-window samples are counted, both vacuous paths fail with "never sampled", and a sample exactly at `toS` counts.
- I3 FIXED (068f9e4): `SimSnapshot.sources` (checked by `nextSnapshot`), `CycleModel.source`, `FlowField/CpuFlowField.source`; the mocks stamp `'mock'`.
- I4 FIXED (a4c2902, dbb1cb4): see the mutation scores below.
- I5 FIXED (64e12ce), with the residual gap W1F-I1.
- I6 and N8 WONTFIX here: accepted, they are W1 calibration (D1-1, D1-2, D2-3).
- N1 (45082fa), N2 (2e8fd7d), N3 and N7 (3cddcf5), N4 (4a28b72, 3c727d5, 2205104), N5 (479e1d6), N6 (7b966a5), N9 (94f6782): FIXED.
- W0M-I5 FIXED (11ee1ec): the far extent is r ≤ 8.4375 m in 108 rows of 78.125 mm square texels. It lies inside `minimumSolverDomain(ENGINE_DEFINITION)` (r_out 8.81 m) and inside w1/mesh's real domain (x −8.54..33.75 m, r_out 8.82 m, from its metrics JSON), with a 0.38 m radial margin.

**Definition unchanged:** the SHA-256 of `JSON.stringify(ENGINE_DEFINITION)` and of `ENGINE_MEANLINE` is identical on main, w1/contracts-fix and w1/mesh (aabec130…, 70c651b8…). The N4 flip-flop resolution reproduces the old counts (booster-igv 60, hpc-r1 35, hpc-r9 59).

**Breaking contract changes, checked for later implementability:**
- `FlowStatus.status/error`: implementable. The one trap is W1F-I1.
- `SIM_SCHEMA_VERSION` 2: no consumer yet.
- `CycleModel.source`: w1/cycle @b4acf7f has `class TurbofanCycleModel implements CycleModel` (`src/cycle/model.ts:212`) without `source`, so it stops typechecking once this branch is on main. Its fix round adds `readonly source = 'model'`. Its `egtMeasuredK` already equals `stations['49.5'].ttK` (`model.ts:689`), so the new N5 check passes.
- `MeshAsset.domain`: neither binary v2 nor `public/mesh/manifest.json` on w1/mesh carries the domain, so the W2 loader has no defined source for it (W1M-N4).
- The far extent's 108 rows: nothing on the three branches assumes 128 (checked again in the trial merge).

**Can a test file that fails to import still report success at HEAD? No.**
- vitest 5.0.5 prints "Tests 833 passed" next to "Test Files 1 failed | 29 passed", but it **exits 1**. Probe: a test file that throws at import, added to the critic worktree and then removed.
- So `npm test`, `npm run coverage` and CI (`ci.yml` runs coverage) all fail.
- Stryker 10.1.1's vitest runner reports file collection errors as a dry-run error (`vitest-test-runner.js:241-255`).
- No config on the three branches sets `dangerouslyIgnoreUnhandledErrors`, `bail`, retries or `.only`/`.skip`.
- The builder read only the "Tests" line (W1F-N3). The one real masking risk is `passWithNoTests: true` in the GPU and browser configs (W0G-I4).

**Mutation testing** (Stryker 10.1.1, perTest, mutate = `src/contracts/engine.ts` + `src/engine/bladeDesign.ts`, 3 min 20 s): 1304 mutants, **97.31 %** in total.
- `engine.ts`: **96.67 %** (971 killed, 15 timeouts, 34 survived, 0 without coverage). Pass 1: 77.63 %.
- `bladeDesign.ts`: **99.65 %** (261 killed, 21 timeouts, 1 survived). Pass 1: 85.78 %.
- I checked every survivor. The 34 in `engine.ts` are exactly the handoff's equivalence list: tolerance edges, optional chaining behind a `!== undefined` test, index guards required by `noUncheckedIndexedAccess`, and filters behind earlier coverage checks. `bladeDesign.ts:262` (`best !== count` → true) only re-solves the same count. None matters.

### Blocking
None.

### Important
- **W1F-I1 OPEN: solver reporting glitches still reach the failure paths.**
  - Where: `src/contracts/sim.ts:243-257` (`flowStatusProblems`). A `diverged`/`lost` status with an empty `error` throws, and `sim.test.ts:357` pins this. Also `:281` (`sanitizeFlowStatus`): any non-finite number, `stats.gpuTimeMs` included, sets the status to `diverged`.
  - Failure 1:
    - `GPUDeviceLostInfo.message` may be empty; the spec allows it. w0/gpu-spikes' `attachErrorHandlers` (`src/gpu/device.ts:140-144`) forwards `info.message` verbatim.
    - If W2 copies it into `FlowStatus.error`, `nextSnapshot` throws, and snapshot publication stops at the moment the device is lost. That is the failure W0C-I5 was meant to remove. The probe confirms the throw.
  - Failure 2:
    - gpu-spikes' `pairDurationMs` (`src/gpu/timestamps.ts:18`) returns NaN by design for a stale or backwards timestamp pair, which happens on every fresh D3D12 device (measured).
    - A NaN `gpuTimeMs` alone flips a healthy running solver to `diverged`, with "solver produced a non-finite number: stats.gpuTimeMs is NaN" (probe).
    - A timing glitch is not divergence. The UI would show a failure, and a restart-on-divergence policy would restart for nothing.
  - Fix:
    - in `sanitizeFlowStatus`, replace an empty message on a failed status with a default ("lost: the solver gave no reason") instead of throwing;
    - null a non-finite `gpuTimeMs` without changing the status (only the residual, the counters and the reduction indicate divergence);
    - test both.
  - Allowed after merge: there is no consumer before W2. Fix it in W2's first solver-status task, or the next contracts touch, before the device-loss wiring.

### Nits
- **W1F-N1 OPEN: provenance is declared, not derived.** `nextSnapshot` accepts a mock cycle state with `sources.cycle: 'model'` (probe). The sim loop must copy `CycleModel.source` and `FlowField.source`, and a W2 test should pin that. The contract alone cannot enforce it.
- **W1F-N2 OPEN: two definitions of D.**
  - `minimumSolverDomain` (`src/contracts/flow.ts:57`) uses 2 × the fan's LE tip radius.
  - The mesher (`tools/mesh/geometry/definition.ts:142` on w1/mesh) uses 2 × max(LE, TE tip radius).
  - They are equal today. One shared helper would stop them from drifting.
- **W1F-N3 OPEN (process): a red range committed as fix steps.**
  - 4a28b72..452e7af fail at import (the definition build throws). The handoff records this.
  - Gate reports should quote the "Test Files" line and the exit status, not only "Tests N passed".
  - No code fix needed.
- **W1F-N4 OPEN: unknown snapshot roots pass.**
  - `nextSnapshot` (`sim.ts:328`) checks plain data, sources and flow, but not the key set of `parts`. A mistyped extra root is frozen into the snapshot unnoticed.
  - Fix: check the keys against `SNAPSHOT_ROOTS` (plus `schemaVersion`/`version`, which are overwritten).

**Verdict w1/contracts-fix @3969af7: MERGE.** No blocking items. I explicitly allow W1F-I1 after the merge (W2, before the device-loss wiring). The nits can go to the next contracts touch; N3 is process only. Coordination: w1/cycle must add `source: 'model'` after this merges.
