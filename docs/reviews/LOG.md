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
- **D4-19 (w2/reference question a): L4b passes on its pre-registered shock-position row** (1.64% at 170 × 17; Richardson estimate 0.51%), on one condition: a steadiness check shows the position constant within 0.1% of the nozzle length over the last 2000 iterations. The residual stall in the axis row behind the shock stays an OPEN finding and goes into the axis work (D4-21).
- **D4-20 (questions c and c'): low-Mach dissipation is matched to the preconditioning, so D4-10 is amended.**
  - The cause: SLAU2's mass-flux pressure diffusion, −(χ/2c̄)Δp, is relatively O(M) at low Mach, so pressure and velocity decouple as M → 0. That is the odd-even sawtooth in L7 and L8 and the L7 non-convergence.
  - The standard remedy, preconditioned dissipation matched to the preconditioned time derivative (Weiss-Smith/Turkel, and AUSM+-up's 1/f_a scaling), is adopted in **tracking mode**. SLAU2's mass-flux pressure diffusion is scaled by 1/f_a(M_ref), where M_ref = min(1, max(M_local, M_cut)) and M_cut is stated and justified from the engine's own velocity scales. Transonic and supersonic regions (f_a → 1) are unchanged, and L2/L4 must stay green.
  - Physical-time mode keeps unscaled SLAU2, because acoustics matter there.
  - The steady state then depends slightly on M_cut. Report that dependence on L7/L8.
  - SOLVER.md is updated before the code, and the kernel implements it.
- **D4-21 (question c): axis treatment.** After D4-20, if L8's axis cells still fail, investigate the axis treatment itself: the r-weighted pressure term and the face areas at r → 0, the mirror-ghost swirl and the radial-velocity parity, and the sink placement. That is preferred over a new flux. Report the evidence. A remedy that changes the scheme beyond D4-20 comes back for a decision.
- **D4-22 (question b): the preconditioned far field is accepted in tracking mode** (characteristics of the preconditioned system, for convergence). Physical-time mode keeps the physical far field. Quantify the steady-state shift on the M 0.3 sphere and in L1-L9: it must stay well under each case's tolerance (at most a tenth of it), or it comes back.
- **D4-23 (questions d and e):**
  - (d) is confirmed: L9 normalises its residual by the peak over the first iterations, because the first residual is zero.
  - (e) the default CFL is not lowered for L9a's swirl stall. First, give the swirl/centrifugal source (ρu_θ²/r, and the u_r·u_θ coupling) a point-implicit treatment with its Jacobian, the standard remedy for a stiff geometric source. Fall back only if that fails: a local source-term time-step limit (Δt ≤ C·r/|u_θ|) where swirl dominates, not a global CFL cut.
- **D4-24 (w2/lookdev-4, PARTIAL at bad7ad0): how P4 is measured.**
  - **The builder's finding:** the opaque pass is bound by fragment shading, not by triangles. Unlit materials take it from about 6 to about 1 ms, while hiding every main-pass blade row saves at most 0.6 ms. Also, at vsync the iGPU clock follows the load (DVFS). A vsync-paced, render-only timestamp therefore overstates the cost when there is headroom and understates savings. In paired runs, the performance profile changes the opaque pass by +0.4 ms at vsync but by −1.6 ms back to back. This also explains D3-7's "lower resolution barely helps".
  - **Decision:** P4 keeps 8.0 ms and the D0-1 protocol. Its measure of record becomes the render GPU time with frames rendered back to back, the GPU at its loaded clock. In the app the solver and flow visuals share the frame and keep the GPU there. The vsync figure is always reported beside it.
  - **The end-to-end checks of record stay P2 (≥ 55 fps) and L13,** with the solver and flow visuals running.
  - **This changes a measurement method, not the threshold, so it applies only after the critic independently confirms the DVFS evidence.** Until then P4 is reported both ways and must pass both.
  - The capture tool gets a back-to-back mode in the next look-dev round. The official vsync run of bad7ad0 runs in this cap pause as the baseline (D3-7 had 10.18 ms).
- **D4-24 result: official vsync P4 baseline on w2/lookdev-4 @bad7ad0, measured as a FAIL.**
  - Conditions: 2026-10-27 05:33-05:48, AC, plan Balanced, no agents, CPU 16%, D0-1 protocol (10 s warm-up + 3 × 60 s, seed 1). All 4 configs were VALID, with 0 errors.
  - **Default 11.68 ms**: opaque 6.29, rotors 1.87, GTAO 1.10, composite 0.87, TRAA 1.18, output 0.39.
  - **Performance 10.75 ms**: opaque 5.79, rotors 2.00.
  - **Cutaway 11.80 ms**: opaque 7.49.
  - **Hero 12.54 ms**: opaque 4.92, DoF 2.10.
  - P4 FAIL (default ≤ 8 ms).
  - Compared with D3-7 (10.18 / 9.57 / 12.67 / 14.09 ms), cutaway and hero improved, but default and performance got worse. The default's opaque pass went from 5.59 to 6.29 ms and the rotors from 1.36 to 1.87 ms, against the builder's indicative opaque cut of 6.09 → 4.95 ms.
  - Within each run the default and cutaway are bimodal: p10 about 7.3 ms against p90 about 16.8 ms, while hero, the heaviest load, is tight at 11.9-13.7 ms. That is consistent with the clock following the load (D4-24), but it does not rule out a regression.
  - The next look-dev round must settle it: a back-to-back measurement, and an A/B of bad7ad0 against w1/lookdev-3's 23239a1 under the same mode. The critic checks this evidence before D4-24 applies.
  - Raw output: job tmp `lookdev4_official.log` (the capture exits 1 on a P4 FAIL and wrote no JSON).
- **D4-25 (w2/reference round 3 @ca296ae, question a): the smooth van Albada limiter is adopted.** This is the ε-regularised, differentiable form, standard for steady and implicit solvers. The ab > 0 switch caused L9a's stall and D4-20's stall wherever M_cut ≤ the local Mach.
  - The ε rule and its scaling are stated in SOLVER.md.
  - L2/L4's shock rows and the positivity fallback must stay green.
  - The kernel implements the smooth form.
- **D4-26 (question b): L7 runs at 96 × 96,** on the same rule as D4-9. The Cp asymmetry falls with refinement (0.35, then 0.043 after D4-20, then 0.013 at 96 × 96), so it is discretisation error. The case is accepted at the finer resolution provided a two-refinement sequence shows that convergence, and the resolution goes into PHYSICS.md "CPU variants" first. The threshold stays at 0.02.
- **D4-27 (question c): L8 stays FAIL, and an unstable M_cut band blocks the engine value.**
  - The symptom: a polar mode grows for M_cut in 0.0025-0.004, and that band contains the engine's 0.003 (its ~1 m/s far-field suction).
  - Picking an M_cut outside the band to pass the case would be tuning. A band of instability around the operating value is a scheme defect that the kernel would inherit.
  - Next: find the mechanism by a linear (von Neumann / eigenvalue) analysis of the scaled-dissipation scheme on the polar axis cells, with the smooth limiter. Fix it there.
  - The critic gets an independent read in pass 7. W2/solver may start on the settled scheme, but its M_cut term is not final until this closes.
- **D4-28 (question d): the D4-23 point-implicit swirl Jacobian is dropped.** It is nilpotent here and had no effect, and the stall came from the limiter (D4-25). The source stays explicit, and SOLVER.md says why.
- **D4-29 (critic pass 7 question v): W2R-6 is investigated, and fixed before W3.** W2R-6 is the blockage instability of the plain and physical-time scheme. Every W3 blade row carries blockage, so this is not accepted as a known limitation.
  - First, W2R-B1 pins it as failing in both modes (a visible KNOWN-FAIL), corrects the `precondition.test.ts` comment, and documents it in the handoff and SOLVER.md. That is what lifts the FIX FIRST.
  - Then the next reference round investigates it. The first suspect is the well-balancedness of the p∇b source: its face pressures against the cell pressures, i.e. whether uniform p with variable b produces zero residual discretely.
- **D4-30 (question w): the L8 reframing is accepted.** The band follows minMach and the CFL: it is a fully discrete instability of the preconditioned tracking iteration, and the 1D analysis gives a CFL limit of 0.97 for the preconditioned acoustic pair. M_cut = minMach = 0.003 stays. The next reference round may:
  - (1) amend D4-8 for preconditioned tracking, with the CFL set from a fully discrete (von Neumann / eigenvalue) amplification analysis of the actual 3-stage scheme, documented and pinned by a test;
  - (2) add the matched velocity diffusion in the pressure flux, the AUSM+-up p_u term, as the companion to D4-20's scaled pressure diffusion. This is the established low-Mach pair.
  
  L2/L4 must stay green, and L7/L8 are reported. Plain SLAU2 stays in physical-time mode.
- **D4-31 (question x): C12's recovery bias is accepted for now.** C12 passes as pre-registered, but the bias is tuned to the 6% ΔPRS case: at 7-8% it gives two surges and 95% thrust only at 11.5 s.
  - Now: add a second pin at 4%, and state the headroom (the 7-8% failure) in the fidelity ledger.
  - Next: the D4-18 settling round makes the recovery robust over 4-8% ΔPRS, with no case-specific bias. That acceptance range is pre-registered there.
- **D4-32 (w2/reference round 4 @28fb768, WIP at the cap): the preconditioned-tracking CFL is 0.8 × the fully discrete limit of the worst cell shape.** The analysis gives the limits at rest: 1D 0.972 and square cells 1.550 without p_u; 1.413 / 1.958 with p_u at K_u = 0.5.
  - The order: first implement and pin the analysis in a test (`tests/unit/flow/acoustic.ts`), then run the p_u trial (D4-30).
  - If p_u keeps L2/L4 green and does not worsen L7/L8, the CFL is **1.15 with p_u**. Otherwise it is **0.8 without**.
  - The 0.8 margin is the standard safety factor on a computed stability limit.
- **D4-33 (round 4, the smooth limiter): D4-25 is amended.** The smooth limiter stays an option, not the default, until the low-Mach acoustic damping is fixed (p_u plus D4-32's CFL). In the blockage duct its residual stalls at a floor proportional to ε, because the sharp switch's clipping was masking the weak damping. Retest the stall after p_u, then decide the default.
- **D4-34 (round 4, W2R-6):** the p∇b source is well-balanced (rounding only), and the growth does not depend on the CFL. So W2R-6 is a semi-discrete instability of the spatial operator with blockage. Next, test whether p_u's damping removes it. If not, do a semi-discrete eigenvalue/eigenvector analysis of the blockage duct to find the term.
- **D4-35 (w2/reference round 5 @4553ce2): the preconditioned-tracking CFL is 0.8, without p_u.** The AUSM+-up p_u trial is rejected: L8 got worse (1.38% / 2.27%), L7's Cd failed (0.0117), and C-pre went to NaN.
  - The p_u option is **deleted from the oracle**: the oracle must describe exactly one scheme, the kernel's.
  - The negative result is recorded in SOLVER.md (D4-30/D4-32 trial, the numbers, and the commit where the code lived).
  - Round 5 now passes L7 at 96 × 96 (asymmetry 0.0131, falling over 24/48/96; Cd 0.0016; iteration ratio 1.05) and L8's velocity row (0.36%). L8's convergence row and L9a/L9b's convergence rows remain open.
- **D4-36 (round 5, the limiter): W2R-6 is caused by the sharp van Albada switch acting on p′ and u at the throat,** not by the blockage source. The smooth form fixes W2R-6 and the L9 convergence rows but breaks L8 (27-30%) and L1.
  - The next round runs both variants as trials under one pre-stated selection rule:
    - (a) a smaller ε, with ε scaled with the cell size in the Venkatakrishnan manner, under plain tracking at CFL 1.0;
    - (b) the smooth form on p′ and u only.
  - **The rule:** adopt the first variant that keeps every row the sharp limiter passes (L1-L7, L8 velocity, L9 values) and fixes W2R-6. Otherwise keep the sharp limiter, with W2R-6 open and pinned, and bring the data back.
  - Write the rule into SOLVER.md before the runs.
- **Slot plan update:** after W2R-B1 merges, slot A runs the reference round 4 (W2R-I1..I4, D4-29, D4-30). When w2/lookdev-4 finishes, slot B runs **w2/solver**, which starts on the parts the critic cleared and holds back the limiter, the preconditioned CFL/dissipation and the oracle comparisons until round 4 lands. w2/flowviz and w2/app-ui follow.
- **D4-24 evidence: the official A/B of record, 2026-10-27 14:50-15:36.**
  - Conditions: AC, plan Balanced, no agents. The run was `node tools/lookdev/ab.ts --refs bad7ad0,23239a1 --warmup-s 10 --run-s 60 --reps 3` on w2/lookdev-4 (default view, quality profile). The JSON is `docs/look-dev/ab-bad7ad0-23239a1.json` on w2/lookdev-4.
  - **Back to back:** bad7ad0 8.28 ms (opaque 3.80) vs 23239a1 8.87 ms (opaque 4.60). Paired, bad7ad0 is −0.89 ms [−0.89, −0.58, −1.23], with the opaque pass −0.90 ms, faster in every pair.
  - **Vsync:** both are about 16.3 ms (16.37 vs 16.34). Paired the difference is −0.05 ms, while the opaque pass is still −0.88 ms.
  - **What that shows:** under vsync the GPU time expands to fill the frame whatever the workload. The vsync timestamps measure the clock governor, not the work. This is strong evidence for D4-24's DVFS reading, and it shows bad7ad0 was an improvement, not a regression.
  - One back-to-back repetition (23239a1 rep 1) was INVALID (occluded: rAF at 1.5 fps, probably the display sleeping), so its pair excludes it.
  - **P4 at 6091d53 was not measured.** The capture's Chrome launch timed out at 15:36-16:24, again likely the display asleep. It re-runs in the next quiet window, with the display kept awake.
  - The critic confirms or refutes D4-24 in pass 8.
- **D4-37 (w2/solver @d5c87df, question a): L1 uniform keeps its pre-registered 1e-4 m/s.** The GPU reaches 2.0e-4 m/s, and the cause is f32 arithmetic, not the metrics: the oracle with the same f32 metrics reaches 1.5e-5, so D4-12's asset fix would not help.
  - Solver round 2 applies the standard mixed-precision mitigations first, then reports:
    - compensated (Kahan/Neumaier) summation of each cell's face-flux accumulation and of the update;
    - flux differences formed in the gauge variables;
    - whether the error grows or plateaus over the 20k iterations.
  - If it is still over 1e-4 after these, bring the data back. No threshold change.
- **D4-38 (question b): the GPU ladder judges convergence at the f32 floor.** "Converged to 1e-5" is a stopping rule inside the tests, not a PHYSICS.md threshold. The accuracy rows (L4a Mach and mass flow, L5 mass flow) are the pre-registered checks.
  - The GPU stopping rule: the residual has reached its plateau (stated per case: 4e-5 and 1.7e-4), and the accuracy metric changes by less than 1e-4 relative over the last 2000 iterations.
  - The oracle keeps its f64 1e-5 rule.
- **D4-39 (question c): the E-L5 residual row (1.5e-3 vs 1e-3) keeps its tolerance.**
  - First check the row's normalisation. A residual near convergence is a small difference of large fluxes, so a relative error divided by the residual itself is ill-posed in f32. The well-posed form divides by the flux scale (the sum of |face flux| per cell).
  - If the row divides by the residual, the solver proposes the flux-scale normalisation for both rows (E and B), and the critic rules on it.
  - If it already uses the flux scale, investigate the blockage terms in f32 (b-weighted areas, p∇b).
- **D4-40 (question d): the engine adapter's defaults are accepted.** minMach = M_cut = 0.003 and preconditioned CFL 0.8, per D4-35.
- **D4-41 (question e): the two f32 reorderings go into SOLVER.md as a new, appended §13 "f32 implementation forms",** written by w2/solver: R(φ) − R∞ evaluated as φ·dR, and the preconditioned density increment. Each states the algebraic identity, and an oracle-side test shows both forms agree to f64 rounding. The reference does not edit §13, which keeps the two branches' SOLVER.md edits disjoint.
- **D4-42 (critic pass 8 question y): D4-24 applies.** P4's measure of record is the **back-to-back** render GPU time, on three conditions:
  - valid runs only (W2L-I2);
  - the OS power source AC throughout the run, checked by the tool (W2L-I4);
  - the busy fraction reported beside the number.
  
  Vsync stays reported beside it.
  **Corrections to the "D4-24 evidence" entry:**
  - The INVALID run is 23239a1's back-to-back rep 0, and the summary included it. The valid pairs are −0.59 and −1.22 ms (median −0.90).
  - The record ends "not charging, 0.98".
  - The vsync medians do not mean the governor "fills the frame": rep 0 ran at 56 fps / 10.4 ms and reps 1-2 at 40 fps / 16.4 ms, all at 0.65 busy. The conclusion stands: vsync GPU time follows the clock, not the work.
- **D4-43 (question z): p_u is deleted as the next reference round's first item** (D4-35). It is already merged, and the record stays in SOLVER.md.
- **D4-44 (question aa): CFL 0.8 is valid only for β ≈ M_ref (W2R-I6).** The fix is to make the preconditioner and the scaled dissipation use the same reference velocity: M_ref from the face's β, option (a). That is the standard consistency requirement in Weiss-Smith/Turkel preconditioning.
  - Verify it with the discrete analysis over β/M_ref, plus a shear-layer case and a start-from-rest case, option (c).
  - If (a) does not restore stability across the range, add the scaled diffusion's eigenvalue to the local step, option (b).
  - SOLVER.md is updated first, and the kernel follows.
- **D4-45 (question bb):**
  - Value rows taken before convergence (L8, L9a, L9b) get a D4-19-style steadiness rule: the value is constant within a tenth of its tolerance over the last 2000 iterations.
  - L8's iteration cap scales with the CFL change: pseudo-time iterations go as 1/CFL, so 20000 × 1.5/0.8 = 37500. That is a property of the scheme, stated here, not a tuning. L8 converges at about 32500 (0.449%).
  - L9a/L9b get the same scaling rule.
- **D4-46 (question cc): back-to-back captures follow D3-6.** INVALID is decided by the occlusion signature, a hidden page or a blur. The look-dev watcher's stricter 2.5-interval stretch becomes a WARNING, and D3-6's blur rule reaches look-dev captures (W2L-I5).
- **Next rounds:**
  - Reference round 6: D4-43, D4-36's limiter trials, D4-44, D4-45, W2R-I5..I7, the pass-8 nits, and the tight 5 s timeout on `solver.test.ts`'s annulus test.
  - Look-dev round 5: W2L-I1..I5 and the pass-8 visual notes (matte nacelle, stippled/torn moving fan with 06 regressed, the spinner stripe in 01, the toy-like stand, the flat cutaway), then the official P4 back to back.




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

## Critic pass 7: w2/followups @ef2bb19

Reviewed 2026-10-27 by the pass-7 critic: `w2/followups` @ef2bb19 against main 4afb9d4. The branch is from e1ca8a2, and main has only LOG commits since, so the review diff is `e1ca8a2...ef2bb19` (54 files). Scope: W1K-I1/I2; D3-17/C12 (FADEC surge detection and recovery); D4-13 (the lost-solve flag, with the `src/contracts` field `CycleState.gasPathSolve` and `src/cycle/matchedSolve.ts`); D4-16/D4-17; the D3-13 mutation config and scores, with `src/cycle/fadec.ts`; and the bench harness D3-6 / W0G-N5..N7. Checklists applied: typescript-reviewer, silent-failure-hunter (the lost-solve and sub-idle paths), pr-test-analyzer.

New probes (plain Node; they import the checkout named by `ROOT`, and each header says how to run it):
- `docs/reviews/probes/w2f-c12.probe.ts.txt`:
  - the C12 case at any ΔPRS: the onsets, the action delay, the time to 95 %, the end state, max EGT and the solver calls;
  - the solver calls per lost solve on the W1K-I2 fit's slam.
- `docs/reviews/probes/w2f-fingerprint.probe.ts.txt`: an independent behaviour fingerprint (SHA-256 over the JSON of every state) of five transients:
  - a slam and chop;
  - the C12 case;
  - a start;
  - a hot day with an injected surge and a flameout;
  - a part-lever chop and re-slam.

**Gates at the tip.** I reran them in the builder worktree, and its tracked files were unchanged afterwards. A ladder run on the other branch shared the CPU, so the durations are long.
- `npm test`: 1700 passed, 5 expected fail (C10 ×3, C11 ×2), 80 files.
- `npm run typecheck`: clean.
- `npm run lint`: clean.
- `npm run coverage`: lines 99.53 %, statements 98.62 %, branches 88.31 %, functions 99.60 %; thresholds pass.
  - `src/cycle`: lines 99.58 % (branches 91.76 %).
  - `src/thermo`: 100 %.
  - `src/contracts`: 99.67 %.
- `npm run test:mesh`: 29 passed.
- `npm run test:gpu`: 15 passed (4 files), with the W0G-N7 order check passing under that load.

**W1K-I1 / W1K-I2.**
- **W1K-I2 FIXED** (2a2f145, then 1105b36). `surgeRecovery.test.ts` "W1K-I2" pins the fit's slam: a surge, then lost and held matched solves while lit, at N2 70-80 % with the VBV open. The state is never `subIdle` above the switch, and there is no 95 % thrust in 10 s. The pin names the real cause, as D4-13 asked.
- **W1K-I1 mostly FIXED** (2a2f145). The KNOWN FAIL labels cite D3-15, and the fit comments and facts rows are right. Three pointers are still wrong (W2F-N1).

**C12 (D3-17).**
- **Pre-registered and sourced.**
  - fe2e294 comes before the TDD commit 98683d9 and the code 8998462. It adds the PHYSICS.md §3.2 row, `thresholds.ts`, and the ENGINE_FACTS sources [GE74], [GE91], [UTC77], [UTC93], [RR06] and [ARP1420].
  - The `checkText` and `passText` in `thresholds.ts` repeat the PHYSICS.md row word for word.
  - PHYSICS.md gives the rationale for each part, and the constants are labelled model assumptions.
- **Honest.** Probe `w2f-c12` at ΔPRS 6 % gives:
  - one surge, at 0.74 s and N2 61.8 %;
  - the fuel cut, the VBVs fully open and the igniters on in the same 20 ms step;
  - an episode of 0.04 s;
  - 95 % thrust at 8.44 s, with no dip below it until the end of the hold;
  - an end state of N1 20.26 %, N2 60.99 %;
  - max EGT 955 °C, no flameout and zero lost solves.

  This matches the handoff and ENGINE_FACTS. The VBV clause holds because the surge is below `vbvClosedAboveN2c`. D4-14's limitation (no VBV opening above it) is in the ledger, and the injected takeoff-surge test pins the VBVs at 0 there.
- **The headroom is narrow (W2F-I2).** The sweep:

  | ΔPRS | Surges | 95 % thrust at | C12's 10 s row |
  |---|---|---|---|
  | 3 % | 0 | 5.82 s | pass |
  | 4 %, 5 % | 1 | 8.42 s | pass |
  | 7 % | 2 | 11.54 s | fail |
  | 8 % | 2 | 11.56 s | fail |
  | 10 % | 3 | 15.46 s | fail |

  Every case recovers to idle with zero lost solves. The max EGT comes from the slam itself: 958 °C at 3 %, with no surge.

**The FADEC surge logic** (`surgeDetection.ts`, `model.ts:646-722`):
- **Detection uses only the model's P3.** That is the matched P3, or during an episode the plenum P3 at every Greitzer substep (`model.ts:664-676`). It never reads `flags.surge` or the margin: `startRecovery` runs only on `detected`.
- **No false trips.** The clean-engine slam deceleration never trips the detector.
- **The recovery sequence:**
  - the fuel drops to the decel schedule, and never below it ([UTC93]);
  - the igniters switch on (auto ignition);
  - the VBVs open only below their closing speed (D4-14);
  - then a 0.5 s hold, and a 1 s ramp to the biased schedule.
- **The test is tight.** The C12 test checks each action within 0.1 s of each onset, so dropping any of the three fails it.

**D4-13: the lost-solve flag.**
- **No silent fallback is left.**
  - The old `snapshot()` fell back to the sub-idle model on any root that did not converge or was not physical (e1ca8a2 `model.ts`).
  - The new code calls the sub-idle model only when the engine is unlit, unfuelled or below 57 % N2 (`model.ts:772-790`).
  - A lost solve returns `{ ...held, solve: 'held' }`, bumps `lostSolves` and leaves the anchor where it was.
  - The only other `catch` blocks in `src/cycle` predate this branch: Newton's `safe()`, the `solveLinear` break, and the sizing wrapper, which re-throws with a cause.
  - `matchedSolve.ts` swallows every exception as a lost solve. That is flagged, but its cause is lost (W2F-I1).
- **The continuation is correct.**
  - It walks a straight line in (N1, N2, Wf) from the last converged point, and warm-starts each step on the one before.
  - The step halves on a failure, down to 1/256, and doubles after a success. A walk makes at most 64 solves, and the last step lands exactly on the target.
  - A failing solver costs 9 calls per lost snapshot. `gasPathHold.test.ts` pins that count.
  - A converged root with BPR ≤ 1 counts as lost.
  - Only (N1, N2, Wf) are walked. The operating conditions take their target value at the first step (W2F-N2).
- **The zero-lost assertions are real.**
  - `expectNoLostSolves` runs at the end of every run helper in `model.test.ts`, `modelPaths.test.ts` and `surgeRecovery.test.ts`. The W1K-I2 pin is excepted on purpose.
  - It also runs after every 1 s chunk of the start's settling loop, and in each direct-step test of `modelPaths.test.ts`.
  - `lostSolves` counts since the reset, and no test resets mid-run.
  - With a stub solver, the hold tests cover the edge cases:
    - the held state equals the last converged one;
    - the matched solve resumes;
    - the count survives until a reset;
    - a root that is not physical counts as lost;
    - a reset whose first solve is lost;
    - the dry crank, the cutoff and the flameout run as `subIdle`, with zero solver calls.
- **The contract field is minimal and validated.**
  - The field is `CycleState.gasPathSolve = { status: 'matched' | 'subIdle' | 'held'; lostSolves }` (`src/contracts/cycle.ts:112-127`).
  - `validateCycleState` rejects a missing field, an unknown status, and a `lostSolves` that is not a whole number ≥ 0 (`cycle.ts:391-404`).
  - The mock and the contract fixture fill it.
  - One cross-check is missing: `held` should imply `lostSolves ≥ 1` (W2F-N3).
  - I approve it as the D4-13 / D4-17 field.
- **D4-16 and D4-17.**
  - The start test's C4 check now uses a stated settling rule: N1 within 0.1 points over a 20 s window, waiting at most 200 s (`model.test.ts:199-221`). The thresholds are unchanged.
  - While held, the spools run on the held power balance, as D4-17 accepted.

**The fadec.ts extraction is bit-identical.** I ran probe `w2f-fingerprint` on `git archive` copies of three commits:
- 5794941, the TDD stub before the move;
- 7bb37c7, the move;
- ef2bb19, the tip.

All five scenarios (5,900 states) give the same hash on all three:

| Scenario | Hash |
|---|---|
| slam-chop | 677bc456986a5a05 |
| c12 | c34d477cd5c496da |
| start | dd082a71bf4f71e5 |
| hot-surge-flameout | 63915b7e9bdc421b |
| part-lever | 0b0723fc0d3f481e |

So the move is a pure refactor, and the later kill-only commits did not change behaviour either.

**The mutation table (docs/MUTATION.md).**
- **The scores are real.** I ran Stryker with `--mutate src/cycle/fadec.ts,src/cycle/surgeDetection.ts`, `MUTATION_TESTS` set to their two suites, a private incremental file and concurrency 4. It reproduced both rows exactly:
  - fadec.ts: 98.20 % (109 killed, 2 survived);
  - surgeDetection.ts: 97.14 % (34 killed, 1 survived).

  The survivors are the ones MUTATION.md names.
- **The orchestrator's correction of the pause runs is right.** A shared incremental file makes Stryker's "All files" line a running total, so the per-file rows are the true scores.
- **model.ts at 43.6 % is acceptable as a labelled lower bound under D3-13, but it hides the newest logic (W2F-I3).**
  - Only 269 of 950 mutants are killed (28 %). The 145 timeouts count as detected.
  - By region (survived / no fast coverage): the recovery 2 / 16, the surge episode 31 / 66, `surgeAt` 0 / 22.
  - The fast set reaches these regions only through the few seconds that `gasPathHold.test.ts` runs the model.
  - So D3-17's wiring from detection to recovery has no mutation evidence. The C12 transient covers it only behaviourally.
- **`vitest.mutation.config.ts` is sound.**
  - It excludes the three slow files, and `mutationConfig.test.ts` pins that list.
  - `MUTATION_TESTS` narrows a targeted run.
  - Stryker reads the config.

**The harness (D3-6, W0G-N5..N7).** All of this matches D3-6.
- **INVALID** only for:
  - two or more consecutive rAF intervals of at least 500 ms (at least 1000 ms in a row);
  - a hidden page;
  - a blur.
- **WARNING** for:
  - a stretch of frames over 2.5 display intervals that lasts more than 500 ms;
  - a median frame over 1.5 intervals.
- **The timeout (`timeout.ts`).**
  - Each run is raced against warm-up + runs + 30 s.
  - A stall is INVALID "stalled", with no numbers, and the page is reloaded under the same timeout.
  - A rejection after the timeout is absorbed, and one before it propagates.
  - If the reload fails, the sweep aborts loudly.
- **W0G-N6:** the warm-up interval fallback is now held to the probe's 24-500 Hz check.
- **W0G-N7:** `timestamp-ring.test.ts` compares medians at 8× the work.
- **The smoke run:** the orchestrator's run (`docs/bench/throughput-2026-10-27-0002-quick.json`) is committed exactly as written.

### Blocking
None.

### Important
- **W2F-I1 OPEN: a lost solve keeps no cause.**
  - `attempt` in `src/cycle/matchedSolve.ts:41-48` catches every exception and treats it as "no solution there".
  - The only expected throw is a thermo range error. A programming error therefore reaches the app as `held`, with nothing to tell it apart from a physical loss. Examples: a TypeError, an index guard or a NaN guard in `solveGasPath` or `engine.ts`.
  - The tests catch both kinds only because they assert zero losses. In the app, where D4-17 shows `status` and `lostSolves`, the cause is gone.
  - Fix, either:
    - keep the last failure's message (for a root that is not physical, its BPR) as a model diagnostic, logged once per held episode; or
    - re-throw anything that is not a thermo range or convergence error. gas.ts throws plain `Error`s, so that needs a typed error first.

    The contract field can stay as it is.
- **W2F-I2 OPEN: C12 passes at 6 % with about one point of ΔPRS to spare, on a bias tuned to the case.**
  - ENGINE_FACTS says the recovery's 0.8 bias is "the largest round value that keeps the C12 slam to one surge with margin inside C12's 10 s".
  - The sweep above shows the cliff: from 7 %, two surges and 11.5 s.
  - This is disclosed, not hidden: the 8 %, 10 % and 12 % runs are in ENGINE_FACTS, and the threshold was registered before the code. But W3's surge scenarios (other ambients, other deteriorations) will land on both sides of the cliff.
  - Fix:
    - say in the PHYSICS.md ledger row that above about 6.5 % the recovery needs 2 surges and more than 10 s;
    - pin a second ΔPRS (4 %: one surge, 95 % within 10 s), so that a loss of headroom shows;
    - revisit the bias with the D4-18 settling round.
- **W2F-I3 OPEN: the D3-17 wiring in model.ts has no mutation evidence.** In MUTATION.md (survived / no fast coverage), the recovery region is 2 / 16 and the surge episode 31 / 66.
  - Fix, either:
    - (a) factor the state from detection to recovery (`startRecovery`, `recoveryVbvOpen`, the episode bookkeeping) into a pure step function with fast tests, as was done for `fadec.ts`; or
    - (b) run one targeted Stryker run of those line ranges against `surgeRecovery.test.ts` in a cap pause.
  - Until then, read 43.6 % as "28 % killed".

### Nits
- **W2F-N1 OPEN: a W1K-I1 leftover.**
  - `src/cycle/engine.ts:243`, `tests/unit/cycle/c10.test.ts:89` and `c11.test.ts:77` say that `partPower.test.ts` pins the fit's rejection. The pin is in `surgeRecovery.test.ts` ("W1K-I2"), and `partPower.test.ts` has no slam.
  - `engine.ts:242` still says the fit "hangs at about 11 kN". Since D4-13 it loses the gas path, holds it, and makes about 94 kN by 10 s.
- **W2F-N2 OPEN: the continuation walks only (N1, N2, Wf).**
  - The operating conditions take their target value at the first step. Examples: the recovery's VBV jump to `maxFraction` (`model.ts:772-775`), or an ambient change.
  - The W1K-I2 fit's losses happen with the VBV fully open.
  - If losses appear at a VBV switch, walk the VBV fraction too. Say so in the `matchedSolve.ts` header.
- **W2F-N3 OPEN: a missing contract invariant.** `validateCycleState` (`src/contracts/cycle.ts:391-404`) does not check that `status === 'held'` implies `lostSolves ≥ 1`. This is a cheap invariant for the UI annunciator.
- **W2F-N4 OPEN: the "sensed P3" has no sensor lag or noise** (`model.ts:664-676`). A detection in 0.02 s is therefore the best case. Before W3's surge scenarios, add a ledger note, or a first-order lag with a stated time constant.
- **W2F-N5 OPEN: a held step costs about 12× a normal step.**
  - Measured on the W1K-I2 fit's slam (probe `w2f-c12`, `CASE=fit`): steps with a lost solve make 24.2 matched-solver calls, against 2.0 on the other steps.
  - The cause: every snapshot retries the direct solve plus the whole halving walk.
  - Fix: w2/app-ui's worker budget should allow for this, or the retry should back off while held, for example to once per 0.1 s of simulation.
- **W2F-N6 OPEN: a constant-dependent survivor.**
  - The `fadec.ts` survivor `/ SURGE_RESTORE_S` → `*` (`fadec.ts:153`) is equivalent only while the constant is 1. A ramp test with another restore time would kill it.
  - MUTATION.md should say "equivalent at the current constant".

**Verdict w2/followups @ef2bb19: MERGE.**
- Every gate is green.
- C12 is pre-registered, sourced, mirrored in `thresholds.ts`, and honestly met.
- D4-13 removes the silent sub-idle fallback and flags every lost solve. Every transient test backs this with a real zero-lost assertion.
- The contract field is minimal and validated.
- The FADEC extraction is bit-identical (independent fingerprint), and the mutation scores reproduce.
- The Important items are follow-ups:
  - W2F-I1, before w2/app-ui shows the annunciator;
  - W2F-I2, with the D4-18 settling round;
  - W2F-I3, in the next cycle round.

## Critic pass 7: w2/reference @ca296ae

I reviewed `w2/reference` @ca296ae against main 4afb9d4 on 2026-10-27 as the pass-7 critic. The branch is from e1ca8a2, so the review diff is `e1ca8a2...ca296ae`. In scope:
- the f64 oracle in `src/flow/reference/`;
- the mesh loader in `src/flow/mesh/`;
- `docs/SOLVER.md`;
- the CPU ladder L1-L9 in `tests/ladder/`;
- decisions D4-8..D4-12 and D4-19..D4-28.

D4-25..D4-28 were decided on this tip, after its code was written, so their implementation is the next round's work. Checklists applied: typescript-reviewer, silent-failure-hunter, pr-test-analyzer.

New probes:
- `docs/reviews/probes/w2r-blockage.probe.ts.txt` (plain Node, `ROOT` = a checkout): the W2R-6 duct from its converged state, run in the plain tracking and physical-time modes.
- `docs/reviews/probes/w2r-l8-vonneumann.py.txt` (Python, no dependencies): the 1D fully discrete stability limit of the 3-stage scheme, on scalar advection and on the preconditioned acoustic pair.
- The L8 experiments (§ L8 below) used a scratch copy of `src/flow/reference` at ca296ae with environment switches. The driver and the patch are described there; they are not committed, because they edit the solver.

**Gates at the tip.** I reran them in the builder worktree; its tracked files were unchanged afterwards. The other branch's gates shared the CPU.
- `npm test`: 1704 passed, 6 expected fail, 83 files.
- `npm run typecheck`: clean. `npm run lint`: clean.
- `npm run coverage`: lines 99.57 %, statements 98.69 %, branches 88.05 %, functions 99.62 %; thresholds pass.
  - `src/flow/reference`: lines 100 %, branches 88.45 % (gate 85 %).
  - `src/flow/mesh`: 98.60 % / 89.16 %.
- `npm run test:mesh`: 29 passed.
- `npm run test:ladder`: 9 files passed, 4 failed, 720 s.

**Ladder at ca296ae (my run).** Every value matches the handoff table.

| case | metric | threshold | value | |
|---|---|---|---|---|
| L1 | quiescent, 130k f32 asset, 2 its (residual and state bitwise 0) | < 1e-4 m/s | 0 | PASS |
| L1 | uniform M 0.5, 130k f64 metrics, 50 its | < 1e-4 m/s, growth ≤ 2× | 2.03e-13 | PASS |
| L1 | the same on the shipped f32-metric asset; asset GCL defect | reported | 1.42e-5 m/s; 1.31e-7 | reported |
| L2 | L1(ρ) / shock offset | < 1 % / ≤ 1 cell | 0.277 % / 0.228 | PASS |
| L3 | L1(ρ) vs the 1D HLLC reference | < 2 % | 0.211 % | PASS |
| L4a | Mach / choked ṁ (915 its) | < 1 % / < 0.5 % | 0.278 % / 0.0997 % | PASS |
| L4b | shock position at 170 × 17; D4-19 steadiness | < 2 %; ≤ 0.1 % | 1.640 %; 0.0258 % | PASS |
| L4b | convergence | reported | 0.146 of the first at 15000 | reported (open) |
| L5 | ṁ (948 its) | < 1 % | 0.0843 % | PASS |
| L6 | radial equilibrium free / solid; drift | < 0.1 % q; < 1e-4 | 0.0300 % / 0.0029 %; 4.7e-15 / 5.4e-8 | PASS |
| L7 | M 0.01 Cp asymmetry (48 × 48) | < 0.02 | 0.0434 | **FAIL** (D4-26) |
| L7 | M 0.01 Cd / iteration ratio | < 0.01 / ≤ 3 | 0.00924 / 0.893 | PASS |
| L7 | plain M 0.01 asymmetry, Cd; M 0.3 Cp shift from the D4-20 scaling | reported | 0.347, 0.0043 (not converged); 5.9e-3 | reported |
| L8 | velocity error at M_cut 0.003; convergence | < 1 %; 1e-5 | 0.406; not converged | **FAIL** (D4-27) |
| L8 | plain tracking | reported | 0.190 | reported |
| L9a | Euler work; convergence | < 1e-4; 1e-6 of the peak | 7.79e-6; not converged | PASS; **FAIL** (D4-25) |
| L9b | Rankine-Froude; convergence | < 2 %; 1e-5 of the peak | 0.799 %; not converged | PASS; **FAIL** (D4-25) |
| f32 | closed-box storage error, tracking 1 / 10 / 100 its | ≤ tol / 10 | 1.85e-7 / 4.42e-7 / 1.39e-6 | PASS |
| f32 | the same, physical time | ≤ tol / 10 | 8.35e-8 / 2.40e-7 / 1.32e-5 | PASS |

**Is the code SOLVER.md term for term?** Yes, for the scheme at this tip. Checked line by line:
- **§3 gas (`gas.ts`).**
  - The divided-difference enthalpy and entropy, with the secant cp and the 1000 K break handled both ways.
  - Δh, Δe and D∞.
  - `temperatureGauge`: exactly 3 Newton steps from the stated linear start.
  - `temperatureFromPressure`, `pressureGauge` and c².
  - I re-derived T′ from (p′, ρ′) and the p′ gauge: both are exact.
- **§4 state (`state.ts`).**
  - `consToPrim` and `primToCons` as written, with `dq2` without cancellation.
  - The primitive record is (ρ′, u, v, rw, p′, Z, T′, c).
- **§5 BCs (`boundary.ts`).**
  - The far field, physical and preconditioned (λ±, a±, w±, the outflow/inflow switch for w_s, δu_t, rw and Z).
  - The inflow: the σ Newton with its derivative −(ρ_b σ + ρ_s c_s), τ in 3 steps, p′_b through `expm1`, and the ghost's ρ′. I checked each of these.
  - The outflow, the axis (v → −v, rw even, which holds: rw = Ωr² for solid-body rotation), and the wall ghost (extrapolated scalars, rw and tangential velocity; mirrored normal velocity per layer).
  - The remap applies to physical ghosts only.
- **§6 MUSCL (`muscl.ts`).**
  - The sharp van Albada, the face states, and the per-cell, per-direction positivity fallback on q − |σ|/2, written so that NaN falls back.
  - Slopes on ghost layer 1 come from layer 2.
  - No corner ghosts.
  - D4-25's smooth form is not here yet (W2R-I1).
- **§7 SLAU2 (`slau2.ts`)** against Kitamura & Shima: g, V̄±, M̂ and χ (q̄ includes the swirl, as the 3D |V| should), β±, p̃, and the upwinded transported quantities.
  - The D4-20 term is in the stated code order. `machCut = 1` gives f_a = 1, the plain flux bitwise.
  - I checked the antisymmetry F(L, R, S) = −F(R, L, −S) term by term. Every swap is an exact negation or a commutative product or sum, so it is bitwise.
  - The wall face carries only p′_w, the interior cell's face value.
- **§8 and §9 (`sources.ts`, `solver.ts`).**
  - The face blockage is b_f = ½(b_L + b_R), with a ghost carrying its source cell's b.
  - The pressure/swirl source is p′Σ b_f S_f plus b ρ w² A on the outward b-weighted vectors.
  - Source rates are per gas volume, with diagonal damping, and `massSourceRates` gives s_η = s_m Δh0.
  - The residual signs (+ for the −side cell) are right, and both sides of an interface compute the face.
- **§10 time stepping (`solver.ts`, `precondition.ts`).**
  - The local step uses the b-weighted max over each direction's two faces, plus the preconditioned spectral radius.
  - RK (0.2, 0.5, 1) with the point-implicit divisor. β² (with the Δp term) is frozen at stage 1, like τ.
  - The δU update: δp contracts with (1, u, v, rw, Δh0, Z)/c² to exactly 1, which I re-derived. So the pressure increment is scaled by β², and nothing else changes.
  - SSP-RK3 uses (1; ¾, ¼; ⅓, ⅔) with τ = dt/(bV), and the default dt is CFL_phys · min(bV/λ).
  - Physical time uses the physical far field and machCut 1.
  - The centrifugal source is explicit (D4-28).
- **§11:** the residual is recorded from stage 1.
- **The W3 interface** (`SourceModel`, `setBlockage`) is adequate for the Hall-Thollet body forces, the combustor and the bleeds. The stage primitives, the mesh and the blockage are all available. Two small gaps: W2R-N1 and W2R-N3.

**Are the ladder cases honest?**
- **Pre-registration.** The git history shows every CPU variant written before its run:
  - a1aa697 and d237f69 (L8 at 64 × 24) come before the first ladder commit, bd927f3;
  - the L4b grid study (0c7cc4d) comes before 882333d;
  - D4-19's steadiness check and L8 at M_cut 0.003 (27b6bff) come before 66164a5 and ffbf367;
  - the L9 peak-residual reference (0c7cc4d) was confirmed by D4-23 (d).

  The L7 line "both Mach numbers run preconditioned with minMach = M_cut = M∞" entered with 27b6bff. That was after the first preconditioned L7 runs, but preconditioning there is D4-10's method, not a resolution choice, and M_cut = M∞ was set before the D4-20 runs.
- **D4-19.**
  - The position row passes only with max − min of 20 samples over the last 2000 iterations ≤ 0.1 % of the length (0.0258 % measured).
  - The residual stall is reported, not hidden.
  - The run starts from the exact quasi-1D answer, so the samples should be kept (W2R-N4). The grid trend (2.38 / 1.64 / 1.19 %) shows the shock left its initial position for a grid-dependent equilibrium.
- **D4-26 (L7 at 96 × 96)** is not done at this tip. The scratch study (0.134 / 0.043 / 0.013 at 24 / 48 / 96) is the evidence D4-26 accepted. The two-refinement sequence and the PHYSICS.md "CPU variants" amendment must come first in the next round. The case still fails at 48 × 48, visibly.
- **L1** is bitwise where it claims to be (`every(v => v === 0)` on the residual and the state).
- **L9's peak-residual convergence** is per D4-23 (d).

**Is the §12.2 tolerance table adequate for w2/solver?**
- The f32-storage margins are real: 54-720× the tolerance.
- It is incomplete. It has no row for the preconditioned tracking mode, which is the engine's mode, and row C names a helper that does not exist (W2R-I2).
- It is otherwise sound:
  - bitwise rows where the gauges make exact zeros possible;
  - relative errors against the perturbation scale;
  - a Sod row that allows for limiter switches.

**The targeted Stryker spot check.** Main has no `vitest.mutation.config.ts` and no `MUTATION_TESTS`; both come with w2/followups. So I ran it on the trial-merged tree, with Stryker 10.1.1, each module against its direct suite only, a private incremental file, concurrency 6, in the foreground.
- **`src/flow/reference/muscl.ts` with `muscl.test.ts`: 88.64 %** (38 killed, 1 timeout, 5 survived).
  - Equivalent: `ab > 0` → `>= 0` (the formula gives 0 at ab = 0), and `+ 1e-30` → `- 1e-30` (never reached at a² + b² ≈ 1e-30).
  - Killable (W2R-N5):
    - `k < 6` → `<= 6` (`muscl.ts:27`): it writes a seventh slope into the next cell's slot;
    - the positivity tests at exactly zero, `> 0` → `>= 0` for both ρ and p (`muscl.ts:36`).
- **`src/flow/reference/slau2.ts` with `slau2.test.ts`: 90.96 %** (151 killed, 15 survived).
  - Equivalent: β± `>= 1` → `> 1` (both branches give the same value at |M| = 1).
  - Not equivalent, and none is caught. These are wrong fluxes (W2R-I4):
    - the face swirl `rw / rf` → `rw * rf` (`slau2.ts:38`);
    - the face density `ρ∞ + ρ′` → `ρ∞ − ρ′` (`:44`);
    - the kinetic part of dh0, `+` → `−` (`:48`);
    - the zero-area `out.fill` removed (`:81`);
    - χ = (1 − M̂)² → (1 ± M̂)(1 ∓ M̂) (`:95`, two mutants);
    - g's sign (`:96`);
    - V̄'s `/` → `*` (`:97`);
    - p̃'s split term and the `ρ̄ c̄` factor of its dissipation term (`:107`, `:109` ×3);
    - `physicalFlux` without its `side()` call (`:132`). It then reads the module-level `sideL` that the previous `slau2Flux` call left behind.

### L8: the unstable M_cut band (D4-27), the critic's independent read

**Method.** A scratch copy of `src/flow/reference` at ca296ae with environment switches:
- M_ref of the D4-20 term set to local, `max(M, M_cut)` (the shipped form), `sqrt(M² + M_cut²)`, or M_cut;
- β² with or without its Δp term, and with a `max` or a smooth floor;
- M_ref per face and β² per cell frozen at an iteration;
- separate minMach and M_cut;
- the sink strength K, the CFL, NR, the far-field β∞, and the RK stage sets;
- an AUSM+-up-style velocity-diffusion floor (`max(q̄, M_cut c̄)` in SLAU2's p̃ term).

Each run is L8's own set-up for 6000-16000 iterations, printing the residual, the L8 error, and the polar (P1, P2) content of p′ at five radii. The baseline reproduces the handoff: at M_cut 0.003 the residual grows to 0.26 of the first and the error to 55 % by 6000 iterations, while 0.0015 stays near 1e-4 at 0.4 %.

**What the mode is.** A P2 (Legendre l = 2, fore/aft symmetric) pressure mode, oscillating with a period of about 1000 iterations. It peaks at r ≈ 0.27 m, which is where the sink flow's local Mach equals 0.003. The P1 content stays at 1e-5 of it.

**What it is not.**
- **Not a nonlinear switch.** With M_ref per face and β² per cell frozen at iteration 2000, it grows at the same rate: 0.245 at 6000 against 0.262 with live coefficients.
- **Not the kink of D4-20's M_ref.** It also grows with `sqrt(M² + M_cut²)` (0.275).
- **Not β's Δp term.** Without it, the residual reaches 0.349.
- **Not the kink of β.** The smooth floor β² = M² + minMach² delays the growth (0.10 at 6000) but does not stop it. The same holds with both terms smooth (0.094).
- **Not D4-20's M_cut at all.** The mode follows the preconditioner's floor minMach:
  - minMach 0.003 with M_cut 0.0015 grows (0.20);
  - minMach 0.0015 with M_cut 0.003 converges (5e-5, error 0.7 %).
- **Not the far-field β∞ or an absolute Mach value.** The case is Mach-similar:
  - halving the sink (K 112.5) with minMach = M_cut = 0.0015 gives the same residual history to three digits as K 225 at 0.003;
  - doubling it at 0.006 does the same;
  - K 112.5 at 0.003 converges.

  So the band is a band of the radius r* where M(r) = minMach: 0.23-0.30 m unstable, 0.19 m and 0.38 m stable. It is not a band of values.
- **Not a mode of the rest state.** Without the sink, a 1 Pa P2 pulse at r 0.3 m decays at both 0.003 and 0.0015. The base flow is needed to trap the mode.
- **Not a semi-discrete instability.** The growth falls much faster than linearly with the CFL:
  - 1.5: fast;
  - 1.2: about 7× slower;
  - 1.0: slow growth, to 1.4e-2 and 3.3 % error at 12000;
  - 0.9: neutral;
  - 0.75: decays over 16000 iterations, ending at 4e-4 and 0.5 %, with a residual floor that is probably the sharp limiter.

  An unstable eigenvalue of the preconditioned semi-discrete operator would grow at a rate proportional to the CFL per iteration. This is the fully discrete map: the 3-stage RK with local steps. Refining radially (NR 96) delays the growth but keeps it (0.74 error at 12000).
- **Not fixed by the AUSM+-up-style velocity diffusion floor alone.** It halves the growth at CFL 1.5 (0.128 at 6000) and still grows slowly at CFL 1.2.
- **Untestable variants:**
  - the physical far field diverges (NaN at 29 iterations, as the builder found);
  - Taylor RK3 (1/3, 1/2, 1), α₁ = 0.25, and Jameson RK4 each diverge within about 100 iterations at CFL 1.2-1.5, even at 0.0015, so a stage-set swap is not a drop-in test.

**Mechanism (hypothesis).** A fully discrete instability of the preconditioned tracking iteration at its default CFL 1.5, in the region where the preconditioner's floor holds β above the local Mach (dead air, q ≪ βc).

The 1D von Neumann analysis (probe `w2r-l8-vonneumann`) shows why the margin is thin there:
- It reproduces D4-8's limit for scalar advection: 1.541.
- It gives only **0.972** for the preconditioned acoustic pair at rest with the D4-20-matched dissipation, for any β (0.0015, 0.003, 0.006).
- The reason: linearised at rest, SLAU2's velocity dissipation q̄(β⁺ + β⁻ − 1)ρ̄c̄ is second order and vanishes. The only damping of the pseudo-acoustic pair is then the scaled mass-flux pressure diffusion, about a quarter of what upwinding gives advection. The 3-stage set's |G(iy)|² = 1 + 0.05y⁴ + 0.01y⁶ is anti-dissipative on the imaginary axis and needs that damping.
- β/M_ref ≠ 1 changes the limit (0.77 at ½, 1.24 at 2).
- An AUSM+-up p_u term with K_u = 0.5 raises it to 1.41.

D4-8's linear-stability pin (`rk.test.ts`) covers only the advection family. The 1.5 default therefore has no stability basis in preconditioned tracking.

In 2D, local time stepping splits the CFL between the directions, so the margin is case-dependent. In L8 a P2 pseudo-acoustic mode is held near r*, where the pseudo-acoustic speed βc changes from following q (inside, where SLAU2's q̄-scaled velocity diffusion acts) to the constant floor (outside, where it vanishes). That mode crosses the limit for CFL ≳ 0.9 when r* sits at 0.23-0.30 m in this geometry.

The 1D numbers do not order the 2D cases exactly: in 1D, β/M_ref = ½ is the worse case, yet in 2D the minMach 0.0015 / M_cut 0.003 run converged. So the trapping by the β profile is part of the story, and the 2D amplification analysis is the proof still missing.

The engine's static far field is the same regime (local Mach ≪ minMach). The kernel would inherit this.

**Fix direction** (not implemented):
1. Do the D4-27 analysis as a fully discrete one. Use the amplification of the RK3 + local-step map on the preconditioned operator, not semi-discrete eigenvalues. A power iteration of the frozen-coefficient iteration map about the L8 state gives the mode and its factor cheaply. Extend `rk.test.ts`'s pin to the preconditioned acoustic family.
2. Give the pseudo-acoustic pair a dissipation matched to the preconditioned speed in both equations. That means a velocity (pressure-flux) diffusion scaled with M_ref c̄ (AUSM+-up's p_u, f_a c̄) next to D4-20's mass-flux term, with K_u from that analysis. It must stay symmetric so the bitwise antisymmetry holds. This is a scheme change beyond D4-20, so it needs a decision.
3. Set the preconditioned tracking CFL from that analysis: without (2), about 0.75-0.9 for L8; with it, the limit the analysis gives. The cost is iterations within D4-2's solver budget.
4. **Do not move M_cut.** The band follows minMach, so a different M_cut would not even remove it. The engine's 0.003 can stay once (1)-(3) hold.

The L9a/L9b and duct stalls are the limiter's (D4-25), a separate cause. D4-25's smooth form should go in first, so that L8 at CFL 0.75 can show whether it then converges to 1e-5.

### Blocking
- **W2R-B1 OPEN: W2R-6, a linear instability of the plain scheme with blockage, is open but invisible.**
  - **What the round-2 handoff (b7eb36d) found:** "blockage destabilises the plain scheme ... ×1e3 in 300 iterations at M 0.06 and ×1e12 in 1000 at M 0.3", and W3's body-force rows will meet it.
  - **Where it is now:** it is not in the round-3 handoff's open items or decisions, and no orchestrator decision covers it (D4-19..D4-28 do not mention it). The only trace is a comment in `tests/unit/flow/precondition.test.ts:286-287`. That comment calls the mode "slowly growing" and limits the plain check to 30 iterations so that it does not show.
  - **My probe `w2r-blockage` at ca296ae**, on the test's duct (b_min 0.85) started from its preconditioned steady state (residual 1e-11):

    | Throat Mach | Mode | Growth of max\|ΔU\| over 1000 iterations |
    |---|---|---|
    | 0.06 | plain tracking | 1e-11 → 0.49 |
    | 0.06 | physical-time SSP-RK3 at its own dt (3.5e-5 s) | 2e-11 → 0.83 |
    | 0.35 | plain tracking | 3e-9 → 30 |
    | 0.35 | physical-time SSP-RK3 | 3e-9 → 1.5e-5 |
    | 0.3, b = 1 (no blockage) | both | stable (3e-9 throughout) |

  - **Why it blocks.** Physical time is the mode of the surge and light-off events, and every W3 blade row has blockage. The rule for this merge is that failing items must be visible and documented, which this one is not.
  - **Fix (no scheme change needed for the merge):**
    - pin it as an `it.fails` test, or a ladder row that reports FAIL, for both modes;
    - correct the comment;
    - carry it in the handoff and in SOLVER.md's open notes;
    - raise it for an orchestrator decision before W3. The round-2 lead was to linearise the p∇b source with face against cell pressures.

### Important
- **W2R-I1 OPEN: the merged contract is not yet the settled scheme.** The decisions were made after this tip:
  - D4-25: SOLVER.md §6 and `muscl.ts` still have the sharp `ab > 0` switch.
  - D4-26: L7 still runs at 48 × 48 and fails.

  These rows fail visibly and are documented, so this does not block the oracle. But w2/solver must not implement §6's limiter until the next round lands the smooth form, in this order: SOLVER.md first (the ε rule and its scaling), then the oracle, then the L2/L4 shock rows and the positivity fallback green.
- **W2R-I2 OPEN: §12.2 has no row for the preconditioned tracking mode, and row C is mis-specified.**
  - **The gap.** Case C (`tests/ladder/cases/f32.ts`) runs unpreconditioned, and row E does not say. So nothing in the GPU table checks the kernel's β², the δU update, the D4-20 scaling or the preconditioned far field. That is the engine's mode.
  - **Row C** names `tests/ladder/oracle.ts` `smoothPerturbation`, which does not exist: the pulse is a local function in `cases/f32.ts`. It also says "the real mesh", but the storage experiment runs on a 3-block 20 × 12 closed box.
  - **Fix:**
    - add C-pre rows (case C with `lowMachPreconditioning { minMach 0.003 }`, 1 / 10 / 100) and an L7 or L8 set-up row;
    - export the perturbation from a module that both suites import;
    - state the mesh of each row;
    - measure the storage error for the new rows, as for the others.
- **W2R-I3 OPEN: the preconditioned tracking CFL 1.5 has no stability basis** (§ L8 above). D4-8's pin covers advection. The 1D limit for the preconditioned acoustic pair is 0.97, and L8's mode is a fully discrete instability that follows minMach. Fix: the four steps under "Fix direction" above.

- **W2R-I4 OPEN: the oracle's own flux test cannot tell a wrong SLAU2 flux.**
  - The Stryker survivors above (the face swirl, the face density sign, dh0's kinetic sign, χ, g, V̄ and p̃'s dissipation) all pass `slau2.test.ts`. That suite checks properties: antisymmetry, consistency for equal states, and D4-20's exact 1/f_a ratio. It never checks a flux value for unequal states.
  - My term-by-term reading found the code right, and the ladder (L2, L4) would catch gross errors. But this module is what the WGSL kernel is matched against, so a subtle error would pass into the kernel as "agreement".
  - Fix: add independent value tests for three or four unequal state pairs: a subsonic jump, an expansion with g ≠ 0, a swirl case with w ≠ 0 and ρ′ ≠ 0, and a transonic face. Compute the expected values from the paper's formulas outside the module (by hand, or with a small script of their own), at 1e-12 relative. Then re-run this spot check: the score should be ≥ 97 %.

### Nits
- **W2R-N1 OPEN.** `ReferenceSolver.setBlockage` (`solver.ts:182-207`) does not check b ∈ (0, 1] (SOLVER.md §8). A b of 0 makes τ = CFL/λ · 1/(bV) infinite, and the failure surfaces only as a later NaN. Throw instead.
- **W2R-N2 OPEN.** The far-field, wall and outflow ghosts copy T′ and c (record entries 6 and 7) from the source cell instead of computing them (`boundary.ts:119-120, 218-219`). Nothing reads a ghost's T′ or c, since SLAU2 recomputes them. SOLVER.md §5 should say they are don't-care, so the kernel neither relies on them nor wastes work on them.
- **W2R-N3 OPEN.** `SourceContext.time` is the step's start time in all three SSP-RK3 stages (`sources.ts:25`, `solver.ts:426`). A time-dependent W3 source (a fuel or bleed schedule in a physical-time event) then drops to first-order time accuracy. Pass the stage time: t, t + dt, t + dt/2.
- **W2R-N4 OPEN.** L4b starts from the exact quasi-1D answer with the shock at the target, and its residual stalls. Keep D4-19's 20 position samples in `reports/ladder/L4b.json` (oscillation against drift). Preferably also start from an offset shock (x_s ± 5 % of the length) to show the equilibrium is reached from both sides.
- **W2R-N5 OPEN.** `muscl.test.ts` misses two checks: the positivity fallback at exactly zero face density or pressure, and that `limitedSlopes` writes only its six slots. Use a sentinel past `oOff + 6` (survivors `muscl.ts:27, 36`). When D4-25's ε replaces the `1e-30`, test the ε rule's scaling as well.
- **W2R-N6 OPEN.** `slau2.ts:28-29` keeps `sideL`/`sideR` as module-level scratch objects that `slau2Flux` and `physicalFlux` share, which is what the `:132` survivor relies on. This is fine single-threaded, but it is a re-entrancy trap if the oracle ever runs in workers or interleaved. Make them locals, or give `physicalFlux` its own.

**Verdict w2/reference @ca296ae: FIX FIRST (W2R-B1 only).**
- **Why it is close.** The oracle implements SOLVER.md term for term. Its ladder is honest and pre-registered, and every failing row is visible and under a decision: L7 under D4-26, L8 under D4-27, L9a/L9b convergence under D4-25. Those do not block it.
- **Why it waits.** W2R-6 is a real linear instability of the plain and physical-time scheme with blockage, open since round 2. It is no longer in the handoff, has no decision, and is not visible as failing.
- **What turns it into MERGE without another full pass:** a test that pins W2R-6 as failing in both modes, the corrected comment, and the entry in the handoff and SOLVER.md.
- W2R-I1..I4 go to the next reference round. W2R-I2 and W2R-I4 must be done before w2/solver writes its oracle comparisons.

**May w2/solver start from the merged reference? Yes, once W2R-B1 is pinned and the reference is merged, within these limits:**
- **Implement now, as SOLVER.md states it:**
  - §2-§5: the mesh, the gas, the gauges and the BCs;
  - §7 SLAU2, including the D4-20 term and its bitwise expression order;
  - §8 and §9: the sources, the blockage and the residual;
  - the §10 SSP-RK3 and the plain tracking RK;
  - the §12.1 exactness properties.
- **Wait for:**
  - **the limiter (§6):** the next round's SOLVER.md text for D4-25's smooth form (W2R-I1);
  - **preconditioned tracking's CFL, minMach and any added velocity diffusion:** D4-27 and W2R-I3, because the 1.5 default has no stability basis there. Implement the preconditioner itself (β², δU, the spectral radius, the preconditioned far field) now. Do not treat its CFL or its dissipation as final.
  - **the §12.2 preconditioned rows (W2R-I2) and the oracle's SLAU2 value tests (W2R-I4)** before the Dawn tests against the oracle are written.

## Critic pass 7: trial merge (w2/followups @ef2bb19 → w2/reference @ca296ae)

- **Merge.** I ran sequential `git merge --no-ff --no-commit` on a detached HEAD at the critic's HEAD (main 4afb9d4 plus this pass's followups log), with a scratch commit between the steps.
  - Both steps are clean.
  - PHYSICS.md auto-merges: followups' ledger rows and C12, and the reference's §3.3 CPU variants.
  - `stryker.config.mjs` keeps followups' `vitest.mutation.config.ts`. Its default set includes `tests/unit/flow/**`, so the reference's flow suites join the mutation base set.
- **`npm run mesh`:** no working-tree change, so the committed manifest and outputs are byte-identical.
- **Gates on the combined tree.** These ran quiet except for the critic's own L8 probes.
  - `npm test`: 1804 passed, 6 expected fail (91 files).
  - `npm run typecheck`: clean. `npm run lint`: clean.
  - `npm run coverage`: lines 99.59 %, statements 98.73 %, branches 88.35 %, functions 99.62 %; every threshold passes.
    - `src/flow/reference`: lines 100 % (branches 88.45 %).
    - `src/flow/mesh`: 98.60 %.
    - `src/cycle`: 99.58 % (91.76 %).
    - `src/thermo`: 100 %.
    - `src/contracts`: 99.67 %.
  - `npm run test:mesh`: 29 passed. `npm run test:gpu`: 15 passed (4 files).
  - `npm run test:ladder`: 9 files passed, 4 failed, 313 s. The same rows and the same values as at the reference tip: L7 asymmetry, L8, and the L9a/L9b convergence rows fail.
- **The Stryker spot check** ran on this tree: muscl.ts 88.64 %, slau2.ts 90.96 % (see the reference section above).
- **Restore.**
  - `git merge --abort`, back to branch `critic`.
  - Removed the generated `public/mesh/*.bin`, `coverage/` and `reports/`.
  - Stryker cleaned its sandboxes.
  - Both builder worktrees are clean at ef2bb19 and ca296ae. Their ignored `coverage/` and `reports/` existed before and were refreshed by the gate runs.
  - No dev server or browser was used.

**Orchestrator decisions needed (pass 7):**
- **(v) W2R-6** (the blockage instability of the plain and physical-time scheme, W2R-B1): investigate it before W3, whose blade rows all carry blockage, or accept it as a known limitation with a stated workaround. My preference is to investigate it, starting with the p∇b source's face against cell pressures.
- **(w) L8 / D4-27 reframed** (W2R-I3, the L8 section above):
  - The band follows minMach and the CFL, not M_cut. It is a fully discrete instability of the preconditioned tracking iteration.
  - In 1D, the 3-stage RK is stable only to CFL 0.97 on the preconditioned acoustic pair, against D4-8's 1.54 for advection.
  - The question: may the next reference round
    - amend D4-8 for preconditioned tracking (a CFL from a fully discrete analysis), and
    - try a matched velocity diffusion (AUSM+-up p_u, a SLAU2 change beyond D4-20),

    keeping M_cut = minMach = 0.003?
- **(x) C12's recovery bias** (W2F-I2): accept the bias tuned to the case, with a 4 % second pin and the headroom stated in the ledger, or ask the D4-18 round to revisit it.

## Critic pass 8: w2/reference @4553ce2

I reviewed `w2/reference` @4553ce2 against main 00bc99b on 2026-10-27 as the pass-8 critic. Main already holds the reference up to 9d99b04 (W2R-B1), so the review diff is `9d99b04..4553ce2`: rounds 4 and 5. In scope: W2R-I2 and W2R-I4, D4-32 and D4-35 (the fully discrete acoustic analysis, CFL 0.8, p_u), D4-26 (L7 at 96 × 96), L8's velocity row, D4-34/D4-36 (the W2R-6 mechanism), D4-33 (the smooth-limiter retest) and the pass-7 nits. D4-35 and D4-36 were decided on this tip, after its code. Checklists applied: typescript-reviewer, silent-failure-hunter, pr-test-analyzer.

New probe: `docs/reviews/probes/w2r-acoustic-flow.probe.ts.txt` (plain Node, `ROOT` = a checkout). It is a fully discrete von Neumann analysis built from the oracle's own functions instead of a hand model:
- the flux Jacobians of `slau2Flux` by central differences;
- dq/dU of `consToPrim`;
- the matrix of `preconditionIncrement`;
- `spectralRadius` for the local step;
- central-slope MUSCL and the 3-stage G(z), as in `tests/unit/flow/acoustic.ts`;
- a uniform base state that may move (M0 > 0), 1D cells.

Also `docs/reviews/probes/w2r-l8-steady.probe.ts.txt`: ladder L8's set-up at CFL 0.8 run to 40000 iterations (W2R-I7).

**Gates at the tip.** I ran them in the builder worktree; its tracked files were unchanged afterwards. The lookdev-4 gates and a solver builder's GPU tests shared the machine.
- `npm test`: 1735 passed, 9 expected fail, 84 files.
- `npm run typecheck`: clean. `npm run lint`: clean.
- `npm run coverage`: lines 99.57 %, statements 98.69 %, branches 88.07 %, functions 99.62 %; thresholds pass. `src/flow/reference`: lines 100 %, branches 88.67 % (gate 85 %). `src/flow/mesh`: 98.60 % / 89.16 %.
- `npm run test:mesh`: 29 passed.
- `npm run test:ladder`: 10 files passed, 3 failed, 536 s.

**Ladder at 4553ce2 (my run).** Every value matches the handoff table.

| case | metric | threshold | value | |
|---|---|---|---|---|
| L1 | quiescent, 130k f32 asset (residual and state bitwise 0) | < 1e-4 m/s | 0 | PASS |
| L1 | uniform M 0.5, 130k f64 metrics, 50 its | < 1e-4 m/s, growth ≤ 2× | 2.03e-13 | PASS |
| L1 | the same on the shipped f32-metric asset; asset GCL defect | reported | 1.42e-5 m/s; 1.31e-7 | reported |
| L2 | L1(ρ) / shock offset | < 1 % / ≤ 1 cell | 0.277 % / 0.228 | PASS |
| L3 | L1(ρ) vs the 1D reference | < 2 % | 0.211 % | PASS |
| L4a | Mach / choked ṁ (915 its) | < 1 % / < 0.5 % | 0.278 % / 0.0997 % | PASS |
| L4b | shock position at 170 × 17; D4-19 steadiness | < 2 %; ≤ 0.1 % | 1.640 %; 0.0258 % | PASS |
| L4b | convergence | reported | 0.146 of the first at 15000 | reported (open) |
| L5 | ṁ (948 its) | < 1 % | 0.0843 % | PASS |
| L6 | radial equilibrium free / solid; drift | < 0.1 % q; < 1e-4 | 0.0300 % / 0.0029 %; 4.7e-15 / 5.4e-8 | PASS |
| L7 | M 0.01 asymmetry at 96 × 96; the 24 / 48 / 96 sequence falling, all converged | < 0.02 | 0.0131 (0.1347 / 0.0437 / 0.0131; 2053 / 3901 / 8675 its; order 1.63, 1.74) | PASS |
| L7 | M 0.01 Cd at 96 × 96 | < 0.01 | 0.00159 (24: 0.0569, 48: 0.0096) | PASS |
| L7 | iterations M 0.01 / M 0.3 at 96 × 96 | ≤ 3 | 1.048 | PASS |
| L7 | plain M 0.01 at 48 × 48 asymmetry, Cd (not converged); M 0.3 Cp shift, preconditioned vs plain | reported | 0.347, 0.0043; 5.5e-3 | reported |
| L8 | velocity error at M_cut 0.003, CFL 0.8 | < 1 % | 0.360 % (not converged) | PASS (see W2R-I7) |
| L8 | convergence to 1e-5 | 20000 | not converged | **FAIL** (D4-35) |
| L9a | Euler work; convergence | < 1e-4; 1e-6 of the peak | 7.79e-6; not converged | PASS; **FAIL** (D4-36) |
| L9b | Rankine-Froude; convergence | < 2 %; 1e-5 of the peak | 0.799 %; not converged | PASS; **FAIL** (D4-36) |
| 12.2 | storage C / C-pre / C physical / S after 1, 10, 100 | ≤ tol / 10 | 1.7e-7, 1.1e-6, 7.8e-7 / 1.1e-7, 1.7e-7, 5.1e-7 / 8.0e-8, 2.4e-7, 4.2e-6 / 7.3e-8, 1.8e-7, 6.3e-7 | PASS |

**The fully discrete acoustic analysis (D4-32): correct for the family it states, and 1D is its worst cell shape. Two gaps (W2R-I6).**
- *The hand model.* `tests/unit/flow/acoustic.ts` is a correct linearisation. I checked it term by term:
  - the central-slope face symbols, the averages (imaginary) and jumps (real);
  - the mass-flux pressure diffusion β²/(2f_a), the momentum equation without dissipation at rest (SLAU2's p̃ terms are both second order there), p_u as ½K_u f_a Δvn;
  - the local step 1/(β(1 + a));
  - the cubic's coefficients;
  - G(z) = 1 + z + α₂z² + α₁α₂z³.

  Sampling θ in (0, π] is complete, because the r symbols enter only as avg² and jump.
- *My independent analysis* (probe above) uses the oracle's own flux, primitives and preconditioner, with no hand linearisation. At rest it gives the same limits: plain 1.236, matched 0.972.
  - So the model's assumptions hold for the code: χ = 1 at rest, SLAU2's velocity dissipation is second order, the D4-20 factor, the δU update.
  - The scalar rows (v, rw, Z) are exactly decoupled (coupling 0), so the spectrum is the cubic of (ρ′, u, p′) plus three advection diagonals.
- *Cell shape.* The aspect sweep is symmetric in a ↔ 1/a (1.210 at 0.25 and at 4, 1.069 at 0.1 and at 10, my run of `acousticLimit`). It rises monotonically to 1.550 for a square. So the 1D limit 0.972 is the minimum over cell shapes, and 0.8 = 0.82 × it.
- *With flow* (minMach = M_cut = 0.003, β = M_ref = max(M0, 0.003)), the limit rises off rest:

  | M0 / 0.003 | 0.01 | 0.1 | 0.3 | 0.7 | 1 to 10 | 30 | 100 (M 0.3) |
  |---|---|---|---|---|---|---|---|
  | 1D limit | 0.985 | 1.091 | 1.275 | 1.512 | 1.215 | 1.223 | 1.311 |

  So "at rest" is the worst case of the matched family, and the D4-32 choice stands for it.
- *Gap 1, β ≠ M_ref.* The analysis assumes β = M_ref. The scheme does not enforce that:
  - β² takes max(M², minMach², Δp/(ρc²)) per cell;
  - M_ref takes the face's q̄/c̄.

  At rest the limit falls below 0.8 on both sides of the matched value:

  | β / M_ref | ¼ | ½ | ¾ | 1 | 2 | 4 | 8 | 16 |
  |---|---|---|---|---|---|---|---|---|
  | 1D limit | 0.608 | 0.768 | 0.881 | 0.972 | 1.236 | 0.937 | 0.469 | 0.234 |

  With flow at M0 = 0.003, ½ gives 0.907.
  - **β < M_ref** happens on a face faster than its cell: under-damped. In the engine this is the jet and entrainment shear layer beside the static far field (cell M 0.003, face q̄/c̄ near the jet's).
  - **β > M_ref** happens where the Δp term lifts β at low speed: over-damped, past the RK3's real-axis limit at CFL × β/M_ref ≈ 3.7. That is a start from rest or a pressure jump in slow flow.
  - No ladder case shows either one. I checked C-pre: it decays at the same slow rate at CFL 0.8, 0.4 and 0.2 (residual 567 → 18 / 32 / 135 at 4000, my run), so this is not what holds C-pre up.
  - The §10 basis "0.8 × the worst cell shape" is therefore the worst cell shape of the matched family only.
- *Gap 2.* The machCut ≥ 1 test configuration gets the 0.8 default too (`solver.ts:151-152`). Its limit is 0.475 at β 0.06 (as SOLVER.md says) and 0.176 at β 0.003 (my probe).

**Is CFL 0.8 pinned by a test? Yes.**
- `rk.test.ts` pins the limits: plain 1.236, matched 0.972 / 1.550, p_u 1.413 / 1.958. It pins `DEFAULT_CFL_PRECONDITIONED / worst` in [0.8, 0.825], and that the plain 1.5 is unstable on the pair up to aspect 0.5.
- `precondition.test.ts` pins that the default applies without a `cfl` (0.8) and that minMach ≥ 1 keeps 1.5.
- The C-pre rows of §12.2 diverge at 1.5 (NaN at 79), so the kernel's default is checked as well.

**Was p_u removed from the oracle (D4-35)? No (W2R-I5).** D4-35 was decided at this tip, so this is the next round's work, not an omission. But the merged oracle would still describe two schemes.

**L7 (D4-26): honest and pre-registered.**
- 9589a0b (PHYSICS.md 3.3, 14:07:39) states the 96 × 96 pass rows, the 24 / 48 / 96 sequence, the observed order and the monotone-fall condition. It precedes the code (3c9e7c9, 14:28:05) and the run of record (@4927332).
- The pass row requires asymmetry < 0.02, monotone, and every sequence run converged (`l7.ts:137`). My run reproduces it: 0.1347 / 0.0437 / 0.0131, order 1.63 then 1.74 (second-order-like, so discretisation error as D4-26 assumed). Cd falls 0.057 / 0.0096 / 0.0016. The ratio is 1.048.
- The sequence values were known from the pass-7 scratch study before the amendment. That is D4-26's evidence, not tuning: the resolution and the rule are D4-26's, not chosen after the run of record.
- The seven sphere runs run as child processes (`sphereRun.ts`) and parse one tagged JSON line, with an error if it is missing.

**L8's velocity row.** It now passes (0.360 % at CFL 0.8, against 40.6 % at 1.5). But it passes on an unconverged state (3.9e-4 of the first residual at 20000) with no steadiness check (W2R-I7).

**W2R-6 (D4-34/D4-36): the diagnosis is sound.**
- The evidence is consistent:
  - the power-iterated mode is acoustic (σ ≈ 590 1/s ≈ c/L) and read in the linear regime;
  - the steady state has a ±50 Pa sawtooth at the throat;
  - zeroing or centring the p′ slopes, zeroing the u slopes, first order, or the smooth limiter removes it;
  - zeroing the ρ′ or v slopes, or replacing the p∇b source by b_c∇p, does not.
- The reading: blockage is needed only to create a non-uniform plain steady state with extrema. The b ≡ 1 duct is uniform, which is why it was stable in pass 7.
  - The sharp switch then puts one-sided slopes (φ ≈ the smaller jump, ∂φ/∂a → 1) next to every extremum.
  - Their linearisation is what grows. A one-sided slope on the downwind side is anti-dissipative, which fits.
  - b_f = min(b_L, b_R) also removing it fits this reading: it changes the steady state's sawtooth.
- One direct check is missing (W2R-N13). The pins stay (`blockage.test.ts`, three `it.fails`), and SOLVER.md §8 carries the table.

**The smooth limiter is still optional, not the default.**
- `limiter?: 'sharp' | 'smooth'`; `loadLine` passes `this.opts.limiter === 'smooth'` (`solver.ts:530`). No default changed.
- SOLVER.md §6 calls the sharp form the contract and the smooth form a trial.
- The retest (D4-33) is reported with numbers: L9a/L9b converge and W2R-6 goes; L8 breaks at 27-30 %, L1's growth row fails, and four unit tests fail. D4-36's pre-stated rule is the next round's.
- On L1 the reason given is slightly off (W2R-N7).

**SOLVER.md and the oracle term for term: yes, for this tip's scheme.** I checked:
- §6 smooth form, its code order and the ε rule against `muscl.ts:16-44`: S = (ρ∞, c∞, c∞, c∞ r_c, ρ∞c∞², f_st), and a ghost uses its source cell's radius (`rExt`, `solver.ts:166-171`);
- §7 p_u against `slau2.ts:115` (same order);
- §8 the stage times (t, t + dt, t + dt/2) against `solver.ts:341-345`, and the blockage range check against `solver.ts:219-224` (validated before any write);
- §10 the default CFL against `solver.ts:28, 151-152`, except the minMach ≥ 1 clause (W2R-N8);
- §12.2's rows against `tests/ladder/oracle.ts` and `cases/f32.ts`: the mesh of each row, `relativeError` with exact zeros, and the C-pre and S options.

W2R-N6 is done: the side records are per-call locals, and `physicalFlux` gets its own.

**Pass-7 items.**
- **W2R-I1 CLOSED** as D4-33 amended it: the smooth form is an option. D4-36 governs the default.
- **W2R-I2 DONE**: C-pre and S rows, the mesh of each row, the shared set-ups in `tests/ladder/oracle.ts`, measured at 59-2000× margin.
- **W2R-I3 DONE**: CFL 0.8 from the analysis, pinned. W2R-I6 qualifies it.
- **W2R-I4 DONE**: six unequal-state value tests against an independent absolute-variable evaluation, at 1e-12 both ways round; `physicalFlux` after an unrelated flux; the zero-area face over NaN. I did not re-run Stryker: the builder reports 98.80 % on a private config, and the re-run on the mutation config is handoff NEXT 3.
- **W2R-N1 DONE**, **N2 DONE**, **N3 DONE** (its test integrates a linear-in-t fuel source exactly and checks all six stage times), **N5 DONE** (485b69a), **N6 DONE**.
- **W2R-N4 OPEN**: not done.

### Blocking
None.

### Important
- **W2R-I5 OPEN: p_u is still in the oracle (D4-35 says delete it).**
  - Where:
    - `slau2.ts:66-67, 82, 115` (the `ku` parameter and term);
    - `solver.ts:52-60, 98-100, 149, 388, 584` (`lowMachPreconditioning.velocityDiffusion`, `fluxKu`);
    - SOLVER.md §7 (line 165: "the oracle keeps it as an option for the record") and §12.2 (line 346: "If the p_u trial changes the preconditioned scheme ... re-measured");
    - the tests: the p_u antisymmetry test and three p_u value cases in `slau2.test.ts`, and "adds p_u to the momentum residual" in `precondition.test.ts`.
  - The failure scenario: w2/solver's oracle comparisons are written against an oracle with a live, tested second scheme one option away. A later caller (a W3 adapter, a test) turning on `velocityDiffusion` gets a flux the kernel does not have, and the agreement tests would not notice.
  - Fix:
    - delete the option, the term and their tests;
    - keep the SOLVER.md §7 trial table and its numbers as the record of the negative result, with the commit where the code lived (413b623), as D4-35 asks;
    - `acoustic.ts` may keep `ku` as an analysis parameter, because the analysis is the record.
- **W2R-I6 OPEN: the CFL 0.8 basis covers only β = M_ref.** See the analysis above.
  - At rest, with M_cut = 0.003, the 1D limit falls below 0.8:
    - for β/M_ref ≤ ~0.6: a face faster than its cell (0.768 at ½, 0.608 at ¼);
    - for β/M_ref ≥ ~4.6: the Δp term at low speed (0.469 at 8, 0.234 at 16).
  - The failure scenario: the static engine's jet/far-field shear layer and a start from rest put cells in both regimes at the kernel's fixed CFL 0.8. A locally unstable acoustic pair then either stalls the residual or grows, and nothing in the ladder covers it (L7 and L8 are smooth and matched to within a few %).
  - Fix (for a decision; not for this merge):
    - extend §10's table and `rk.test.ts` to β/M_ref ∈ [¼, 16] and state the CFL's validity range;
    - pick a remedy:
      - (a) take the D4-20 M_ref per face from the preconditioner's β (for example max(M_cut, ½(β_L + β_R)) instead of the face Mach), so that dissipation and time derivative are matched by construction (the Weiss-Smith form);
      - (b) include the scaled pressure diffusion's own eigenvalue, β²χ|S|/(2f_a), in the local step's λ, which closes the over-damped side;
      - (c) a ladder case that exercises both sides: a low-Mach jet into dead air, and a start from rest.
    - Also: the machCut ≥ 1 test configuration takes the 0.8 default with a limit of 0.475 at β 0.06 and 0.176 at β 0.003 (`solver.ts:151-152`). Either throw without an explicit `cfl`, or document it at the option.
- **W2R-I7 OPEN: L8's velocity PASS (and L9a/L9b's value rows) are taken on unconverged states with no steadiness check.**
  - `l8.ts:54` passes the row on `worst < 0.01 && count > 0` after 20000 iterations, at 3.9e-4 of the first residual. The case definition (PHYSICS.md 3.3 L8) says "converged to 1e-5", and D4-35 counts the row as passing. L9a's Euler-work and L9b's Rankine-Froude rows do the same. Only L4b has D4-19's steadiness rule.
  - My run of L8's set-up at CFL 0.8 to 40000 iterations (sampled every 2500) settles the substance:

    | iterations | 2500 | 5000 | 10000 | 15000 | 20000 | 25000 | 30000 | 32500 | 40000 |
    |---|---|---|---|---|---|---|---|---|---|
    | velocity error | 1.27 % | 0.48 % | 0.35 % | 0.68 % | 0.36 % | 0.46 % | 0.46 % | 0.45 % | 0.449 % |
    | residual / first | 3.9e-3 | 1.1e-3 | 1.5e-3 | 1.1e-3 | 3.9e-4 | 4.2e-5 | 4.6e-5 | 9.9e-6 | 3.1e-6 |

    - It is slow, oscillating convergence, not a floor and not a growing mode. It reaches 1e-5 at about 32500.
    - The converged error is 0.449 %, so the row's verdict holds.
    - The handoff's "likely the sharp limiter's floor" is not what happens at L8 (the L9 stalls may still be the limiter's).
  - But at 20000 the row read 0.360 %, and between 2500 and 20000 it swung from 0.35 to 0.68 %. A case nearer its threshold would pass or fail on the iteration it stopped at.
  - Fix:
    - pre-register a D4-19-style steadiness condition for every value row taken before convergence (L8's velocity, L9a, L9b): the metric sampled every 100 iterations over the last 2000, max − min within a stated fraction of the threshold. Report it as a row, and make the PASS depend on it.
    - For the orchestrator: L8's convergence row fails only on the 20000 cap (it converges by about 32500 at CFL 0.8). A cap scaled by 1.5 / 0.8 for the CFL change would be a decision, not a fix.

### Nits
- **W2R-N7 OPEN.** SOLVER.md §6 (line 127) explains L1's failure with the smooth limiter as "plain CFL 1.5, above the central-slope acoustic limit 1.236 of §10".
  - 1.236 is the at-rest limit. At L1's M 0.5 the 1D central-slope plain limit is 1.448 (my probe), still below 1.5, so the conclusion holds.
  - The same numbers say the plain default 1.5 has no linear basis for the acoustic family in 1D at any Mach number up to 0.8 (1.236-1.448); it is stable at aspect ≥ 0.25 (1.539). It relies on the sharp switch's clipping.
  - State that in §10, and set D4-36(a)'s plain CFL from the flow-dependent minimum (0.8 × 1.236 = 0.99, so 1.0 is at the edge of the margin, not inside it).
- **W2R-N8 OPEN.** SOLVER.md §10 (line 270) says the default applies "whenever `lowMachPreconditioning` is set and the caller gives no `cfl`". The code (`solver.ts:151-152`) and the handoff exclude minMach ≥ 1. Add the clause. The §7 trial table's "bounded, 36 at 2000 (from 567)" needs its quantity named: the density-residual L2, which I reproduced.
- **W2R-N9 OPEN.** `l7.ts:144`: L7's Cd row passes without `low.conv.converged`, unlike the asymmetry and ratio rows (`l7.ts:137, 151`). An unconverged 96 × 96 run would pass Cd. Add the condition.
- **W2R-N10 OPEN.** `precondition.test.ts:315` dropped the duct's iteration bound (< 4000 at CFL 1.5) instead of restating it for 0.8 (4723 measured). Only the 6000 cap now bounds it. Restate a bound (for example < 5500) so a slowdown in the preconditioned path is caught.
- **W2R-N11 OPEN.** `reports/ladder/` keeps stale reports from 2026-10-26: `L6-free-vortex.json` and `L6-solid-body.json`, whose free-vortex and solid-body rows fail at 1.29 % and 0.45 %, beside the current passing `L6.json`. The directory is ignored, but it is where a reader looks for the ladder of record. Clear `reports/ladder/` at the start of `test:ladder`, or name per run.
- **W2R-N12 OPEN.** The ladder now runs 13 forked files plus L7's seven child processes, so up to 20 solver processes run on a 16-thread machine. Fine for the CPU ladder, but the 30-minute test timeout (`vitest.ladder.config.ts:13`) now hides a hung child for half an hour. Give `sphereChild` a shorter timeout derived from the cap (it has 30 min too, `l7.ts:82`).
- **W2R-N13 OPEN.** W2R-6's reading ("the linearisation of the switch grows") is inferred from term switches. The direct check: a power iteration with the limiter's switch pattern frozen at the steady state (the sign masks of ab and of which one-sided slope is taken). If that frozen linear operator grows, the switch's linearisation is proved; if not, the nonlinear switching is the cause. Cheap with the round-5 scratch driver; worth having before D4-36's trials so the selection rule tests the right mechanism.
- **W2R-N14 OPEN (orchestrator's note, on its loaded merged tree).** `tests/unit/flow/solver.test.ts` "hold the radial equilibrium of a swirling annulus..." took 9.4 s against vitest's default 5 s. It passes alone in 2.9 s, so this is a load flake, but the margin is under 2×. My two unit runs (tip, and trial merge on a loaded machine) passed it. Give the oracle's iterating unit tests explicit timeouts with a reason, as the other flow suites do (`precondition.test.ts` uses 120_000), so that a merge under load does not fail on time.

**Verdict w2/reference @4553ce2: MERGE.**
- Every failing row is visible and under a decision:
  - L8 convergence (D4-35);
  - L9a/L9b convergence and W2R-6's three `it.fails` (D4-36);
  - L4b convergence, reported (D4-19).
- W2R-I2 and W2R-I4, which gated w2/solver's oracle comparisons, are done and correct. The acoustic analysis and its CFL are correct for the matched family and pinned. L7's refinement is honest and passes.
- Before merge, or as the first item of the next round (orchestrator's choice): **W2R-I5**, deleting p_u as D4-35 decided (small). **W2R-I6** and **W2R-I7** go to the next reference round with D4-36's trials. W2R-I6 also goes to w2/solver as a known limit of CFL 0.8.

## Critic pass 8: w2/lookdev-4 @ecf0765

I reviewed `w2/lookdev-4` @ecf0765 against main 00bc99b on 2026-10-27 as the pass-8 critic. The branch is from 30ce54e, so the review diff is `30ce54e..ecf0765`.

In scope:
- P4's pre-registration;
- the shading cuts;
- D4-24's back-to-back mode and `tools/lookdev/ab.ts`;
- W1V-I1 fix (b) (rotor motion vectors and our TRAA resolve);
- W1V-I3 (the EqualDepth test);
- the visual notes (the stand, the dull plug, the spinner spiral);
- D4-4 (the exploded spools easing to a stop);
- the official A/B of record `docs/look-dev/ab-bad7ad0-23239a1.json`.

Checklists applied: typescript-reviewer, silent-failure-hunter, pr-test-analyzer, and the three.js/WebGPU pitfalls in GPU_FACTS. I ran no bench, `ab.ts` or official capture.

**Gates at the tip.** I ran them in the builder worktree; its tracked files were unchanged afterwards. The reference ladder and a solver builder's GPU tests shared the machine.
- `npm test`: 1623 passed, 5 expected fail, 74 files.
- `npm run typecheck`: clean. `npm run lint`: clean.
- `npm run coverage`: lines 99.51 %, statements 98.58 %, branches 87.97 %, functions 99.59 %; thresholds pass. `src/geometry`: 99.59 % (branches 90.30 %).
- `npm run test:mesh`: 29 passed.
- `npm run test:browser` (own Playwright Chrome, API port 5190): 22 of 23 passed, 7 files: every preset and the performance profile, fanBlur, equalDepth, rotorMotion. No WebGPU error appeared in any test.
  - `culling.test.ts` timed out at its 120 s while the reference ladder probe and a solver builder's GPU tests ran.
  - Re-run alone it passed in 58 s (wall).
  - So it passes, but its timeout margin is about 2× on a quiet machine (W2L-N6).

**P4 pre-registration: in order.** abc9e13 (PHYSICS.md 3.4, TDD) and ffe3335 (`thresholds.ts`, mirrored verbatim, `thresholds.test.ts`) are the first two commits after 30ce54e, before any shading cut or LOD code (87b17ff).

**The shading cuts.**
- They rest on a measurement: `opaqueCost.ts` runs paired flat/hide/skinsOnly configs with every frame kept. The opaque pass is fragment-bound: unlit about −5 ms, hiding every blade row ≤ 0.6 ms.
- No geometry LOD followed, which is the right consequence.
- The cuts:
  - orange peel dropped;
  - low-frequency noise per vertex;
  - oil canning as a per-vertex tilt;
  - the lip's anisotropy replaced by roughness 0.42;
  - sub-pixel grain gated, with derivatives taken before the branch (GPU_FACTS M47; WGSL needs uniform control flow for `fwidth`);
  - nacelle latches and doors evaluated only near them;
  - TRAA's cross taps;
  - six fan copies.
- The paired A/Bs show them working: back to back, opaque −0.9 ms from part 1, −0.47 more in part 2.
- One LOOKDEV line is stale (W2L-N1).

**D4-24's back-to-back mode and its validity rules.**
- The loop (`src/lookdev/main.ts`, `backToBack`) keeps up to two frames submitted ahead through `onSubmittedWorkDone`, warm-up included, and records every frame's passes and intervals.
- A back-to-back run is INVALID on:
  - a hidden page;
  - the D3-6 throttle signature on its own intervals (a stall);
  - the throttle signature on a side rAF watcher (an occluded window, where rAF is throttled but the loop is not).
- A GPU busy fraction under 60 % is a warning.
- The pure parts are unit-tested: `withPacings`, `backToBackLoad`, `pacedValidity`, `p4Verdict`, `abOrder`, `abSummary`.
- `abOrder` is right: adjacent pairs, the leading side alternating, the leading pacing alternating.
- Three defects in how validity reaches the result: W2L-I2, W2L-I3, W2L-I4.

**D4-24: I confirm the DVFS reading, with two corrections.** From the official JSON, every run:

| run (order) | fps | GPU busy | GPU p50 | opaque | rotors | GTAO | composite | TRAA | output |
|---|---|---|---|---|---|---|---|---|---|
| vsync rep 0, bad7ad0 / 23239a1 | 55.9 / 56.7 | 0.65 / 0.68 | 10.43 / 10.65 | 5.39 / 6.07 | 1.63 / 1.50 | 1.03 / 0.92 | 0.90 / 0.83 | 1.23 / 1.16 | 0.32 / 0.30 |
| back to back rep 0 | 89.6 / 1.5 (INVALID) | 0.73 / 0.01 | 7.86 / 8.75 | 3.64 / 4.54 | 1.07 / 1.05 | 0.72 / 0.72 | 0.74 / 0.74 | 1.11 / 1.11 | 0.27 / 0.27 |
| back to back rep 1 | 80.0 / 82.2 | 0.74 / 0.76 | 8.28 / 8.87 | 3.80 / 4.60 | 1.15 / 1.10 | 0.80 / 0.73 | 0.88 / 0.81 | 1.31 / 1.23 | 0.31 / 0.29 |
| vsync rep 1 | 40.7 / 40.0 | 0.66 / 0.65 | 16.39 / 16.44 | 8.25 / 9.13 | 2.59 / 2.19 | 1.60 / 1.41 | 1.43 / 1.34 | 1.98 / 1.85 | 0.44 / 0.39 |
| vsync rep 2 | 40.6 / 40.6 | 0.66 / 0.65 | 16.37 / 16.34 | 8.11 / 9.02 | 2.59 / 2.10 | 1.63 / 1.38 | 1.52 / 1.32 | 1.94 / 2.02 | 0.46 / 0.40 |
| back to back rep 2 | 78.7 / 73.1 | 0.74 / 0.75 | 8.55 / 9.77 | 4.05 / 5.21 | 1.18 / 1.27 | 0.83 / 0.83 | 0.93 / 0.77 | 1.30 / 1.27 | 0.30 / 0.37 |

- **Confirmed: the vsync GPU time measures the clock governor, not the work.**
  - `src/render/post.ts` is identical at 23239a1 and bad7ad0 (`git diff --stat 23239a1 bad7ad0` touches only engineView, materials, cutaway, motion and the lookdev harness). So GTAO, composite, TRAA and output do the same work on both sides, and their ratio is the clock ratio.
  - In every vsync pair, bad7ad0's unchanged passes run slower: GTAO +12 / +13 / +18 %, composite +8 / +7 / +15 %, output +7 / +13 / +15 %, TRAA +6 / +7 / −4 %. Its opaque pass is 0.68-0.90 ms cheaper. The totals agree within −0.22..+0.03 ms.
  - The lighter commit got a lower clock that spent its saving. That is what a utilisation-following governor does, and it is not what a regression, thermal drift or a timestamp wait would do:
    - a timestamp wait would inflate one pass, not all of them;
    - drift hits adjacent runs alike.
  - The GPU busy fraction is the invariant. All six vsync runs sit at 0.65-0.68, at two very different operating points: rep 0 at 56 fps and 10.4 ms, reps 1-2 at 40 fps and 16.4 ms.
  - The three indicative JSONs agree. Their vsync runs are at 0.63-0.74 busy, and the same pattern holds in their pairs.
- **Correction 1: it does not "fill the frame".** The LOG's reading ("vsync both about 16.3 ms = the governor fills the frame") is not what the runs show.
  - Rep 0 ran at 56 fps with 10.4 ms frames.
  - The 16.3 ms median comes from reps 1-2, which ran at 40 fps: frames that miss every other vsync with the GPU idle a third of the time. A deadline-meeting governor would not settle there.
  - The governor holds utilisation near 0.65, and the frame time follows from that. So a vsync timestamp can sit anywhere between the work's true cost and well over the frame interval.
- **Correction 2: the summary of record includes the INVALID run, and its conditions are not D0-1-clean.**
  - The LOG says that the INVALID repetition was "23239a1 rep 1 ... its pair excludes it". In the JSON it is 23239a1 back to back **rep 0** (1.5 fps over a 28-minute stall, the display asleep). `abSummary` keeps it: the back-to-back summary has 3 pairs, its first value is −0.89 ms = 7.86 − 8.75 from that run, and 23239a1's side median 8.87 includes it.
  - Without it, the valid back-to-back pairs are −0.59 and −1.22 ms (median −0.90). The side medians are 8.28 against 9.32 ms (23239a1 on its two valid runs). Every valid pair is still negative, so the verdict "bad7ad0 did not regress" stands, and the opaque −0.80 / −1.16 confirms it.
  - The record's own `conditions` show the power source changing. At the start: charging, level 1.00. At the end: **not charging, level 0.98**. The indicative JSONs end at 0.76 and 0.45, not charging, and GPU_FACTS M45 calls that run "AC".
  - The page's Battery API is the only power record `ab.ts` keeps (W2L-I4). A switch to battery during the run would explain the step from vsync rep 0 (56 fps) to reps 1-2 (40 fps), and the back-to-back drift (7.86 → 8.28 → 8.55 ms for bad7ad0). The pairs are adjacent, so the paired result survives. But the run should be called paired-indicative, not D0-1 official.
- **Should P4's measure of record become back to back? Yes, as D4-24 decided, on three conditions.**
  - Back-to-back runs are tighter (p10-p90 spread 1.8-3.8 ms, against 8.1-9.2 ms in vsync rep 0 and 3.9-6.3 ms in reps 1-2). Their unchanged passes match to the hundredth in rep 0, and within ±21 % in reps 1-2 with no consistent sign (rep 1 bad7ad0 slower by 7-10 %, rep 2 mixed). They show the work's saving in the total.
  - They are not proven to be at the full clock, though: busy 0.73-0.76, and 74-90 fps with 8-10 ms of timed GPU work per frame (M46: the rest unexplained). Either the loop is CPU-bound and the GPU idles a quarter of the time (then the governor still acts, just less), or about 3 ms of each frame is untimed GPU work. Measuring the CPU time per frame in the back-to-back loop settles which.
  - The conditions:
    1. Only VALID runs enter the medians and pairs (W2L-I2).
    2. The OS power source is checked as AC at the start and end of every run, as `capture.ts`'s `conditions()` already records through `spikes/lib/system.ts` (W2L-I4).
    3. The busy fraction is reported beside the number. The vsync figure stays beside it as D4-24 says, and P2 and L13 stay the end-to-end checks of record.
  - On those terms the DVFS evidence meets D4-24's condition, and the measurement change may apply.

**W1V-I1 fix (b): rotor motion vectors into TRAA, with its own resolve. The mechanism is right; its test cannot fail on it (W2L-I1).**
- `post.ts` overrides `sceneVelocity.load` so that a rotor pixel's velocity is the rigid turn of its rotor-depth world point. The point is turned back by the spool step wrapped to half a pitch (pitch and spool from the rotor-blur MRT) and projected with the previous and current unjittered view-projections. The result is an NDC delta, the same convention as three's velocity: our resolve's `offsetUV = v · (0.5, −0.5)`.
- The rotor depth joins TRAA's current depth (min), and the history depth stays the scene depth (`traaDepth.value`). So a rotor pixel is never judged disoccluded against the scene behind it, and an uncovered pixel is left to the variance clip.
- `traaResolve.ts` checked:
  - the 5-tap Catmull-Rom weights (w0..w3 and the merged centre) are Jimenez's;
  - the normalised sum is clamped at 0;
  - the cross-tap closest-depth search and variance clip are right;
  - validity, the motion factor, subpixel correction and flicker reduction are r186's.
- Both patches assert the TRAANode internals they touch, and throw if they moved (W1V-N3 done).
- The step uniform is set in `view.frame` from `wrapAngle(lp − lpWas)`. A phase set by a debug flag is excluded. `prevViewProj` advances once per `render()`.
- The images confirm it: 03's cut fan is no longer ghosted. At 03's framing it still reads as a smooth band, seen edge-on, as the handoff says.

**W1V-I3: the EqualDepth test is sound.**
- `equalDepth.test.ts` compares the shutter-0 rotor-alpha coverage through the pre-pass and EqualDepth against an ordinary depth test (`plainFanDepth`): 0 differing pixels in 3 presets, more than 1000 fan pixels each.
- The negative control (`fanDepthNudge` 1e-4 rad) must differ by more than 100 px. It can see a hole, which the fan-blur test could not.
- GPU_FACTS M43's evidence now points at it.

**D4-4: correct.**
- `spoolDisplayFactor` eases with smoothstep in a linear progress, inverted in closed form (p = ½ − sin(asin(1 − 2f)/3), which I checked at 0, ½ and 1). So it composes exactly over any frame steps (the test compares dt 1/60 against 1/30). It is monotone, reaches 0 at 1 s, and spins back up.
- `setMode(m, true)` sets the factor at once for presets only. The live mode change eases.
- The cutaway keeps the running engine.

**Visual review, 00-07 against before/, by eye: better grounded, but still CG.**
- Improvements:
  - the engine now stands on a cradle with contact (00, 01, 02, 03), not floating;
  - the plug and core nozzle are dull and oxidised (02);
  - the cut fan in 03 is no longer ghosted;
  - 05's blades are slightly more defined.
- What still reads as CG against "premium product render of a real engine":
  1. **The nacelle** (00, 01, 02) is a uniform matte white solid: no clearcoat response or environment reflection, no tonal variation, doors and latches as drawn outlines. The lip is fine.
  2. **The moving fan** (00, 05, 06) breaks up:
     - in 05, torn rectangular slivers on the right half where the booster shows through;
     - in 00, a stipple across the lower half and speckles at the top right;
     - **06 is worse than before**: the take-off disc carries a regular dot-screen over the whole disc, more visible than in before/06. That is the cost of 6 time copies instead of 8; LOOKDEV says "a 6-copy frame is still a noisy estimate". A real fan at take-off reads as a smooth translucent disc.
  3. **The spinner spiral** (W1V-N5): in 01, the default view, the spinner is plain black with no stripe, while before/01 showed it. LOOKDEV says it now "reads at every phase".
  4. **The stand** is a placeholder: thin flat-black square bars, an H-frame of rails with no pads, bolts, wheels or bracing, and saddles under the cowl skins. A transport stand takes the engine at its mounts; as drawn it reads as a toy for a 2.3 t engine.
  5. **The cutaway** (03, 07): flat salmon caps (07 shows a fine hatch, 03 does not at that distance); blades and vanes as simple shells with no root or platform detail; the combustor still a lumpy tube. 07's grain still reads as sandpaper speckle on every metal surface. No heat tint reads in the hot section.
  6. **The exploded view** (04): the parts float with no fixture. With the spools stopped, the fan reads as dark shards. The parts are untextured grey primitives.
  7. No rotor AO or self-shadow (handoff NOT DONE).
- Verdict: a clear step toward a grounded product shot, but not yet the bar. The fan in motion is the largest remaining gap, and 06 went backwards.

### Blocking
None.

### Important
- **W2L-I1 OPEN: the rotor-motion test passes without the rotor motion vectors.**
  - `rotorMotion.test.ts:31` (MARGIN 6) and its control. The builder's own note (the test header and LOOKDEV): with our resolve, zero rotor velocity (`noRotorMotion`) gives 8 tiles in the close-up, which is exactly the bound (floor 2 + 6). The resolve rejects the history instead of ghosting, and a TRAA output without history is close to the TRAA-off still the test compares against.
  - The only control is `legacyTraa`, a different pipeline. So the test pins "no ghosting", not "TRAA accumulates the rotor in motion".
  - The failure scenario: a sign error in `back`, a wrong pitch channel, or a dropped `velocityNode.load` override would pass. The cut fan would silently fall back to an un-anti-aliased, history-less rotor, which is the W1V-I1 complaint in another form.
  - The flags for a real control exist and are unused: `noRotorMotion`, `rotorMotionScale` (`engineView.ts`).
  - Fix: a control on the shipped resolve that must fail. Either:
    - compare the moving TRAA frame with a converged TRAA frame at rest at the same phase (accumulated anti-aliasing) instead of the TRAA-off still, so that a discarded history counts as a difference; or
    - assert, through the `velocity` debug view, that rotor pixels carry the analytic rigid-turn velocity at a few known pixels, with `rotorMotionScale: -1` as the negative control.
- **W2L-I2 OPEN: INVALID runs enter the A/B summary and the P4 verdict.**
  - `ab.ts:271` calls `abSummary` on every run; `abSummary` (`timing.ts`) has no validity input.
  - `capture.ts:333-339` computes P4 from `results[...].gpuTotal.p50`, which `combineReps(e.runs)` takes over every run. `p4Verdict` takes no validity either.
  - The failure scenario: the official A/B of record already includes an INVALID run in its pairs and side medians (above). A P4 run with an occluded or stalled default config would print "PASS" (or "FAIL") as official.
  - Fix:
    - `abSummary` drops INVALID runs and their pairs, and records which pairs it used;
    - `combineReps` is applied to valid runs only, or the result is INVALID;
    - `p4Verdict` returns INVALID when the default config has an INVALID run;
    - unit tests for each.
- **W2L-I3 OPEN: the back-to-back rAF watcher drops the open interval at the end.**
  - `src/lookdev/main.ts:239-248, 267`: `tick` records a delta only when rAF fires, and `watching = false` ends it. If the window is occluded from some point until after the run ends, the last long interval is never pushed, and `pacedValidity` sees only short deltas.
  - The failure scenario: the loop keeps running, the run is VALID, and an occluded run counts. That is the case the watcher exists for. The official run was caught only because the loop itself also stalled.
  - Fix: on stop, push `performance.now() − lastV`. Also require a minimum number of watcher ticks (for example half the run's display intervals), else INVALID.
- **W2L-I4 OPEN: the A/B tool does not check the power source, and "official" means only the protocol's numbers.**
  - `ab.ts:206` records only the page's `conditions()` (the Battery API). `ab.ts:291` sets `official` from the warm-up, run length and reps. `capture.ts:333` does the same for P4.
  - The failure scenario: the official A/B's own record ends "not charging, 0.98", and two indicative JSONs called AC end at 0.76 and 0.45 not charging. A run that changed power source mid-way is labelled D0-1, and the governor behaves differently on battery.
  - Fix: record the OS power source (`spikes/lib/system.ts`, as `capture.ts`'s `conditions()` does) before and after each run. Mark a run on battery INVALID for an official result, and print "indicative" unless the conditions were AC throughout.
  - The orchestrator's D4-24 evidence entry should be corrected the same way: the INVALID run is rep 0, and the summary includes it.

### Nits
- **W2L-N1 OPEN.** LOOKDEV round 4, part 2, "P4 cuts" lists "GTAO 6 samples with the noise rotated every frame ... instead of 8 fixed". The same section ("Still CG-like": "GTAO was not cut"), the handoff ("tried and reverted") and `post.ts` (8 fixed samples, with the reason) say it was reverted. Strike it from the list of cuts.
- **W2L-N2 OPEN.** The cutaway pose of `rotorMotion.test.ts` sits at its bound's edge (LOOKDEV: 32 → 37, bound 38). The half-pitch wrap assumes the rotor image is periodic in one pitch. The cut (rule 'inside') breaks that at the cut faces, where the next blade along may be hidden. Expected and handled by the clip, but at 1 tile of margin a resolve change will flip it. Name the cut faces as the source in the test header, and consider excluding a band at the cut faces or widening the MARGIN with a reason.
- **W2L-N3 OPEN.** M46's 72-77 % busy in back-to-back runs: measure the CPU time per frame of the back-to-back loop (`view.frame` plus encode) beside the GPU busy fraction. If the loop is CPU-bound (about 11-13 ms a frame at 74-90 fps), back to back is not "the GPU at its loaded clock" but a higher-utilisation governor state, and GPU_FACTS and `timing.ts`'s `Pacing` comment ("the GPU never idles") should say so.
- **W2L-N4 OPEN.** The spinner stripe of W1V-N5 is not visible in 01, the default view (above). Either the lift is too faint at that phase, or 01's phase hides it. Check 01 at a few phases before calling it done.
- **W2L-N5 OPEN.** 06 regressed visibly with 6 fan time copies: a dot-screen over the take-off disc. If P4 needs the copy, consider a per-preset copy count (8 at take-off shutter angles, where the blur is widest) or blue-noise copy offsets that TRAA averages better.
- **W2L-N6 OPEN.** `tests/browser/culling.test.ts` (from W1, unchanged here) takes about 50-58 s alone and exceeded its 120 s timeout in the full suite under shared GPU load. It now holds the suite's slowest margin. Give it its own timeout with a reason, or fewer settle frames per view, so that a loaded machine does not turn it into a false FAIL at a merge.

**Verdict w2/lookdev-4 @ecf0765: MERGE.**
- P4 is still unmet both ways, honestly reported: indicative 7.49 ms back to back, 10.71 ms at vsync, not official.
- The code is correct where checked, the gates are green, and the browser suite runs with 0 WebGPU errors.
- W2L-I2..I4 are in tooling that decides P4. They must be fixed before the next official P4 capture, and before back to back becomes the measure of record.
- W2L-I1 goes to the next look-dev round with rotor AO and self-shadow.

**D4-24 for the orchestrator: CONFIRMED** (above), on the three conditions under "Should P4's measure of record become back to back?".

**Addendum (after the orchestrator's merge of w2/lookdev-4 into main at eefe857, with the merge fix 5311dbe).**
- **W2L-B1 RESOLVED in 5311dbe** (my trial merge had found it).
  - The conflict: on main's D3-6 `validity.ts`, `pacedValidity` built a `RunFrames` without `longestOcclusionMs`. Typecheck failed (TS2345 at `tools/lookdev/timing.ts:236`), `timing.test.ts:203` failed, and at runtime a stalled back-to-back run came out VALID.
  - 5311dbe adds the field. It is the same one-line resolution I had applied: my trial tree is byte-identical to `git merge-tree 5311dbe w2/reference` except for this LOG and two probe files. eefe857 resolves the `thresholds.test.ts` conflict to 4 + 12 + 13 + 4 (C12 and P4).
  - With it, typecheck and the unit suite pass (trial merge below).
- **Sanity check of 5311dbe: correct, but D3-6 now applies to look-dev captures only in part (W2L-I5).**
  - Both pacings' loop intervals now go through D3-6's `runValidity`: INVALID only on the occlusion signature (rAF intervals ≥ 500 ms sustained ≥ 1000 ms) or a hidden page. D2-11's throttle stretch becomes a warning. For vsync captures this was already so on main (`runValidityOf`, from w2/followups).
  - Two parts of D3-6 do not reach look-dev:
    - (a) the back-to-back rAF watcher still uses the stricter D2-11 stretch (`timing.ts:228-233`: INVALID on > 500 ms of deltas over 2.5 display intervals). A back-to-back loop that delays rAF on a busy main thread can therefore be thrown out where D3-6 would warn, while the real occlusion signature (Chrome's ~1 Hz throttle) is caught either way;
    - (b) D3-6's blur rule (`runValidity(run, hidden, pageBlurs)`: INVALID when the page lost focus) is never fed. `timeRun` records blur and focus only as `events` strings (`src/lookdev/main.ts:229-230`), and neither `runValidityOf` nor `pacedValidity` passes a blur count. So a look-dev capture in an unfocused window stays VALID, where a bench run is INVALID.

### Important (added)
- **W2L-I5 OPEN: D3-6 applies to look-dev captures only in part** (above).
  - The failure scenario: an official P4 capture with the Chrome window unfocused for part of a run (the governor and Chrome's scheduling both change with focus) is recorded as VALID.
  - Fix:
    - count blurs in `timeRun` and pass them as `pageBlurs` in `runValidityOf` and `pacedValidity`;
    - make the watcher's INVALID the D3-6 occlusion signature (`watched.longestOcclusionMs >= OCCLUSION_MIN_STRETCH_MS`), with the stretch as a warning, unless the orchestrator wants back-to-back runs to be stricter than D3-6;
    - unit tests for both.

### Nits (added)
- **W2L-N7 OPEN.** The first browser run on a tree with this merge fails to start. `src/render/traaResolve.ts` imports `three/addons/tsl/utils/TAAUtils.js`, which the Vite dependency cache of an older checkout does not hold. Vite optimises it mid-run and reloads ("optimized dependencies changed. reloading"), and `engineView.test.ts`'s iframe never becomes ready (60 s): 1 of 7 files ran in my trial merge. A second run passed 23 of 23. Every worktree and the orchestrator's merge check will hit this once. Add the module to `optimizeDeps.include` in `vitest.browser.config.ts`, as Vitest itself advises.

**The look-dev verdict stands: MERGE** (merged by the orchestrator at eefe857 / 5311dbe). Counts with the addendum: B 1 (resolved in 5311dbe), I 5, N 7.

## Critic pass 8: trial merge (w2/reference @4553ce2, then w2/lookdev-4 @ecf0765; equal to main 5311dbe + w2/reference)

- **Merge.** On a detached HEAD at the critic's HEAD (main 00bc99b plus this pass's two LOG commits), I ran `git merge --no-ff --no-commit w2/reference`, a scratch commit, then `git merge --no-ff --no-commit w2/lookdev-4`.
  - The reference step is clean (PHYSICS.md auto-merges).
  - The look-dev step has one textual conflict, `tests/unit/contracts/thresholds.test.ts`: main's C12 against the branch's P4. I resolved it to 4 + 12 + 13 + 4.
  - It also has one semantic conflict, W2L-B1: `pacedValidity` against main's D3-6 `RunFrames`.
- **Before the resolution:**
  - `npm run typecheck` failed: TS2345, `tools/lookdev/timing.ts:236`.
  - `npm test` failed one test: `timing.test.ts:203`, a stalled back-to-back run counted VALID. 1857 passed, 9 expected fail.
- **With the one-line resolution** (`longestOcclusionMs: h.longestOcclusionMs`, identical to the orchestrator's 5311dbe), the tested tree is byte-identical to `git merge-tree --write-tree 5311dbe w2/reference`, apart from `docs/reviews/LOG.md` and two probe files. So the numbers below are the requested trial merge of w2/reference into main 5311dbe.
- **`npm run mesh`:** no working-tree change, so the committed manifest and outputs are byte-identical.
- **Gates on the combined tree.** These ran with a solver builder's GPU tests on the machine.
  - `npm test`: 1858 passed, 9 expected fail (94 files).
  - `npm run typecheck`: clean. `npm run lint`: clean.
  - `npm run coverage`: lines 99.60 %, statements 98.73 %, branches 88.36 %, functions 99.63 %; every threshold passes.
    - `src/flow/reference`: lines 100 % (branches 88.67 %).
    - `src/flow/mesh`: 98.60 %.
    - `src/geometry`: 99.59 %.
    - `src/cycle`: 99.58 %.
    - `src/thermo`: 100 %.
    - `src/contracts`: 99.67 %.
  - `npm run test:mesh`: 29 passed.
  - `npm run test:browser` (API port 5190):
    - the first run broke on a mid-run Vite dependency reload (W2L-N7): 1 of 7 files;
    - the re-run passed 23 of 23 (7 files), with 0 WebGPU errors.
  - `npm run test:ladder`: 10 files passed, 3 failed, 573 s. These are the same rows and values as at the reference tip: L8, L9a and L9b convergence fail; L7 passes at 96 × 96 (0.0131, ratio 1.048).
- **Restore.**
  - `git merge --abort`, back to branch `critic` at 55f6f5b. The scratch commit is unreferenced.
  - Removed the generated `public/mesh/*.bin`, `coverage/`, `reports/` and `test-results/`.
  - Both builder worktrees are clean at 4553ce2 and ecf0765. Their ignored `coverage/` and `reports/` were refreshed by the gate runs.
  - My Playwright Chrome instances closed with their runs. No dev server was started, and the shared Chrome was not used.

**Orchestrator decisions needed (pass 8):**
- **(y) D4-24:** I confirm the DVFS reading, so back to back may become P4's measure of record. It must apply on three conditions:
  - valid runs only (W2L-I2);
  - the OS power source AC throughout (W2L-I4);
  - the busy fraction reported beside the number.

  Please also correct the D4-24 evidence entry:
  - the INVALID run is 23239a1 back to back rep 0, and the summary includes it. The valid pairs are −0.59 and −1.22 ms (median −0.90);
  - the record's conditions end "not charging, 0.98";
  - the vsync medians are not "the governor fills the frame": rep 0 ran at 56 fps and 10.4 ms, reps 1-2 at 40 fps and 16.4 ms, all at 0.65 busy.
- **(z) W2R-I5:** delete p_u (D4-35) before the reference merge, or as the next round's first item?
- **(aa) W2R-I6:** CFL 0.8 is below the fully discrete limit only for β ≈ M_ref; β/M_ref ≤ ~0.6 or ≥ ~4.6 is unstable at 0.8 in 1D. Which remedy goes to the next round? (a) M_ref from the face's β, (b) the scaled diffusion's eigenvalue in the local step, or (c) a stated validity range plus a shear-layer and start-from-rest case.
- **(bb) W2R-I7:** a D4-19-style steadiness rule for the value rows taken before convergence (L8, L9a, L9b). Separately, L8 converges at CFL 0.8 by about 32500 iterations: keep the 20000 cap (row FAIL), or scale it for the CFL change by a decision?
- **(cc) W2L-I5:** should back-to-back runs be stricter than D3-6 (the watcher's 2.5-interval stretch), or follow D3-6's occlusion signature? Either way, D3-6's blur rule should reach look-dev captures.
- **Merged into main @2032c73** (critic pass 8, w2/reference @4553ce2, MERGE) after the critic's own merge commit 1369a36.
  - Gates on the merged tree: 1857 passed + 9 expected fail. One failure is the known annulus load-timeout flake: 9.4 s against 5 s, it passes alone, and round 6 fixes the timeout. Mesh 29 passed.
  - `test:ladder` under a heavy load (two agents' suites running) gave 8 passed / 5 failed. L8 and L9a fail as expected, on their convergence rows. L4b, L7 and L9b hit the 30-minute vitest timeout from CPU contention, not an assertion.
  - The critic's quieter trial merge of the same tree gave the tip's 10 passed / 3 failed. The orchestrator owes a quiet-window rerun of the ladder on main.
- **P4 official at main a337d4e (D4-42 measure of record), 2026-10-27 20:12-20:41.** AC at the start and at the end, plan Balanced, no agents, the display awake; D0-1: 10 s warm-up + 3 × 60 s, seed 1. All 8 configs were VALID, with 0 errors.
  - **Back to back:**
    - **default 8.50 ms**: opaque 3.96, rotors 1.15, GTAO 0.85, composite 0.85, TRAA 1.06, output 0.29; GPU busy about 71%;
    - performance profile 6.76 ms;
    - cutaway 10.00 ms;
    - hero 13.07 ms.
  - **Vsync:** default 11.22, performance 10.35, cutaway 11.43, hero 13.59 ms.
  - **P4 FAIL by 0.50 ms** (default ≤ 8.0). Cutaway meets its 10 ms target; hero does not.
  - The next look-dev round finds the 0.5 ms. Candidates are the critic's pass-8 notes, the rotor pass (1.15 ms) and TRAA (1.06 ms).
- **The ladder rerun owed on main a337d4e (quiet, same window, 20:41-20:47): 10 files passed / 3 failed.** L8, L9a and L9b fail on their convergence rows, under D4-45. This matches the critic's trial merge, which settles the load-timeout question.
- **D4-47 (w2/solver round 2 @81e9508, question a): the L4a/L5 GPU convergence rows stay KNOWN-FAIL until the limiter decision.** The residuals stop at 3.99e-4 and 7.5e-3, above the floors D4-38 stated (4e-5 and 1.7e-4), while the accuracy rows pass. The oracle shows the same sharp-limiter floor (round 6's start-from-rest case: 4.2e-4 of the peak, converged by the smooth form), so the plateau is the limiter, not f32. It is resolved with D4-36's trials. The accuracy rows remain the checks of record.
- **D4-48 (question b): the flux-scale normalisation is adopted for §12.2's rows E and B,** as D4-39 anticipated. Rows that divide by a near-zero residual are ill-posed in f32. E-L5 becomes 2.7e-8 that way.
  - The reference branch owns §12, so reference round 7 rewrites the E/B rows. The solver's tests follow it.
  - The solver's santa-loop reviewers check that the change is a normalisation only.
- **D4-49 (question c): SOLVER.md §14 "f32 implementation forms" is accepted** (§13 already existed), with its six forms. Each needs its identity test against the oracle, and the reviewers check every one.
- **D4-50 (question d): the device requests the limits the engine needs,** as standard WebGPU practice: `requiredLimits.maxStorageBuffersPerShaderStage` ≥ 9 for the engine with sources, checked against the adapter.
  - Record the Arc 140T's adapter value in GPU_FACTS.
  - If an adapter offers only 8, pack two read-only buffers into one: a tested fallback, never a silent failure.
  - w2/solver implements the request in the device module. w2/app-ui's worker inherits it.
- **D4-51 (w2/reference round 6 @c937913, questions 1 and 3): D4-44 (a) is kept,** with M_ref taken from the face's β. CFL 0.8 now holds for β 0.003-0.6 at any M0 ≤ β. The start-from-rest (R) and shear-layer (J) cases stay pinned `it.fails`. Option (b) is not adopted: it changed nothing in R or J.
- **D4-52 (question 2): J's stall is Important, W2R-I8, not a nit.** The engine's flow is full of shear layers: the bypass/core mixing and the jet plume. A tracking-mode stall there would slow the app's settling. The plain scheme converges J, so the preconditioner is the cause. Investigate it after D4-36's trials, first with the standard pressure-difference cutoff in β², β² = min(1, max(M², M_cut², K·|Δp|/(ρc²))) (Weiss-Smith; Darmofal & Siu). Bring the data back.
- **D4-53: the santa-loop review of w2/solver @81e9508, round 1.** Reviewer A (critic branch a486cb1, `docs/reviews/santa-solver-A.md`) gives **APPROVE**: 0 B, 10 I, 9 N. Reviewer B (branch santa-b e3135c4, `docs/reviews/santa-solver-B.md`) gives **CHANGES REQUIRED**: 1 B, 6 I, 10 N.
  - Both find the kernel matches SOLVER.md and the oracle term for term. All gates are green at the tip.
  - Under the plan's rule (both must approve), a fix round runs. Both reviewers then re-verify their own findings, each seeing only its own file.
  - **The fix list:**
    - W2S-B-B1: a trial merge into main fails typecheck at `tests/gpu/oracle.test.ts:162` (main's limiter is named `'sharp'|'smooth'`, the kernel's `'vanAlbadaSharp'`).
    - Surviving mutants of real terms: B-I1/I2, A-I2 (oracle rows at u∞ ≠ 0), A-I5 (TwoSum low part), and the Neumaier form's own test. The §14 identity tests must exercise the kernel's WGSL, not a TS copy.
    - The resample's values: A-I1.
    - The resample left out of D4-2's budget and of L13's ceiling: A-I4, B-I3.
    - The D4-38 settle check reading only the window's endpoints: A-I6.
    - L8/L9 rows under D4-45: B-I5.
    - D4-50's device limits: B-I6.
    - D4-48's E/B normalisation once the reference lands it.
    - The FlowSolver status channel: A-I10.
    - Numbers checked in Chrome: A-I3.
    - The nits, where cheap.
- **D4-54: solver throughput is a tracked follow-up, not a merge blocker,** as both reviewers concluded.
  - Indicative Chrome cost is 2.09-2.4 ms/it, about 2 iterations per frame at D4-2's 5 ms, roughly 120 it/s against P1's 150. The cause is memory and dispatch: about 161 MB per iteration over 9 dispatches.
  - After the fix round's merge, a performance round targets ≤ 1.6 ms/it, from the reviewers' list: merge the ghost pass into the prim pass, reuse the resample's prim pass, and slim the halo record.
  - It is then measured officially under D0-1 inside the app's 1080p scene. P1 is judged on that number. A miss there needs a logged decision under P1's own rule: about 80k cells, or a half-rate solver.
- **D4-55 (w2/reference round 7 @9a0f31a, question 1): the sharp van Albada limiter stays the contract,** and W2R-6 stays pinned. That is D4-36's pre-stated rule at work: (a) and (b) both fail L8's velocity row (28.3% and 32.7%, against the sharp limiter's 0.37%).
- **D4-56 (question 2): the L9a/L9b caps stay at 20000.** They run plain tracking at CFL 1.5, so there was no CFL change, and D4-45's 1.5/0.8 scaling applies only where the CFL changed (L8). D4-45's wording is corrected.
- **D4-57 (question 3): L9a's steadiness rule is kept as written,** so L9a's value row stays FAIL on steadiness. The spread is 1.06e-5 against the 1e-5 rule, although every sample is about 9× inside its tolerance. The rule is not loosened after seeing the data. The row is visible, it does not block, and it is revisited with the convergence work.
- **D4-58 (question 4): D4-47 is corrected.** The L4a/L5 GPU plateau is f32, not the limiter: in f64 the sharp oracle converges both cases to 1e-12, while with f32 storage it plateaus at 1.6e-4 and 1.1e-3.
  - The D4-38 floors are restated from those f32-storage runs: 1.6e-4 and 1.1e-3.
  - The GPU's 3.99e-4 and 7.5e-3 are still above them. That gap is f32 arithmetic beyond storage, so the GPU convergence rows stay KNOWN-FAIL with the measured gap. The accuracy rows remain the checks of record.
- **D4-59 (question 5): J's stall, with a global cutoff tried next.**
  - Round 7's results: the pressure-difference cutoff (K up to 100) and local velocity cutoffs do not converge J; only a global M_cut ≥ 0.02 does. A global cutoff tied to the domain's peak velocity is standard practice, and for this engine (inlet Mach about 0.5) 0.02 is about 4% of it.
  - **The pre-stated rule:** adopt M_cut = 0.02 only if every row passing now still passes (L1-L7, including L7's iteration ratio of at most 3×, L8 velocity, L9 values, §12.2) and J and R converge. Otherwise keep 0.003, with J pinned.
  - The kernel's adapter default (D4-40) follows the outcome.
- **Merged into main @bc4bfaf: w2/solver @22ba7ac, the live GPU flow solver.** Santa-loop: reviewers A and B both APPROVE after re-verification. Each conditioned the merge on the same one-line fix, carried in the merge commit: `tests/gpu/forms.test.ts` passes `rc` to main's `limitedSlopes` (A-B1 / B-B2).
  - Gates on the merged tree, run quiet: typecheck and lint clean; npm test/coverage 1901 passed + 9 expected fail, lines 99.59%; test:mesh 29; test:gpu 57 + 1 expected fail; test:gpu-ladder 12 passed.
  - The reviews are on main as `docs/reviews/santa-solver-A.md` and `-B.md` (a49da42, f9113e9).
  - **Carried forward:**
    - A-I3, the §12.2 oracle row in Chrome (the oracle shell imports node:fs);
    - B-N11/N12;
    - the skipped nits;
    - D4-54's performance round: 2.09-2.4 ms/it indicative, where P1 needs ≥ 150 it/s inside the 5 ms budget, then an official measurement.

## Critic pass 9: w2/reference @0c87da8 (PARTIAL: STOP-CLEAN)

**PARTIAL.** I stopped on the orchestrator's STOP-CLEAN. Checked: the tip gates, the tip ladder, pre-registration, the β/M_ref analysis (independent probe), the D4-44 code, R and J, D4-45/56/57/58/59, D4-48, the kernel-impact list, and the trial merge's typecheck, lint, mesh, unit suite, test:gpu and test:gpu-ladder. **Not done:** the merged `test:ladder`; merged coverage numbers (vitest wrote no report because a test failed); mutant M3 (killed mid-run); the ECC checklists in full (the typescript-reviewer and pr-test-analyzer points below come from my own reading). The trial merge was aborted. My worktree is at c661d5c, and the builder's tracked files are unchanged at 0c87da8.

I reviewed `4553ce2..0c87da8` (rounds 6-8) against main c661d5c on 2026-10-28. New probes:
- `w2r-acoustic-beta.probe.ts.txt`: the pass-8 von Neumann probe with the face β passed to `slau2Flux`;
- `w2r-jet-cfl.probe.ts.txt`: J at a stated CFL, with the cap scaled as 0.8/CFL;
- `w2r-rest-uniform.probe.ts.txt`: R with and without blockage, before and after D4-44.

**Gates at the tip, run in the builder worktree** (quiet apart from the other builder's GPU work):
- typecheck and lint: clean.
- `npm test`: 84 files, 1735 passed + 11 expected fail (323 s).
- `npm run coverage`: lines 99.58 %, statements 98.70 %, functions 99.62 %, branches 88.07 %. `src/flow/reference` is at lines 100 %, branches 88.75 %.
- `test:mesh`: 29 passed.
- `test:ladder`: 11 files passed, 3 failed (840 s). L8, L9a and L9b fail on their convergence rows, and L9a also on its D4-57 steadiness row (1.062e-5 against 1e-5). L7 passed: asymmetry 0.0131 falling (0.135 / 0.044 / 0.013), Cd 0.00159, ratio 1.048.
- Values: L8 0.449 % with a spread of 1.96e-5; L9b 0.80 % with a spread of 2.5e-5; every 12.2 storage row passes; the floor rows give 1.590e-4 / 1.096e-3, and f64 6.4e-13 / 5.9e-12. The handoff's L7 child timeout did not recur here (W2R-N15).
- The handoff's "coverage NOT VERIFIED / test:mesh NOT RUN" are now verified, and they match the orchestrator's run.

**Trial merge (w2/reference into c661d5c, --no-ff --no-commit, then aborted).**
- The merge is clean, and so are typecheck and lint. `npm run mesh` ran.
- `npm run coverage`: **1 failed** | 1900 passed | 11 expected fail. `test:mesh`: 29 passed.
- **`test:gpu`: 5 failed | 52 passed | 1 expected fail** (main: 57 + 1). The 5 failures:
  - `forms.test.ts` "14.3-14.5 SLAU2 values (machCut 0.003)": 3.0e-3;
  - `oracle.test.ts` C-pre: e_q 1.5e-2 after 1 iteration, against 1e-5;
  - S: 3.0e-2 after 10, against 1e-4;
  - the two preconditioned `oracle-moving.test.ts` rows: 3.0e-5 and 6.2e-5 after 1, against 1e-5.
- The cause is D4-44 alone. With the oracle's one `mRef` line set back to the face Mach, the three files give 20 passed + 1 expected fail. The unit failure is `tests/unit/flow/f32forms.test.ts` (14.3-14.5), whose TS gauge form keeps the face-Mach M_ref.
- `test:gpu-ladder`: 12 passed (346 s). Its references are analytic, and the GPU L7/L8 values match the oracle's to 4 digits.
- **So the merged tree's GPU tests do NOT pass against the new oracle.**

**Pre-registration: honest. The outcomes follow the rules.**
- D4-36: the rule went into SOLVER.md 6 at eacef07 (10-27 20:07:24). The trial trees were made at 20:07:36, and every trial ladder ran 23:04-23:49. The rule text is unchanged afterwards. Neither variant is adopted (L8 28.3 % / 32.7 %; W2R-6 0 and 2 of 3).
- D4-44: the rule went into SOLVER.md 10 at 37b4d5c (19:33:11), before the (a) code (d9ca099) and the (a) runs (19:37-19:38). The pre-D4-44 baselines it quotes ran just before it, and the thresholds are the generic ones.
- D4-59: the rule went in at 1c5319a (00:30:21). The driver (00:31:25) and every r8/trialM output (from 00:31:44) came after it. The text is D4-59's plus two stricter readings: L7 at max(M∞, 0.02), and L8 with its steadiness rule.
- R fails rule 2 (4.35e-4, in `r8/R_02.log`), so 0.003 stays. That is correct.

**The β/M_ref analysis: correct.**
- My probe reproduces all 25 values of SOLVER.md 10's D4-44 table: the matched family, minimum 0.972 at rest at β = M_cut. So CFL 0.8 holds over β 0.003-0.6, with M0 ≤ β.
- It also reproduces the pre-D4-44 row, except 0.449 against SOLVER's 0.447 at β/M_ref 0.1 (W2R-N17).

**M_ref from the face's β is implemented as §7 says, ghosts included.**
- `solver.ts:516-518` sets β = √β² per cell, and a ghost takes `ghostSrc`'s β. `solver.ts:611` forms ½(β_L + β_R), which `slau2.ts:104` uses.
- β is frozen at stage 1 (`computeLocalDt` at k = 0), and `residual()`, `faceFlux()` and `residualFluxScale()` re-evaluate it.
- Physical time and machCut ≥ 1 give M_ref = 1.
- Mutants (partial): ghost β left at 1 is killed by `solver.test.ts` "hold their steady state without preconditioning". **Ghost β = cell 0's β survives the flow unit suite** (W2R-I10).

### Blocking
- **W2R-B2: merged alone, the reference turns main's `test:gpu` (5 tests) and `npm test` (`f32forms.test.ts` 14.3-14.5) red.**
  - Main's kernel and its f32 forms implement the pre-D4-44 M_ref: `src/flow/gpu/wgsl/flux.ts:120`, `tests/unit/flow/f32forms.test.ts:99`.
  - The reference itself is right: D4-44 says "the kernel follows".
  - Fix (orchestrator's choice, question dd):
    - (1) preferred: the solver's D4-44 round (W2R-I13) is built on w2/reference, and the two merge together. That keeps D4-35's rule (one scheme, the kernel's).
    - (2) merge now with the 6 rows re-pinned KNOWN-FAIL citing D4-44. Main then carries an oracle that differs from the kernel.

### Important
- **W2R-I9: the R/J pins cannot see a divergence.**
  - `precondition.test.ts:447-500` asserts only `conv.converged`. `converge` returns `converged: false` on NaN (`common.ts:59`), and `it.fails` also passes on a throw or a timeout.
  - So a regression into the very instability D4-44 targets would still be "expected fail".
  - Fix: a passing companion per case that asserts the known signature (finite; R ≤ 1e-3 and J ≤ 1 of the peak at 20000), with `it.fails` only on convergence.
- **W2R-I10: R cannot test D4-44, because it is W2R-6's blockage duct under the sharp limiter.**
  - My probe of R with b ≡ 1 converges: 1174 iterations at the tip, 972 before D4-44. R as specified gives 4.19e-4 at the tip and 7.5e-5 before.
  - Fix:
    - add b ≡ 1 R as a plain test, which guards the start-from-rest regime;
    - keep R pinned as the limiter case;
    - add a multi-block preconditioned test with a β jump across an interface or boundary, to kill the ghost-β mutant above.
- **W2R-I11: D4-48 is a normalisation only, but at the kept 1e-3 it makes rows B and E unable to fail.**
  - r_flux/r_ref is 3.9e4 on E-L5 (1.05e-3 against 2.67e-8 in my merged test:gpu) and 2.7e3 on E-L9a. On B (the GCL defect) it is larger still.
  - So E-L5 passes a GPU residual 39× the oracle's.
  - Question (ee): give the new metric its own tolerance from 12.2's f32 basis (about 1e-6 per iteration; measured 2.7e-8 / 2.5e-12). That would be a tightening, so it is the orchestrator's decision.
- **W2R-I12: J's stall does not depend on the CFL, so it is semi-discrete. D4-44's step analysis and option (b) cannot reach it.**
  - My sweep at M_cut 0.003, with the cap at 20000 × 0.8/CFL, gives residual/peak in the last quarter of:
    - CFL 0.8: 0.016-0.32;
    - 0.4: 0.076-0.40;
    - 0.2: 0.095-0.32;
    - 0.1 (160000 its): 0.085-0.33.
  - A frozen-face estimate (dead-air cell β = M_cut, jet cell β 0.05, face ½(β_L + β_R)) puts the dead-air cell at β/M_ref 0.113, with a 1D limit of 0.468. It gives 0.672 / 0.808 / 0.980 at M_cut 0.01 / 0.02 / 0.05, the same order as J's outcomes. But CFL 0.1-0.2 is well inside 0.468 and J still stalls. So the cause is the β jump in the semi-discrete preconditioned operator, not the step.
  - Option (b) also used the cell's β, so it never saw the face mismatch.
  - Next round (W2R-I8): a power iteration about J's mean state, as in N13, or a 1D two-zone β-jump eigen-analysis.
- **Kernel impact, for the next solver round:**
  - **W2R-I13: M_ref from ½(β_L + β_R) in WGSL** (`flux.ts:120`; the calls at `kernels.ts:337, 743`).
    - Today β² is computed in the stage kernel after the fluxes (`kernels.ts:467-476`, stored in U_B.w).
    - D4-44 needs β at stage 1 before the fluxes, for the tile, its halo and ghosts. A ghost's β is its source cell's, and that cell's Δp term needs neighbours outside the tile.
    - So: a β pass plus a ghost copy before the stage kernel. That weighs on D4-50's buffer count and D4-54's 1.6 ms/it.
    - Tests: `forms.test.ts:170` and `f32forms.test.ts:94-100, 212` pass betaFace. C-pre, S and the two moving rows must then pass against the new oracle.
  - **W2R-I14: D4-58.** `tests/gpu-ladder/ladder.test.ts:46` `PLATEAU {4e-5, 1.7e-4}` should import `GPU_CONVERGENCE_FLOOR` (1.6e-4 / 1.1e-3). Restate the KNOWN-FAIL comments (`:389-390, 454`) with the gap.
  - **W2R-I15: D4-48.** `tests/gpu/oracle.test.ts:108-133`'s private, single-block `fluxScaleError` should become `ref.residualFluxScale()`. Make E's residual rows the 12.2 form, retire the `it.fails` at `:358`, and give B (`ladder.test.ts:177`) its residual check.
  - **W2R-I16: D4-45/D4-56.**
    - `tests/gpu-ladder/helpers.ts:140` uses max|v − v_end|. That is up to 2× looser than the oracle's max − min (`tests/ladder/common.ts`).
    - The GPU window sits before the stop; the oracle's is the 2000 iterations after it.
    - `l7-l9.test.ts:24-29` and the L9 labels at `:282, :359` say 37500 for L9, which runs to 20000.
  - p_u: nothing on the GPU side references it. The adapter default stays 0.003 (D4-59).

### Nits
- **W2R-N15.** `l7.ts:27`: 8 µs per cell-iteration (1.7×) failed L7 under the round-8 load and passed in my quiet run. Use about 3×, or a child heartbeat.
- **W2R-N16.** D4-44 (c)'s "≤ 1e-5 for 50 iterations" let J at 0.02 "converge" at 9441, then rebound to 9.9e-5. Future pre-stated rules should use D4-45's 2000-iteration window.
- **W2R-N17.** SOLVER.md 10, pre-D4-44 row at 0.1: 0.447 against the probe's 0.449. Name the source per value.
- **W2R-N18.** SOLVER.md 7's code order omits `slau2.ts:104`'s `machCut >= 1 ? 1 :` guard. It is bitwise neutral, but the kernel copies the code order.
- **W2R-N19.** `reports/scratch/trialM/node_modules` is a junction to the worktree's `node_modules`. Remove it with `rmdir` (not a recursive delete) before anyone cleans `reports/scratch`.

**Verdict w2/reference @0c87da8: FIX FIRST, for W2R-B2 only (merge order).**
- The reference's own content is otherwise merge-ready: the rules are pre-registered and followed, and the analysis and D4-44 match SOLVER.md.
- It merges together with the solver's D4-44 round (W2R-I13..I16), or after the orchestrator's decision (dd).
- I9-I12 can go to the next reference round.
- The pass-8 items are done: I5 (p_u deleted; no references left), I6 (D4-44), I7 (D4-45), N4 and N7-N14 (N14: 60 s / 600 s timeouts with reasons).
- **Owed on resumption:** the merged `test:ladder`, mutant M3, and merged coverage numbers once B2 is resolved.
- **Orchestrator questions:**
  - (dd) the D4-44 merge order;
  - (ee) a tolerance for D4-48's flux-scale form;
  - (ff) confirm 0.003 under D4-59. I agree; also move R to the limiter work and use b ≡ 1 R for M_cut rules;
  - (gg) J's next step, the semi-discrete β-jump analysis (W2R-I12).
- **D4-60 (w2/solver-int @f07f57e, question dd): merge order.** w2/solver-int is the merge unit: main + w2/solver-perf + w2/reference rounds 6-8 + this round's D4-44 mirror.
  - Critic pass 10 reviews it whole, including the so-far unreviewed solver-perf kernel. On MERGE it goes into main with foreground gates.
  - **The NaN cause is confirmed as W2R-I6:** β/M_ref reaches 8.9 in the inflow-axis corner cell, against a 1D limit of about 0.47 at CFL 0.8. The f64 oracle with the old M_ref also blows up. The D4-44 mirror (a β pass plus the face-mean β) fixes it.
- **D4-61 (question hh): the GPU L9a value row is pinned KNOWN-FAIL** (`it.fails`, citing D4-57's steadiness rule: 1.31e-5 against 1e-5), the same as the oracle's. It stays visible, and flips when the convergence work fixes it.
- **D4-62 (question ee): the flux-scale rows (§12.2 E/B) are tightened, so they can fail.** r_flux/r_ref is 4e4 on E-L5 and 1e10 on B, so 1e-3 can't fail.
  - Set each tolerance from the f32 error model: ten times the measured storage/arithmetic error on the flux scale. The derivation goes into SOLVER.md §12.2 before the re-run, as tightening only.
  - The next reference round owns §12, and the solver's tests follow it.
- **D4-63 (question ii), HIGH before W3: slow growth from rest on the engine mesh.** A 0.1% pressure wave on the real mesh grows 13.6× by 2000 iterations, and the oracle shows the same through 300. That is the scheme, not the kernel. In the app the field must not grow from rest.
  - The next reference round finds the growing mode on the real mesh: its location (axis, block interfaces, lips), the sharp limiter (the W2R-6 family), and the preconditioning.
  - Fix it under a pre-stated rule.

## Critic pass 10: w2/solver-int @f07f57e

I reviewed w2/solver-int @f07f57e on 2026-10-28 as one merge unit against main 8790669. The merge base is c661d5c; since then main has changed only LOG.md. The unit holds:
- w2/solver-perf @5e23c56, never reviewed before;
- w2/reference rounds 6-8 @0c87da8 (pass 9). They are merged unchanged: `git diff 0c87da8 f07f57e -- src/flow/reference tests/ladder` is empty;
- the int round f875e7a..f07f57e: the D4-44 mirror, the NaN test, and I9, I11, I14-I16.

The builder worktree's tracked files are unchanged. I ran the probes in my own worktree, detached at f07f57e, and it is back on `critic`. The new probes, each run from `git archive` exports of the refs:
- `w2i-bitwise.probe.ts.txt` with `w2i-compare.py.txt`: the app's GpuFlowSolver from one ref's `src/` on the 130k asset, from solver-perf's perfState. It dumps every state word, and the compare script diffs two dumps word by word and counts non-finite words. Two refs' solvers in one process segfaulted dawn.node at the second init, so each ref runs in its own process.
- `w2i-nan-oracle.probe.ts.txt`: a ref's f64 oracle on the 130k asset at GpuFlowSolver's defaults, from the 0.1 % wave. It prints the oracle's own β of the first state and the max |ρ′| trajectory.
- `w2i-mutants.py.txt`: five mutants of kernels.ts, each run against the full `test:gpu`.
- `w2i-precond-bitwise.py.txt`: solver-exact's three bitwise tests with the engine's preconditioning switched on (tile shapes, interface faces, D4-50 packing).

**Gates at f07f57e, one suite at a time in the builder worktree, on a quiet but RAM-short machine (0.7-2.8 GB free).** No gate showed memory-pressure symptoms.
- typecheck: clean (15 s). lint (ESLint + Prettier): clean (53 s).
- `npm run coverage`: 98 files, 1901 passed + 11 expected fail (757 s).
  - Lines 99.59 %, statements 98.70 %, functions 99.64 %, branches 87.68 %.
  - By directory (lines): src/flow/reference 100, thermo 100, cycle 99.58, geometry 99.59, flow/gpu 99.74.
  - This includes `f32forms.test.ts` 14.3-14.5 with the face's β.
- `test:mesh`: 29 passed.
- `test:gpu`: 11 files, **60 passed, 0 expected fail** (42 s). Main's kernel on this oracle failed 5 (pass 9).
  - 12.2 rows: C 4.84e-7 / 1.90e-6 / 3.18e-6; **C-pre 5.13e-7 / 4.51e-7 / 1.72e-6**; C physical 2.34e-7 / 3.23e-7 / 1.58e-5; D 3.66e-8 / 4.56e-8; E-L5 6.19e-6 (flux scale 2.67e-8); E-L9a 5.10e-6 (2.46e-12); **S 4.59e-7 / 2.90e-7 / 1.20e-6**.
  - Moving rows: duct, preconditioned, 3.04e-7 / 3.43e-7 / 3.65e-6; S at u∞ 20 m/s 2.07e-6 / 4.31e-7 / 5.05e-7.
  - Forms 14.3-14.5 at machCut 0.003 with a random face β: ≤ 4.49e-8.
  - Engine stability: 0.998 … 1.510 at 100 iterations.
  - C, C physical, D and E are the santa-A numbers of main's kernel to every printed digit, as expected for the paths D4-44 does not touch.
- `test:gpu-ladder`: 12 tests, **11 passed, 1 FAILED** (311 s). The failure is L9a's value row on D4-57's steadiness: spread 1.31e-5 against 1e-5, value 3.56e-6 against 1e-4 (D4-61, W2I-I1).
  - L1: 2.13e-5 m/s.
  - L7: 0.0131 (0.135 / 0.0437 / 0.0131), Cd 0.00159, ratio 1.048. These equal the D4-44 oracle's values (pass 9), so the GPU's preconditioned sphere follows the new oracle.
  - L8: 0.449 %, spread 1.96e-5. L9b: 0.80 %, spread 3.43e-5.
  - B: 1.95e-5 against the oracle's 1.49e-5; residual over r_flux 1.27e-11, r_flux/r_ref 1.15e10.
  - L4a/L5 stay KNOWN-FAIL at 3.64e-4 / 4.91e-3, and their companions pass.
- `test:browser`: 9 files, 25 passed (212 s, port 5190, strictPort). Nothing is left listening.
- `test:ladder` (CPU, last, run alone): 14 files, **11 passed, 3 failed** (922 s), the same as pass 9 and the handoff.
  - L8, L9a and L9b fail on their convergence rows (all at their caps), and L9a also on D4-57: value 8.86e-6, spread 1.062e-5.
  - L7: 0.0131, Cd 0.00159, ratio 1.048. Its iteration counts 2053 / 3901 / 8675 are the GPU's exactly.
  - L8: 0.449 %, spread 1.96e-5. L9b: 0.80 %, spread 2.49e-5.
  - floor.test.ts: 1.590e-4 / 1.096e-3, f64 6.4e-13 / 5.9e-12.
  - Every 12.2 storage row passes, among them C-pre 1.43e-7 / 1.80e-7 / 2.26e-6 and S 7.3e-8 / 1.6e-7 / 4.7e-7.

**The solver-perf kernel (5e23c56, D4-54): correct, and bitwise main's.**
- *Reading:* the stage kernel loads its tile plus a 2-cell halo. Each entry is `haloPrim(e)`: consToPrim of the stage's U for a cell, or the ghost pass's own `ghostPrim` (now `BOUNDARY_FNS`) on its source cells for a ghost. That covers a slip wall's second source and the per-mode BC uniforms (P is the stage's).
  - The validity masks are the old ones: layer 2 is loaded, never a face, and corners are never read.
  - T′ and c of the tile's own cells go to `wtc`, so `pz` no longer reads prim.
  - Every workgroup array is written before the one `workgroupBarrier()`, in uniform control flow.
  - The resample's map holds cells only (an interface texel takes `ghostSrc`), so dropping its ghost pass is safe.
  - The physical-time `lambda` reads its own cell's prim and the ghosts' b from geo only, so `encodeGlobalDt` without a ghost pass is safe.
  - readPrimitives keeps prim + ghost.
- *Workgroup memory:* the WGSL declarations sum to 16272 B at 16×8 (wqa 3840 + wqb 1920 + wb 960 + wsa 4864 + wsb 2432 + wred 512 + wtc 1024 + wbeta 720), each a multiple of 16. That matches `stageWorkgroupBytes`. A real device validates it: solver-exact's D4-50 test builds the stage pipeline on a default-limits Dawn device (16384 B).
- *Bitwise (my probe, main c661d5c against 5e23c56, 130k, perfState, separate processes): 0 of 1,040,272 state words differ, all finite,* in:
  - preconditioned tracking after 50 and 120 iterations;
  - plain tracking after 200;
  - physical time after 50 steps.
  
  And 5e23c56 against f07f57e: plain and physical are bitwise equal, so D4-44 leaves those paths alone, while preconditioned differs (759,283 words, as it should).
- *Mutants of the fused halo, against `test:gpu`:* both killed.
  - M1, the i-max layer-2 ghost not loaded: killed by 7 tests (C, C-pre, C physical, both moving ducts, the interface and block-split bitwise tests).
  - M2, a slip wall's layer-2 second source taken as the first: killed by 8.
- Indicative cost (builder, not re-measured; I ran no timing): Chrome 2.25 → 1.29 ms/it alone, 2.87 → 2.49 ms/it inside the 1080p scene. The β pass adds about 0.11 ms/it on Dawn.

**The D4-44 mirror (57687e4): matches SOLVER.md 7/10 and the oracle.**
- *β² frozen per iteration:* one β pass per preconditioned tracking iteration, from U^n (`roles[0]`, stage 1's input), before stage 1 (`gpuSolver.ts:538-546`).
  - Stage 1's cell update reads `cellBeta2[c]` and stores it in U_B.w, which stages 2-3 read. The faces read the same buffer at every stage.
  - Physical time and the plain scheme have machCut 1, so `select(..., 1, machCut >= 1)` gives M_ref = 1 bitwise, whatever the buffer holds (it is initialised to 1).
  - `preconditioned` is fixed at create, as the params are.
- *The cell β²:* the face neighbours' p′ includes ghosts after their BC, as the oracle's `cellNbr` (extended indices) does. `min(1, max(M², minMach², dpMax/(ρc²)))` with u∞ + u′ and w = rw/r_c is term for term the oracle's.
- *The face mean:* `0.5 * sadd(β_L, β_R)` is symmetric under any operand fusion (`flux.ts:23`). It is formed only on SLAU2 faces: slip walls carry pressure only, as in the oracle.
- *A ghost's β:* `betaSource` returns ghostSrc[g] for every ghost. For a non-wall ghost, layout packs s1 = s0, and a layer-2 wall ghost's own source is s1. So the oracle's `betaExt[n + g] = betaExt[ghostSrc[g]]` holds. Layer-2 ghosts sit outside the faces' ring anyway, which is the builder's equivalent mutant.
- *D4-50:* the stage binds 8 storage buffers (9 with sources, 10 with the dump), packed 7/8/9. `FLOW_SOLVER_LIMITS` stays 9, and is now needed for sources. The 8-limit packed fallback passes bitwise.
- *Mutants (mine, against `test:gpu`):* all killed.
  - M3, the j-max ghost left out of the β pass's ring: killed by 3 (C-pre, S, S at 20 m/s).
  - M4, every ghost taking cell 0's β (W2R-I10's mutant, in WGSL): **killed by C-pre alone**.
  - M5, Δp from the j-neighbours only: killed by 3.
  - The builder's 7 of 8 add to these.
- *Preconditioned bitwise invariants (my probe):* all 13 solver-exact tests pass with preconditioning on:
  - interface faces bitwise equal or negated, on the three-block row and the 130k asset;
  - tile shapes 16×8 / 8×8 / 32×4 / 5×3 on a 37×21 row with inflow, outflow, axis and far field;
  - D4-50 packed against unpacked, and the 8-limit device.
  
  The suite runs these three tests plain only (W2I-N4).
- *The NaN and its cause: the cause analysis is sound, and the test is a real regression test.*
  - My oracle probe at main c661d5c finds cell 0 (x −8.21 m, r 0.015 m) at β = 2.671e-2, which is β/M_cut **8.90**, with 157 cells above 4 and 94 above 8. Main's f64 oracle goes to **NaN by iteration 10** (1.139 at 5). So it is the scheme, not f32.
  - The tip's oracle stays finite to 300: 0.984 / 0.970 / 1.343 / 1.807 / 2.367 / 2.934 / 3.978 / 6.103 / **13.69** / 4.65 every 30. That is D4-63's transient, and the GPU's 1.343 at 90 equals it.
  - `engine-stability.test.ts` against f875e7a's `src/flow/gpu` (the fused kernel without the mirror) FAILS: "finite after 10 iterations (10: NaN)". At the tip it passes.
  - The quoted 1D limit "about 0.47" is the table's value at β/M_ref 8. At 8.9 it is about 0.42 (W2I-N5). Either way it is below 0.8.

**Reference rounds 6-8 (pass 9's FIX FIRST, W2R-B2): resolved.** The kernel now follows D4-44, so the merged tree's `test:gpu` (60/60) and `npm test` (f32forms 14.3-14.5) pass against the new oracle. That is option (1) of question (dd). Pass 9's own items:
- **I9 is partly done:** the GPU L4a/L5 pins gained finite, within-10×-of-the-floor companions (`ladder.test.ts:422-425, 491-494`), and `it.fails` is gone from them. The CPU R/J pins (`precondition.test.ts:447-500`, pass 9; unchanged) still assert only `converged`. Carried to the reference round.
- **I10 is carried:** no b ≡ 1 R and no multi-block β-jump test in the unit suite. On the GPU, C-pre is the only test that kills M4.
- I11 → D4-62. I12 is carried.
- **I13-I16 are done:** I14 imports `GPU_CONVERGENCE_FLOOR` and states the gaps; I15 uses `residualFluxScale()`, retires the `it.fails` and gives B its residual row; I16's `steadyWindowGpu` is the oracle's max − min over the 2000 iterations after the stop, with L9 labelled at 20000.
- N15-N19 stay with the reference round. On N18, the kernel copies the guard, but SOLVER.md 7's code order still omits it.
- Pass 9's owed items: the merged coverage numbers are above. Its oracle mutant M3 was not re-run; the kernel mutants above cover the mirror.

**D4-61 (GPU L9a pinned): not in the merge unit, and the wording needs care (W2I-I1).** At f07f57e the row is not pinned, and `test:gpu-ladder` is red (as the handoff says).
- The CPU ladder has no `it.fails` at all (`tests/ladder`). Its L9a row is a visible FAIL under D4-57, so "the same as the oracle's" holds for the verdict, not for the handling.
- A pin is honest only if it pins the steadiness alone. An `it.fails` over the whole L9a test would also pass on a value regression, a NaN or a timeout (W2R-I9's pattern).

**`bench:p1`: it implements D0-1, but it is not ready for the quiet run (W2I-I2).** D0-1 is in place, through the shared harness:
- a 10 s warm-up per repetition, 3 × 60 s, rotation with a recorded seed;
- D3-6 validity, the conditions JSON, and an INVALID row with no number.

P1's arithmetic is right: `THRESHOLDS.P1` ≥ 150 it/s on the production row, from D4-2's `solverBudgetMs` with the resample inside the frame, and "a miss counts only after a quiet re-run". What is missing:
- the verdict ignores the finite-state and GPU-error checks;
- the scene is open (D4-54 against PHYSICS P1);
- the README entry does not exist.

### Blocking
None.

### Important
- **W2I-I1: D4-61 is decided but not implemented, and `it.fails` over the L9a test would hide more than the steadiness row.**
  - *Where:* `tests/gpu-ladder/l7-l9.test.ts:207-285` (one `it` reports the value row and the settle row together). `test:gpu-ladder` is 11/12 at f07f57e.
  - *Failure scenario:* wrapping the test in `it.fails` passes on a value regression (above 1e-4), a NaN state or a timeout, because each of those fails the body too. The GPU's only L9a value check would then be gone.
  - *Fix:* either keep the row visible red, as D4-57 and the CPU ladder do, or split it:
    - a passing row: finite, value < 1e-4, spread finite (run the 3 s case once and share it);
    - an `it.fails` row whose body asserts only spread ≤ tol/10, citing D4-57/D4-61.
  - In the merge commit or before it.
- **W2I-I2: `bench:p1` can print "P1: PASS" from a broken run, and its scene question is open.**
  - (a) `spikes/bench/run.ts:691-700` judges P1 on `aggregate.itPerSec` alone. `stateFinite` and `gpuErrors` (`spikes/scene/productionRun.ts:110-137`) go into the JSON but never make an attempt INVALID. So a run with WebGPU validation errors, or a non-finite state, still yields a number and a verdict. The smoke test asserts both (`tests/browser/p1Bench.test.ts:35-36`); the harness does not. *Fix:* the production attempt is INVALID with a reason when `gpuErrors.length > 0 || !stateFinite`.
  - (b) PHYSICS P1 says "inside a 1080p three.js scene (W0 spike a)", while D4-54 says "inside the app's 1080p scene". bench:p1 runs the W0 bench scene. Meanwhile `BenchConfig.scene: 'bench' | 'app'` (`spikes/scene/benchApp.ts:51`) is declared and silently ignored, and `productionRun.ts:2` cites an `appBench.ts` that does not exist. A config asking for 'app' would measure the bench scene without saying so. *Fix:* delete the option, or wire it and make an unknown scene throw. Orchestrator question (jj).
  - (c) `run.ts:2` sends the operator to spikes/README.md for "the commands, durations and the checklist". README has no bench:p1 entry (solver-perf NEXT 3, still owed). *Fix:* add the row (about 7 min for 2 configs, per the solver-perf handoff) before the quiet run.
  - (d) `RESET_ITERATIONS` (`productionRun.ts:18-25`) still says perfState "goes non-finite after about 150 iterations … on main's kernel too". With D4-44 the soak keeps it finite for 1000. The 4 MB re-upload every ~25 frames is not app behaviour, and it is the only thing that would hide a divergence from (a). *Fix:* keep it, with the D4-63 reason, or drop it once (a) gates finiteness.

### Nits
- **W2I-N1: an interface's bitwise symmetry now rests on the compiler.**
  - *Where:* `kernels.ts:218-223`. `haloPrim` calls `cellPrim` at two sites: a cell's own (`:219`) and a ghost's source (`:223`). An interface face is then formed from site-1 bits on one side and site-2 bits on the other.
  - The header (`:27-29`) and `sadd`/`sdiff` (`flux.ts:23-30`, "whatever the compiler fuses") show the design does not trust fusion to be identical. The solver-exact interface test would catch a mismatch on a device that runs it, but not on users' GPUs.
  - *Fix:* one call site. Take g = select(0, e − nCells, e ≥ nCells), load r0 from it, take c = select(e, r0.x, e ≥ nCells), then one `cellPrim(c)`.
- **W2I-N2: a throwing `onFrameTiming` callback marks the solver lost.**
  - `flowSolver.ts:281-286` calls it inside the readback promise, before the solver's own updates. If it throws, `scheduler.observe` is skipped and `readFailed` (`:322-325`) sets `lost`, so status reports a device problem.
  - *Fix:* call it after the updates, in its own try/catch, and report its error without marking the solver lost.
- **W2I-N3: the solver-perf bitwise evidence cannot see a NaN.** `tools/perf/solverPerf.ts:451-458` compares uint words, so two NaN states compare equal, and `compareSides` (`:465-513`) checks no finiteness after its 50 preconditioned iterations. My probe confirms the claim with finiteness in four modes. *Fix:* count non-finite words beside the differing ones.
- **W2I-N4: the bitwise invariants of the β pass are untested in the suite.** `solver-exact.test.ts`'s interface, tile-shape and D4-50 packed tests run plain only, and only C-pre kills M4. They all pass with preconditioning (probe). *Fix:* add the three preconditioned variants. Consider an oracle comparison over 10 iterations in `engine-stability.test.ts`: the oracle runs it in about a second on 130k, and it would reach the real mesh's inflow/axis ghosts.
- **W2I-N5: the quoted 1D limit is the β/M_ref 8 value.** "About 0.47" (handoff, `engine-stability.test.ts:8-9`) is SOLVER.md 10's value at 8. At 8.9 it is about 0.42 (0.469 at 8, 0.234 at 16). The conclusion stands.
- **W2I-N6: `frameAt` keeps untimed frames.** `productionRun.ts:90` stores every frame, while `:64` deletes only the frames whose timing resolves, so untimed frames stay (a few thousand per official run). *Fix:* drop the keys at or below each resolved frame.
- **W2I-N7: the P1 render-timestamp promises have no catch.** `benchApp.ts:361, 366` (`runProduction`) copy `:261-262`'s `void resolveTimestampsAsync(...).then(...)`, so a rejection goes unhandled. *Fix:* add a `.catch` that records it.
- **W2I-N8: the `onFrameTiming` test can pass vacuously.** It returns early on a device without timestamps (`flow-solver.test.ts:108`). *Fix:* use `it.skipIf(!hasTimestamps)`, so a vacuous pass is visible.

**Verdict w2/solver-int @f07f57e: MERGE.**
- The solver-perf kernel is correct and bitwise main's, in all four modes.
- The D4-44 mirror is term for term the oracle's: every mutant is killed, and the preconditioned bitwise invariants hold.
- The NaN's cause (W2R-I6, β/M_cut 8.90 at the inflow-axis corner) is confirmed in f64, and its test fails on the old kernel.
- W2R-B2 is resolved by this merge order.

**Conditions:**
- If D4-61's pin goes in, it goes in the split form of W2I-I1, in the merge commit. Otherwise `test:gpu-ladder` stays visibly red on L9a, as the CPU ladder does under D4-57.
- W2I-I2 (a)-(c) is fixed before the orchestrator's quiet P1 run, not before the merge.

**Orchestrator questions:**
- (jj) P1's scene. bench:p1 measures the W0 bench scene, which is PHYSICS P1's wording and M34's calibration. D4-54 says the app's 1080p scene. Which is of record? The `scene: 'app'` option is unwired either way.
- (kk) D4-61: the split pin of W2I-I1, or the row kept red like the CPU ladder?
- (ll) Expectation for the quiet run. The builder's indicative in-scene figure is 2.49 ms/it before the β pass (about +0.1 ms/it), which is 2 it/frame, about 120 it/s. A P1 miss under D0-1 then goes to D4-54's logged decision (about 80k cells or a half-rate solver). The scene's after-allocation slowdown (solver-perf FINDINGS 2) may be part of it.
- Carried to the next solver round: W2I-N1 (one `cellPrim` call site), N4 (preconditioned bitwise tests and an oracle comparison on the real mesh), and N2/N3/N6-N8.
- **Merged into main @4d096fb: w2/solver-int @f07f57e** (critic pass 10: MERGE, 0 B / 2 I / 8 N), with the critic branch at 6685cb3.
  - The merged code under src/tests/tools/spikes is byte-identical to the reviewed tip; main's only additions since are LOG text.
  - On a memory-starved machine (0.2-1.4 GB free), the orchestrator ran the light gates on the merged tree: typecheck clean, lint clean, mesh 29, mesh manifest unchanged. It relies on the critic's full gates at f07f57e: coverage 1901 + 11 expected fail (lines 99.59%), test:gpu 60/60, gpu-ladder 11/12 (the L9a steadiness row, W2I-I1), browser 25, CPU ladder 11/3.
- **D4-64 (critic pass 10 question jj): P1's measurement of record runs in the app's own 1080p engine scene** (D4-54), with the W0 bench scene reported beside it for continuity. W2I-I2 is fixed before the quiet run:
  - a run with GPU errors or a non-finite state is INVALID;
  - `scene: 'app'` takes effect;
  - a README entry is added.
- **D4-65 (question kk): D4-61's pin takes the critic's form.** Only the steadiness check is `it.fails`, with the D4-57 reason, and a passing value row sits beside it, so a value regression, a NaN or a timeout still fails.
- **D4-66 (question ll): P1 is expected to miss in the app's scene (about 120 it/s).** The arithmetic: render 8.5 ms back to back (P4), so D4-2 gives the solver min(5, 15 − 8.5 − 2) − 0.66 ms resample ≈ 3.8 ms, which is 2 iterations at 1.29 ms.
  - The official run decides it. If it misses, P1's own rule applies: a logged decision between the 80k mesh and a half-rate solver, made on measured numbers (80k ≈ 0.8 ms/it would give about 4 iterations per frame).
  - P4's last 0.5 ms (look-dev round 5) feeds the same budget.

### Re-verification @9e1257b (w2/solver-fix, from main 6ed8d81)

I re-checked each pass-10 finding on 2026-10-28. I read the diff 6ed8d81..9e1257b and ran the suites one at a time in the builder worktree, whose tracked files are unchanged. I ran no `bench:*`.

**Gates at 9e1257b:**
- typecheck and lint: clean.
- `npm run coverage`: 99 files, 1917 passed + 11 expected fail (761 s). Lines 99.60 %, statements 98.70 %, functions 99.65 %, branches 87.76 %. By directory (lines): src/flow/reference 100, thermo 100, cycle 99.58, geometry 99.59, flow/gpu 99.74.
- `tests/unit/spikes`: 16 files, 136 passed (p1.test.ts among them).
- `test:gpu`: 11 files, **64 passed** (59 s). Every 12.2 row equals pass 10's to the printed digit, and engine stability is 0.998 … 1.510.
- `test:gpu-ladder`: **12 passed + 1 expected fail** (317 s). The L9a value row passes at 3.56e-6 (finite, spread 1.31e-5 reported), and the expected fail is the steadiness pin.
- `test:browser`: 9 files, **26 passed** (170 s, port 5190, strictPort). Nothing is left listening.
- `test:mesh` and `test:ladder`: not run. No file they cover changed.

**Probes:**
- N1, bitwise, my probe (f07f57e against 9e1257b, 130k, perfState): **0 of 1,040,272 words differ, all finite**, in preconditioned (50), plain (200) and physical (50).
- M4 (every ghost taking cell 0's β) against `test:gpu` at 9e1257b: now **killed by 2 tests**, C-pre and the new preconditioned interface variant.

**Each finding:**
- **W2I-I1: FIXED** (D4-65, 5442ebc). `l9aCase()` runs the case once and two tests share it.
  - The value row passes only when the value is finite and < 1e-4, every window sample is finite, and the spread is finite. A regression, a NaN, a GPU error (afterEach) or a timeout therefore fails it.
  - The `it.fails` asserts only spread ≤ tol/10, and its comment says to fold the steadiness back into the value row once it passes.
  - The CPU ladder is unchanged (visible FAIL, D4-57).
- **W2I-I2: FIXED** (D4-64, daa8229 TDD / 491868b / 3c2f1e0).
  - (a) `solverValidity` (`spikes/lib/p1.ts`) makes a run INVALID on any GPU error, a non-finite state, a non-finite resolved residual on any frame, or a solver not `running` at the end. It is combined with D3-6 for every kind, and `p1Verdict` gives no verdict on an INVALID or missing record row.
  - (b) The row of record is `solver-130k-app`: EngineView at 1920 × 1080, DPR 1, defaults, `FLOW_SOLVER_LIMITS`. The bench scene and the spike run beside it, with a fresh page per run. `sceneOf` throws on an unknown scene, BenchApp throws on 'app', the P1 page throws on anything but production + 'app', and run.ts throws when a result's `scene` differs from the one requested.
  - (c) spikes/README now has the commands, the rows, the INVALID rule and estimated durations.
  - (d) The reset is kept, with the D4-63 reason, and the per-frame residual check now catches a divergence between resets.
  - Remaining caution, not a finding: as the handoff says, nobody has driven `runP1` end to end. The orchestrator's `--quick --only=solver-130k-app` smoke is the first run.
- **N1: FIXED** (2a27ceb). There is one `cellPrim` site for a cell and a ghost's first source, and it is bitwise as before (probe). The slip wall's second source keeps its own site, which never meets an interface.
- **N2: FIXED** (c673d65 TDD / 7ee6bd8). The callback runs after the solver's own updates, inside try/catch, and its error goes to console.error. The test confirms the status stays `running` with a throwing consumer.
- **N3: FIXED** (6f848ef). `compareSides` counts each side's non-finite state and half-float texture values.
- **N4: FIXED** (b450694). The interface, tile-shape and D4-50 packed tests run plain and preconditioned (`it.each(MODES)`), and M4 now has 2 killers. The suggested oracle comparison on the real mesh was not added. It was optional, and I do not carry it.
- **N5: FIXED** (6f848ef): about 0.42 at β/M_ref 8.9.
- **N6: FIXED** (491868b): every `frameAt` key at or below a resolved frame is dropped.
- **N7: FIXED** (491868b): all three-timestamp resolves have a `.catch` that logs a GPU error, which makes the run INVALID.
- **N8: FIXED** (c673d65): the test calls a visible `skip()` without timestamps.

**Verdict w2/solver-fix @9e1257b: MERGE.** 0 open findings. `bench:p1` is ready for the orchestrator's quick smoke, then the quiet official run. D4-66 expects a miss at about 120 it/s.
- **P1 official at main 22655d3 (D4-64 measure of record), 2026-10-28 22:06-22:18.**
  - Conditions: AC throughout, plan Balanced, no agents, Aaron confirmed the machine quiet. D0-1 protocol: 3 configs × 3 repetitions in rotated order, 10 s warm-up + 60 s each. All runs were VALID.
  - **solver-130k-app: 1.448 ms/it, 142 it/s at 60.0 fps** (frame p99 17.3 ms, 0 long frames). **P1 FAIL by 5%** against ≥ 150.
  - Beside it: spike-130k-16x8 297 it/s (1.306 ms/it), which reproduces M34's official 299 it/s, so the harness is calibrated. solver-130k-bench 120 it/s (2.642 ms/it, the W0 bench scene).
  - This is the quiet run, so the miss counts and P1's logged decision is due (D4-67). The JSON is committed as `docs/bench/p1-2026-10-28-2205-official.json`.
- **D4-67: P1's logged decision. The 130k mesh is kept, and the 5% gap is closed through the frame budget and the kernel; 80k is the fallback.**
  - **Why:** the solver's it/s is set by D4-2's budget, min(5, 15 − render − visuals) − resample. With render 8.50 ms (P4) that budget is about 2.4 iterations per frame.
    - P4's own pre-registered 0.5 ms (look-dev round 5) goes straight to the solver: about +0.35 it/frame, roughly +20 it/s.
    - A kernel-tuning pass on the 3-dispatch kernel (1.448 ms/it; the β pass and the halo work are the candidates) adds more.
    - The 80k mesh (about 0.85 ms/it, about 4 it/frame) costs fidelity the 130k mesh was sized for (plan, D2-5), so it is the fallback, not the first remedy.
  - **The rule:** re-measure P1 officially after look-dev round 5 and one kernel-tuning round. If it is still under 150 it/s, switch the default to the 80k mesh (already generated, meeting every mesh requirement), with 130k as the "high" preset, and record both.
- **P4 and P1 official at w2/lookdev-5 ffd6b3f** (records committed there, 4538f0f), 2026-10-28 23:21 to 2026-10-29 00:05. AC throughout, no agents, the display awake. D0-1: 10 s warm-up + 3 × 60 s. Every run was VALID.
  - **P4 PASS (back to back, measure of record): default 6.96 ms ≤ 8.0**, GPU busy 71%. Cutaway 8.06 ms meets its 10 ms target; hero 10.88 ms misses it (not gated). Performance profile 5.43 ms. Vsync beside it: default 12.02 ms.
  - **P1 PASS: solver-130k-app 157 it/s (1.421 ms/it) at 60.0 fps in the app's 1080p engine scene.** The calibration spike is 287 it/s.
  - D4-67's path held: look-dev round 5's render saving flowed into the solver's D4-2 budget. **The 130k mesh stays**, the 80k fallback is not needed, and the kernel-tuning round becomes optional headroom.
  - test:browser on that tip: 27 passed.
- **D4-68 (D4-63, the nonlinear part): drop the K·|Δp| term from β², as a trial under round 9's pre-stated rule.**
  - The term is a standard robustness cutoff (Weiss-Smith; D4-52). But here it lifts β from a 1e-3 wave and drives pseudo-velocities that focus on the axis. It bought nothing for J either (round 7: K up to 100 did not converge J).
  - Run K = 0 under the SOLVER.md §10 rule: adopt only if the rest state is non-growing and every currently passing row still passes, L7's iteration ratio included. If K = 0 breaks a row, try the term with the face-limited Δp instead.
  - The kernel mirrors whichever form is adopted.
- **D4-69 (D4-63, the linear part): transient or mode, decided by evidence.** The plain scheme's 1e-6 core-duct growth (2.8-4× by 1000 iterations) needs:
  - a long run to 20k iterations;
  - a power iteration on the linearised operator about rest, on the core-duct stand-in.
  
  A spectral radius above 1 is a mode, an instability to fix, with the location from the eigenvector. Growth that saturates and decays with all eigenvalues inside is a non-normal transient.
- **D4-70 (the 2× bound): round 9's rule stands as pre-stated** and is not loosened after the data. If D4-69 proves a decaying non-normal transient, any change to the rule's window must rest on the definition of "non-growing" (decay in the limit) and comes back as a logged decision with that evidence.

## Critic pass 11: w2/lookdev-5 @4538f0f

I reviewed `0bb473f..4538f0f` against main f7110a5 on 2026-10-29. Since 0bb473f main changed only LOG.md, so the merged tree's code is the branch's code byte for byte (checked: `git diff 4538f0f` of the merged tree is empty outside `docs/reviews`).

In scope:
- W2L-I1..I5;
- the P4 change: the scene pass writes colour and depth only, GTAO rebuilds the normal from the depth, and TRAA's camera velocity comes from the depth;
- the visual notes: the satin nacelle, 8 fan copies beyond half a pitch (W2L-N5), the spinner stripe (W2L-N4), the transport stand, the section caps;
- the official records at 4538f0f (P4 and P1).

Checklists: typescript-reviewer, silent-failure-hunter and pr-test-analyzer, applied by my own reading, and the three.js/WebGPU pitfalls in GPU_FACTS. I ran no bench, `ab.ts`, `variantAb.ts` or official capture.

New probes (each header says how to run it):
- `w2l-gbuffer.browser.probe.ts.txt`: the shipped (lean) scene pass against `legacyGbuffer`, TRAA-converged, beauty and AO, in four views at 1920 × 1080, plus the exploded transition;
- `w2l-rotor-mutants.sh.txt`: five mutants of the rotor motion vectors against the new W2L-I1 test;
- `w2l-focus.probe.mjs.txt`: whether a window blur reaches a page Playwright launched.

**Gates.** typecheck, lint, coverage and test:mesh ran in the builder worktree; its tracked files were unchanged afterwards. The browser suite ran there too, on its own Playwright Chrome at port 5190. The reference builder's ladder shared the CPU.
- typecheck: clean. lint (ESLint + Prettier): clean.
- `npm run coverage`: 100 files, 1931 passed + 11 expected fail (786 s). Lines 99.60 %, statements 98.71 %, branches 87.77 %, functions 99.65 %; thresholds pass. **`src/geometry` 99.59 % lines** (branches 90.38 %); thermo 100, cycle 99.58, flow/reference 100.
- `test:mesh`: 29 passed.
- `test:browser`: 9 files, **27 passed** (205 s), 0 WebGPU errors. This is the first full run at the code tip by anyone but the orchestrator; the handoff's was stopped.
  - W2L-I1: shipped 30.05 against zero 58.46 and flipped 58.96 /255, over 7989 moved pixels: ratio 0.51 against the bound 0.6.
  - W1V-I1 tiles, moving against the bound (floor + 6): cutaway 35 / 36; **cutawayFanClose 8 / 8, exactly at the bound** (W2L-I8, below); exploded 5 / 11; explodedFanClose 9 / 13; hotSection 0 / 6. The legacy control is 33 against 7, so it fails as it must.
  - fanBlur: worst tiles 0.063 (idle) / 0.041 (hero) / 0.051 (take-off) in motion.

**W2L-I2..I5: fixed in the code, with one gap that is not the builder's (W2L-I7).**
- *I2:*
  - `abSummary` drops a pair with an INVALID side and records `reps` and `dropped`;
  - `combineValid` gives a config's medians over its VALID runs, with `runsUsed`;
  - `p4Verdict` is INVALID when the default config's back-to-back run is INVALID, and the capture exits 1 on it.
  
  Unit-tested, including the pass-8 scenario (the official A/B's INVALID rep 0).
- *D4-42 in `p4Verdict`:* back to back decides, vsync is judged beside it, official needs the protocol and AC throughout, and the busy fraction is in the result. Correct.
- *I3:* the watcher pushes its open interval on stop (`main.ts:279`), and coverage under half the run's display intervals is INVALID. In the official run every back-to-back run was VALID, with no watcher warnings. The page-side push itself has no test (W2L-N12).
- *I4:* `os.ts` reads Win32_Battery around every run in `capture.ts` and `ab.ts`.
  - `powerValidity`: battery is INVALID when official, a warning otherwise; an unknown source is a warning and never counts as AC.
  - `acThroughout` accepts AC or no battery.
  - The BatteryStatus mapping (`system.ts:10-15`) is conservative: 4/5 count as battery, 11 as unknown.
  - The reads run between runs, outside the warm-up, so PowerShell's start does not land in a timed window.
- *I5:* blurs are counted (`main.ts:236-240`) and passed as D3-6's `pageBlurs` at both pacings. The watcher's INVALID is D3-6's occlusion signature, and its 2.5-interval stretch is a warning. That matches D4-46.

**W2L-I1: the new test can fail on the named failure modes, but its controls prove nothing beyond its own formula.**
- *The test:* the velocity debug view is linear and signed (±32 px in 8 bits, 0.25 px steps). It is the same overridden `velocityNode.load` TRAA reads (`post.ts:345-368`, and `:442` for the debug view), so it tests the vectors TRAA uses. The earlier TRAA-off still, sampled at u − v(u), must match the later still at u wherever the image moved by ≥ 16/255.
- *It fails without the vectors:* with v = 0 the "shipped" error equals the zero error, and 1 ≤ 0.6 is false. A dropped `load` override (lean mode would then read the depth as velocity) or a sign error fails too.
- *The controls are tautological.* Under `noRotorMotion`, shipped = zero = flipped exactly (72.64 = 72.64 = 72.64 in my run; the handoff's "73.4 = 73.4"), so `ok` is false by arithmetic for any implementation. Under `rotorMotionScale: -1`, the control's "shipped" and "flipped" are the main run's errors swapped (61.60 / 30.09 against 30.05 / 58.96). So it fails whenever the main assertion passes. Neither is evidence of sensitivity beyond the formula.
- *Each control also runs at a later rotor phase,* because every `measure()` advances the spools by 1/60: 7989, 14691 and 8049 moved pixels.
- *What the real sensitivity is,* with five mutants of plausible bugs: my `w2l-rotor-mutants.sh.txt` (each against `-t W2L-I1` alone; the ratio is shipped / min(zero, flipped), bound 0.6):
  - **M1, half the turn back (`back × 0.5`): SURVIVES**, 31.14 against 58.46 / 55.33 (ratio 0.56), almost the shipped 30.05;
  - M2, 1.5 × the turn back: killed, 37.20 (0.68);
  - M3, the HP and LP steps swapped: killed, 49.24 (0.87);
  - M4, the wrap at a full pitch instead of half: killed, 58.34 (1.00);
  - M5, the vector's y flipped: killed, 39.00 (0.97 against the flipped 40.39).
  
  So the test sees the spool, the wrap, the sign of either axis and an overshoot, but not a vector half as long. That is the factor between an NDC and a UV delta, the convention `offsetUV = v · (0.5, −0.5)` depends on (W2L-I6).
- *The moved-pixel selection* was added after a failing measurement (7.1 / 8.1 / 12.9 over every rotor pixel). It is principled: drums and disk faces turn into themselves, so they carry no information about the vector. It is symmetric in the vector, because it is chosen from the two stills only. And the flipped baseline is not selected on. I accept it.
- *Margin:* 0.49 (handoff) and 0.51 (mine) against 0.6.
- *What the vectors buy:* LOOKDEV records that a moving TRAA frame against a converged TRAA frame at rest changes 2.3 % of pixels with the vectors and 2.3 % without. So at this pose the tight clip, not the reprojection, removes W1V-I1's ghosting, and the vectors' visible benefit is unshown. Worth keeping in mind before spending more on them.

**The P4 change is correct, and its picture cost is confined to depth edges and the exploded transition.**
- *GTAO's normal from the depth.* `ao(sceneDepth, null, camera)` takes three r186's `getNormalFromDepth` (PostProcessingUtils.js:89-117). It is the 5-tap reconstruction that, per axis, takes the neighbour with the better linear extrapolation, which is the standard defence against silhouette halos. At half-resolution GTAO it reads the full-resolution depth (`textureSize` of the depth, so the taps are full-resolution texels). three applies TRAA's jitter to the whole pipeline, so GTAO's inverse projection is the jittered one the depth was drawn with.
  - The probe, lean against legacy, beauty TRAA-converged, pixels whose luminance differs by > 0.04: side 0.006 %, three-quarter 0.016 %, **cutaway 0.162 %** (worst tile 7 %), hot section 0.028 %. In the AO view: 0.004 / 0.004 / 0.019 / 0.015 %. No 16 px tile is over 25 % anywhere.
  - In the cutaway the differences are one-pixel outlines along the cut faces' silhouettes, where the depth steps. Thin geometry (the stand's tubes, the vanes edge-on, the struts) shows nothing visible.
  - So the LOOKDEV statement "differs ... only at depth edges ... no difference shows in the shots" is right.
- *TRAA's camera velocity from the depth (`post.ts:337-344`).* It unprojects the texel centre at the scene depth with the unjittered inverse view-projection and reprojects with the previous one. The result is an NDC delta current − previous, the convention three's velocity and our resolve use (offset · (0.5, −0.5)), and the same as the rotor path, which W1V-I1 validated.
  - The depth is WebGPU's [0, 1] z, which three's WebGPU projection produces, with no logarithmic or reversed depth.
  - Unprojecting a jittered depth with the unjittered matrix shifts the point by the sub-pixel jitter. That is second order in the camera's motion, and zero for a still camera up to f32 rounding (about 1e-7 NDC, 1e-4 px), not "exactly zero" (W2L-N9).
  - Rotor texels still take the rotor velocity (`select(isRotor, …)`), and TRAA reads velocity only through `load` (TRAANode.js:554, `traaResolve.ts:126`), so the stand-in `texture(sceneDepth.value)` is never sampled as velocity.
- *What the lean pass loses: per-object motion.* three's velocity node tracked each mesh's previous world matrix. The lean pass treats every main-pass texel as static, which holds except during the exploded and cutaway transitions (the handoff's question).
  - The probe, `setMode('exploded')` at dt 1/60, TRAA frame against the TRAA-off still of the same instant: at frame 15, lean 0.79 % of pixels / 3 tiles against legacy 0.76 % / 4; **at frame 30, lean 1.02 % / 16 tiles against legacy 0.96 % / 7**.
  - The variance clip contains it (edge-thin differences, no trails in the diff images). But the transition does lag more, and only while the parts move, about a second per mode change. Acceptable for a ~0.8 ms P4 cut. LOOKDEV should say it with the number, not "handled as it did any moving object" (W2L-N9).
- *The saving* is measured paired and indicative (−0.76 ms over 4 of 4 pairs; −0.80 to −0.92 ms opaque in HEAD against main). It is consistent with two fewer rgba16float writes per fragment in a bandwidth-bound pass.

**The official records at 4538f0f.**
- Back to back, default: 6.96 ms, every run VALID, AC before and after every run, GPU busy 0.71, errors 0. Vsync beside it: 12.02 ms (FAIL beside it, not deciding), which is the DVFS picture D4-42 accepted.
- P4 PASS stands under D4-42.
- One caution for the orchestrator: the official level dropped 1.54 ms from main's official 8.50, while the paired saving is 0.76-0.86 ms, so about half the drop is session-level. A future official re-run could read about 7.7 ms. It still passes, with about 0.3 ms margin rather than 1.0.
- P1 157 it/s is the orchestrator's record. Its JSON (`docs/bench/p1-2026-10-28-2353-official.json`) is committed here; I did not re-run it.

**Visual review, 00-07 against before/ (round 4's set), viewed at full size and in crops: a step better in three places, unchanged in the rest, and still CG against "premium product render of a real engine".**
- Better:
  - **06** (W2L-N5): the coarse diagonal dot screen over the take-off disc is replaced by a much finer, more even texture. It is reduced, not "gone" (a fine regular dot texture remains over the upper disc, with speckles at the right).
  - **The spinner stripe** reads in 00, 01 and 05 (W2L-N4). At take-off (06) it blurs into a soft pale swirl, which is right for 30°.
  - **The stand** reads as a shop frame: blue-grey tube, cross members, yellow swivel forks, a tow bar.
  - **02** shows a softbox highlight on the nacelle's upper skin.
- Unchanged or new defects:
  1. **The nacelle** (00, 01, 03) still reads as matte white. The satin change shows only in 02's single highlight. In 00 and 01 the barrel has no strip highlight, no environment reflection and no tonal variation, and the doors and latches are drawn outlines. LOOKDEV's "the softboxes' long highlights read on the skin (02, 00)" holds for 02 only.
  2. **The moving fan** is still the largest gap. 05 keeps its torn rectangular slivers where the booster shows through; 00 keeps the stipple in its lower half and the staircase breakup at lower right; 06 has the fine dot texture above.
  3. **New in 02: a stippled band on the floor along both rails of the lifted frame.** The probe's AO view shows it is GTAO's own noise (8 fixed samples, no spatial filter) in the 10 cm gap under the tubes. It is the same in the legacy pipeline (side AO 0.004 % different), so it comes from the stand's new geometry, not from the P4 change (W2L-N13).
  4. **The stand's scale and load path.**
     - The casters are 90 mm wheels under a 2.3 t engine; shop stands use 150-200 mm casters or pneumatic tyres.
     - The tow bar is a plank hanging 12-18 cm above the floor with no hitch or eye (02).
     - The engine still rides on saddles under the cowl skins, the rear one under the core cowl, a non-structural door, rather than at its mounts.
  5. **The cutaway** (03, 07): the caps are a little darker inside, but they still read as flat salmon, and the gloss gradient is not visible at these distances. The blades and vanes are shells, the combustor is a lumpy tube, 07's sandpaper speckle remains on every metal surface, and no heat tint reads.
  6. **04:** the parts float with no fixture, and they are untextured grey.
  7. No rotor AO or self-shadow: the fan face reads flat.
- **Verdict on the visuals:** LOOKDEV's "still CG-like" list is honest and complete. Its round-5 claims overstate two things (06 "gone", the nacelle highlight "02, 00"). This round fixed the notes it was given at the level of the notes. The premium-render bar is still not met: the fan in motion, the nacelle's surface and the cutaway's materials are what read as CG.

### Blocking
None.

### Important
- **W2L-I7: D3-6's blur rule (W2L-I5) is probably inert under Playwright: its Chromium emulates a focused page.**
  - playwright-core sends `Emulation.setFocusEmulationEnabled({ enabled: true })` for every main frame of a non-default context (`coreBundle.js:39024`, FrameSession._initialize). That is what `chromium.launch()` + `browser.newPage()` gives `capture.ts:156-166`, `ab.ts:178-190`, `variantAb.ts:57-63` and `spikes/bench/run.ts:459-468`.
  - The DevTools feature behind it ("Emulate a focused page") exists so that a page does not see blur when focus moves elsewhere. So `window` blur and `document.hasFocus()` stop reporting OS focus.
  - Every `pageBlurs` in `docs/bench/` is 0 (21 records).
  - My probe could not settle it at runtime: `bringToFront()` on a second Playwright Chrome did not take the OS focus (Windows' foreground lock), so both rounds read 0 blurs, the emulation-off control included. The finding rests on the code.
  - The failure scenario: an official P4 or P1 run with the Chrome window visible but unfocused is VALID. The occlusion signature still catches a covered or minimised window, but not this case, and D3-6 meant to.
  - Fix:
    - after `newPage()`, send `Emulation.setFocusEmulationEnabled({ enabled: false })` through a CDP session in the three look-dev tools and the bench;
    - sample `document.hasFocus()` at the start and end of each run (INVALID when false);
    - check it once by hand: click another window during a 10 s indicative run, and the run must come out INVALID.
  - The bench half is the orchestrator's (question oo).
- **W2L-N2 raised to Important (W2L-I8): the W1V-I1 tile test sits at its bound.**
  - `rotorMotion.test.ts:31` (MARGIN 6): cutawayFanClose moves 8 tiles against the floor 2 + 6, here and in the builder's runs (8-9 against 8; the handoff says it "flaked once"). The cutaway is 35 against 36.
  - The failure scenario: a merge-gate `test:browser` fails on this test with no code change, and someone widens the margin after the fact.
  - Fix, as pass 8 said: name the cut faces as the source (the half-pitch wrap breaks where the cut hides the next blade). Then either exclude a band of tiles at the cut faces, stated before the run, or widen MARGIN with that reason now, before it flakes at a merge. W2L-I1's new warp test is now the real check of the vectors, so this test only has to show "no ghosting".
- **W2L-I6: the W2L-I1 test passes rotor vectors at half their length** (`rotorMotion.test.ts:129-242`; the error at `:210`).
  - Mutant M1 (`post.ts` `back` × 0.5) passes at 31.14 against 58.46 / 55.33 (ratio 0.56 ≤ 0.6), next to the shipped 30.05. A half-length vector is the classic NDC-against-UV slip (the resolve's `offsetUV = v · (0.5, −0.5)`).
  - The likely reason: the pose's wrapped per-frame turn is small. At idle the fan turns about 7 pitches a frame, so what is left after the half-pitch wrap depends on the phase, and the error is taken with `Math.round` sampling. When the image moves a pixel or two, half the vector is within rounding of the full one. The 30/255 floor of the shipped vectors says the same.
  - The failure scenario: a velocity convention change (NDC to UV, or a /2 in the reprojection) passes the merge gate, and TRAA reprojects the rotors by half their motion: a smear behind every blade in the cutaway and the exploded close-ups.
  - Fix, stated before measuring:
    - set the step through `lpPhase` (or `rotorMotionScale` on a dt that makes the wrapped turn about 0.3 pitch) so the moved pixels move ≥ 4 px, and print the |v| percentiles;
    - sample the earlier still bilinearly;
    - add the half and 1.5 × vectors as baselines that must also lose, `shipped ≤ 0.6 × min(zero, flipped, half, 1.5×)`.
  - The two existing controls can stay, but the handoff and LOOKDEV should not call them evidence: they fail by arithmetic (above).

### Nits
- **W2L-N8.** `materials.ts:96-99`: FAN_TIME_SAMPLES is 8, but its comment still says "6, not 8 (LOD round 2) ... fewer per frame hold the fan-blur bounds". The count per frame is now `fanTimeCopies` (motion.ts).
- **W2L-N9.** `post.ts:3`'s pipeline header still lists the main pass as "(colour, normal, velocity)". `post.ts:335-336` and LOOKDEV say a still camera gives "exactly zero"; it is zero up to f32 rounding. LOOKDEV's "the exploded and cutaway transitions ... handled as it did any moving object" should give the probe's number (16 tiles against 7 at frame 30).
- **W2L-N10.** `capture.ts:327`: `gpuBusyMedian` takes `busy[floor(n/2)]`, the upper of the two middle values when a config has an even number of valid runs (one INVALID of 3). Use the mean of the middle two, as a median.
- **W2L-N11.** GPU errors do not make a run INVALID in `capture.ts` or `ab.ts`; they are only recorded. `variantAb.ts:120` does it (`v.valid && run.errors === 0`). A pass that failed validation renders less and is cheaper, and could PASS P4. Make `errors > 0` INVALID in both, as W2I's bench now does.
- **W2L-N12.** W2L-I3's page-side half, the push of the open interval at `main.ts:279`, has no test. `timing.test.ts` feeds `pacedValidity` its deltas directly. Move the watcher into a small pure helper (start, tick, stop returning deltas) and unit-test the stop.
- **W2L-N13.** The stand (visual items 3-4): either lift the frame on 150 mm casters, which widens the gap where GTAO's noise shows and is truer to a 2.3 t load, or soften the AO there. Rest the tow bar on the floor or fold it up, and say in LOOKDEV that the saddles bearing on the cowls are a display cradle, not a transport stand's mount adapters.
- **W2L-N14.** LOOKDEV round 5: "06's dot screen is gone" should say reduced; "long highlights ... (02, 00)" should say 02.
- Pass-8 carry-overs: **W2L-N3** (back-to-back CPU time per frame) is recorded, not done. **N6** (culling's timeout) and **N7** (`optimizeDeps`) are open; the browser suite passed here without either biting. N1, N4 and N5 are fixed.

**Trial merge 1** (detached at bd59f07 = main f7110a5 + this pass's probes):
- `git merge --no-ff --no-commit w2/lookdev-5` is clean: 40 files, no conflicts, and the merged code equals 4538f0f's.
- typecheck and lint: clean.
- My two browser probes and the five mutants ran on this tree (above).
- The unit, coverage, mesh and browser numbers are the tip's above, from identical inputs.

**Verdict w2/lookdev-5 @4538f0f: MERGE.** B 0, I 3 (I6, I7, I8), N 7 new (N8-N14), with N2/N3/N6/N7 carried.
- The tools that decide P4 now keep INVALID runs out, check the power source, and follow D3-6 and D4-46 as written.
- The P4 cut is correct and costs pixels only at depth edges and in the exploded transition.
- The gates are green, with test:browser at 27/27.
- I6 and I8 go to the next look-dev round, before W2L-I1's test is relied on as the guard of the vectors. I7's look-dev half goes there too; its bench half is question (oo).
- **Orchestrator questions:**
  - (oo) W2L-I7: switch off Playwright's focus emulation in `spikes/bench/run.ts` too, so D3-6's blur rule can fire for P1 and P2? Or drop the blur rule for supervised official runs and say so in D3-6?
  - (pp) W2L-I8: may the cutaway close-up's MARGIN be widened now, with the cut faces as the stated reason, or must the band at the cut faces be excluded instead?
  - (qq) P4's official margin: the 6.96 ms includes about 0.7 ms of session-level speed (above). Note it beside P4, so a future official re-run at about 7.7 ms is not read as a regression.

## Critic pass 11: w2/reference-9 @bcacc0a

I reviewed `22655d3..bcacc0a` against main f7110a5 on 2026-10-29 with `git show` and `git diff`; since 22655d3 main changed only docs (the P1 JSON and LOG). The reference builder is working in its worktree in parallel, so I ran everything in a detached checkout of bcacc0a (`.claude/worktrees/critic-r9`, own `npm ci`, removed afterwards). The builder's scratch (`reports/scratch/r9`, gitignored) I read in place and did not run.

In scope: the D4-63 investigation (SOLVER.md §10, "D4-63, the rest state on the engine mesh"), its pre-stated rule and the `it.fails` pin (`tests/ladder/cases/d463.ts`, `tests/ladder/d463.test.ts`), and D4-62's §12.2 flux-scale tolerances. No scheme or kernel change.

**Gates at bcacc0a (detached checkout, one suite at a time).**
- typecheck: clean. lint (ESLint + Prettier): clean.
- `npm run coverage`: 99 files, 1917 passed + 11 expected fail (783 s). Lines 99.60 %, statements 98.70 %, branches 87.76 %, functions 99.65 %; thresholds pass. `src/flow/reference` 100 % lines (branches 88.75 %), geometry 99.59, cycle 99.58, thermo 100. The src tree is main's: the round adds only `tests/ladder` and docs, and the unit suite does not include the ladder.
- `test:mesh`: 29 passed.
- `test:ladder`, the new case only (`tests/ladder/d463.test.ts`, the one ladder change; run on the trial-merge tree, whose `tests/ladder`, `src/flow` and SOLVER.md equal bcacc0a's): **1 passed + 1 expected fail** (1597 s, with the reference builder's power-iteration run on the CPU beside it). The signature passes (finite, checkpoint peak 12.26 < 100), and the rule fails as pinned: (a) **8.393** against ≤ 2, (b) **11.95** against ≤ 1. A first attempt was cut by my own 25-minute wrapper at 1498 s with the builder's d463 run in parallel. There the signature FAILED visibly while the pin counted as an expected fail, which is D4-65's split doing its job (W2R-N24).

**Pre-statement: the rule was stated before any fix, and its bound was not chosen on the data.**
- 1292f3f (22:05) is the first WIP handoff: 100-150-iteration runs only, and the inflow hypothesis.
- 3de1b43 (22:47, TDD) adds the case and the pin with the rule's constants: `D463_LATE_PRESSURE_BOUND = 2`, "engine-stability's GROWTH" (`tests/gpu/engine-stability.test.ts:34` on main, GROWTH = 2), the late window 1000-2000 and the residual at most its value at 100.
- ac52db7 (22:59) writes the rule into SOLVER.md §10 with the diagnosis and the outcome.
- The scratch logs date the data: the engine's long default run (`logs/base2000.log`) finished at 22:57, the plain scheme to 1000 (`plain1000.log`) at 22:56, the 1e-6 run (`amp6_1000.log`) at 22:58. The pin's comment quotes the default run at 1100 iterations, so the rule was written while that run stood near 1100 and before the plain and 1e-6 runs ended.
- So it is pre-stated in D4-63's sense (before any fix) and its 2× is inherited, not tuned. It was not blind to the base case, which it is meant to fail.

**The investigation: sound for what it refutes; the stand-in represents the engine only early on.**
- *The oracle repro* matches the GPU (1.510 at 100, engine-stability's trace) and the logs show it (`base2000.log`: ρ 1.510 / 10.40 / 13.60 and p 2.439 / 4.255 / 8.020 at 100 / 1000 / 2000).
- *The round-8 hypothesis is refuted correctly.* Where the early maximum sits, β/M_ref is 0.82-1.08 (no jump), and the max moves to the axis, not along the inflow column. Every inflow variant changes max |p′| at 200 by ≤ 5 % on the stand-in.
- *Semi-discrete:* CFL 0.4 follows CFL 0.8 in pseudo-time (2.16 at 180 against 2.19 at 90). That is what local time stepping predicts for a semi-discrete process, so a step limit cannot help. This covers the early, nonlinear part.
- *Does the stand-in represent the engine mesh?* The upstream block alone, built from the asset's own nodes with its imax a slip wall, with the engine's x0, x1 and r1 for the wave. It matches the engine to 4 digits at 100 (1.510 / 2.439 at (2, 64)) and at 200 (5.43). Then it decays (0.96 at 1000, 0.23 at 2000), while the engine grows in the plume-core and core blocks. So it stands in for the upstream block's first ~200-270 iterations, where the round-8 hypothesis put the growth, and nowhere else. Every inflow variant was judged at 200. That is enough to refute the hypothesis, because the late maximum sits 7-9 m downstream of the inflow. But it says nothing about the rule's 1000-2000 window (W2R-N21).
- *The two parts:* the nonlinear part (the Δp term lifts β, pseudo-velocities 5-15 m/s, axis focusing, entropy frozen at rest) and the linear part (core duct, x 0.6-1.6 m, no entropy) are both what the logs show.
- *But the logs also hold a norm the report leaves out* (W2R-I18). `grow2.ts` prints E = sqrt(Σ V_r p′²) over its first, the volume-weighted L2 of p′:
  - **plain scheme: 0.517 at 100, 0.480 at 500, 0.497 at 600, 0.365 at 1000**, while max |p′| rises 1.0 → 3.3;
  - **amplitude 1e-6, preconditioned: 0.560 at 100 → 0.469 at 1000**, while max |p′| rises 0.96 → 2.76;
  - the default at 1e-3: 0.718 / 1.020 / 1.317 / 1.470 / 1.372 / 1.268 at 100 / 200 / 1000 / 1100 / 1500 / 2000.
  
  So in the linear part the volume-weighted L2 decays while the max and the cell-mean residual grow. That is the signature of a pulse gathering into the core duct's small cells (the report's own "transient" reading), and it is evidence for D4-69, measured and not reported. The nonlinear default does grow in L2 too, but only to 1.27-1.47×.

**D4-62's tolerances: the arithmetic is right, the model justifies E-L5 only, and E-L9a's sits at the f32 floor of the norm itself.**
- *The arithmetic:* ten times the measured value, rounded up to one figure: B 1.27e-11 → 2e-10, E-L5 2.67e-8 → 3e-7, E-L9a 2.46e-12 → 3e-11. The margins are 15.7 / 11.2 / 12.2×. The measurements are mine, from pass 10's merged `test:gpu` and `test:gpu-ladder` (LOG lines "12.2 rows" and "B").
- *What the model derives:* the face-flux arithmetic bounds the row by k ε r_G/r_flux ≤ k ε. E-L5 measures 0.45 ε, at that bound, so its tolerance follows from the model. B and E-L9a sit 1e4-1e5 below kε, which the text says it cannot resolve, so their tolerances are empirical: ten times one measurement on one driver. That is what D4-62 asked for ("ten times the measured ... error"). The text should call it that, not a derivation (W2R-I17).
- *What the model leaves out* is the norm's own f32 reduction. r_GPU comes from per-tile f32 tree sums of R² over 16 × 8 tiles (`kernels.ts:677-683`), summed in f64 on the CPU (`residualFromPartials`). Only the per-cell face sums are compensated (§14.6(a)); the norm is not. That reduction carries about 0.5-4 u of r_GPU (u = 2⁻²⁴ = 6.0e-8: the squares' rounding, 7 tree levels, and the halving under the square root). Over the flux scale this term is u r_ref/r_flux times that:
  - E-L9a: r_flux/r_ref is 2.7e3, so the term is 1.1e-11-8.8e-11. **The tolerance 3e-11 sits inside that band;** it is 1.4 u of r_ref. The measured 2.46e-12 is 0.11 u, below the norm's typical rounding.
  - B (r_flux/r_ref 1.15e10) and E-L5 (3.9e4) have this term at 2e-17 and 6e-12, far under their tolerances.
- *Can they fail?* Yes, all three. B fails at |r_GPU − r_ref| > 2.3 r_ref, E-L5 at > 1.2 % of r_ref, and E-L9a at > 1.4 u of r_ref. E-L9a can also fail with correct arithmetic (W2R-I17).
- *The kernel side* still checks the old values (W2R-I19).

### Blocking
None.

### Important
- **W2R-I17: E-L9a's 3e-11 is inside the f32 rounding of the norm it compares** (SOLVER.md §12.2, the D4-62 table and its model paragraph, bcacc0a:477-489).
  - The failure scenario: the kernel-tuning round D4-67 names changes the tile shape or the reduction (D2-5's 16 × 8 is a tuning parameter). The tile sums of R² reorder, r_GPU moves by about one u with correct arithmetic, and E-L9a fails. Then "a row is never loosened to pass" forbids the fix, so the row blocks a correct kernel.
  - Fix, before the solver round adopts the rows:
    - add the norm's reduction term to the model, about 4 u r_ref/r_flux (the worst case for 128-cell tiles);
    - take each row's tolerance as max(10 × the measured value, that term rounded up): E-L9a **1e-10** (still 1e7× tighter than 1e-3, and 40× its measurement), B and E-L5 unchanged;
    - or compute the row's r_GPU in f64 from read-back per-cell residuals, which removes the term.
  - Main's tests do not use 3e-11 yet (W2R-I19), so this tightens nothing in force. It is the orchestrator's call (question mm).
- **W2R-I18: the rule judges growth in the norms that weight the smallest cells most, and does not ask for decay** (SOLVER.md §10, "The rule for any D4-63 fix", bcacc0a:402; `d463.ts:65-71`).
  - (a) *It can fail a stable scheme.* Max |p′| and the cell-mean density residual (§11: mean over cells of (R/(bV))², with no volume weight) are dominated by the core duct's and the axis's small cells. A pulse gathering into them raises both while the field's volume-weighted L2 falls. The builder's logs (above) show exactly that for the linear part: plain 3.3× and 1e-6 2.76× in max |p′|, with E at 0.365 and 0.469. So rule (1) may be unpassable by any non-growing scheme, which is the question D4-70 leaves to D4-69's evidence. The bound itself comes from a constant whose comment limits it to 100 iterations: GROWTH = 2 at `engine-stability.test.ts:28-34` reads "It is not a bound for longer runs: the scheme's pseudo-time transient lifts the oracle's max |p'| to 20x ... by 270 iterations".
  - (b) *It can pass a non-decaying state.* A field that settles to a neutral oscillation at, say, 1.5× its first with a flat residual passes both parts. In the app that is a persistent flicker of the flow field from rest. D4-70 defines non-growing as "decay in the limit", which nothing in the rule tests. The window (1000-2000) is also 1000 iterations, not W2R-N16's 2000.
  - Fix (rule changes come back as logged decisions under D4-70):
    - `d463.ts` reports E (and the kinetic part, ½ Σ V ρ|u′|², for an acoustic energy) in `extra`, beside max |p′|;
    - D4-69's long run and power iteration report the same norms;
    - the orchestrator decides whether the rule judges a volume-weighted energy with a decay requirement (E or the residual at 2N at most half of its value at N, over 2000-4000, or a measured spectral radius below 1). That replaces max |p′| (a loosening, so it needs D4-69's evidence), and the decay requirement is a tightening (question nn).
- **W2R-I19 (kernel side): D4-62 is in SOLVER.md only; main's tests still check 1e-3 and 1e-6.**
  - `tests/gpu/oracle.test.ts:328-329` (E-L5: `TOL_RESIDUAL` 1e-3 and 1e-6), `:388` (E-L9a: `TOL_RESIDUAL`), and `tests/gpu-ladder/ladder.test.ts`'s B residual row (1e-3).
  - The failure scenario: until the solver round lands, §12.2 states rows that no test checks, and the rows still cannot fail. That is the defect D4-62 exists to remove.
  - Fix: the next solver round sets the three expects to §12.2's values (with W2R-I17's E-L9a), in the same commit that cites D4-62.
  - On my trial merge, the current GPU passes the new values: E-L5 2.67e-8 against 3e-7, E-L9a 2.46e-12 against 3e-11, and B 1.266e-11 against 2e-10. These are pass 10's numbers to every printed digit (the kernel is deterministic)..

### Nits
- **W2R-N20.** Rule (2)'s list of §12 rows (bcacc0a:402: "C, C-pre, C physical, D, S and the f32-storage table") leaves out A, B and E. A (the quiescent ambient, bitwise 0 on the real mesh in every mode) is the row most relevant to a rest-state fix. Say "every §12.1/§12.2 row".
- **W2R-N21.** SOLVER.md §10 should state the stand-in's scope: it matches the engine through ~200 iterations, then decays while the engine grows elsewhere, and every inflow variant was judged at 200. One full-engine run of the far-field remap (`REMAP=4:3`) to 2000, about 8 minutes alone, would show that the late window does not depend on the inflow either.
- **W2R-N22.** `d463.test.ts:9-15`: `row(k)` throws on a missing row, and inside the `it.fails` a throw counts as the expected failure. So a refactor that drops rows 1-2 turns the pin into a silent pass, while the signature (row 0) stays green. Assert `rows.length === 3` in the signature test.
- **W2R-N23.** The handoff reports gates "@eb5f92b" with test:ladder NOT RUN, so the committed d463 test had never run. It does now: 1 passed + 1 expected fail, rule values 8.393 / 11.95.

- **W2R-N24.** `d463.test.ts` takes 1597 s with one other CPU job (the builder's `power.ts`) and more than 1498 s beside a second 130k oracle. The handoff says 6-8 min alone. The ladder's cap is 30 min (`vitest.ladder.config.ts:15-16`, `spawn.ts:22`), and `test:ladder` runs its files in forks side by side, so a loaded full ladder can time this case out: a visible signature FAIL, not a silent pass. Give it its own cap with the reason (about 3× the loaded time, as W2R-N15 asked for L7), or checkpoint less often.
- **W2R-N25.** SOLVER.md §10's outcome ("8.0× late max, residual 10.4× its value at 100") quotes the 2000-iteration endpoint. The rule and the committed case take the window's maximum: **8.39× and 11.95×**. Quote the case's numbers.

**Trial merge 2** (on trial merge 1 as a scratch commit, so this is main + w2/lookdev-5 + w2/reference-9, the likely merge order):
- `git merge --no-ff --no-commit bcacc0a` is clean: 4 files, and SOLVER.md merges without conflict (lookdev-5 does not touch it).
- typecheck and lint: clean.
- `test:gpu`: 11 files, **64 passed** (54 s). Its E rows print 2.67e-8 and 2.46e-12 over the flux scale.
- `test:gpu-ladder -t "12.2 B"`: passed, with the residual over r_flux 1.266e-11 and max |u − u∞| 1.95e-5 against 10 × 1.49e-5.
- `test:mesh`: 29 passed. `test:ladder`, d463: as above, run on this tree.
- I did not re-run coverage: this tree differs from 4538f0f only in docs and `tests/ladder`, and the unit config includes only `tests/unit` and `src` tests, so its inputs are trial merge 1's.
- **Restored:** the merge was aborted and my worktree is back on `critic` at bd59f07, clean. The builders' tracked files are unchanged: lookdev-5 is at 4538f0f, and reference-9's worktree was not touched (the detached checkout `critic-r9` is removed).

**Verdict w2/reference-9 @bcacc0a: MERGE.** B 0, I 3 (I17, I18, I19), N 6 (N20-N25).
- The diagnosis is sound for what it refutes, and its rule was stated before any fix.
- The pin runs as designed: the signature passes and the rule fails as pinned, with the D4-65 split shown working.
- D4-62's rows can now fail.
- I17's E-L9a value and I19's kernel-side expects must land together in the solver round. Until then nothing in force changes. I18 goes into D4-69/D4-70.

**Kernel-side items (w2/solver's next round):**
1. W2R-I19: `tests/gpu/oracle.test.ts` E-L5 / E-L9a `fluxScaleError` against §12.2's values, and `tests/gpu-ladder/ladder.test.ts` B's residual row against 2e-10. Use E-L9a's value from question (mm).
2. When a D4-63 fix is decided, its WGSL mirror, plus the d463 rule on the GPU's `engine-stability.test.ts`.

**Orchestrator questions:**
- (mm) W2R-I17: E-L9a at 1e-10 rather than 3e-11, with the norm's f32 reduction added to §12.2's model, decided before the solver round adopts the rows (no test uses 3e-11 yet)?
- (nn) W2R-I18, for D4-69/D4-70: should the D4-63 rule judge a volume-weighted energy (p′ and kinetic) with a decay requirement over a 2000-iteration window, instead of max |p′| and the cell-mean residual? The builder's own logs show the linear part decaying in that norm (0.37 / 0.47 at 1000) while max |p′| grows 2.8-3.3×.
- **Merged into main @9e4933e (w2/lookdev-5 @4538f0f) and @e6c6326 (w2/reference-9 @bcacc0a, the reviewed commit; the builder has moved on to 9a9dd28, which is unreviewed), plus critic pass 11 @a049709.** Both got MERGE. Gates on the merged tree, run in the foreground: typecheck and lint clean, mesh 29, test:gpu 64/64. The critic's trial merges ran the full suites.
- **D4-71 (pass 11 question mm): E-L9a's tolerance is 1e-10.** The value 3e-11 sat inside the f32 rounding of the norm it compares (W2R-I17), so it could fail for rounding alone. 1e-10 is above that floor, consistent with D4-62's ten-times-measured-error model.
- **D4-72 (question nn): the D4-63 rule is stated in the volume-weighted energy (L2) norm.**
  - The reason is the definition of "non-growing", not the data. In axisymmetric coordinates, a converging cylindrical acoustic wave amplifies physically towards the axis, roughly as 1/√r, so the pointwise max |p′| can grow while the wave's energy decays.
  - The standard stability notion for a discretisation is a bounded energy norm.
  - The rule becomes: from 1000 to 2000 iterations, the volume-weighted L2 of p′ is ≤ 2× its first and the residual is ≤ its value at 100. Max |p′| is still reported.
  - This is the case D4-70 anticipated, and it rests on that definition: the energy norm is the measure, the 2× bound is kept, and the D4-68 nonlinear part still has to meet it.
- **D4-73 (question oo): yes, fix the bench's focus emulation** (W2L-I7). D3-6's blur rule must take effect in official capture, ab and bench runs.
  - The official P4 and P1 results stand: their rAF watchers saw no occlusion signature, and occlusion is the rule that would have caught a hidden window.
  - The fix goes into the next tools/kernel round.
- **D4-74 (question pp): MARGIN is not widened after seeing a test at its bound** (W2L-I8). Make the cutaway close-up measurement robust instead: average over N frames, or derive the bound from a measured distribution, with the rationale stated. W2L-I6 (vectors at half length, NDC vs UV) is fixed in the same round.
- **D4-75 (question qq): yes, record P4's margin.** It is 6.96 ms official against 8.0, a 1.04 ms margin. The indicative session-to-session drift here is up to about 2×, so only official runs count.
- **D4-76 (w2/flowviz @89ef843, PARTIAL at the cap): Data-mode colours composite after tone mapping, in display space.**
  - A data colour map (viridis, inferno, CIELAB diverging) must show its stated colours. AgX tone mapping, exposure and bloom would distort them and break the legend.
  - Standard practice: the scientific overlay is drawn after the cinematic pipeline, unaffected by it.
  - In Data and Cutaway modes, the cut plane is cropped to the engine's near field (a few diameters), so the far-field slab doesn't cover the studio. The full domain stays available as an option.
  - Realistic and Schlieren keep their physically based paths.
- **D4-77 (w2/reference-9 round 10 @a1313a3): rule (b)'s residual is restated in the same volume-weighted norm as D4-72, consistently with it.**
  - **Round 10's evidence:**
    - The linear part is a decaying non-normal transient: over 20k iterations at 1e-6, the pseudo-energy fell in 99 of 100 windows, L2(p′) ended at 0.022× its first, and max |p′| peaked at 4.98× before ending at 0.35×.
    - The spectral radius is 1 from neutral entropy/vortical modes only. The stand-in Arnoldi carries no pressure in its leading vector.
    - Yet that decaying case fails the unweighted residual rule, at 11.9×.
  - **So the unweighted residual does not measure growth.** It is dominated by the r-weighted scheme's tiny near-axis cells.
  - Rule (b) becomes: the volume-weighted L2 residual from 1000 to 2000 iterations is ≤ its value at iteration 100. This rests on the definition: the same energy norm as (a), and the standard convergence monitor. It is a change after seeing data, logged as such, and it does not loosen (a).
- **D4-78 (round 10, the nonlinear part and the scheme):**
  - K = 0 (D4-68) is not adopted: it goes NaN and breaks C-pre and L8. The face-limited Δp also fails the rule, so the Δp term does not cause the nonlinear part. β² stays as it is (K = 1, the neighbour Δp), and the kernel needs no change.
  - Under the energy rule, (a) passes: the contract case 1.72× and the linear part 0.51×.
  - The next reference round:
    - implements D4-77;
    - re-runs the d463 case. If (a) and the restated (b) pass, D4-63 closes without a scheme change: max-norm geometric focusing plus a non-normal transient. If (b) still fails, come back with data for a floor or a scheme change;
    - runs the full gates and the ladder.
  - The smooth limiter's real growing far-field mode (1.00289 per iteration) is recorded as further support for D4-55 (keep sharp).
- **D4-79 (w2/reference-9 round 11 @a5d86dd): rule (b) judges decay in the limit, per D4-70, with the evidence it requires.**
  - **Round 11's results with D4-77's weighted residual:**
    - contract case: (a) 1.717 pass, (b) 2.614 fail;
    - linear part: (a) 0.505 pass, (b) 1.092 fail. Its weighted residual stays flat through 2000 iterations, then falls to 0.14× by 20000;
    - the contract case's residual grows in the far-field interior and the plume blocks, not at the axis.
  - A decaying non-normal transient can fail any early window, so the 1000-2000 window does not test "non-growing" (decay in the limit, D4-70).
  - **Rule (b) becomes:** run each d463 case to 20k iterations. The weighted residual at 20k must be ≤ its value at 10k and ≤ its value at iteration 100. Rule (a) is unchanged and is also checked at 20k.
  - **Next round, timeboxed to one round:**
    - run the contract case to 20k;
    - if (a) and the new (b) pass, close D4-63 with no scheme change;
    - if not, trial a local time-step limit from the measured β/M_ref (the standard remedy; the 1D limit is in SOLVER.md §10) under the same rule;
    - a β floor such as minMach 0.02 is the last resort: it raises L7's iteration ratio to 1.78 and L8 to 0.754%.
  - D4-63 must be closed before W3's coupling. It does not block W2's flow visuals or app shell.
- **D4-80 (w2/app-ui @6762716, PARTIAL at the cap): the four new dev dependencies are accepted.** They are pinned exactly: @testing-library/react 16.3.3, @testing-library/dom 10.4.2, @testing-library/user-event 14.6.8 and happy-dom 21.0.4.
  - This is the standard React Testing Library stack, which the plan's react-testing approach calls for. They are dev-only and not bundled.
  - The critic checks the lockfile change and that no install scripts were added.
- **D4-81 (w2/reference-9 round 12 @36ea10e, at the cap): D4-63 needs a scheme change, and the candidates are ordered.**
  - Under D4-79's long-run rule the contract case **grows for real**: L2(p′) 1.27× at 2000, 4.36× at 10k, 5.39× at 15k; weighted residual 3.55 at 100, 8.73 at 10k, 10.0 at 15k.
  - The growth sits in the far-field interior and the plume blocks, where the app's coupled field will be near rest. So it blocks W3, and no change to the rule's window can close it.
  - The local time-step limit (round 12's screen) tracks the baseline, so it is not adopted. **Its scratch patch is still applied, uncommitted, in the worktree's src: the next round reverts it first.**
  - **Next round, all under the D4-79 rule** (20k-iteration runs; every currently passing row still passes; R is excluded because it is the sharp limiter's known floor, pinned):
    1. a plain-scheme long run of the contract case, to confirm the preconditioning is the source;
    2. a **global M_cut tied to the domain's peak velocity** (the standard Weiss-Smith/Turkel floor; D4-59's rationale), tried at 0.02 then 0.05. D4-59 found 0.02 kept every other row passing (L7 ratio 1.78 ≤ 3, L8 0.754%). It was rejected there only on R's convergence, which D4-55/D4-58 later traced to the limiter, so that criterion was wrong for R;
    3. only if both fail, come back with data for a deeper change.
  - The kernel mirrors the adopted M_cut, as a parameter: D4-40's adapter default.
- **D4-82 (critic pass 12 question rr, PARTIAL pass): a flow field carries an explicit coupling state,** `'mock' | 'uncoupled' | 'coupled'`. This is a minimal, flagged contract addition.
  - The badge and legend say "solver (uncoupled until W3)" while the solver runs without body forces or combustor sources.
  - A runtime MOCK fallback, used when the solver is unavailable, lost or diverged, is part of the app shell's contract: visible, never silent.
  - This closes W2V-I1 and W2V-I6.
- **D4-83 (question ss): Realistic mode has no tracers by default,** because the cinematic product view read them as hair. Its subtle haze and schlieren stay, and tracers remain available as an option and on by default in the Cutaway/Data modes.
  - The near-field crop gets a crisp edge with a thin outline instead of a fade. This also removes the purple fog the fade made around the engine in the cut modes.
- **D4-84 (w2/app-ui round 2 @f6ee8e2, decision 1): a held gas path must stay inside the frame budget; the fix bounds the retry, and the D2-4 worker layout stays.**
  - Measured in the worker (Chrome at 1.5x, shared machine, indicative): a held step on the part-power fit's 1 s lever ramp costs 411-602 ms (median of three runs), against 1.7-3.6 ms for a matched step. Held frames run at 414-605 ms, 8-31 fps. The default reference model had 0 lost solves on the same ramp, so this bites on the part-power fit or a hard transient.
  - **Adopted:** (b) the held retry gets a CPU budget per step and resumes on the next step, so the frame always holds 16.7 ms; and (a) the full halving walk runs at most once per 0.5 s of sim time, with the direct solve tried each step. The held state stays visible (W2F-I1's cause, the annunciator), never silent.
  - **Not adopted now:** (c) the cycle in its own worker. It changes D2-4's single sim-plus-render worker and isn't needed once (a) and (b) bound the cost. It comes back only with data that (a) and (b) can't hold the budget.
  - It doesn't block the app-ui merge (the default model doesn't hold on the ramp). It is a cycle follow-up round in W2, TDD, with the held-frame cost re-measured as a browser-suite row: held frame ≤ 16.7 ms on the same ramp.
- **D4-85 (decision 2): the canvas is capped at 1080p-equivalent pixels for quality up to high; ultra keeps the full DPR.**
  - At Chrome's 1.5x scaling, 1920×1001 rendered 4.3 MP, 2.1 times P4's 1080p, and the engine render measured 27.9 ms on the shared machine, leaving D4-2's solver at its 2-iteration floor.
  - P4's budget (render ≤ 8 ms) is pre-registered at 1080p, so the app renders the pixels P4 measures: the backing store's pixel count is capped at 1920×1080 (2.07 MP) and the canvas is upscaled. Sharpness trades for frame rate, and ultra is the explicit opt-in.
  - It goes into app-ui's next round, with a unit test on the cap and the measured render time recorded beside P4.
- **D4-86 (decision 3): W2V-N21 is raised to important (W2V-I7).** At ground idle almost the whole Data plane is the colormap's darkest end (Mach ≈ 0 outside the nacelle), so the Data view reads as a purple board. The ambient region must read as quiet, not as a colour field: a neutral or transparent floor below a small threshold of the field's own range, or a range from the near field rather than the whole plane. It's flowviz's code; it goes to a small flowviz round with a screenshot before and after, and it doesn't block the app-ui merge.
- **D4-87 (critic pass 13 question tt): a surge margin taken below the map's lowest speed line is shown as an extrapolation, not as a caution.** At ground idle the fan's corrected speed is below the map's 60 % line, so the cycle model's 3.6 % is extrapolated off the map. The UI shows it dimmed and tagged "below map", with no amber, whenever the operating point is below the map's lowest speed line. Amber and red apply only on the map. This holds until the map backlog (D4-3) extends the fan map down to idle. The idle operating point must still be visible on the fan map (W2A-I2): the chart's range includes it, or it sits at the edge with an off-map marker. It's app-ui's next round, TDD.
- **D4-88 (question uu): the engine view owns pipeline warm-up, and the app shell calls it.** EngineView gets a `warmUp()` (a flagged render edit) that compiles every mode's pipelines, including the flow layers, before first use, e.g. a `compileAsync` per mode plus one offscreen frame of each flow layer. The worker calls it behind the boot spinner and reports `ready` only after it. The browser suite's shots wait for a settled-view signal from the snapshot, not a fixed 1.5 s (W2A-I4). Both go in app-ui's next round, with the first switch into Schlieren and Cutaway measured before and after.
- **D4-89 (w2/reference-9 round 13 @d05e16d, plus the orchestrator's owed runs): the global M_cut 0.02 is adopted, and D4-63 is closed on the CPU reference.**
  - **The source:** the plain scheme decays on the contract case. (a) is 0.366 at 1000-2000 and 0.043 at 20000. (b) is 0.641 for 20000 over 10000 and 0.159 for 20000 over 100. So the growth was the preconditioning at M_cut 0.003.
  - **The fix passes every D4-79 row on both cases:**
    - the contract case at 0.02: (a) 0.778 / 0.488, (b) 0.524 / 0.223;
    - the linear part at 0.02 (run detached in the cap pause at d05e16d): (a) 0.506 / 0.0555, (b) 0.596 / 0.302, peak max |p′| 7.75 < 100.
  - **Rule 2 holds:** every ladder row that passed at 0.003 still passes at 0.02 (8447e99: L7 ratio 1.779 ≤ 3, L8 0.754 %, f32 12/12, floor 4/4). The 3 known failures are unchanged (L8 convergence, L9a, L9b). test:mesh passed 29. 0.05 was not needed.
  - **Recorded, not gating:** on the contract case the late decay at 0.02 is slow. L2 holds at 0.48-0.51 over 13k-20k, and the residual sits at 0.33-0.42 over 15k-20k, rising 0.35 → 0.40 over the last 1000. D4-79's checkpoints pass, but they don't show decay over 15k-20k, and the 10k checkpoint is a local high. The kernel round reports the GPU's residual trend to 20k at 0.02. If it grows past 20k, D4-63 reopens with that data.
  - **The mirror (kernel round, w2/solver):** D4-40's adapter default in `src/flow/gpu/device/flowSolver.ts` becomes minMach = M_cut = 0.02, as a parameter. The kernel already takes minMach² and machCut. The GPU tests move from 0.003 to the cut, and their D4-62 / D4-71 tolerances are re-checked.
  - The adoption commit came before the ladder confirmed it (round 13's note). The ladder then passed, so nothing reverts.
- **D4-90 (w2/cycle-hold @f7338c0): D4-84's bounded retry answers.** On the part-power fit's ramp, a held step falls from 439 / 554 / 643 ms (median / p95 / max) to 2.39 / 2.97 / 4.45 ms in Node, at 120 gas-path evaluations per step.
  1. **The bar becomes P5,** a flagged contract addition to `thresholds.ts` and a PHYSICS.md row. The gate is deterministic, in Node: on the fit ramp every step that starts held costs ≤ 137 gas-path evaluations, and every step ≤ 217. The browser's held-frame wall time (≤ 16.7 ms) is recorded beside it, and it counts only in an official quiet run, like P1 and P4. The cycle-hold branch adds the row before its review.
  2. **The sub-idle entry is accepted for W2.** It costs 448-654 evaluations, 19-59 ms, once per start or relight, on a frame that ends matched. That's a single hitch at an event, not a held stream. W3's start scenario revisits it with a better entry anchor, with no new status or contract change now.
  3. **The later recovery is accepted:** 3.37 s against 2.97 s in episode 1. D4-84's 0.5 s walk interval stays, since the budget bounds the frame either way.
  4. **Spool runaway while held is raised as W2H-I1 (important).** It's existing D4-17 behaviour, not from this branch: on the fit's second episode the solve never recovers, and N1 reaches 260-275 % on the held power balance. A held point must not integrate the spools past their limits on a stale balance. It only bites on the part-power fit, which is on the backlog (D4-2), and the default model doesn't hold on the ramp. So it doesn't block the cycle-hold merge, but it must be fixed before the fit ships, in the part-power round with the fit's never-recovering episode. Until then the app annunciates a held gas path, and the critic checks the default model can't reach it.
- **D4-91 (w2/app-ui round 3 @ff95d99 and critic pass 14's questions): the warm-up is made progressive, and two UI levels are pre-registered.**
  1. **Boot:** D4-88's warm-up moved the first-switch stall into boot. The first switch now takes 52 ms into Schlieren (was 1323-1581) and 70 ms into Cutaway (was 421-2818), but boot-to-ready is 10-26 s (was 2.4-4.7). About 80 % of that is the GPU process compiling Cutaway's pipelines. **Adopted: a progressive warm-up.**
     - The worker posts `ready` once the default mode (Realistic) is compiled.
     - The other modes warm in the background, Cutaway and Schlieren first, at most one configuration per frame-budget slot.
     - A switch into a mode not yet warmed shows a visible "preparing view" state, never a freeze, and switches as soon as the mode is ready.
     - Bars, indicative on the shared machine: boot-to-ready ≤ 5 s, and the first switch into a warmed mode ≤ 250 ms.
     - An async compile through three's internals and fewer cut-view pipelines are not adopted now. They come back only if the background warm-up can't keep up.
  2. **Schlieren's lit-centre check:** skipping it is accepted only with a Schlieren-specific content check in its place. For example, the knife-edge image's luminance varies across the jet and nacelle region instead of being uniform. The true view draws the engine as a dim silhouette, so a lit centre is the wrong test there.
  3. **UI levels, pre-registered in PHYSICS.md's UI rows:** surge margin amber below 5 % and red at or below 0, on the map only (D4-87); the first switch into a warmed mode ≤ 250 ms; boot-to-ready ≤ 5 s (both indicative; official only in a quiet run).
  4. **(vv):** a non-holding direct solve keeps being charged against the step's budget. P5 bounds a step's total work, which is what the frame budget needs, and on the fit ramp those cuts were genuine losses. P5's limits stand.
  5. **(ww):** yes. Critic pass 15 finishes pass 14 (A's remaining gates and mutants; B's verdict, its mutants and the default-model sweep for W2H-I1), and reviews app-ui round 3 in the same combined trial merge.
- **D4-92 (critic pass 15's questions; w2/reference-9 and w2/app-ui round 3 merged on main ca0a3aa): W2H-B1 is fixed by bringing W2H-I1 forward, under a pre-registered recovery bound.**
  - **(xx):** in critic 15's scenario, the bounded retry holds 4.1-7.9 s on the **default** model, with N1 reaching 168-218 %. The scenario is ISA SLS, take-off, Surge at 10 s, Flameout at 20 s, the auto relight, at dt 0.020-0.025 s. Main and `UNBOUNDED_RETRY` hold ≤ 0.15 s. So D4-90's condition for deferring W2H-I1 is false. Cycle-hold round 2 does three things:
    - (a) While held, the spools don't integrate on the stale held power balance. The honest held state invents no shaft acceleration from an unsolved gas path.
    - (b) A recovery bound, pre-registered as a test row before the fix: in that scenario on the default model, every held episode recovers within 0.5 s of sim time at every frame step from 1/120 to 1/30 s, and N1 never passes its redline while held.
    - (c) Only if (a) alone can't meet (b): a hold past 0.5 s escalates once per episode to D4-13's full walk. That's a bounded one-time cost, recorded beside P5 as an exception the way the sub-idle entry is.
  - W2H-I3 (a surge started from a held point, P3 NaN at ISA+30), W2H-I2 (a resumed solve's remaining iterations), mutants B1, B2 and B4, and N1-N6 go in the same round.
  - D4-90's acceptance of a later recovery covered the part-power fit, not 4-57× longer holds on the default model.
  - **(yy):** app-ui merged first (done). Cycle-hold round 2 merged main and kept its own `model.ts` lines (a superset of app-ui's W2A-N6 fix) and both tests.
  - **(zz):** yes. App-ui round 4 takes:
    - D4-91's progressive warm-up;
    - W2A-I6, a Schlieren-specific content check;
    - callouts re-anchored, so the Fan label points at the fan face, with the cut views' labels placed outward in axial order so they label their parts instead of reading as a list;
    - N13, the callout search's pruning;
    - Schlieren's plume clear of the right-hand panel column.
- **D4-93 (w2/kernel @b777653..c1a4d97): D4-89's mirror holds on the GPU, and two test-measurement fixes follow D4-74's rule.**
  - **GPU at the 0.02 cut, D4-63's contract case:** (a) 0.778 / 0.486, (b) 0.491 / 0.211. It keeps decaying past 20k: the weighted residual is 0.382 at 20k, then 0.288 / 0.184 / 0.159 / 0.150 at 25k / 30k / 35k / 40k. **D4-63 stays closed on the GPU.**
  - W2R-I19's tightened rows pass: E-L5 2.67e-8 ≤ 3e-7 and E-L9a 2.46e-12 ≤ 1e-10. B ≤ 2e-10 is pending in the gpu-ladder log.
  - **W2L-I6:** the warp test missed 0.6 by 0.001 (0.601), limited by disocclusions at the blade edges, which no vector can predict. The measurement is fixed, not the bar: disoccluded pixels are excluded by a forward-backward consistency check, and 0.6 is kept against zero, flipped, half and 1.5×.
  - **W2L-I8 / D4-74:** the cutaway preset sat at its bound in expectation (35.75 against 36) at any N. The band at the cut faces (caps plus one tile) is excluded from the floor and moving counts, with MARGIN unchanged and the rationale stated.
  - **D0-1 amended:** official P-runs also need Chrome holding the OS focus, so that D3-6's blur rule can fire (W2L-I7 / D4-73). The rest is unchanged: AC, no agents, nothing else on the GPU, display awake.
  - The `--flow` capture is the tool for the official P4 with the flow on. Indicative so far: Cutaway with tracers 9.53 / 10.34 ms and Realistic 8.07 / 7.82 ms (vsync / back to back).
  - **Next:** a fresh kernel round 3 runs the two fixed tests in the browser, writes SOLVER.md 15.3, merges main with an `ENGINE_MACH_CUT === GLOBAL_MACH_CUT` test, and runs the six gates. Then the critic reviews it.
  - B also passes at the cut: 1.266e-11 ≤ 2e-10. Its velocity check is 1.95e-5, under 10× the oracle's 1.49e-5. The gpu-ladder run was 13 passed + 1 expected fail, at b777653.
- **D4-94 (w2/cycle-hold round 2 @801bbba): D4-92's fix confirmed, and two guards on the matched root.**
  - **Result:** in critic 15's scenario on the default model, the longest hold is now 0.25-0.36 s at every dt from 1/120 to 1/30, at ISA and ISA+30. Before, it was up to 7.88 s with N1 at 218 %, and ISA+30 threw at 25.46 s.
  - **Spools:** (a) as a freeze was tried and fails, because the relight's entry has no root reachable from the anchor with the spools frozen, so it holds about 12 s. The spools therefore follow D4-17's held balance, bounded at their redlines. (c), the escalation, was needed.
  1. **`ESCALATE_AFTER_S` = 0.25 s is confirmed.** D4-92's "past 0.5 s" can't meet a ≤ 0.5 s bound counted in whole frame steps, and half the bound leaves room for the escalated walk's own snapshot. The escalation costs 3,100-4,400 gas-path evaluations (50-240 ms in Node) once per episode. It is the recorded exception beside P5, like the sub-idle entry.
  2. **Two guards on the matched root, adopted.** The mechanism behind B1 and I3 is a non-physical matched root. After a long hold, the matched path followed a branch where the booster cools the flow (T25 below T2 by up to 61 K at ISA and 82 K at ISA+30), and `attempt()` accepts it, because it checks only the residual and BPR > 1. At ISA+30 that branch reaches an HPC corrected speed of 1.22, where `hpcCubic`'s fit is degenerate (H < 0), and a surge from that matched point integrates to NaN.
     - `attempt()` refuses a root with a compressor total-temperature rise ≤ 0 across any compressor, as BPR ≤ 1 is refused, with a named cause.
     - `hpcCubic` rejects H ≤ 0 with a named error instead of integrating.

     Both change what the matched path accepts, so the next round is TDD, and the fingerprint probe must show the matched-path hashes unchanged on slam-chop, c12, start and part-lever. A changed hash comes back with the scenario and the refused root. The surge-start guard (a surge starts only from a solved gas path) stays: it is right, even though it wasn't the cause.
  3. **W2H-I1 on the part-power fit stays on the backlog.** N1 is now bounded at 104 % instead of 260-275 %, but episode 2 still never recovers. The part-power round owns it.
  4. **D4-92 (b)'s recovery bound becomes a P5 row (P5b),** a flagged contract addition: on the default model in critic 15's scenario, every held episode is ≤ 0.5 s at every dt from 1/120 to 1/30, and N1 ≤ redline while held. `heldRecovery.test.ts` reads it from the contract.
  - **The next round (cycle-hold round 3):**
    - the two guards;
    - P5b;
    - mutants B2 and B4 (N6);
    - fast tests of the surge-start condition and the redline clamp;
    - N1-N5;
    - the fingerprint probe;
    - full coverage, test:mesh and the targeted Stryker run.

    Then the critic reviews it.
- **D4-95 (w2/app-ui round 4 @46310e5 and w2/flowviz round 4 @7dac273): the warm-up's open items, and the flow-floor follow-ups.**
  - **App-ui round 4's result:** D4-91's progressive warm-up brought boot-to-ready from 10.8-12.7 s to 3.9-4.4 s on a quieter run (U3 ≤ 5 s). Four items remain:
  1. **U2 (first switch into a warmed mode ≤ 250 ms) failed when a background warm frame landed in the switch window.** Cutaway measured 706 ms on the quieter run, and both modes 133-636 ms loaded. Background warming is suspended around user input and mode switches: no warm slot while a switch is pending, nor for 1 s after any input or switch. U2 stays at 250 ms.
  2. **Schlieren's warm frame stalls the GPU process once for 0.65-1.1 s,** while the worker's CPU for that frame is a few ms. Something still compiles synchronously at first draw; the render owner finds it in the next app-ui round (e.g. a lazily created pipeline the warm-up doesn't reach). If it isn't found in that round, Schlieren is warmed at boot, provided boot stays ≤ 5 s in a quiet run. Accepting the hitch is not adopted.
  3. **The background warm-up is slow under load:** 17-34 s to Cutaway ready, because a slot needs the previous frame under 8.3 ms. That's indicative on a shared machine. It's measured in a quiet run, and the slot rule isn't loosened now.
  4. **The warm-up relies on pinned three r186 internals.** A unit test pins the internals it uses, so a three upgrade fails CI before it fails at startup. The startup throw stays as the second line of defence.
  - **Flowviz round 4:**
    - its additive edits to app-ui's `src/ui/dock.tsx` and `src/ui/global.css` (the legend's floored band) merge with flowviz. App-ui's next round merges main and adopts or moves them;
    - the Mach and speed floor is measured from rest, because `FieldReference` has no flight speed. W3's flight conditions add it to the contract.
  - **The indicative flow-visuals timing row failed in both builders' browser runs:** tracers at 1080p measured 3.27-3.44 ms against 2 ms, with both builders using the GPU at once. It's indicative. The critic reruns it on the trial merge with nothing else on the GPU. If it still fails there, it's a regression to find, not a bar to move.
  - **Flowviz's coverage run had one timeout** (`floor.test.ts`'s take-off case, at vitest's 5 s default, on the loaded machine). Like the other model-heavy tests, it gets an explicit timeout; that isn't a threshold.
- **D4-96 (critic pass 16's questions; w2/kernel, w2/cycle-hold and w2/flowviz round 4 merged on main 3a99b7c): the follow-ups.**
  1. **W2L-I9:** in the default cutaway pose, the cut-face band excludes every tile that tells TRAA's legacy pipeline from the shipped one, so that pose's row can't fail, which in effect widens the bar (D4-74). **Adopted:** a narrower band (the cap pixels only, without the extra tile ring) with **its own failing control in every banded pose**. Only if no band lets the control fail while the shipped pipeline passes is the default cutaway pose taken out of the moving bound, with the reason stated. The close-up keeps its control, which still fails with the band.
  2. **W2H-I4: confirmed.** W2H-I1 stays open on the part-power fit; the fit's recovery doesn't rely on N2, and the "physical root" claim is withdrawn (the step after recovery is still on the booster-cooling branch). The part-power round also bounds the held spools from below: N2 falling from 98 to 57 % on a held balance is as non-physical as the runaway.
  3. **N3: adopted.** P5's check text states its window ("23 s from ground idle: 3 s at idle, the 1 s ramp, then the take-off lever"). That names the window D4-90 measured; the bar doesn't change. It's a flagged contract text edit.
  4. **The indicative flow-visuals timing row** (tracers at 1080p ≤ 2 ms) failed three times under another builder's concurrent GPU work: 3.27, 3.44 and 2.95 ms. Quiet, it measured 1.20 ms (critic 16). The iGPU shares power with the CPU (D0-1). It now records on every run and fails the suite only with the quiet flag, as app-ui's N16 did for the UI timing bars. The measure of record stays the official P4 / P4flow run, and the bar doesn't change.
  - **Also in the follow-ups round:**
    - W2K-I1: restore `spikes/README.md:77`'s D0-1 checklist line, lost to a `$1` artefact, before the next official window;
    - W2V-I8: a GPU test of the T floor centred on T∞ (critic 16's 0 K mutant passes the suite today);
    - the inferno ΔE comment (CIEDE2000 6.6-8.3, a visible band);
    - K4: a GPU test of a global M_cut ≥ 1.
  - App-ui rounds 4-5 (@0f3b21e) go to critic pass 17. They adopt flowviz's dock/legend edits when they merge main (D4-95).
- **D4-97 (critic pass 17's questions; w2/app-ui rounds 4-5 merged on main 8216c83, the tree equal to the critic's trial17).**
  - **The merged app**, indicative on AC: boot-to-ready 3.85-4.28 s (U3 ≤ 5 s); the first switch into a warmed mode 72-81 ms, also while the queue warms (U2 ≤ 250 ms); Schlieren's warm frame 8 ms (it was 645-706 ms); all nine configurations warm 7.0 s after ready.
  1. **W2A-I7: a cold switch gets a time limit.** A switch into a view that isn't warmed takes a warm slot after at most 60 frames of preparing, whatever the last frame's CPU, and the give-up counts the frames waited. Pre-registered as **U4: an unwarmed switch shows its view within 2 s at any steady frame CPU** (indicative; official only in a quiet run). The critic's 10-minute probe at a steady 8.4 ms and 11.2 ms frame becomes the test. Skipping the CPU rule outright for the asked view isn't adopted: the 60-frame bound keeps the frame budget the default.
  2. **W2A-I8: the 1366 cut views dolly the camera out to make room for the label rows,** as Schlieren's framing does, with a minimum engine scale stated beside U1-U3. Only if the minimum scale can't fit the rows are labels shown by a stated priority (fan, combustor, HPT, LPT, exhaust first). D4-92 (zz)'s axial rows then hold at both sizes.
  3. **W2A-I10 confirmed: W2A-I6 stays open.** The Schlieren signature is computed on the canvas alone, never the page screenshot with its overlay, and each of its three bars gets its own failing control: S1 (knife edge off), the Cutaway frame and the Data frame. That's the same rule D4-96 set for the cut-face band.
  4. **Cutaway's own warm frames are accepted as measured:** 47 frames at ≤ 41 ms each, about 2 s, once per session. They're recorded as an indicative row beside U2/U3, with the background warm-up's own row (all nine configurations warm, in seconds after ready).
  - **App-ui round 6:**
    - D4-97 items 1-4;
    - W2A-I9, the warm frame zeroing the next frame's camera motion (`post.ts` restores `prevViewProj` but not `currViewProj`, about two lines, with a test that a warm frame leaves the next frame's motion vectors intact);
    - the nits N21-N28, including N26 (TRAA `updateBefore` state outside the guard) and N27 (`post.ts:605` citing M56, now M57).
- **D4-98 (w2/app-ui round 6 @d267488 and w2/followups-2 @d2750c5): U4's fix, and the fit's intermittent throw.**
  1. **U4 isn't met, so the fix is to the scheduling, not the bar.** A cold switch now always resolves. Before, it never did above an 8.3 ms frame; now it takes 3.10-3.19 s at a steady 8.4 or 11.2 ms and 1.95-2.53 s at a light CPU, against U4's 2 s. The time is the 60-frame wait plus the view's own 45-47 warm frames at one every 2 frames. **Adopted:** the wait shortens to 30 frames, and after it the asked view warms every frame instead of every second frame. The user is already waiting on "Preparing", so the frame budget is the cheaper thing to spend. That gives about 30 + 47 frames, roughly 1.3 s at 60 Hz. U4 stays at 2 s; it isn't restated.
  2. **The part-power fit's intermittent throw becomes W2H-I5 (important):** "enthalpy 4475806.6 is outside the range of [200, 3500] K" stopped the sim once in the browser's held-frame test on the fit. The gate run passed it.
     - It's the same family as critic 16's W2H-I4: the sub-idle model throws after a held balance has dragged N2 down.
     - It's intermittent because the browser test steps the sim with real frame times.
     - The browser test steps on a fixed dt, so the gate is deterministic.
     - The cause goes to the part-power round with W2H-I1/I4. Until then the app shows SIM STOPPED (W2A-I1), which is visible, never silent.
     - The default model can't reach it: critic 16's sweeps found no throw.
  3. **The Schlieren grey-share bar at 0.7** was set after seeing the framed cut views (0.50-0.55) and the shipped Schlieren (0.84-0.90). It tightens the bar (it was 0.3), and every control fails its named bar. It's accepted, with the data stated in the test, and the critic judges its margin.
  4. **The test-only `debug` worker message** (frame-CPU padding, the knife edge) is accepted. It isn't in `src/contracts` and doesn't count as viewer input. The production build must ignore it (the critic checks).
  5. **The display rules are accepted:** the callout priority follows D4-97, and in the cut views a label with no room in its row is hidden, never placed on the section.
  - **App-ui round 7 (small):**
    - item 1 (U4), with the Chrome cold-switch times at a steady 8.4 and 11.2 ms;
    - the fixed-dt held-frame browser test (item 2);
    - the visual notes: the 1366 drawer shot's long leader; Schlieren's left margin at 1920; Exploded under the right column; flowviz's crop outline crossing the cut views like a leader (W2V-N25);
    - N23.

    Then critic pass 18 reviews w2/followups-2 and app-ui rounds 6-7 together.
- **D4-99 (critic pass 18's questions; w2/followups-2 and w2/app-ui rounds 6-7 merged on main ca4f870, src and tests equal to the critic's trial18).**
  1. **U4 on AC is measured in the quiet window,** together with the official P4flow and the P1 rerun: `firstSwitch.test.tsx` alone, quiet, at light, 8.4 and 11.2 ms, with the D0-1 conditions (AC, no agents, nothing else on the GPU, display awake, Chrome focused). The orchestrator runs it with Aaron. Until then U4 is recorded as unproven on AC. On battery it measured 1.42-2.20 s, straddling the bar, so it's called neither a pass nor a regression.
  2. **U4's condition is scoped to frames within the budget:** "at any steady frame CPU up to 11.2 ms (tested)". A frame over 16.7 ms already breaks P4 and D4-2, so a 2 s cold switch can't be promised there. Above about 16 ms the frame count alone exceeds 2 s. The bar stays 2 s, and the scope names the envelope the app is built for, not a looser bar.
  3. **A final W2 polish round** (w2/polish from main):
     - W2A-I11: Exploded is framed on skins it doesn't draw (the inlet lip's outside and the bypass duct in `explodedRings`), so it sits off-centre and 17-21 % smaller than the area allows. Frame it on the drawn parts, and add a Chrome check that the framed views land inside the free area (that is N31);
     - N29: a cold view's carry-over;
     - N30: the Schlieren grey band contains the studio grey. Note that the grey share isn't load-bearing for Exploded, or narrow the band;
     - the Schlieren Core exhaust label sits on the jet;
     - W2V-N26: bound the W2V-I8 floor from below too, so mutant V2 dies;
     - W2H-N10: the fixed-dt record runs 24 s against P5's stated 23 s window, so align it.

     **Camera easing** into framed views goes to W4's motion polish, not W2.
  4. **W2L-N16's fallback, confirmed in advance:** if the default cutaway pose's legacyTraa control ever passes, that pose leaves the moving bound with the reason stated. The band is never re-tuned to make it fail again (D4-74).
  - The three UI changes beyond the brief are kept: the legend at 440 px, and Schlieren and Exploded framed above the dock. The 1366 cut views' ~8 px of slack is accepted, since a taller dock only hides labels by priority.
- **D4-100 (the W2 official window, 2026-11-01 01:11-02:10 EDT, on local main 469164a: followups-2 and app-ui rounds 6-7 merged, not yet pushed): the official results and what they change.**
  - **Conditions:** D0-1 as amended (AC 85-100 %, Balanced, no agents, the display held awake by the scripts' execution-state request, Do Not Disturb, Chrome focused). Records committed as written: `docs/bench/p1-2026-11-01-0127-official.json`, `docs/look-dev/timings.json`, `docs/look-dev/timings-flow.json`. The untracked `docs/bench/p1-2026-10-28-2158-quick.json`, an old quick run, made `gitDirty` true; it's noted, not deleted.
  - **P4: PASS at 6.66 ms back to back,** the measure of record (D4-42). All 24 runs valid, GPU busy 71 %. Beside it: cutaway 7.70, hero 10.77, performance 5.16 ms, and vsync default 11.88 ms (reported, not gated). The first attempt timed out on the look-dev page's first load (vite re-optimizing after the merges) and was rerun after a warm load.
  - **P1: PASS at 180 it/s** (1.332 ms/it, 60.0 fps) in the app's 1080p scene at 130k (D4-64). It was 157 it/s.
    - Caveat: P1 times iterations and doesn't check the field.
  - **U4 (cold switch ≤ 2 s) FAILS on AC:** 2.456 / 2.558 / 2.509 s at light / 8.4 / 11.2 ms. U3 holds (boot 3.45-3.53 s), and the longest gap while preparing is 108-145 ms. The 56-57 warm frames each take longer than a frame slot.
    - **Fix, for the polish round:** the asked view warms several configurations per frame while preparing. There's room: the gap is ~140 ms against the test's 1000 ms bar. U4 isn't restated, and "Preparing" must never freeze, so the gap stays ≤ 1000 ms.
  - **P4flow: no valid run, and a new blocker, W2S-B1.**
    - In the look-dev page, the uncoupled GPU solver diverged: "the density residual is NaN after 6759 iterations", about 1 min at 2 it/frame, at the end of the first run. Every later run drew the MOCK fallback, since a failed solver isn't restarted.
    - The app shows that visibly, but the real solver doesn't survive a minute in the app scene on current main. The GPU contract cases (D4-63's d463 at 0.02, decaying to 40k) didn't catch it.
    - **Next, top priority:** a builder reproduces it headless (Dawn, the 130k asset, the app's GpuFlowSolver config and FLOW_SOLVER_LIMITS, 10k+ iterations), bisects 0.003 against the 0.02 cut (D4-89's mirror) and anything else since solver-int, then finds the cause, fixes it TDD, and adds a long-run GPU test of the app's own configuration.
    - P4flow and P1's field health are re-measured after the fix, in the next quiet window.
  - **The merge gate on 469164a:** the browser suite timed out twice at 120 s, on `fanBlur` (W1L-I3) and `rotorMotion` (W1V-I1 b, made heavier by followups-2's per-pose controls), in the full suite on a quiet AC machine. Every assertion passed. The polish round gives both explicit longer timeouts or splits them (test plumbing, not a bar; D4-95's precedent). Main is pushed once the browser gate is green.
- **D4-101 (critic pass 19's questions; w2/solver-diverge and w2/polish merged on main 2e262af, src and tests equal to the critic's trial19).**
  1. **SOLVER.md §5's outflow backflow branch is ratified.** A backflow face (vn < 0) takes the inflow ghost at the ambient totals (p_out, T∞), with no swirl and Z = 0, at the speed set by the cell's outgoing characteristic. That's the standard pressure-outlet backflow.
     - The oracle and the kernel are identical, and faces with vn ≥ 0 are bitwise unchanged (E-L5 2.67e-8 and E-L9a 2.46e-12, as of record).
     - The critic reproduced W2S-B1 on the pre-fix main (non-finite first at iteration 6756, block 5 core). The long-run test fails without the fix, and the CPU outflow rows L4a, L4b, L5, L9a and L9b equal their records.
     - **D4-63 decays faster on both** with it:
       - CPU (a) 0.4450 / 0.009223 and (b) 0.1535 / 0.03063;
       - GPU (a) 0.4450 / 0.008997 and (b) 0.1634 / 0.03253;
       - the weighted residual now falls steadily over 15k-20k, so the slow late decay D4-89 recorded was this outflow feedback.
     - W2S-N1 (the backflow at p_out ≠ p∞ is untested; mutant A3g survives), N2 (§5's continuity wording) and N3 (the backflow totals in flight) go to the next solver round, which is W3's flight conditions.
  2. **W2S-I1 is pre-registered and goes to a scheme round before W3's coupling.** At the engine's cut (0.02) and the default preconditioned CFL 0.8, the f64 oracle goes non-finite within 5-100 iterations on a hot gas pocket (900-1200 K) moving at 100-300 m/s in a 960-cell duct, with or without a wall. The plain scheme and CFL 0.4 stay bounded. The case (`docs/reviews/probes/w2s-hot-pocket.probe.ts.txt`) becomes a ladder row that must stay finite and bounded. Its fix (a step limit or a positivity treatment, chosen with data) comes before the combustor puts hot gas into the field.
  3. **`COLD_SWITCH_WAIT_FRAMES` = 0 is ratified, superseding D4-98's 30-frame wait.** The wait bought the viewer only ~0.5 s of smooth old-view animation, a quarter of U4's 2 s, and a snapshot is now posted every 3 frames or after 50 ms, so "Preparing" never freezes. D4-97 declined skipping the CPU rule outright; the per-frame cap (`PREPARE_FRAME_CPU_MS` 200) is the bound that keeps it. W2A-N33's wording (U4's check text names the cap and the snapshot rule as the stop conditions) and N32 (the snapshot rate at 25-50 ms frames) go to the next app-ui round.
  4. **The screenshots are re-shot on merged main at the display's own DPR (1.5),** in the merge gate's browser run with the display held awake. The builder's ratio-1 set is not committed.
  5. **Every detached browser run holds the display awake** with `SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED | ES_DISPLAY_REQUIRED)`, for builders, critics and the orchestrator alike. It changes no setting and ends with the process. A slept display drops Chrome to DPR 1 and slows it about 10×, which voided critic 19's first browser run.
  - **Next:** push main once the gates on 2e262af are green. Then the quiet window's official set on that main: U4 alone with the quiet flag, P4flow after a warm load, and P1 for the field health (D4-100's re-measures).
- **D4-102 (the second W2 official window, 2026-11-01 23:05-23:45 EST, on main c64da3c): D4-100's re-measures.** Conditions: AC 100 %, Balanced, no agents and no other test processes, display held awake, Do Not Disturb. Records as written: `docs/bench/p1-2026-11-01-2322-official.json`, `docs/look-dev/timings-flow.json`.
  - **U4 PASSES officially on AC, quiet.** A cold switch into Data showed in 1.551 / 1.523 / 1.801 s at light / 8.4 / 11.2 ms (≤ 2 s), with the longest gap 295-431 ms (≤ 1000). U2: Schlieren 56, Cutaway 98, a switch while warming 83 ms (≤ 250). U3: boot 3.66-4.65 s (≤ 5). So U1-U5 all hold on the merged app.
  - **W2S-B1 is fixed in the app scene too.** Every P4flow run drew the uncoupled solver field at its start and end, about 9,000 iterations per back-to-back run, with no divergence.
  - **P4flow and the P1 rerun are INVALID for focus (D4-73):** the first run blurred at 61 s, and Chrome then never held the foreground (nobody clicked into the harness's window).
    - P4flow, indicative only: Realistic (haze, no tracers) 6.75 ms back to back / 7.70 vsync, Cutaway with tracers 7.75 / 8.25; flow passes 0.34-0.58 ms; solver 3.5-4.3 ms at 2 it/frame.
    - P4flow is a reported row (P4 ≤ 8 ms gates the flow-off default, which passed officially at 6.66 ms).
    - P1 of record stays 180 it/s (D4-100, 01:27).
    - A valid P4flow record is owed to the next quiet window with someone present to click into the capture's Chrome once.
  - **Lesson:** during official runs the orchestrator spawns no console processes, which may take focus, and the D0-1 checklist's single click into Chrome needs a person present.

## W2 COMPLETE (2026-11-01, main c64da3c and this commit, pushed)

**Built, reviewed (critic passes 9-19, the santa-loop on the solver) and merged:**
- **The f64 reference solver** with the CPU ladder (L1-L9), and **the WGSL GPU solver** (3 dispatches per iteration, D4-44's β mirror, D4-89's M_cut 0.02 mirror). D4-63 (growth from rest) is closed on the CPU and the GPU, and decays fast since the outflow backflow fix (D4-101).
- **W2S-B1** (a NaN at 6756 iterations from a recycled outflow backflow) is fixed; the app's own rest start was always an exact zero.
- **Look-dev 4-5** with the LOD (P4).
- **Flow visuals:** particles, cut plane, schlieren, heat haze, glow, legend, the coupling state with a visible MOCK fallback (D4-82), and the Data plane's ambient floor (D4-86).
- **The worker app shell and the UI on the real cycle model:**
  - the engine display and the throttle quadrant;
  - the fan and HPC maps with "below map" (D4-87), T-s and the station strip;
  - callouts at their drawn size in axial rows;
  - the progressive warm-up (D4-91/D4-95/D4-101);
  - faults on screen, diagnostics, and What's simulated;
  - the RTL and browser suites with a layout bar.
- **The bounded held retry** (P5, P5b; W2H-B1 fixed).
- **The cycle and bench follow-ups.**

**Official numbers (D0-1):**

| Row | Result |
|---|---|
| P4 | 6.66 ms back to back (≤ 8) |
| P1 | 180 it/s at 130k in the app scene (≥ 150) |
| U4 | 1.52-1.80 s (≤ 2) |
| U2 | 56-98 ms (≤ 250) |
| U3 | 3.7-4.7 s (≤ 5) |

**Gates on main:** 2395 unit tests passed + 11 expected fail (lines 99.55 %), mesh 29, gpu 72, gpu-ladder 15 + 1, browser 55.

**Open, carried past W2:**
- A valid P4flow record (needs a person to click into Chrome in a quiet window).
- **W2S-I1:** a hot gas pocket goes non-finite at M_cut 0.02 + CFL 0.8. It's pre-registered, and a scheme round before W3's coupling fixes it.
- W2S-N1..N3: the backflow at p_out ≠ p∞, §5's wording, the flight totals.
- The part-power backlog: W2H-I1/I4/I5 and the held spools bounded from below.
- W2A-N32/N33.
- Camera easing (W4).
- The cycle mutation backlog (D3-13).

**W3 (coupling: body forces, calibration, plume ν_t, the bake, physical time; audio; scenarios) waits for Aaron's review and go,** as W1 → W2 did (D3-2).

## W3 orchestrator decisions: 2026-11-02 (Aaron: "continue" after the W2 report)

- **D5-1 (W3 starts).** The W2 COMPLETE report asked for "go W3". Aaron answered "continue", which is taken as the go.
  - **Scope (the plan's):**
    - coupling: body forces, the calibration spike, L12, the plume eddy viscosity (L11), the bake and physical-time mode;
    - the engine sound;
    - the scenarios, with the cinematic tours.
  - **Brakes (as in W2, D4-7):**
    - usage cap 90 %; agents STOP-CLEAN at 84 %; no new agent at 78 % or more; a critic only below 60 %;
    - at most 2 agents, 1 while RAM < 2.5 GB or on battery, and STOP-CLEAN at ≤ 15 % charge on battery;
    - every detached browser run holds the display awake (D4-101 item 5).
- **D5-2 (W2S-I1 first: hot-pocket ladder row L14).** It is pre-registered in PHYSICS.md 3.3 before any fix.
  - **The fix is chosen with data** from D4-101 item 2's options:
    - D4-44 (b): the scaled diffusion's eigenvalue in the local step;
    - a local step from the hot cell's preconditioned eigenvalues;
    - a per-stage positivity guard on T and ρ, as the last resort.
  - **The global preconditioned CFL (0.8) may not be lowered** without a logged decision, because it sets how fast the engine field settles.
  - **W2S-N1..N3 go in the same round,** since they are the next solver round's items.
  - **Branch and review:** w3/scheme. The critic reviews it before w3/coupling starts, because coupling builds on the scheme.
- **D5-3 (order).**
  - **Slot A, the solver path:**
    1. w3/scheme, then critic pass 20.
    2. w3/coupling:
       - Hall-Thollet body forces with blockage on the compressor rows, and follow-camber turbine rows;
       - the combustor's heat and fuel source;
       - the calibration spike, which must converge in < 300 iterations without a limit cycle;
       - then L12.
    3. w3/plume-bake: L11's ν_t, the feedforward bake, the warm-start snapshots, and physical-time mode.
  - **Slot B, independent of the solver:**
    1. w3/audio: the engine synth driven by the cycle state.
    2. w3/scenarios:
       - start, takeoff, surge, and flameout with relight, across the cycle, visuals and audio;
       - D4-15's idle-floor settling, which the scenarios make visible;
       - the Theatre.js tours.
  - **The part-power backlog** (W2H-I1/I4/I5, and bounding the held spools from below) fills slot B after the scenarios, unless a scenario needs it first.
  - **The valid P4flow record** is owed to the next quiet window with Aaron present.
- **D5-4 (the engine sound's bars, A1-A6).** They are pre-registered in PHYSICS.md 3.6 before any audio code.
  - **Physics or exact:** the frequencies, the buzz-saw onset, the Lighthill scaling, the event gating and the safety rows.
  - **Synthesized on physical trends,** and labelled so in the fidelity ledger: the levels, the spectral shapes and the directivity patterns.
  - **Code layout:**
    - the pure parts live in pure modules under `src/audio` with ≥ 90 % line coverage: the source model from the cycle state, the oscillators, the spectra and the limiter;
    - the AudioWorklet glue is covered by the browser suite.
  - **Sound stays off until the viewer turns it on:** no AudioContext before a gesture.
- **D5-5 (w3/scheme's decisions 1-3, from its handoff at 92b98fd, SOLVER.md 17).**
  1. **The slip-wall ghost mirrors ρ′ and Z (adopted).** p′, ρw and the tangential velocity keep the extrapolation that L6 needs.
     - **Why:** extrapolating ρ′ and Z lets a flow leaving the wall drain fuel and entropy faster than the wall cell holds them (ρZ < 0, T′ below ambient). That drain:
       - fails L14's undershoot row on 5 cases and makes the 1.39 overshoot;
       - fails the GPU's at-rest case;
       - still takes the f64 engine runaway non-finite at 6770.
     - **Mirroring is the standard reflective treatment** of a scalar at a slip wall (zero normal gradient).
     - **The scratch trial's evidence:**
       - every L14 undershoot ≥ −0.007 ΔT, and the late overshoot gone;
       - the engine runaway finite to 7000;
       - the CPU rows run so far equal to their records, with L9a now passing D4-57's steadiness row (9.20e-6 against 1e-5).
     - **Adopted subject to** round 2 (TDD, oracle and kernel, SOLVER.md §5's wall row, the boundary unit tests), the full CPU and GPU ladders including L7 and D4-63 (CPU on AC), and the critic.
  2. **L14's peak row is restated against the run's own compression (amended in PHYSICS.md 3.3).** The 1.03 bar was set from the probe's 100-iteration sampling, which missed the start transient.
     - **What the row actually caught:** a hot slug set moving at 300 m/s into still gas decelerates, and its leading edge compresses: p′ ≈ 11 kPa at iteration 10, whose isentropic compression alone gives 1.034 × ΔT. The plain scheme, closer to the physical transient, peaks at 1.14-1.17.
     - **What the row is for:** catching a temperature the scheme makes, not one the physics makes. So each cell's T′ is now compared with the start's hot gas compressed isentropically to that cell's own pressure.
     - **Controls:**
       - the positivity-guard-only candidate (worst peak 2.645) must fail the restated row, or the decision comes back;
       - the plain scheme's value under it is reported.
     - **Unchanged:** the finiteness, end ≤ start and undershoot rows stay as pre-registered.
  3. **"At or better than its record" (D5-2) applies to converged (steady-state) values.**
     - **Values read at a fixed iteration or at a stopping tolerance** on a changed pseudo-time path must pass their own row's bar, and are reported beside their record.
     - **Why:** the step rule changes the iteration map, not the steady state. Such values then move both ways: L7's Cd and ratio got better, and its asymmetry got 1.6 % worse at the 1e-4 stop. Requiring every one of them to be no worse would forbid any change to the local step.
     - **Round 2 must show the steady state is unchanged:** L7 converged to 1e-6 with and without the rule.
  4. **J at M_cut 0.02** (backflow on 9 of 16 outflow rows, stalling at 0.6-0.85 of its peak) is diagnosed and reported in round 2 as W2S-N2's first suspect. It gates nothing now, but it matters for L11 (w3/plume-bake).
  5. **Order:** w3/scheme round 2 (a fresh agent in the same worktree) does items 1-4 plus the owed CPU D4-63 on AC. Then critic pass 20 reviews w3/scheme as a whole, and w3/coupling waits for its MERGE. The audio builder resumes when a second slot is free (AC and RAM ≥ 2.5 GB).

## Critic pass 12: w2/flowviz @2cfd469 (PARTIAL: STOP-CLEAN)

I reviewed `1eb1e62..2cfd469` in place (read-only) on 2026-10-29. Main moved only `docs/reviews/LOG.md` since 1eb1e62, so a trial merge would be the branch's tree plus the LOG. **Stopped on the coordinator's STOP-CLEAN** with the in-place coverage run under way. I stopped it, and no leftover processes remain. The flowviz worktree is clean at 2cfd469. No trial merge was started, and no dev server or Chrome page was opened.

**Checked so far**
- Gates in place: typecheck clean (15 s), lint (ESLint + Prettier) clean (95 s).
- Code read:
  - `src/flow/viz/{particles,particleKernel,seeding,modes,fields,colormaps,legend,optics,glow}.ts`;
  - `src/render/{flowCompute,flowViz}.ts` (the streaks, the cut plane, the march), the post.ts and engineView.ts diffs, `src/gpu/passTimings.ts`, `src/render/passTimer.ts`, `spikes/p1/appScene.ts`, `src/lookdev/flowPanel.ts`;
  - `tests/gpu/flowParticles.test.ts`, `tests/browser/flowViz.test.ts`, and the unit-test lists.
- The PHYSICS.md, GPU_FACTS M49-M53 and LOOKDEV diffs.
- All 11 screenshots, viewed.
- Probe `docs/reviews/probes/pass12_optics.py` (independent of the branch's code):
  - Edlén gives n − 1 = 2.778e-4 at 550 nm, so K = 2.268e-4 m³/kg;
  - grey-body luminance against an 80 % wall at 1000 lux (255 cd/m²): the HPT vane (1148 K, ε 0.4) 9.3 %, the LPT vane (1130 K, ε 0.85) about 15 %, and 750 K 4e-6;
  - the schlieren comment's own estimate is 9.9e-4 rad, 2.0 × its a/f.
- MOCK take-off stations: T3 836, T4 1617, T41 1513, T45 1130, T5 852 K.

**Not checked (next pass):**
- coverage, test:mesh, test:gpu and test:browser in place;
- the trial merge and its mesh, gates and browser runs;
- a live look on my own page at port 5190 (shimmer, and the readout fix);
- the haze shift's TS model (`schlieren.ts` haze) line by line;
- the ECC agent checklists (not run).
- **No verdict yet.**

**Physics and maths, as far as read**
- *Particles:* the midpoint RK2 in (x, r, θ) is second order. θ̇ = u_θ/r is taken at the midpoint's r, and the unit test shows the 4× error ratio. The 3D map is right:
  - (x, r cos θ, r sin θ), with e_θ = x̂ × e_r;
  - `velocity3D` = (u_x, u_r c − u_θ s, u_r s + u_θ c);
  - the streaks use world = engine frame. The engine root has no transform, and the spools turn about +x with `def.rotation` (−1), as the MOCK's swirl does, so the swirl sign and the axis agree with PHYSICS.md 2.1.
- *The WGSL kernel and its mirror:*
  - they are the same statement by statement (the uniform layout is 160 B and matches `packParticleParams`);
  - the axis ghost row is odd in u_r and u_θ (rMin = 0);
  - the gradient kernel's spans are right at the axis (even g, row −1 = row 0) and at the ends.
  - The Dawn test can fail: a 10 % swirl mutant gives 7e-3 m against 1e-5 m.
- *Gladstone–Dale and the march:* eps = K ρ∞ ∫ ∇⊥g ds with K at 550 nm. The cylinder/slab clip and the surface stop are right. The ledger's 2.26e-4 is Merzkirch's figure, against my 2.268e-4.
- *Blackbody:* Planck (CODATA), the Wyman–Sloan–Shirley lobes (coefficients checked), the D65 matrix and the 683 lm/W luminance are right.
- *Colour maps:*
  - viridis and inferno are polynomial fits within 0.02;
  - the diverging map is linear in CIELAB, so L* is symmetric and monotone, which suits the data;
  - the legend's bar comes from the same LUT bytes, its ticks are 1-2-5 inside the range, the log2 quantities are labelled as ratios, and the schlieren's grey matches the composite's 0.5 + eps/(2a/f);
  - the LUT is sampled at texel centres.
- *D4-76 is after tone mapping:*
  - `displayPipe` = over(renderOutput(vignette(traa), AgX, sRGB)), with `outputColorTransform = false`;
  - the LUT is NoColorSpace;
  - the browser check (68 % of pixels within 3/255 of the LUT, against 0 % through AgX in round 1) can fail.
  - The crop is lip − 0.6 m to plug tip + 0.9 m, r ≤ 1.15 R_nacelle (about 3.5 D long), the same formula in TS and TSL.
- *Timing:*
  - "Flow …" passes leave every render group and `gpuTotal`, so P4 excludes them;
  - the compute pass is timed in its own ring;
  - `visualsMs` goes to D4-2's scheduler.
  - The flow pipeline's output quad (one extra overlay sample, and the schlieren's depth reconstruct) stays inside P4; the paired +0.03 ms is consistent with that.

### Blocking (so far)
None found.

### Important (so far)
- **W2V-I1: the solver badge does not say the field is uncoupled.**
  - Where: `src/flow/viz/legend.ts:98-102` ("Live flow solver (GPU, 2D axisymmetric + swirl)"); `src/lookdev/flowPanel.ts:116-127` (`perfState`, the timing start state: no blade or combustor forces).
  - The HUD beside it shows the MOCK cycle's N1/N2 (`ui-solver-cutaway.jpg`: "MOCK cycle · N1 1074 rpm").
  - The failure: a viewer takes the near-rest field for the solver's answer for this engine. `FlowFieldSource` has only mock/solver, so W3's coupled field would get the same badge.
  - The fix: carry the coupling state with the field and label it ("uncoupled: timing start state") until W3. A legend test pins it.
- **W2V-I2: the solver-link test cannot tell the solver's values from a zero field** (`tests/browser/flowViz.test.ts:238-273`: chroma > 0.05 and `source === 'solver'`).
  - The started field is near rest, so the plane is viridis' low end whatever the velocity texture holds.
  - The failure: a wrong texture (state bound as velocity) or a scale error in the binding still passes.
  - The fix: set a known state through `kernel.setConserved` (uniform 100 m/s, M ≈ 0.29), then check sampled plane pixels against that value's LUT colour, as the D4-76 check does.
- **W2V-I3: the haze and schlieren shaders are not tested against their TS model.**
  - Where: `src/render/flowViz.ts:501-548` (the march). `src/flow/viz/schlieren.ts` is tested against the Gaussian column. The browser test asserts only that ≥ 1 haze pixel changes (line 230), and nothing about the schlieren's level.
  - The failure: K, ρ∞, the r-scale or the right/up basis off by a factor or a sign still passes.
  - The fix: render the schlieren side on, on the MOCK take-off field, or read back the "Flow Schlieren" RTT. Compare one column through the core jet with `rayDeflection` on the same rays, at a tolerance from the 96-sample convergence. Do the same for the haze shift.
- **W2V-I4: the particles step with no CFL limit.**
  - Where: `particleKernel.ts:160-178`, `particles.ts:59-79`.
  - At the panel's ×1/10 (`flowPanel.ts:89`), a core-jet tracer moves about 0.75 m per frame (110 near-field texels). The start/midpoint/end fluid checks then skip thin walls (core cowl trailing edge, splitter lip), and RK2 cuts corners round the spinner.
  - The failure: streaks cross solids at ×1/10 to ×1/50.
  - The fix: substeps n = min(N_max, ceil(|u| dt / Δx)) with a fluid check per substep, mirrored in TS, and the Dawn test adds a high-dilation step.
- **W2V-I5 (visual): the overlay is not accumulated by TRAA but is drawn with TRAA's jitter** (GPU_FACTS M51; handoff NEXT 5).
  - The failure: the cut plane's contours and edges, and the streaks, shimmer by up to half a pixel against the resolved engine, so Data and Cutaway crawl.
  - The fix: draw the overlay unjittered (clear the view offset for the flow pass), or accumulate it.
- **W2V-I6: there is no runtime MOCK fallback.**
  - Where: `flowPanel.ts:116-127`.
  - The failure: a failed `?field=solver` (mesh fetch, `solver.init`, missing FLOW_SOLVER_LIMITS) throws out of `createFlowPanel`, and the page stops. A solver that goes NaN or loses its device keeps drawing under the green badge (`status()` is read only in the test), and NaN reaches the blend.
  - The fix: try/catch to the MOCK with the amber badge and the reason, and rebind the MOCK when `status() !== 'running'` or a readback is non-finite. The app shell should adopt the same contract.

### Nits (so far)
- **W2V-N7:** `.claude-scratch-h.py`, a debug-revert script, was committed at the repo root in b29b74e ("prettier"). Remove it.
- **W2V-N8:** `tests/browser/flowViz.test.ts:135,193,260,266,339` writes 7 tracked PNGs and `timing.json` on every run.
  - So every gate run dirties `docs/look-dev/flow/`, and the timing record changes with whoever ran it.
  - Write to `reports/`, or gate it behind an env var.
- **W2V-N9:** `ui-realistic.jpg` shows the panel's readout "off" with Real selected. It was shot before df53ed1's refresh fix; re-shoot it.
- **W2V-N10:** the comment at `modes.ts:85-90` contradicts itself.
  - It estimates about 1e-3 rad and says a/f 5e-4 "keeps the shear layers inside the grey scale". The probe gives 2.0 × the range, and `schlieren.png` shows them saturated.
  - Either take a/f ≈ 1e-3, or restate the comment.
- **W2V-N11:** `fields.ts:13-24` `deriveQuantities` (the unit-tested Mach) uses γ(T, FAR) R(FAR). The shader (`flowViz.ts:261,294-302`) uses air, as the ledger says. Make the tested function the drawn one.
- **W2V-N12:** the midpoint's axis reflection keeps u_r's sign (`particles.ts:67-68`, `particleKernel.ts:165-166`).
  - It samples at |r + ½ dt u_r| without negating the odd u_r, so the end step's radial velocity has the wrong sign when the midpoint crosses the axis.
  - It is rare, and u_r → 0 there. The reflection test uses a uniform u_r, which is not odd.
- **W2V-N13:** `RollingPassStats.push` stores `flowMs ?? 0` (`passTimings.ts`).
  - So frames before a mode switch, and frames whose flow queries were dropped, count as 0 in `medians().flow`, and D4-2's scheduler sees the visuals low for a window.
  - Skip those frames instead.
- **W2V-N14:** the glow uniforms recompute 12 blackbody integrals (471 steps each) every frame, flow on or off.
  - That is 0.28 ms CPU per frame at take-off, measured in Node on the branch's `glowSceneRadiance`.
  - Cache by temperature, or tabulate.
- **W2V-N15:** the ledger's glow line ("a few % of a lit white wall on the HPT vanes") understates it.
  - The probe gives about 9 % for the HPT vane and about 15 % for the LPT vanes (uncooled, ε 0.85), which are the brightest part.
  - The HPT blade uses the absolute T41, not the relative total temperature. That is an assumption to state.
- **W2V-N16:** GPU_FACTS M53 keeps the earlier 1.28 ms (1.16-1.56), while the handoff's gate run is 1.18 (1.15-1.22). Record both.
- **W2V-N17:** two wording fixes in the notes.
  - Realistic's UI note lacks "mean flow, no shimmer"; the schlieren's note has "mean flow, no turbulence", and the ledger has it.
  - "Derived from the field; nothing synthesized", beside "MOCK field (a synthetic stand-in)", reads as a contradiction. Make it "the visuals add nothing synthesized".
- **W2V-N18:** `MAX_STREAK_M = 0.45` caps every stream above 360 m/s at ×1/200, so the core and bypass jets draw equal streaks. The ledger and the note state the exposure but not the cap.
- **W2V-N19:** `flowCompute.ts:191-193` checks only width and height against `FIELD_EXTENTS.near`, but the kernels use its bounds; check those too.
  - The solver's textures are captured once: a solver that re-creates them would leave destroyed views bound.
  - The intake seed zone is shaped around the MOCK's over-converging inflow (`seeding.ts`). Revisit it on the solver field (W3), or the capture streamtube never shows.

### Visual review (screenshots; "ultra high level UI / very realistic")
**Reads as premium:**
- The flow panel and the legend: dark glass, a tabular ms readout, amber MOCK and green solver badges, round ticks, the unit, and the provenance on the legend.
- The Data mode's laser-sheet tracers with a dark halo.
- The schlieren: light and dark core-jet layers, the intake ring, a dim silhouette, physically credible.
- True viridis in display space.

**Does not read as premium yet:**
1. *Realistic's tracers read as hair or static* (`realistic.png`, `ui-realistic.jpg`): a uniform grey fur over the fan, and a bristle-brush spray from the core nozzle. Visible tracers also contradict "Realistic", and its physical haze is about a pixel. Suggestion: Realistic shows haze and glow only, and tracers become an option (fewer, longer, depth-faded).
2. *The crop leaves a soft purple fog round the engine* in Cutaway and Data: viridis' darkest end out to 1.15 R, faded over 25 cm. On the solver field it fills most of the frame. Prefer a crisp, outlined border, or a reduced opacity outside the nacelle (stated on the legend).
3. *W2V-I5's shimmer.*
4. *The cutaway's core jet sits flat at the top of the speed map.*
5. *The solver screenshots show near-rest dashes,* which read as noise; don't showcase them before W3.

The glow reads as faint pink metal, which is honest for its physics. Provisional view: the UI chrome is at the target level; the flow layer needs a polish round before the app shows it.

### Completion @4ad355e (2026-10-30)

**Scope.**
- I read `2cfd469..4ad355e` (round 3, 12 commits) against the PARTIAL above, with D4-82 and D4-83 from main bb7c83c.
- I synced the critic branch with main bb7c83c (6b2c0fa). LOG.md conflicted; I kept both sides.
- I trial-merged w2/flowviz @4ad355e with `--no-ff --no-commit`. It merged clean. `git diff --stat 4ad355e` shows only this LOG and my probe, so the gates below ran on the branch's own code.
- Suites ran one at a time, in the foreground. Afterwards I aborted the merge; the critic branch is back at 6b2c0fa. The flowviz worktree was not touched.

**Gates (on the trial merge).**
- typecheck: clean.
- lint (ESLint + Prettier): clean, 63 s.
- `npm run coverage`: 109 files, 2049 passed + 11 expected fail. Statements 98.5 %, lines 99.5 %. Thresholds met, exit 0, 774 s.
- `test:mesh`: 29 passed.
- `test:gpu`: 12 files, 68 passed.
- `test:browser`, run 1, with about 0.4-0.6 GB free:
  - 1 failed, 29 passed, 1 error, and some files never reported.
  - The error: `flowSolver.test.ts`'s iframe "did not become ready within 60000ms".
  - The failure: the indicative `[timing]` test, with the tracers on at 3.17 ms against ≤ 2. The whole GPU was about 2.7× slow in that run: the P4 render total was 17.7 ms against about 6.5 elsewhere, so this was memory pressure and contention.
- `test:browser`, run 2, once free memory had recovered to 2.3 GB, run verbose once: **11 files, 34 passed**, 0 WebGPU errors. I reran because the first run's failure was the environment, and I record both runs here.
  - Timing (indicative): Realistic default 0.70 ms (render 0.61, compute 0.09). Tracers on 1.12 ms (compute 0.16). P4 paired change +0.04 ms.
  - D4-76: 86.6 % of sampled plane pixels are on the LUT. The glow red-lifts 15732 px, and the haze changes 2942 px.
  - The run left `docs/` clean (N8).

**The W2V findings re-verified.** I read each fix in the diff and checked each test.
- **W2V-I1 FIXED.**
  - `FlowCoupling = 'mock' | 'uncoupled' | 'coupled'` is required on `FlowField` and `CpuFlowField` (`src/contracts/flow.ts`).
  - `flowCouplingProblems` refuses a coupling that contradicts the source, and `GpuFlowSolver.fields()` says 'uncoupled'.
  - `provenanceLabel(coupling, fallback)` reads "Flow solver (uncoupled until W3) … no blade or combustor forces", with a blue dot.
  - Tested in the unit, gpu (`flow-solver.test.ts`) and browser (`flowPanel.test.ts`) suites.
- **W2V-I2 FIXED.**
  - The test sets a uniform state through `kernel.setUniform`: 110 m/s, which sits off every contour. It resamples with 0 iterations.
  - Data (M 0.323): 53344 of 56041 plane pixels are on that value's LUT colour, and 0 on the zero colour. Cutaway: 53092 of 55891, and 0.
  - The bounds are > 80 % and < 5 %, so a zero, misbound or misscaled texture fails.
- **W2V-I3 FIXED, and the new test found a real bug.**
  - The test reads back the schlieren and haze targets and compares them ray for ray with `rayDeflection`, using the shader's own offset (`marchOffset`) and the gradient kernel's TS mirror.
  - The tolerance is 1 % of the column's peak plus the 96-step against 768-step quadrature error.
  - Schlieren: worst 0.13 % of 1.23e-3 rad. Haze: worst 0.09 %. Nothing is outside the tolerance in either.
  - The bug: the haze shift was twice the physical value, because `screenSize` inside the half-resolution `rtt()` is the RTT's own size (GPU_FACTS M55).
  - The fix divides by 2 tan(fovY/2), and by the aspect for x. I re-derived it: the small-angle uv shift is angle / (2 tan(fovY/2)), over the aspect for x. Correct.
- **W2V-I4 FIXED.**
  - `advectSubstepped` and its WGSL mirror take midpoint substeps of at most one texel, at most 128 per frame.
  - The step criterion uses the meridional speed, which is right: swirl cannot cross an axisymmetric wall.
  - Past the cap a tracer lags behind instead of tunnelling.
  - The Dawn test at ×1/10: 0 branch mismatches and 8.4e-5 m. A no-substep mutant gives 213 mismatches and 0.87 m.
- **W2V-I5 FIXED.**
  - The flow pass and the march use `flowCamera`, copied from the camera at render start, before TRAA sets its view offset inside the pipeline (GPU_FACTS M54).
  - The test: 0 of 278643 overlay pixels change between two still frames. The jittered control (`jitterFlow`) changes 222681.
  - A residual remains: W2V-N20 below.
- **W2V-I6 FIXED** for the look-dev page. The app shell picks this up under D4-82 (handoff NEXT 2).
  - `src/flow/viz/fieldLink.ts` binds the MOCK before it disposes the solver.
  - It falls back to the MOCK, with the reason shown and a warning, on:
    - a failed start;
    - a solver that is unavailable, lost or diverged (`sanitizeFlowStatus`);
    - a step that throws;
    - a field the visuals refuse.
  - Re-created solver textures are rebound, and the cut plane discards non-finite values.
  - Tests: 10 unit cases, plus 2 browser cases (a failed start, and a solver lost mid-run).
- **The nits:**
  - N7 FIXED (02c374e).
  - N8 FIXED: output goes to `reports/flow/` unless `VITE_FLOW_LOOKDEV=1`, and my run left `docs/` clean.
  - N9 FIXED: `ui-realistic.jpg` shows "GPU 0.66 ms".
  - N10 FIXED: a/f is 1e-3, pinned by a test, and `schlieren.png` is now graded, not saturated.
  - N11 FIXED: `GAMMA_R_TABLE`/`airGammaR` is shared by `deriveQuantities` and the shader.
  - N12 FIXED: u_r is negated past the axis. The θ rate is even and needs no sign, which is correct.
  - N13 FIXED: a frame without a flow time is NaN and skipped.
  - N14 FIXED: `createGlowRadianceCache` in the view.
  - N15 FIXED: the ledger says about 9 % (HPT vane) and about 15 % (LPT vane), and that the absolute T41 makes it an upper bound.
  - N16 FIXED: M53 has both round 2's numbers and round 3's.
  - N17 FIXED: Realistic's note says "mean flow, no shimmer", and the notes end "The visuals add nothing synthesized."
  - N18 FIXED: the 45 cm cap and its reason are in the ledger and the note.
  - N19 parts 1-2 FIXED: all six extent fields are compared, and re-created textures are rebound. **N19 part 3, the intake seed zone, STILL OPEN:** it is deferred to W3's coupled field, with the reason, which I accept.

**New nits (not blocking).**
- **W2V-N20:** the overlay's occlusion edges still follow the jittered depth.
  - `behindEngine` (`flowViz.ts`) reads `sceneDepth` and `rotorDepth`, which TRAA renders jittered. Where the fan or the lip crosses the plane, the plane's cut edge moves by up to half a pixel per frame.
  - I5's test hides everything else, so it cannot see this.
  - Polish: compare against unjittered depth, or accept it.
- **W2V-N21 (visual):** with the crisp crop, the ambient part of the plane is a large flat purple board in `ui-cutaway.jpg` and `ui-data.jpg`. It is clean and reads as intended, but it is heavy. Consider a lower opacity outside the nacelle (stated on the legend), or a smaller rMax.
- P4 is the orchestrator's (handoff NEXT 1). The builder's indicative paired change is +0.18 ms; my run 2 gives +0.04. Only the official D0-1 capture with the flow on counts, against the 1.04 ms margin (D4-75).

**Visual review (the new screenshots, all viewed: the four `ui-*.jpg`, `solver-link.png`, `schlieren.png`).**
- Realistic now reads as premium: the engine is clean, there are no hair streaks, and the panel shows the tracer switch and the ms.
- The crop's edge is crisp and outlined, so the fog is gone.
- The overlay no longer crawls (I5).
- The speed map runs to 700 m/s, so the MOCK's 645 m/s core jet is no longer flat at the top.
- The uncoupled solver's near-rest frames are gone. `solver-link.png` is labelled as a link check.
- The schlieren is graded.
- What remains: N21's heavy board and N20. The glow stays faint, which is honest for its physics.

**Verdict w2/flowviz @4ad355e: MERGE.**
- B 0. I1-I6 FIXED. N7-N18 FIXED. N19 part 3 is open as a W3 item.
- New: N20 and N21.
- The gates are green on the trial merge, with browser run 2 at recovered memory.
- Before the flow is shown in the app, the orchestrator runs P4 official with the flow on (NEXT 1).

## Critic pass 12: w2/reference-9 a5d86dd..c2d7c9f (no merge; light review, PARTIAL: STOP-CLEAN)

Reviewed with `git show` and `git diff` only; the worktree's uncommitted scratch patch was ignored. The monitor itself landed in round 11, before a5d86dd (2d3a592 TDD, 8ed4497), so I read `bcacc0a..c2d7c9f -- src tests`. The only src change is the monitor; there is no scheme change.

- **The monitor is correct.**
  - `recordResidual` computes sqrt(Σ bV q² / Σ bV) with bV = blockage × cellVolR, the per-radian volume of the r-weighted scheme. That is D4-77's energy norm, beside the unchanged cell mean.
  - Its test (`tests/unit/flow/solver.test.ts:457-495`) recomputes both norms from stage 1's R with a non-uniform blockage, plain and preconditioned. It requires 1e-14 agreement and that the two norms differ by > 1e-3. So it catches a dropped b, a dropped weight, or the wrong stage. It does restate the definition (it is a mirror), which is acceptable for a monitor.
- **D4-79 in `tests/ladder/cases/d463.ts`.**
  - `window` and `at` index the checkpoints correctly (1000-2000 inclusive, and iteration k at index k/100 − 1).
  - `finite` requires all 200 checkpoints, including the residual.
  - Rule (b) is resEnd ≤ resMid and resEnd ≤ res100. Rule (a) is at 1000-2000 and at 20000. They match D4-79.
  - The pin stays `it.fails` with the passing signature companion (D4-65's split). The isentropic start is ρ0 + p′/c0².
- **W2R-N26:** D4-79 applies the rule to each case, but the ladder runs only the contract case. `cases/d463lin.ts` is manual (its header says so).
  - The failure: a fix can be judged on the contract alone.
  - The fix: the D4-63 fix's handoff must attach `reports/ladder/D4-63-linear.json`, or add an opt-in `it`.
- **W2R-N27:** the d463 test's timeout is now 6 h (`D463_TIMEOUT_MS`), and round 12's run was killed for low memory at 16000. A whole ladder run now costs 1.3-4.3 h on this case alone. Consider resumable checkpoints, or keeping it out of the default `test:ladder` with an explicit gate step.
- Not run: no reference-9 suites (light review by diff, as asked).

**Orchestrator questions (provisional):**
- (rr) W2V-I1/I6: should `FlowField` carry a coupling state ('uncoupled' / 'coupled'), so the badge and the app shell can say it, with the MOCK fallback as the contract for w2/app-ui?
- (ss) Visual: should Realistic default to haze and glow without tracers (tracers as a "smoke" option), and should the cut-plane crop be crisp rather than fogged?

## Critic pass 13: w2/app-ui @f6ee8e2

**Scope.**
- Reviewed 2026-10-30: everything in `main..w2/app-ui` (23 commits, rounds 1 and 2; 59 files).
  - The shell: `src/shell/{simCore,fieldSwitch,viewState,mockRaster,orbit,protocol}.ts`.
  - The app: `src/app/{simWorker,mockRasterWorker,client}.ts`.
  - The overlay: `src/ui/*` (App, store, instruments, charts, panels, dock, global.css) and `src/hud/*`.
  - W2F-I1 in `src/cycle/matchedSolve.ts` and `model.ts`, and the flagged `src/render/engineView.ts` edit.
  - The tests (unit, RTL, browser), the lockfile, LOOKDEV.md, and all 14 screenshots in `docs/look-dev/ui/`.
- Checklists: typescript-reviewer, react-reviewer, silent-failure-hunter, pr-test-analyzer and security-review, applied by hand as one review.
- Setup:
  - The critic branch was fast-forwarded to main ca7ba94.
  - The trial merge was `git merge --no-commit --no-ff w2/app-ui`. It merged clean; the tree is the branch's own plus main's LOG.
  - The RTL dev deps were installed from the merged lockfile (`npm install --ignore-scripts`; 22 packages; the lockfile was left byte-identical).
  - Gates, mutants and probes ran one at a time, each detached with a status file. Then I aborted the merge, and the critic branch is back at ca7ba94.
  - The app-ui worktree was not touched. No dev server or MCP page was opened: the browser suite and the probe drive their own Chrome.
- D4-84..D4-86 take the builder's three questions; nothing here contradicts them. D4-85's pixel cap is not in this branch (the client caps the DPR at 2), as D4-85 schedules it for the next round.

**Gates (on the trial merge).**

| Gate | Result |
|---|---|
| `npm run typecheck` | clean, 18 s |
| `npm run lint` (ESLint + Prettier) | clean, 71 s |
| `npm run coverage` (own reportsDirectory) | 118 files, 2122 passed + 11 expected fail, exit 0, 832 s. Statements 98.36 %, branches 87.36 %, functions 99.34 %, lines 99.33 % |
| `npm run test:mesh` | 2 files, 29 passed |
| `npm run test:gpu` | 12 files, 68 passed, 60 s |
| `npm run test:browser` | 12 files, 38 passed, 0 WebGPU errors, exit 0, 385 s, first run, 3.5 GB free. `docs/` stayed clean |

- New modules: shell and hud are at 100 % lines, except `src/hud/anchors.ts` at 52 % (N10) and `src/shell/simCore.ts` at 91 %.
- My run's W2F-N5 record (indicative):
  - 178 lost solves;
  - a held cycle step of 504 ms median, a held frame of 507 ms, the worst frame 947 ms;
  - a matched step of 2.4 ms and a worker frame of 6.6 ms at the end.
  - D4-84 owns this.

**D4-80, the lockfile.**
- The root entry pins @testing-library/dom 10.4.2, react 16.3.3, user-event 14.6.8 and happy-dom 21.0.4 exactly.
- The diff only adds: 22 packages, all `dev: true`, each resolved from registry.npmjs.org with an integrity hash.
- There is no `hasInstallScript`, and no existing entry changed. Accepted.

**D4-82 and D4-83, adopted.**
- *The fallback is visible on every field path.* The paths:
  - a failed start: `startSolver` reports to the errors and the flow status; choosing the solver then falls back, with the reason;
  - lost: a GPU error calls `reportGpuError`, so the status is `lost`, and the next `beforeFrame` falls back;
  - diverged: `sanitizeFlowStatus`;
  - a throwing step.
  - The health check runs every frame, also when the solver is not stepped (Exploded).
  - Device loss stops the loop and shows the fault screen.
  - Each fallback shows on the badge ("FIELD: MOCK fallback"), on the annunciator ("MOCK FALLBACK: <reason>") and on the legend, and goes to `console.warn` and the errors list.
- *The labels:*
  - "FIELD: solver (uncoupled until W3)" (cyan) and the legend's "Flow solver (uncoupled until W3) … no blade or combustor forces";
  - the Diagnostics note says the same;
  - `1920-data-solver.jpg` shows it.
- *D4-83:* `APP_DEFAULT_VIEW` has no tracers in Realistic, a mode switch resets them to the mode's default, and the Data plane starts on Mach.
- *Provenance:*
  - Nothing presents the MOCK or the uncoupled field as the coupled solver.
  - The sources are derived: `sources.cycle` is `cycle.source`, `sources.flow` is `fields.drawn()`.
  - The dock's legend falls back to "uncoupled" when the link is unknown.
  - Two defaults are not conservative (N3).
- *W2F-I1:*
  - `attempt` keeps the last refusal's cause: a thrown error by its name and message, a residual not below 1e-6, a BPR ≤ 1.
  - The model logs once per held episode, and a reset clears the cause.
  - Stryker on `attempt` (src/cycle/matchedSolve.ts:48-65, the two suites): 23 mutants, 22 killed, 0 survived, 1 with no coverage (the non-Error throw's string). 95.65 %.
- *Security:* no `innerHTML`, `dangerouslySetInnerHTML` or `eval`. The ledger is rendered as text, and the fetches are same-origin.

**Mutants (by hand, on the trial merge;** script `docs/reviews/probes/w2a-mutants.sh.txt`; the file restored after each).
- Killed, 12:
  - M2: the switch binds any link's field;
  - M3: a stale `choose` takes the link;
  - M4: `beforeFrame` skips the link's health check;
  - M5: no fallback annunciation;
  - M6: the Annunciators drop the fallback;
  - M7: the uncoupled badge reads "FIELD: SOLVER";
  - M9: the held cause is hidden in a tooltip;
  - M12: Realistic gets tracers by default;
  - M15: the thrown error's name is lost from the cause;
  - M16: a BPR in (0, 1] is accepted;
  - M17: every lost step is logged;
  - M18: a CSS mutant, `.strip { grid-column: 1 / 4 }`. The 1366 layout bar fails it: "T-s diagram overlaps Station strip" in all 6 states, so the layout check can fail.
- Survived, 6:
  - M1: the switch's `dead` guard removed. It is near-equivalent with the fake, which still reports `lost` after dispose (N5).
  - M8: the dock's default coupling 'uncoupled' → 'coupled'. Unreachable in the app today (N3).
  - M10: an equal seq is applied again (`<=` → `<`) (N5).
  - M11: a refused command advances the echoed seq (N5).
  - M13: the store ignores `device-lost` (I1).
  - M14: `Status` never shows a fault (I1).
- Not run: worker-level mutants (`simWorker.ts`). Only the browser suite reaches the worker, and it checks the success paths: the solver steps when drawn. Nothing checks that it stays idle while the MOCK is drawn, or a fallback inside the app.

**Probes.**
- `docs/reviews/probes/w2a-app.browser.probe.tsx.txt` (run twice, 35 s each, assertions on what was seen):
  - the callouts' rendered size, overlaps and leader crossings;
  - Exploded → Schlieren at +1.5 s and +6 s;
  - five quick ArrowUp presses on the lever.
- `w2a-contrast.py.txt`: the text tokens' WCAG contrast.

### Blocking
None.

### Important
- **W2A-I1: a worker fault outside the field switch is not annunciated, and the fault surfaces are untested.**
  - Where:
    - `src/ui/store.ts:108-115` keeps the connection `running` for a "cycle step failed" `fatal`, and only appends the message to `gpuErrors`;
    - those, the worker's `errors` (GPU validation errors, "MOCK raster worker failed … rasterizing on the frame") and refused commands show only in the Diagnostics drawer's Errors list (`src/ui/panels.tsx:441`), which is closed by default.
  - The failure: the cycle model throws (a bug).
    - `simWorker.ts:257-267` stops the sim and keeps rendering. The clock freezes, and the spools keep turning on the frozen state with MATCHED in white.
    - Nothing on screen says the simulation stopped. This is the silent case the handoff's "never silent" excludes.
  - The tests:
    - no test covers `receive` (`ready`, `device-lost`, `fatal`, `gpu-error`) or `Status`;
    - M13 (device loss ignored) and M14 (no fault screen) survive.
  - The fix:
    - a warning annunciator "SIM STOPPED: <message>" from a store flag;
    - a caution chip "GPU ERRORS (n)" that opens the drawer;
    - RTL tests of `receive` and `Status` for each message.
- **W2A-I2: the fan map draws no operating point at ground idle, the app's first view.**
  - Where:
    - `src/ui/charts.tsx:40` builds the fan's speed lines from 60 % up;
    - `:157-168` draws the point at its raw coordinates.
  - At idle the fan sits at W√θ/δ ≈ 65 kg/s and PR ≈ 1.02 (the strip's W2 65.3 kg/s, Pt13/Pt2 1.02). The 60 % line starts at about 150 kg/s, so the point and its trail fall outside the SVG.
  - Every shot in `docs/look-dev/ui/` shows an empty fan map beside a live "SM 3.6 % · η 90.6 %".
  - `tests/unit/hud/hud.test.ts:54` checks that the HPC point is inside the bounds, not the fan's.
  - The fix:
    - extend the fan's lines down to idle N1 where the model's map is defined;
    - otherwise clamp the marker to the plot edge with an off-map cue ("N1 20 %, below the map");
    - a test that both points are drawn inside the plot at idle and at take-off.
  - See question (tt) on the SM itself.
- **W2A-I3: the callouts collide, and the layout bar cannot see it.**
  - Where: `layoutCallouts` reserves 132 × 34 px per label (`src/ui/panels.tsx:460`, `:481`). `.callout` (`src/ui/global.css:830-842`) adds 3/7 px of padding and a 1 px border without `box-sizing: border-box`.
  - So each label renders 147.3 × 36.7 px (probe), and the module's no-collision guarantee is lost.
  - Measured at 1366 × 768 in Realistic, the default view:
    - Combustor × Bypass duct overlap by 1467 px²;
    - Combustor × High-pressure turbine by 36 px²;
    - High-pressure compressor × the Compressor maps panel by 66 px².
  - The leader lines also cross: 2 crossings in each of Realistic, Cutaway and Data (visible in `1366-1`, `1366-4`, `1366-5`, `1920-2`).
  - `tests/browser/app.test.tsx:145-146` leaves the callouts out of the layout bar, and the unit test checks the reserved boxes, not the rendered ones.
  - The fix:
    - lay out with the rendered size (`box-sizing: border-box` and a fixed height, or measure the labels);
    - reject or swap placements whose leaders cross;
    - add the rendered `.callout` rects (against each other and against the reserved blocks) to `layoutProblems`.
- **W2A-I4: the Schlieren shots show the exploded engine. The first switch into a flow mode stalls the worker for longer than the suite's settle.**
  - Where: `tests/browser/app.test.tsx:194-199` sleeps 1.5 s of wall time after the mode echo. The view's re-assembly takes 1.4 s of frame time (`TRANSITION_S`, clamped to 0.1 s per frame).
  - The probe:
    - in the 1.5 s after the Schlieren echo, no new snapshot arrived in either run (0.00 s of sim; run 1's last snapshot said 1 fps);
    - at +6 s the sim had moved 4.82 s at 45 fps, and the engine was re-assembled (probe shot).
  - So:
    - (a) `1920-4-schlieren.jpg`, `1366-4-schlieren.jpg` and my run's show Exploded's layout under the Schlieren label, and `1366-2-cutaway.jpg` shows the wedge part open. The "looked at every shot" review missed it, and LOOKDEV.md's table presents them as the modes.
    - (b) The viewer's first press of Schlieren (and of Cutaway) freezes the app for over a second. It is most likely the first-use node and pipeline compilation in the worker.
  - The fix:
    - shoot only after the view has settled: sim time ≥ `TRANSITION_S` past the echo at a steady frame rate, or a transition flag in the diagnostics;
    - warm the flow modes' pipelines during boot, behind the spinner (question uu);
    - re-shoot.
- **W2A-I5: the thrust lever is a controlled input fed by the 20 Hz snapshot, so it rubber-bands.**
  - Where: `src/ui/instruments.tsx:206-210` sets `value={inp.throttleLever}`, the snapshot's. After each change React restores the last echoed value.
  - The probe: five quick ArrowUp presses on the focused lever. The DOM value right after is "0", and the worker ends at 0.01, not 0.05.
  - So keyboard control advances by at most one step per snapshot. A drag shows the thumb snapping back to the last echo between moves (from the same revert; not measured).
  - The fix:
    - a local pending value, shown until `snapshot.lastCommandSeq` reaches the seq that was sent (the seq echo exists for this);
    - an RTL test that two quick changes send 0.01 and then 0.02.

### Nits
- **W2A-N1:** `void a.fields?.choose(m.source)` (`src/app/simWorker.ts:360`) drops the promise.
  - If `fallBack`'s `setFlowField` throws, it is an unhandled rejection, which never reaches `errors`.
  - There is also no pending state: while the solver starts, the switch shows Solver pressed beside "Drawn: MOCK field".
  - Fix: catch the rejection into `errors`, and show "starting…".
- **W2A-N2:** a failed snapshot post (`simWorker.ts:316-326`) is only pushed to `errors`, and `errors` travel in the snapshot.
  - So if every post fails (a DataCloneError), the overlay freezes with no message. `client.ts:37-43` has no `onmessageerror` either.
  - Fix: post a `fatal` after a few consecutive failures, and handle `messageerror`.
- **W2A-N3 (provenance hardening):**
  - `fieldBadge` (`src/hud/annunciators.ts:114`) gives a solver of unknown coupling "FIELD: SOLVER" at the normal level. The conservative label is "uncoupled".
  - The dock's default (`src/ui/dock.tsx:36`) is not pinned (M8).
  - `setCycleState(state, source = 'model')` (`src/render/engineView.ts:558`) declares 'model' by default. W1F-N1 says derive it, so make it required.
  - `stats().cycleLabel` stays `MOCK_LABEL` when the model drives the view (`:811`).
- **W2A-N4:** `splitRow` (`src/hud/ledger.ts:40`) splits on escaped pipes.
  - PHYSICS.md's flow-visuals row contains `\|u\|`, so the panel shows that row's source cut at "…edge (D4-83), \". It loses "|u|, composited after the tone map in display space (D4-76)".
  - Fix: split on unescaped pipes and unescape them, with a test row.
- **W2A-N5 (tests):**
  - `simCore.test.ts` does not pin an equal seq (M10) or that a refused command leaves `lastCommandSeq` alone (M11).
  - The "not resurrected" case (`fieldSwitch.test.ts:164-168`) passes without the `dead` guard (M1). Make the fake report `running` after `dispose()`, so the reason must be the original one.
  - The app-level fallback (a failed start inside `<App/>`) has no browser case.
- **W2A-N6:** `holding` is not cleared on the sub-idle path (`src/cycle/model.ts:795`).
  - So a held episode, then sub-idle (a flameout), a relight and a second held episode logs nothing the second time. The cause is still recorded.
- **W2A-N7:** the MOCK raster has no timeout.
  - A raster worker that never answers leaves `inFlight` set (`src/shell/mockRaster.ts:28`), so the MOCK goes stale with no message.
  - A reply's id is not checked against the request.
- **W2A-N8 (text):**
  - "RUN · idleFloor" shows a code identifier (`instruments.tsx:120`).
  - "Start lit" at steady idle (`:170`) reads oddly.
  - The callouts' T3, T45, T5, T8 and W13 have no unit, while T4 has one (`panels.tsx:483-500`).
  - With no solver drawn, Diagnostics shows "Solver 0.00 ms" (`panels.tsx:268`; the dash is right) and the normal "SOLVER RUNNING" at 0 iterations (`annunciators.ts:83`; "idle" is right).
  - A leftover `...([] as PlaneStationId[])` (`charts.tsx:276`).
  - The T-s drops station 2's label at 1920 (`1920-1`…`-5`).
- **W2A-N9 (contrast):** `--faint` (#6b7483) is 4.12:1 on the panel over the darkest backdrop and 3.26:1 over a mid studio grey (`w2a-contrast.py.txt`).
  - That is below the 4.5:1 that global.css's header promises.
  - It carries 9-11 px text: the station names, the detents, the lamps, the tags, the axis titles, the speed labels, and the Diagnostics note that explains "uncoupled until W3".
- **W2A-N10:**
  - `src/hud/anchors.ts` has 52 % line coverage: `projectPoint` (the callouts' projection and visibility, pure) has no unit test.
  - `Callouts` measures every `[data-reserve]` element and sets state twice per snapshot (`panels.tsx:469-480`, at 20 Hz). Measure on resize and panel toggles instead.
  - During the 1.4 s re-assembly from Exploded, the callouts show at the assembled anchors over the exploded parts.
- **W2A-N11:** the store is a module singleton, and a Viewport remount resets only `post` (`client.ts:129`).
  - So on a `cycle` change, the old snapshot, `running` and the `field` choice stay until the new worker answers. The browser suite works around this (handoff GOTCHAS).
  - The boot spinner has no timeout (`App.tsx:50-56`).
- **W2A-N12:** `docs/look-dev/ui/01-realistic-idle.jpg` is round 1's: tracers in Realistic, before D4-83. It sits among the current shots. Move it to a `before/` folder.

### Visual review (all 14 shots, my run's 14 in `reports/ui/`, and the probe's)
**Reads well:**
- A restrained dark glass overlay, and one top bar.
- The badge colours carry meaning: green for the model, amber for the MOCK, cyan for the uncoupled solver.
- Tabular numerals line up in the dials, the readouts and the station strip.
- The redline and amber arcs on the dials; the maps' dashed red surge lines and viridis trail.
- A legend with its unit, round ticks and provenance line.
- A drawer that scrolls without covering the columns.
- The hierarchy reads: the engine display first, then the view, then the charts.

**Does not read as the bar yet:**
1. The empty fan map (I2).
2. The colliding labels and crossing leaders (I3). The callouts also cluster on the core and cover the parts they label in Cutaway and Data. In Realistic they point through the opaque nacelle at hidden parts; consider only the fan and the nozzle there, and outward placement with longer leaders.
3. Schlieren shot as an exploded engine, and the half-open cutaway (I4).
4. The drawer is translucent over the purple plane, so its muted note sits on purple (`1366-6`, `1920-6`). Give it a more opaque or blurred backing.
5. The thrust lever is a thin native range input with 9 px detent labels, not a quadrant lever.
6. The station names are 9 px in `--faint` (N9).
7. The T-s is a polyline between the stations. 3 → 4 is a chord beside its dashed Pt3 isobar; drawing the burner along the isobar would read as the cycle.
8. The cut plane's ambient board runs behind the right column (W2V-I7, flowviz's, D4-86).

The chrome is close to the target. The fan map, the callouts and the true Schlieren shot are what stand between it and the "ultra high level UI".

**Verdict w2/app-ui @f6ee8e2: MERGE.**
- B 0. I 5 (I1-I5), N 12 (N1-N12).
- The gates are green on the trial merge, and test:browser passed on its first run.
- D4-80, D4-82 and D4-83 are adopted as decided. No provenance violation.
- I1-I5 go to the next app-ui round with D4-85's pixel cap. I4's re-shoot must come before the shots are shown.

**Orchestrator questions:**
- (tt) The fan's surge margin at ground idle reads 3.6 %, in amber: the cycle model's `surgeMarginFraction`, below the fan map's lowest (60 %) speed line, so off the drawn map. Is that number meaningful there? Should the UI show it as a caution, or mark it "below the map" until the part-power map backlog (D4-3) extends the fan map?
- (uu) Who owns warming the flow modes' pipelines at boot (W2A-I4b): app-ui (calling each mode once behind the boot spinner) or the render/flowviz owner (a `warmUp()` on EngineView)?

## Critic pass 14: w2/reference-9 @d05e16d and w2/cycle-hold @f2c0779 (PARTIAL: STOP-CLEAN)

**Stopped on the coordinator's STOP-CLEAN at the usage brake (83 %).** Only coverage ran on the combined tree. The hand mutants (`pass14-mutants.sh.txt`) and the probe's default-model sweep (`w2h-held.probe.ts.txt` mode 1) are written but **not run**. No detached run is left going. `critic` is clean and checked out again. The local trial branch `trial14` (21b241d, unpushed) is left in place, because a PreToolUse hook blocked `git branch -D`: the orchestrator can delete it.

Reviewed 2026-10-30 on a throwaway trial branch in the critic worktree: main c2dc8da, then `--no-ff` merges of w2/reference-9 @d05e16d and w2/cycle-hold @f2c0779, both clean (no conflicts; the branches touch disjoint files). The gates ran on that tree. `critic` was restored afterwards. Probes: `docs/reviews/probes/w2h-held.probe.ts.txt` (the held retry on the default model and on the fit ramp) and `pass14-mutants.sh.txt` (hand mutants). The orchestrator's `d463lin.log`, round 13's `reports/scratch/r13/logs` (with `ladder-reports/`) and cycle-hold's `reports/cycle-hold/mutate.*` plus `reports/mutation/mutation.json` were read in place; nothing in a builder worktree was written.

### A. w2/reference-9, rounds 10-13 (`bcacc0a..d05e16d`; round 13 = `c2d7c9f..d05e16d`)

Pass 12 covered a5d86dd..c2d7c9f (the D4-77 monitor, D4-79 in `cases/d463.ts`). This pass reviews round 13 on top of that.

- **The global M_cut is the Weiss-Smith/Turkel floor D4-81/D4-59 describe, and it is off by default.**
  - `withGlobalCut` (`src/flow/reference/solver.ts:80-89`) returns the options unchanged when `globalMachCut` is absent. Otherwise it gives minMach' = max(minMach, cut) and M_cut' = max(M_cut ?? minMach, cut), and it throws RangeError on NaN, ±∞ or a negative cut.
  - The constructor stores the floored pair once (`this.pre`, :163-165), and every consumer reads it:
    - the far field's β², `min(1, max(M∞², minMach'²))` (:172);
    - the flux scaling's `this.machCut` (:174), which `assembleResidual` gets at :304, :320 and :359;
    - the preconditioned-CFL switch (:177);
    - the per-cell β of `computeBeta` (:536), which also feeds the local dt.
  - No other code reads `opts.lowMachPreconditioning` (grep), and physical time ignores it, as before.
  - M_cut ≥ 1 stays ≥ 1, so the scaling stays off. minMach ≥ 1 stays ≥ 1, so the scheme stays plain. With no cut, D4-40's 0.003 contract is bitwise unchanged: the solver test files, `precondition.test.ts` and the GPU tests' `ENGINE_PRECONDITIONING` still run at 0.003.
- **The cases and the oracle constants are right.**
  - `GLOBAL_MACH_CUT = 0.02` and `ENGINE_PRECONDITIONING_CUT = {minMach 0.003, globalMachCut 0.02}` (`tests/ladder/oracle.ts:59-65`). In force this is minMach = M_cut = 0.02, D4-59's configuration.
  - The cut is applied to every preconditioned CPU ladder run D4-81 lists: L7 (`l7.ts:58`; it binds at M 0.01 and is inert at M 0.3), L8 (`l8.ts:24`), §12.2's C-pre and S (`f32.ts:84,91`), and the d463 default (`d463.ts:69-75`).
  - `d463plain.ts` passes `null`, which gives no preconditioning and CFL 1.5. `d463mcut02.ts` and `d463mcut05.ts` pass {0.003, cut}.
  - The pin is lifted, `it.fails` → `it` (`d463.test.ts:46`), with the history kept in the comment.
- **The run evidence matches the logs.** I recomputed every number from the JSON:
  - `plain.json`: (a) 0.3663 / 0.04334; (b) 0.6408 / 0.1585; residual 3.89e-2 / 9.63e-3 / 6.17e-3 at 100 / 10k / 20k; peak 6.59.
  - `mcut02.json`: (a) 0.7779 / 0.4876; (b) 0.5236 / 0.2234; residual 1.806 / 0.771 / 0.404; 0.601 at 11000; max over 10k-20k 0.852; peak 4.21. These match SOLVER.md §10's table and the handoff.
  - `ladder.log` (8447e99, 76 min): 12 files passed and 3 failed, 14 tests passed and 3 failed. The 3 failures are the known ones (L8 convergence 37500; L9a Euler work, from its steadiness 1.062e-5; L9b convergence 20000). The rest pass:
    - L7: 0.01093, |Cd| 0.001307, ratio 1.779, the sequence 0.128 / 0.039 / 0.011;
    - L8: 0.7536 %, steadiness 3.24e-5;
    - §12.2: C-pre 1.43e-7 / 1.79e-7 / 1.06e-6 and S 1.25e-7 / 1.11e-7 / 2.02e-6;
    - floor 4/4;
    - the ladder's own d463 run, identical to run 2.
  - The orchestrator's linear part (`d463lin.log` `@@RESULT@@`) gives (a) 0.5056 / 0.05553, (b) 0.5959 / 0.3022 and peak 7.75, exactly D4-89's figures.
  - The code at d05e16d equals 8447e99 in `src` and `tests` (`git diff 8447e99 d05e16d -- src tests` is empty), so I did not rerun the ladder.
- **Would a test fail if the cut were ignored or misapplied?** By reading, yes:
  - the test compares whole states after 3 iterations, plus dt, the residual and the CFL, against the run at minMach = M_cut = the cut;
  - `not.toEqual` against the run without the cut catches an ignored cut;
  - on this mesh the pulse reaches the far-field row at the top (g ≈ 0.12 there), so the test should see the far field's β.

  This is UNCHECKED by mutation: hand mutants A1-A4 (the far field's β, M_cut, β and the CFL switch, each unfloored) are in `pass14-mutants.sh.txt`, not run. No Stryker run on `withGlobalCut`.

#### Blocking
None.

#### Important
None.

#### Nits
- **W2R-N28: SOLVER.md §10's "slow late decay" ranges are tighter than the data.** The text (also in the handoff and D4-89) says L2(p′) "holds at 0.48-0.51 from 13000 to 20000" and the residual "0.33-0.42 from 15000". `mcut02.json` gives 0.463-0.531 over 13000-20000 (0.464 at 14400, 0.531 at 13000) and 0.332-0.465 over 15000-20000 (0.465 at 15100). The conclusion holds (no decay over 15k-20k; recorded, not gating), but the ranges should be the measured ones, since D4-89's reopen trigger compares the GPU's trend against them. Fix: restate them in §10 in the kernel round.
- **W2R-N29: SOLVER.md §10 has no linear-part row at the cut.** D4-79 requires it, and D4-89 quotes the orchestrator's run, but the only record is a job-tmp log outside the repo. This is W2R-N26's gap. Fix: add the row (0.5056 / 0.0555, 0.5959 / 0.3022, peak 7.75; the cell mean at 20000 over 100 is 5.06, reported) and the JSON to `reports/ladder/D4-63-linear.json` in the next reference or kernel round.
- **W2R-N30: `L8_MACH_CUT` is now silently floored at 0.02** (`tests/ladder/cases/l8.ts:10-11,24`). A sweep with `L8_MACH_CUT=0.005` runs at 0.02 and prints rows labelled with its own value. The header comment "minMach = M_cut … the engine's value" (0.003) is stale too. Fix: drop the env override, or pass `globalMachCut` only when the env is unset, and say "in force 0.02" in the comment.

#### Verdict A: **MERGE, provisional** (D4-89 already adopted it)
It is pending the gates not yet run on the combined tree (typecheck, lint, test:mesh, test:gpu, test:browser) and hand mutants A1-A4. The cut does what D4-81 says, the default contract is untouched, and the evidence matches the logs. The nits go to the kernel round (W2R-N28/N29) or the next reference round.

### B. w2/cycle-hold @f2c0779 (`42cf8e9..f2c0779`)

- **A sliced walk is the unsliced walk.**
  - Newton's only state between iterations is x. r = f(x) is recomputed on resume, deterministically. `stop` is asked only while the loop condition holds, so a stopped solve always has iterations left (`newton.ts:89-93`).
  - `advanceWalk` keeps `done`, `step`, `x`, `solves` and the paused iterate with its used iterations. It resumes with `maxIterations = 25 − used` (`matchedSolve.ts:162-191`), and the target is fixed in `startWalk`. The bit-identity tests slice the start's walk at 5/23/60 evaluations.
  - The iteration-limit arithmetic is not pinned by any test: Stryker 169 ×6, and hand mutant B1 below (W2H-I2).
- **`UNBOUNDED_RETRY` is D4-13, and the matched path is unchanged where it matters.** I ran `w2f-fingerprint` (pass 7) three ways:
  - 42cf8e9, as it was;
  - the trial tree with `heldRetry: UNBOUNDED_RETRY`;
  - the trial tree on its default.

  42cf8e9 and the unbounded trial tree give the same 5 hashes, held path included: slam-chop 677bc456…, c12 c34d477c…, start dd082a71…, hot-surge-flameout 63915b7e…, part-lever 0b0723fc…. On its default the trial tree changes only hot-surge-flameout (c9b5371f…), the one scenario that holds, as the handoff says. The policy with `budget = ∞` and interval 0 is call for call `solveMatched`:
  - the direct is never stopped;
  - the walk always sets out (t − t_last ≥ 0);
  - the walk is never paused, so `sameTarget` holds and the result is matched;
  - `lostCause` always gets `why.cause`.
- **The meter is deterministic.** `gasPathEvaluations` is a module counter that `evaluateGasPath` increments (`engine.ts:1065-1089`). `retryMatched` reads it only around its own solves, so nothing else runs inside a window, and a test double brings its own meter. The per-step reset is in `step()` (`model.ts:496`). The one host dependence is the documented per-`step()` budget: a held episode lasts longer in sim time at a larger frame dt.
- **The held state stays visible (W2F-I1).**
  - The status is 'held' on every lost snapshot, `lostSolves` counts each one, and the warning comes once per episode.
  - W2A-N6 is fixed (the sub-idle path ends the episode, `model.ts:840-845`).
  - A budget-cut direct names itself ("not converged within the held-retry budget (residual … after k iterations)"), and a snapshot with no attempt keeps the episode's cause (`model.ts:859`).
  - The annunciator (app-ui) reads `gasPathSolve`, which is unchanged.
- **P5.**
  - The contract edit is one new `THRESHOLDS.P5` entry (`thresholds.ts:427-444`) and a matching PHYSICS.md §3.4 row; nothing else in the contract changed.
  - `thresholds.test.ts` counts P1-P5 (4+12+13+5) and checks 137 / 217 / 16.7 / 60 Hz. The existing mirror tests (same IDs, same order, same text) cover the row.
  - `heldFrame.test.ts` reads `stepRateHz`, `leverRampS`, `maxHeldStepEvaluations` and `maxStepEvaluations` from P5 (`:29-31, :62, :98-111`).
- **W2H-I1 on the default model: only partly checked.**
  - Of the 5 fingerprint scenarios, only hot-surge-flameout (ISA+30, surge, flameout and relight) holds on the default model, for 0.62 s. The default model held 0 times on the fit's ramp (D4-84).
  - The wider sweep in `w2h-held.probe.ts.txt` mode 1 is NOT run: 6 ambients × 6 plans × 60 Hz and 0.02 s, each reporting lost solves, the longest hold and N1 while held.
  - So "the default model can't reach the runaway" is not yet confirmed beyond those cases.

#### Blocking
None.

#### Important
- **W2H-I2: the "iterations left" of a resumed solve is untested** (`src/cycle/matchedSolve.ts:166-169`).
  - Six Stryker mutants of `used > 0 ? { maxIterations: MAX_NEWTON_ITERATIONS - used } : {}` survive cycle-hold's targeted run: always, never, `≥`, `≤`, `{}`, and `25 + used`. That run's tests were heldRetry, matchedSolve, numerics, gasPathHold and lostSolveCause, not the slow heldFrame. Whether heldFrame kills them is UNCHECKED (hand mutant B1 is not run). The finding stands either way: no fast test pins it.
  - The failure scenario is the fit ramp's common case: a walk solve that fails by running out of C7's 25 iterations. Sliced, under this mutant, it gets up to 25 + used. So it can converge where the unsliced walk failed, or fail later, and the branch's central claim, "a walk spread over several steps makes the same solves, to the bit", would silently break. The sliced-walk tests slice only converging solves, and the failing-everywhere test fails by refusal, not by exhausting iterations.
  - Fix (test only): a Newton double whose residual needs more than 25 iterations, e.g. r ← 0.9 r. Slice its walk at k evaluations and assert the same refusal after exactly 25 iterations in total per solve, with the same points as unsliced. Then rerun Stryker on lines 162-191.

#### Nits
- **W2H-N1: "the budget never cuts the matched path" holds on the suite, not by construction** (`heldRetry.ts:121-132`, the header and the handoff).
  - The direct solve's stop counts the step's *carried* spend even when the model is not holding. So after a snapshot that recovers in the same step, the next snapshot's matched-path direct gets only the remainder, and a non-holding direct that needs more than 120 evaluations (about 15 Newton iterations, below C7's 25) is cut too.
  - On the fit ramp the probe traces two such cuts (8.85 s: recovered with 45 evaluations, then cut after 7 iterations at 4.29e-3; 11.40 s: 66, then cut after 6 iterations). Each started a new held episode and warning.
  - A trial with the carried spend ignored when not holding leaves both still failing after 10 iterations (4.29e-3, 9.21e-3), so they are genuine losses, not artefacts.
  - Fix: state the bound as observed (the fingerprints and heldFrame's three scenarios). Or start a non-holding direct's cap from its own work, then recheck P5's every-step row.
- **W2H-N2: a stopped solve that already passes `ACCEPTED_RESIDUAL` is thrown away** (`matchedSolve.ts:74`: `stopped` is tested before acceptance).
  - On the fit ramp, 5 solves stopped at residuals below 1e-6 (steps 632 and 680-683, e.g. 4.98e-10 after 9 iterations, against 1e-6). With a walk in flight the direct gets DIRECT_SHARE (60), restarts from the anchor every step, and stops one iteration short each time.
  - Accepting them (trial) changed nothing measurable here: the same 798 held steps and 1594 lost. So it is a nit, but the module's own definition says such a solution is usable.
  - Fix: accept a stopped direct solve that passes the residual and BPR checks; keep the walk as it is for bit-identity.
- **W2H-N3: P5 does not say how long the ramp runs.** `heldFrame.test.ts` gates 10 s after the ramp starts (`ramp(10)`, to 13 s). The fit's second episode (13.05 s, the W2H-I1 runaway) and a 79-evaluation converged direct at 13.03 s (against `CONVERGED_DIRECT = 80`) fall just outside. Over 23 s the bars still hold (held-cost: held max 136, all steps ≤ 217). Fix: put the run length in P5's row (and the 3 s idle lead), or gate the handoff's 20 s.
- **W2H-N4: Stryker survivors that are test gaps, not equivalents** (`heldRetry.ts`, `matchedSolve.ts`):
  - `sameTarget` with the n1 or wf comparison forced true (116:3, 116:49): the `reached` tests change only n2;
  - `walk === null` → true (143:7): a walk in flight is replaced once 0.5 s has passed. No fast test keeps a walk in flight past the interval. Hand mutant B2, against heldFrame, is not run;
  - the solves-exhausted `lost` → `{}` (201): through `retryMatched` it would fall through to `matched` with an undefined solution. Only `solveMatched` tests reach it, and there null hides it;
  - the walk's pre-solve `stop` check removed (158): the walk still pauses, through Newton's own check, one evaluation later.

  Fix: three small double-based tests. The remaining survivors are equivalent (105, 108, 147, 217, `guess.slice`, `MAX_STEP.slice`, the jac init) or outside the branch and the targeted test set (`model.ts:837`, the sub-idle condition; the option checks and `entering` are reached only by heldFrame or the start tests; see the hand mutants).
- **W2H-N5:** the `heldRetry.ts` header says "pure", but `retryMatched` mutates its `spend` argument (`:124-125`). Fix: say so in the doc, or return the spend.

#### Mutation (cycle-hold's targeted Stryker run, read from `w2-cycle-hold/reports/mutation/mutation.json`, finished 18:58)
| file | killed | timeout | survived | no coverage |
|---|---|---|---|---|
| matchedSolve.ts | 119 | 5 | 16 | 1 |
| heldRetry.ts | 90 | 0 | 7 | 0 |
| model.ts (393-406, 833-904) | 53 | 0 | 16 | 7 |
| engine.ts (1066-1090, 1118-1146) | 12 | 0 | 2 | 0 |
| newton.ts (86-96) | 21 | 0 | 2 | 0 |
| **total (351; 3 ignored)** | **295** | **5** | **43** | **8** |

The score is 300 / 351 = 85.5 % (87.5 % of covered). The survivors are classified in W2H-I2 and W2H-N4. model.ts's 16 survivors and 7 no-coverage mutants sit in lines that only heldFrame and the start tests reach, and that run excluded them (`model.ts:837`'s sub-idle condition is pre-existing).

#### Verdict B: none yet (PARTIAL)
B has no blocking finding so far, and one important finding (W2H-I2, test-only). Still unchecked:
- hand mutants B1-B4 against heldFrame;
- the default-model sweep (W2H-I1 reach);
- the remaining gates.

### Gates (the trial merge: main c2dc8da + w2/reference-9 @d05e16d + w2/cycle-hold @f2c0779)
| gate | result |
|---|---|
| npm run coverage (own reportsDirectory) | 120 files passed; 2159 passed + 11 expected fail (2170); exit 0, so the per-directory thresholds hold; lines 99.32 %, statements 98.36 %, branches 87.52 %, functions 99.35 %; 876 s |
| typecheck, lint | NOT RUN (STOP-CLEAN) |
| test:mesh, test:gpu, test:browser | NOT RUN (STOP-CLEAN) |
| test:ladder | not rerun, by instruction: src and tests at d05e16d equal 8447e99, whose ladder JSON is verified above |

### Questions for the orchestrator (provisional)
- (vv) W2H-N1: should a non-holding direct solve's budget count only its own work, not the step's carried spend? Then a step that recovers and then loses again could cost up to 274 evaluations. P5's every-step row (217) would need restating.
- (ww) Next critic pass: finish B (run `pass14-mutants.sh.txt` and probe mode 1 on the trial merge), then typecheck, lint, test:mesh, test:gpu and test:browser.

## Critic pass 15: w2/reference-9 @d05e16d, w2/cycle-hold @f2c0779, w2/app-ui @ff95d99

**Scope.** This pass finishes pass 14 (A's remaining gates and hand mutants; B's verdict, its mutants and the default-model sweep D4-90 asked for) and reviews app-ui round 3 (`f6ee8e2..ff95d99`), all on one combined trial merge.

**Setup** (2026-10-30, the critic worktree):
- `critic` merged main ee97061 (b4f2b23). Then a throwaway local branch `trial15` took three `--no-ff` merges:
  - w2/reference-9 @d05e16d (40de03e): clean;
  - w2/cycle-hold @f2c0779 (2351c81): clean;
  - w2/app-ui @ff95d99 (a0e44b8): **a conflict** in `src/cycle/model.ts` and `tests/unit/cycle/lostSolveCause.test.ts`. Both branches fixed W2A-N6. I took cycle-hold's lines in `model.ts`: its `holding = false`, `entering = true` and `retry = NO_RETRY` are a superset of app-ui's one line. In the test file I kept both N6 tests, renaming app-ui's to "W2A-N6 (app-ui): …". The orchestrator's merge will hit the same conflict (question yy).
- In the trial, `src/flow/reference` and `tests/ladder` equal d05e16d, and `src/cycle` equals f2c0779.
- Every gate ran alone and detached (`Start-Process`, a status file per step). test:browser started at 2.18 GB free.
- Two short Node probes (the callout search, and the W2H traces with the fine sweep) overlapped the held sweep and my own C unit mutants, never a gate. The CB2 browser mutant started at 1.77 GB.
- The builders' worktrees were only read. The probes imported main's and cycle-hold's `src` in place.
- No dev server or MCP page was opened: the browser suite drives its own Chrome.
- `critic` is checked out again and clean. The local branch `trial15` (a0e44b8, unpushed) is left in place, because the PreToolUse hook blocked the branch delete: the orchestrator can delete it. No detached run is left going.
- Probes and mutants: `docs/reviews/probes/pass15-mutants.sh.txt`, `w2h-reach.probe.ts.txt`, `w2a-callout-search.probe.ts.txt`, `w2h-trace.probe.ts.txt` (two traces), plus pass 14's `w2h-held.probe.ts.txt` mode 1 with dt 0.05 added.

### A. w2/reference-9 @d05e16d (finishing pass 14)

Pass 14 reviewed round 13 and gave a provisional MERGE. This pass ran what it left open.

- **Hand mutants A1-A4** (`pass14-mutants.sh.txt`, run as `docs/reviews/probes/pass15-mutants.sh.txt` section AB; `precondition.test.ts -t global`):
  - A1, the far field's β from the unfloored minMach: **killed**.
  - A3, the per-cell β read from the options as given: **killed**.
  - A2, the flux's M_cut not floored: **survived, equivalent.** `computeBeta` floors every cell's β at minMach' = max(minMach, cut), so a face's mean β is ≥ cut, and SLAU2 takes mRef = min(1, max(β_face, M_cut)) (`slau2.ts:104`). An M_cut below β_face changes nothing. The M_cut floor in `withGlobalCut` is redundant while minMach is floored too. It is harmless, and the kernel mirror can keep both parameters.
  - A4, the CFL default read from the minMach as given: **survived, a test gap** (W2R-N31). The two differ only for a cut ≥ 1, where pre.minMach ≥ 1 is the plain scheme but the mutant picks the preconditioned CFL.
- **Gates on the combined tree:** all green (table below). `src` and `tests` under `src/flow/reference` and `tests/ladder` are byte-identical to d05e16d in the trial (no other branch touches them).

#### Blocking
None.

#### Important
None.

#### Nits
- **W2R-N31: a global M_cut ≥ 1 is untested** (`src/flow/reference/solver.ts:176-177`; `tests/unit/flow/precondition.test.ts:280-308`).
  - The failure: `globalMachCut: 1` makes minMach' = M_cut' = 1, the plain scheme, which must keep the plain CFL 1.5. Mutant A4, the CFL switch reading the minMach as given (0.01 < 1), runs it at the preconditioned default instead, and every test passes.
  - The fix: add `expect(run({ minMach: 0.01, globalMachCut: 1 })).toEqual(run())` beside the `minMach: 1` case, or reject a cut ≥ 1 with the RangeError the other bad cuts get.

### B. w2/cycle-hold @f2c0779 (finishing pass 14)

- **Hand mutants B1-B4** against heldRetry, heldFrame (the slow fit-ramp suite) and gasPathHold, plus lostSolveCause for B3:
  - B1, a resumed solve gets C7's full 25 iterations: **survived.** This confirms W2H-I2: not even heldFrame pins the iterations left.
  - B2, a walk in flight replaced once the interval has passed (Stryker 143:7): **survived** against heldFrame too, so W2H-N4's item is confirmed.
  - B3, the sub-idle entry through the budgeted retry: **killed** (heldFrame's relight and start bit-identity, 2 tests).
  - B4, a walk that converged on its old target does not move the anchor or the held point (`model.ts:897-901`, Stryker's 897): **survived** (W2H-N6).
- **The default-model sweep (W2H-I1 reach).** `w2h-held.probe.ts.txt` mode 1 ran on trial15, with dt 0.05 added to its two steps: 6 ambients × 6 plans × dt 1/60, 0.02, 0.05.
  - At 60 Hz nothing runs away. The longest hold is 0.58 s (TO + surge at 10 s + flameout at 20 s), and N1 while held stays ≤ 42.3 %. The other five plans never hold.
  - **At dt 0.02 it does:** ISA SLS, take-off, surge at 10 s, flameout at 20 s and the auto relight. 859 lost solves, held 7.88 s without a break, and N1 198 % while held.
  - At ISA+30 the same plan **threw**: `P3 NaN Pa and dt 2.27e-5 s must be > 0` (`surgeDetection.ts:29`, through `model.ts:723`). The sweep stopped there: the rest of ISA+30 and the ISA+40, ISA−40 and 3000 m rows at dt 0.02, and every row at dt 0.05, were not run.
  - Then `docs/reviews/probes/w2h-reach.probe.ts.txt`: that plan at five frame steps, on main ee97061 (D4-13), on cycle-hold alone (f2c0779) and on trial15. Each tree ran its default policy, and the two with the bounded retry also ran `UNBOUNDED_RETRY`:

| TO + surge 10 s + flameout 20 s, 35 s | dt 1/60 | 0.02 | 1/30 | 0.05 | 0.1 |
|---|---|---|---|---|---|
| ISA, main (D4-13): longest hold / max N1 held | 0.13 s / 35.4 % | 0.12 s / 35.8 % | 0.13 s / 35.2 % | 0.15 s / 35.0 % | 0.10 s / 31.5 % |
| ISA, cycle-hold default (= trial15) | 0.58 s / 32.6 % | **7.88 s / 198.2 %** | 1.23 s / 31.9 % | 2.00 s / 31.8 % | 5.70 s / 31.5 % |
| ISA, cycle-hold `UNBOUNDED_RETRY` | = main, every column | | | | |
| ISA+30, main (D4-13) | 0.10 s / 38.4 % | 0.10 s / 38.4 % | 0.10 s / 38.3 % | 0.10 s / 38.1 % | 0.10 s / 37.4 % |
| ISA+30, cycle-hold default (= trial15) | 0.57 s / 35.3 % | **throws at 25.46 s** | 1.43 s / 33.7 % | 1.80 s / 33.6 % | 7.70 s / 33.2 % |

  - A finer sweep at ISA, default policy (`w2h-reach` with only these steps): **N1 runs away at dt 0.0200, 0.0205, 0.0210 and 0.0250 (168-218 %)**. It does not at 0.016-0.0195, 0.022-0.024 or 1/60. Those are 40-50 fps frames. The browser runs record 26-61 fps across the modes (`*-shots.txt`).
  - The trace at dt 0.02:
    - the relight's entry walk (3146 evaluations, unbudgeted) holds briefly, then the model matches at 23.7 s;
    - on the way back up the matched solve is lost at 27.12 s (N1 84 %, N2 77 %; "residual 0.673 not below 1e-6");
    - from there P3 stays frozen at 1.62 MPa, every step spends 16-126 evaluations, and none recovers. N1 climbs 84 → 106 % by 28.1 s and → 195 % by 34.6 s.
  - The bleed rows (N1 36 % at full lever at ISA+30 with 8 % bleed and 150 kW, under `accelSchedule`) are identical on main, so they are not this branch's.

#### Blocking
- **W2H-B1: the bounded retry makes W2H-I1's spool runaway reachable on the default reference model, from the app's own controls** (`src/cycle/heldRetry.ts:119-166`, `src/cycle/model.ts:881-903`; D4-90 item 4).
  - D4-90 left W2H-I1 for the part-power round only because "the default model doesn't hold on the ramp" and the critic would check that it can't reach the runaway. It can.
  - The scenario uses only the app's controls: ISA SLS (the app's only ambient), Fault → Surge at take-off, then Flameout. The engine relights on its own.
  - At a 50 fps frame (dt 0.02, also 0.0205, 0.021 and 0.025) the gas path holds without a break from 27.1 s. N1 integrates the stale balance to 198 % while the annunciator says GAS PATH HELD.
  - On main the same run holds at most 0.15 s at every step size. So does this branch's own `UNBOUNDED_RETRY`. So the regression is the bounded policy. The likely mechanism: the per-`step()` budget, which is less retry work per sim second at a longer frame, together with the 0.5 s walk interval means the walk never catches the moving state.
  - Where it does recover, the default model now holds 4-57 times longer than D4-13 (0.58 vs 0.13 s at 60 Hz, 5.70 vs 0.10 s at dt 0.1). D4-90 item 3 accepted 3.37 s against 2.97 s on the fit ramp only.
  - The fix (TDD; this scenario at dt 0.02 as the failing test, with N1 ≤ the N1 limit while held and the hold no longer than D4-13's by a stated factor). Either:
    - (a) bring W2H-I1's fix forward into this branch: a held point never integrates the spools past their limits on a stale balance;
    - (b) or let a held episode that outlasts a stated bound, e.g. two walk intervals, escalate to D4-13's whole walk in one snapshot. That is a one-off hitch, as D4-90 accepted for the sub-idle entry.

  Either way, rerun this probe and P5's rows.

#### Important
- **W2H-I2** (pass 14): stands, now confirmed by B1 against heldFrame too.
- **W2H-I3: a surge that starts from a held state integrates to a NaN P3 and the model throws** (`src/cycle/model.ts:711-740`, `src/cycle/surgeDetection.ts:29`).
  - The scenario: the B1 plan at ISA+30 (318.15 K), dt 0.02 (`w2h-trace.probe.ts.txt` part 2).
  - The HPC margin goes negative while matched at 25.36 s (−0.001), and the solve is lost at 25.40 s.
  - At 25.44 s the held point moves while held: P3 2 099 458 → 2 120 502 Pa, SM −0.011. Only `reached` (`model.ts:897-901`) does that.
  - At 25.46 s the surge integration feeds `feedP3` a NaN, and the step throws. In the app that is SIM STOPPED.
  - D4-13 never holds there, so main does not throw. The app cannot set ISA+30 today (no ambient UI), so this is important rather than blocking. The ambient is in the sim command contract, and W3's scenarios will set it.
  - The fix: a failing test of this run first. Then find where the surge model's state or equilibrium turns NaN on a held snapshot. Never feed the detector a non-finite P3: a NaN in the state is a bug to stop on, but at its source and with its cause.

#### Nits
- **W2H-N1..N5** (pass 14) stand.
  - N1: D4-91 item 4 keeps the charging, so what is left is the claim "the budget never cuts the matched path" in the `heldRetry.ts` header and the handoff. It holds on the suite, not by construction: restate it.
  - N4's 143:7 is confirmed by B2.
- **W2H-N6: the model's use of `reached` is untested** (`src/cycle/model.ts:897-901`).
  - B4 drops it (the anchor and the held point stay at the older converged point), and every test, heldFrame included, passes.
  - The policy-level `reached` tests (heldRetry.test.ts) do not reach the model's wiring. It is the path that moves the held point in W2H-I3's run.
  - Fix: a model-level double, a walk that converges on its old target while the state has moved, asserting the new anchor and the held point.

### C. w2/app-ui round 3 (`f6ee8e2..ff95d99`)

Checklists: react-reviewer, typescript-reviewer, silent-failure-hunter and pr-test-analyzer, applied by hand as one review. D4-84..D4-91 were checked against the code: nothing here contradicts them. D4-91's progressive warm-up is a later round, so the warm-up is judged against D4-88 as written. Its boot cost (9-23 s, boot-to-ready 10-26 s) is known and is D4-91's.

**What the round fixes (checked by reading the code, plus the mutants below):**
- **W2A-I1, the faults on screen.**
  - A thrown cycle step posts `sim-stopped` once (`simWorker.ts:298-309`; `simFailed` guards the step).
  - The store keeps `simStopped`, and the connection stays `running`, because the worker keeps rendering.
  - The annunciators put SIM STOPPED first, with its message beside it. The clock reads "stopped", and Pause is disabled.
  - GPU ERRORS (n), MOCK RASTER ON FRAME/FAILED and REFUSED (n) are chips that open Diagnostics.
  - A `fatal` now always fails the app: the message-prefix test is gone.
  - Every handler of `FromWorker` handles `sim-stopped`. The one consumer is `store.receive`; the browser suite's `problems()` reads the worker's `errors`, and those carry the message.
  - RTL covers `receive` for all six messages and Status's screens, which kills pass 13's M13 and M14.
  - Not silent anywhere I could find. The exception is the worker side, which has no test (N14).
- **W2A-I2 + D4-87, the fan map.**
  - Each map starts at its own lowest node (`lowestMapPercent`: the fan's 30.6 %), and the idle point is inside the plot (unit test, and visible in every shot).
  - A point off the plot is clamped to the edge with a chevron.
  - Below the lowest line the margin is dimmed (opacity 0.6) and tagged "below map", with a hollow point.
  - The levels are `!(m > 0)` → warning and `m < 0.05` → caution, on the map only. That matches D4-91's pre-registered levels; the PHYSICS.md UI rows are not written yet.
- **W2A-I3, the callouts.**
  - `.callout` is `box-sizing: border-box; white-space: nowrap`.
  - Each label is measured as drawn, an unplaced label hidden so it is measured too, and laid out at that size. The size does not depend on the position, so measuring and laying out converge.
  - The browser bar now checks the drawn labels against each other and against the reserved blocks, text cut off, leader against leader, and leader through label. Mutant CB2 shows that it can fail; CB1 survives, as expected (Mutants).
  - The search does not keep its "most labels" promise (W2A-N13).
- **D4-88, `warmUp()` and `viewSettled()`.**
  - `warmUp()` saves and restores `mode`, `cut`, `explode`, `spoolFactor`, `flowMode`, `flowQuantity` and `flowTracers`, and it re-applies the flow mode. Its last step is the saved mode, set `immediate`, so the meshes' visibility, the explode offsets and the composite match the saved state.
  - What it does not put back is incidental: `fanFrame` advances about 10, TRAA's history and the timer's window hold the warm-up frames, and the tracers' buffers exist.
  - The worker's first `applyView` (`appliedView` is null until the loop) re-applies the whole app view anyway, so in the app the restore is exact where it matters.
  - `viewSettled()` compares `cut`, `explode` and `spoolFactor` against the mode's end values exactly. That is sound: the transition clamps to [0, 1], and `spoolDisplayFactor` returns exact 0 and 1 at its ends.
  - The settle tracker zeroes on a switch, even when the first frame reads settled.
- **W2A-I5, the lever.**
  - `leverShown` holds the local value until `lastCommandSeq` reaches the sent seq, then shows the sim's own value. The RTL test includes the reset case (seq + 1, value 0, and the lever shows 0).
  - It cannot stick: a `setThrottle` from the range input or a detent is always in [0, 1], so validation never refuses it, and a stopped sim still applies commands. A new session unmounts the quadrant (no snapshot), so the pending value goes.
- **D4-85, the pixel cap.**
  - `backingDpr` = min(2, dpr, √(2 073 600 / CSS px)) up to high, and min(2, dpr) on ultra. It is applied at init, on resize and on a quality change.
  - The unit test covers the 1.5x case, a 2560 x 1440 window at 1x (0.75), ultra, and bad DPRs.
  - Round 3's shots ran at DPR 1, but my gate run's Chrome was at 1.5 and exercised the cap (Gates). See N18 on "full DPR".
- **The cheap nits** (N1-N4, N6-N12) and visual note 4: the code matches the handoff.

#### Blocking
None.

#### Important
- **W2A-I6 (round 4, D4-91 item 2): the Schlieren view has no Schlieren-specific content check** (`tests/browser/app.test.tsx:316-321`).
  - D4-91 accepts the skipped lit-centre bar only with a Schlieren check in its place. What remains for Schlieren is the generic `centreStd > 0.03`.
  - The exploded engine and the Realistic view pass it too: round 2's mislabelled Schlieren shots did. The true view sits near the bar, at 0.051 and 0.055 (`1920-shots.txt`, `1366-shots.txt`).
  - The failure: a Schlieren that composites nothing (the knife-edge off, or the MOCK's gradient zero), or Realistic drawn under the Schlieren label, passes the suite.
  - The fix, per D4-91: in Schlieren, the luminance across the jet region behind the nozzle varies (the knife-edge bands: its spread well above the background's). The engine box is a dim silhouette: its mean is below Realistic's by a stated factor.

#### Nits
- **W2A-N13: the callout search does not place the most labels, as its doc says** (`src/hud/callouts.ts:177-178`; the claim at `:136-139`).
  - The prune `crossings >= best.crossings && bestShowsPrefix(chosen, i - 1)` cuts every branch whose shown prefix matches the best found so far. It ignores that such a branch may show a label *later* that the best hides.
  - Once a first layout with 0 crossings exists, no other placement of the labels before a hidden one is ever tried. The search is greedy first-fit with a crossing preference.
  - The probe (`docs/reviews/probes/w2a-callout-search.probe.ts.txt`) uses 3-4 random anchors, 140 x 36 labels in 420 x 300, against brute force over the same places:
    - the module shows fewer labels than possible in **276 of 3000** cases;
    - with the node budget lifted, still 65 of 600;
    - with this prune removed as well, **0 of 600**;
    - first case: anchors (270, 64), (237, 60), (267, 128), (270, 96), the 4th hidden though all 4 fit.
  - No overlap results, so the browser bar cannot see it. In the app it can hide labels that would fit. In `1920-6` four are hidden; whether any of them would fit there is unchecked.
  - The fix: prune on crossings only when the best also shows every label from i on (`best.chosen.slice(i).every((c) => c >= 0)`), and add a unit case where first-fit hides a label.
- **W2A-N14: the worker's fault paths are untested** (`src/app/simWorker.ts:298-309, 376-383`, and the raster timeout at `:216-220`).
  - Only the store and the RTL side are pinned. Posting `sim-stopped` as `gpu-error`, dropping the N2 fatal, or never calling `timedOut` would pass every suite: no test makes the cycle throw, a post fail, or the raster worker hang. The handoff's NEXT 4 says so.
  - Fix: move the tick's fault handling into a pure shell function, tested in Node. Or add a browser case with a test-only `CycleChoice` whose step throws, asserting SIM STOPPED.
- **W2A-N15: SIM STOPPED tells the viewer to "reset or reload", but a reset does not restart the sim** (`src/hud/annunciators.ts:194`, `src/app/simWorker.ts:298`).
  - `simFailed` is never cleared, so Controls → Ground idle moves the frozen state to idle, and the clock stays stopped under the same warning.
  - Fix: say "reload". Or let a `reset` clear `simFailed`, posting a `sim-resumed` the store clears `simStopped` on, with a test.
- **W2A-N16: the first-switch bar is a hard wall-time gate** (`tests/browser/firstSwitch.test.tsx:107`).
  - D4-91 registers ≤ 250 ms as indicative, official only in a quiet run, but the test fails the browser suite on a loaded run. The builder measured 75-188 ms loaded, against 250 ms.
  - It also has no errors check (`problems()`), unlike app.test.
  - Fix: record the gap and gate it only in a quiet run (or an env flag), as P1 and P4 do; add the errors check.
- **W2A-N17: the "taking longer than usual" boot message is not reset for a new boot** (`src/ui/App.tsx:59-68`).
  - `slow` stays true after a slow boot, so the next session (a cycle change) shows it at once.
  - Fix: `setSlow(false)` when `booting` turns true.
- **W2A-N18: "ultra keeps the full DPR" is "up to 2"** (`src/shell/pixelCap.ts:12, 21-23`). `MAX_DPR` still caps ultra: a 3x display gets 2, and the unit test pins it. That is fine, but D4-85 and LOOKDEV.md should say "the full DPR up to the client's cap of 2".
- **W2A-N19: the caution's boundary is untested.** C1 (`m < SM_CAUTION_FRACTION` → `<=`) survives. D4-91's "amber below 5 %" makes exactly 5.0 % normal. Add the 0.05 case beside 0.03 in `hud.test.ts:110-114`.
- **W2A-N20: the warm-up does not cover two first uses:** the solver's first bind (the handoff's NEXT 1) and a quality change (the shadow and post configurations of low, medium and ultra). Both can still stall a first use. That fits D4-91's background warm-up round.

### Visual review (all 14 shots in `docs/look-dev/ui/`: the 13 of round 3 plus `before/01`; my gate run's 13, at DPR 1.5, were looked at too)

**Fixed since pass 13, and it reads:**
- The fan map now has its idle point: a hollow, dashed ring just under the surge line's foot, tagged "below map", with the margin greyed (`1920-1`, crop).
- Schlieren is the true knife-edge view: a grey field, the engine as a dark silhouette, the jet in light and dark bands. Cutaway is fully open.
- The callouts no longer touch each other or a panel in any shot, and the leaders do not cross.
- The drawer is opaque: its note no longer sits on purple.
- `--faint` text reads, and the limiter says "idle floor".

**Still short of "ultra high level":**
1. **The closed views' Fan callout labels the nacelle.** In Realistic and Schlieren its dot sits on the nacelle's flank, well behind the lip, not at the fan face (`1920-1`, `1366-1`, `-4`). The builder's NEXT 3 names it. Anchor it at the fan face, visible through the intake, or at the intake lip.
2. **In the cut views the labels read as a list beside the shaft, not as labels of parts** (`1366-2`, `1366-5`, `1920-2`, `1920-5`).
   - All eight dots sit on the core's centre band, and long, near-parallel leaders run along the shaft to labels placed by free space: Combustor right of the LPT, Core exhaust over the HPT, HPT over the booster. The Bypass duct's dot is on the core, not in the bypass stream.
   - Nothing overlaps, but the part ↔ label link is weak. Put the bypass anchor in the duct, and put the labels outward, above and below the engine's silhouette, with leaders that keep the stations' axial order.
3. **Schlieren's only content runs under the right column.** The jet's knife-edge plume goes from the nozzle into the Compressor maps panel at both sizes (`1920-4`, `1366-4`). Frame it in the open area: a camera target further aft, or a Schlieren preset.
4. The cut plane's ambient purple board still fills Cutaway and Data (W2V-I7, flowviz's, D4-86).
5. Render: Realistic over a full window is 8.3-10.1 ms (the builder's DPR 1 run, and mine at the cap), and Cutaway 16-18 ms shortly after its switch, against P4's 8 ms. It is recorded and indicative (D4-85). The fan at idle reads as a bristly smear of time copies in Realistic and Schlieren (render's, W1L).
6. Small ones:
   - the T-s's "2" label sits on the 2 → 3 line at 1920;
   - visual notes 5 (a quadrant lever) and 7 (the burner along its isobar) are still open, as the handoff says.

The chrome is at the bar: restrained glass panels, coloured badges, tabular numerals, legible small text, nothing clipped or overlapping. What still stands between it and the "ultra high level UI": the callouts' placement (items 1-2), the Schlieren framing (3) and flowviz's purple board (4).

### Gates (trial15: main ee97061 + w2/reference-9 @d05e16d + w2/cycle-hold @f2c0779 + w2/app-ui @ff95d99)
| gate | result |
|---|---|
| `npm run typecheck` | clean, 18 s |
| `npm run lint` (ESLint + Prettier) | clean, 72 s |
| `npm run coverage` (own reportsDirectory) | 122 files, 2203 passed + 11 expected fail (2214), exit 0 (the per-directory thresholds hold), 823 s. Statements 98.47 %, branches 87.67 %, functions 99.47 %, lines 99.44 %. New modules at 100 % lines: `pixelCap`, `settle`, `callouts`, `compressorMap`, `annunciators`, `anchors` (52 % in pass 13), `heldRetry`. `simCore` is 91.2 % (as before) |
| `npm run test:mesh` | 2 files, 29 passed |
| `npm run test:gpu` | 12 files, 68 passed, 54 s |
| `npm run test:browser` | 13 files, 40 passed, 0 WebGPU errors, exit 0, 410 s, first run, 2.18 GB free at the start. `docs/` stayed clean |
| `npm run test:ladder` | not rerun, by instruction (pass 14 verified 8447e99's JSON; A's files are unchanged) |

**The browser run's records** (indicative, shared machine). Chrome ran at **DPR 1.5** this time (round 3's shots were at 1), so D4-85's cap was exercised:
- **The pixel cap.**
  - 1366 x 768 renders 1920 x 1079 (dpr 1.406), and 1920 x 1001 renders 1994 x 1039 (dpr 1.039). Both are ≤ 2.07 MP.
  - Ultra renders 2049 x 1152 and 2880 x 1501, at the full 1.5.
  - Realistic over a full window: **9.1 ms and 8.3 ms**, against P4's 8 ms. Round 2 measured 27.9 ms at 4.33 MP.
- **The first switch** (D4-91's ≤ 250 ms):
  - Schlieren: echo 90 ms, longest gap 58 ms;
  - Cutaway: echo 84 ms, longest gap 67 ms;
  - boot 10.0 and 11.7 s (the warm-up 8.9 and 10.7 s), against D4-91's 5 s: the progressive warm-up round.
- **D4-90's browser row beside P5** (the fit's 1 s ramp, W2F-N5 record, cycle-hold's budget in the worker):
  - a held frame's CPU is **11.2 ms median, 27.7 ms max** (the cycle step held 7.2, max 10.6), against 16.7 ms. Pass 13 measured 507 ms.
  - 2205 lost solves, 364 of 392 snapshots held, and N1 ends at **134.9 %**: W2H-I1 on the fit, as known.

### Mutants (by hand on trial15; `pass15-mutants.sh.txt`; each file restored after)
| set | killed | survived |
|---|---|---|
| A (reference-9) | A1 (far-field β), A3 (per-cell β) | A2 (flux M_cut: **equivalent**), A4 (CFL switch: W2R-N31) |
| B (cycle-hold, with heldFrame) | B3 (sub-idle entry) | B1 (iterations left: W2H-I2), B2 (walk replaced: W2H-N4), B4 (`reached` ignored: W2H-N6) |
| C (app-ui, unit/RTL) | C2 (below-map off), C3 (lowest line dropped), C4 (lever back to the echo), C5 (lever sticks), C6 (store ignores sim-stopped), C7 (no SIM STOPPED), C8 (labels may collide), C9 (reserved ignored), C10 (crossings ignored), C11 (ultra capped), C12 (no cap), C13 (switch does not reset the settle count), C14 (Pause stays enabled) | C1 (caution at ≤ 5 %: W2A-N19) |
| C (app-ui, Chrome layout bar) | CB2 (laid out at 60 x 20) | CB1 (laid out at the default 132 x 34) |

- CB1 survives because the drawn labels are close to 132 x 34 now: border-box, and most are narrower. The 4 px gap absorbs the rest, so no drawn overlap occurs at either size. That is the fix working, not a blind bar.
- CB2 lays the labels out at 60 x 20, far under their drawn ~140 x 36. The bar fails it in Cutaway, Data and with the drawer open: callouts overlapping callouts and the Diagnostics panel, and leaders running through labels. So the bar sees drawn labels and leaders.

**Totals:** A 2/4 (2/3 of the non-equivalent), B 1/4, C 14/16 (13/14 unit and RTL, 1/2 in Chrome; CB1 survives as expected, above).

### Verdicts
- **A. w2/reference-9 @d05e16d: MERGE.** B 0, I 0, N 4 (W2R-N28..N31). Pass 14's provisional MERGE is final: the gates are green on the combined tree, and A2's survivor is equivalent.
- **B. w2/cycle-hold @f2c0779: FIX FIRST (W2H-B1).**
  - B 1 (W2H-B1), I 2 (W2H-I2, W2H-I3), N 6 (W2H-N1..N6).
  - The bounded retry makes D4-90's W2H-I1 runaway reachable on the default model, from the app's Surge and Flameout buttons at 40-50 fps (N1 168-218 % while held). On main the same run holds ≤ 0.15 s.
  - W2H-I3 (a NaN throw from the same held path at ISA+30) belongs in the same round. W2H-I2 and N6 are test-only.
- **C. w2/app-ui @ff95d99 (round 3): MERGE.**
  - B 0, I 1 (W2A-I6, round 4, as D4-91 item 2 allows), N 8 (W2A-N13..N20).
  - W2A-I1..I5, D4-85, D4-87 and D4-88 are fixed as decided, with RTL and unit pins that kill 13 of 14 hand mutants. The gates are green on the combined tree.
  - It merges on main alone: its `model.ts` line conflicts only with cycle-hold's (yy).

### Questions for the orchestrator
- (xx) W2H-B1: which fix for cycle-hold's next round?
  - (a) Bring W2H-I1's fix forward: no spool integration past the limits on a stale held balance.
  - (b) An escalation: a held episode past a bound, e.g. two walk intervals, runs D4-13's whole walk in one snapshot, as the sub-idle entry does.
  - Also, does D4-90 item 3's "later recovery is accepted" (3.37 against 2.97 s on the fit ramp) cover the default model's holds? Where it recovers, they are 4-57 times D4-13's (0.58 against 0.13 s at 60 Hz, 5.7 against 0.1 s at dt 0.1). Or should P5 gain a recovery row on the default model?
- (yy) Merge order. cycle-hold and app-ui both fixed W2A-N6, so they conflict in `src/cycle/model.ts` and `lostSolveCause.test.ts`. If app-ui merges first (B is FIX FIRST), cycle-hold's fix round merges main and keeps its own `model.ts` lines (a superset) and both tests, as trial15 did.
- (zz) The callout layout (visual notes 1-2, W2A-N13): should round 4 re-anchor the closed views' Fan at the fan face and place the cut views' labels outward in axial order? Round 4 is also the progressive warm-up and W2A-I6.

## Critic pass 16: w2/kernel @be07478, w2/cycle-hold @7f3fb22, w2/flowviz @7dac273

**Scope.**
- A, w2/kernel: rounds 1-3 (`ee97061..be07478`, with main cf87af0 merged): D4-89's mirror, the GPU d463 trend to 40k, W2R-I19's rows, W2L-I6's disocclusion mask, W2L-I8's cut-face band, W2L-I7's focus fix, the capture's `--flow`, the M_cut pin. GOTCHAS R1-R2 judged below.
- B, w2/cycle-hold: rounds 2-3 since pass 15's FIX FIRST (`f2c0779..7f3fb22`): W2H-B1 per D4-92/D4-94, W2H-I2/I3, the two root guards, P5b, the mutants. The builder's three questions answered below.
- C, w2/flowviz: round 4 (`cf87af0..7dac273`): W2V-I7 / D4-86, the ambient floor, its legend band, the dock/CSS edits, the frames; D4-95's quiet rerun of the flow timing row.

**Setup** (2026-10-31, the critic worktree):
- `critic` merged main 10b78ad (a fast-forward). A throwaway local branch `trial16` took three `--no-ff` merges, all clean: w2/kernel (9fa728a), w2/cycle-hold (6163608), w2/flowviz (48acbf9).
- Every gate ran alone and detached (`Start-Process`, a status file per step), on trial16. test:browser started at 3.27 GB free with no other vitest-browser or Chrome for Testing process; the app-ui builder's `npm run coverage` (Node, CPU only) was running at the time, nothing else on the GPU.
- Probes ran after the gates, except the kernel/cycle unit mutants and the Node probes, which ran beside test:gpu-ladder (on other files; trial16's `src` was not mutated while a gate read it).
- The builders' worktrees were only read (their `reports/` logs and JSON).
- `critic` is checked out again and clean. The local branch `trial16` (48acbf9, unpushed) is left in place, because the PreToolUse hook blocked `git branch -D`: the orchestrator can delete it. No detached run is left going.
- Probes and mutants: `docs/reviews/probes/pass16-mutants.sh.txt`, `w2h-pass16.probe.ts.txt` (fine / sweep / fit), `w2h-fitthrow.probe.ts.txt`, `w2v-floor-deltae.probe.ts.txt`, `pass16.browser.probe.ts.txt`; pass 15's `w2h-reach` and pass 7's `w2f-fingerprint` were rerun as they are.

### A. w2/kernel @be07478 (rounds 1-3)

**What holds (checked by reading, the gates and mutants K1-K5):**
- **The mirror is exact.** `inForce` (`src/flow/gpu/params.ts:72-79`) is the oracle's `withGlobalCut`: minMach' = max(minMach, cut), M_cut' = max(M_cut ?? minMach, cut), RangeError on NaN, ±∞ and a negative cut, and an M_cut or minMach ≥ 1 stays ≥ 1. Every consumer reads the values in force: the far field's β² (:238), the CFL switch (:260), minMach² (:262) and M_cut (:269). `enginePreconditioning` refuses a cut outside (0, 1); `adapterPreconditioning` refuses `machCut` beside explicit options. No WGSL changed: the kernel already took minMach² and M_cut as uniforms.
- **The pin binds.** `ENGINE_MACH_CUT === GLOBAL_MACH_CUT`, and the oracle's `ENGINE_PRECONDITIONING_CUT` gives the GPU default's tracking, BC and physical uniforms (`tests/unit/flow/gpu/machCut.test.ts:107-121`). The CPU side's equivalence of {0.003, cut 0.02} and {0.02, 0.02} is reference-9's `precondition.test.ts -t global`, so the chain closes. Mutants: K2 (M_cut not raised), K3 (the adapter ignores its `machCut`) and K5 (the far field from the given minMach) are killed. K4, the CFL switch read from the given minMach, survives (W2K-N1, the twin of W2R-N31).
- **The stale comments are gone.** `0.003` survives only as history (`params.ts:24`, `engine-stability.test.ts:4-5`, whose trace numbers are labelled as 0.003's), as an explicit test value (`forms.test.ts`, `host.test.ts`) and in the oracle's `ENGINE_PRECONDITIONING`, which the pin reads.
- **The GPU d463 trend is real.** I recomputed it from `w2-kernel/reports/scratch/k/D4-63-gpu-0.02-ext40k.json` (400 checkpoints), and it matches SOLVER.md 15.2 in every figure:
  - (a) 0.7779 / 0.4859, (b) 0.4913 / 0.2111, peak 4.21;
  - the weighted residual 1.809 / 2.272 / 2.595 / 0.7775 / 0.3584 / 0.3820 at 100 / 1k / 2k / 10k / 15k / 20k, then 0.2878 / 0.1843 / 0.1591 / 0.1496 at 25k / 30k / 35k / 40k;
  - the log-linear trend is 0.9939 per 1000 over 15k-20k and 0.9525 over 20k-40k; the max over 20k-40k is 1.16 × the 20k value (at 21k);
  - L2(p′)/first falls at every 5k checkpoint past 20k: 0.486 / 0.448 / 0.411 / 0.380 / 0.328.
  - My trial16 gate run reproduced the 20k rows bit for bit. D4-89's reopen condition ("if it grows past 20k") is not met. The residual's decay flattens at the end, though (W2K-N4).
- **The tightened rows are tight and can fail.** On trial16: E-L5 2.67e-8 ≤ 3e-7 (11×), E-L9a 2.46e-12 ≤ 1e-10 (41×), B 1.266e-11 ≤ 2e-10 (16×), each D4-62's "ten times the measured error, rounded up" (E-L9a at D4-71's 1e-10). Commit 7110467 says their power "is shown by a mutant (handoff)", but the handoff records none. My K1 shows it:
  - the WGSL mass flux off by 2e-6 relative on faces with a radial normal component, `gm * (1 + 2e-6 |n_r|)`. That is not a uniform scale, which would cancel in the residual sum.
  - E-L9a fails at 1.29e-9 > 1e-10. D4-48's 1e-3 and the residual form (3.47e-6 ≤ 1e-3) would both pass it.
  - E-L5 does not see this mutant (2.67e-8 unchanged), and B was not mutated. W2K-N2.
- **The focus fix is in all four harnesses** (`spikes/lib/focus.ts`; `spikes/bench/run.ts:478, 490, 535, 569, 599, 632`; `tools/lookdev/capture.ts:262`; `ab.ts:219, 255`; `variantAb.ts:78`).
  - Every navigation before a timed run is followed by `realFocus`, and every run carries `focusValidity(start, end)` beside the blur count.
  - `realFocus` throws only if the emulation is still on; an unfocused window makes the runs INVALID instead.
  - The bench's `refocus` opens and closes a second tab before every run (twice per P1 run). The warm-up absorbs it.
- **`--flow` keeps D0-1 and writes P4flow only** (`tools/lookdev/timing.ts:51-69, 205-217`; `capture.ts:478-519`).
  - Warm-up, runs, reps, seed and pacings are unchanged, and `--flow` with `--diagnostics` is refused.
  - The flow configs' ids never match `default (threeQuarterFront)`, so `p4Verdict` returns NONE and `results.P4` is not written.
  - The file is `timings-flow.json`, and a run is INVALID unless the solver's uncoupled field was drawn at its start and end.
  - The stills are the exception (W2K-N3).

**GOTCHA R1 (the cut-face band) and R2 (the per-run mask): measured.** I ran `rotorMotion`'s own measurement on more poses than the suite does (`pass16.browser.probe.ts.txt` part 1; means of 8; tiles out of 2040):

| pose, pipeline | band | floor | moving | excess (bound: 6) |
|---|---|---|---|---|
| default cutaway, shipped | on (819 tiles out) | 0.00 | 0.50 | 0.50 |
| default cutaway, shipped | off | 30.50 | 38.25 | **7.75 (fails)** |
| default cutaway, legacyTraa | on | 0.00 | 0.63 | **0.63 (passes)** |
| default cutaway, legacyTraa | off | 27.50 | 40.13 | 12.63 (fails) |
| close-up, shipped | on (982 out) | 1.63 | 1.88 | 0.25 |
| close-up, shipped | off | 2.50 | 6.75 | 4.25 |
| close-up, legacyTraa (the suite's control) | on | 1.75 | 13.00 | 11.25 (fails) |
| close-up, legacyTraa | off | 2.88 | 27.50 | 24.63 (fails) |

The suite's own rows on trial16 equal the builder's 02cee6f run to the digit. The measurement is deterministic here.
- **R1.** D4-93 adopted the band for the cutaway preset, and the close-up is a pose of that preset, so applying it there follows the decision as written. In the close-up it costs half the control's excess (24.63 → 11.25), and the row still fails the ghosting pipeline by 5 tiles.
  - In the default cutaway pose it costs everything. The legacy pipeline, which ghosts (12.63 without the band), passes with it (0.63).
  - That row can no longer fail. Excluding every tile that tells the two pipelines apart is a widening in effect, which D4-74's rule forbids ("robust, never widened"). W2L-I9.
- **R2.** The forward-backward mask is the standard occlusion test, and in the shipped run all four baselines share its pixel set. So the bound compares like with like, and it fails the defect W2L-I6 exists for: the half-length control loses at 30.37 against 0.6 × 22.04 = 13.2.
  - That the controls are judged on sets their own vectors chose does not weaken them here: −1, 0.5 and 1.5 fail by 18-20 /255.
  - `noRotorMotion` fails only by the empty-set rule (no pixel moves 4 px), and the shipped run's zero baseline (ratio 0.30) is the real zero-vector check.
  - The shipped margin is 0.021 (0.579), deterministic. Acceptable. W2L-N15 is a reporting nit.

#### Blocking
None.

#### Important
- **W2K-I1: the D0-1 checklist lost a protocol item to a substitution artefact** (`spikes/README.md:77`, commit 184680f).
  - The line "- [ ] Notifications off (Do not disturb), so no toast takes focus. No other window over Chrome. Don't touch the machine until the summary prints." is now a literal `$1` (a regex replacement's unexpanded group; GOTCHA 5 names the tool).
  - D4-93 amended D0-1 with the focus rule and said "the rest is unchanged". The checklist the official window follows now omits notifications-off, no-window-over-Chrome and hands-off.
  - The failure: the next official P1/P4 window runs with notifications on and nothing forbids a window over Chrome. A toast that takes the focus makes a run INVALID (D4-73), so the window loses runs. A window that covers part of Chrome without taking the focus or throttling rAF trips no rule at all.
  - The fix: restore the line, above the new D4-73 item.
- **W2L-I9: with the cut-face band, the default cutaway pose's row cannot fail** (`tests/browser/rotorMotion.test.ts:132-160`, the control at `:205`; table above).
  - The legacyTraa pipeline passes it (0.00 → 0.63 tiles against 6) though it ghosts there (12.63 excess without the band). The band holds every tile in which the two pipelines differ.
  - The suite runs its control only in the close-up, so it cannot see this. The row reports PASS on a measurement that cannot see ghosting.
  - The fix, stated before a run (D4-74):
    - a legacyTraa control in every banded pose, which must fail;
    - for the default cutaway pose, a narrower band whose control fails (e.g. the cap pixels only, without the one-tile dilation), or the pose taken out of the moving bound with the reason stated. The latter narrows the test's coverage, so it is the orchestrator's call (question 1).
  - The close-up keeps its power, and a pipeline-wide ghosting regression is still caught there.

#### Nits
- **W2K-N1: a global M_cut ≥ 1 is untested on the GPU too** (`params.ts:259-260`; `machCut.test.ts:84-91`). Mutant K4 (the CFL switch reads the given minMach) survives, as A4 did on the CPU (W2R-N31). Fix: `{ minMach: 0.003, globalMachCut: 1 }` gives minMach² 1 and the plain CFL, or refuse a cut ≥ 1.
- **W2K-N2: the tightened rows' power is not recorded** (7110467's message; SOLVER.md 15.3). Record K1 (E-L9a 1.29e-9 against 1e-10, where 1e-3 and the residual form pass) and one mutant that E-L5 and B see.
- **W2K-N3: `--flow` re-shoots the record stills unless `--only none` is given** (`capture.ts:212-256`). The page loads with `field=solver`, and the stills go to `--out` (default `docs/look-dev`). Fix: `--flow` implies `--only none`, or it refuses stills.
- **W2K-N4: the GPU residual's decay flattens past 35k** (SOLVER.md 15.2, "keeps decaying past 20000").
  - It rises in 7 of the 20 thousand-iteration steps past 20k, and the 35k-40k log-linear fit is 1.018 per 1000 (0.159 → 0.150 at the ends).
  - L2(p′) keeps falling. This is no reopen by D4-89's rule. Put the 35k-40k figure beside the 20k-40k 0.953, so a later extension compares against it.
- **W2L-N15: report each rotor control on the shipped run's pixel set too** (`rotorMotion.test.ts:448-482`). The controls lose 3250-12527 of their moved pixels to their own masks. One shared set makes the power check like for like.

#### Verdict A: **MERGE**
- B 0, I 2 (W2K-I1, W2L-I9), N 5 (W2K-N1..N4, W2L-N15).
- D4-89's mirror is exact and pinned. The trend, the rows and the focus fix hold. W2K-I1 is a one-line restore before the next official window. W2L-I9 needs a decision and a test round, not a revert: the close-up keeps the rotor test's power.

### B. w2/cycle-hold @7f3fb22 (rounds 2-3)

**What holds:**
- **W2H-B1 is fixed on the default model, and P5b holds between its samples.**
  - P5b's scenario on a fine grid (`w2h-pass16` fine; 32 frame steps from 1/120 to 1/30 s, at ISA and ISA+30): the longest hold is 0.24-0.39 s (0.39 at dt 0.023, which P5b does not sample). N1 while held is ≤ 39.3 %, there is no throw, and every run ends matched.
  - Pass 15's `w2h-reach` on trial16: ISA 0.20-0.27 s and ISA+30 0.20-0.27 s at dt 1/60-0.1 (main 0.10-0.15 s). Pass 15 had 7.88 s, 198 % and the ISA+30 throw.
  - Pass 14's six-ambient sweep (`w2h-pass16` sweep, caught; dt 1/60, 0.02, 1/30, 0.05): 144 runs, no throw. Only the surge-plus-flameout plan holds (24 runs, every ambient and step), for 0.05-0.27 s, with N1 ≤ 42.7 % while held. Pass 15 had 7.88 s at dt 0.02 and the ISA+30 throw that stopped the sweep.
- **The guards refuse no physical root I could find.** On the default model the smallest compressor rise on any matched step is the ground idle's booster, 0.98-1.54 K. It is idle-like on every plan and ambient (the fine grid and the sweep).
  - The matched-path fingerprints equal main's: slam-chop 677bc456986a5a05, c12 c34d477cd5c496da, start dd082a71bf4f71e5, part-lever 0b0723fc0d3f481e, on trial16 and on main 10b78ad's `src`.
  - hot-surge-flameout is d8672202aee1546d, as the handoff says (main: 63915b7e9bdc421b, the held path).
  - What the guards do admit is W2H-N9.
- **P5b gates what D4-94 says:** the scenario, the seven sampled steps, ≤ 0.5 s per episode, N1 ≤ the redline while held, read from the contract (`heldRecovery.test.ts`), and the escalation recorded as the exception.
  - Its N1 half cannot fail while the clamp stands. That is fine: the clamp is the fix, and BH8 (the clamp at 1.01 × the redline) is killed by `heldModel`.
- **The escalation runs at most once per episode** (`model.ts:917-925`, `:900-901`). `escalated` resets only at an episode's first lost snapshot. `heldModel.test.ts:260-298` pins once, ≥ 0.25 s, and again in a second episode.
  - Mutants: BH3 (the episode start never recorded) and BH4 (escalating at 0.5 s) are killed. BH2 survives: the escalation's walk reset is untested (W2H-N7).
- **The redline clamp is right** (`model.ts:722-731`): only on a held snapshot, after the integration, and `dn1`/`dn2` are taken after it. A matched overspeed is still flagged.
- **W2H-I2's test and W2H-I3's guards are in.** BH7 (a surge never waits) is killed. N2 is pinned (BH1 killed).
- **The Stryker survivors' classification (`docs/MUTATION.md`, round 3) is right where I checked it:**
  - 722 is equivalent on the tested paths (the FADEC keeps a matched N1 under the redline);
  - 893 is the unreached fallback text;
  - 918 `>` is the 0.25 s boundary;
  - 170 `>=` is H exactly 0.
  - BH5 shows what the measure-zero label leaves out (W2H-N8).

**The part-power fit (the builder's NEEDS A DECISION 1)** (`w2h-pass16` fit; trial16 against main 10b78ad, D4-13's retry):

| fit, 60 Hz unless noted | main (D4-13) | trial16 |
|---|---|---|
| 1 s ramp, ISA, 23 s (heldFrame's case) | never recovers, N1 274.9 %, booster rise −103 K | recovers; ends matched at N1 101.0 % |
| the same at dt 1/30; a 0.5 s ramp | episode 1 2.60 / 2.95 s | episode 1 **6.77 / 6.60 s** |
| 1 s ramp, ISA+15 | never recovers, N1 176 % | **never recovers: ends held at N1 104.0 % (the clamp), the last episode open 6.6 s** |
| TO + surge 10 s + flameout 20 s | ends matched, N1 101.5 % | **throws at 27.95 s** (below) |
| slam / chop / reslam | never recovers, N1 396 % | ends matched; holds 4.5 s |

- So W2H-I1 is not closed on the fit. It changed shape: bounded above, but not gone (W2H-I4).
- The handoff's "episode 1 recovers at 11.67 s onto a physical root" does not hold.
  - The step after it (11.73 s, N1 56.6 %, N2 86.8 %) is matched with a booster rise of 0.61 K, beside a 12.2 K fan-core rise.
  - That is the booster-cooling branch just before it crosses zero, and episode 2 starts on it at 11.75 s ("-0.168 K").
  - The +0.61 K the handoff quotes as the smallest rise is that root.

#### Blocking
None. W2H-B1 is fixed.

#### Important
- **W2H-I4 (the part-power round; follows W2H-I1): on the part-power fit the held spools still carry the state off any root.** The clamp bounds them only above, so a held episode can end in the sub-idle model with an impossible N1/N2 pair, which throws (`src/cycle/model.ts:722-731`, `:869-878`, `:1015`; `src/thermo/gas.ts:192`; `w2h-fitthrow.probe.ts.txt`).
  - The scenario: the fit, ISA, take-off, surge at 10 s, flameout at 20 s and the auto relight, at 60 Hz.
    - Held from about 24 s, the held balance takes N2 from 98 % to 57 % while N1 climbs from 60 % to 83 %.
    - At 27.95 s the snapshot crosses the sub-idle switch, and `subIdle()` is asked for N1 83 % at N2 57 %. It throws `enthalpy 4411409 is outside the range of [200, 3500] K`: SIM STOPPED.
    - Main recovers in the same run.
  - With the fit at ISA+15 the ramp ends held at the redline. The recovery D4-94's question rests on is one point of a fragile landscape: dt 1/30 or a 0.5 s ramp holds 6.6-6.8 s.
  - Not reachable from the app's controls (the fit is only the `cycle` prop, with no UI), and not on the default model (the sweep). So it does not block this merge. D4-94 item 3 keeps W2H-I1 on the part-power backlog, and this is what that round must cover.
  - The fix (that round):
    - bound the held spools below as well, e.g. hold N2 at or above the sub-idle switch while held, or stop integrating a balance whose sign the held point no longer supports;
    - refuse a sub-idle entry from a state the similarity model cannot represent, with a named cause;
    - a fit row across ambients and frame steps (ISA, ISA+15, 1/30 s, a 0.5 s ramp), with every episode bounded and a recovery onto a root with a plausible booster rise.
  - Answer to NEEDS A DECISION 1: don't rely on N2 for the fit, and keep W2H-I1 open.

#### Nits
- **W2H-N7: the escalation's walk reset is untested** (`model.ts:923`, `this.retry = { walk: null, walkStartedS: this.t }`). BH2 drops it and every fast test passes, though the doc says the escalation "counts as a walk start". Fix: a `heldModel` case in which an episode escalates with a walk in flight; after a failed escalation, the next walk sets out no earlier than `walkIntervalS` later.
- **W2H-N8: `hpcCubic`'s H ≤ 0 boundary is untested in the crossover** (`surgeSystem.ts:170`; `surge.test.ts`). BH5 (the guard as `h < -1`) passes, because the throwing speeds sit at H ≪ 0 (about −1e4 at 1.22). Fix: bisect the speed between 1.15 and 1.2 where H crosses 0, and test just above it.
- **W2H-N9: the guard is a sign test, and on the fit the matched path still lands on the booster-cooling branch while its rise is still above zero.** D4-94 settled "≤ 0", so this is data for W2H-I4, not a re-raise.
  - Matched steps with a booster rise of 0.07 K (slam/chop, 31.37 s, N1 47.8 %, N2 82.3 %, fan core 8.6 K), 0.17 K (ISA+15, 16.40 s) and 0.61 K (the ramp, 11.73 s).
  - On the default model the smallest rise anywhere is the idle booster's, 0.98-1.54 K. So a rise far below the fan core's at the same speed marks that branch before the sign does.

**The builder's other questions:**
- **N3 (P5's check text):** yes, state the window. "23 s from ground idle: 3 s at idle, the 1 s ramp, then the lever held at take-off" is the window D4-90 set P5 from (held-cost.ts `--seconds=20`). It names the gated steps; the bar is unchanged.
- **The `hpcCubic` throw:** keep it. Before, the same speed integrated to a NaN P3 and threw from the detector without a cause; now it throws by name. I could not reach it on a physical root: none of the sweep's 6 ambients × 6 plans × 4 frame steps did, nor the fine grid, ISA−40 included. It marks the HPC map's extrapolation above its top line (the map backlog, D4-3). If a W3 scenario reaches it on a plausible root, the fix is the map, not the guard.

#### Verdict B: **MERGE**
- B 0, I 1 (W2H-I4, for the part-power round), N 3 (W2H-N7..N9). Pass 15's W2H-N1..N6 are closed.
- W2H-B1 and W2H-I3 are fixed on the default model, with margin across the whole frame-step range. The guards change no matched-path fingerprint. P5b is in the contract.
- What remains is the part-power fit, which D4-94 already keeps on the backlog. W2H-I4 gives that round its cases.

### C. w2/flowviz @7dac273 (round 4)

**What holds:**
- **The floor is a display choice, stated where it is drawn.**
  - `drawnOnPlane` (`src/flow/viz/fields.ts:172-174`) and the shader's crisp edge (`src/render/flowViz.ts:391-404`; drawn = clamp((|q − amb| − floor)/fwidth(q) + 0.5)) agree at the floor.
  - The legend hatches the band and says, for each quantity:
    - "Not drawn: 0 to 0.04 M";
    - "0 to 17.5 m/s";
    - "0.841 to 1.19 p / p∞";
    - "0.871 to 1.15 ρ / ρ∞";
    - "243 to 333 K".
  - Each label is followed by "(the ambient ± 2.5 % of the scale)", and the panel note says so too. Checked with `w2v-floor-deltae.probe.ts.txt`.
- **The ΔE rationale is right for viridis and the diverging map and overstated for inferno** (`fields.ts:137-153`; my LUT computation, sRGB D65 to CIELAB):
  - viridis from its end: ΔE76 3.41 (the comment says 3.6) and ΔE2000 1.95;
  - the diverging centre: 3.64 / 4.12 below / above (the comment: 3.8), ΔE2000 2.96 / 4.36;
  - inferno at T∞: ΔE76 12.0 / 13.6, ΔE2000 8.3 / 6.6, about three JNDs. So T's floor hides a band you can see (W2V-N22).
- **Every Data quantity behaves on the GPU** (`pass16.browser.probe.ts.txt` part 2: the plane alone, the MOCK at idle, 273,798 px of footprint, each pixel's nearest LUT entry within 5 % of the map from the ambient's entry, the floor off → on):

| quantity | in the ambient band | drawn |
|---|---|---|
| p | 98.0 → 0.5 % | 2.2 % |
| ρ | 90.5 → 0.9 % | 9.8 % |
| T | 90.5 → 1.0 % | 9.8 % |
| Mach | 46.2 → 6.6 % | 59.6 % |
| \|u\| | 52.8 → 11.8 % | 58.2 % (Cutaway's quantity, not under the bar, as the handoff says) |

  - At take-off: T 1.6 %, Mach 7.1 % and |u| 8.0 % still in the band.
  - p and ρ keep 20 % in it. Those are drawn duct pixels between 2.5 % and 5 % of the scale from the ambient: the map's resolution, not the floor.
  - The suite checks only Mach on the GPU (W2V-I8).
- **Realistic and Schlieren are unchanged:** the floor lives only in the cut plane's material, and neither mode draws a plane. Their browser checks pass.
- **The frames** (`docs/look-dev/flow/data-{idle,takeoff}-{before,after}.png`, viewed):
  - at idle the purple board is gone; the nacelle's outer skin, the stand and the studio show, and the intake capture lobe, the ducts and the plume remain;
  - at take-off the jets, the intake suction and its contours are unchanged, and the still air beyond the plume's spreading edge is clear.
  - What reads badly is W2V-N25.
- **The dock and CSS edits merge cleanly with app-ui** (`git merge-tree` of trial16 with w2/app-ui @5800e4d, its round 4 so far):
  - `src/ui/dock.tsx` and `src/ui/global.css` auto-merge;
  - the only conflict is `docs/PHYSICS.md` at its end, cycle-hold's P5b row against app-ui's new §3.5 (U1-U3): keep both;
  - react-reviewer: the hatched span is decorative and empty, the note is text, the conditionals render null, and no list keys are involved.
- **D4-95's quiet timing rerun** (my test:browser on trial16, `reports/flow/timing.json`):
  - the Realistic flow visuals 0.69-0.72 ms (three pairs) and **tracers 1.20 ms ≤ 2 ms: PASS**;
  - round 4's loaded run had 3.44 ms. P4's render total was 7.60-7.71 ms off (round 3 quiet: 6.42-6.47; the app-ui builder's CPU-only coverage ran beside it).
  - Not a regression: Realistic draws no cut plane, so the floor cannot reach it.

#### Blocking
None.

#### Important
- **W2V-I8: the GPU floor is tested for Mach only, so the legend's "Not drawn" for p, ρ and T is unverified where it is drawn** (`tests/browser/flowViz.test.ts:375-519`; LOOKDEV's "Every Data quantity behaves" rests on the TS mirror, `floor.test.ts`).
  - Mutant V1 (the shader's T floor centred on 0 K instead of T∞, `flowViz.ts:393`) passes the whole W2V-I7 case.
  - The legend would then say "Not drawn: 243 to 333 K" over a plane that draws all of it. My probe shows it: T 90.5 → 90.5 % under V1, against 90.5 → 1.0 % at HEAD.
  - The shader is right today (table above).
  - The fix: loop the browser case over p, ρ, T and Mach with a band measure that does not assume viridis (each pixel's nearest LUT entry, as the probe does), with the same ≤ 10 % bar, stated before it runs.

#### Nits
- **W2V-N22: the floor comment's colour claim** (`fields.ts:141-149`; LOOKDEV round 4). Say "ΔE76 3.4-4.1, 1.5-1.8 JND" rather than "no eye reads it". For T, say the floor is a display choice that hides a visible band (ΔE2000 6.6-8.3): at idle the T view draws 9.8 % of the plane, the hot core only, and the bypass and booster air go.
- **W2V-N23: `floor.test.ts`'s take-off case cannot fail** (`floor.test.ts:130-148`). "Every sample beyond twice the floor is drawn" follows from `drawnOnPlane`'s definition, and the 2 % share is a property of the MOCK. D4-95's explicit timeout is not in yet; it passed in my coverage run.
- **W2V-N24: `docs/look-dev/flow/timing.json` now records the loaded run** (off 7.5-22.3 ms, tracers 3.44 ms) over round 3's quiet one. Re-record it in a quiet run, or restore it. Mine is above.
- **W2V-N25: the crop outline frames nothing at idle** (`flowViz.ts:398-404`; `data-idle-after.png`). Two thin light lines now cross the empty studio above and below the engine and read as stray wires. Draw the outline only where the plane draws, or drop it once the floor hides the sheet.

#### Verdict C: **MERGE**
- B 0, I 1 (W2V-I8, test-only), N 4 (W2V-N22..N25).
- D4-86 is met as decided: a transparent floor, a fixed scale and the legend saying what is not drawn. It holds on the GPU for every quantity, and the board is gone in the frames. The flow timing row passes quiet.

### Gates (trial16: main 10b78ad + w2/kernel @be07478 + w2/cycle-hold @7f3fb22 + w2/flowviz @7dac273)
| gate | result |
|---|---|
| `npm run typecheck` | clean, 17 s |
| `npm run lint` (ESLint + Prettier) | clean, 73 s |
| `npm run coverage` (own reportsDirectory) | 128 files, 2265 passed + 11 expected fail (2276), exit 0 (the per-directory thresholds hold), 835 s. Statements 98.55 %, branches 87.88 %, functions 99.48 %, lines 99.53 %. Core lines: thermo 100 %, cycle 99.62 %, flow/reference 100 %, geometry 99.59 %, src/flow 99.50 %. heldRetry 100 / 100, matchedSolve 100 / 100, model 100 / 98.38, surgeSystem 100 / 96.87, gpu/params 100 / 93.33, viz/legend 100 / 90.74, viz/fields 96.77 / 77.77 (lines / branches). `floor.test.ts`'s take-off case did not time out |
| `npm run test:mesh` | 2 files, 29 passed |
| `npm run test:gpu` | 12 files, 70 passed, 53 s. E-L5 2.67e-8, E-L9a 2.46e-12, C-pre 5.13e-7 / 3.77e-7 / 1.05e-6, S 5.32e-7 / 4.77e-7 / 7.67e-6 |
| `npm run test:gpu-ladder` | 3 files, 13 passed + 1 expected fail (L9a's D4-45 steadiness), 330 s. B 1.266e-11 (velocity 1.954e-5); D4-63 on the GPU (a) 0.7779 / 0.4859, (b) 0.4913 / 0.2111, trend 0.9939; L7 1.779; L8 0.754 % |
| `npm run test:browser` | 13 files, 41 passed, 0 WebGPU errors, exit 0, 456 s, 3.27 GB free at the start. The flow timing row quiet: Realistic 0.69-0.72 ms, **tracers 1.20 ms ≤ 2 ms**. The rotor rows equal the builder's 02cee6f run. W2V-I7: MOCK idle 46.6 → 7.0 %, solver idle 98.9 → 0.0 %, take-off 99.22 % kept. `docs/` stayed clean |

### Mutants (by hand on trial16; `pass16-mutants.sh.txt`; each file restored from a copy after)
| set | killed | survived |
|---|---|---|
| A (kernel; machCut, host, `tests/gpu/oracle.test.ts`) | K1 (WGSL mass flux × (1 + 2e-6 \|n_r\|): E-L9a 1.29e-9 > 1e-10), K2 (M_cut not raised to the cut), K3 (the adapter's `machCut` ignored), K5 (the far field's β from the given minMach) | K4 (the CFL switch from the given minMach: W2K-N1) |
| A (rotorMotion's bound, in Chrome) | legacyTraa in the close-up, band on and off | legacyTraa in the default cutaway pose with the band (W2L-I9) |
| B (cycle-hold; the fast set: heldRetry, heldModel, matchedSolve, gasPathHold, lostSolveCause, surge) | BH1 (N2 removed), BH3 (the episode start never recorded), BH4 (escalating at 0.5 s), BH6 (the booster's rise from station 2), BH7 (a surge never waits), BH8 (the clamp at 1.01 × the redline) | BH2 (the escalation keeps the walk in flight: W2H-N7), BH5 (H < −1 accepted: W2H-N8) |
| C (flowviz, in Chrome) | V1 caught by the critic probe (T 90.5 → 90.5 %) | V1 (the shader's T floor about 0 K) against the suite's W2V-I7 case (W2V-I8) |

**Totals:** A 4/5 unit and GPU, 1/2 rotor poses; B 6/8; C 0/1 in the suite.

### Verdicts
- **A. w2/kernel @be07478: MERGE.**
  - B 0, I 2 (W2K-I1, W2L-I9), N 5.
  - Restore the D0-1 line (W2K-I1) before the next official window. W2L-I9 is the next kernel round's, after question 1.
- **B. w2/cycle-hold @7f3fb22: MERGE.**
  - B 0, I 1 (W2H-I4, the part-power round), N 3.
  - Pass 15's W2H-B1, I2 and I3 are fixed: P5b holds at 32 frame steps, and the matched-path fingerprints are unchanged.
- **C. w2/flowviz @7dac273: MERGE.**
  - B 0, I 1 (W2V-I8, a test), N 4.
  - The quiet flow timing row passes (tracers 1.20 ms).

**Merge order:** kernel, cycle-hold, flowviz (trial16's order). They touch disjoint code, and all three merge cleanly in that order.
- Flowviz goes before app-ui round 4, which adopts its dock and CSS edits at its merge (D4-95). Those auto-merge.
- App-ui round 4 will then conflict with cycle-hold only at the end of `docs/PHYSICS.md` (P5b against §3.5): keep both.

### Questions for the orchestrator
1. **W2L-I9:** for the default cutaway pose, a narrower band whose legacyTraa control fails (stated before the run), or that pose out of the moving bound with the reason stated? Either way, every banded pose gets its own control.
2. **W2H-I4:** confirm that W2H-I1 stays open on the fit with this evidence (an ISA+15 ramp ends held at the redline; the fit's surge-plus-flameout run throws in the sub-idle model after N2 falls 41 points while held), and that the part-power round also bounds the held spools below.
3. **N3:** adopt P5's check-text clarification ("23 s from ground idle: 3 s at idle, the 1 s ramp, then take-off lever")? It states the window D4-90 measured; the bar is unchanged.

## Critic pass 17: w2/app-ui @0f3b21e (rounds 4-5)

**Scope.** `ff95d99..0f3b21e` (code at 3612355; main 10b78ad merged in 602f9bb): D4-91's progressive warm-up, D4-95 items 1-4 (the quiet rule, Schlieren's 44-pipeline warm frame, the guard on three's internals, the warm-up under load), W2A-I6's Schlieren check, U1-U3 and N19, D4-92 (zz)'s callouts, N13-N18 and N20, and the re-shot `docs/look-dev/ui/`. The builder's three questions are answered below.

**Setup** (2026-10-31, the critic worktree):
- `critic` merged main 664203f (a fast-forward from 4f37377). A throwaway local branch `trial17` took one `--no-ff` merge of w2/app-ui @0f3b21e (93a9d9b) with two doc conflicts, both resolved by keeping both sides:
  - `docs/PHYSICS.md` at its end: cycle-hold's P5 and P5b rows, then app-ui's §3.5 (U1-U3), as expected;
  - `docs/GPU_FACTS.md`: **both branches added an M56** (main's is kernel's Playwright focus emulation; app-ui's are M56 and M57). I kept main's M56 and renumbered app-ui's to M57 and M58 in the trial (W2A-N27).
- `src/ui/dock.tsx` and `src/ui/global.css` auto-merged: flowviz round 4's legend band is in the merged app (checked in my shots, Visual review).
- Every gate ran alone and detached (`Start-Process`, one script, a status line per step with the free memory and the power state), on trial17. Then the probes and the hand mutants, after the gates (nothing mutated `src` while a gate read it).
- The builder's worktree was only read.
- `critic` is checked out again and clean. The local branch `trial17` (93a9d9b, unpushed) is left in place, because the PreToolUse hook blocked `git branch -D`: the orchestrator can delete it. No detached run or Chrome is left going.

Checklists: react-reviewer, typescript-reviewer, silent-failure-hunter and pr-test-analyzer, applied by hand as one review. D4-85, D4-87, D4-88, D4-91, D4-92, D4-95 and D4-96 were checked against the code: nothing here contradicts them (D4-91's "never a freeze" is W2A-I7's subject; D4-92 (zz)'s outward labels are met at 1920 only, W2A-I8).

**What holds (read, then probed or mutated):**
- **The scheduler (`src/shell/warmUp.ts`).**
  - A pending switch and any input suspend the background: `next()` extends the quiet to now + 1 s on every pending frame (`:150`) and gives the background nothing while `now < quietUntil` (`:152-156`). An earlier input cannot shorten it (`Math.max`).
  - The worker's "pending" is `preparing !== null || settledFrames === 0` (`simWorker.ts:380`), so it covers the 1.4 s wedge, and the 1 s runs from the last pending frame. The inputs are every message but `init` and `viewArea` (`simWorker.ts:534`).
  - The queue cannot starve on its own: no message reaches the worker periodically. `resize` is sent only on a change (`client.ts:74-80`), commands and orbit only on the viewer's acts, and `viewArea` is not an input. Continuous orbiting holds the background back, as D4-95 says it should.
  - Mutants W1-W4 and Q1 are killed (Mutants).
- **The warm frame puts the view's state back** (`engineView.ts:865-958`): mode, cut, explode, spool factor, the flow mode, quantity and tracers, and the fan frame are saved and restored in a `finally`. The flow mode is re-applied, so `post.setFlowComposite` and flowViz's plane material are back. Everything else the frame sets (module offsets, visibility, caps, the wedge, glow, the fan rect) is recomputed by the real frame after it. The pass timer discards the frame, the render scale is not stepped, and the tracers' compute is not run. The one exception is W2A-I9.
- **TRAA's state is put back** (`post.ts:455-476`). The warm frame resolves into a throwaway history (three's resolve material samples the real history's texture, bound at setup, so the real history is read, never written). The previous depth, the jitter index and the six camera uniforms are restored. three r186's `updateBefore` (TRAANode.js:347-436) mutates nothing else that persists: `setSize` follows the beauty's size, which the real frame shares.
- **The warm key is three's render object key.** `RenderObjects.get` chains object, material, render context and lights node under a per-pass map (three.webgpu.js:31541-31551). `renderKey` takes the same four and the pass id from `renderObject`'s arguments, plus `_currentRenderContext`, which `_renderObjectDirect` passes on.
  - Two places where three makes more render objects than the key sees, both counted inside the new object's draw, so neither escapes the budget: a transparent double-sided material draws a `backSide` pass inside the same `renderObject` call, and a cache-key change re-creates a render object under the same key.
  - Any miss would be counted (`unbudgeted`), and warmStall fails on one. In my run, no configuration built an unbudgeted pipeline and none recompiled an object the boot drew (Gates).
  - Mutant K1 (the key without the render context) is killed.
- **Schlieren's composite now builds the beauty first, and the image is the same** (`post.ts:607-620`). The select is unchanged, and the passes render once a frame.
  - Checked in Chrome (`w2a-schlieren-same.py.txt`, the luminance inside the 1366 view): HEAD against round 4's order (mutant S2, shot) gives a mean |ΔL| of 0.48/255, 1.5 % of pixels over 8 and 0.12 % over 24.
  - That is within the run-to-run noise: HEAD against the builder's own shot is 0.58, 1.8 % and 0.34 %. The knife edge off (S1) is 3.1, 5.8 % and 3.3 %.
  - The signatures agree to the third digit: grey share 0.774 / 0.774, silhouette 0.253 / 0.254, jet spread 0.174 / 0.174. My HEAD Schlieren signatures also equal the builder's at both sizes.
  - S2 is killed by warmStall's "recompiled" (42 engine objects rebuilt).
- **The guard test** (`tests/unit/render/threeInternals.test.ts`) fails when a named internal moves: mutants G1-G3 in `node_modules/three` are killed. G4 survives, by design (W2A-N26).
- **N13's prune is now sound.** With the 2000-node budget lifted, a branch is cut on crossings only when the best already shows the same labels so far and every later one, and a label is hidden early only when the best shows it on the same prefix. Both cuts leave the result unchanged. The search is still not exact, for another reason (W2A-N21).
- **The panel-covered rule** (`callouts.ts:62-65`, both layouts) is right. A panel covers the part (the drawer is opaque, the columns 0.86 alpha), so a leader into it would point at nothing the viewer sees. It hides only parts whose anchor point is covered: 6 of 8 labels at 1920 with the drawer open, 2 at 1366, where the drawer covers most of the engine. The drawn bar does not check it (W2A-N28).
- **U1-U3 and N19**: `uiLevels.ts` mirrors §3.5 verbatim (its test reads PHYSICS.md), the map reads U1, and the 5.0 % case is pinned (mutant U1 killed). **N14**: `faults.ts` is pure and the worker calls it; the messages are unchanged (F1 killed). **N15-N18, N20**: as the handoff says. N20 is checked every run in warmStall: no pipeline on the solver's first bind or a profile change.
- **React and TypeScript.** No effect posts on every render. `viewArea` is posted from the callouts' layout effect on a mode, panel or size change; StrictMode's double run posts it twice, which is harmless. The preparing chip is `role="status"` with its name, and renders nothing for null. The worker's new messages and fields are typed end to end. The only casts are the three internals, now in one module.

#### Blocking
None.

#### Important
- **W2A-I7: a cold switch has no bound; under a steady frame CPU over 8.3 ms it never leaves "Preparing"** (`src/shell/warmUp.ts:151`, `:155-163`; pinned as intended at `tests/unit/shell/warmUp.test.ts:208-213`).
  - Every slot needs the last frame's CPU ≤ `SLOT_FRAME_CPU_MS`, the asked view's included. `MAX_WARM_FRAMES` counts the slots given, not the frames waited, so the give-up never comes either.
  - The probe (`docs/reviews/probes/w2a-cold-switch.probe.ts.txt`) clicks Cutaway at t = 0 and runs 10 min at 60 fps:
    - a steady 8.4 ms frame: **0 slots, never warm, nothing given up**;
    - 11.2 ms (critic 15's held frame in the worker): the same;
    - 8.0 ms, or a loaded 9-14 ms with one frame in 50 at 8 ms: slots from the first frame.
  - The failure: a machine whose shown view costs a little more CPU than this one gets a switch that shows "Preparing the Cutaway view…" for good. This one is near the edge already: under load the builder's gate run took 45-48 s to Cutaway, and my run's median frame at the fit's idle is 7.7 ms, 0.6 ms under the bar. The background never warms either, so every mode switch is that switch. The app is stuck in Realistic, with a spinner that says it is working.
  - D4-91 says a cold switch "switches as soon as the mode is ready", never a freeze. D4-95 item 3 keeps the slot rule for the background; this is the viewer's own switch.
  - Fix: for the asked view only, a bound in frames waited. For example, after 60 frames preparing, take the next SLOT_EVERY slot whatever the last frame's CPU, and count waited frames toward the give-up. Pre-register the bound (e.g. "shown within N s at any frame CPU") and pin it with a unit case at a steady 11.2 ms.
- **W2A-I8 (visual): at 1366 x 768 the cut views' eight labels still sit on the section they name** (`src/hud/callouts.ts:272-339`; `1366-2-cutaway.jpg`, `1366-5-data.jpg`, and my merged run's).
  - D4-92 (zz) asked for labels "placed outward in axial order so they label their parts instead of reading as a list". At 1920 half do: the four in the row above the engine are clean, the other four sit beside their anchors on the core.
  - At 1366 the engine's screen box fills the free area, so neither row has room and the general search clusters all eight on the core. Booster, HPC, Fan, Low-pressure turbine, Bypass duct, Combustor, Core exhaust and High-pressure turbine cover roughly 470-1045 x 195-350 px, the section they name.
  - The axial order is lost too: the Low-pressure turbine's label sits left of the High-pressure turbine's.
  - Nothing overlaps or is clipped, so the bar passes, but the part ↔ label link is round 3's.
  - Fix: frame the cut views for their rows, as Schlieren's `framedOrbit` does: dolly out until the engine box leaves a row's height above and below in the free area, at most to a stated scale. Or show fewer labels at that size, by priority, with the rest in a key. Shoot both sizes.
- **W2A-I9: a warm frame zeroes the next real frame's camera motion** (`src/render/post.ts:638-645`, `:727-738`; the claim at `:175-176` and in the handoff).
  - `renderFrame` copies `currViewProj` into `prevViewProj` and then writes this frame's into `currViewProj`, on every call, the warm one included. The warm path restores `prevViewProj` and `havePrev` but not `currViewProj`.
  - So the real frame after a warm frame copies *this* frame's view-projection into `prevViewProj`: previous = current.
  - With the lean G-buffer (the default, `post.ts:209-210`) that matrix is the camera velocity of every scene pixel (`cameraLoad`, `:392-399`), and of the rotors (`:414-418`). So in that frame TRAA reprojects its history as if the camera had not moved.
  - When it shows: the camera moves while warm frames run. Input suspends only the background; a cold switch's own view keeps warming while the viewer orbits under "Preparing" (seconds quiet, tens of seconds loaded). Every second frame is then reprojected with no camera motion, so the image smears and judders while dragged.
  - Restoring `prevViewProj` is a no-op, since the next real frame overwrites it from `currViewProj`.
  - Fix: save and restore `currViewProj` and `currViewProjInv` in the warm path (or skip the matrix roll when `warm`). Add a check that a warm frame between two real frames leaves the second's `prevViewProj` equal to the first's `currViewProj`, e.g. a debug read of the uniforms in warmStall.
- **W2A-I10: W2A-I6 is not closed: the Schlieren check passes a Schlieren with no knife-edge image, and on the merged tree it passes the Cutaway and Data frames at 1920** (`tests/browser/lib/schlierenCheck.ts:19-29, 93-99`; `tests/browser/app.test.tsx:349-354`; mutant S1; my `reports/ui/1920-shots.txt`).
  - **S1 survives in Chrome.** With the knife edge compositing nothing (`eps` x 0, `post.ts:608`) the jet is gone: a uniform grey behind the nozzle (`reports/scratch/c17/s1-ui`, viewed). Yet the 1366 signature passes: grey share 0.866, silhouette 0.253, jet spread **0.100 ≥ 0.08**.
    - The signature is computed on the page screenshot, overlay included (`app.test.tsx:74-75`, `shoot()`). The Core exhaust callout, a dark glass box with white text, sits right behind the nozzle in Schlieren, inside the jet box.
    - In the S1 shot every dark pixel past the silhouette at x = 950-990 is that label (rows 265-300). So the "banded jet" the bar sees is partly the label's text.
    - That is W2A-I6's own named failure ("a Schlieren that composites nothing ... passes the suite"). D4-91 item 2 accepts the skipped lit-centre bar only with a check that sees it.
    - The unit test's bandless frame fails as it should only because it has no overlay in the jet box.
  - **The cut views pass at 1920 on the merged tree.** Flowviz's floor (D4-86, on main) took the purple board out of the cut views, so the studio's grey shows round them.
    - My run: Cutaway grey share 0.315, silhouette 0.41, jet spread 0.137, **pass: true**; Data 0.313 / 0.43 / 0.135, **pass: true**.
    - The builder's shots, from before that merge, show 0.234 / 0.40 / 0.095 and 0.234 / 0.42 / 0.094, failing on the grey share alone. At 1366 both still fail on it (0.22-0.23).
  - **Two of the three bars fail no control.**
    - The grey bar (0.3) sits under Realistic's and Exploded's own 0.31-0.35 at 1920.
    - The jet bar (0.08) sits under all four controls' 0.11-0.15 and under S1's 0.10.
    - Only the silhouette bar fails anything (Realistic 1.18, Exploded 0.68 against 0.5), and the test makes only Realistic and Exploded controls.
    - The unit test's "studio background" is 0.12-0.22 luminance; the real studio is 0.47.
  - **Fix, as D4-96 asked for W2L-I9: each bar gets its own failing control, stated before the run.**
    - Compute the signature on the canvas alone (the overlay hidden for that shot, or the worker's own frame), not on the page with its callouts and legend.
    - Make S1 (`eps` x 0) a standing control, e.g. a debug flag that zeroes the knife edge in the same run.
    - Make Cutaway and Data controls too.
    - Put the grey share between Schlieren's 0.77-0.82 and the controls' ≤ 0.35 (e.g. 0.6).
    - Write the unit test's controls at the studio's measured grey, and add one with a label-like box in the jet region.

#### Nits
- **W2A-N21: the layout search is still not exact; it tries only the first crossing place per label** (`src/hud/callouts.ts:220-224`).
  - N13's prune is sound now. But a label with no crossing-free place gets one crossing place, the first, so a layout that needs it at its second (the first blocking a later label) is never tried.
  - The probe (`docs/reviews/probes/w2a-callout-exact.probe.ts.txt`) compares the search's own objective (the shown labels by priority rank, then the fewest crossings) with an exhaustive search over the same places:
    - pass 15's regime (3-5 anchors, 140 x 36 in 420 x 300): exact, 0 of 3000;
    - the app's scale (6 anchors, 128 x 34 in 900 x 520 with a side panel): 0 of 200 short of the best; 2 of 200 with one crossing more, the node budget's (0 with it lifted);
    - dense cases (5 anchors in 360 x 280), **budget lifted**: 17 of 1500 show one label fewer than possible and 11 have more crossings;
    - with every crossing place tried, 0 and 0.
  - First case: anchors (244, 143), (133, 153), (247, 80), (66, 87), (181, 93): the 5th is hidden though all five fit.
  - The unit test's brute force counts labels in pass 15's sparse regime, so it cannot see this.
  - Fix: try every crossing place, ordered by its crossings (the bound prunes them), and add a dense case from the probe.
- **W2A-N22: the background warm-up's state is not on screen, and its give-up is not "said"** (`src/ui/panels.tsx:384-385`; `src/shell/warmUp.ts:76-80`).
  - Diagnostics shows only "Pipeline warm-up (D4-88) … ms at boot", with the old decision's label.
  - Nothing on screen shows the queue, the configurations given up on after MAX_WARM_FRAMES (whose last pipelines then compile on first use, a stall), or the suspension. They are in the snapshot only.
  - Fix: a Diagnostics row ("Background warm-up: 7 of 9 warm, …; given up: …") under D4-91's label.
- **W2A-N23: the boot's `warmUp` stops after 8 warm frames without saying whether it finished** (`src/render/engineView.ts:849-856`; `src/app/simWorker.ts:671`).
  - `WarmUpReport` has no done flag, and the worker marks the boot configurations warm regardless.
  - If a boot configuration is still compiling after 8 rounds, the first real frames compile the rest synchronously, after `ready`, unseen.
  - Fix: report `done` per configuration; leave an unfinished one to the scheduler (not marked warm), or push an error.
- **W2A-N24: Schlieren's restore discards an orbit made in Schlieren** (`src/app/simWorker.ts:330-335`, `:556`).
  - Leaving Schlieren puts back the orbit from before it; only a camera preset cancels that. A viewer who orbits in Schlieren and then switches jumps back to the old pose.
  - Fix: an orbit input in Schlieren cancels the restore too (or the restore undoes only the framing's dolly and pan).
- **W2A-N25: `fitViewOffset` is dead, and `framedOrbit` is tested only loosely** (`src/hud/callouts.ts:346-363`, `src/shell/orbit.ts:119-146`; `tests/unit/hud/calloutLayout.test.ts:222-252`, `:276-287`).
  - The app frames Schlieren with `framedOrbit`. `fitViewOffset` is used nowhere but its tests, which check its fit exactly.
  - `framedOrbit`'s test checks only that the distance and target changed, not that the content box lands in the free area. In the shots it fills the free area edge to edge (Visual review).
  - Fix: delete `fitViewOffset`; test `framedOrbit` by projecting `engineRings` after the orbit.
- **W2A-N26: the guard pins the internals by name, not what TRAA's `updateBefore` rolls** (`tests/unit/render/threeInternals.test.ts:149-182`).
  - G4 (three's `updateBefore` given one more piece of per-frame state) passes the guard, yet a warm frame would no longer put TRAA back.
  - That is the upgrade case D4-95 item 4 is for.
  - Fix: pin `updateBefore`'s source (a hash, or the list of `this._…` it assigns), so any change to it fails CI and is read.
- **W2A-N27: GPU_FACTS numbering collides at the merge.** Main's M56 is kernel's Playwright focus emulation (`docs/handoffs/w2-kernel.md:24` cites it); app-ui adds M56 and M57.
  - `post.ts:605` ("GPU_FACTS M56") and the handoff cite app-ui's numbers.
  - Fix at the merge: app-ui's become M57 and M58, as in trial17, and the citation follows.
- **W2A-N28: the drawn layout bar does not check round 5's rule or leaders against panels** (`tests/browser/app.test.tsx:193-237`).
  - `calloutProblems` checks labels against labels and reserved blocks, and leaders against leaders and labels.
  - An anchor under a reserved block, or a leader that crosses one, passes in Chrome. Only the pure layout's unit test holds the rule, and nothing checks a leader through a panel.
  - Fix: add both to `calloutProblems`.

**The builder's three questions:**
1. **The quiet rule as read: yes to both.**
   - A cold switch's own view must warm during the quiet, or it could never be shown. U2 is the first switch into a *warmed* mode, so that view's warm frames are not in U2's window. The cost is W2A-I9: those frames run while the viewer may be orbiting.
   - `viewArea` is right not to be an input. The overlay posts it on a mode, panel or size change. The mode change is already a command and the size change a `resize`, so counting it would double-count. A panel toggle is a main-thread act that reaches the worker only as `viewArea`, but it moves no 3D content.
2. **Cutaway's own warm frames:** accept them as measured. My main-thread probe: 47 warm frames over 1.9 s, at most 41 ms of warm-frame CPU, the longest frame gap 34 ms. In the app, the longest snapshot gap while warming was 108 ms (Cutaway) and 125 ms (Schlieren); every configuration was warm 7.0 s after ready.
   - A single node build cannot be split, so "one always let through" is the floor of this design. It costs about two dropped frames each, for about 2 s, once, a few seconds after boot, behind the viewer's quiet second.
   - What it does need: the slot rule must not be what makes the viewer's own switch wait (W2A-I7), and the cost should be recorded beside U2/U3 as the background's own row (its longest gap and its count of frames over 16.7 ms), indicative, so a regression shows.
3. **The panel-covered rule: keep it.** A label must never point under a panel, and the rule hides only what a panel covers (above). Two follow-ups: the drawn bar should check it (W2A-N28), and at 1366 the cut views need the room that W2A-I8 asks for more than this rule needs changing.

### Visual review (all 13 shots in `docs/look-dev/ui/` at both sizes, and my trial17 run's 13 in `reports/ui/`, which carry flowviz's floor)
**What reads, at the bar:**
- **The chrome holds up:**
  - restrained glass panels, tabular numerals in every readout and table;
  - the coloured badges (CYCLE: MODEL, FIELD: MOCK, MATCHED, SOLVER IDLE/RUNNING);
  - legible small text;
  - nothing clipped or overlapping at either size, the drawer included. At 1366 the drawer now stops above the taller legend.
- **The closed views' Fan label is on the fan** (pass 15 visual note 1, fixed): its dot sits on the fan face seen through the intake, with the label beside it over the spinner, in Realistic and Schlieren at both sizes. Core exhaust sits on the core cowl.
- **The 1920 cut views' top row reads well:** Fan, Bypass duct, Combustor and Low-pressure turbine in axial order under the top bar, with vertical leaders to dots on their parts. The Bypass duct's dot is in the duct now.
- **Schlieren is framed in the free area** (pass 15 note 3, fixed):
  - at 1366 the engine is dollied out and the banded jet ends at the right column's edge instead of running under it;
  - at 1920 the engine and jet fill the free area from the left column to the right.
- **The legend's floored band shows in the merged app:**
  - Cutaway: "Not drawn: 0 to 17.5 m/s (the ambient ± 2.5 % of the scale)";
  - Data: "Not drawn: 0 to 0.04 M …";
  - a hatched swatch at the bar's left end, at both sizes.
  - The purple board is gone from both cut views: the studio shows round the near field.

**Short of "ultra high level":**
1. **The 1366 cut views' labels** (W2A-I8): eight dark boxes over the section, the main thing those views exist to show. At 1920 the four labels beside their anchors (Booster, HPC, HPT, Core exhaust) also sit over the core.
2. **Schlieren has no margin at 1920:** the nacelle's lip touches the left column and its lower lip the station strip. A framing margin of a few per cent of the free area would let it breathe.
3. **Flowviz's crop outline (W2V-N25) now crosses the app's shots:** with the board gone, its thin light lines run across the studio in both cut views at both sizes (top left of the nacelle, and right of the plume). They read like stray leader lines next to the callouts' own.
4. **Exploded has no labels at all**, though it is the view where the parts stand apart and a name on each would read best. That is not a regression, and not in D4-92; a suggestion for the callouts' next round.
5. **Small ones:**
   - "Preparing the Data view…" also shows for a quantity change inside Data (a cold `data:p` while Data:mach shows). "Preparing the pressure field…" would say what is happening.
   - The T-s "45" still sits on the 4 → 45 line at 1920.
   - The fan at idle is still a bristly smear in Realistic (render's, W1L).
   - Visual notes 5 and 7 are open, as the handoff says.

### Gates (trial17: main 664203f + w2/app-ui @0f3b21e)
Power: on battery (status 1, 73 %) at the start, then **on AC (status 2) from the end of lint onward**. Every timing row below ran on AC, on a shared machine, so the rows are indicative (D0-1).

| gate | result |
|---|---|
| `npm run typecheck` | clean, 15 s (battery, 73 %) |
| `npm run lint` (ESLint + Prettier) | clean, 71 s (battery → AC) |
| `npm run coverage` (own reportsDirectory) | 135 files, 2320 passed + 11 expected fail (2331), exit 0 (the per-directory thresholds hold), 769 s. Statements 98.55 %, branches 87.87 %, functions 99.55 %, lines 99.54 %. Core lines: thermo 100 %, cycle 99.62 %, flow/reference 100 %, geometry 99.59 %, src/flow 99.50 %. New modules at 100 % lines: warmUp (94.4 % branches), faults, uiLevels, settle, pixelCap, callouts (86.2 %), anchors (87.0 %), orbit (78.7 %) |
| `npm run test:mesh` | 2 files, 29 passed |
| `npm run test:gpu` | 12 files, 70 passed, 46 s. C-pre 5.13e-7 / 3.77e-7 / 1.05e-6, S 5.32e-7 / 4.77e-7 / 7.67e-6 (pass 16's) |
| `npm run test:gpu-ladder` | 3 files, 13 passed + 1 expected fail (L9a's D4-45 steadiness), 301 s. B 1.954e-5 (oracle 1.49e-5); D4-63 on the GPU (a) 0.7779 / 0.4859, (b) 0.4913 / 0.2111, trend 0.9939; L7 1.779; L8 0.754 %. Equal to pass 16's: app-ui touches no solver code |
| `npm run test:browser` | **14 files, 44 passed**, 0 WebGPU errors, exit 0, 445 s, **AC (2/86 → 2/90)**, 6.48 GB free at the start, no other vitest-browser or Chrome for Testing process. `docs/` stayed clean (the shots went to `reports/ui/`) |

**The browser run's records** (AC, shared machine, not quiet; `reports/ui/first-switch-*.json`, `warm-stall.json`):
- **U3, boot to ready:** 3.85-4.28 s over the four first-switch cases (≤ 5 s).
- **U2, the first switch into a warmed mode** (the longest snapshot gap in the 3 s after the click):
  - Schlieren 72 ms (echo 205 ms);
  - Cutaway 81 ms (echo 123 ms);
  - while the queue warms (6 queued at the echo), 72 ms, with 0 warm frames from the echo to settled (1.55 s), resumed 2.55 s after the click, and all 9 warm 7.0 s after ready.
- **The background warm-up's longest gap:** 108 ms to Cutaway, 125 ms to Schlieren.
- **A cold switch into Data:** "preparing" after 98 ms, shown after 3.07 s, the longest gap 91 ms, 43 snapshots while preparing.
- **warmStall, the main-thread probe:**
  - Cutaway: 47 warm frames, 42 pipelines, at most 41 ms of warm-frame CPU, the longest frame gap 34 ms, GPU ping ≤ 67 ms;
  - Schlieren: 3 frames, 2 pipelines, 8 ms;
  - every Data quantity and Exploded: 2-3 frames, ≤ 11 ms;
  - no unbudgeted pipeline, nothing recompiled;
  - N20: the solver's bind and the profile change built 0 pipelines (frame CPU ≤ 9 ms).
- **D4-85's render, indicative:** Realistic over a full window 9.96 ms at 1366 (backing 1920 x 1079) and 9.72 ms at 1920 (1994 x 1039), against P4's 8 ms. Chrome ran at DPR 1.5.
- **The flow timing row** (`reports/flow/timing.json`): Realistic flow 0.58-0.70 ms, **tracers 1.05 ms ≤ 2 ms**.
- **W2F-N5's held frame** (`frame-cost.json`): median frame CPU 7.7 ms at the fit's idle (cycle 2.4 ms), held 8.7 ms, max 95 ms over the slam; 982 lost solves, 158 of 384 snapshots held.

### Mutants (by hand on trial17; `pass17-mutants.sh.txt`; each file restored from a copy after, `git status` and three's md5 checked)
| set | killed | survived |
|---|---|---|
| Scheduler (`warmUp.ts`; `warmUp.test.ts`) | W1 (a pending switch no longer suspends), W2 (input and switches ignored), W3 (a cold switch waits behind the quiet), W4 (the give-up never fires) | none |
| The chip and the faults (RTL, Node) | P1 (the chip never cleared: it shows a mode when null), F1 (the fatal on every failure past the max) | none |
| Callouts (`calloutLayout.test.ts`, `uiLevels.test.ts`) | L1 (a label under a panel: round 5's rule dropped), L2 (N13's old prune), L3 (the cut views on the lower face), U1 (amber at exactly 5 %) | none |
| The guard (`threeInternals.test.ts`; `node_modules/three` edited) | G1 (TRAANode's `_jitterIndex` renamed), G2 (RenderObjects.get's chain reordered), G3 (`renderObject`'s `lightsNode` renamed) | G4 (TRAA's `updateBefore` rolls one more field: W2A-N26) |
| Chrome (targeted runs) | S2 (round 4's composite order: warmStall, 42 recompiled), K1 (the warm key without the render context: 8 unbudgeted), Q1 (the worker never reports a pending switch: firstSwitch, resumed at 1.22 s before settling at 1.59 s) | **S1 (the knife edge off: the Schlieren check passes, W2A-I10)** |

**Totals:** 16 of 18 (unit and RTL 10/10, guard 3/4, Chrome 3/4). Not mutants: the probes. They are the cold switch at a steady frame CPU (W2A-I7), the exact search (W2A-N21), and the S2 image comparison.

### Verdict: **MERGE**
- B 0, I 4 (W2A-I7..I10), N 8 (W2A-N21..N28).
- D4-91's progressive warm-up and D4-95 items 1-4 are in as decided:
  - boot to ready 3.9-4.3 s;
  - a warmed switch 72-81 ms with the queue active;
  - Schlieren's warm frame 8 ms (was 645-706);
  - the guard fails CI when a named internal moves.
- The callouts meet D4-92 (zz) at 1920. N13's prune is sound. The gates are green on the combined tree, and 16 of 18 hand mutants are killed.
- None of the four Important findings makes main worse on the target machine. All four go to app-ui's next round:
  - **I7 first:** a dead switch on a slower machine. On this one, the fit's idle frame is 0.6 ms under the slot bar.
  - I9 is a two-line render fix.
  - I10 is a test whose controls must fail.
  - I8 is the 1366 framing.
- At the merge:
  - keep both sides of `docs/PHYSICS.md` (P5/P5b, then §3.5);
  - renumber app-ui's GPU_FACTS entries M57/M58 and update the citation (W2A-N27).
  - Flowviz's dock and legend edits auto-merge and show in the app (D4-95).

### Questions for the orchestrator
1. **W2A-I7:** what bound for a cold switch? I suggest that the asked view takes a slot after at most 60 frames of preparing, whatever the last frame's CPU (still one every SLOT_EVERY). The bar would be pre-registered as "a cold switch is shown within N s at any frame CPU", with the give-up counting frames waited. Or should the asked view ignore the CPU rule outright, since the viewer is waiting on it?
2. **W2A-I8:** for the 1366 cut views, should the camera dolly out to make room for the label rows (as Schlieren's framing does, at a stated minimum scale), or should that size show fewer labels by priority?
3. **W2A-I10:** confirm that W2A-I6 stays open. The signature would move to the canvas alone, with each bar given its own failing control (S1 standing, plus Cutaway and Data), per D4-96's rule.
4. **The builder's question 2:** accept Cutaway's own warm frames as measured (47 frames, ≤ 41 ms, ~2 s, once), and add the background warm's own indicative row beside U2/U3 (its longest gap and its frames over 16.7 ms)?

## Critic pass 18: w2/followups-2 @d2750c5, w2/app-ui @be852f4 (rounds 6-7)

**Scope.**
- A, w2/followups-2 (`664203f..d2750c5`): D4-96's follow-ups: W2K-I1 (the README's D0-1 line), W2L-I9 (the cut-face band as the cap pixels, a `legacyTraa` control in every banded pose), N3 (P5's window, a flagged contract text edit), the indicative flow timing row gated only under `VITE_UI_QUIET=1` (`src/flow/viz/timingRow.ts`), W2V-I8 (the GPU floor per quantity), the inferno ΔE comment, K4 (a GPU global M_cut ≥ 1) with its CPU twin W2R-N31. The builder's question (the default pose's control fails by 1.00 tile) is judged below.
- B, w2/app-ui rounds 6-7 (`b5ae7ef..be852f4`, main merged at 6bf986f): D4-97 and D4-98: W2A-I9 (`src/render/viewProjRoll.ts`, a flagged `post.ts` edit), W2A-I7's cold-switch bound (30 frames, then a slot every frame; U4), W2A-I8 (the cut views framed for their rows; U5, the priority hiding), W2A-I10 (the Schlieren signature on the canvas, a failing control per bar, the 0.7 grey share), U6/U7, N21-N28, and round 7: W2H-I5's fixed-dt held-frame test (`src/shell/simSteps.ts`, the test-only `debug` message), N23, Schlieren and Exploded framed above the dock, the dashed crop outline with the 440 px legend, the 1366 drawer's leader. The handoff's open points (U4, Exploded's grey share, the 1366 slack, the UI choices beyond the brief) are judged below.

**Setup** (2026-10-31, the critic worktree):
- `critic` merged main b5ae7ef (a fast-forward from 8ddcd87). A throwaway local branch `trial18` took two `--no-ff` merges, both clean: w2/followups-2 (ba0bc3c), then w2/app-ui (badaa3a). Nothing conflicted: A's P5 text and B's §3.5 rows sit in different parts of `docs/PHYSICS.md`, and both are in the merged file.
- Every gate ran alone and detached (`Start-Process`, one script, a status line per step with the power state, the charge and the free memory), on trial18. **Power: on battery for every gate** (status 1, 70 % → 44 %); AC never returned during the pass.
- **The first coverage run was void.** The laptop entered Modern Standby at 21:14:45 and left it at 21:52:36 (Kernel-Power 506/507), with the display off on battery. The run's workers froze for those 38 minutes, and two synchronous tests failed on vitest's 5 s timeout with 2293 s and 2300 s on the clock (`model.test.ts` "no light-off", `heldRecovery.test.ts` P5b at dt 1/30). I stopped it, started a keep-awake process (`SetThreadExecutionState` with the system and display required: an execution-state request released when it exits, no power setting changed), and re-ran coverage and every later gate under it. typecheck and lint had finished before the standby.
- Unit mutants ran on a `git archive` copy of trial18 (`reports/scratch/c18/tree`), so no gate read a mutated `src`. The Chrome mutants ran there too, after the browser gate.
- The builders' worktrees were only read.
- Probes: `docs/reviews/probes/w2a-exploded-frame.probe.ts.txt`, `w2a-abandoned-cold.probe.ts.txt`, `pass18-mutants.mjs.txt`.
- `critic` is checked out again. The local branch `trial18` (badaa3a, unpushed) is left in place, because the PreToolUse hook blocked `git branch -D`: the orchestrator can delete it. The keep-awake is stopped, and no detached run or Chrome of mine is left going.

### A. w2/followups-2 @d2750c5

**What holds (read, then the gates and mutants):**
- **W2K-I1: the line is right.** `spikes/README.md:77` is `184680f^`'s line word for word ("Notifications off (Do not disturb), so no toast takes focus. No other window over Chrome. Don't touch the machine until the summary prints."), plus "(apart from the one click into Chrome that the D4-73 item below may need)". That clause reconciles it with D4-73's item below it, which can need one click into Chrome; it adds no new rule. No other `$N` artefact is in the tracked text.
- **W2L-I9: the band follows D4-96 as written and stays principled (D4-74).**
  - It is the cap pixels only: the pixels where the TRAA-off still with the caps differs from one without, computed at the pose before any sample. There is no tile and no ring. A band pixel never counts as changed, and a tile's 25 % rule stays of the whole tile, so a tile mostly under caps can no longer reach 25 %. That is a stricter rule near the caps, stated in the test. MARGIN is unchanged.
  - Every banded pose runs its own `legacyTraa` control and asserts it fails (`rotorMotion.test.ts:226-240`). The failure direction is loud: if a later change made either control pass, the suite would go red.
  - A band that grew to hide everything would zero both rows, and then the controls would pass, so the suite fails. A band that came out empty would leave the default pose unbanded, and then the shipped row fails (6.88 against 6). Either way the controls guard the band.
  - On trial18, with app-ui merged in, every rotor row and both controls repeat the builder's run to the digit, sample by sample (Gates).
- **N3: the wording matches D4-96 item 3.** P5's text (`thresholds.ts:434`, the PHYSICS.md row) states "the window is 23 s from ground idle: 3 s at idle, the 1 s ramp, then the take-off lever". `windowS` and `idleS` are typed, and `heldFrame.test.ts` derives its 3 s and 20 s from them, with the same values as before. No bar changed.
- **The timing row can still fail when quiet.** `flowTimingProblems` gates a reading over 2 ms only when `quiet`, and it fails a non-finite or negative reading on every run. `quietRun` is exactly `VITE_UI_QUIET === "1"`, app-ui's reader.
  - All four mutants are killed by the unit tests: T1 (gated every run), T2 (any value counts as quiet), T3 (gated only when not quiet) and T4 (an infinite reading accepted).
  - The builder showed the Chrome side failing under the flag with a forced slow reading. My run was not quiet, so the row only recorded (Gates).
- **W2V-I8 holds on the GPU for every quantity** (my run, Gates), and its bar was stated before it ran. One-sided, though (W2V-N26).
- **K4 and its CPU twin are killed.** K4 (the CFL switch read from the given minMach, `params.ts:259-260`) is killed by `machCut.test.ts`. A4 (the same in `reference/solver.ts:176-177`) is killed by `precondition.test.ts:308`. C-cut on Dawn on trial18 is 4.84e-7 / 1.90e-6 / 3.18e-6, equal to row C.
- **The inferno comment** (`fields.ts`) now says what critic 16 measured: viridis and the diverging map are 1.5-1.8 JND, and inferno at T∞ is a visible band (CIEDE2000 6.6-8.3) that T's floor hides as a display choice.

**The builder's question: is a 1.00-tile control margin in the default cutaway pose enough power?** Yes for the merge, with a stated fallback (W2L-N16).
- It meets D4-96's rule: the control fails and the shipped pipeline passes. In the builder's run the shipped excess is 2.38, the control's 7.00, against a bound of 6.
- The measurement is deterministic within its protocol. On trial18, with app-ui's `post.ts` edits merged in, every row and both controls repeat it to the digit, sample by sample.
- But the margin is thin against the frames' own spread. The control's moving samples are [20 18 16 19 12 19 15 16] (sd 2.6) and its rest samples [11 10 10 12 9 9 8 10] (sd 1.3), so 1.00 tile is about one standard error of the mean difference. The shipped row sits 3.1 standard errors under the bound.
- So the default pose's row can see ghosting about as strong as `legacyTraa`'s, and nothing much weaker. Pipeline-wide ghosting is still caught in the close-up, where the control fails by 15.38 tiles.
- An innocuous change could flip the default control to a pass: a three upgrade, or a cap or hatch shader edit. The suite goes red then, which is the safe direction. The risk is the fix chosen afterwards.

#### Blocking
None.

#### Important
None.

#### Nits
- **W2L-N16: state now what happens if the default pose's control ever passes** (`tests/browser/rotorMotion.test.ts:52-56`, `:232`).
  - Its margin is one standard error (above), and the numbers depend on the measurement order (GOTCHA 1), so a later unrelated change can flip it.
  - Fix: add to the comment, before that happens, that a passing default-pose control takes D4-96's fallback (the pose out of the moving bound, with the reason), never a re-tuned band.
  - Write the per-sample counts to `test-results/rotorMotion.txt` beside the means (already there), and keep the order (shipped poses, then the controls in POSES order).
- **W2V-N26: W2V-I8 bounds the ambient band from above only, so a floor that is too wide passes** (`tests/browser/flowViz.test.ts:622-623`).
  - Mutant V2 is the shader's T floor at four times its width (`flowViz.ts:430`), which hides about 153-423 K while the legend says 243-333 K. **It passes the suite in Chrome:** T in the band with the floor is 0.2 %, and T drawn falls only from 9.4 to 8.3 %, because the MOCK at idle has few samples between 333 and 423 K.
  - Fix: also compare each quantity's GPU drawn share with the TS mirror's (`drawnOnPlane` over the same MOCK samples), at idle and at take-off, within a stated tolerance. At take-off the bypass air lies at 330-350 K, so a widened T floor shows there. That checks both edges of the floor.
- **W2H-N10 (a cross-branch nit; app-ui's test, A's text): the browser record beside P5 runs 24 s, while P5 now states 23 s** (`tests/browser/app.test.tsx:590`, `:604-605`).
  - It steps 180 frames at idle, the 60-frame ramp, then 1200 frames, which is 20 s after the ramp *ends*. That matches the old wall-clock loop.
  - P5's window, which `heldFrame.test.ts` reads, is 20 s from the ramp's *start*.
  - Fix: step `P5.windowS - P5.idleS` seconds from the ramp's start (1140 frames after it), read from the contract as `heldFrame.test.ts` does.

#### Verdict A: **MERGE**
- B 0, I 0, N 3 (W2L-N16, W2V-N26, W2H-N10).
- D4-96's items are in as decided:
  - the README line is restored;
  - the band is principled, with a failing control in every banded pose;
  - P5 states its window;
  - the timing row gates only quiet runs and can still fail there;
  - the floor is checked on the GPU for p, ρ, T and Mach;
  - K4 and A4 are killed.

### B. w2/app-ui @be852f4 (rounds 6-7)

Checklists: react-reviewer, typescript-reviewer, silent-failure-hunter and pr-test-analyzer, applied by hand as one review. D4-74, D4-90, D4-93 and D4-95..D4-98 were checked against both branches: nothing here contradicts them.

**What holds:**
- **The view-projection roll is right in every mode** (`viewProjRoll.ts`; `post.ts:390-395`, `:656-658`, `:742-750`).
  - `roll` is round 5's code, moved unchanged.
  - `save` captures all three matrices and `havePrev`, and the warm path restores them in a `finally`, so a throwing warm frame still puts them back.
  - The roll runs before the debug and linear branch, as before, so every path rolls once per real frame.
  - No mode has a camera of its own: Schlieren's composite reads the same `prevViewProj`, `currViewProj` and `currViewProjInv`, and `flowCamera` is a clone used only for the unjittered flow passes.
  - Mutants R1 (`curr` not restored, the old bug) and R2 (`havePrev` not restored) are killed. R3 (`currInv` not restored) survives, but it is an equivalent mutant: every roll recomputes `currInv` from `curr` before any draw reads it.
- **The cold-switch scheduler** (`warmUp.ts:182-208`) cannot loop or starve.
  - Every call returns at most one slot.
  - Past 30 frames waited the asked view takes the frame's slot before the CPU, SLOT_EVERY and quiet checks. That is D4-98's rule, and the background keeps all three.
  - A view that never finishes is given up at 800 frames waited, then marked warm and shown.
  - A new asked view restarts the wait (`preparing.id !== asked`). The view already shown is never "preparing": N23's clause in `shownView`, with the unfinished boot view warmed first.
  - The one leftover is W2A-N29.
  - Mutants W1-W7 are killed (Mutants).
- **The fixed-dt path is test-only, and a production build drops it.** The app never sends `debug`. The worker's handler starts with `if (import.meta.env.PROD) return;` (`simWorker.ts:590-592`), and `debug` is not an input for the quiet rule. In my production build (`vite build` of trial18, `reports/scratch/c18/dist`), the worker's handler is ``case`debug`:return;``. The frame-CPU, knife-edge and fixed-step handling is gone.
  - Left in the bundle, and harmless: the stepper's real-time path (`fixed` is null, so `next` returns the frame's dt) and the padding loop, whose bound `debugFrameCpuMs` stays 0.
  - `held` now needs a stepped frame (`simDtS > 0`), so a paused or held-between-batches frame is no longer tagged held. That is a change to W2F-N5's record only.
- **The fixed-dt case is deterministic.**
  - The commands are posted before each batch, so the worker applies them in order before the batch's first step. `fixedSteps.frames` is checked against the frames asked for.
  - My run repeated the builder's two runs: 1440 fixed frames, 1005 lost solves, 168 held snapshots, sim time 24.15 s.
  - It no longer reaches the fit's throw. D4-98 accepted that: the cause belongs to the part-power round, and SIM STOPPED stays visible.
- **The Schlieren check's controls all fail their named bars** (my run and both of the builder's):
  - S1 fails the jet bar (jet spread 0.011 / 0.006 at 1366 / 1920);
  - Cutaway and Data fail the grey share (0.554 / 0.556 at 1366, 0.499 / 0.500 at 1920; at 1366 their jet spread, 0.064-0.070, is under 0.08 too);
  - Realistic and Exploded fail the silhouette bar (1.17-1.18 and 0.65-0.67 against 0.5). Schlieren passes with a grey share of 0.95, silhouette 0.25 and jet 0.13-0.15.
  - The signature is taken from a second screenshot with `.overlay` hidden, so no label sits in the jet box.
  - The margin question:
    - Exploded's control is the silhouette bar (0.66-0.67 against 0.5, unchanged by its framing), so its rising grey share (0.24 → 0.48-0.50) does not carry any control.
    - The grey bar's own margin is thin for a reason, though (W2A-N30).
- **The callouts.**
  - N21: the crossing places are tried fewest first.
  - The rows drop a place pushed onto the engine, and in the cut views only row places are offered, so a label is hidden by priority and never placed on the section (D4-98 item 5).
  - An empty reserved box reserves nothing.
  - Equal layouts prefer shorter leaders.
  - Mutants C1-C6, P1 and the drawer case are killed.
- **The framings.**
  - `fitOrbit` carries the minimum scale across its passes (`orbit.ts:186`: what is left of 0.6 after the passes so far); mutant O1, a fresh 0.6 each pass, is killed.
  - An orbit in a framed view cancels the restore, and so does a camera preset (N24).
  - A `viewArea` change re-frames from the saved orbit only while the viewer has not moved the camera.
- **N23's report** is per configuration and only `done` boot configurations are marked warm. Diagnostics counts the unfinished, and warmStall asserts both boot configurations finished. The engine view's `done` is never false in Chrome on this machine, so only the unit tests reach that branch (no finding: the scheduler side is pinned).
- **React and TypeScript.**
  - The new Diagnostics rows render text only.
  - The legend's dashed swatch is `aria-hidden`.
  - `viewArea` gains `rows` from the same layout effect.
  - The `debug` message is typed in `protocol.ts`, and a rejected step request is pushed as an error, not dropped.
  - The new modules (`viewProjRoll`, `simSteps`) are pure and unit-tested.
  - N26's guard reads `updateBefore`'s assignments and six mutator methods. A write through another mutator (`premultiply`, `applyMatrix4`) or through a local alias would still escape it. That is the residual of a pin by pattern, and acceptable as N26's fix.

**U4 (the cold switch shown within 2 s): on AC, still owed.** AC never returned during the pass.
- My gate run, on battery (status 1, 56 %, the keep-awake on, not quiet; `reports/ui/first-switch-data-cold*.json`):
  - light frame CPU 1.42 s;
  - a steady 8.4 ms 1.74 s;
  - a steady 11.2 ms 1.79 s.
  - Each case took 45-47 warm frames, gave nothing up, and its longest snapshot gap while preparing was 88-95 ms.
- The builder's, also on battery: t1 1.61 / 1.93 / 1.83 s, gate run 1.45 / 2.16 / 2.20 s.
- So the battery numbers straddle the bar by ±0.2 s. They decide nothing either way, and none of them is called a regression.
- The mechanism's floor is 30 + 45-47 frames, about 1.3 s at 60 Hz. The rest is frames lengthened by the warm frames' node builds, so U4's margin on AC is a few tenths of a second at best.
- `firstSwitch.test.tsx` gates U4 only in a quiet run, so the suite is green either way.

**The handoff's open points:**
1. **U4:** above. Not called a regression from battery numbers.
2. **Exploded's grey share 0.48-0.50 against 0.7:** not load-bearing, since its control is the silhouette bar. Part of the rise is W2A-I11: the view is framed smaller than it needs to be.
3. **The 1366 cut views' ~8 px of spare room:** acceptable. A taller dock costs labels by D4-97's priority, never puts one on the section, and the layout bar now fails a wrapped floor note. A fallback reason in the badge would cost the lowest-priority labels first (HPC, booster, bypass duct), which is the stated order.
4. **The UI changes beyond the brief:** keep all three.
   - The 440 px legend keeps the note on one line at both sizes and stays inside the centre column.
   - Schlieren framed above the dock fixes pass 17's note 2: 100 px of margin at 1920, 48 px at 1366, the nacelle clear of the legend.
   - Exploded framed fixes the run under the right column, but its box is wrong (W2A-I11).

#### Blocking
None.

#### Important
- **W2A-I11 (visual): Exploded is framed on parts it does not draw, so it sits off-centre and smaller than it needs to be** (`src/hud/anchors.ts:194-212`; `src/app/simWorker.ts:111`; pinned as intended at `tests/unit/hud/calloutLayout.test.ts:498`).
  - `explodedRings` takes the intake at the nacelle's *outside* over the inlet's whole length, and the bypass duct at the nacelle's inside over its length. In the exploded view every skin is hidden (`engineView.ts:773-777`): the inlet lip, the nacelle skin, the inlet barrel, the bypass liner, the nacelle trailing edge and the core cowl (`geometry/parts.ts`, the sixth argument). Of the intake only the fan case is drawn.
  - So the framed box runs about 100 px left of the visible fan case at 1366. My probe (`w2a-exploded-frame.probe.ts.txt`) frames the parts the view draws (every non-skin part's profile, slid by its module's offset) at the unit test's rows:

    | size | shipped: scale, gaps to the area (left / right / top / bottom) | framed on the drawn parts |
    |---|---|---|
    | 1366 | 0.602 (at the 0.6 floor), 111 / 13 / 60 / 64 px | 0.723, 0 / -2 / 24 / 27 px |
    | 1920 | 0.702, 231 / 74 / 84 / 92 px | 0.888, 32 / 32 / 6 / 13 px |

  - The shots show it:
    - at 1366 the intake ring starts 135 px right of the left column and the last module ends 32 px short of the right one;
    - at 1920 it is 235 against 62 px.
  - The handoff's reading ("left-light because the intake ring is the nearest and largest part") is not the cause. The box's left edge is an inlet lip that is not drawn.
  - The engine is also drawn 17-21 % smaller than the area allows, and Exploded is the view where the parts are meant to read.
  - Fix:
    - build Exploded's content from what the view draws: the fan case for the intake, and no skins (for example the non-skin parts' profiles, as the probe does);
    - test that the drawn parts' box is centred in the area (|left - right| within a few px at both sizes), not only inside it.

#### Nits
- **W2A-N29: a cold view the viewer leaves keeps its every-frame slots against the background's 400-slot cap** (`src/shell/warmUp.ts:176-180`, `:201-205`).
  - Past the 30-frame wait the asked view takes a slot every frame. `frames` keeps counting them, and when the viewer switches away the view rejoins the queue with that count.
  - My probe (`w2a-abandoned-cold.probe.ts.txt`):
    - after 300 or 420 frames as the asked view, the view is warmed in the background as usual;
    - after 500 frames (470 slots), it is given up at its first background slot, with no further warm frame.
  - On this machine every view warms in 2-47 frames, so this cannot happen here. It needs a machine whose compiles take over about 7 s, as round 3's 6.9-14.5 s for Cutaway did. On such a machine, a viewer who waits 8 s and goes back gets the view given up, and the next switch into it compiles on first use. It is shown as "given up" in Diagnostics, so it is not silent.
  - Fix: count only background slots toward MAX_WARM_FRAMES, or reset the count when the view stops being asked for.
- **W2A-N30: the Schlieren grey band contains the studio's own grey, so the grey-share bar measures how much studio shows, not the knife-edge field** (`tests/browser/lib/schlierenCheck.ts:22-32`).
  - The band is 0.4-0.6, and the controls' grey means are 0.479-0.485: the studio, whose grey is about 0.47. Schlieren's is 0.501 and S1's 0.502.
  - A frame passes the bar when enough of the free area outside the engine is studio. Framing alone doubled Exploded's share (0.24 → 0.50), and the cut views sit at 0.55, 0.15 under the bar.
  - The ±0.1 rationale ("for the JPEG") no longer applies: the signature is computed on the canvas PNG since W2A-I10.
  - The jet bar still fails a studio-backed Schlieren, so no wrong frame passes today.
  - Fix: a band about the knife-edge's 0.5 narrow enough to leave the studio out (for example ±0.015, measured on HEAD and stated before the run), or a studio-only control frame for the grey bar.
- **W2A-N31: no Chrome check that Schlieren and Exploded are framed inside the area** (`tests/browser/app.test.tsx:391-470`).
  - The cut views have `axialRowProblems`. Schlieren and Exploded have only the pure `fitOrbit` unit test.
  - The worker's `framingOf` dropping Exploded (or Schlieren) passes every test, by reading: Exploded's control fails the silhouette bar framed or not, and no label shows in it.
  - Fix: assert in the modes loop that the snapshot's engine box (or the drawn content's, after W2A-I11) lies inside the posted rows less FRAME_MARGIN_PX.

#### Verdict B: **MERGE**
- B 0, I 1 (W2A-I11, visual), N 3 (W2A-N29..N31).
- D4-97 and D4-98 are in as decided:
  - the roll restores all three matrices;
  - a cold switch waits 30 frames and then warms every frame, with nothing that loops or starves;
  - the cut views hold their axial rows at both sizes;
  - the Schlieren signature is computed on the canvas, with a failing control per bar;
  - the fixed-dt case is deterministic and test-only, and a production bundle drops it.
- The round-7 visual notes are fixed: the drawer's leader, the dashed outline, Schlieren's margin. Exploded is better than before, though off-centre (W2A-I11).
- W2A-I11 is a framing input, not a regression from main, where Exploded ran under the right column.
- U4 is met on battery in my run (1.42-1.79 s). The AC measure is still owed.

### Visual review (all 13 shots in `docs/look-dev/ui/` at be852f4, against round 6's at d267488)
**Fixed and at the bar:**
- **The crop outline (W2V-N25)** is now a light dashed frame, named by the legend's dashed swatch. It no longer reads as a stray leader beside the callouts, and its top edge passes under the 1920 top row without touching a label.
- **The 1366 drawer:** Fan sits in the row above, left of the drawer, with a ~110 px straight leader. Before, it took the row below with a 265 px leader across the section.
- **Schlieren:** framed above the dock, with about 100 px to the left column at 1920 and 48 px at 1366. The nacelle clears the legend, and the jet fades before the right column.
- **The cut views** keep eight labels in two axial rows at both sizes, as in round 6. At 1366 the top row now sits under the top bar, and Fan is centred over its anchor.
- **Exploded** lies wholly in the free area; before, it ran under the right column. But it is off-centre and smaller than it needs to be (W2A-I11).

**Short of "ultra high level":**
1. **Exploded's framing** (W2A-I11): 135 px of studio left of the intake ring and 32 px right of the last module at 1366, and 235 against 62 px at 1920.
2. **In Schlieren the Core exhaust label sits on the jet**, at both sizes. At 1366 its box covers the start of the upper bright band, and at 1920 the jet's core behind the nozzle. The signature is computed without the overlay now, but the viewer sees it. Place that label below or left of the nozzle in Schlieren.
3. **Entering a framed view jumps the camera.** Schlieren, Exploded and the cut views set the dollied and panned orbit in one frame (`simWorker.ts:488-489` applies `a.orbit` directly), and leaving puts it back the same way. A short eased move, for example over the cut views' own 1.4 s transition, would read as one continuous motion.
4. Round 5's small notes are still open: "Preparing the Data view…" for a quantity change, the T-s "45" on its line, the idle fan's smear in Realistic, and no labels in Exploded.

### Gates (trial18: main b5ae7ef + w2/followups-2 @d2750c5 + w2/app-ui @be852f4)
Power: **on battery for every gate** (status 1; 70 % at the start, 44 % at the end; AC never returned). A keep-awake was on from coverage onward (Setup).

| gate | result |
|---|---|
| `npm run typecheck` | clean, 18 s (1/70 %) |
| `npm run lint` (ESLint + Prettier) | clean, 66 s (1/69 %) |
| `npm run coverage` (own reportsDirectory) | first run void (Modern Standby, Setup). Re-run: **138 files, 2372 passed + 11 expected fail (2383)**, exit 0 (the per-directory thresholds hold), 800 s (1/64 → 1/59 %). Statements 98.56 %, branches 87.98 %, functions 99.55 %, lines 99.54 %. Core lines: thermo 100 %, cycle 99.62 %, flow/reference 100 %, geometry 99.59 %, src/flow 99.50 %. New modules: timingRow and simSteps 100 / 100, warmUp 100 / 96.4, callouts 100 / 88.2, anchors 100 / 85.2, orbit 100 / 78.4 (lines / branches) |
| `npm run test:mesh` | 2 files, 29 passed |
| `npm run test:gpu` | **12 files, 71 passed** (70 + C-cut), 47 s. C-cut 4.84e-7 / 1.90e-6 / 3.18e-6 (row C's), C-pre 5.13e-7 / 3.77e-7 / 1.05e-6 |
| `npm run test:gpu-ladder` | 3 files, 13 passed + 1 expected fail, 305 s. D4-63 on the GPU (a) 0.7779, (b) 0.4913 / 0.2111; L7 1.779. Equal to pass 16's |
| `npm run test:browser` | **14 files: 43 passed, 4 failed, all four on their 120 s timeouts** (`rotorMotion` "in motion", `culling`, `fanBlur`, `flowSolver`), 1206 s against the builders' 438-454 s, on battery (1/56 → 1/48 %), 5.9 GB free, no other vitest browser run. The early files ran at their usual pace and the slowdown came later in the run; I could not attribute it. 0 WebGPU errors in the passing files. `docs/` stayed clean |
| the four files re-run alone, unchanged | **4 files, 5 passed**, 175 s (1/46 → 1/45 %). So the full gate on trial18 is 47 of 47 across the two runs; the four failures were the battery run's timeouts, not the code |

**The browser run's records** (battery, keep-awake on, shared machine, not quiet):
- **The rotor rows** (the rerun): every row and both controls equal the builder's run to the digit, sample by sample. Default cutaway shipped 9.75 / 12.13, control 9.88 / 16.88 (fails, excess 7.00). Close-up shipped 1.75 / 4.63, control 1.38 / 22.75.
- **W2V-I8**, floor off → on: p 98.0 → 0.1 %, ρ 90.5 → 0.5 %, T 91.0 → 1.0 %, Mach 46.8 → 6.7 % (|u| 54.5 → 13.0 %). App-ui's dashed outline moves p and ρ by a few tenths.
- **The flow timing row:** not quiet, so recorded only. Visuals 0.54 ms, tracers 0.91 ms, problems [].
- **U4:** above. U3 (boot) 2.98-3.08 s.
- **The fixed-dt W2F-N5:** 1440 frames, 1005 lost solves, 168 held snapshots, the builder's to the digit.
- **The Schlieren signatures:** in B's "What holds".

### Mutants (by hand on a copy of trial18; `pass18-mutants.mjs.txt`; each file restored after)
| set | killed | survived |
|---|---|---|
| A, unit (`machCut`, `precondition`, `timingRow`) | K4 (the GPU CFL switch from the given minMach), A4 (its CPU twin), T1 (gated every run), T2 (any VITE_UI_QUIET is quiet), T3 (gated only when not quiet), T4 (an infinite reading accepted) | none |
| A, Chrome (`flowViz` W2V-I8) | (V1 shown killed by the builder, not re-run) | **V2 (T's floor four times as wide: W2V-N26)** |
| B, scheduler and stepper (`warmUp`, `preparing`, `simSteps`) | W1 (60-frame wait), W2 (every second frame), W4 (the give-up counts slots), W5 (`bootWarmed` ignores `done`), W6 (the shown view "preparing"), W7 (the asked view's slots wait for the quiet), S1u (no hold with no steps left), S2u (any dt accepted), S3u (a batch replaces the frames left) | W3 (the asked view's early return dropped): equivalent, except after W2A-N29's carry-over |
| B, roll (`viewProjRoll`) | R1 (`curr` not restored: the old bug), R2 (`havePrev` not restored) | R3 (`currInv` not restored): equivalent, since every roll recomputes it |
| B, callouts and framing (`calloutLayout`, `uiLevels`, `schlierenCheck`) | C1 (empty boxes reserve), C2 (only bars at y ≤ 1 limit the top row), C3 (no shorter-leader tiebreak), C4 (a row pushed onto the engine kept), C5 (only the first crossing place), C6 (the cut views offered offsets), P1 (exhaust and HPC swapped in priority), G1 (grey share 0.3), G2 (the jet bar never fails), U1 (U4 at 2.5 s) | **O1** (`fitOrbit`'s floor reset each pass: no unit case where the floor binds before the last pass), **O2** (FRAME_MARGIN_PX 0: the test reads the constant), **E1** (the intake ring at the nacelle's inside: the test pins the box's points, not what the view draws; W2A-I11) |
| B, Chrome (`app.test` modes, both sizes) | K (the knife-edge uniform ignored: S1 passes, so the control's assertion fails at both sizes) | none |

**Totals:** A 6/7 (unit 6/6, Chrome 0/1); B 22/27 (unit 21/26 with 2 equivalent, Chrome 1/1). The probes are not mutants: the Exploded framing (W2A-I11) and the abandoned cold view (W2A-N29).

### Verdicts
- **A. w2/followups-2 @d2750c5: MERGE.** B 0, I 0, N 3 (W2L-N16, W2V-N26, W2H-N10). The default pose's 1.00-tile control margin is enough for D4-96's rule, because the measurement is deterministic (repeated to the digit on trial18). State the fallback before anything flips it (W2L-N16).
- **B. w2/app-ui @be852f4: MERGE.** B 0, I 1 (W2A-I11, Exploded's framing box), N 3 (W2A-N29..N31). U4 on AC is still owed. My battery run met it (1.42-1.79 s), the builder's gate run did not (2.16-2.20 s), and none of these numbers is a verdict.

**Merge order:** w2/followups-2, then w2/app-ui (trial18's order). Both merge cleanly in that order. They meet only in `docs/PHYSICS.md`, in different sections (A's P5 text, B's U4-U7 rows), and in W2H-N10's cross-branch nit. After the merge, U4 on AC is the one measurement owed: `tests/browser/firstSwitch.test.tsx` alone, quiet (`VITE_UI_QUIET=1`), at light, 8.4 and 11.2 ms.

### Questions for the orchestrator
1. **U4 on AC:** who runs it, and when? My battery runs straddle the bar (1.42-2.20 s across three runs). The mechanism's floor is about 1.3 s, plus the warm frames' own node builds, so the AC margin may be a few tenths of a second.
2. **U4's "at any steady frame CPU":** the test pins 8.4 and 11.2 ms. At a frame CPU over about 16 ms, below 60 fps, the 30 + 45-47 frames alone take over 2 s, so "any" cannot hold there. D4-98 kept the text. Should the check text say "up to 11.2 ms (a 60 fps frame)", or is that out of U4's scope?
3. **W2A-I11:** Exploded's framing goes to app-ui's next round, with W2A-N29..N31 and the Schlieren label on the jet (visual note 2)? An eased camera move into framed views (visual note 3) is a suggestion for the same round.
4. **W2L-N16:** confirm in advance that if the default cutaway pose's control ever passes, D4-96's fallback applies (the pose out of the moving bound, with the reason), not a re-tuned band.

## Critic pass 19: w2/solver-diverge @5d87a79, w2/polish @f5492ef

**Scope.**
- A, w2/solver-diverge (`9b5a6c2..5d87a79`): W2S-B1 (D4-100), the look-dev page's GPU solver going NaN at iteration 6756. The fix is a backflow branch in the outflow BC (SOLVER.md §5), in the oracle (`src/flow/reference/boundary.ts`) and the kernel (`src/flow/gpu/wgsl/boundary.ts`, the `pOut` uniform), with a 20000-iteration GPU test of the app's own configuration (`tests/gpu-ladder/app-longrun.test.ts`), a unit row and an oracle row. It changes the scheme contract (§5's outflow rule), so this review is what the orchestrator ratifies. The builder's W3 note (hot wall gas running away under preconditioning, in f64 too) is weighed below with a probe.
- B, w2/polish (`9b5a6c2..f5492ef`): D4-99 item 3 and D4-100: the split browser tests with 240 s timeouts, U4's scheduler (the asked view warms up to 200 ms of CPU a frame, a snapshot every 3 frames or after 50 ms, `COLD_SWITCH_WAIT_FRAMES` = 0), W2A-I11, N29-N31, the Schlieren label off the jet, W2V-N26 (the floor against its TS mirror, its bar tightened from 2 % to 0.2 % after its first run), W2H-N10, and U4's check text. The re-shot `docs/look-dev/ui/` images, uncommitted in the builder's worktree, are judged below (read only).

**Setup** (2026-11-01, the critic worktree):
- `critic` merged the local main 9b5a6c2 (a fast-forward). A throwaway local branch `trial19` took two `--no-ff` merges, both clean: w2/solver-diverge (c7aca30), then w2/polish (3d9ef78). The branches share no file (A: SOLVER.md and `src/flow`; B: PHYSICS.md's U4 row, `src/app`, `src/hud`, `src/shell`, `src/ui` and the browser tests).
- Every gate ran alone and detached on trial19 (`Start-Process`, one script, a status line per step with the power state and the free memory). **Power: AC for every gate** (BatteryStatus 2, 100 %). The orchestrator's CPU d463 run (node PID 22108) shared the CPU throughout. Nothing else of mine used the GPU during the GPU gates, except my unit mutants alongside gpu-ladder, and the Dawn mutants and the CPU hot-pocket probe alongside coverage. Those are deterministic, and no timing is gated in them.
- **Keep-awake.** The gate script held `SetThreadExecutionState(0x80000001)` (system only), as asked. That let the display sleep at its 5-minute AC timeout during the browser gate, and the laptop entered Modern Standby at 21:50:23-21:53:22. The first browser run is void for that reason (Gates). For the Chrome mutants and the browser re-run, a separate process held 0x80000003 (system and display). That is an execution-state request too, and no setting changed.
- Mutants and probes ran on `git archive` copies (`reports/scratch/c19/tree` of trial19, `reports/scratch/c19/pre` of main 9b5a6c2), so no gate read a mutated `src`. The Chrome mutants ran after the browser gate.
- The builders' worktrees were only read (the shots, the logs, `repro.ts`, which I copied into my pre-fix copy to run it).
- Probes: `docs/reviews/probes/w2s-hot-pocket.probe.ts.txt`, `pass19-mutants.mjs.txt`.
- `critic` is checked out again. The local branch `trial19` (3d9ef78, unpushed) is left in place, because the PreToolUse hook blocked `git branch -D`: the orchestrator can delete it. Nothing of mine is left running (the keep-awake is released), and no Chrome or dev server of mine is open.

### A. w2/solver-diverge @5d87a79

**What holds (read, then my runs):**
- **The rule is the standard pressure-outlet backflow.** A face the flow enters (vn < 0) becomes a subsonic inflow at the backflow totals (p0, T0) = (p_out, T∞), along the inward normal, with no swirl and Z = 0, at the speed σ set by the cell's outgoing characteristic p′ + ρc·u_n. That is the usual commercial-code treatment (the outlet's static pressure taken as the backflow's total pressure, a stated backflow total temperature and composition, the direction normal to the boundary). The copy it replaces specified all four incoming characteristics from the cell, which fed the cell's own momentum, total enthalpy and fuel back in. §5's rationale says so correctly, and the old rule's positive feedback (inflowing total pressure p_out + ½ρvn²) is the right diagnosis.
- **The two implementations are the same rule** (`reference/boundary.ts:256-257`, `wgsl/boundary.ts:97-106`, `params.ts:259`):
  - the same totals, p_out and T∞; dp0 = p_out − p∞ in f64 before rounding on both sides (`pOutGauge`), dT0 = 0, the initial τ at cp(T∞) on both sides (`cpaInf` = `cpMix(g, ref.t, 0)`);
  - the same 3 + 3 Newton steps, the same ghost (−σn, rw 0, Z 0, T∞ + τ, ρ′ from the ghost's p and T);
  - the inflow refactor moves the supersonic free stream to the INFLOW case only (`ghostPrimitive`; the kernel's `inflow`), so INFLOW's values are unchanged, and the backflow never takes the free stream.
- **A face with vn ≥ 0 is bitwise unchanged** on both sides by reading (the same comparison, the same copy and p_out), and a NaN vn still falls to the old path. My test:gpu repeats E-L5 2.67e-8 and E-L9a 2.46e-12 over the flux scale, their values of record.
- **The reproduction is honest.** I ran the builder's `repro.ts` (`--init perf --frames --iterations 7000 --locate`) on main 9b5a6c2, the pre-fix code, on Dawn:
  - **first non-finite state at iteration 6756**, in block 5 `core`, i 508-513, j 11-13 (the first 12 of the non-finite cells), x 2.51-2.56 m, r 0.39-0.41 m: the core nozzle's outer rows, as the handoff says;
  - the maximum Mach sits at the outflow's axis corner (plume-core i 822, j 0, x 33.7 m) from iteration 2000 on, at 0.47 there and 0.90 by 6400-6800, while the field's max T′ climbs 321 K (2000) → 518 (3000) → 814 (5000) → 940 K (5800): the reversed jet recycling hot gas;
  - the GPU residual never decays (173 at 100, 362 at 1000, 205-300 from 4500 on).
- **The long-run test fails without the fix and passes with it.**
  - Mutant A1g-longrun (the kernel's backflow branch off): the look-dev start's first non-finite checkpoint is 6800, max T′ 970.7 K by 6000; the rest start still passes. That is the TDD commit's failure.
  - With the fix (my test:gpu-ladder), every row equals the builder's to the digit: peak 21.01 (< 100); (a) 0.6588 over 1000-2000 and 5.088e-4 at 20000 (≤ 2); (b) 0.1082 and 0.007278 (≤ 1); max T′ 303.8 K over the run and 0.94 K at 20000; the GPU's own residual 0.0228 of its value at 100. The rest start stays bitwise ambient at 5000-20000.
- **D4-63 on the GPU moves as claimed**, in my run: (a) 0.4450 / 0.008997, (b) 0.1634 / 0.03253, the 15000-20000 trend 0.8195 per 1000. Rows without an outflow face are unchanged: L1 2.13e-5 m/s, B 1.266e-11 and 1.95e-5 m/s, L7 1.779, L8 0.754 %.
- **The CPU ladder rows touching the outflow hold as of record.** I re-ran L4a, L4b, L5 and L9a on my trial19 copy (`vitest.ladder.config.ts`, 3 files passed and L9a failed only on its known D4-57 row). L9b I read from the builder's run of the same `src` (405 s, left out with the CPU d463 run going).
  - L4a: 0.278 % / 0.0997 % in 915 iterations.
  - L5: 0.0843 % in 948.
  - L4b: 1.640 %, steadiness 0.0258 %.
  - L9a: 8.86e-6, with its D4-57 spread 1.062e-5 (the known failure).
  - L9b: 0.80 %, spread 2.49e-5, and its known convergence failure.
  - Every value equals LOG's records (`LOG.md:1964-1975`, `:2898-2900`) to the digit. The handoff's "no record value in docs to compare L4b/L9b against" is wrong: the records exist, and the values equal them.
- **The tests are aimed right.** The oracle row puts hot, fuelled, swirling gas into the outflow, checks every outflow ghost of the kernel against the oracle's (1e-5) and that no swirl or fuel enters, then runs row C's tolerances (my run: 4.35e-6 / 6.57e-6 / 1.17e-5 against 1e-5 / 1e-4 / 1e-3). Its 5 % wave instead of 0.5 % is a measurement choice, not a loosened bar: `relativeError` divides each field's max error by its max perturbation, and with 0.5 % the f32 state's rounding of p among the thermal terms (≈ 1e-5 of the wave) is the error, in the interior and plain alike. The unit row checks the ghost equals the INFLOW ghost at (p_out, T∞) for two p_out, and that a face at rest is still an outflow face.

**The CPU d463 run (the orchestrator's re-run at 5d87a79, detached, 21:03-22:31; read from its `d463.out`): it passes every D4-79 row, and it moves as the GPU did.**

| D4-63 contract case, M_cut 0.02 | CPU before (D4-89, round 13) | **CPU with the backflow branch** | GPU with the branch (my gpu-ladder) |
|---|---|---|---|
| signature: peak max \|p′\|/first (< 100) | | 4.212 | 4.212 |
| (a) L2(p′)/first, max over 1000-2000 (≤ 2) | 0.778 | **0.4450** | 0.4450 |
| (a) at 20000 (≤ 2) | 0.488 | **0.009223** | 0.008997 |
| (b) weighted residual 20000 / 10000 (≤ 1) | 0.524 | **0.1535** | 0.1634 |
| (b) 20000 / 100 (≤ 1) | 0.223 | **0.03063** | 0.03253 |
| weighted residual over 15000-20000 | 0.33-0.42, rising 0.35 → 0.40 over the last 1000 | 0.159 → 0.125 → 0.092 → 0.075 → 0.064 → 0.055, monotone (about 0.81 per 1000) | 0.160 → 0.0588 (0.820 per 1000) |

So D4-89's recorded slow late decay on the CPU is gone too. The CPU and GPU agree to 3-4 digits through 2000 iterations (weighted residual 2.1225 / 2.2303 at 1000 / 2000 against the GPU's 2.122 / 2.234). The handoff's NEXT 2 can record the CPU column beside the GPU's in SOLVER.md §16. The builder's own CPU d463 run had timed out at its 6 h limit (`run/g-ladder.log`): its coverage run in the same window took 12 h, so the machine slept overnight, as the orchestrator's note says.

**The builder's W3 note, probed.** The engine runaway's last stage is hot product gas growing 1.12-1.2× per iteration in a wall cell under preconditioning, in f64 too. Its trigger here (recycled backflow) is gone. Is the scheme itself safe with hot gas? My probe (`w2s-hot-pocket.probe.ts.txt`): the f64 oracle on a 60 × 16 annular duct (r 0.30-0.45 m, slip walls, inflow and outflow), thermally perfect gas, a sharp pocket of T′ ΔT and Z 0.015 at pressure equilibrium (|x| < 0.06 m), moving axially at u0 in still ambient gas, preconditioned at the engine's minMach = M_cut = 0.02:

| pocket (ΔT, u0, where) | preconditioned 0.02, CFL 0.8 (the default) | plain (CFL 1.5) | preconditioned, CFL 0.4 / 0.1 / 0.02 |
|---|---|---|---|
| 900 K, −50 m/s, wall | bounded, decays (900 → 255 K by 1000) | | |
| 900 K, −150 m/s, wall | **non-finite within 100 iterations** | | |
| 1200 K, −100 m/s, wall | **non-finite within 5 iterations** | bounded (peak 1213 K) | bounded to 400 (peak 1200 / 1202 / 1203 K) |
| 1200 K, −300 m/s, wall | **non-finite within 100** | bounded (peak 1215 K) | |
| 1200 K, −300 m/s, mid-channel | **non-finite within 100** | | |
| 1200 K at rest, wall | bounded | | |

So the preconditioned tracking scheme at the default CFL 0.8 has a step-size instability for hot gas moving at 100-300 m/s through still cold gas, with or without a wall. Halving the CFL removes it here, and the plain scheme never has it. The engine case the builder bisected was different (its CFL 0.4 run followed the same pseudo-time path, so semi-discrete), so these may be two mechanisms of the same hot-gas family. Either way, W3's combustor puts exactly this state in the core (hot jets at 100+ m/s beside cold flow). This is W2S-I1 below: not this branch's defect, and not a reason to hold it, but it should be pre-registered before W3's coupling, as D4-63 was.

#### Blocking
None.

#### Important
- **W2S-I1 (pre-existing, for W3): the preconditioned scheme at the engine's cut diverges within 5-100 iterations from a hot gas pocket moving at 100-300 m/s, at the default CFL 0.8** (`src/flow/reference/solver.ts:28` and `src/flow/gpu/params.ts:17`, `DEFAULT_CFL_PRECONDITIONED = 0.8`; D4-32/D4-40/D4-44).
  - Scenario: W3 couples the combustor. The core then carries 1300-1700 K gas at 100-200 m/s beside cold bypass and cooling flow. A hot transient can take the solver non-finite within a few iterations. The app then falls back to the MOCK (visibly), and the coupled field is lost. My probe reproduces that in a 960-cell duct (table above) in the f64 oracle, so it is the scheme, not f32 or the kernel. The plain scheme and CFL 0.4 stay bounded on the same cases.
  - Fix, before W3's coupling, under a pre-stated rule (D4-63's pattern):
    1. pre-register the hot-pocket case as a ladder row, CPU and GPU: the probe's grid at ΔT 900 and 1200 K, u0 −100 and −300 m/s, at a wall and mid-channel, with D4-79's rule (finite, peak max T′ ≤ its start plus a stated margin, decay at 2000);
    2. find the step limit: D4-44 (b) (the scaled diffusion's eigenvalue in the local step), or a local step from the hot cell's preconditioned eigenvalues, with a positivity guard on T (and ρ) per stage as the last resort;
    3. re-run the builder's engine runaway from `perf-lastfinite.bin` (the pre-fix 6700 state) under the fix, to see whether the semi-discrete wall growth is the same mechanism.

#### Nits
- **W2S-N1: the kernel's backflow at p_out ≠ p∞ is untested** (`src/flow/gpu/params.ts:259`; `tests/gpu/oracle.test.ts:444-485`). Mutant A3g (`pOut: ref.p`, the uniform at p∞ whatever the BC says) survives all of test:gpu (72 passed). The oracle row runs at the default p_out = p∞, where the `pOut` uniform equals p∞ anyway. Only the CPU unit row covers a p_out of 9e4. Fix: run the oracle row (or a second one) at an outflow pressure of, say, 0.98 p∞, so the kernel's `pOut` and `pOutGauge` are both exercised against the oracle.
- **W2S-N2: §5's continuity sentence holds only for a cell at p_out** (`docs/SOLVER.md:112`). For p_s ≠ p_out the face's response jumps at vn = 0. The outflow ghost (u_s, p_out) puts p_out at the face only halfway: the face velocity is about u_s + (p_s − p_out)/(2ρc). The backflow ghost is the boundary state itself, so the face velocity is −σ, about (p_s − p_out)/(ρc). That is twice the response, on a switch a face can chatter across. Nothing shows it today: D4-63's rest state, whose outflow faces carry tiny velocities of either sign, decays faster with the branch (0.820 per 1000 against 0.994). Fix: say so in §5 ("continuous in p and u only for a cell at p_out; for p_s ≠ p_out the face's mass flux doubles its response across vn = 0"), and treat a limit cycle in a D4-63-type residual at an outflow as the first suspect.
- **W2S-N3: the backflow totals are the ambient at rest in the engine's frame** (`reference/boundary.ts:257`, `wgsl/boundary.ts:101`). In flight (u∞ ≠ 0) the gas beyond the exit moves at u∞, and its total pressure is p∞ + ½ρ∞u∞², not p_out. The handoff says W3 can revisit; §5 should say the rule is the static-ambient form and that flight cases revisit it (one line).

#### Verdict A: **MERGE**
- B 0, I 1 (W2S-I1, pre-existing, for W3), N 3 (W2S-N1..N3).
- **Ratify the §5 change.** It is the standard pressure-outlet backflow, the same in the oracle and the kernel, bitwise neutral for vn ≥ 0 (E-L5 and E-L9a at their records, the CPU outflow rows at theirs), and it removes a positive feedback with no physical source. The reproduction repeats at 6756 on main, and the long-run test fails without the fix (6800) and passes with it. D4-63's contract case passes by more on the GPU and on the CPU (the orchestrator's d463 run: (a) 0.4450 / 0.009223, (b) 0.1535 / 0.03063).

### B. w2/polish @f5492ef

Checklists: react-reviewer, typescript-reviewer, silent-failure-hunter and pr-test-analyzer, applied by hand as one review. D4-74 and D4-95..D4-100 were checked against the branch.

**What holds:**
- **The browser-gate timeouts are test plumbing, not a bar.** fanBlur runs one test per shot and rotorMotion one per pose and per legacyTraa control, in the same order on the same views. Each test has a 240 s timeout, over 8× its longest measured piece (27 s). The assertions are the old ones restated per test: `moving ≤ floor + MARGIN` for the shipped poses and `moving > floor + MARGIN` for each control. W2L-N16's fallback is stated in rotorMotion's comment as D4-99 item 4 confirmed it. In my run every rotor row and both controls equal pass 18's to the digit, sample by sample: the default cutaway shipped 9.75 / 12.13 against its control's 9.88 / 16.88, and the close-up 1.75 / 4.63 against 1.38 / 22.75. The split kept the measurement order.
- **W2A-I11 is fixed.** `explodedRings` is now every part that is not a skin, plus the blade rows' edges, each slid by its module's offset (`anchors.ts:206-224`). The stand is a separate mesh, not a part, so it is not in it. The unit tests frame it and require the drawn parts' box centred within 8 px each way and filling the area one way at both sizes. They also check that the front is the fan case, not the hidden inlet lip, and that no skin's radius is in it.
  - Mutant E1 (skins kept) is killed.
  - E2 (the blade rows dropped) survives. It is equivalent for the framing: the blade rows lie inside the parts' box, which the test pins by its extremes.
  - The shots show it (Visual review).
- **N31: the framed views are checked in Chrome.** `framedProblems` (`app.test.tsx:411`) fails Schlieren or Exploded whose posted framed box leaves the area above the dock less FRAME_MARGIN_PX (2 px residual). Mutant F1 (the worker's `framingOf` drops Exploded, pass 18's case) is killed at both sizes. In my run both framed boxes lie inside: Exploded 312-1032 px at 1366 and 358-1538 px at 1920, Schlieren 336-1006 and 439-1458.
- **N29: only background slots count toward MAX_WARM_FRAMES.** Mutant W10 (no count) is killed. My pass-18 probe's cases are the unit tests now: after 300, 420, 500 or 790 frames as the asked view, the view is warmed in the background.
- **N30: the grey band is 0.5 ± 0.01.** It was measured on HEAD and stated before the gating run. In the shots' records Schlieren has 0.914-0.917 of its free area in it, and the studio-backed controls 0.01-0.29 (the cut views 0.08-0.11, Exploded 0.14-0.29, Realistic 0.01). The 0.7 share bar now has a margin of 0.21 over Schlieren and 0.41 over the nearest control, where it had 0.15 under one before. Mutant G3 (the old 0.4 band) is killed.
- **The Schlieren Core exhaust label is off the jet.** `jetBox` is the core jet's tube from the nozzle exit to the near field's end, cut at the exit's centre, so the nozzle's own silhouette stays available to labels. It is posted in Schlieren only and passed to `layoutCallouts` as content to avoid, while the anchor stays callable. App.test's layout bar fails any label overlapping it.
  - Mutants C7 (the avoid list ignored) and J1 (the box not cut at the exit) are killed.
  - The shots show the label on the nacelle, left of the nozzle, at both sizes.
- **W2H-N10: the fixed-dt record is P5's window**, read from the contract (`stepRateHz`, `idleS`, `leverRampS`, `windowS`). `expect(asked).toBe(framesOf(P5.windowS))` pins 1380 frames. My run: 1380 fixed frames, 23.20 s of sim time, 1005 lost solves, 173 held snapshots (pass 18: 1440 frames, 24.15 s, 1005, 168; the extra held snapshots are the new time-based posts).
- **U4's scheduler cannot loop or starve.**
  - `nextWarmBudget` stops a frame's warm frames at the cap, when the configuration is done, or when a warm frame drew nothing new (what is left is the GPU compiling).
  - Every warm frame draws at least one new object while any is left, so the `while` in `warmSlot` ends.
  - A NaN `cpuMs` ends it too (`Math.max(0, NaN)` is NaN, and NaN > 0 is false).
  - A throw gives the configuration up, as before, and the `finally` records the CPU.
  - The background keeps one warm frame at 4 ms, its CPU rule and SLOT_EVERY.
  - Mutants W0 (the 30-frame wait back), W8 (no stop on nothing new), W9 (the asked view one warm frame), W11 (the cap at 900 ms), P1 (`&&` for `||`) and P2 (a 100 ms gap) are killed.
  - With `COLD_SWITCH_WAIT_FRAMES` = 0, the asked view's branch in the slot loop (`warmUp.ts:270`) is reachable only once a view is given up. That is dead in practice, and harmless.
- **The cap is soft by one warm frame**, which is expected. `warmFrame`'s `cpuMs` is its whole wall time, and the next warm frame's budget is the cap less what was spent. A frame can therefore pass 200 ms by one warm frame's draws plus one object.
  - The builder's gate run recorded frames of 341-380 ms CPU and snapshot gaps of 382-435 ms while preparing.
  - The official run's gaps were 108-145 ms. D4-100 allows up to 1000 ms.
  - My re-run: frames of 254-277 ms and gaps of 261-380 ms.
- **W2V-N26's tightened bar (2 % → 0.2 % after its first run): accepted.**
  - D4-74 forbids loosening a bar after seeing data, and this moves the other way.
  - The comparison is a self-consistency check: the shader's floor against its own TS mirror, with the floor-edge entries' rounding and off-curve colours excluded. Any disagreement beyond that is a bug, so 2 % was loose without a reason, and the shipped floor's 0-93 px (≤ 0.04 %) sits 5× under 0.2 %.
  - The test states the history.
  - It has power at the new bar. Mutant V2 (T's floor ×4) disagrees on 0.63 % / 1.14 % (idle / take-off), the builder's numbers. My V3 (T's floor ×2) disagrees on 0.29 % / 0.81 % and my V4 (p's floor ×2) on 19.1 % at take-off. All three are killed.
  - At idle a 2× T floor is only 1.45× over the bar, so take-off (the bypass air at 330-350 K) carries the T check. That is why the test runs both levers.

**U4 and the 30-frame wait (the handoff's decision 1).** D4-97 declined "skipping the CPU rule outright for the asked view", because a bounded wait kept the frame budget the default. D4-98 then cut the wait to 30 frames and spent the frame budget after it ("the user is already waiting on Preparing"). D4-100 asked for several warm frames per frame "while preparing". Removing the wait is a builder's reading. It reverses D4-98 item 1's adopted 30 frames and goes past what D4-97 declined, so it needs ratifying. **I recommend ratifying it**:
- The wait no longer buys the viewer anything. During it the old view animates smoothly for 0.5 s under "Preparing", and that 0.5 s was a quarter of U4's 2 s. On AC the official run missed U4 by 0.46-0.56 s.
- The cost is bounded and visible: frames of up to about 0.4 s while preparing, under the 1 s freeze bar, with the spinner up. Work for an abandoned view is not wasted, because its built objects stay built.
- The measurements, all on AC on a shared machine: with the wait 2.24-2.42 s (the builder's run4); without it 1.89-2.15 s (run5) and 1.41-1.58 s (the builder's gate run).
- My trial19 re-run (AC, the display on, not quiet, with the orchestrator's CPU d463 run on the CPU, so boot took 4.46-4.50 s against the quiet 3.5 s): **1.995 / 1.969 / 1.944 s** at light / 8.4 / 11.2 ms, 25-29 warm frames, nothing given up. My first run, with the display asleep, gave 2.13 / 1.98 / 2.00 s. So under load it sits at the bar, and the quiet window decides it.
- Reverting is one constant and its tests (mutant W0 shows the tests pin it).
- If the orchestrator wants D4-97's default back for quick click-throughs, a short wait (about 6 frames, 0.1 s) would keep most of the gain. Nothing measured asks for it.
- U4 in a quiet window is still owed (D4-99 item 1), and it decides U4, not this.

#### Blocking
None.

#### Important
None.

#### Nits
- **W2A-N32: `snapshotDue` mixes a frame modulo with a time gap, so the snapshot rate doubles when frames are slow** (`src/shell/publish.ts:13-15`).
  - After a time-based post, the next multiple-of-3 frame posts again.
  - In a model of steady frames:

    | frames | before (every 3rd frame) | now |
    |---|---|---|
    | 25 ms (40 fps) | 13.3 Hz | 26.7 Hz |
    | 30 ms (33 fps) | 11.1 Hz | 22.2 Hz |
    | 33 ms (30 fps) | 10.0 Hz | 20.0 Hz |
    | 50 ms (20 fps) | 6.7 Hz | 20.0 Hz |

  - The extra posts land when the frame is already over budget, against D2-9's 15 Hz realistic React load. Each also carries the anchors' projection and three screen boxes.
  - The unit tests cover only 60 fps and 250-280 ms frames.
  - Fix: count frames since the last post (`framesSince >= PUBLISH_EVERY || sinceLastMs >= PUBLISH_MAX_GAP_MS`). That caps the rate near 20 Hz at any frame time and keeps a heavy frame posting its own snapshot. Add a 40 fps case to the test.
- **W2A-N33: U4's check text names only the cap as the stop** (`src/hud/uiLevels.ts:25`, PHYSICS.md U4). The slot also ends when a warm frame draws nothing new or the view is done, and the cap is passed by up to one warm frame (above). Fix: "each slot several warm frames until their CPU reaches 200 ms (the last may pass it) or nothing new is drawn". It is a flagged contract text, so this is a wording request for the ratifying decision.

#### Verdict B: **MERGE**
- B 0, I 0, N 2 (W2A-N32, W2A-N33).
- D4-99 item 3 and D4-100's items are in:
  - the split tests and their timeouts;
  - Exploded framed on what it draws, centred, and checked in Chrome;
  - N29 and N30;
  - the label off the jet;
  - W2V-N26's lower edge;
  - P5's 1380 frames.
- The wait's removal goes to the orchestrator with my recommendation to ratify. The shots are fit to commit (Visual review).

### Visual review (the 13 uncommitted shots in `.claude/worktrees/w2-polish/docs/look-dev/ui/`, read only, against main's round 6-7 shots)
**Fixed and at the bar:**
- **Exploded (W2A-I11)** now fills the free area and is centred. At 1366 the content runs 312-1032 px against the area's 312-1030 (it was 135 px of studio on the left against 32 on the right). At 1920 it runs 358-1538 px, 25 / 29 px from the columns (it was 235 against 62). The engine reads about 20 % larger. The fan case is the front, with no phantom inlet lip.
- **Schlieren's Core exhaust label** sits on the nacelle, left of the nozzle, at both sizes, with a short leader to the exit. The jet's bright and dark bands are clear of any label, so critic pass 18's visual note 2 is fixed.
- Realistic, the cut views, Data, the drawer and the solver shot are round 7's: eight labels in two axial rows at both sizes, the 1366 drawer's Fan leader short, and the dashed crop outline as before.

**Notes:**
1. **These shots were rendered at DPR 1, because the display was asleep.** The records say "backing 1366x768 at dpr 1" and "ultra: ... at dpr 1 (high: 1)". Round 7's were at DPR 1.5 (backing 1920×1079 and 1994×1039, downsampled into the same CSS-pixel JPEGs).
   - My first trial19 run, with the display asleep, was at DPR 1 too. My re-run with the display held on was at DPR 1.5 ("ultra: backing 2049x1152 at dpr 1.5 (high: 1.41)").
   - So the builder's gate run, which waited hours for the machine to be free, most likely shot them with the display off.
   - At DPR 1 they are a touch softer at the edges, and D4-85's ultra row is vacuous: ultra and high are both the full DPR, under the 1080p cap.
   - The framing and the labels are what the branch makes. My DPR-1.5 trial19 shots (gitignored, `reports/ui/` in the critic worktree) match them in every element.
2. Still open from round 5 and on the W4 list: camera easing into framed views (D4-99), "Preparing the Data view…" for a quantity change, the T-s "45" on its line, and no labels in Exploded.
3. **Fit to commit: yes** in content, all 13 and both records. For parity with round 7's set, prefer a re-shoot on the merged main with `VITE_UI_LOOKDEV=1` and the display held on (DPR 1.5). Committing these is acceptable if the DPR is noted.

### Gates (trial19: main 9b5a6c2 + w2/solver-diverge @5d87a79 + w2/polish @f5492ef)
Power: **AC for every gate** (BatteryStatus 2, 100 %). The orchestrator's CPU d463 run shared the CPU throughout. Keep-awake: the gate script's (system only) for every gate, plus a system-and-display request for the browser re-run (Setup).

| gate | result |
|---|---|
| `npm run typecheck` | clean, 19 s (2/100 %) |
| `npm run lint` (ESLint + Prettier) | clean, 76 s (2/100 %) |
| `npm run coverage` (own reportsDirectory) | **139 files, 2395 passed + 11 expected fail (2406)**, exit 0 (the per-directory thresholds hold), 844 s (2/100 %). Statements 98.54 %, branches 87.95 %, functions 99.56 %, lines 99.55 %. Core lines: thermo 100 %, cycle 99.62 %, flow/reference 100 %, geometry 99.59 %, src/flow 99.50 %. Changed files (lines / branches): reference/boundary 100 / 90.2, gpu/params 100 / 93.3, warmUp 100 / 93.8, publish 100 / 100, anchors 100 / 83.3, callouts 100 / 88.2 |
| `npm run test:mesh` | 2 files, 29 passed (3 s) |
| `npm run test:gpu` | **12 files, 72 passed**, 86 s. E-L5 2.67e-8, E-L9a 2.46e-12 over the flux scale (their records); C-cut 4.84e-7 / 1.90e-6 / 3.18e-6 (row C's); the new backflow row 4.35e-6 / 6.57e-6 / 1.17e-5 |
| `npm run test:gpu-ladder` | **4 files, 15 passed + 1 expected fail** (L9a's D4-57 steadiness), 458 s. The long run's rows and D4-63's equal the builder's (A); L1 2.13e-5 m/s, B 1.266e-11, L7 1.779, L8 0.754 %, L2 0.00277, L3 0.00211, L4 0.00278 / 0.000996, L5 0.000843, L6 3.0e-4 / 4.9e-8 |
| `npm run test:browser`, first run | **void** (an environment failure), 1224 s, AC, 4.2 GB free, no other vitest browser run. The script's keep-awake held only the system (0x80000001), so the display slept at its 5-minute AC timeout. Chrome then rendered at DPR 1, fanBlur's hero and fanTakeoff timed out at 240 s (the whole file took 688 s against the builder's 26 s; hero's in-motion MAE was 0.169 against its 0.0062), and Modern Standby at 21:50:23 closed warmStall's browser connection. 9 files passed, and 3 were not reached |
| `npm run test:browser`, re-run with the display held (0x80000003) | **14 files, 55 passed**, 547 s (2/100 %), 5.3 GB free, no other vitest browser run, DPR 1.5. 0 WebGPU errors. `docs/` stayed clean |

### Mutants (by hand on the trial19 copy; `pass19-mutants.mjs.txt`; each file restored after)
| set | killed | survived |
|---|---|---|
| A, oracle (unit, `boundary.test.ts`) | A4c (vn ≤ 0 takes the branch), A5c (the backflow at p0, not p_out), A6c (the cell's T as the backflow total), A7c (the branch off) | none |
| A, kernel (Dawn) | A1g (the branch off: the oracle row, and the long run non-finite by 6800), A2g (the cell's swirl and Z into the backflow ghost), A4g (a backflow total of T∞ + 50 K) | **A3g** (`pOut: ref.p`, the uniform at p∞ whatever the BC: all of test:gpu passes, W2S-N1) |
| B, scheduler and cadence (`warmUp`, `publish`) | W0 (the 30-frame wait back), W8 (no stop when nothing new is drawn), W9 (the asked view one 4 ms warm frame), W10 (no background count: N29), W11 (the cap at 900 ms), P1 (`&&` for `\|\|`), P2 (a 100 ms gap) | none |
| B, framing, callouts, grey band (`anchors`, `callouts`, `schlierenCheck`) | E1 (skins kept), J1 (the jet box not cut at the exit), C7 (the avoid list ignored), G3 (the band back to 0.4-0.6) | E2 (the blade rows dropped): equivalent, they lie inside the parts' box |
| B, Chrome (`flowViz` W2V-I8/N26, `app.test` modes) | V2 (T's floor ×4: 0.63 / 1.14 %), V3 (T's floor ×2: 0.29 / 0.81 %), V4 (p's floor ×2: 19.1 % at take-off), F1 (Exploded's framing dropped: "exploded: no framed content box" at both sizes; its first run lost the browser connection and is not counted) | none |

**Totals:** A 7/8 (unit 4/4, Dawn 3/4); B 15/16 (unit 11/12 with 1 equivalent, Chrome 4/4). The probes are not mutants: the pre-fix reproduction (`repro.ts` on main) and the hot pocket (W2S-I1).

### Verdicts
- **A. w2/solver-diverge @5d87a79: MERGE.** B 0, I 1 (W2S-I1: pre-existing, for W3), N 3. Ratify §5's backflow branch: it is the standard pressure-outlet backflow, the same in both implementations, and bitwise neutral for vn ≥ 0. The long-run test fails without it (non-finite by 6800) and passes with it, and the CPU d463 run passes D4-79's rows with it.
- **B. w2/polish @f5492ef: MERGE.** B 0, I 0, N 2. The 30-frame wait's removal needs ratifying; I recommend it. The re-shot images are fit to commit.

**Merge order:** w2/solver-diverge, then w2/polish (trial19's order; the two touch no common file, so either order is clean). Commit the 13 shots and the two records after the merge, from the polish worktree as they are, or from a re-shoot on the merged main. After the merge, the next quiet window measures P4flow and P1's field health with A's fix (D4-100), and U4 alone with `VITE_UI_QUIET=1` (D4-99 item 1).

### Questions for the orchestrator
1. **SOLVER.md §5 (A):** ratify the backflow branch as the outflow's rule, with (p_out, T∞, Z = 0) as the backflow totals? Flight cases revisit the totals at W3 (W2S-N3).
2. **W2S-I1:** pre-register the hot-pocket case (CPU and GPU, D4-79's rule) before W3's coupling, and give the scheme round the step limit (D4-44 (b), or a local step from the hot cell's preconditioned eigenvalues, a positivity guard last)? My probe is the starting case.
3. **U4 (B):** ratify `COLD_SWITCH_WAIT_FRAMES` = 0 (the asked view warms from its first frame of preparing), against D4-97/D4-98's wait? I recommend it. Also, U4's check text as amended by W2A-N33?
4. **The shots:** commit the builder's DPR-1 set (shot with the display asleep), or re-shoot on the merged main with the display held on, so the set is at DPR 1.5 like round 7's? I prefer the re-shoot.
5. **Keep-awake in detached browser runs:** make it system and display (`0x80000003`, ES_DISPLAY_REQUIRED added), for builders and critics alike? With the system flag alone, the display sleeps at its 5-minute AC timeout, Chrome drops to DPR 1 and is throttled, and Modern Standby can close the browser connection. My first browser gate failed that way (fanBlur about 10× slower, 2 timeouts at 240 s, warmStall's connection lost), and the builder's shots show the same DPR 1. D0-1 already asks for the display awake in official runs.

## Critic pass 20: w3/scheme @97a2769 (rounds 1-2) (PARTIAL: gates and mutants in progress)

**Scope.** w3/scheme `e6c48de..97a2769` (24 commits; e552cc1 is the orchestrator's merge of main's D5-5):
- W2S-I1's fix: SOLVER.md §10/§17's pairwise face radius in the local step (2b87b39), oracle and kernel;
- D5-5 item 1: the slip-wall ghost mirrors ρ′ and Z (ea9c486), oracle and kernel;
- L14 on the CPU oracle and the GPU kernel, with D5-5's restated peak row (the KNOWN-FAIL pin lifted, d9e728e);
- W2S-N1..N3, J's pin lifted at 0.003, the wall-ghost GPU test's bound (cd88474);
- SOLVER.md §5/§17/§17.1 and PHYSICS.md 3.3's L14 result line.

**Setup** (2026-11-03, the critic worktree):
- A local branch `trial20` from main 493f72c took `--no-ff` w3/scheme (9458e5c), clean. Its tree equals 97a2769's, because w3/scheme already holds main.
- `git diff --stat main..w3/scheme` touches only docs, `src/contracts`, `src/flow` and tests, so test:browser is not run.
- **Power: on battery for every gate and probe** (BatteryStatus 1, 100 % → 91 % so far), so the timing rows are indicative. Gates ran detached one at a time (`reports/scratch/c20/gates.ps1`, the display held with 0x80000003), and no probe ran beside a gate.
- Probes ran on `git archive` copies of main (`reports/scratch/c20/main`), trial20 (`br`) and 9b5a6c2 (`pre`, main before D4-101). The E-L9a probe ran as a temporary GPU test file in the critic tree, deleted after.
- The builder's worktree and its `reports/scratch` were only read.
- New probes, committed with this pass:
  - `docs/reviews/probes/w3s-el9a-sensitivity.probe.ts.txt`;
  - `w3s-l14-controls.probe.ts.txt`, with `w3s-l14-guard-control.patch.txt` (the guard-only control re-implemented on main from SOLVER.md 17's text);
  - `w3s-j-outflow-cycle.probe.ts.txt`.

### 1. The pairwise face radius (2b87b39): right, the same rule on both sides, plain and physical paths untouched

- **The rule is the standard local wave-speed bound of a face (Rusanov/LLF), applied to the preconditioned system.** Each face's λ is b_f |S| max(r(q_c, β_c), r(q_nb, β_nb)), and the cell's τ is CFL over the sum of the two directions' larger face terms.
  - What crosses a face is set by both of its states. The old τ took only the cell's own, so a cold cell at β = minMach (a step 50× its acoustic one) beside 100-300 m/s hot gas ran at a Courant number of about 10.
  - The builder's linearisation (|G| 16.4 → 1.24) and my reading agree on that mechanism. The steady state cannot move, because R = 0 does not depend on τ. L7 converged to 1e-6 shows it (item 6).
- **The slip-wall exclusion is right.** The wall flux is pressure only, and the wall ghost is a reflection, not a state of the gas. With ρ′ mirrored and p′ extrapolated, its T′ = p′_g/ρ′_g is hotter than any neighbour wherever p has a wall-normal gradient: 23 % in the unit row at p∞ + 30 kPa.
- **The oracle and the kernel are the same rule, by reading.**

  | part | oracle | kernel |
  |---|---|---|
  | the cell's own radius | `spectralRadius(u·n, c, β²)` (`solver.ts`) | the same call |
  | the neighbour's radius | `neighbourSpectralRadius` (`precondition.ts`) | `neighbourRadius` (`kernels.ts`) |
  | the neighbour's state | P of the extended index (a cell, or a ghost after its BC) | the halo's `wqa`/`wqb` (the same ghost, filled by the same BC code) |
  | the neighbour's c | `temperatureFromPressure(ρ′, p′, φ(Z))`, then `soundSpeed`; never the stored T′ or c | the same, in the same order |
  | the neighbour's β | `betaExt` (a ghost: its `ghostSrc`'s) | `wbeta` = sqrt(`cellBeta2[betaSource(e)]`) |
  | the wall test | `wall[nb] === 1` | `wb[t] < 0` (EXT_B negative from the same `layout.wall`) |
  | when it applies | `tracking && pre && minMach < 1` | `P.mode == 0`, `P.stage == 0`, `precondition == 1`, `minMach2 < 1` |

  - A layer-1 ghost's β is its source cell's, i.e. the boundary cell's own, on both sides.
  - An interface ghost (code 0) is the neighbour block's cell, so the face takes that cell's β and state on both sides. That is the block-interface case, which C-pre (three blocks, an axis and slip walls, at 0.02) checks kernel against oracle every run: 5.68e-7 / 3.72e-7 / 1.30e-6 against 1e-5 / 1e-4 / 1e-3 in my test:gpu.
  - The face-neighbour halo positions all lie in the first ring that `wbeta` holds.
- **Plain and physical-time paths are bitwise as before, by reading.**
  - The oracle's non-pairwise branch does the same operations in the same order: `lf = spectralRadius(...)`, then `bf * area * lf`.
  - `globalDt` (physical time) calls `computeLocalDt(false)`.
  - The kernel's else branch is the old `cellLambda` call on the same four face reads.
  - My test:gpu repeats E-L5 2.67e-8 and C (plain) 5.46e-7 / 2.30e-6 / 6.49e-6, and the GPU ladder's L2 0.002768 / 0.2282, L3 0.002113 and L4/L5 equal their records.
- **CPU and GPU agree on the rule end to end:**
  - L14 (below) to every digit shown;
  - D4-63 on the 130k multi-block engine mesh: (a) 0.4497 on both, (b) 0.2156 / 0.2158.

### 2. The mirrored wall ghost for ρ′ and Z (D5-5 item 1): the standard reflective treatment, conservative, L6 intact; one accuracy note

- **It is the standard reflective ghost for a scalar at a slip wall.** It gives a zero normal gradient in the ghost, so the limiter makes the wall cell's ρ′ and Z first order in the wall-normal direction.
  - A minmod-type limiter sees Δ− = 0, so the slope is 0, and the face value towards the interior is the cell's own q₀.
  - An outgoing flow then carries out at most what the cell holds, which removes round 1's drain: dρZ/dt = −ṁ(Z₀ + Z₁)/2 < 0 at Z₀ = 0.
  - The Euler slip wall does not itself require ∂s/∂n = 0. The mirror is a choice of the reconstruction, as in most codes, and it is the right one here.
- **Conservation at the wall is untouched.** The wall face's flux is |S|(0, p′_w n, 0, 0, 0) from the extrapolated p′ (§7), independent of the ghost's ρ′ and Z, so mass, energy, fuel and angular momentum through walls stay exact zeros.
- **L6 is untouched.** It needs p′ and ρw extrapolated, which they still are. My test:gpu-ladder gives free vortex 3.000e-4 / 4.93e-8 and solid body 2.87e-5, against the records 3.005e-4 (CPU) and 3.007e-4 (GPU). The CPU ladder's values are under Gates.
- **The mix with extrapolated p′ is consistent where it matters.** Its one cost is first order, not a defect: the wall cell's face state towards the interior pairs a first-order ρ′ with a second-order p′, so its T′ is off by about ½ Δρ/ρ of the wall-normal step.
  - In an isothermal pressure gradient that is a face T hotter than both cells by ½ Δp/p.
  - It is O(Δ) at a limiter extremum, the same order the limiter already accepts there. It is the reason the wall face keeps the cell's radius (above).
- **The oracle and the kernel are identical.**
  - The oracle copies k 0 and 5 from the layer's own source and extrapolates k 3 and 4.
  - The kernel does the same with two `select`s (exact in f32).
  - The GPU test checks ρ′ and Z of all 48 wall ghosts bitwise against their source cells, on both sides.
  - My mutants W1c, W1g and W2g (below) are killed.
- **The engine runaway** (reported, not gated; the builder's `runaway-branch.txt`, read): finite to 8000 from the pre-fix 6700 state, max T′ 1042 → 851 K, no non-finite cell in any of the 26 samples. Round 1's branch went non-finite by 6770 at the core duct's outer wall.

### 3. L14 as implemented, and the restated peak row

- **The implementation matches PHYSICS.md 3.3 exactly** (`tests/ladder/hotPocket.ts`):
  - the duct, the 10 cases (8 + the two probe cases) and the pocket at pressure equilibrium with Z 0.015;
  - the engine defaults (thermally perfect, 0.02, CFL 0.8 by default, the sharp limiter);
  - every case sampled after every iteration;
  - the four rows, each NaN-safe (a run that does not hold fails all three value rows);
  - T′_s = T_h (p/p∞)^(R/cp) − T∞ with R and cp of the mixture at T_h and Z 0.015;
  - the CPU and GPU tests share the rows, and `thresholds.ts` mirrors 1.03 and 0.03.
- **PHYSICS.md's row text is unchanged** (`git diff main..w3/scheme -- docs/PHYSICS.md` is one added line, the "Result (w3/scheme round 2)" bullet under the amended bullet, as L4's "Result (2026-10-27)" is recorded). The result line's numbers are right (1.021, −0.0070, 2.647, 1.031).
- **The restatement is principled, not a loosening of what the row is for.**
  - In an inviscid adiabatic flow a parcel's T at pressure p exceeds its isentrope only through shock entropy. For the slug's leading edge (a velocity jump of about 150 m/s into hot gas at c ≈ 700 m/s) the shock entropy is under 0.2 % of T. Mixing with cold gas only lowers T.
  - So T′ ≤ 1.03 T′_s is a maximum principle that the physics obeys with about 2.8 % to spare, and a violation is a temperature the scheme made.
  - It is looser than the pre-registered row in compression (T′_s 1.034 ΔT at 11 kPa) and **tighter** in expansion, where T′_s < ΔT (the slug's trailing edge).
  - The constant cp at T_h makes the bound generous by under 0.01 % of T at these pressures, in both directions.
  - Its limitation is W3S-N3: the bound moves with p, so a temperature that follows a spurious pressure is accepted.
- **The controls hold, by my own runs** (`w3s-l14-controls.probe`, 10 cases each, every iteration sampled):

  | scheme (tree) | worst peak T′/T′_s | its old row (peak/start) | cases passing every row | worst min T′/ΔT |
  |---|---|---|---|---|
  | **the guard-only control** (main + my re-implementation of SOLVER.md 17's guard: the increment halved until ρ ≥ ½ρⁿ and ½T ≤ T ≤ 2T) | **2.6469** (1200 K, −300, wall, iteration 156): **FAILS** | 2.6451 | 2 | −0.1883 |
  | the guard's other moving cases | 1.1060 and 1.0421 also fail; the other five pass the peak row but fail the undershoot row | | | |
  | the plain scheme, CFL 1.5 (trial20) | **1.0311 / 1.0312** (900 K, −300, wall / mid, iteration 5): fail | 1.1684 / 1.1697 | 7 (the at-rest case fails "end ≤ start" by round-off) | −0.0410 |
  | main before the fix (contract step, extrapolated wall) | 8 cases non-finite at iteration 1 | | 1 | −0.2168 (900 K, −50) |
  | trial20 (my test:ladder and test:gpu-ladder; Gates) | see Gates | | 10 | |

  My guard re-implementation gives the builder's 2.647 to the digit, and every other value of the builder's `ctl-guard-extrap.txt`, so the trial copy's guard is the one SOLVER.md 17 describes.
- **The plain scheme failing the restated row at 1.031 is itself evidence that the row has teeth.** It sits at iteration 5 in the leading edge, where shock entropy accounts for under 0.2 %. So the plain sharp-limiter transient overshoots its own isentrope by about 3 %. "Closer to the physical transient" (§17) is true of its old-row 1.17, which was mostly compression, but not of the 3 %.

### 4. E-L9a's flux-scale row: measured; recommendation (1), restate it (form below)

**My measurement** (`w3s-el9a-sensitivity.probe`, E-L9a's set-up exactly, Dawn on the Arc iGPU, run twice: trial20, and trial20 with main's two `wallGhost` files):
- The row compares the residuals of U⁹, the first stage of iteration 10. Checked: the oracle's recomputed R(U⁹_ref) equals `stats.residualDensityL2` to 0.
- So every sensitivity is evaluated at U⁹ by a third solver, the oracle's code in f64.

| over r_flux (r_ref / r_flux = 3.735e-4 both) | main's wall (extrapolated) | trial20 (mirrored) |
|---|---|---|
| **the row** \|r_GPU − r_ref\| (D4-71's bar 1e-10) | **2.464e-12** (the record) | **1.187e-9: FAILS** (the builder's) |
| S1: \|L2 R(U⁹_GPU, hi + lo) − L2 R(U⁹_ref)\| | 1.324e-10 | 1.165e-9 |
| S2: the same with the GPU's f32 part only | 3.594e-10 | 1.094e-9 |
| **S3: \|L2 R(fround U⁹_ref) − L2 R(U⁹_ref)\| (rounding the oracle's own state to f32: no GPU in it)** | **6.6e-12** | **1.944e-10** |
| K: \|r_GPU − L2 R(U⁹_GPU, f32 part)\| (the kernel against the oracle on the kernel's own state) | 3.619e-10 | 9.289e-11 |
| K2: the same against R(U⁹_GPU, hi + lo) | 1.348e-10 | 2.202e-11 |
| per-cell rms \|R(U⁹_GPU) − R(U⁹_ref)\| (the norm of the difference) | 1.85e-7 | 1.60e-7 |

**What the measurement shows:**
- **The record passed by cancellation (the builder is right in kind).** With the old wall, the GPU's state moves the oracle's own residual by 1.3-3.6e-10, and the kernel's arithmetic on that state is off by 1.3-3.6e-10 the other way. The two cancel to 2.46e-12, 50-150× below either.
  - That is the iteration's self-correction: each solver drives its own residual along the same pseudo-time path, so r_GPU tracks r_ref while U_GPU drifts.
  - The builder's numbers (2.0e-9 old wall, 4.3e-9 mirror) are not the states the row compares (W3S-N2). Mine, at U⁹, are 5-15× smaller and give the same conclusion.
- **With the mirror the cancellation is gone and the bar is below the f32 floor.**
  - Rounding the oracle's own exact U⁹ to f32, with no kernel at all, moves the row's quantity by 1.94e-10, twice D4-71's 1e-10. The mirror makes the residual's L2 30× more sensitive to state rounding: the per-cell rms is unchanged, but the perturbation now projects onto the residual, presumably through the wall cells' zero-slope ρ′.
  - So no f32 kernel can meet 1e-10 on this row with the mirrored wall, except by luck. That is W2R-I17's failure mode (a bar that correct arithmetic can fail), which D4-71 itself fixed by moving the bar above the norm's floor.
- **The kernel is not worse.** K/K2 (its residual against the oracle's on the kernel's own state) is 4-6× **better** with the mirror (9.3e-11 / 2.2e-11) than with the old wall (3.6e-10 / 1.3e-10). The field row (6.05e-6 ≤ 1e-4) and the residual's own form (3.18e-6 ≤ 1e-3) pass as before.

**Recommendation: (1), restate the row; neither (2) nor (3).**
- **Not (3), rejecting the mirror.** The failure is the row's measurement, not the kernel. The mirror is what makes L14's undershoot rows, the GPU at-rest case and the engine runaway pass.
- **Not (2), the pin.** A KNOWN-FAIL pin discards the row's power for good.
- **Not the builder's form either.** "|r_GPU − r_ref| ≤ the oracle's |R(U_GPU) − R(U_ref)|" fails at U⁹ (1.187e-9 > 1.165e-9 and 1.094e-9). It is the triangle inequality's S + K with K dropped, so it sits on a knife edge.
- **The form I recommend** (a test change; the threshold value is the orchestrator's):
  - The row evaluates the oracle at the **GPU's own U⁹**: run 9 iterations on both, read the GPU's state back (`readConserved`, hi + lo), evaluate the oracle's density-residual L2 on it, then run the 10th iteration.
  - The gated row becomes K2 = |r_GPU − L2 R_ref(U⁹_GPU)| / r_flux, with D4-62's rule: ten times the measured 2.2e-11, i.e. **3e-10**.
  - That isolates what the row is for, the kernel's residual arithmetic. The state drift it used to include is the field row's business.
  - 3e-10 is above W2R-I17's norm-reduction band (1.1e-11 to 8.8e-11 here), and both walls pass it (2.2e-11 and 1.35e-10).
  - The old form is printed beside it as a reported row, with S3 (the f32 floor).
- **That is a re-posed row, not a loosened one.** Its quantity excludes a term the kernel cannot control, and its bar sits 3× tighter than the old form's f32 floor with the mirror.
- **If the orchestrator prefers to keep the old form,** the honest bar is above its floor: S1 ≈ 1.2e-9 → ten times it, 1e-8. That is a real loosening, which I do not recommend.

### 5. Commit cd88474 (the wall-ghost GPU test's bound): justified, not a loosened bar

- **The bar it replaced was the builder's own first draft** (61da405, same round): TOL[1] × max|q| over the cells. It was not a pre-registered threshold.
- **The new bound is the exact error propagation of the extrapolation.** A ghost a q₀ − b q₁ with a + b ≤ 5 carries at most 5× its cells' error, plus the rounding of the result. 2⁻²² |R| is 4 u, which covers layer 2's rounding of 3q₀ plus the subtraction.
- **Why the first draft failed with correct code.** The kernel's p′ comes from f32 conserved values, so its cell error is a few hundredths of a pascal. Five times that exceeds 1e-5 × 4 kPa = 0.04 Pa.
- **It keeps its teeth.**
  - The test's state has a 1 % per-cell p′ gradient (about 1 kPa), 10⁴-10⁵ × the tolerance. My mutant W3g (the kernel's p′ mirrored instead of extrapolated) is killed by this test (Mutants).
  - ρ′ and Z are now checked bitwise (`toBe`), which is stricter than any tolerance.
- **Weak spot (no finding).** Using the field's max cell error, not the ghost's own two cells', widens the bound for ghosts beside quiet cells. With the gradients the test sets, that leaves ample margin.

### 6. D5-5 item 3: converged values at or better than record

- **L7 converged to 1e-6** (the builder's `l7t-*.txt`, read, not re-run: about 32 min each on AC):

  | scheme | asymmetry | Cd | iterations |
  |---|---|---|---|
  | the branch (pairwise step, mirrored wall) | 0.0110887 | 0.00112104 | 35867 |
  | the contract step, mirrored wall | 0.0110888 | 0.00112116 | 35838 |
  | the scheme of record (contract step, extrapolated wall) | 0.0110888 | 0.00112116 | 35838 |

  - All three stopped at a residual of 8.8e-7-9.3e-7 of the first.
  - So the steady state is unchanged: 1.6e-7 and 1.2e-7 between the rules, 2e-9 between the walls. The branch is at (asymmetry) and better than (Cd) the record scheme, both converged.
  - The record's 0.01093 is a value at the 1e-4 stop. The converged value of the record scheme itself is 0.011089.
- **CPU d463 of record** (the builder's `run/d463.log`, read; 5110 s, on AC per the handoff): every row passes.
  - (a) 0.4497 / 0.008369, against the record 0.4450 / 0.009223;
  - (b) 0.2156 / 0.03297, against 0.1535 / 0.03063.
  - These are fixed-iteration values (item 3's second clause): their bars are ≤ 2 and ≤ 1, met by 4-30×.
- **My GPU ladder, against the record:**
  - D4-63: 0.4497 / 0.008217 (a), against 0.4450 / 0.008997; 0.2158 / 0.03297 (b), against 0.1634 / 0.03253; trend 0.876 per 1000, against 0.820.
  - W2S-B1: 0.6286 / 2.057e-3 (a), against 0.6588 / 5.088e-4; 0.1621 / 0.0262 (b), against 0.1082 / 0.007278.
  - Every bar holds by 4-500×. (b) 20000/10000 is the one value clearly worse (+32 % on the GPU, +40 % on the CPU). It is read at a fixed iteration of a changed map, so it is reported, as D5-5 says.
- **L9a's D4-57 steadiness row: see Gates** (my CPU ladder).

### 7. J at M_cut 0.02 (D5-5 item 4): stated correctly, and pre-existing since D4-101

My `w3s-j-outflow-cycle.probe` (J's set-up from `precondition.test.ts`, the last 2000 iterations sampled):

| tree | M_cut 0.02 | M_cut 0.003 |
|---|---|---|
| 9b5a6c2 (main before D4-101's backflow branch) | **meets D4-44 (c)'s rule at 9441**, residual 2.9e-6-9.9e-5 of its peak over 12000-14000; steady backflow on rows 10-14, no sign change | (not run) |
| main 493f72c (D4-101, contract step, extrapolated wall) | **stalls at 0.60-0.88**; rows 5-9 switch sign 65-66 times and rows 10-15 33 times in 2000 | stalls at 0.28-0.45 (20000 its) |
| trial20 | stalls at 0.57-0.87; rows 5-9 62-63, rows 10-15 30 | **converges at 2415** (1.7e-7-1.0e-6 over 10000-12000) |

- **The finding is stated correctly.** The stall is a limit cycle at the outflow rows beside the jet, and it is not this branch's: main stalls the same way.
- **The attribution can be sharper.** It came in with D4-101's backflow branch on main. Before it, J at 0.02 met its rule at 9441, as SOLVER.md §10's M_cut 0.02 table records. Critic pass 19 did not run J at 0.02, since it is not a row. W3S-I2 below.
- **The period, precisely.** "About 64 iterations" is right for rows 5-9 (a sign change every 31 iterations). Rows 10-15 switch at half that rate, and the residual's autocorrelation peaks at 122-129.

### Gates (trial20 = main 493f72c + w3/scheme @97a2769; on battery throughout)

| gate | result |
|---|---|
| `npm run typecheck` | clean, 21 s (1/100 %) |
| `npm run lint` (ESLint + Prettier) | clean, 79 s |
| `npm run test:mesh` | 2 files, 29 passed (3 s) |
| `npm run test:gpu` | **12 files, 73 passed, 1 failed: E-L9a's flux-scale row, 1.187e-9 against D4-71's 1e-10** (W3S-I1), 82 s. E-L5 2.67e-8 (record). C 5.46e-7 / 2.30e-6 / 6.49e-6, C-pre 5.68e-7 / 3.72e-7 / 1.30e-6, C physical 2.34e-7 / 3.11e-7 / 3.02e-5, D Sod 3.66e-8 / 4.56e-8, E L5 6.19e-6, E L9a 6.05e-6 (residual form 3.18e-6), S 5.32e-7 / 5.79e-7 / 1.30e-5, backflow at p_out 1 / 0.98 p∞ 4.20e-6 / 4.07e-6 / 9.87e-6 and 4.90e-6 / 4.86e-6 / 8.37e-6 (W2S-N1's row) |
| `npm run test:gpu-ladder` | **5 files, 17 passed + 1 expected fail** (L9a's D4-57 pin, 1.344e-5), 368 s (1/96 %). L14 every row of all 10 cases (worst peak T′/T′_s 1.021, worst min −0.00698 ΔT; at rest 1.000 / 0.4115 / −3.2e-5). L1 2.13e-5 m/s; B 1.266e-11; L2 0.002768 / 0.2282; L3 0.002113; L4 0.002779 / 0.0009964; L5 0.000843; L6 3.000e-4 / 4.93e-8, 2.873e-5; L7 0.01110 / 0.001287 / 1.644; L8 0.7530 % (3.26e-5); L9a 1.657e-6; L9b 0.7990 % (3.43e-5); D4-63 and W2S-B1 as item 6 |
| `npm run coverage` (`--coverage.reportsDirectory=reports/scratch/c20/coverage`) | **140 files, 2409 passed + 10 expected fail**, exit 0, 344 s (1/91 %). Statements 98.54 %, branches 87.97 %, functions 99.56 %, lines 99.55 %. Core lines: thermo 100 %, cycle 99.62 %, flow/reference 100 %, geometry 99.59 %, flow/gpu 99.75 %. Changed files (lines / branches): reference/solver 100 / 85.3, precondition 100 / 100, reference/boundary 100 / 90.7, thresholds 100 / 100 |
| `npm run test:ladder` without d463, first run | **void for 5 files**: the laptop entered Modern Standby at 08:21:45, 3 min in, and left it at 09:11:58 (Kernel-Power 506/507), despite the script's execution-state request, so L7, L8, L9b, floor and L14 hit their 30-min timeouts on waking (3212 s). Valid from it (they finished before the standby, or started after it): L1 0 / 2.03e-13; L2 0.002767 / 0.2282; L3 0.002113; L4a 0.2779 % / 0.0997 % / 915; **L4b 1.640 % / 2.580e-4** (started 09:12 after waking); L5 0.0843 % / 948; L6 3.004e-4 / 4.5e-15, 2.902e-5 / 5.41e-8; **L9a 9.824e-6, D4-57 steadiness 9.202e-6: PASSES** (convergence row known); f32 rows C 1.69e-7 / 4.09e-7 / 1.26e-6, C-pre 1.35e-7 / 1.71e-7 / 4.99e-7, C physical 8.0e-8 / 2.6e-7 / 7.2e-6, S 1.25e-7 / 1.34e-7 / 9.50e-7 |
| `test:ladder`, the voided files re-run (L7, L8, L9b, floor, L14) | (running) |
| `test:browser` | not run: no render, ui or app code in the diff |

(Mutants, findings and the verdict follow.)
