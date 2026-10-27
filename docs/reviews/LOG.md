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

## Pass-2 orchestrator decisions: 2026-10-26 ~01:55 (autopilot; on the critic's questions g-k)
- **D2-6 (g):** W1F-I1 accepted, fixed in W2 when the solver is wired: a lost device with an empty message must not make `nextSnapshot` throw, and a NaN GPU time alone must not mark the solver `diverged` (only a non-finite residual does).
- **D2-7 (h):** `npm run test:mesh` joins `ci.yml`, done in the w0/gpu-spikes fix round (it already touches the test configs).
- **D2-8 (i): D2-5 reworded.** The official 80k-16x8 row is invalid: the window lost focus about 52 s into it and rAF dropped to 1 Hz, which the harness could not see (Playwright reports occluded windows as visible). 16x8 is the default tile, not a measured best: the fixed run order confounds the tile ranking. P1 stands on the valid 130k rows (299 / 265 / 251 it/s at 60 fps, all ≥ 150).
- **D2-9 (j): D2-4 kept, with caveats.** At a realistic 15 Hz React load the worker's gain is rAF start delay (p99 0.3 ms vs 10.0 ms), not dropped frames; at a heavy 60 Hz load the worker still drops about 60 frames per minute.
- **D2-10 (k):** w1/cycle's CycleModel sets `source: 'model'` (sent to the cycle fixer).
- Merged into main: critic (pass-2 reviews), w1/contracts-fix and w1/mesh. Gates on main after the merges: npm test 972 passed, test:mesh 29 passed, lint and typecheck clean, lines 99.43%; `npm run mesh` regenerated the assets and the manifest matched.
- **D2-11 (gpu-spikes fix round, question a): benchmark validity rule accepted.** A run is INVALID if frames longer than 2.5 display intervals persist for more than 500 ms in a row, or the page was hidden. This catches the occluded-window 1 Hz rAF case without rejecting real loads (the valid official main-react60 row ran at 56.6 fps, which the critic's "fps < 0.95 × refresh" rule would have rejected).
- **D2-12 (question b): D0-1 protocol wording updated.** Official runs use a 10 s warm-up before EACH of the 3 × 60 s runs, with the configs rotated per repetition (seeded, the seed recorded in the JSON), so run order no longer confounds rankings. Official durations: about 33 min (throughput) and 23 min (worker). A `--quick` smoke run precedes the next official run.
- **D2-13 (question c): median rule demoted to a WARNING.** A config whose median frame exceeds 1.5 display intervals is reported as "below display rate", not invalid: a load that genuinely cannot hold 60 fps (e.g. 256k) is a real result, and the sustained-long-frame rule already catches occlusion.

- **D2-15 (w1/cycle mutation runtime):** cycle/thermo Stryker runs take hours because the reference engine is built at import, so about 72% of mutants are "static" and rerun the whole suite. Use Stryker's standard remedies: `ignoreStatic: true` (report static mutants separately, not as survivors), `incremental: true` for reruns, and build the reference engine lazily (a memoized fixture) where that is cheap. Done in the cycle fix round after critic pass 3; the critic then runs targeted mutation on the changed files.

- **D3-1 (Aaron, 2026-10-26): studio backdrop.** The look-dev fix round uses a neutral studio cyclorama (soft floor, contact shadows and AO, controlled key/fill/rim lights), the product-shot look, rather than a hangar or an airfield. LD-3 is resolved this way.
- **D3-2 (Aaron, 2026-10-26): stop after W1 for his review.** After critic pass 3, the fix rounds and their merges, the orchestrator stops and shows the new screenshots, frame times and mutation scores. W2 starts only on his go.
- **D3-3 (critic pass 3 question l): new pre-registered threshold C10, the measured ground-run points.** Source [WIDURI] Table 7 (OAT 25 °C, 1008 hPa, 14 ft). At the measured N1 of ground idle (20.5 / 21.0 %), MPA (65.0 %) and takeoff (97.4 %), the model's displayed EGT must be within ±30 K of the measured value (idle: inside the measured 466-493 °C range widened by 30 K on each side, i.e. 436-523 °C; MPA 585 ± 30 °C; takeoff 855 ± 30 °C) and N2 within ±1.5 points of the measured value (idle 60.6 / 60.7 %, MPA 89.3 %, takeoff 99.8 %). The ±30 K band roughly covers engine-to-engine scatter and the measurement itself. Added to PHYSICS.md §3.2 and thresholds.ts by the cycle round before any code is tuned to it; it adds a check and loosens none.
- **D3-4 (question m): surge comes from the engine, not a fixed B.** Derive Greitzer B from the definition (plenum volume = HPC exit plus combustor, compressor duct length and flow area, rotor tip speed at the current N2) and the post-surge characteristic from a cubic extension of the scaled HPC map beyond the surge line. The surge period is whatever that physics gives. C9 is unchanged. The ledger and plan wording "100-300 ms" is replaced by "period from the derived Helmholtz frequency".
- **D3-5 (question n): T3's reference reworded honestly.** T3's check reads "JANAF species tables mixed at the frozen stoichiometric Jet-A product composition (the method CEA uses for a frozen mixture)"; the 0.5% tolerance is unchanged. The cycle round updates PHYSICS.md and thresholds.ts together, and adds an independent Cantera cross-check if a Python 3.14 wheel exists.
- **D3-6 (question o): D2-11 amended (pass-3 N5).** A benchmark run is INVALID only on the occlusion signature (rAF intervals ≥ 500 ms sustained, the ~1 Hz background throttle) or page hidden/blur events. A genuinely slow load that cannot hold the display rate is a WARNING with its numbers kept. Assigned with N6 (per-run timeout) and N7 (the load-sensitive test:gpu timing check) to a small benchmark-harness round before the next official run (P2, in W2).
- **D3-7 (w1/lookdev render budget):** acceptance waits for a quiet re-measure on AC power with no agents running. The builder's 9-13 ms per-pass GPU totals at 1080p `high` were taken on battery (laptop at 43%) with another agent running, and identical work varied up to 2x. If the default preset is still over 8 ms on AC, a "performance" preset with dynamic resolution (render scale about 0.75-0.85, TAA upsampling) becomes the battery default, and the solver's adaptive iterations per frame absorb the rest of the 16.7 ms frame.
- **D3-8 (w1/lookdev):** the procedural studio (cyclorama, softbox PMREM, shadowed key, rim, contact shadow) replacing the CC0 HDRI is accepted (D3-1); the HDRI and its NOTICE are removed, and `LICENSES/Apache-2.0.txt` covers the pyCycle maps.
- Merged into main @b677c75: critic pass 3, w0/gpu-spikes, w1/cycle, w1/geometry (all MERGE). Gates on main: npm test 1406 passed, test:mesh 29, lint and typecheck clean, lines 98.57%, build OK, mesh regenerated (tree clean).
- **D3-9 (critic pass 4 question p): check the plug against public dimensions.** w1/lookdev-2 compares the definition's plug (length, base diameter, cone angle) with public CFM56-7B cutaway dimensions and references, without copying artwork. If the plug changes, the definition keeps the sized core-nozzle throat A8 = 0.1851 m² (the cycle-sizing test pins it), the mesh is regenerated and `test:mesh` must pass.
- **D3-10 (question q): Aaron sees the shots after w1/lookdev-2 fixes the culling (W1L-I1),** so the report shows the complete engine (fits D3-2: stop after the W1 fix rounds).
- Merged into main @3dd23f0: critic pass 4 and w1/lookdev (MERGE, follow-up w1/lookdev-2 for W1L-I1..I4 and the nits). Gates on main: npm test 1445 passed, test:mesh 29, lint and typecheck clean, lines 99.57%, build OK, mesh manifest unchanged.
- **D3-11 (w1/cycle-calib: C10 at MPA unmet).** Model vs measured at MPA (N1 65.0%): EGT 536 vs 585 °C, N2 86.71 vs 89.3%. Idle and takeoff are within C10, except an idle-2 N2 miss of 0.03 pt. The measured MPA EGT implies T49.5 above the model's own T45, and the EEDB fuel flows agree independently: the model burns 12% less fuel than certification at 30% thrust and 10% less at 7%. Two independent datasets say the model is too efficient at part power. Decision: **neither reword C10 nor accept it as met.** Calibrate part power only through physically real mechanisms: the VBV opening schedule vs N2 (CFM56 booster bleed into the bypass at low power), the HPC VSV schedule, and part-speed efficiency trends of the fan/booster/LPT maps. Each is bounded to a plausible range with a stated reason, and fitted to both datasets at once (Widuri idle/MPA/takeoff and the EEDB LTO fuel flows), never to a single point. New pre-registered threshold **C11: fuel flow at the EEDB LTO settings 7 / 30 / 85% rated thrust (ISA SLS) within ±5% of the databank**, added to PHYSICS.md §3.2 and thresholds.ts before tuning. The C10 KNOWN-FAIL (`it.fails`) markers stay until C10 genuinely passes.
- **D3-12 (mutation runtime):** cycle/thermo Stryker runs go detached in a usage-cap pause (they cost CPU, not usage, like the official benchmark), using the D2-15 setup already on w1/cycle-calib. The critic reads the HTML/JSON report afterwards.
- **D3-13 (mutation, superseding D3-12's full run):** the detached full Stryker run stalled at 957/2283 after 2 h (15 survived, 26 timed out): the slow transient-model tests, worsened by contention with two agents' test runs. It was stopped at 18:08. Cycle/thermo mutation now uses a mutation-specific vitest config that excludes the slow transient/scenario tests, reports mutants covered only by those tests as a separate "no fast coverage" count (never hidden), and runs targeted per file. Timed-out mutants are reported separately, because contention inflates them.
- **D3-14 (w1/cycle-calib-2 stop: C11 not reachable inside the LP-side bounds).** The bounded fit (fan 4.2 pt, booster 4.2 pt, LPT Reynolds exponent 0.2, VBV 75/95% N2c and VSV ±6°, all on their bounds) reached C11 30%/7% at −7.6/−7.2% (target ±5%) and MPA EGT 551 vs 585 °C; only a fan loss about 2× the NASA SDT bound reaches C11, and that breaks C4 and the slam surge margin. One more timeboxed attempt with sourced core-side mechanisms: (a) combustion efficiency vs power from the EEDB 8CM066 EI_CO and EI_HC via the standard combustion-inefficiency relation (data, not a free parameter); (b) an HPC part-speed efficiency falloff and (c) turbine tip-clearance growth at low power, each bounded by published ranges. The EGT probe share is a bounded fitted parameter in [0.25, 0.45] (0.416 accepted if inside). A fit is adopted only if every other threshold still passes (T1-T4, C1-C9, C4, the C5 slam margin, every transient test). If C10/C11 still miss, the KNOWN-FAIL markers stay, the residual gap goes into the fidelity ledger with its likely cause (EEDB = a new production engine, Widuri = an on-wing and likely deteriorated engine), and no bound is widened.
- **D3-15 (w1/cycle-calib-2 outcome): accept the residual part-power gap for W1.** The D3-14 fit (every mechanism on its bound: fan 4.2 pt, booster 4.2, LPT/HPC Reynolds exponents 0.2, HPT clearance 4 pt, probe share 0.385, VBV dump 0.284) reached C11 85/30/7% at +0.6/−6.4/−4.3% and MPA EGT 565 vs 585 °C. It was rejected under the adoption rule: 10 transient tests fail (no 95% thrust for 33.73(a)/C5, limiters not engaging, the booster off its map in a decel and on a 45 °C day). The EEDB combustion efficiency (data, −0.83% at idle) is in the reference. The C10/C11 KNOWN-FAIL markers stay visible, the gap is in the PHYSICS.md fidelity ledger, and "part-power map fidelity" goes to the backlog for Aaron to prioritise after W2. Two rounds point at the same cause: the generic public maps are too efficient at part power for this engine, with a new-vs-on-wing engine mismatch between EEDB and Widuri.
- **D3-16 (w1/lookdev-3 deviation): accepted.** The fan blur is not accumulated through TRAA: at idle the fan turns about 7 blade pitches per frame, so the history is the wrong phase and smears the blades. The rotor pass instead shades each pixel once (a depth pre-pass with EqualDepth, a lighter fan mesh, a gated composite): 5.7 → 1.2 ms indicative. Default preset ~9.4 ms indicative; the new `performance` preset (scale 0.75-0.85) ~7.15 ms. The D3-7 official quiet measurement decides the default. The plug was checked: no public CFM56-7B plug dimensions exist, so it is unchanged (D3-9 satisfied, recorded in ENGINE_FACTS).
- **D3-17 (critic pass 5 question s, and W1K-I1/I2):** before W3's surge scenarios, the reference model needs a surge-recovery test: a slam with reduced HPC margin, FADEC surge detection, fuel reduction and bleed opening, then recovery to idle without a hang (the rejected D3-14 fit surged and hung at 10.7 kN in the 33.73(a) slam). W1K-I1 (stale KNOWN-FAIL reasons and a false comment about the fit file) and W1K-I2 (pin the rejection reason, the slam surge, in a test) go into a small cycle follow-up at the start of W2. D3-15 is on main (question r).
- **D3-7 result (official quiet look-dev timing, 2026-10-26 18:53-19:07; AC, plan Balanced, no agents, CPU 18%; w1/lookdev-3 @23239a1; D0-1 protocol: 10 s warm-up + 3 × 60 s, seed 1; all 4 configs VALID):** default three-quarter front **10.18 ms** GPU (opaque 5.59, rotors 1.36, GTAO 0.89, composite 0.80, TRAA 1.20, output 0.31; CPU 2.30); cutaway 12.67 (opaque 8.36); hero cinematic 14.09 (opaque 6.24, DoF 2.20, bloom 0.56); default with the performance profile **9.57** (opaque 5.64). **Neither preset meets 8 ms.** Lower resolution barely moves the opaque pass, so it is geometry-bound (about 1.5 M triangles), not pixel-bound; the indicative 7.15 ms was optimistic. With up to 7 ms of solver, the frame would exceed 16.7 ms. Options go to Aaron in the W1 report: a geometry LOD/simplification round, a smaller solver budget, or both. JSON: w1/lookdev-3 `docs/look-dev/timings.json`.
- Merged into main @b61f840: critic pass 5 and w1/cycle-calib-2 (with w1/cycle-calib), MERGE. Gates on main: npm test 1577 passed + 5 expected fail (C10/C11 KNOWN FAIL, D3-15), test:mesh 29, lint and typecheck clean, lines 99.5%, build OK, mesh manifest unchanged.
- Merged into main @495df08: critic pass 6 and w1/lookdev-3 (with w1/lookdev-2). W1V-B1 (unformatted timings.json from the orchestrator's ca4a33a) was fixed in 67ecae4, and per the critic it then merges with no re-review. Gates on main: npm test 1600 passed + 5 expected fail, test:mesh 29, lint and typecheck clean, lines 99.51%, build OK.
- **W1 COMPLETE (2026-10-26 ~22:30).** Per D3-2 the orchestrator stops for Aaron's review; W2 starts only on his go. Follow-ups carried into W2 planning:
  - **w1/lookdev-4:** W1V-I1, the cutaway/exploded fan does not read: TRAA ghosting from zero-velocity rotor pixels at a frozen idle spool, the cut rule hiding the 8 nearest blades, no rotor AO or self-shadow. W1V-I2: stale triangle figures and no LOD hook. W1V-I3: an EqualDepth hole would pass every test. Plus the visual notes (the torn moving fan, the spinner spiral lost in shadow, the floating engine, the chrome-bullet plug).
  - **Render budget (D3-7):** default 10.18 ms and performance 9.57 ms against 8 ms, with the opaque pass geometry-bound. Aaron chooses the remedy (a LOD/simplification round, a smaller solver budget, or both).
  - **Cycle:** W1K-I1/I2 (KNOWN-FAIL wording, pin the rejection reason in a test); D3-17 (a surge-recovery test before W3); D3-13 (a mutation config excluding slow tests, then real scores); the part-power map-fidelity backlog (D3-15).
  - **Bench harness (D3-6):** N6 per-run timeout, N7 load-sensitive test:gpu timing check.

## W2 orchestrator decisions: 2026-10-26 ~22:40 (Aaron: "whatever you recommend. keep going"; overnight autopilot)
- **D4-1 (Aaron): W2 goes ahead** on the orchestrator's recommendations below (D4-2, D4-3).
- **D4-2 Render budget: both remedies.**
  - (a) A geometry LOD/simplification round (`w2/lookdev-4`) brings the engine render to 8 ms. New pre-registered threshold **P4**: the render GPU time (engine plus post, excluding the solver and flow visuals) at the default preset, 1080p, default three-quarter front view must be ≤ 8.0 ms median under D0-1. The cutaway and hero views are reported (target ≤ 10 ms) but not gated. P4 is added to PHYSICS.md §3.4 and thresholds.ts before the LOD code.
  - (b) The solver's per-frame GPU budget at the default preset is capped at **5 ms**. The adaptive scheduler gives the solver min(5 ms, 15 ms − measured render − measured flow visuals), with a floor of 2 iterations per frame. L13's 7 ms stays the hard ceiling. Budget at the default view: render 8 + solver 5 + flow visuals 2 = 15 ms of the 16.7 ms frame. At 1.28 ms per iteration that is 3 iterations per frame (about 180 it/s), above P1's 150, so tracking-mode settling takes about 1.7× longer than at full rate; the warm-start snapshots cover that.
- **D4-3 Part-power accuracy (D3-15): backlog until after W2.** The C10/C11 KNOWN-FAIL markers stay visible. It only affects mid-power numbers, and the GPU solver is the critical path.
- **D4-4 (pass-6 question t): the cutaway shows a running engine.** Rotor motion vectors go into the TRAA velocity buffer (W1V-I1 fix b), so the cut fan reads while the spools turn, which W2's flow visuals need (particles through moving rows). The exploded view eases the spools to a stop over about 1 s, because an exploded engine can't run.
- **D4-5 (question u):** the LOD round restates the triangle figures from the pass-6 probe (front 1.06 M + 0.41 M fan copies, side 0.48 M, cutaway 1.58 M). It adds per-view drawn-triangle counts that exclude shadow proxies (W1V-I2), measured before and after LOD.
- **D4-6 W2 scope and order.** The f64 reference solver and the CPU ladder were not built in W1 (w1/mesh delivered the mesh only), so the solver track starts with the oracle.
  - **Slot A:**
    1. `w2/reference`: the production f64 reference solver in `src/flow/reference/` (the exact discrete scheme the WGSL kernel will implement) and ladder L1-L9 on the CPU.
    2. `w2/solver`: the WGSL kernels, Dawn tests against the oracle (several iterations, relative errors, W0G-N4), L1-L9 on the GPU, timings, W1F-I1 (D2-6), W1F-N1 and W0M-N4 if the plume viscosity needs corner ghosts. The solver merge gets the plan's two-reviewer santa-loop.
  - **Slot B:**
    1. `w2/followups`: cycle W1K-I1/I2, D3-17 surge recovery, the D3-13 mutation config with real scores, and bench harness N6/N7 (D3-6).
    2. `w2/lookdev-4`: W1V-I1..I3, the visual notes, LOD to P4, D4-4, D4-5.
    3. `w2/flowviz`: on the synthetic mock field.
    4. `w2/app-ui`: the D2-4 worker app shell, main loop and store, and the UI on the real cycle model.
  - Max 2 agents at once, the critic included. A critic pass follows each finished pair.
- **D4-7 Overnight autopilot (Aaron: "auto start when session usage runs out"):**
  - Usage cap 90%. No new agents from 78%, STOP-CLEAN at 84%, resume below 75% after the reset.
  - Official quiet timings (D0-1) run only in the cap pause, when no agents are running.
- **D4-8 (w2/reference question d): both scheme changes accepted.**
  - The slip wall uses a pressure-only wall flux with extrapolated ghosts: zero normal mass flux, momentum flux p·n. This is the standard finite-volume inviscid wall. The W0 mirror ghost imposed dp/dn = 0 and failed L6 wherever swirl or curvature sets a normal pressure gradient.
  - The 3-stage RK coefficients are (0.2, 0.5, 1). The spike's (0.1918, 0.4929, 1) are linearly unstable with κ = 0 MUSCL. The default tracking CFL is 1.5, stable to 1.54 at second order. The plan's "CFL 1.5-1.8" is amended: 1.8 applies only where the limiter is first order.
  - A linear-stability test pins both coefficient sets' limits. SOLVER.md is the contract; w2/solver implements these, not the spike.
- **D4-9 (question a): L4b keeps its 2% threshold and its back pressure.** A stalled residual means the shock position is not converged, so 2.26% is not yet a verdict.
  - First, find and fix the stall (limiter cycling or similar).
  - Then run a grid-convergence study of two refinements, with the resolution stated in PHYSICS.md "CPU variants" before the runs.
  - If the error converges below 2%, the case runs at that resolution. If it converges to a value above 2%, report the data as a quasi-1D-theory gap for a decision. No back-pressure change after the fact.
- **D4-10 (question b): L7's iteration ratio is met with low-Mach preconditioning of the pseudo-time derivative in tracking mode (Weiss-Smith / Turkel type).** This is the standard convergence remedy for density-based solvers at low Mach. It matters beyond L7: the static engine's own far field is near M 0, so unpreconditioned stiffness would slow the app's settling.
  - The steady solution must not change: the converged states with and without preconditioning must agree within the oracle tolerance (a test).
  - SLAU2 keeps its own low-Mach dissipation. Physical-time mode is unpreconditioned.
  - If the combination is unstable with SLAU2, report it rather than forcing it. The threshold stays at 3×.
  - SOLVER.md is updated before the code.
- **D4-11 (question c): L7's Cp asymmetry and L8 are set-up investigations,** not thresholds: the axis cells of the polar mesh, the far-field offset, and the entropy error at the stagnation points. No threshold change.
- **D4-12 (question e): the f32 metric defect is fixed in the asset if w2/solver's 20k-iteration L1 fails,** not in the kernel. The preferred fix is GCL-exact f32 face vectors (computed in f64 and rounded so each cell closes); full f64 metrics (about 5 MB more) is the fallback. The f32 experiment must use a closed box (handoff NEXT 4).
- The `src/flow/reference` branch coverage must reach the existing 85% gate. `test:ladder` (6.5 min) stays out of `npm run gates`, and the critic and the orchestrator run it at merges.
- **D4-13 (w2/followups question a): a lost gas-path solve is flagged, never patched over silently.**
  - Above the sub-idle switch, a failed gas-path solve holds the last converged state and sets a visible solve-failure status in the snapshot. A minimal contract field is allowed; flag it for the critic.
  - The sub-idle model engages only in genuine sub-idle states (start, windmill, shutdown).
  - Every transient and scenario test asserts zero lost solves. The W1K-I2 pin names the real cause: the rejected D3-14 fit's "hang" is a lost solve.
- **D4-14 (question b): accepted as a model limitation.** The surge recovery opens the VBVs only below `vbvClosedAboveN2c`, because opening them at high power drives the booster off its map. The real FADEC's bleed opening during recovery is recorded in the fidelity ledger as not modeled above the closing speed. It is linked to the part-power map-fidelity backlog (booster map extension). C12 passes without it.
- **D4-15 (question c): backlog.** After a takeoff chop, the idle-floor loop undershoots N2 to 57.4% (0.4 points above the sub-idle switch) and takes about 25 s to settle. It is not new and breaks no threshold. It goes into the ledger and joins the part-power backlog; W3's scenarios will make it visible, so revisit it there.
- **Cap-pause jobs, 2026-10-27 00:03:** with no agents running, the orchestrator runs the bench `--quick --only=130k-16x8` smoke run and targeted Stryker runs on the files the round did not reach (species, gas, componentMaps, newton, at, engine, each with its direct suites via `MUTATION_TESTS`). The results are in the job tmp `pause_w2/` and go to the resumed w2/followups round.
- **D4-16 (w2/followups resume, question a): accepted.** C4 is a steady ground-idle criterion, so the start test evaluates it at settled idle, not at the starter-handover moment (N1 19.91 at handover). This is the same reasoning as D2-1, where the test point was wrong, not the threshold. The test must state its settling rule, and the thresholds are unchanged.
- **D4-17 (question b): accepted.** While a solve is held, the spools integrate on the held power balance. A held solve is a fault indication: every test asserts zero lost solves, and w2/app-ui shows `gasPathSolve.status` and `lostSolves` in its diagnostics. The critic reviews the `CycleState.gasPathSolve` contract field.
- **D4-18 (question c): D4-15 widened, with a deadline.** Two problems existed before D4-13: N2 swings for 1-2 min after a start, and it overshoots to 69.5% after a relight. Real engines settle within seconds, and W3's start and relight scenarios would show it. So a small cycle round on idle-governor and settling behavior runs before W3's scenarios. It covers the chop undershoot, the post-start swing and the relight overshoot, judged against published start and relight times. Its acceptance threshold is pre-registered first.




## Orchestrator visual pass: w1/geometry look-dev @93e9877 (docs/look-dev/*.jpg), 2026-10-26 ~03:00
A solid foundation: procedural from the definition, the cutaway is readable (booster, 9-stage HPC, combustor, HPT, LPT, both shafts), every mode renders with 0 WebGPU errors. It does not yet meet the "ultra high level" / "very realistic" bar. For the geometry fix round, alongside critic pass 3's findings:
- **LD-1 The fan does not read.** Through the inlet the blades look like jagged shards (the blur "teeth" plus faceting). A CFM56-class fan seen from the front should read as a dense disc of 24 wide-chord, swept titanium blades with visible overlap and a dark annulus at the spinner. Fix the loft (enough span/chord sections, smooth normals, proper overlap) and the blur.
- **LD-2 The nacelle reads as glossy white plastic, and the inlet lip as a chrome torus.** Satin paint (moderate roughness, a faint orange-peel normal), a polished-aluminium lip (not chrome), subtle panel and cowl seams.
- **LD-3 The black void kills realism.** A visible environment (a studio cyclorama floor with soft contact shadows and AO, or a lightly blurred hangar backdrop), key/fill/rim lighting, and no hard specular hotspots or bloom halos on the lip.
- **LD-4 Cutaway proportions and readability.** The fan barely shows in section; the exhaust plug looks like an oversized copper bullet; the combustor reads as a wavy tube (it needs a liner/dome shape). Cut faces need a distinct hatched cap colour; frames and struts (fan frame, turbine rear frame) would add structure. Check the proportions against public cutaway references (fan 61 in, length 2.508 m, core diameter) without copying any artwork.
- **LD-5 Materials read uniformly chrome.** Vary roughness and metalness per part: matte grey cases, titanium fan, dull superalloy hot section with a heat-tint gradient, painted parts.
- **LD-6 Render cost** of about 20-23 ms per 1080p frame (1.46 M triangles, measured while a Stryker run had 8 workers on the CPU) against the ~8 ms budget: LOD or culling for the blade rows hidden inside the cases outside cutaway, half-resolution GTAO, depth of field only in cinematic mode, and per-pass GPU timestamps to find the real costs. Re-measure in a quiet window.

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

## Critic pass 2: w1/mesh @959bce1

Reviewed 2026-10-26 by the pass-2 critic: the `tools/mesh/**` diff from 6619a45 (`build.ts`, `engineMesh.ts`, `format.ts`, `geometry/definition.ts`, `report.ts`, `scripts/generate.ts` and the `distribution`/`metrics`/`tfi` changes), `tests/unit/mesh/**`, `tests/mesh/**`, `vitest.mesh.config.ts`, the package scripts, `.gitignore`, MESH.md, the metrics JSON and the manifest. Checklists applied: typescript-reviewer, silent-failure-hunter, pr-test-analyzer, security-review (the generator writes only `docs/mesh/` and `public/mesh/`, it is a local tool, and there is no network or eval; nothing found). New probes: `w1m-mesh.probe.ts.txt` (grid lines, maps, decoder fuzzing; 15 tests), `w1m-knife.probe.ts.txt` (closure displacement of every mesh node) and `w1m-maps.probe.ts.txt` (the maps in the generated binaries). All pass.

**Gates (rerun in the builder worktree; tracked files unchanged):**
- `npm test`: 871 passed / 0 skipped (31 files).
- `npm run test:mesh`: 29 passed (2 files, 1.2 s).
- `npm run lint`: clean. `npm run typecheck`: clean.
- `npm run coverage`: lines 99.44 %, statements 98.05 %, branches 86.89 %, functions 99.38 %; every threshold passes.
- `npm run mesh` (1.7 s) regenerates `docs/mesh/` and the manifest byte-identically; `git status` shows only the ignored `.bin` files. The `.bin` SHA-256s equal the manifest's (130k bd8e40b0…, 80k 03afce80…) before and after.

**The worst numbers reproduce exactly:**
- 130k: 130,034 cells; stretch 1.140 (plume-core); skew 55.2° (far field at O); min Jacobian 2.61e-6 m²; min edge 1.02 mm (core); explicit dt 1.22 µs.
- 80k: 80,588 cells; stretch 1.146 (core); skew 55.2°; min Jacobian 2.77e-6 m²; min edge 1.02 mm; dt 1.30 µs.
- Domain: x −8.54..33.75 m, r_out 8.82 m (5.01 D upstream, 5.69 D radial from the axis, 20.01 D downstream).

**Pass-1 findings, verified:**
- **W0M-I1 FIXED (e2800fb, 7a0e062), the knife-edge adapter (D1-4).**
  - `EngineDefinition` is untouched: there is no `src/` diff, and the definition hash is identical to main.
  - The closure stays within its stated tolerance (probe `w1m-knife`, every mesh node on the closed lines):
    - nodes move only inside the ramp (core cowl x 2.60..2.75 m, nacelle 1.37..1.55 m), only inwards, and by at most the base thickness (exactly 15.0 / 18.0 mm at the lip);
    - the lip keeps a positive thickness (min 0.72 mm at 130k);
    - upstream nodes are unchanged to 1e-12.
  - A8 and A18 are the definition's. `coreOuter` and `nacelleInner` are bitwise, and the bypass exit plane (x 1.55 m) lies upstream of the core-cowl ramp.
- **W0M-I2 and I3 FIXED (29bc705, 1817195).** Stage 1 kills the pass-1 mutants: metrics 312, 317-321, 291, 301 and centroids 55-59; TFI 77-79; Vinokur 104. The builder's equivalence argument for distribution 88 holds.
- **W0M-I4 FIXED (9409367, bbfe538, 3647e54).**
  - Probe `w1m-mesh`:
    - All ten stations (2 13 18 25 3 4 45 49.5 5 8) are grid lines. Every node's x is bitwise the definition's station x, and both end nodes lie on the walls to 1e-12.
    - Every blade LE/TE grid line lies on its cut line to < 1e-12, with its end nodes on the cut line's end points.
    - The row zones match the definition's rows one to one, and are disjoint and ordered per duct.
  - Probe `w1m-maps`: STATIONS and ROWS decoded from `public/mesh/*.bin` equal `mesh.stations` and `mesh.rows` (names mapped to block indices), and the file's f64 node x on each station line equals the station x.
- **W0M-I5:** fixed on w1/contracts-fix; MESH.md still has the old text (W1M-N2).
- **W0M-N1 FIXED (669178a).**
- **W0M-N2 FIXED (6037503):** only the tie mutant at 207 survives.
- **W0M-N3 FIXED (bbfe538, 3647e54).** Fuzz probe: the decoder rejects:
  - an out-of-range ghost source and a BC code of 9;
  - a station i or a row i1 beyond its block;
  - a flipped precision flag;
  - a block cell offset off by one;
  - a missing section.

  It accepts NaN metrics (W1M-N3).
- **W0M-N4 WONTFIX:** accepted, a solver choice recorded in MESH.md.
- **W0M-N5 FIXED:** `tfi.ts:28` is killed.
- **D1-4 plug tip:** 1.393 → 1.140; `test:mesh` pins ≤ 1.15 at the plug tip.

**Generated asset and manifest hash:** a sound approach. The generator is deterministic and checks writer → reader → writer bitwise. `asset.test.ts` rebuilds both meshes and compares bytes and hash, and the hash gives the W2 loader an end-to-end integrity check. Gaps: W1M-I1 (not in CI) and W1M-N1 (the build rewrites the tracked manifest).

**Mutation testing** (Stryker 10.1.1, `tfi.ts`, `distribution.ts`, `metrics.ts`):
- **Stage 1**, the pass-1 protocol: the mesh unit tests without the `engineMesh`/`report` builds, 2 min 3 s.
  - tfi **99.14 %**, distribution **83.62 %**, metrics **95.16 %**, all **92.18 %**.
  - 934 killed, 44 timeouts, 83 survived, of 1061. Identical to the handoff.
- **Stage 2**: the full unit suite, including the 43k smoke mesh, on the 63 lines with a stage-1 survivor (241 mutants, 2 min 11 s): 116 killed, 109 timeouts, 16 survived.
- **Combined:** tfi 99.14 %, distribution 98.59 %, metrics 98.11 %, all **98.49 %** (1045 of 1061). Pass 1 was 80.6 / 71.4 / 87.6 / 80.8 %.
- Many stage-2 detections are timeouts (mutants that only slow the smoke build), so stage 1 stays the stricter number.
- The 16 survivors are equivalent:
  - loop bounds that read past the end of a typed array (metrics 41, 42, 67, 83, 317);
  - guards (metrics 340, 349, 350);
  - a tie-break (distribution 207);
  - bisection and Newton damping that still converge (distribution 33, 42, 154, 155);
  - tfi 131 and 141, where `fractions(0)` equals `f0`.

### Blocking
None.

### Important
- **W1M-I1 OPEN: the production-mesh requirement suite and the asset hash check are not in CI.**
  - Where: `.github/workflows/ci.yml` runs typecheck, lint and coverage. `tests/mesh` runs only under `npm run test:mesh` (`vitest.mesh.config.ts`), which only `npm run gates` calls.
  - Failure: CI still passes a definition change that breaks stretching ≤ 1.15, cells per chord, the lip spacing or the station planes, or that changes the asset without a new manifest. D2-2 changes A8/A18 right after this merge.
  - The hash depends on V8 Math, and nobody has checked that it reproduces on the Linux runner.
  - Fix: add `- run: npm run test:mesh` to `ci.yml` (about 2 s).
  - Allowed after merge: the orchestrator owns `ci.yml`. Add it with the merge, or before D2-2's regeneration.

### Nits
- **W1M-N1 OPEN: `npm run dev` and `npm run build` rewrite a committed file.** `predev`/`prebuild` run `mesh:assets`, which rewrites `public/mesh/manifest.json`. After a definition change, a dev or build run updates the tracked manifest silently, and `asset.test.ts` then passes against it. Fix: in `--assets` mode, compare with the manifest and fail on a mismatch; only `npm run mesh` writes it.
- **W1M-N2 OPEN: stale and weaker domain statements.**
  - MESH.md "Open risks" still says `FIELD_EXTENTS.far` covers r ≤ 10 m. That is stale once w1/contracts-fix merges (r ≤ 8.4375 m).
  - `tests/mesh/requirements.test.ts:287` checks only r_out ≥ 5 D from the axis. The mesher (`engineMesh.ts:276`) and the contracts' `SOLVER_DOMAIN_MIN_D` use 5 D above the nacelle (≥ 8.81 m), and the mesh has 8.82 m, a 1 cm margin. So the mesh test would accept a mesh that W2's `fieldExtentDomainProblems` rejects.
  - Fix: after both merge, `tests/mesh` asserts that `minimumSolverDomain(def)` lies inside `mesh.domain`, and MESH.md quotes the radial distance above the nacelle.
- **W1M-N3 OPEN: no numeric validation in the decoder.** `meshFileProblems` (`format.ts:556`) accepts a NaN or negative area or volume (probe). The manifest hash covers transport corruption but not a generator bug. Fix: finite and positive checks on `cellArea`, `cellVolR` and the face areas (O(cells)).
- **W1M-N4 OPEN (cross-branch): `MeshAsset.domain` has no source.** Binary v2 has no domain fields and the manifest has none. Fix: add `xIn/xOut/rOut` to the manifest (or a v3 header), or specify that the loader derives them from the INFLOW/OUTFLOW/FARFIELD patch nodes.
- **W1M-N5 OPEN: interface kinks are not in the risks.** Grid-line kinks of up to 52° across interfaces (lip, plume-outer, far field) appear in the quality tables, but MESH.md R3 lists only skew. A line that turns 52° at an interface degrades dimension-split MUSCL there. Tell W2.

**Verdict w1/mesh @959bce1: MERGE.** No blocking items. I explicitly allow W1M-I1 after the merge (the orchestrator, in `ci.yml`, before D2-2's regeneration). The nits go to the next mesh touch or to W2.

## Critic pass 2: w0/gpu-spikes @8e4ffdc

Reviewed 2026-10-26 by the pass-2 critic:
- the production modules: `src/gpu/{device,timestamps}.ts`, `src/render/rendererOnDevice.ts`;
- `spikes/**`: kernel generator, f64 reference, stage solver, resample, timestamp ring, bench harness, scene, throughput and worker pages;
- `tests/{unit,gpu,browser}/**`, the configs, GPU_FACTS M1-M33, the two official JSONs and the quick JSONs.

Checklists applied: typescript-reviewer, silent-failure-hunter, pr-test-analyzer, security-review. The harness serves Vite on 127.0.0.1 and calls powercfg, the PowerShell counters and git with fixed arguments; no input reaches a shell. Nothing found. **No benchmark was run** (D0-1).

**Gates at HEAD** (the handoff's were not rerun at HEAD; I ran them; tracked files unchanged):
- `npm test`: 110 passed (15 files).
- `npm run lint`: clean. `npm run typecheck`: clean.
- `npm run coverage`: lines 99.84 %, statements 99.03 %, branches 82.38 %, functions 99.29 %.
- `npm run test:gpu`: 15 passed (4 files; Dawn/D3D12 in Node, 1.6 s).
- `npm run test:browser`: 14 passed (2 files: 12 interop + 2 chrome-gpu; headed Chrome 155, 2.9 s). This settles the handoff's "full suite not rerun after chrome-gpu".

**Checked and sound:**
- **Kernel vs the f64 reference** (`tests/gpu/stage-kernel.test.ts`):
  - WGSL SLAU2 on 256 seeded random faces (sub- and supersonic, both directions), within 2e-6 of a stated scale.
  - One full iteration cell by cell on a wiggled 12-block 48×24 mesh, covering every BC, MUSCL/van Albada, SLAU2, the radial source, local dt and RK: within 1 Pa, 1e-2 m/s and 1e-5 kg/m³, while the step moves p′ by more than 100 Pa.
  - Tile-shape and block-split invariance to 1e-6, quiescent and freestream preservation, 200 iterations finite.
  - The tolerances are justified in the test. This is adequate for a cost-model spike (M32 lists what the kernel lacks). The independent check of SLAU2 itself is `slau2.test.ts` (consistency, symmetry, contact, supersonic). See W0G-N4.
- **Interop** (`tests/browser/interop.test.ts`, 12 tests):
  - three adopts our device in core mode;
  - raw WGSL → `rgba16float` → TSL material and TSL compute is pixel-exact;
  - queue order holds;
  - three never re-uploads over our texture or buffer until `needsUpdate`/`DynamicDrawUsage`;
  - buffer injection, itemSize-3 padding, vertex-stage storage reads and `float32-filterable` behave as recorded.
- **Error routing** (`src/gpu/device.ts:111-157`):
  - `attachErrorHandlers` listens with `addEventListener('uncapturederror')`, which three's assignment of `onuncapturederror` cannot clobber; the interop test "uncaptured errors reach our listener although three replaced device.onuncapturederror" pins this.
  - It falls back to chaining the property only when there is no EventTarget, and reports every loss except our own `destroy()`.
  - `createRendererOnDevice` throws if three did not adopt the device or fell into compatibility mode, and `computeNow` throws instead of deferring.
  - Nothing is swallowed. The one downstream trap is an empty loss message (W1F-I1).
- **Recording of conditions:** power source, plan, Windows power mode, GPU name and driver, Chrome version and chrome://gpu, CPU load before/during/after, other processes' GPU use before/after, git head and dirty flag, the protocol, and the page's hidden time.
- **Statistics:** Hyndman-Fan type 7 quantiles, the median of an odd number of runs per metric, rates over the fixed window, and GPU samples attributed by frame time. Sound, apart from W0G-I1, I2, N1 and N2.
- **Official throughput JSON:** every 130k and 256k configuration and 80k 8x8/32x4 are valid (60 fps, p99 16.8-17 ms, 0-1 long frames, page visible, GPU otherwise idle). 80k-16x8 is not (below).

**The first-config "warm-up bug" is not a warm-up bug.** The run records of 80k-16x8:
- **Run 0:** 2561 frames, p50 16.7 / p95 16.8 / p99 17.0 ms, 312.7 it/s at 0.909 ms/it, and 23 long frames (max 1017 ms). The frame budget puts the onset about 42 s into run 0, i.e. ~52 s after the configuration started, well after the 10 s warm-up.
- **Runs 1 and 2:** 59 and 60 frames, every delta ~1016 ms (1 fps).
  - The scheduler still asked for ~4.8 it/frame, so the rate fell to 4.8 it/s.
  - GPU time was 6 ms per frame. The 1.33-1.35 ms/it reflects the GPU clocking down at one frame per second.
- **The next configuration**, after the harness's `page.bringToFront()`, ran at 60 fps.

So rAF was throttled to 1 Hz for about 2.4 min in the middle of a configuration. That is M31's signature (an occluded or unfocused window), and the harness recorded it as data. Four reasons nothing flagged it:
1. **`pageHiddenMs` cannot see occlusion here.**
   - Playwright 1.64.1 launches Chrome with `--disable-backgrounding-occluded-windows` and `--disable-renderer-backgrounding` (`playwright-core/lib/coreBundle.js`), so an occluded window stays `visibilityState === 'visible'`.
   - `pageHiddenMs` has been 0 in every recorded run, this one included. M31's mitigation does not work.
2. **`longFrames` is relative to the run's own median** (`spikes/lib/benchRun.ts:148`, delta > 1.5 × median). In a run that is entirely at 1 fps the median is 1016 ms, so runs 1-2 report 0 long frames, and so does the aggregate.
3. **There is no validity gate.** A configuration whose median frame time is 60 × the refresh period is aggregated and printed like any other.
4. **The median of 3 picks a broken run** when two of the three are broken.

Impact: D2-5 is unaffected, since it quotes 80k ≈ 384-427 from 8x8 and 32x4. But the official JSON holds an unflagged invalid row, and the same harness will produce the P2/P3 and L13 numbers.

**Worker evidence vs D2-4** (`worker-2026-10-25-2247-official.json`; 130k, 16x8, a fixed 3 it/frame, 1080p):

| configuration | frame p50 / p95 / p99 (ms) | long frames per run (runs) | rAF delay p95 / p99 (ms) |
|---|---|---|---|
| main, idle | 16.7 / 16.8 / 16.8 | 0 | 0.8 / 1.2 |
| worker, idle | 16.7 / 16.8 / 16.9 | 0 (0, 0, 1) | 0.4 / 0.5 |
| main, React 15 Hz | 16.7 / 16.8 / 16.8 | 0 | 5.2 / 10.0 |
| worker, React 15 Hz | 16.7 / 16.8 / 16.9 | 0 | 0.2 / 0.3 |
| main, React 60 Hz | 16.7 / 33.2 / 33.5 | 177 (138, 177, 187) | 15.8 / 20.7 |
| worker, React 60 Hz | 16.7 / 16.8 / 33.3 | 60 (60, 67, 51) | 5.7 / 12.7 |

The evidence supports D2-4 as a headroom decision. The decision text should carry four caveats:
- At the realistic 15 Hz load neither mode drops a frame. The gain is the rAF start delay (p99 10.0 → 0.3 ms), which matters once the app's per-frame CPU work grows.
- The worker is not immune at 60 Hz: 60 missed frames per minute. M29's quick-run claim "the worker holds 60 fps" is wrong.
- The solver ran a fixed 3 it/frame (~3.8 ms of GPU), about half the 7 ms budget.
- React was the development build.

The JSON's `gitDirty: true` comes only from the throughput JSON of the run before, which was untracked at the time (W0G-N2).

**GPU_FACTS "Measured" vs evidence:** the functional entries M1-M3, M5, M7-M28, M32 and M33 match their tests and scripts, all rerun green above. The problems are W0G-B1 and W0G-N3.

### Blocking
- **W0G-B1 OPEN: GPU_FACTS does not record the official runs, contradicts them in two Measured entries, and points to a file that does not exist.**
  - Where:
    - `docs/GPU_FACTS.md:9`: "The official quiet runs are in `spikes/README.md`" (no such file).
    - `:119` and `:160`: "P1 needs the official quiet run".
    - M29 (`:73-91`): "at 60 Hz … the worker holds 60 fps", from 1 s quick runs.
    - M31 (`:120-123`): the harness's "PAGE HIDDEN … INVALID" is presented as the mitigation for occlusion.
  - Failure:
    - D2-4 and D2-5 rest on `docs/bench/*-official.json`.
    - The facts file a later builder reads says the opposite about the worker at 60 Hz (official: 60 long frames per run), says no official run exists, and implies occlusion is detected (it is not, W0G-I1).
    - CLAUDE.md requires facts to be measured, with evidence.
  - Fix:
    - write `spikes/README.md`: how to run each spike, the official commands and their durations, and the D0-1 checklist;
    - add an "Official D0-1 runs" section to GPU_FACTS with both official tables and their conditions, and the 80k-16x8 row marked invalid with the reason;
    - correct M29 and M31, and drop the stale "P1 needs …" lines.

### Important
- **W0G-I1 OPEN: the harness cannot detect an invalid run, and the official 80k-16x8 row is one** (the analysis above).
  - Where:
    - `spikes/scene/visibilityTracker.ts` and `spikes/lib/visibility.ts`: blind under Playwright's flags;
    - `spikes/lib/benchRun.ts:148`: long frames relative to the run's median;
    - `spikes/bench/run.ts:316-335`: no validity gate, and the refocus happens only between configurations.
  - Fix:
    - take the refresh period from the warm-up's median frame delta, or record it, and count long frames against that absolute period;
    - mark a configuration INVALID when its fps < 0.95 × refresh or its median delta > 1.1 × the period, and rerun it once after `bringToFront()`;
    - record the launch flags including Playwright's defaults (N1);
    - annotate the 80k-16x8 row as invalid next to the JSON, without editing the recorded file;
    - unit-test the gate with a synthetic 1 Hz run.
  - Fix it before any further official run (P2/P3, L13).
- **W0G-I2 OPEN: the fixed configuration order confounds the tile comparison behind D2-5's "16x8".**
  - Where: `spikes/bench/run.ts:48-60` always runs 16x8, then 8x8, then 32x4 within each grid.
  - Evidence:
    - In the official run the per-grid ranking follows run order at all three sizes: 130k 1.277 / 1.403 / 1.498 ms/it, 256k 2.863 / 2.904 / 2.968.
    - Within a configuration, later runs are slower (130k-8x8: 281.7, 265.2, 264.7 it/s).
    - The builder's single-configuration runs put every 130k tile at 0.88-0.97 ms/it, inside that drift (GPU_FACTS M30).
  - Fix: rotate or interleave the order (ABC, BCA, CAB) and report the order effect.
  - D2-5's PASS stands, since every 130k tile reaches ≥ 250 it/s. But 16x8 is a default, not a measured optimum.
- **W0G-I3 OPEN: the branch is based on fe260dd (the scaffold), not on main.**
  - The trial merge conflicts in `.prettierignore` (`docs/mesh/` vs `docs/bench/`) and `vitest.config.ts` (coverage include `tools/mesh` vs `spikes/lib`).
  - Both resolve as unions, and with them every gate passes (trial merge below).
  - Fix: merge main into the branch (keeping both sides) and rerun the gates.
- **W0G-I4 OPEN: `passWithNoTests: true` in `vitest.gpu.config.ts:13` and `vitest.browser.config.ts:11`.** Now that both suites exist, a broken include or a moved directory reports green with 0 tests. Fix: remove it. It comes from main's scaffold; this branch's fix round adds the suites, so it removes the flag.

### Nits
- **W0G-N1 OPEN: incomplete launch record.** `conditions.chromeFlags` is `[]` although Playwright adds about 25 switches, including the two that hide occlusion. The display refresh rate is not recorded either, though "long frame" and "60 fps" assume 60 Hz. Record the launch arguments with Playwright's defaults and the measured refresh period.
- **W0G-N2 OPEN: `gitDirty` counts untracked files** (`run.ts:276`). The official worker run reads as dirty only because the throughput JSON from just before was untracked. Use `--untracked-files=no` or exclude `docs/bench/`.
- **W0G-N3 OPEN: two anecdotes filed as Measured.** M4 (dawn.node segfaults when the GPU object is collected) and M6 (the first timestamp is ~200 s stale) have no repro script; their tests pin the mitigation, not the phenomenon. Label them "observed, no repro".
- **W0G-N4 OPEN: a one-iteration reference check.** The f64-reference comparison covers one iteration with absolute tolerances (1 Pa, 1e-2 m/s). That is fine for the spike. W2's kernel test should compare several iterations with relative errors on the real mesh.

**Verdict w0/gpu-spikes @8e4ffdc: FIX FIRST.**
- One fix round: B1 and I1 must be fixed; I3 and I4 (a few lines each) go in the same round.
- I2 may follow after the merge, in the same fix round or with W4 performance work, because it does not change D2-5's PASS.
- The production modules (`src/gpu/device.ts`, `src/gpu/timestamps.ts`, `src/render/rendererOnDevice.ts`) and the evidence behind D2-4 and D2-5 are sound.

## Critic pass 2: trial merge (w1/contracts-fix @3969af7 → w1/mesh @959bce1 → w0/gpu-spikes @8e4ffdc)

- **Merge:** sequential `git merge --no-ff --no-commit`, on a detached HEAD at the critic's HEAD (main 951f504 plus this log), with a scratch commit between steps.
  - contracts-fix: clean.
  - mesh: clean. The files are disjoint; the contracts' far-extent test reads w1/mesh's new metrics JSON domain and passes.
  - gpu-spikes: 2 conflicts, `.prettierignore` and `vitest.config.ts` (W0G-I3). Neither is resolved in any branch. For the gate run only, I applied the obvious unions in the scratch tree: both ignore lines, and coverage include `src`, `tools/mesh` and `spikes/lib`.
- **Gates on the combined tree:**
  - `npm test`: 1077 passed (46 files), the union of the three suites.
  - `npm run lint`: clean.
  - `npm run typecheck`: clean. The gpu-spikes code compiles against the new contracts; nothing on it uses `FlowStatus.available` or the far extent's height.
  - `npm run coverage`: lines 99.49 %, statements 98.52 %, branches 87.26 %, functions 99.38 %; every threshold passes.
  - `npm run test:mesh`: 29 passed.
  - `npm run build`: ok. The prebuild regenerates the assets, and the manifest is unchanged.
  - `npm run test:gpu`: 15 passed. `npm run test:browser`: 14 passed.
  - `npm run mesh`: byte-identical.
- **Restore:** `git merge --abort`, then back to branch `critic` at its HEAD, and the generated `public/` and `dist/` removed. The builder worktrees are untouched (`git status` clean at 3969af7, 959bce1 and 8e4ffdc), and my scratch files in their ignored `reports/` are removed.
- **Cross-branch findings:**
  - W1F-I1: an empty loss message and a NaN GPU time, against `device.ts` and `timestamps.ts`.
  - W1F-N2, W1M-N2, W1M-N4: the domain definitions and the domain's source.

**Orchestrator decisions needed (pass 2):**
- (g) **W1F-I1:** accept the contract change (a default message on a failed status; a NaN GPU time becomes null without `diverged`) for W2 or the next contracts touch.
- (h) **W1M-I1:** add `npm run test:mesh` to `ci.yml`, which the orchestrator owns.
- (i) **D2-5 wording:**
  - the 80k-16x8 official row is invalid: a 1 Hz rAF throttle (occlusion/focus) in the middle of the configuration, not warm-up;
  - 16x8 is a default, because the tile ranking is confounded by run order (W0G-I2).
- (j) **D2-4:** the decision stands. Add the caveats above: no frame difference at 15 Hz (the gain is the rAF delay), the worker drops 60 frames per minute at 60 Hz, the solver ran 3 it/frame, and React was the development build.
- (k) **Coordination:** w1/cycle adds `source: 'model'` once w1/contracts-fix is on main.

## Critic pass 3: w0/gpu-spikes @d1cb041

Reviewed 2026-10-26 by the pass-3 critic: the fix-round diff 175078a..d1cb041 (`spikes/lib/{validity,order,benchRun,protocol,visibility}.ts`, `spikes/bench/run.ts`, `spikes/scene/benchApp.ts`, the unit tests, `docs/GPU_FACTS.md`, `spikes/README.md`, `docs/bench/README.md`, `ci.yml`, the GPU and browser configs) and the main merge 175078a. Checklists applied: typescript-reviewer, silent-failure-hunter, pr-test-analyzer, security-review (the harness still runs fixed powershell/git commands and a 127.0.0.1 Vite server; chrome://version and CDP `Page.bringToFront` take no input; nothing found). **No benchmark was run** (D0-1).

**Gates at HEAD** (rerun in the builder worktree; tracked files unchanged):
- `npm test`: 1107 passed (48 files), exit 0.
- `npm run lint`: clean. `npm run typecheck`: clean.
- `npm run coverage`: lines 99.5 %, statements 98.55 %, branches 87.42 %, functions 99.39 %; `spikes/lib` lines 100 %, `validity.ts` 100 % on all four.
- `npm run test:mesh`: 29 passed.
- `npm run test:browser`: 14 passed (2 files).
- `npm run test:gpu`: **14 passed, 1 failed** on the first run, while a Stryker run had 8 workers on the CPU: `tests/gpu/timestamp-ring.test.ts:78` (W0G-N7). The rerun in a quiet window is recorded below the trial merge.

**Pass-2 findings, verified:**
- **W0G-B1 FIXED (f375a68).** I recomputed both official tables from the recorded JSONs:
  - M34: all nine rows (ms/it, p10, budget and achieved it/s, fps, frame p99, long frames), render GPU 3.6-3.8 ms, resample 0.066 / 0.131 / 0.262 ms, CPU 17 % before / 7.5-8.9 % during / 8 % after, the GPU-busy lists, code at 019683d.
  - M35: all six rows, including long frames per run (138, 177, 187 and 60, 67, 51), rAF delay p95/p99, React commit p50/p95 and solver GPU per frame (4.46 / 4.26 / 4.06 / 4.13 / 6.36 / 5.77 ms).
  - Every number matches. M29 and M31 are corrected; `spikes/README.md` exists; no "P1 needs the official run" line is left.
- **W0G-I1 FIXED (f363280 RED, 9d7bd60, a0f162f).**
  - Frames are judged against the probe's display interval, never the run's median.
  - The harness refuses to start on a throttled probe, sends `Page.bringToFront` before every run, reruns an invalid run once, and stores an invalid configuration with `aggregate: null`.
  - The gate is unit-tested on a synthetic 1 Hz run, the 80k-16x8 shape (invalid in all three runs) and the main-react60 shape (valid). D2-11 and D2-13 are implemented as decided (`validity.ts:106-121`).
- **W0G-I2 FIXED (f363280, 9d7bd60).** `order.ts` gives a seeded Latin square for groups of three (each tile in each in-grid slot once, the grids rotated too), keeps compared configurations together, and fits the order effect within configurations. The seed and the orders go into the JSON.
- **W0G-I3 FIXED (175078a):** both conflicts resolved as unions, as in my pass-2 trial merge.
- **W0G-I4 FIXED (1e4535a):** `passWithNoTests` is gone from both configs. Note that w1/geometry's copy of `vitest.browser.config.ts` still has it; the trial merge takes this branch's version.
- **D2-7 done (1e4535a):** `ci.yml:22` runs `npm run test:mesh`. It has never run on Linux: d1cb041 is not pushed (the last CI run on the branch is 8e4ffdc). The first Linux run of the asset-hash check (W1M-I1's open question) will be main's run after the merge, so watch it.
- **N1, N2, N3 FIXED** (9d7bd60, f375a68). **N4 DEFERRED** to W2 with the reason in M32: accepted, since the test belongs to the production kernel.

### Blocking
None.

### Important
None.

### Nits
- **W0G-N5 OPEN: below 30 fps, the sustained-throttle rule calls a slow load "occluded".**
  - Where: `spikes/lib/validity.ts:19-25`, `:106`.
  - Failure:
    - With vsync, a frame that needs more than two intervals arrives after three (50 ms at 60 Hz), which is above 2.5 intervals (41.75 ms).
    - About ten such frames in a row (> 500 ms) make the run INVALID with the reason "window occluded or unfocused, or a stall", and the configuration loses its numbers.
    - D2-13 wants exactly such a load reported as "below display rate". P1 is unaffected, since every valid row held 60 fps. But P2/L13 on a heavy preset (w1/geometry renders in about 20-23 ms today, see W1G-I2) could hit it.
  - Fix: treat a delta as the occlusion signature only near 1 Hz (for example over 10 intervals or over 250 ms), and leave 3-10-interval cadences to the warning. Confirm the change with the orchestrator, since D2-11 fixed the rule's wording.
- **W0G-N6 OPEN: two blind spots in the live path.**
  - `run.ts:475` and `:491`: `page.evaluate` has no timeout, so a run whose rAF stops entirely hangs the harness (the handoff lists it as a gotcha). Fix: race it against warm-up + run + 30 s, and record the run as INVALID "stalled".
  - `benchRun.ts:159`: without a probe interval, the recorder falls back to the warm-up's median. A warm-up that is throttled from the start (median ~1 s) then makes a 1 Hz run look healthy. Only the in-page `?demo` path uses the fallback. Fix: apply `displayIntervalMs()`'s 24-500 Hz check to the fallback too.
- **W0G-N7 OPEN: a GPU-timing order assertion makes `test:gpu` flaky.**
  - Where: `tests/gpu/timestamp-ring.test.ts:78` expects, in every delivered frame, the second pass (2048 workgroups) to time longer than the first (1024).
  - Failure: under CPU load, the integrated GPU's clock moved between the passes: the first pass timed 0.97 ms and the second 0.38 ms, and the gate went red. CLAUDE.md asks for deterministic tests.
  - Fix: compare the medians over the delivered frames, and give the second pass at least 8x the work, or assert only that both are finite and positive and leave the ratio to a bench.

**Verdict w0/gpu-spikes @d1cb041: MERGE.** Every pass-2 finding is fixed or deferred with a reason, and the official evidence in GPU_FACTS matches the recorded files. The nits go to the next harness touch, before the next official run (P2/P3, L13). N7 goes there too, or to the w2/solver builder, who owns the GPU suite next.

## Critic pass 3: w1/cycle @5d17120

Reviewed 2026-10-26 by the pass-3 critic: the branch diff from 3969af7 (`src/thermo/{gas,species}.ts`, `src/cycle/{at,componentMaps,engine,greitzer,model,newton}.ts`, `src/cycle/maps/*`, the six test files, NOTICE, the ENGINE_FACTS changes, the handoff). Checklists applied: typescript-reviewer, silent-failure-hunter, pr-test-analyzer, security-review (pure numerics, no I/O; nothing found).

New probe: `docs/reviews/probes/w1c-cycle.probe.ts.txt`. It covers air cp below 300 K, the design stations, the part-power ground-run points, cold-start Newton solves, hot-day EGT, the Greitzer B and the sizing secant. Its output goes to the file named by `PROBE_OUT`, because vitest 5 swallowed `console.log` here.

**Gates at HEAD** (rerun in the builder worktree; tracked files unchanged):
- `npm test`: 1036 passed (36 files), exit 0, 53 s.
- `npm run lint`: clean. `npm run typecheck`: clean.
- `npm run coverage`: lines 99.53 %, statements 98.58 %, branches 90.05 %, functions 99.85 %. `src/cycle`: lines 100 %, branches 99.27 %. `src/thermo`: lines 100 %, branches 87.5 %.
- The branch has no `test:mesh` (it predates w1/mesh); see the trial merge.

**Thermo vs its sources (T1-T4).**
- I checked all ten NASA-7 coefficient sets in `species.ts` against GRI-Mech 3.0 `thermo30.dat` (N2, O2, AR, CO2, H2O): identical.
- The test's JANAF references match JANAF (N-023, O-029, Ar-001, C-095, H-064): cp at 300/500/1000/1500/2000 K and H − H298 at 500-2000 K.
- The air composition (USSA 1976, four species renormalised), the C12H23 Jet-A formula and the stoichiometric FAR 0.0682 are right.
- h and the entropy function integrate cp analytically, with continuity at 1000 K (T4 2e-15).
- Two caveats, W1C-N1 and N2: N2's polynomial is valid only from 300 K, and T3's reference is a frozen JANAF mixture rather than a CEA run.

**pyCycle port: provenance, attribution, numbers, scaling.**
- I downloaded `pycycle/maps/{Fan,LPC,HPC,HPT,LPT}_map.py` at the cited commit ee7e161 and parsed them without executing anything.
- The kept slice is identical to the TypeScript for every map: every axis and every Wc/eff/PR (and Wp/eff) table entry, the design points (Fan 0.99 / 2.20 / 1.754; LPC 1.00 / 2.15 / 1.969; HPC 0.976 / 2.05 / 10.894; HPT and LPT Np 100 / PR 6.0) and RlineStall 1.0.
- The Fan and LPC alpha slices are duplicates. The HPC/HPT/LPT second slices differ and are dropped, as NOTICE states.
- NOTICE and the per-file headers give the source, the commit, the licence and the changes.
- The scaling is pyCycle's: s_Wc = Wc_des / WcMap_des, PR − 1 scaled, s_eff, speed as a fraction of design (turbines likewise with Wp).
- The licence-text and NOTICE-merge point is W1G-N4.

**Design point and calibration.**
- C1-C3 close **exactly by construction**: the fan bypass PR (1.537) is solved so that thrust equals takeoffThrust at the EEDB fuel flow, and BPR, OPR and airflow are inputs. So they validate the sizing, not the model. The model's evidence has to come from points it was not fitted to (W1C-I1).
- Design stations: T3 810.6 K, T4 1641 K, T41 1551 K, T45 1200.6 K, T49.5 1109.6 K (866.5 °C displayed); HPC PR 11.05, HPT PR 3.50, LPT PR 3.15. All plausible for the class.
- **N1 101 % at ISA takeoff:** justified, and no threshold is touched. It reproduces the 25 °C run's N2 (99.9 % vs 99.8 % measured), and it keeps the 30 °C corner at 103.44 % N1, under the 104 % TCDS limit. The plausible window is narrow: above about 101.5 % the corner breaks 104 %.
- **The probe fraction 0.35 (D2-3) is fitted to one point** (855 °C at N1 97.4 %). It reproduces that point (853.1 °C), but the other published points miss (W1C-I1).
- **Comment rot:** `engine.ts:135-137` still says 0.35 "also absorbs the thermocouple's radiation and sampling error", which D2-3 explicitly rejected (W1C-N4).

**C5 (D2-1) and the EGT limiter.**
- The test starts from a stabilised 14.9 % of rated thrust (N1 moved < 0.05 points over the last second) and moves the lever to maximum in 1 s. It times 95 % thrust from the lever start: 2.60 s, against ≤ 5.0 s (unchanged).
- It also asserts no surge, valid states and displayed EGT below the 960 °C transient limit throughout.
- The EGT-limiter work (rate feedback, a TD/3 derivative filter, error scale 300 → 150 K) is controller tuning, not a threshold.
- The self-imposed 33.73(a) ground-idle slam passes at 958.3 °C against 960 °C, a 1.7 K margin.
- **The limiter's setpoint is the transient limit minus 5 K** (`model.ts:462`, 955 °C), not the 950 °C redline. So a steady point can sit above the redline: the probe runs a 45 °C day at full lever for 30 s and gets 951.8 °C with `egtExceedance` set (W1C-N5).

**The Greitzer bug, verified (0d93ac3 RED, 0d43dbb).**
- `equilibrium()` used to bracket only [0, 2W], so a wide-open throttle returned the characteristic's peak, which is not an equilibrium.
- It now doubles the bracket until the throttle line is crossed. It terminates, because the cubic goes to −∞ and the throttle flow is odd in Ψ.
- The test pins a falling-branch equilibrium, criticalB = ∞ there, and stability at B = 5.
- The model's own surge parameters are unchanged. But see W1C-I2.

**Newton robustness (C7) and conservation (C8).**
- The C7 sweep (warm-started continuation) converges in ≤ 7 iterations to 7e-12.
- Cold solves from the design guess, with no continuation, also converge at every N1 from 95 to 24 %, in 5-24 iterations. The 24 is at N1 24 %, at the edge of the 25-iteration budget.
- Rated-thrust solves converge from −40 to +50 °C OAT in 4-10 iterations.
- Failures are reported: a non-finite residual is caught in the line search, a singular Jacobian ends the solve as not converged, and `at()` replaced the `?? 0` fallbacks.
- C8 (3.4e-11) closes the books: in = w2 h0t + η_b Wf LHV; out = nozzle flows × total enthalpy, bleed at h3, mechanical loss, extraction.
- **Only zero bleed, zero extraction, zero VBV and Mach 0 are ever tested** (W1C-I4).

**`source: 'model'` (D2-10):** `model.ts:230` sets it, and `model.test.ts` asserts it.

**Mutation testing** (Stryker 10.1.1, perTest, concurrency 8, scratch configs in the cycle worktree, removed afterwards). Per D2-15 the full cycle suite under instrumentation takes hours, so I ran two targeted jobs, each under 15 minutes, with test subsets chosen so the static mutants are affordable:
- **Run A**:
  - mutate `src/thermo/gas.ts`, `src/cycle/{at,newton,componentMaps,engine}.ts`;
  - tests `thermo/gas`, `cycle/numerics`, `cycle/maps`, `cycle/engine` (72 tests);
  - 1081 mutants, 992 static (92 %), 9 min 56 s.
  - Scores: gas.ts **88.89 %**, at.ts **100 %**, newton.ts **89.73 %**, componentMaps.ts **82.08 %**, engine.ts **69.63 %**, all **80.52 %** (732 killed, 12 timeouts, 167 survived, 13 no coverage, 157 runtime errors excluded).
  - engine.ts and componentMaps.ts are lower bounds: the model tests were left out, because each would add minutes per static mutant.
- **Run B**: mutate `src/cycle/greitzer.ts`, tests `cycle/model.test.ts`. 134 mutants, 2 min 9 s, dry run 48 s.
  - Score: greitzer.ts **83.58 %** (109 killed, 3 timeouts, 22 survived).
  - Survivors that matter:
    - the critical-B formula: the slope and the throttle derivative (`greitzer.ts:35`, `:65`), because the tests only bracket B_crit between 0.5 and 1;
    - the RK4 stage combination (`:76-81`: sign and half-step mutants still converge at dxi = 0.01);
    - `helmholtzFrequency`'s V·L vs V/L (`:131`), invisible because the test uses L = 1.
  - Fix: assert criticalB against its closed form for the test parameters, an RK4 convergence-order or linear-decay check, and the Helmholtz test with L ≠ 1.
- **Not run:** `model.ts`, the FADEC. Each of its mutants needs the 20-50 s simulation tests, so it is hours of work. That goes to the cycle round, after D2-15's lazy fixture and `ignoreStatic`.
- I read every survivor. Most are equivalent:
  - tolerance and loop edges;
  - Hermite end cases at x exactly on a node;
  - Newton line-search and finite-difference details that still converge;
  - residual normalisers;
  - corrected-flow and corrected-speed factors that are exactly 1 at ISA SLS;
  - string literals.
- The ones that matter are W1C-I4.

### Blocking
None.

### Important
- **W1C-I1 OPEN: the model matches only the point it was calibrated on. It runs 80-150 K cold at part power and idle.**
  - Where: probe `w1c-cycle`. The comparison points are WIDURI Table 7, the same on-wing ground run as the calibration (OAT 25 °C, 1008 hPa).
  - MPA (N1 65.0 %): model N2 87.2 % vs 89.3 % measured, displayed EGT 503.5 °C vs 585 °C (−81.5 K).
  - Idle: 338 °C vs 466 / 493 °C (−128 to −155 K). At ISA the handoff reports 319 °C.
  - `mpaN1`, `mpaN2`, `mpaEgt`, `idleEgtLow` and `idleEgtHigh` are in `facts.ts`, but no test uses them. C4 passes only because `idleEgtMax` is an upper bound (500 °C).
  - Failure: the cockpit EGT, the station strip and the T-s diagram read far too cold at idle and part power, which is where the start, idle and approach scenarios live. WIDURI's start peak (492 °C) cannot come out right from an idle that is 150 K low.
  - Fix (cycle round):
    - model the part-power loads the handoff already lists: customer bleed and accessory extraction as ground-run defaults, combustion efficiency falling at idle, VBV flow into the gas path;
    - re-check the 0.35 probe share against all three points rather than one;
    - add the MPA and idle points as validation tests, with tolerances the orchestrator sets (decision (l)).
  - Not a threshold failure. Allowed after merge.
- **W1C-I2 OPEN: the surge model does not earn the ledger's "Simulated, 100-300 ms surge cycles".**
  - What the model does:
    - B is fixed at 1 (`model.ts:119`), and the cubic characteristic is generic: it is not derived from the HPC map.
    - The episode lasts a fixed 0.3 s (`SURGE_EPISODE_S`). The Greitzer state only modulates station 3 for display.
  - From the model's own numbers at takeoff:
    - ωH = 915 rad/s (`HPC_DUCT`, T3 810.6 K), so the Helmholtz period is 6.9 ms and the model's surge oscillation period 8.1 ms;
    - B = U / (2 ωH Lc) = 0.44 (HPC tip r 0.316 m), below B_crit = 0.661. So by Greitzer's own criterion this compression system would recover rather than deep-surge.
  - C9 passes because it tests the generic system at chosen B values: it checks the integrator, not the engine.
  - Failure: the fidelity ledger (PHYSICS §1) and the plan promise simulated 100-300 ms surge cycles. The app would show about 8 ms oscillations inside a scripted 0.3 s window, labelled "Simulated".
  - Fix, decision (m):
    - (a) derive B and the characteristic from the engine (U, ωH, Lc; Ψ and Φ from the HPC speed line), end the episode on the Greitzer state's recovery, and check the period against the ledger; or
    - (b) relabel the ledger row (a Helmholtz-scale oscillation in a scripted episode, "Synthesized from a lumped model") and correct the plan's 100-300 ms.
  - Allowed after merge: W3 scenarios are the consumer.
- **W1C-I3 OPEN (cross-branch): nothing ties the cycle's sized A8/A18 to the definition's after D2-2.**
  - Where: `tests/unit/cycle/engine.test.ts:66-67` only requires |sized / fact − 1| < 0.15. After the merge the facts are 0.1852 / 0.9161 and the sizing gives 0.185182 / 0.916069.
  - Failure: any recalibration in the cycle round (I1, D2-15's fixture) moves the sized areas, while the flowpath, the mesh and the 3D geometry keep the old ones, silently. The W3 coupling (L12, thrust ±2 %) would then run a solver nozzle that differs from the cycle's.
  - Fix: after the merge, pin |sized / fact − 1| < 5e-4 (the four-digit rounding), with a message saying to redo D2-2 (facts, then `npm run mesh`). Also update the stale text that the merge leaves:
    - ENGINE_FACTS "Cycle model calibration": "Until then the cycle uses its own sized areas and the definition keeps 0.1778 / 0.9067 m²", and "the definition's flowpath still uses the W0 placeholders";
    - the test name "near the W0 placeholders".
  - Owner: the cycle round, right after the merge.
- **W1C-I4 OPEN: the gas path is only tested at static, no-bleed, no-extraction conditions. Mutants that matter survive.**
  - Run A survivors, with what they show:
    - **Off-design paths never run.** No cycle test uses Mach > 0, a customer bleed, a power extraction or a VBV fraction. Survivors include: free-stream v0, h0t and pt (`engine.ts:303-307`); bleed, cooling and VBV flows (`:369-379`, `:415-418`); extraction (`:439`); bleed in the C8 books (`:497-503`); bypass pressure thrust (`:425`, `:563-566`, zero only while the bypass is unchoked).
    - **The gas path at the design unknowns is never compared with the sizing cycle.** `wCool = fraction / w25` (`:378`, a 12 % cooling flow dropped to 0.2 %) survives. C1's 3 % is too loose to see it, and the design-point reproduction test compares the mutated path with itself.
    - **The nozzle's thermally perfect throat iteration can be deleted** (`:282-287`, the calorically perfect first guess stays). The sizing re-closes the thrust, and only the loose 15 % area check is left.
    - **The surge margin's value is unpinned.** `(prSurge − pr) × pr` and the bracket and bisection mutants survive (`componentMaps.ts:175-183`). The tests check only zero on the stall line and > 0.05 on R-line 2, yet C5's "min HPC surge margin 0.106" and the model's surge trigger rest on it.
    - **The product composition is unpinned.** `N2: AIR_PER_FUEL / xAir('N2')` survives (`gas.ts:59`), because T3's reference mixes JANAF at the model's own mole fractions. Pin the fractions against independent values: CO2 13.3 %, H2O 12.7 %, N2 73.1 %, Ar 0.87 % for C12H23 with stoichiometric dry air.
    - Minor: the display-shunt ramp (`engine.ts:846-847`, never tested between 8300 and 8500 rpm N2); the inverse range check (`gas.ts:191`, no test that an out-of-range h throws).
  - Fix: one test per item:
    - C7/C8 at a bleed + extraction + VBV point and at Mach 0.25 (no thresholds needed beyond C7/C8 themselves);
    - max |residual| < 1e-9 for the gas path at the design unknowns;
    - the choked flux against an independent thermally perfect throat;
    - the surge margin on a hand-computed map point;
    - the product mole fractions;
    - the shunt at 8400 rpm.
  - Then the full mutation score after D2-15. Allowed after merge, in the cycle round.

### Nits
- **W1C-N1 OPEN: air cp below 300 K.**
  - Where: `species.ts`. GRI's N2 polynomial (dated 1986) is valid from 300 K, but `T_MIN_K` is 200 (`gas.ts:28`). Argon is exact at any T.
  - The probe against JANAF: −0.45 % at 250 K, −0.82 % at 200 K. ISA SLS (288.15 K) already sits on the extrapolated piece, at about −0.2 %. A −40 °C day, or an altitude far field in W2's GAS_TABLES codegen, would exceed T1's 0.5 %.
  - The header also calls the N2 entry Burcat 2005, which it is not.
  - Fix: Burcat's 200-1000 K N2, and two extra T1-style checks at 220 and 250 K (extra points, not a threshold change).
- **W1C-N2 OPEN: T3's reference is not a CEA run.** It is a frozen, complete-combustion mixture of JANAF species at the model's own composition (the handoff says so). That tests the polynomial fit, not the frozen-composition assumption, and the composition itself is unpinned (I4). Fix: one CEA frozen run at the stoichiometric point, or reword T3's reference in PHYSICS with a ledger note (no dissociation). Orchestrator wording, decision (n).
- **W1C-N3 OPEN: `sizeEngine` does not report a non-converged secant.** `engine.ts:620-627` stops after 40 iterations without a check. For 1.2x and 1.6x the rated thrust it returns a SizedEngine whose design net thrust is NaN (probe); 2x throws in thermo. C1 guards the reference engine, so this is a nit. Fix: throw when |fb| is above the tolerance or not finite.
- **W1C-N4 OPEN: comment rot and silent defaults.**
  - `engine.ts:135-137` (the thermocouple wording against D2-3);
  - `componentMaps.ts:11` (points to `src/cycle/match.ts`, which does not exist);
  - `engine.ts:346` destructures the unknowns with `= 0` / `= 1` defaults, where the rest of the module uses `at()`.
- **W1C-N5 OPEN: EGT limits, steady vs transient.**
  - The limiter aims at 955 °C (`model.ts:462`), so a steady point can sit above the 950 °C takeoff redline: 45 °C day, 951.8 °C, `egtExceedance` on (probe).
  - `egtExceedance` compares against 950 °C with no time, so it also fires during the 1 s of the allowed 960 °C transient.
  - Related: the N1 limiter aims 1 point under the 104 % TCDS limit (`model.ts:455`). At the 30 °C flat-rating corner, the transient model at full lever is N1-limited at 103.00 % and gives 120.9 kN, 0.4 % short of rated takeoff thrust, which the steady C6 solve reaches at 103.44 % (probe).
  - Fix: a steady setpoint at or below 950 °C minus a margin, with the 960 °C band allowed for at most 20 s (TCDS note 4), and a time-aware flag. Let the N1 limiter sit closer to 104 %, or place the corner rating inside it. Expect to retune the 1.7 K slam margin once I1 lands.

**Verdict w1/cycle @5d17120: MERGE.**
- No threshold was loosened. C5 follows D2-1. The thermo data, the pyCycle numbers and the scaling match their sources. The Newton and C8 machinery is robust, and nothing is swallowed.
- I explicitly allow I1-I4 after the merge, assigned to the planned **cycle fix round** together with D2-15 and the full mutation score: I3 first, then I4, then I1 (needs decision (l)); I2 needs decision (m).
- The nits go to the same round.

## Critic pass 3: w1/geometry @93e9877

Reviewed 2026-10-26 by the pass-3 critic:
- the branch diff from ac22ee3: `src/geometry/**`, `src/render/**`, `src/lookdev/main.ts`, `lookdev.html`, the D2-2 changes (`src/engine/facts.ts`, `definition.test.ts`, `designPoint.test.ts`, ENGINE_FACTS, PHYSICS 2.3, MESH.md, the manifest), the tests, LOOKDEV.md and NOTICE.md;
- the seven screenshots in `docs/look-dev/`, against LD-1..LD-6 and D3-1.

Checklists applied: typescript-reviewer, silent-failure-hunter, pr-test-analyzer, security-review (the look-dev page reads a fixed HDRI URL and a few query parameters, all mapped onto fixed enums; no eval, storage or network beyond same-origin fetch; nothing found), and the three/WebGPU pitfalls in GPU_FACTS M11-M28.

New probe: `docs/reviews/probes/w1g-geometry.probe.ts.txt`. It runs the topology checks on the shipped `high` preset, and checks every part-loop vertex against every flow annulus.

**Gates at HEAD** (rerun in the builder worktree; tracked files unchanged):
- `npm test`: 1169 passed (39 files), exit 0.
- `npm run lint`: clean. `npm run typecheck`: clean.
- `npm run coverage`: lines 98.13 %, statements 97.06 %, branches 87.64 %, functions 97.9 %. `src/geometry`: lines 99.62 %, branches 91.62 %, functions 100 %. `src/lookdev/main.ts` sits in the unit coverage at 0 % (W1G-N5).
- `npm run test:mesh`: 29 passed.
- `npm run test:browser`: 2 passed (main thread, every preset; worker on an OffscreenCanvas).

**D2-2 (A8/A18), checked:**
- The facts carry 0.1852 / 0.9161 m² (`estimate`, [D2-2]). The w1/cycle sizing gives 0.185182 / 0.916069 m², so the four-digit rounding is 1e-4 / 3e-5 relative.
- The plug radius at the lip (0.3052 m) and the core-cowl radius at the fan nozzle (0.5305 m) follow from the definition formulas.
- `definition.test` pins both exit annulus areas to 1e-6 and a monotonic area fall over the last 0.2 m, so the exits are the throats.
- **The `designPoint.test` rewrite is sound.** The constant-cp estimate is now pinned to its own derivation table (0.1778 / 0.9067, ENGINE_FACTS "Design-point estimate") and tied to the sized areas within 5 % / 2 %, instead of claiming that it produces the facts. It is not a threshold (PHYSICS has none for the estimate).
- MESH.md and the metrics JSON are updated. The manifest hashes moved (130k 33c76df6, 80k 6f316568), `test:mesh` passes, and `npm run mesh` reproduces them in the trial merge (below).
- The tie between the cycle's sizing and these facts has no test (cross-branch, W1C-I3).

**Code, checked and sound:**
- **Geometry.** `src/geometry` is pure, deterministic and typed-array based (worker-transferable).
- **Topology tests.** `meshTopology` welds exact duplicates and then counts boundary, non-manifold and misoriented edges, degenerate triangles and the divergence-theorem volume. That is the right set of checks.
- **Blade tests.** Per row: watertight, outward, the clearance kept at every vertex, the hub ring on the hub wall, the tip ring exactly one tip clearance inside the casing, the LE on the definition line, normals agreeing with the faces, unit tangents.
- **Worker-safety (D2-4).** No DOM in `src/render` (the only `HTMLCanvasElement` is a type). `setSize(w, h, false)`. The HDRI comes through HDRLoader (fetch). The worker entry renders the same EngineView, and its browser test passes.
- **Device errors.** `gpuDevice.ts` listens with `addEventListener('uncapturederror')`, which three's `onuncapturederror` assignment cannot clobber (M16), and reports every loss except our own destroy (M17). Nothing is swallowed. W1G-N3 lists the leaks on failed init and dispose.
- The rotor pass uses `setClearColor(0, 0)`. Blades upload no tangents (three's Instance.js does not rotate them, recorded in the handoff). The scene-camera uniforms go into the post quad. These are the pitfalls the builder hit, and they are handled.

**Frame-time claim (20-23 ms vs ~8 ms):**
- The claim is credible as "far over budget", but it is not a GPU cost.
- `lookdev.timeFrames` (`src/lookdev/main.ts:120-128`) awaits `queue.onSubmittedWorkDone()` after every frame. So it measures the serialized CPU + GPU + submission round trip, with no pipelining, on the main thread, while a Stryker run had 8 workers on the CPU. It cannot tell CPU-bound from GPU-bound.
- What the chain draws:
  - two MRT scene passes into three `rgba16float` targets at 1080p;
  - 1,461,160 triangles (probe; the handoff's 1.46 M is right), most of them hidden in realistic mode (2,272 of the 2,296 blades and the internals sit behind the cowls);
  - GTAO at half resolution, a full-resolution 24-tap rotor composite, TRAA, depth of field and bloom.
- On the Arc 140T that is plausibly 10+ ms of GPU by itself, so the ~8 ms target needs the LD-6 measures: cull the hidden rows and internals outside cutaway, DOF only in cinematic mode, fewer blur taps.
- The P2 budget is 16.7 ms minus the solver's ≤ 7 ms. W1G-I2 says how to measure it.

**Visual review** (`docs/look-dev/01..07`, 1920x1080). I confirm LD-1..LD-6 and add the causes and fixes below. The studio look of D3-1 is not started yet, so everything below is for the look-dev round:
- **LD-1 (fan), confirmed and refined.**
  - 05/06: the outer span blurs into a disc, but the inner ~40 % shows dark knife-edged gaps and blade-edge "teeth" radiating from the spinner. That is the single fan-face blur plane departing from the blades near the hub (the handoff's diagnosis).
  - 01: the default realistic preset uses a 180° shutter at idle: 54° per exposure, 3.6 blade pitches. The idle fan becomes an unreadable smear. Use a short shutter (1/500-1/1000 s) in the realistic presets, and keep 180° for a "film" mode.
  - 03 (cutaway): the fan reads as a translucent sheet, for the same reason. Cutaway and exploded need a near-zero shutter.
  - 04 (exploded): the fan blades are hidden inside the opaque fan case. `fan-case`, the spinner and the fan row are all module `fan` (rank 0, `parts.ts:252`, `explode.ts:9`), so the most recognisable part never shows. Give the fan case its own forward offset (with the intake), or move the fan rotor out of its case.
- **LD-2 (nacelle and lip), confirmed, with the cause of the blocky reflections.**
  - The inlet lip is metalness 1 at roughness 0.14 (`materials.ts:167`). The nacelle paint has clearcoat 1 at clearcoatRoughness 0.05 (`:138-141`).
  - Both mirror the **1k** HDRI (1024x512). Its texels show as stair-step "bricks" along the lip and the nacelle: 02 on the left lip, 05/06 on the right half of the lip and cowl.
  - Fix: satin paint (base roughness about 0.45, clearcoat ≤ 0.5 at about 0.3 roughness, a faint orange peel), and a lip at roughness ≥ 0.25 with circumferential anisotropy. Use a 2k/4k environment, or the D3-1 studio rig, for anything glossier.
- **LD-3 / D3-1 (environment), confirmed.**
  - The "studio sweep" is a near-black sphere: colours 0.05 → 0.004 (`engineView.ts:107-116`).
  - There is one unshadowed directional key (`:117-121`), no fill, no rim, no floor.
  - Bloom (threshold 0.9) haloes the lip in 01 (left) and 03 (top-left, bottom-left).
  - Fix: a cyclorama floor and sweep at about 0.2 albedo; a soft-shadowed key plus fill and rim (area lights or a studio HDRI); a contact shadow or AO under the nacelle; a bloom threshold above the lip's specular peak.
- **LD-4 (cutaway and proportions), confirmed.**
  - 03: the section caps are not distinguishable at the wide view. The fine hatch aliases away, and the cap colour is the metal's. Use a flat, distinct cap colour with an anti-aliased (fwidth) hatch.
  - 03/07: the combustor reads as a wavy double tube. It needs an annular liner, a dome and fuel-nozzle stems.
  - 02/03/07: the plug is a polished-copper ogive "bullet". A straight cone with a small tip radius, in dull grey superalloy, would read right; its size matches the definition (r 0.305 m at the lip, 0.65 m aft of it).
  - Frames and struts are still missing (the handoff's list).
- **LD-5 (materials), confirmed.**
  - Nearly every part is metalness 1 (`materials.ts:167-259`).
  - The heat-tint ramp reads as varnished wood grain on the combustor, turbine cases and plug (04, 07).
  - Fix: cases painted or cast (metalness ≤ 0.3, roughness 0.55-0.7); hot section dull superalloy (roughness about 0.5); the tint lower in chroma and graded along x from the hot zones.
- **New visual items:**
  - **V1 (07): stair-step blade silhouettes in close-ups.** The `high` preset lofts core blades with only 6 sections x 15 points (`engineGeometry.ts:33`). Use about 12 sections for HPT/LPT, or a distance LOD.
  - **V2 (03, 07): every compressor and turbine blade carries one bright specular streak.** They read as lit tubes. Raise the roughness or vary it per blade, so the key-light highlight breaks up.
  - **V3 (03, 05): the acoustic-liner perforation moirés** on the inlet barrel and the fan case. Fade it with fwidth, or make it a mip-mapped normal map.
  - **V4 (01, 05): the spinner reads as a chrome cone.** The CFM56-7 spinner is dark with a white spiral (handoff item 3). Use a matte dark base (roughness about 0.5) so the stripe reads.
  - **V5 (04): the exploded preset clips the exhaust** at the right edge of the frame.

### Blocking
None.

### Important
- **W1G-I1 OPEN: the shipped `high` preset is never checked, and its fan case is not manifold.**
  - Where:
    - every geometry test uses `GEOMETRY_QUALITY.test` or a coarser loft (`blade.test.ts:15`, `engineGeometry.test.ts:9`);
    - `engineView.ts:95` and the worker build `high` (21x41 fan sections, 6x15 core, 192 segments, 10 wall samples).
  - Failure, from the probe on `buildEngineGeometry(def, GEOMETRY_QUALITY.high)`: part `fan-case` has 384 non-manifold edges and 768 degenerate triangles (192 segments x 2 and x 4). Every other row and part is clean.
  - Likely cause: `xsBetween` (`parts.ts:79-85`) collects x samples in a `Set` of doubles. A wall sample within float32 resolution of a uniform x then becomes a coincident vertex after the `Float32Array`, so there are zero-length loop segments.
  - So a bug that appears only at the production resolution (seams, slivers, shading cracks, cutaway caps over a non-manifold loop) passes the suite. The whole `high` build plus topology takes about 1 s (the probe ran in 1.26 s), so there is no cost reason to skip it.
  - Fix:
    - merge x samples closer than about 1e-6 m in `xsBetween` and `dedupe`;
    - run the topology test for every row and part, and the annulus test, at `high` too.
  - Allowed after merge: the look-dev round, first task.
- **W1G-I2 OPEN: the render-time number cannot steer the performance work.** See the frame-time paragraph above.
  - Fix, in the look-dev round before any optimisation:
    - per-pass GPU timestamps (the device already requests `timestamp-query`; use three's `trackTimestamp` or, after the merge, gpu-spikes' `TimestampRing`);
    - CPU time per frame reported separately;
    - measured in the worker (D2-4) at the D0-1 protocol, in the orchestrator's quiet window.
  - Report GPU ms per pass against the ≤ 8 ms render budget, then cull, LOD and gate DOF (LD-6).
  - Allowed after merge.

### Nits
- **W1G-N1 OPEN: the annulus test samples only mid-span.**
  - Where: `engineGeometry.test.ts:88-111` tests one point per x at mid-span, 9 x per component.
  - Failure: a disk rim, a drum or a case wall that pokes into the annulus anywhere else passes. The probe finds 0 intrusions over every part-loop vertex today, so this is a gap, not a bug.
  - Fix: test every part-loop vertex against every component annulus (the probe's loop), at both presets.
- **W1G-N2 OPEN: the browser test cannot see a blank or broken frame.**
  - Where: `tests/browser/engineView.test.ts` asserts zero GPU errors and a triangle count only, at `quality: 'test'`, with the worker on one preset.
  - Failure: a broken rotor composite, a NaN uniform or a camera inside a part all pass.
  - Fix: read the canvas back per preset and assert coverage and mean-luminance bands, with one preset at `high`.
- **W1G-N3 OPEN: cleanup and error paths in the render module.**
  - Device leaks:
    - `createEngineView` leaks the device if `renderer.init()`, the HDRI fetch or `buildEngineGeometry` throws after `createEngineDevice` (`engineView.ts:80-99`).
    - `dispose()` drops a rejection: `void Promise.resolve(renderer.dispose()).then(...)` leaves the device alive with an unhandled rejection.
  - Worker:
    - a message that arrives before `init` resolves throws "init first";
    - a device loss reaches the main thread only inside a later `rendered` reply (`worker.ts:65-83`).
  - Fix: destroy on any init failure; queue messages until ready; post a `gpu-error` message from `onError` (part of the gpuDevice.ts → `src/gpu/device.ts` swap).
- **W1G-N4 OPEN (cross-branch): two notice files and no licence text.** After the merge, `NOTICE` (w1/cycle, the pyCycle maps) and `NOTICE.md` (this branch, the CC0 HDRI) sit side by side. Merge them into one `NOTICE`. Apache-2.0 §4(a) also asks that recipients get a copy of the licence, so add `LICENSES/Apache-2.0.txt` before anything is published.
- **W1G-N5 OPEN: `src/lookdev/main.ts` counts as 0 % in the unit coverage.** It is a page entry like `src/render`. Exclude it in `vitest.config.ts`, or move its logic into a pure module.

**Verdict w1/geometry @93e9877: MERGE, with the look-dev fix round already planned.**
- The code is sound: pure, deterministic geometry with real topology checks, worker-safe rendering, and errors routed rather than swallowed.
- The visual quality is below the bar, and the look-dev round takes it with D3-1's studio look: LD-1..LD-6, refined above, plus V1-V5.
- I1 and I2 are allowed after the merge, as the round's first tasks. The nits go to the same round.

## Critic pass 3: trial merge (w0/gpu-spikes @d1cb041 → w1/cycle @5d17120 → w1/geometry @93e9877)

- **Merge:** sequential `git merge --no-ff --no-commit`, on a detached HEAD at the critic's HEAD (main 738ac4a plus this log), with a scratch commit between steps. All three steps are **clean, with no conflicts**:
  - **gpu-spikes:** clean. It already contains main up to b5c2736.
  - **cycle:** clean, though it is based on 3969af7 (before w1/mesh).
  - **geometry:**
    - ENGINE_FACTS.md auto-merged. The cycle's "Cycle model calibration" text is now stale (W1C-I3).
    - `vitest.browser.config.ts` keeps gpu-spikes' version (no `passWithNoTests`).
    - `NOTICE` and `NOTICE.md` now sit side by side (W1G-N4).
- **Gates on the combined tree:**
  - `npm run mesh`: byte-identical to geometry's committed outputs (hashes 130k 33c76df6, 80k 6f316568; manifest, SVGs and metrics unchanged). The build's prebuild also left the manifest unchanged.
  - `npm test`: 1406 passed (61 files), exit 0. That is 972 on main + 135 (gpu-spikes) + 102 (cycle) + 197 (geometry).
  - `npm run lint`: clean. `npm run typecheck`: clean.
  - `npm run coverage`: lines 98.57 %, statements 97.66 %, branches 88.04 %, functions 98.35 %. Every threshold passes: src/cycle lines 100 %, src/thermo 100 %, src/geometry 99.62 %, tools/mesh 99.21 %, spikes/lib 100 %.
  - `npm run test:mesh`: 29 passed. `npm run build`: ok.
  - `npm run test:gpu`: 15 passed. `npm run test:browser`: 16 passed (3 files: interop 12, chrome-gpu 2, engineView 2).
  - Quiet reruns of gpu-spikes' `test:gpu` (no Stryker running): 15/15 three times. So W0G-N7 fails only under load.
- **Restore:** back to branch `critic`, then the generated `public/mesh/*.bin` and `dist/` removed. The builder worktrees are untouched: `git status` is clean at d1cb041, 5d17120 and 93e9877. The critic's Stryker scratch configs in the cycle worktree are removed, and its `.stryker-tmp/critic*` sandboxes were cleaned by Stryker.
- **Cross-branch findings:** W1C-I3 (the A8/A18 tie and the stale facts text) and W1G-N4 (the notice files). W0G-N5 also matters for W1G-I2's measurement: a heavy preset below 30 fps would read as INVALID.

**Orchestrator decisions needed (pass 3):**
- (l) **W1C-I1:**
  - Do the MPA (N1 65 %) and idle ground-run points become validation tests?
  - With which tolerances (suggestion: EGT ±25 K, N2 ±1.5 points)?
  - Are the ground-run loads (bleed, extraction) model defaults, or test inputs?
- (m) **W1C-I2:** either derive the Greitzer B and characteristic from the engine and let the episode end on recovery, or relabel the surge row of the fidelity ledger and correct the plan's "100-300 ms surge cycles".
- (n) **W1C-N2:** T3's reference. Run one NASA CEA frozen point, or reword T3 as "frozen complete-combustion JANAF mixture" with a ledger note (no dissociation).
- (o) **W0G-N5:** amend D2-11's throttle rule so that a slow load (3-10 display intervals per frame) is a warning and only a ~1 Hz cadence is INVALID. This is needed before P2/L13 on heavy presets.

## Critic pass 4: w1/lookdev @09c6a11

Reviewed 2026-10-26 by the pass-4 critic: the branch diff from ca0f264 (45 files: `src/geometry/{parts,engineGeometry,visibility,struts,explode}.ts`, `src/gpu/passTimings.ts`, `src/render/**`, `src/lookdev/main.ts`, `tools/lookdev/capture.ts`, the tests, LOOKDEV, GPU_FACTS M36-M42, NOTICE and LICENSES), the eight new screenshots in `docs/look-dev/` against the seven in `docs/look-dev/before/`, under D3-1 (studio), D3-7 (performance acceptance waits for a quiet AC re-measure) and D3-8 (the procedural studio and the Apache licence file accepted).

Checklists applied: typescript-reviewer, silent-failure-hunter, pr-test-analyzer, and the three/WebGPU pitfalls in GPU_FACTS (M15-M17 device ownership and error routing, M37 node-frame ids, M12 timestamp quantization). Nothing was timed (D0-1: battery, another agent running); no `bench:*` and no capture timing run.

New probe: `docs/reviews/probes/w1l-culling.browser.probe.ts.txt` (a browser probe). For every closed view, plus two orbit poses a user can reach (straight into the intake, and up the core nozzle from behind), it compares the frame with culling on against culling off, at quality `high`, with the on/on difference as the noise floor.

**Gates at HEAD** (rerun in the builder worktree; tracked files unchanged):
- `npm test`: 1445 passed (63 files, 49.7 s), exit 0.
- `npm run lint`: clean. `npm run typecheck`: clean.
- `npm run coverage`: lines 99.57 %, statements 98.65 %, branches 88.54 %, functions 99.55 %. Per directory: src/geometry lines 99.56 % (branches 90.07 %), src/cycle 100 %, src/thermo 100 %, src/gpu 99.04 %, tools/mesh 99.21 %. Every threshold passes.
- `npm run test:mesh`: 29 passed.
- `npm run test:browser`: 18 passed (3 files: interop 12, chrome-gpu 2, engineView 4). Zero WebGPU errors, and no warnings in the output. Every preset renders at `test`; `hero` and `cutaway` render at `high`.
- The handoff's numbers are confirmed.

**Items, checked against their commits:**
- **W1G-I1 FIXED (270c652 TDD / b1da8f9).** `xsBetween` and `dedupe` merge samples closer than `X_MERGE` = 1e-6 m (`parts.ts:84-108`, `:129-145`); both ends are kept exactly. `tests/unit/geometry/lookdev.test.ts:52-100` runs boundary, non-manifold, misoriented and degenerate counts, positive volume and simple CCW loops for every part, row and strut, for every key of `GEOMETRY_QUALITY` (so `high` too, and any preset added later). The pass-3 probe's 384 non-manifold fan-case edges are gone.
- **W1G-N1 FIXED (same commits).** Every part-loop vertex against every component annulus, 1 mm inside the walls, at both presets. The liner skips it through `decorative`, which is honest: the solver sees the definition's annulus, not the liner.
- **W1G-I2 FIXED for the method, OPEN for the number (D3-7).** The per-pass timer is sound (see "Timing method" below), but the capture's timing protocol is not D0-1 (W1L-I4), and the worker's timings were not run.
- **W1G-N2 FIXED (48c60ca).** The canvas is read back per preset (mean, structure, black fraction, centre contrast), `high` renders `hero` and `cutaway`, and the worker runs with messages queued before init. Only 2 of the 8 presets run at `high` (W1L-N4).
- **W1G-N3 FIXED (48c60ca).** `createEngineView` destroys the device on any failure after it exists (`engineView.ts:117-129`). `dispose()` awaits three and records a rejection (`:342-355`). The worker serializes messages through a promise chain, so a message sent during init waits for it (`worker.ts:106-113`), and it posts `gpu-error` from `onError` at once.
- **W1G-N4 FIXED (09c6a11, D3-8).** One NOTICE, `NOTICE.md` and the HDRI removed (no references left outside the old handoff and the screenshots), `LICENSES/Apache-2.0.txt` holds the full terms (sections 1-9, "END OF TERMS AND CONDITIONS").
- **W1G-N5 FIXED.** `src/lookdev/**` is excluded from unit coverage in `vitest.config.ts`.
- **D2-4 device swap, checked.** `src/render/gpuDevice.ts` is gone. The view uses `requestSimDevice` (addEventListener error routing that three's `onuncapturederror` assignment cannot clobber, M16; intentional-destroy-aware loss reporting, M17) and `createRendererOnDevice` (it checks that three adopted the device and is not in compatibility mode). No DOM in `src/render`; `setSize(w, h, false)`; the studio is procedural, so the worker fetches nothing.
- **LD-6 culling, checked.** `src/geometry/visibility.ts` hides a part or row only if every vertex lies inside the inner body or inside the core cowl between the sight limits (the first booster stator's TE, the last LPT stator's LE). It is applied only when `cut === 0 && explode === 0` (`engineView.ts:315`), so the cutaway and the exploded view draw everything, from the first frame of a transition. The unit tests pin both directions, but only geometrically. The browser test compares triangle counts only. **The pixel comparison fails: culling removes visible geometry in five of the seven closed views (W1L-I1).**
- **LD-1..LD-5, V1-V5:** see the visual review.

**Code, checked and sound:**
- `passTimings.ts` is pure and tested. Unknown labels fall into `other`, which still counts in the total, and the timer warns once per unclassified label.
- `passTimer.ts` labels three's timestamp uids through an `InspectorBase` and resolves without blocking. It drops stale labels after 8 frames, so a pool overflow cannot leak memory.
- The renderOrder (skins first, the cyclorama last) is correct and cheap, and so is the static shadow map, re-rendered only while the engine moves. The culling *mechanism* is right too: it is applied per mode, and the cutaway and exploded views stay complete. Its sight limits are not (W1L-I1).
- The fan-blur march (`post.ts:162-290`) is careful work: it is limited to the fan's swept volume, and it never takes the spinner or a booster blade as a fan hit.
- No new dependencies. The TDD commits (270c652, 3c260e8, a33646c) are test-only.

**Timing method (for the orchestrator's quiet AC run, D3-7):**
- **GPU-only, per pass.** three writes a timestamp pair at the begin and end of every render pass (`timestampWrites`), and `passTimer` reads three's per-uid durations. So each number is GPU execution time of one pass, independent of the thread that encoded it and of CPU load (CPU load still lowers the shared clock on the Arc 140T, which is why D0-1 applies anyway). CPU encode time is separate (`performance.now()` around `frame()`).
- **Complete for render passes.** Shadow, Opaque, Rotors, AO, the Composite RTT, TRAA, DoF and its Gaussian blur, every bloom mip, and the final output quad are all labelled. Anything new lands in `other`, which is in the total.
- **Not included, so "GPU total" is a lower bound on GPU frame time:**
  - work outside render passes (texture copies, mipmap generation, the query resolve itself);
  - the browser compositor's copy and present of the canvas;
  - bubbles between passes;
  - compute passes: only `'render'` is resolved, so W2's solver needs `'compute'` as well.
  
  Put this bound next to an upper bound: the serialized `onSubmittedWorkDone` round trip that pass 3 criticised. A frame that fits the budget on the lower bound but not on the upper bound needs a closer look.
- **Unquantized only in the capture.** The capture launches Chrome with `--enable-unsafe-webgpu`, so timestamps are exact. The look-dev overlay in a normal Chrome is quantized to 65.5 µs steps (M12), which biases the short passes, so quote only capture numbers.
- **The protocol is not yet D0-1** (W1L-I4).
- **The command:** see W1L-I4.

**Visual review, new against before** (1920x1080; crops at 1.2-2x for the details):

What now reads right:
- **The studio (LD-3, D3-1).** It reads as a product shot: an infinity cove, soft key shadow, a contact shadow, and long strip highlights on the nacelle (01, 02). The black void and the bloom halos are gone.
- **The nacelle (LD-2).** It is satin white instead of glossy plastic, with no texel-block reflections (before/01 against 01).
- **The lip (LD-2).** It reads as brushed aluminium, not chrome (05).
- **Materials (LD-5, V2).** The cutaway materials are no longer uniformly chrome: matte cases, dull superalloy, a ceramic liner. The tube highlights on the core blades are gone (before/07 against 07).
- **Caps (LD-4).** The cut faces are a distinct red-orange with a crisp anti-aliased hatch (03, 07).
- **Combustor (LD-4).** It now reads as an annular liner with a dome (07).
- **V1.** The turbine-blade silhouettes are smooth.
- **The spinner's spiral (V4)** reads, in 05 and 06.
- **The exploded view (V5).** The fan shows clear of its case, and the plug is inside the frame (04).
- **Moiré (V3).** The acoustic-liner moiré is gone.

This is a large step from the pass-3 shots. It does not yet read as a premium product render of a real engine. Most of what remains is in the fan, which every hero and default shot is built around (W1L-I1, I2, I3), then the nits (W1L-N1, N2).

### Blocking
None.

### Important
- **W1L-I1 OPEN: the closed-engine culling removes visible geometry.**
  - Evidence: the probe (`w1l-culling.browser.probe.ts.txt`, at `high`, run on the trial merge). It counts changed 16 px tiles, culling off against culling on; the noise floor is the on/on difference.
    - `hero`: 48 tiles change (noise floor 0); 25 with shadow lookups off.
    - `fanIdle` 34 (32 without shadows), `fanTakeoff` 30 (30).
    - An on-axis look into the intake: 35 (37).
    - A look up the core nozzle from behind: 24 (24).
    - `threeQuarterFront` and `side` sit at the noise floor.
  - The shadow-free runs rule out a culled part's shadow as the cause.
  - The diff images place the changes:
    - beside the hub on the far side of the fan, where the booster rows behind the first stator show through the fan gaps (the same area as the fan "blotches", see W1L-I3);
    - in the core-nozzle annulus, where LPT stages 1-3 show through the last stage.
  - Where:
    - the sight limits in `src/geometry/visibility.ts:31-43` (the first booster stator's TE, the last LPT stator's LE) and the test at `:60-63`;
    - the browser test checks a triangle ratio only (`tests/browser/engineView.test.ts:137-147`).
  - Failure:
    - the committed `00-hero`, `05-fan-idle` and `06-fan-takeoff` were captured with these rows missing;
    - any user orbit into the intake or the nozzle shows the gaps;
    - the frame times were measured on a draw set that is too small.
  - Fix:
    - keep every booster row and every LPT row in the closed set: move `xFront` aft of the booster's last row, and `xRear` ahead of the first LPT row;
    - the HPC and HPT rows, the cases and the disks are still culled, and they are the bulk of the hidden triangles;
    - make the probe's check a browser test over every closed preset plus the two orbit poses (on/off within the noise floor);
    - regenerate 00, 05 and 06.
  - Allowed after merge: the first task of the follow-up round, before the D3-7 re-measure.
- **W1L-I2 OPEN: the rotor pass is lit by an unshadowed key, so the fan is lit through the nacelle.**
  - Where:
    - `src/render/studio.ts:210-217` copies the key and the rim into `rotorLights` with no shadow;
    - the rotor scene holds only rotating parts (`engineScene.ts:66-73`), so nothing in it can occlude them;
    - the comment at `materials.ts:314-318` ("direct light keeps the key's shadow map") holds only for the main scene.
  - Failure, in 00, 01, 05 and 06:
    - the fan blades are near paper white, with span-long streaks from the anisotropic highlight;
    - the inlet barrel just above them is in the lip's shadow;
    - the booster blades and the spinner get the same unshadowed light.
  - The geometry says the whole fan face is in shadow. The key sits at (-1.2, 7, 3.2) and aims at (1, 0, 0). A ray from a fan point toward it crosses the inlet highlight plane about 2.8 m off the axis, far outside the ~0.8 m inlet. A real intake is lit through its mouth only: the front strip and the image-based light.
  - Fix: shadow the rotor pass's direct light. Either:
    - sample the main key's shadow map in the rotor materials (the same shadow matrix, as a TSL lookup);
    - or use an analytic aperture test per light: is the ray to the light still inside the inlet radius at the highlight plane?

    Then re-balance the exposure and the front strip.
  - Allowed after merge (follow-up round).
- **W1L-I3 OPEN: the fan blur still breaks up in the hero, default and fan shots.**
  - The pictures:
    - 00 (hero): a dark and light "comb" radiating from the hub at 4-6 o'clock, and stair-stepped blotches at 7-8 o'clock;
    - 01 (default): the blades are ragged, feathery white smears;
    - 05: the far side, 1-6 o'clock, is shredded (black voids and torn slivers, about a third of the disc), and the leading edges on the left are stair-stepped;
    - 06: dark scalloped crescents in the lower left of the disc, and dotted dark streaks right of the hub;
    - the probe's on-axis view: the far half is near black with torn fragments (part of that is the metal reflecting the dark room).
  - This is more than the handoff's "small blotches".
  - Cause:
    - the march reprojects into one rasterised rotor image (`post.ts:243-258`), so a turned-back point that lands on a disoccluded or edge-on region has no data;
    - the switch between the own-surface estimator and the march (`fanAngle < 0.6 pitch`, `:235-242`) shows as blotch edges;
    - the booster seen through the fan is unblurred.
  - Fix, the builder's own NEXT 3: a stochastic, time-sampled fan render. Each pixel keeps the fragment of one of N time-offset fan instances (a per-pixel, per-frame hash), depth-tested within that sample, with zero velocity into TRAA. It is exact in the limit. The other option is N instanced time copies into an accumulation target (N times the fan's triangles).
  - Acceptance needs a ground truth:
    - per shot (fanIdle, hero, fanTakeoff): the mean of 64 renders at shutter 0, at angles spread over the exposure (an exact box shutter);
    - a mean absolute error and worst-tile bound against it, committed beside the shot.
  - Judge it after W1L-I1, because the culled rows sit in the same pixels.
  - Allowed after merge (follow-up round).
- **W1L-I4 OPEN: the timing harness is not D0-1, so the D3-7 quiet run cannot use it as it is.**
  - Where: `tools/lookdev/capture.ts:113-147`, `src/lookdev/main.ts:158-168`, `src/render/passTimer.ts:47`.
  - Failure:
    - 30 warm-up frames (0.5 s), then 150 timed frames (2.5 s), one run, a fixed config order. D0-1/D2-12 ask for a 10 s warm-up before each of 3 × 60 s runs, in a seeded rotated order.
    - `timeFrames(n)` returns the timer's rolling 120-frame window, not the n frames: a 60 s run would report its last 2 s, and n < 120 mixes in the previous config.
    - The JSON note is hard-coded ("indicative ... D0-1 not applied"). The header says the script "records the load it cannot control", but it records no conditions: power source, power plan, Chrome version, adapter.
    - There is no validity check (D3-6: the occlusion signature, page hidden or blurred).
    - The worker's timings were never run (W1G-I2 asked for them).
  - Fix:
    - flags `--warmup-s`, `--run-s`, `--reps` and `--seed`;
    - reset the stats at the start of each run and keep every frame (median, p10 and p90 per pass);
    - rotate the configs;
    - record `navigator.getBattery()` charging, `powercfg /getactivescheme`, the user agent and the adapter info, and the rAF intervals and visibility events;
    - mark a run INVALID per D3-6;
    - add a `--worker` mode through the worker's `timings` message;
    - keep the official set small (the default, `cutaway`, `hero`: about 11 min), and run the A/B diagnostics once at 20 s each.
  - **The quiet re-measure command (D3-7)**, after this fix, on AC with nothing else running:
    - shell 1: `npx vite --port 5184 --strictPort`;
    - shell 2: `node tools/lookdev/capture.ts --only none --warmup-s 10 --run-s 60 --reps 3 --seed 1` (the flag names as the fix defines them).

    Today's `node tools/lookdev/capture.ts --only none` gives only a 2.5 s, single-run median per config.
  - Allowed after merge; due before the quiet run.

### Nits
- **W1L-N1 OPEN (visual): the closed engine still reads as a CG capsule.**
  - The nacelle is a smooth white shell. It has no fan-cowl latches, hinge or access panels, thrust-reverser translating-sleeve split, pressure-relief doors, drain mast or stencils. Its joints are 1.1 mm half-width lines, invisible beyond a few metres (02).
  - The engine floats about 0.37 m above the floor with no stand or pylon stub (01, 02). The nacelle's lowest point is about 0.95 m below the axis, and the floor is at -1.32 m. A transport cradle or a pylon stub would ground it.
  - In 00 and 01 the spinner reads as glossy dark chrome: a dielectric at roughness 0.42 on a 0.035 base mostly mirrors the softboxes. The spiral reads only in 05 and 06.
  - 04's framing is loose: the engine fills the middle third of the frame.
- **W1L-N2 OPEN (visual): cutaway render defects.**
  - 03: the lower inner-barrel acoustic-liner panels render solid black (albedo 0.2 × cavity 0.5, in the key's shadow), with a stair-stepped edge along the cap. They read as holes.
  - 07: a coarse, sandpaper-like speckle on the grey cases, the liner and the shafts at close range, and a white crumbly patch between the liner and the outer case (around x 770-1000, y 380-440). Tell GTAO noise from the shadow filter with `?debug=ao` and with `noShadow`.
  - 07: the heat tint is now so low in chroma that the hot section reads neutral grey.
- **W1L-N3 OPEN (question p): the plug and centre body are still the definition's ogive (LD-4).** It reads right in profile (02), but as a bulbous bullet in section (03, 07). Changing it is a definition and mesh change, so it needs an orchestrator decision against a public CFM56-7B dimension.
- **W1L-N4 OPEN: test gaps.**
  - Only `hero` and `cutaway` run at `high`. Every preset at `high` costs about 2 s more.
  - The culling test compares triangle counts, not pixels (W1L-I1's fix adds the pixel test).
- **W1L-N5 OPEN (silent failure): a dispose failure is dropped on the init-failure path.** At `engineView.ts:126`, `await Promise.resolve(renderer.dispose()).catch(() => undefined)` drops a dispose rejection. Attach it to the rethrown error (as `cause`) or send it to the error sink.
- **W1L-N6 OPEN: "fill-bound; more culling will not help" (GPU_FACTS M42, LOOKDEV) is premature.**
  - The same table has opaque 6.06 ms with culling off against 6.76 ms with it on.
  - It has 9.24 ms for the scene drawn straight to the screen, against 6.76 for the opaque pass inside the full chain.
  - Both are inside the ~2x noise. Keep M42 as a hypothesis, and test it in the quiet run (culling on/off, and a 0.5-scale 3D pass).
- **W1L-N7 OPEN: timer uids can collide.** three's timestamp uid ends in `renderer.info.frame`, which only three's own rAF loop advances (`Animation.js:85`); `beginFrame` advances only `nodeFrame`.
  - Two `frame()` calls inside one rAF share uids, so the older frame's queries are overwritten.
  - A pass drawn in only one of the two frames (the static shadow) is then pushed as a frame of its own.
  - It is harmless with one frame per rAF (the capture and the worker both do that). Set `renderer.info.frame` in `beginFrame`, or document the rule.

**Verdict w1/lookdev @09c6a11: MERGE, with a named follow-up round `w1/lookdev-2`.**
- The round delivers what pass 3 asked for: W1G-I1, W1G-N1..N5, the device swap, the studio (D3-1, D3-8), and LD-2..LD-5 and V1-V5 reading right. The per-pass GPU timer is the right method. The gates are green, and the trial merge is clean.
- Nothing blocks. Main has no culling and the pass-3 look, so this branch is better in every view.
- Order for `w1/lookdev-2`:
  1. W1L-I1 (culling limits plus the pixel test, then regenerate 00/05/06);
  2. W1L-I4 (the D0-1 harness);
  3. **the orchestrator's D3-7 quiet re-measure**;
  4. W1L-I2 (fan lighting) and W1L-I3 (fan blur, against a ground truth), then a re-measure of the rotor and composite passes;
  5. the nits.
- For D3-2: the committed 00, 05 and 06 show the W1L-I1 gaps and the W1L-I3 artefacts. Showing Aaron the shots after step 1 would avoid reviewing a known defect.

## Critic pass 4: trial merge (w1/lookdev @09c6a11)

- **Merge:** `git merge --no-ff --no-commit w1/lookdev` on the critic branch (main ca0f264) is clean: 45 files, no conflicts. The branch sits directly on ca0f264.
- **Gates on the combined tree:**
  - `npm run mesh`: the manifest is unchanged (130k 33c76df6, 80k 6f316568), and the worst-cell report matches MESH.md.
  - `npm test`: 1445 passed (63 files).
  - `npm run lint` and `npm run typecheck`: clean.
  - `npm run coverage`: lines 99.57 %, statements 98.65 %, branches 88.54 %, functions 99.55 %; every threshold passes.
  - `npm run test:mesh`: 29 passed. `npm run build`: ok.
  - `npm run test:browser`: 18 passed. The critic's culling probe, copied in, fails as W1L-I1 describes (the only failure).
- **Restore:** `git merge --abort`, then the probe copy, its diff images, `dist/` and the generated `public/mesh/*.bin` removed. The builder worktree is untouched: `git status` is clean at 09c6a11. Nothing was timed.

**Orchestrator decisions needed (pass 4):**
- (p) **W1L-N3:** keep the definition's plug and centre-body ogive, or check it against a public CFM56-7B dimension (a definition change: mesh regenerated, `test:mesh` rerun).
- (q) **D3-2 timing:** show Aaron the W1 shots now, or after `w1/lookdev-2`'s first task (W1L-I1).

## Critic pass 5: w1/cycle-calib + w1/cycle-calib-2 @8a962c4

Reviewed 2026-10-26 by the pass-5 critic: the stack tip `w1/cycle-calib-2` @8a962c4 (which contains `w1/cycle-calib` @1e5e5b7) against main 8f066af as one unit. The stack branches from ca0f264, so the review diff is `ca0f264...8a962c4` (43 files; the two-dot diff against main also shows main's look-dev merge as reverted, which the merge does not do). Judged under the new orchestrator decision **D3-15** (accept the residual part-power gap for W1: the C10/C11 KNOWN-FAIL markers stay visible, the gap is in the PHYSICS.md fidelity ledger with its likely cause, part-power map fidelity goes to the backlog). Checklists applied: typescript-reviewer, silent-failure-hunter, pr-test-analyzer. Stryker not run (D3-13).

New probe: `docs/reviews/probes/w1k-calib.probe.ts.txt` (the reference at every C10/C11/C4 point, the VBV schedules, and the 33.73(a) slam on the reference and on the rejected fit).

**Gates at the stack tip** (rerun in the builder worktree; tracked files unchanged afterwards):
- `npm test`: 1538 passed, **5 expected fail** (1543 tests, 67 files), exit 0, 50 s.
  - The 5 are `it.fails`: C10 MPA N2, C10 MPA EGT, C10 idle position 2 N2 (`tests/unit/cycle/c10.test.ts:86-91`), C11 approach and idle (`tests/unit/cycle/c11.test.ts:78`). Each flips red if it starts passing. Each check has a plain `it` convergence test beside it, so an `it.fails` cannot pass on a solver exception or a missing point. The labels' stated reasons are stale (W1K-I1).
- `npm run lint`: clean (ESLint, Prettier). `npm run typecheck`: clean.
- `npm run coverage`: lines 98.55 %, statements 97.62 %, branches 87.43 %, functions 98.46 %; every threshold passes. Per file: `engine.ts` lines 100 % / branches 91.2 %, `partPower.ts` 100 / 92.9, `model.ts` 100 / 98.4, `surgeSystem.ts` 98.3 / 75.0, `boundedLeastSquares.ts` 95.7 / **69.9**; `src/thermo` lines 100 %.
- `npm run test:mesh`: 29 passed.

**Pre-registration (D3-3, D3-11, D3-5).**
- C10: 6009cdd (10:29) is the stack's first commit and touches only PHYSICS.md 3.2, `thresholds.ts` and `thresholds.test.ts`. The first `src/cycle` change is b918b75, after it.
- C11: 5f035f3 (17:01) is `w1/cycle-calib-2`'s first commit, with the same three files. The mechanisms arrive later (0b69ed6 TDD, dd13fcd).
- The wording is D3-3's and D3-11's, word for word (C10: idle 436-523 C, MPA 585 ± 30 C, takeoff 855 ± 30 C, N2 ± 1.5 points at 60.6 / 60.7 / 89.3 / 99.8 %; C11: 7 / 30 / 85 % rated thrust, ISA SLS, ± 5 %). `thresholds.test.ts` pins 30 K, 1.5 points, 0.05, 7 / 30 / 85 and the count 4 + 11 + 13 + 3.
- T3 is reworded per D3-5 at 041cf2d, with PHYSICS.md and `thresholds.ts` changed together. The tolerance stays 0.5 %.
- Across the stack the `thresholds.ts` diff only adds lines. Nothing was loosened. The surge ledger row's "100-300 ms" became "period from the derived Helmholtz frequency" (D3-4).

**Physics: the mechanisms, their sources and bounds.** None acts at the design point. `partPower.test.ts:213-230` checks that on the rejected fit: the sizing is identical to 1e-12, there is no VBV or VSV offset, and the design residual is under 1e-9. C1-C3 pass.
- **Combustion efficiency from the EEDB EIs (D3-14 (a), in the reference).**
  - The rows (8CM066: CO 0.31 / 0.17 / 2.82 / 29.39 g/kg, HC 0.03 / 0.02 / 0.05 / 1.54 g/kg) are `official` ENGINE_FACTS rows, with the NME test-engine status stated.
  - eta = 1 - (EI_CO Q_CO + EI_HC Q_fuel) / (1000 Q_fuel) is the ARP1533 energy balance. Q_CO = (393.52 - 110.53) / 28.01 = 10.10 MJ/kg is right (JANAF).
  - By hand: idle 0.841 % against 0.0103 % at takeoff, so -0.83 % relative; approach -0.06 %. Both are pinned in `partPower.test.ts:115-123`.
  - The design knot is the takeoff fuel flow, so the relative efficiency is exactly 1 at the sizing point and is held above it. It enters the C8 books: `engine.ts:837` uses the same `etaB`.
  - It is data, not a fit, so putting it in the reference does not break the adoption rule, and every gate passes with it. The corrected-fuel-flow key leaves out the pressure effect at altitude (W1K-N3).
- **Fan / booster part-speed loss.**
  - [SDT] Table 3 (the R4 fan at 61.7 / 87.5 / 100 % speed) against the map's +3.1 / +1.4 point rise on the model's own operating line gives the 3.2-4.2 point loss. The arithmetic checks.
  - The form scales the map efficiency by (1 - loss / eta_des), so no efficiency goes negative.
  - The booster's 0-4.2 range has no data; it is capped at the fan's falloff, and the text says so (`estimate`).
- **LPT Reynolds lapse.** (1 - eta) grows by (Re/Re_des)^-n, with Re ~ P / (sqrt(T) mu) at a fixed corrected point, which is the right index at constant Mach. n = 0-0.2 comes from Dunham-Came ([AMDC]). The implementation gives exactly 1 - eta_new = (1 - eta)(Re ratio)^-n at the design level. Floored at 1e-3 for standstill.
- **HPC Reynolds lapse.** It reuses the turbine bound because no compressor correlation was verified. This is marked `estimate` honestly, and it acts only in the rejected fit (W1K-N5).
- **HPT clearance.** k (1 - (N2/N2des)^2), 2-4 points, from [LS02]. The reference already had 4 points from W1C-I1, and the fit lands on the same 4.
- **VBV / VSV.**
  - The VBV dump leaves at h24 and joins the bypass stream, conserving mass and energy (C8 at a VBV point, `offdesign.test.ts:67`).
  - The VSV flow sensitivity, 0.688 per rad, comes from the definition's IGV / rotor-1 velocity triangle and is checked against a numerical derivative.
  - The ±6 deg bound uses [VGV]'s implanted mis-rig as "beyond this it would read as a fault". That is a defensible upper bound, and the text states it.
  - Both schedules use N2 corrected to T2, while the [QAR] CFM schedule is on N2K25 (W1K-N2).
- **Probe share.** It is fitted in [0.25, 0.45] per D3-14 and lands at 0.385, inside. The reference keeps the D2-3 value 0.35, which is also inside.
- **W1C-I1's own mechanisms (cycle-calib).** Mechanical loss ~ N^2, (1/eta_m - 1) of the design compressor power, which is exact at design. The cold duct and combustor losses go with (W sqrt T / P)^2 (Walsh & Fletcher 5.10-5.11). The silent 0.5 cap on the cold losses is W1K-N4.

**The fit tool and the solver.**
- `tools/cycle/fit-part-power.ts` is deterministic and documented in its header and in ENGINE_FACTS "Fit procedure": a fixed start (the middle of each bound), fixed forward differences, no randomness. `--relax` is a diagnostic only and never written.
- `boundedLeastSquares.ts` is a standard projected LM in scaled variables. Its tests cover a row swap, a singular matrix, Rosenbrock, the active bound, a failed step, the backward difference, a failed Jacobian, determinism and onStep. The 69.9 % branch figure is mostly `?? 0` arms.
- "No descent step at any damping" is reported as `converged` (W1K-N1).
- `partPower.test.ts:261-276` checks that two more LM iterations from the committed values gain under 0.1 % in cost and move every value less than 1 % of its bound width. That is a fair bounded-optimum check.

**The adoption rule (D3-14).**
- `CYCLE_CALIBRATION` (`engine.ts:213-249`) spreads `W0_CALIBRATION.partPower`. The fan and booster losses, both Reynolds exponents and the VSV offsets are 0. The probe share stays 0.35, and the VBV comes from the `unknown` facts rows (0.25 / 70 / 85 %).
- Only the combustion table and the VSV sensitivity, which does nothing at zero offset, are added.
- `partPowerFit.ts` is read only by `PART_POWER_FIT_CALIBRATION`, which is used in no `src` module, only in `partPower.test.ts`. `partPower.test.ts:79-88` pins the reference with its mechanisms off.
- **The rejected fit is not in the reference.** The text around it says otherwise in places (W1K-I1).
- The rejection itself (10 transient tests fail on the fit) was run on a scratch copy. The critic reran the 33.73(a) slam on the committed fit (probe `w1k-calib`): it surges and hangs at 10.7 kN, so the rejection is right, though its recorded reason is incomplete (W1K-I2).

**Pass-3 items.**
- **W1C-I2 / D3-4: CLOSED.** `surgeSystem.ts` derives A_c, L_c = A_c * integral dx/A, V_p (stations 3-4) and the rotor-1 tip from the definition. B = U / (2 omega_H L_c) at the current N2 (0.187 at SLS takeoff, omega_H 1012 rad/s, Helmholtz period 6.2 ms). The cubic peak sits on the map's stall point. The throttle goes through the matched point, and the episode ends on the Greitzer state's recovery, capped at 5 s. `surge.test.ts:109-120` asserts B > criticalB inside the surge line and reverse flow at the derived period. criticalB's closed form, RK4 order 4 and Helmholtz with L != 1 kill the pass-3 greitzer survivors. The ledger row is reworded per D3-4.
- **W1C-I3: CLOSED.** `engine.test.ts:71-90` pins the sized A8 / A18 to the facts within 5e-4 and the station 8 / 18 annuli within 1e-9. D2-2 was redone (0.1851 / 0.9162 m^2), with the mesh regenerated and `test:mesh` at 29/29.
- **W1C-I4: CLOSED** (mutation follows D3-13). `offdesign.test.ts` adds:
  - C7/C8 with bleed + extraction + VBV, at M 0.25, and at 35 kft M 0.8 at the published max-climb thrust, with the pressure thrust recomposed and OPR 32.63 against 32.7;
  - a design residual under 1e-9;
  - the throat against an independent max-flux search;
  - the surge margin at a hand-computed point;
  - the product composition against Cantera within 1e-5;
  - the shunt ramp.
- **W1C-I1: ACCEPTED as the D3-15 gap.** The part-power physics is in, and the residual is in the ledger.
- **N1-N5: CLOSED.**
  - N1: N2 from TM-4513, with JANAF at 200 / 250 K and +0.001 % at 200 K against Cantera.
  - N2: T3 reworded per D3-5, with an independent frozen composition.
  - N3: the sizing secant throws on a miss.
  - N4: the comments fixed and at() used.
  - N5: 955 C for at most 20 s, then 945 C, with a time-aware `egtExceedance`. The N1 limiter is 0.5 point under 104 %, and the 30 C corner makes rated thrust.

**The Cantera cross-check (D3-5)** is documented: `tools/thermo/cantera_crosscheck.py`, a venv outside the repo, and the printed values carried into `gas.test.ts`.
- It is independent of the model: nasa_gas.yaml, Cantera's own mixing, and the product composition from Cantera's equilibrium at 1000 K. My hand check gives CO2 13.29 %, H2O 12.71 %, N2 73.12 %, Ar 0.87 %, matching.
- The dissociation note in PHYSICS.md 2 (0.23 % at 1641 K and 2.8 MPa) comes from the same script.

**The fidelity-ledger entry** (PHYSICS.md 1) is honest:
- the bounded fit's result (C11 approach -6.4 %) and why it is rejected;
- the reference's gap (MPA 536 vs 585 C, N2 2.6 points low, EEDB -12 % / -10 %);
- the likely cause (generic scaled pyCycle maps too efficient at part power);
- the dataset difference (NME test bed vs an on-wing, likely deteriorated engine).

The ENGINE_FACTS "What binds" and "Likely cause" sections agree with it.

**Probe `w1k-calib` at the reference** (the values the `it.fails` markers see):
- **The five markers miss:** C11 approach -12.3 % and idle -9.7 %; C10 MPA N2 86.71 vs 89.3 % and EGT 536.4 vs 585 C; idle position 2 N2 62.23 vs 60.7 %.
- **Every other point passes:** C11 climb-out -2.5 %; takeoff N2 99.88 % / 856.0 C; idle position 1; idle position 2 EGT 461.3 C; C4 at N1 20.09 % / 414.4 C; the booster R-line peaks at 2.62.
- These match the handoff table.

### Blocking
None.

### Important
- **W1K-I1 OPEN: the text around the rejected fit and the KNOWN FAIL markers gives stale or wrong reasons.** Under D3-15 these markers are the visible record of the gap, so their reasons have to be right.
  - Where:
    - `src/cycle/partPower.ts:10` says the fit file is one "which CYCLE_CALIBRATION reads". That is false. Only `PART_POWER_FIT_CALIBRATION` reads it, and the reference is not the fit.
    - `src/cycle/engine.ts:237-241` is D3-11-round text. It says the fit "meets C10 but not C11 and costs the 33.73(a) slam its HPC surge margin: adopting it is an orchestrator decision". After D3-14 the fit meets everything except C11 approach, and the adoption rule has already rejected it.
    - `engine.ts:250-254` says the probe share is "re-derived to the measured 855 C (W0C-I6)". It is now fitted in [0.25, 0.45]. The list also leaves out the HPC Reynolds lapse and the HPT clearance.
    - `tests/unit/cycle/c11.test.ts:73-82` gives the reason as "D3-11 bounds bind". For idle that is untrue: the bounded fit meets it (-4.3 %), and the reference misses it because that fit was rejected.
    - `tests/unit/cycle/c10.test.ts:86-98` says the checks "cannot [be met] with physically justified parameters (W1C-I1 limit, orchestrator decision)". The D3-14 fit meets all three C10 markers inside the bounds.
    - `docs/ENGINE_FACTS.md:160` says "the D3-11 fit ... puts it at 0.276". The committed fit is 0.284.
  - Failure: the next calibration round, or a reader of the test output, takes the wrong cause. They may think idle fuel flow is out of reach inside the bounds, or that `partPowerFit.ts` drives the reference. Either way they look in the wrong place for the backlog item D3-15 creates.
  - Fix (text only):
    - relabel both marker sets "KNOWN FAIL (D3-15: accepted part-power gap, PHYSICS.md ledger)";
    - make the doc comments say what is true: in the reference the mechanisms are off; the bounded fit meets C10 and C11 idle/climb-out but misses approach; the fit is rejected for the transients;
    - fix the three code comments and the facts row.
  - Allowed after merge (the first cycle round, or a small fix commit before it).
- **W1K-I2 OPEN: the adoption-rule rejection is real, but its recorded reason is incomplete and nothing in the repo reproduces it.**
  - Where: ENGINE_FACTS "What binds" (last bullet), the handoff, and the PHYSICS.md ledger ("breaks the transient model"). The evidence was a scratch copy outside the repo.
  - Probe `w1k-calib`, the 33.73(a) ground-idle slam (lever to maximum in 1 s, 10 s, dt 0.02):
    - **reference:** 121.3 kN at 10 s, 95 % at 5.82 s, peak EGT 958.3 C, min HPC margin 0.034, no surge;
    - **committed fit:** min HPC margin **-0.010** with the **surge flag raised**, then a hang at N1 34.7 % / N2 75.3 %, **10.7 kN at 10 s** (the handoff's number), peak EGT 860.4 C.
  - So the rejection stands, and on stronger grounds than recorded. The committed fit itself surges in the slam. ENGINE_FACTS gives the surge margin only for "an earlier fit" and lists the 10.7 kN as a failure to reach thrust.
  - Also, the slam's surge on the fit ends in a hung engine, not a recovery. Nobody has looked at that post-surge path, because the reference never surges in the slam. W3's surge scenarios will meet it.
  - Fix:
    - correct the recorded reason (the committed fit surges in the 33.73(a) slam, min margin -1.0 %, and hangs at 10.7 kN);
    - add one pinned test that runs the slam on `PART_POWER_FIT_CALIBRATION` and expects the surge. It marks the rejection the way `partPower.test.ts:251-259` marks the C11 miss, so a future refit is checked against the adoption rule in the repo, not on a scratch copy;
    - put the post-surge hang in the D3-15 backlog item.
  - Allowed after merge.

### Nits
- **W1K-N1: the solver calls a stall "converged".** `boundedLeastSquares.ts:194-198` sets `converged = true` when no damped step lowers the cost after 20 tries. That also happens when every trial returns `null`, i.e. the solves fail all around the point, so a failing neighbourhood reads as an optimum. `partPowerFit.ts:4` prints "converged: true" without the criterion. Fix: return the stop reason (gradient, cost tolerance, no descent, Jacobian failed) and print it in the generated header.
- **W1K-N2: the VBV / VSV schedules use N2 corrected to T2** (`engine.ts:392`; called with `s2.tt`). The [QAR] CFM schedule cited for them is on N2K25. At ground idle the two frames differ by about 4 %. The knots are `unknown` / `estimate`, so this is a labelling issue. Fix: state "corrected to T2" in the facts rows and the bounds' reasons, or schedule on T25.
- **W1K-N3: combustion efficiency is keyed on corrected fuel flow** (`engine.ts:689`). At a given corrected point P3 scales with delta2, so at altitude flight idle the real efficiency falls further than the sea-level EEDB table gives (combustor loading). Fix: a ledger note, or a loading-parameter key in the backlog item.
- **W1K-N4: the duct cold loss is capped at 0.5 silently** (`engine.ts:701`). That is fine as a Newton guard, but a converged point on the cap would be unphysical and unflagged. Fix: assert in the C7/C8 sweeps that no converged point is on the cap, or expose it on the EnginePoint.
- **W1K-N5: if a later round adopts a fit, the HPC Reynolds exponent needs a compressor source.** The turbine bound reused now is honestly marked `estimate`. This is a backlog note, not a defect.

### Trial merge (w1/cycle-calib-2 @8a962c4 into the critic branch at main 8f066af)
- **Merge:** `git merge --no-ff --no-commit w1/cycle-calib-2` is clean. 43 files, no conflicts with main's look-dev merge.
- **`npm run mesh`:** no working-tree change, so the stack's regenerated mesh, manifest and metrics (after the D2-2 redo) are exactly what main's generator produces.
- **Gates on the combined tree:**
  - `npm test`: 1577 passed, 5 expected fail (69 files).
  - `npm run lint` and `npm run typecheck`: clean.
  - `npm run coverage`: lines 99.5 %, statements 98.56 %, branches 87.91 %, functions 99.58 %; every threshold passes.
  - `npm run test:mesh`: 29 passed. `npm run build`: ok.
  - The probe `w1k-calib`: 3 passed.
- **Restore:** `git merge --abort` (after an index stat refresh: the build's `mesh:assets` had touched `manifest.json` without changing it). Then `dist/`, `coverage/`, the generated `public/mesh/*.bin` and the probe copy were removed. The critic branch is back at its own commits on 8f066af. The builder worktree is clean at 8a962c4.

**Verdict w1/cycle-calib + w1/cycle-calib-2 @8a962c4: MERGE.**
- C10 and C11 were pre-registered before any tuning, word for word as D3-3 and D3-11. T3 follows D3-5 with its tolerance unchanged, and nothing was loosened.
- Every mechanism is sourced and bounded, and none acts at the design point. The fit is deterministic, and the adoption rule was applied: the reference is not the fit. The probe confirms the rejection, which is in fact stronger than recorded.
- W1C-I2, I3, I4 and N1-N5 are closed. The gap W1C-I1 leaves is honestly in the fidelity ledger, as D3-15 asks.
- The gates are green on the tip and on the merged tree.
- W1K-I1 (the marker labels and comments state stale reasons) and W1K-I2 (record the slam surge as the reason, and pin it in a test) are allowed after merge. They go to the first cycle round with the nits, the D3-15 backlog item and the D3-13 mutation runs.

**Orchestrator decisions needed (pass 5):**
- (r) **D3-15 on main:** record D3-15 in the LOG with this merge, so that the relabelled markers (W1K-I1) can cite it.
- (s) **The post-surge hang (W1K-I2):** the fit's slam surges, then hangs at 10.7 kN instead of recovering. Either add it to the part-power backlog item, or schedule a check of the surge-recovery path (FADEC fuel cut and re-acceleration) before W3's surge scenarios.

## Critic pass 6: w1/lookdev-2 + w1/lookdev-3 @ca4a33a

Reviewed 2026-10-26 by the pass-6 critic: the stack tip `w1/lookdev-3` @ca4a33a (which contains `w1/lookdev-2` @83b5ec7) as one unit. The stack branches from 8c8ed6b, so the review diff is `8c8ed6b...ca4a33a` (44 files: `src/geometry/{visibility,screenRect,engineGeometry}.ts`, `src/gpu/{renderScale,passTimings}.ts`, `src/render/{post,engineView,engineScene,materials,studio,passTimer}.ts`, `src/lookdev/main.ts`, `tools/lookdev/{capture,timing}.ts`, the tests, LOOKDEV, ENGINE_FACTS, GPU_FACTS M42-M44, the shots and `timings.json`). Judged under D0-1, D3-1 (studio product shot), D3-7 and its official result, D3-9, D3-10 and D3-16 (the rotor pass shades each pixel once; no TRAA accumulation of the fan blur). Checklists applied: typescript-reviewer, silent-failure-hunter, pr-test-analyzer, and the three/WebGPU pitfalls in GPU_FACTS (M12, M15-M17, M37, M43, M44). **Nothing was timed** (no `bench:*`, no capture timing run). Browser checks ran on the critic's own MCP page on port 5190, closed afterwards.

New probes:
- `docs/reviews/probes/w1v-geometry.probe.ts.txt` (Node): the triangles each look preset draws at `high`, by class; the fan blades the cutaway hides.
- `docs/reviews/probes/w1v-rotor-traa.browser.probe.ts.txt` (browser): TRAA on shutter-0 rotors at rest (dt 0, what the tests do) and in motion (dt 1/60, what the app and the capture do), each against a TRAA-off still at the same phase.

**Gates at the tip** (rerun in the builder worktree; its tracked files unchanged afterwards):
- `npm test`: 1468 passed (66 files), exit 0.
- `npm run typecheck`: clean.
- `npm run lint`: **FAILS.** ESLint is clean; Prettier flags `docs/look-dev/timings.json` (W1V-B1).
- `npm run coverage`: lines 99.58 %, statements 98.66 %, branches 88.60 %, functions 99.56 %; thresholds pass. Per directory: `src/geometry` lines 99.57 % (branches 90.42 %), `src/gpu` 99.26 %, `src/cycle` 100 %, `src/thermo` 100 %, `tools/mesh` 99.21 %. New and changed files: `src/geometry/visibility.ts` 98.1 % / branches 92 %, `screenRect.ts` 100 / 90, `renderScale.ts` 100 / 100, `passTimings.ts` 100 / 83.3. (`tools/lookdev/timing.ts` is unit-tested but outside the coverage include.)
- `npm run test:mesh`: 29 passed.
- `npm run test:browser`: 21 passed (5 files: interop, chrome-gpu, engineView with every preset in both profiles and the profile switches, culling, fanBlur), zero WebGPU errors.
  - Culling pixel test: every closed preset plus the axial-intake and rear-nozzle orbits, at two fan phases: within the on/on floor.
  - Fan-blur reference test (my run, bounds unchanged): fanIdle estimator MAE 0.0017 / worst tile 0.0270, shipped 0.0058 / 0.0613; hero 0.0013 / 0.0166, shipped 0.0043 / 0.0361; fanTakeoff 0.0021 / 0.0306, shipped 0.0044 / 0.0466. These match the handoff.

**Pass-4 items, checked against their commits:**
- **W1L-I1 FIXED** (552e3e4, 74271e0 TDD; 6ce5b12; view-dependent 7fb4d81 TDD / 786aba1). `closedViewLimits` sits at the combustor inlet and the first LPT row (`visibility.ts:44-54`), so every booster, HPC and LPT row is drawn. `tests/browser/culling.test.ts` is my pass-4 probe made a gate, with a fair floor (the same frame spacing for floor and on/off).
- **W1L-I2 FIXED** (5c24e0c). The rotor key (2048) and rim (1024) cast shadows from static-part proxies on layer 2 (`studio.ts:221-246`, `engineScene.ts:131-140`). three's shadow pass honours `maskNode` (`Renderer.js:3509-3554`), so the proxies follow the cut. In 00 and 05 the fan face now sits in the lip's shadow.
- **W1L-I3 FIXED for the estimator** (230b2a3 TDD, 5c24e0c, 702754e; cost a482f11). The march is gone; 8 time copies with a per-pixel pick, against a 64-still box-shutter reference. The "shipped" half of the test measures a case the app never shows (W1V-I1).
- **W1L-I4 FIXED** (401e792 TDD, bee6143, ee463c2). `tools/lookdev/timing.ts` is pure and tested. The capture runs a warm-up before each run, a seeded rotated order, every frame per run, D3-6 validity and the conditions. The official D3-7 run used it: 4 configs, all VALID. Left over: no `--worker` mode, and the render scale and GPU error count of each run are logged but not written to `timings.json` (`capture.ts:217`) (W1V-N1).
- **W1L-N1 PARTLY** (e9c7d68): panels, seams, hinge and latch lines, flush latches, doors, fastener rows, orange peel, oil canning, the satin lip band. Open: the stand or pylon, 04's framing, the flattened lower cowl (W1V-N5).
- **W1L-N2 PARTLY:** the lower inner-barrel liner no longer reads as a hole (03 against before/03), and the heat tint has a little chroma. The case speckle was not investigated and still shows in 07.
- **W1L-N3 CLOSED by D3-9/D3-16:** see the plug check below.
- **W1L-N4 OPEN:** only `hero` and `cutaway` render at `high` (W1V-N6).
- **W1L-N5 FIXED** (5eccc78): the dispose failure joins the init error as an `AggregateError` with `cause` (`engineView.ts:177-191`).
- **W1L-N6 FIXED by measurement:** GPU_FACTS M42 revised, and the D3-7 official run confirms it (the opaque pass 5.59 ms at scale 1 against 5.64 ms at 0.75).
- **W1L-N7 FIXED** (5eccc78): `beginFrame` advances `renderer.info.frame` (`passTimer.ts:98-101`). It holds while nothing calls `setAnimationLoop`: three's `Animation.js:85` would set `info.frame = nodeFrame.frameId` and could reuse uids (W1V-N6).

**Round 3, checked:**
- **The rotor pass (D3-16) is correct.**
  - The depth pre-pass (`fanDepthMaterial`, `materials.ts:650-656`) makes the pick with a trivial shader. The shaded copies draw at `EqualDepth` with no depth write and no discard (`materials.ts:713-721`), so each pixel is shaded once. Both stages use the same `bladeHide` position code.
  - At shutter 0 only copy 0 is drawn and `fanCopies` = 1 (`engineView.ts:355-372`).
  - The lighter loft (13 x 23 at `high`, 1,140 triangles a blade) holds the fan-blur bounds.
  - Gap: nothing can see an EqualDepth hole (W1V-I3).
- **The gated composite is correct.** `screenRectOfBox` returns the full screen when a corner is at or behind the camera plane. The fan's box covers every angle and follows the exploded offset. The 3 px margin covers TRAA's jitter.
- **The performance profile is implemented correctly; it barely helps because only the post passes scale.**
  - `renderScale.ts` is pure and tested. `post.setRenderScale` scales the scene, rotor and composite targets and GTAO. The TRAA history-depth fix (M44) is sound, and the browser test switches profiles both ways with zero errors.
  - Why it barely helps (official run): GTAO, the composite and TRAA scale (2.89 → 2.04 ms), but the opaque and rotor passes, 7.0 ms together, do not (5.59/1.36 → 5.64/1.51). Net saving 0.61 ms.
  - The controller's cost model `gpuMs (s'/s)^2` (`renderScale.ts:66`) assumes pixel-bound passes. It predicts 5.7 ms at 0.75 against the measured 9.57. That is harmless today: the controller drops to 0.75 and stays there. It is wrong as a budget model (W1V-N1).
  - D3-7 asked for "TAA upsampling". What ships is TRAA at the render scale with a bilinear upscale in the output pass. three sets TRAA's jitter from the drawing-buffer size (`TRAANode.js:454-455`), so at 0.75 the jitter spans ±0.375 render pixels (W1V-N1).
- **View-dependent culling is correct and conservative.**
  - The eye limits are the splitter x (0.262 m) and the first LPT row (1.975 m). Both lie inside the planes of the openings they guard (the intake highlight, the core-nozzle lip), and the classified rows lie wholly inside the core cowl.
  - Nothing visible is culled: the culling pixel test is at the floor in 7 poses x 2 phases.
  - Probe numbers at `high`: front eyes draw 1.06 M triangles, the side view 0.48 M, cutaway, exploded and hotSection all 1.58 M.
- **Nacelle panels, seams and orange peel: done, procedural, cheap.** `materials.ts:219-325`.
  - The seams keep a minimum contrast far away, so the joints read at 02's distance.
  - The orange peel (1.2e-5 m and 2.5e-5 m bumps) and the panel tone steps (±0.7 %) are below what any shot resolves. That is honest, but they add nothing yet.
  - The doors read as drawn outlines: a uniform dark rounded rectangle with no flush step or fastener ring (01, 02) (W1V-N5).
- **The plug check (D3-9) is honest and consistent.**
  - ENGINE_FACTS states no public length, base diameter or cone angle, with the sources searched and why each does not qualify.
  - The model's figures check: A8 = π(0.39² − 0.3052²) = 0.1852 m²; 0.65 / 0.78 = 0.83 lip diameters; atan(0.3052 / 0.65) = 25°.
  - It is unchanged, as D3-16 accepts.

**The cutaway fan (orchestrator's note on 03): CONFIRMED that the fan does not read, REFUTED that it is not drawn. It is a bug, with three causes.**
- **It is drawn.** At the `cutaway` camera, 16 of the 24 blades render.
  - `?debug=rotorAlpha` shows the fan's full height as a solid band behind the spinner.
  - `noFan` on/off changes exactly that band: it is the grey "swirl" between the spinner and the fan-frame strut in 03. The strut is the vertical post.
  - The probe: the 100° wedge plus each blade's 19.5° angular extent hides 8 blades (`bladeHide`, `materials.ts:539-551`), as designed.
- **Cause 1, the main one: TRAA ghosts the spinning rotors in the shutter-0 modes.**
  - The `cutaway`, `hotSection` and `exploded` presets have shutter 0 but throttle 0, so the spools keep turning at idle: 1,074 rpm, 107° or about 7 fan pitches per frame (`engineView.ts:341`).
  - `fanLive` is false at shutter 0, so the fan bypasses the time copies. The rotor image enters TRAA through the composite with the main pass's zero velocity (`post.ts:281`), so each pixel's history is the fan at other phases.
  - The neighbourhood clamp keeps part of it, so the blades become translucent, feathered plates.
  - A close cutaway pose (camera (-0.9, 1.0, 2.2)) with TRAA on against off: feathered, multiply-imaged blades against crisp, separate blades. The exploded close-up is the same: double-imaged fan blades with TRAA, crisp without. This is why 04's fan reads as a dark torn disc.
  - The browser probe quantifies it: differing 16 px tiles against a TRAA-off still at the same phase, at rest (dt 0) / moving (dt 1/60): cutaway close-up 2 / 19, exploded close-up 3 / 21, `cutaway` preset 33 / 47, `exploded` 5 / 10, `hotSection` 0 / 5; the extra tiles lie on the fan and booster blades (the diff images), the rest of both counts is TRAA's edge anti-aliasing.
  - D3-16 avoided exactly this for the blurred fan, but the shutter-0 path was left in TRAA.
- **Cause 2:** whole blades touching the wedge are hidden. These are the 8 nearest the camera, whose profiles would carry the shot. The remaining 16 are seen stacked, side-on, about 50 px wide at 03's framing.
- **Cause 3:** the stacked blades have nothing that separates them. The rotor pass gets no GTAO (the composite applies `occl` to the scene only, `post.ts:185, 232`), and the rotors cast no shadows (`engineScene.ts:182`), so overlapping blades merge into one smooth surface.

**Visual review, 00-07 against before/ (round 2) and D3-1** (1920x1080, plus my own renders):
What improved:
- The lip is a leading-edge band of satin aluminium with paint aft of a seam. It no longer reads as a chrome torus (00, 01, 05).
- Panel joints, hinge and latch lines, and doors show (01, 02).
- The cutaway's lower inner barrel is grey, not a black hole (03).
- At shutter 0 with TRAA off, the fan is genuinely good (my fanIdle still): 24 separate wide-chord blades with overlap, the spinner spiral crisp.

What still reads as CG, worst first:
1. **The cutaway and exploded fans** (03, 04): see above (W1V-I1).
2. **The fan in motion** (00, 01, 05, 06). The lit side is feathered white smears, and the far side (1-4 o'clock in 05) shows black voids with torn white flecks where the booster shows through. 00 carries a dotted stipple in its lower half (the 8-sample noise left after the 3 x 3 average). The handoff says so.
3. **The spinner's spiral, the CFM56 signature, is missing from all four committed intake shots.** The spinner is now in the lip's shadow (W1L-I2), and a 0.04-albedo cone with white paint lit only by the image-based light shows its stripe only while the stripe crosses the lit sector. My fresh fanIdle page showed it; the same page after the capture's preset order did not (a phase effect, not state).
4. **The engine floats** 0.37 m above the floor with its shadow detached (01, 02, 04). There is no stand or pylon. The nacelle is a perfect solid of revolution: no flattened lower cowl, no chine, no drain mast, no stencils.
5. **The plug** (02, 03, 07) is a uniform polished ogive with one hard specular streak: a chrome bullet. A run engine's plug and core nozzle are dull and heat-stained.
6. **07:** the LPT/HPT blades between the disk caps read as dark, speckled barrels, and the cases keep the sandpaper speckle (W1L-N2).
7. **06:** the booster seen through the fan at takeoff is a sawtooth comb (the own-surface blur capped at one pitch).
8. **The doors** read as stickers (01, 02).

**Performance (for Aaron's D3-7 decision; I do not choose the remedy). Does the code support one?**
- **Triangles per view at `high`** (probe; the shipped geometry, instances counted):
  - front eyes (threeQuarterFront, hero, fanIdle, fanTakeoff): **1.06 M**. That is solids 0.50 M, static vanes 0.33 M (main pass), booster and HPC rotors 0.20 M (rotor pass), fan 27 k, struts 4 k. Whenever the fan blurs, the fan's 8 copies are drawn twice (pre-pass and shaded): +0.41 M of vertex work.
  - side: **0.48 M**.
  - cutaway, exploded, hotSection: **1.58 M**.
- **`stats().drawnTriangles` overcounts** (`engineView.ts:266-275`). Since 5c24e0c it traverses the rotor scene's layer-2 shadow proxies, which the camera never draws (0.5-0.63 M): my cutaway page read 2.23 M against 1.58 M real. The D3-7 note's "about 1.5 M" is LOOKDEV round 2's "1.52 of 1.66 M". That was taken before both the proxies and the view-dependent culling, so it is stale, and the HUD cannot give the current figure (W1V-I2).
- **LOD hooks: none yet, but the structure supports one cheaply.**
  - Today there is one global `GEOMETRY_QUALITY` (`test`/`high`), built once per view: one `segments` (192) for all 48 solids and one loft per blade family. There is no per-row or per-part LOD and no runtime switching.
  - There is no occlusion culling inside the closed classes. The cutaway's hidden blades are collapsed in the vertex shader, not culled, so they still cost vertex work.
  - `buildEngineGeometry` is pure and per-row, and the closed-view classes are a ready LOD key: `frontOnly` rows are seen only through the fan and booster gaps. The culling pixel test is a ready acceptance harness for any LOD, because it compares pictures.
- **The largest levers, by triangle share:**
  - the solids at 192 segments (0.50-0.63 M; nacelle skin 104 k, core cowl 78 k, bypass liner 48 k, lip 46 k);
  - the HPC rows (346 k, seen from the front only through two rows of gaps);
  - the static vanes (327 k);
  - the fan pre-pass (219 k per pass).
- **The cutaway's extra 2.8 ms of opaque time:** it draws all 1.58 M triangles, and every solid's wedge is shaded and then discarded (M43: a discard saves no shading). A geometric wedge would avoid that.
- **Transitions:** for the 1.4 s of every mode change, all three shadow maps re-render every frame (`engineView.ts:386-388`), now with the rotor lights' maps of every static part. That cost spikes during transitions and is not in any timed config (W1V-N1).

### Blocking
- **W1V-B1 OPEN: `npm run lint` fails at the tip.**
  - Where: `docs/look-dev/timings.json`, reformatted by the official-timing commit ca4a33a. The builder's handoff commit 23239a1 was clean, and the LOOKDEV gotcha names this exact step.
  - Failure: merged as it is, main's lint gate is red, and every builder's next handoff fails it.
  - Fix: `npx prettier --write docs/look-dev/timings.json`, then commit. Formatting only: no number changes, and no re-review needed.

### Important
- **W1V-I1 OPEN: TRAA accumulates the spinning rotors at the wrong phase in the shutter-0 modes, and no test sees it. The cutaway fan does not read.**
  - Where:
    - `post.ts:281`: TRAA takes the main pass's velocity, which is zero on rotor pixels;
    - `engineView.ts:341, 352-372`: the spools turn in every mode, and the shutter-0 fan bypasses the time copies;
    - the `presets.ts` `cutaway`/`exploded`/`hotSection` presets (shutter 0, throttle 0);
    - `fanBlur.test.ts:142-145`: the "shipped" frame accumulates 48 frames at dt 0, so the fan holds still, which the app never does;
    - `bladeHide` (`materials.ts:539-551`);
    - no rotor AO or rotor shadows (`post.ts:185, 232`, `engineScene.ts:182`).
  - Failure: 03's fan is a grey band, 04's fan a dark torn disc, and every orbit of the cutaway or exploded view shows ghosted blades. The fan-blur test passes on a held-still fan. The probe: differing 16 px tiles against a TRAA-off still at the same phase, at rest (dt 0) / moving (dt 1/60): cutaway close-up 2 / 19, exploded close-up 3 / 21, `cutaway` preset 33 / 47, `exploded` 5 / 10, `hotSection` 0 / 5; the extra tiles lie on the fan and booster blades (the diff images), the rest of both counts is TRAA's edge anti-aliasing.
  - Fix (pick per question t):
    - **(a)** in the display modes, ease the spools to a stop or to a display speed (a few rpm) while the cut or the explosion opens;
    - **or (b)** give rotor pixels a velocity into TRAA: the composite knows `pRotor` and each spool's angle per frame, and rigid rotation reprojects exactly, with TRAA's disocclusion test catching the rest;
    - **or (c)** mark rotor pixels as having no history.
    - Then, for the cutaway: keep the fan blades whose root lies outside the wedge (test `|mid| < cutHalf − half` instead of `< cutHalf + half` for the fan row only), so the blades at the cut faces show their profile, as product cutaways do. A whole blade has no open section, so nothing hollow shows.
    - Darken the overlap with a cheap per-blade cavity term, or let the rotors cast into the rotor maps when the spools are still.
    - Run the fan-blur "shipped" check at dt 1/60 with the spools turning, and add the probe's moving-vs-still check for the cutaway and exploded presets as a browser test.
  - Allowed after merge (the follow-up round).
- **W1V-I2 OPEN: the performance decision rests on a stale triangle count, and the stat that should report the current one counts geometry the camera never draws.**
  - Where: `engineView.ts:266-275` (`drawnTriangles` traverses the layer-2 shadow proxies), and the D3-7 result's "about 1.5 M triangles" (LOOKDEV round 2's "1.52 of 1.66 M", from before the proxies and the view-dependent culling).
  - Failure: Aaron weighs a LOD round against a smaller solver budget using the wrong number. The real front-view draw is 1.06 M (+0.41 M of fan-copy vertex work when the fan blurs), and the side view only 0.48 M.
  - Fix:
    - count only objects whose layers the camera sees (`obj.layers.test(camera.layers)`), and count the fan's pre-pass copies separately;
    - put the per-view table above into LOOKDEV;
    - for the decision, a diagnostic A/B the existing harness can run once at 20 s each: `test` quality for the `frontOnly` rows, and 96 segments for the internal solids.
  - Allowed after merge. Due before the W1 report goes to Aaron.
- **W1V-I3 OPEN: an EqualDepth hole in the fan would pass every test.**
  - Where: `materials.ts:713-721`, and GPU_FACTS M43 ("Equal depth held ... the fan-blur reference test stayed within its bounds").
  - Failure: the reference stills draw copy 0 through the same pre-pass and EqualDepth, so a hole would sit in the reference and in the estimate alike. The culling test compares two frames that would share the holes too.
    - Another adapter or a driver or Dawn update that compiles the two vertex stages differently (three emits no `@invariant`) would put pinholes or missing blades into every shot, with every gate green.
    - M43 cites the fan-blur test as evidence that it cannot provide.
  - Fix:
    - a browser test at shutter 0: the rotor-alpha coverage of the fan drawn through the pre-pass and EqualDepth, against the same fan drawn with an ordinary depth test (a debug flag that hides the depth copies and sets `LessEqualDepth` with depth write). 0 differing pixels;
    - reword M43's evidence to the visual `rotorAlpha` check.
  - Allowed after merge.

### Nits
- **W1V-N1 (performance profile and harness):**
  - the controller's quadratic cost model contradicts the measured geometry-bound passes (`renderScale.ts:66`); predict with a fixed part plus a scaled part, or document it;
  - "TAA upsampling" is a bilinear upscale, and TRAA's jitter is in output pixels (±0.375 render px at 0.75); say so in LOOKDEV and D3-7's follow-up;
  - write each run's render scale and GPU error count into `timings.json` (`capture.ts:217`);
  - no `--worker` mode yet (W1L-I4, W1G-I2);
  - the transitions re-render three full shadow maps per frame (`engineView.ts:386-388`): untimed.
- **W1V-N2 (stale text):**
  - `engineScene.ts:119-127` still says the opaque pass is "fill-bound, not triangle-bound";
  - LOOKDEV round 3 says the performance profile "is under" 8 ms (indicative 7.15). The official run says 9.57; add the D3-7 result there.
- **W1V-N3 (silent failure):** the TRAA patch (`post.ts:287-302`) reaches into `_historyRenderTarget` and `_previousDepthNode` unchecked. If a three update renames `_previousDepthNode`, the assignment creates a new property, and TRAA's disocclusion test silently reads a stale depth. Assert both fields exist when the pipeline is built, and throw.
- **W1V-N4 (the cutaway rule):** the hidden set changes as the spools turn, so at the cut faces blades pop in and out every frame. Fix (a) of W1V-I1 removes this too.
- **W1V-N5 (visual):** see the list above:
  - the spinner spiral (lift the paint's response in shadow, or light the spinner through the intake mouth);
  - the floating engine (a cradle or a pylon stub);
  - the chrome plug (dull, heat-stained, rougher);
  - the doors (a flush step and a fastener ring, or drop them);
  - 04's framing;
  - 07's speckle (`?debug=ao` against `noShadow`, W1L-N2).
- **W1V-N6 (tests):**
  - only `hero` and `cutaway` at `high` (W1L-N4);
  - the N7 fix depends on nobody calling `setAnimationLoop`; document the rule beside it.

### Trial merge (w1/lookdev-3 @ca4a33a into the critic branch at main 8e93e2e)
- **Merge:** `git merge --no-ff --no-commit w1/lookdev-3` on the critic branch (main 8e93e2e) is clean: 44 files, and ENGINE_FACTS auto-merges (main's cycle-calib rows plus the plug section).
- **`npm run mesh`:** no working-tree change (the manifest is unchanged; the plug was not reshaped).
- **Gates on the combined tree:**
  - `npm test`: 1600 passed, 5 expected fail (72 files). That is main's 1577 + 5 plus the stack's 23.
  - `npm run typecheck`: clean.
  - `npm run lint`: fails on `docs/look-dev/timings.json` only (W1V-B1). ESLint is clean.
  - `npm run coverage`: lines 99.51 %, statements 98.58 %, branches 87.98 %, functions 99.59 %; every threshold passes (`src/geometry` 99.57 %, `src/cycle` 99.45 %, `src/thermo` 100 %).
  - `npm run test:mesh`: 29 passed. `npm run build`: ok.
  - `npm run test:browser`: 21 passed, zero WebGPU errors.
  - The probes: `w1v-geometry` 2 passed (the numbers above); `w1v-rotor-traa` ran (the numbers in W1V-I1).
- **Restore:**
  - `git merge --abort`, then the probe copy, `coverage/`, `dist/`, `test-results/` and the generated `public/mesh/*.bin` were removed. The critic branch is back at 8e93e2e.
  - The builder worktree is clean at ca4a33a. Its ignored `coverage/` and `test-results/` existed before and were refreshed by the gate run.
  - The critic's dev server (port 5190) and MCP page were closed.

**Verdict w1/lookdev-2 + w1/lookdev-3 @ca4a33a: FIX FIRST (W1V-B1 only).**
- W1V-B1 is a formatting-only commit: `npx prettier --write docs/look-dev/timings.json` on `w1/lookdev-3`. Once lint is clean at the tip, this is **MERGE** without another review pass.
- The stack closes W1L-I1..I4, N3, N5, N6 and N7, and parts of N1 and N2. The rotor pass is a sound, measured implementation of D3-16. The culling is correct and pixel-tested, and the performance profile is correct. The plug check is honest.
- The Important items are visual or performance and do not block. They go to a named follow-up round `w1/lookdev-4`, in this order:
  1. W1V-I2: the triangle figures, before the W1 report goes to Aaron;
  2. W1V-I1: rotor TRAA, the cutaway fan, the dt-1/60 test;
  3. W1V-I3: the EqualDepth test;
  4. the nits.
- The performance remedy itself (a LOD round, a smaller solver budget, or both) stays Aaron's (D3-7 result). The code supports a LOD round cheaply (see Performance).

**Orchestrator decisions needed (pass 6):**
- (t) **The display modes' spools (W1V-I1):** should the cutaway and the exploded view show a running engine (then rotor velocity into TRAA, fix b), or a display engine with the spools eased to a stop or a slow turn (fix a, simpler, and the product-shot convention)?
- (u) **The W1 report's triangle figure (W1V-I2):** restate "about 1.5 M" from the probe (front 1.06 M + 0.41 M of fan copies, side 0.48 M, cutaway 1.58 M) before the LOD-or-solver choice goes to Aaron.
