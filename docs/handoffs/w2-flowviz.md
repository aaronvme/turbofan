w2/flowviz: round 3 DONE (critic pass 12: W2V-I1..I6 and the nits fixed, D4-82 and D4-83 built; ready for the critic's next pass) (from main 1eb1e62; round 2 ended at 2cfd469; HEAD: see `git log -1`, the handoff commit)

DONE (round 3, critic pass 12 and decisions D4-82, D4-83)
- 31c3863 (TDD) the failing unit tests first: the coupling state and its source check (`tests/unit/contracts/flow.test.ts`), the field link (`tests/unit/flow/viz/fieldLink.test.ts`, new), the substeps and the axis sign (`particles.test.ts`, `particleKernel.test.ts`), D4-83 and the crop, N10, N11 (`colormaps.test.ts`), the labels and notes (`legend.test.ts`), N13 (`passTimings.test.ts`), N14 (`glow.test.ts`), the march offset and the gradient kernel's TS mirror (`schlieren.test.ts`, `particleKernel.test.ts`).
- **W2V-I1, D4-82** (5782eb7): **flagged contract addition, minimal:** `src/contracts/flow.ts` gets `FlowCoupling = 'mock' | 'uncoupled' | 'coupled'` (`FLOW_COUPLINGS`, `flowCouplingProblems`) and a required `coupling` on `FlowField` and `CpuFlowField`. `GpuFlowSolver.fields()` says `'uncoupled'` (one line in `src/flow/gpu/device/flowSolver.ts`; W3 flips it when its coupling drives the body forces), the MOCK `'mock'`. The binding refuses a field whose coupling contradicts its source. `provenanceLabel(coupling, fallback)`: "MOCK field ...", "Flow solver (uncoupled until W3): GPU, 2D axisymmetric + swirl; no blade or combustor forces", "Live flow solver ... coupled to the cycle". The legend carries `coupling`; `EngineView.stats().flow.coupling`. The panel's badge dot: amber MOCK, blue uncoupled, green coupled. Tests: the unit tests above; `tests/gpu/flow-solver.test.ts` (`coupling` 'uncoupled'); `tests/browser/flowPanel.test.ts` (the badge and the legend read "solver (uncoupled until W3)").
- **W2V-I6, D4-82** (5782eb7, e4f25dd): `src/flow/viz/fieldLink.ts` (pure, unit-tested with fakes): which field is drawn and the runtime MOCK fallback. A solver that cannot start (mesh fetch, `init`, the device's limits), is unavailable, lost or diverged (`sanitizeFlowStatus`: a non-finite readback is divergence), whose step throws, or whose field the visuals refuse, is replaced by the MOCK at once: the MOCK is bound before the solver is disposed, the state carries the reason, and it is warned. A solver that re-creates its textures is rebound (W2V-N19). The look-dev panel uses it (the health check every frame, the step only while a mode draws it); the cut plane also discards non-finite values. Tests: 10 unit cases; `tests/browser/flowPanel.test.ts` (2: a failed start and a solver lost mid-run fall back; the badge and the legend say "MOCK fallback" with the reason; 0 WebGPU errors).
- **W2V-I2** (e4f25dd): the solver-link test sets a known state (`kernel.setUniform`, uniform 110 m/s, off every contour) and resamples it with 0 iterations: 53344 of 56041 Data plane pixels (Mach 0.323) and 53092 of 55891 Cutaway pixels (110 m/s) are within 3/255 of that value's LUT colour, 0 of the zero colour (bounds > 80 % and < 5 %). A zero, misbound or misscaled velocity texture fails it. (The first try at 100 m/s put the whole plane on a 50 m/s contour line.)
- **W2V-I3** (e4f25dd): the haze and schlieren targets are read back (`EngineView.readFlowTarget`) and compared ray for ray, over a column through the core jet, with `rayDeflection` on the same pixel rays, the shader's per-pixel offset (`marchOffset`, three's IGN, now a `rayDeflection` option) and the gradient kernel's TS mirror (`densityGradientRaster`, `sampleGradientRaster`). Tolerance: 1 % of the column's peak (f16 storage, 8-bit filter weights) plus the step count's quadrature error against 768 steps. Schlieren: worst 0.13 % of the 1.23e-3 rad peak, 0 of 540 outside. **It found a real bug:** the haze's shift was twice the physical one (99.8 % at the peak: `screenSize` inside the half-resolution RTT is the RTT's, GPU_FACTS M55). Fixed with resolution-free uniforms (2 tan(fovY/2), the aspect): worst 0.09 %, 0 outside.
- **W2V-I4** (5782eb7, 75e96c1): `advectSubstepped` (`src/flow/viz/particles.ts`) and its WGSL mirror: midpoint substeps of at most one texel (6.8 mm, so the fluid checks are half a texel apart), each dividing the time left evenly by the speed at its start, at most `MAX_SUBSTEPS` = 128 per frame (x1/10 at 60 Hz up to 525 m/s); beyond that a tracer falls behind instead of through a wall. Tests: one RK2 step tunnels a one-texel wall at x1/10 and the substeps stop at it; the substep spacing; one substep equals the old step; the cap. Dawn: a x1/10 step against the TS mirror, 0 branch mismatches, 8.4e-5 m (bound 4.8e-4: the velocity bound x dt + f32 rounding); a no-substep WGSL mutant fails both Dawn steps (213 mismatches, 0.87 m).
- **W2V-I5** (5782eb7, e4f25dd): the flow layers render with their own camera, a copy of the scene camera taken before TRAA jitters it (`post.ts`; the haze and schlieren march on its matrices too). `setDebugFlags({ jitterFlow: true })` keeps round 2's jitter as the negative control. Browser test: a still Data frame's overlay (everything else hidden) is bit-identical frame to frame (0 changed, 278643 plane pixels) against 222681 changed with the jitter (GPU_FACTS M54).
- **D4-83** (5782eb7, cb5ec4b): `FlowVizMode.tracersByDefault` (Realistic false; Cutaway, Data true), `tracersShown`, `EngineView.setFlowTracers(on | null)`, the panel's Tracers switch (`&tracers=1|0`, key `k`, since `t` is the page's throttle), `stats().flow.tracers`. The crop has a crisp anti-aliased edge and a 1.25 px light outline (`CROP_OUTLINE`, alpha 0.55) instead of the 25 cm fade; `cropAlpha` is a step. The browser test checks the tracers per mode.
- Nits (5782eb7 unless noted):
  - N7 (02c374e): `.claude-scratch-h.py` removed.
  - N8 (e4f25dd): the browser frames and `timing.json` go to `reports/flow/` (ignored); `VITE_FLOW_LOOKDEV=1` writes them to `docs/look-dev/flow/`.
  - N9 (be4f501): every screenshot re-shot (below).
  - N10: a/f = 1000 µrad (the comment's own ~1e-3 rad estimate inside the grey scale), pinned by a test.
  - N11: `GAMMA_R_TABLE` / `airGammaR` (air, nearest entry): the shader uploads it and `deriveQuantities` uses it, so the tested Mach is the drawn one.
  - N12: the step uses the odd extension across the axis (a midpoint beyond it negates u_r), TS and WGSL.
  - N13: `RollingPassStats` skips frames without a flow time (none drawn, or every flow query dropped: `sumFlowMs` is then NaN); 0 only when no frame drew any.
  - N14: `createGlowRadianceCache`: a part's radiance is recomputed only when its temperature or emissivity changes.
  - N15 (c39f425): the ledger's glow line gives ~9 % (HPT vane) and ~15 % (LPT vane) of a lit white wall, and states the absolute-T41 assumption for the HPT blade (an upper bound).
  - N16 (be4f501): GPU_FACTS M53 records 1.28 (1.16-1.56), the gate run's 1.18 (1.15-1.22) and round 3's numbers.
  - N17: Realistic's note says "(Gladstone-Dale; mean flow, no shimmer)"; every note ends "The visuals add nothing synthesized."
  - N18: the note and the ledger state the 0.25 s exposure and the 45 cm cap (and why the cap stays).
  - N19: the solver extent's bounds are checked, not only its size; a solver that re-creates its textures is rebound (the link).
- The critic's visual notes: Realistic has no tracers (1); the crop is crisp and outlined (2); no crawl (3, W2V-I5); the speed map runs to 700 m/s, so the MOCK's ~645 m/s core jet no longer sits flat at the top (4, cb5ec4b); the uncoupled solver's near-rest frames are no longer showcased (5: `solver-data.png`, `solver-cutaway.png`, `ui-solver-cutaway.jpg` removed; `solver-link.png` is the link check, labelled as such). The legend's end ticks now sit inside the bar.
- Docs (c39f425, be4f501, 17d77ee): PHYSICS.md ledger rows; GPU_FACTS M51's note, M53, M54, M55, M50's evidence name; LOOKDEV "Flow visuals" rounds 2 and 3 with the screenshot table.

Skipped, with the reason
- W2V-N19's third part (the intake seed zone shaped round the MOCK's over-converging inflow): it can only be revisited on W3's coupled solver field (NEXT 4).

Screenshots (`docs/look-dev/flow/`, be4f501)
- `ui-realistic.jpg`, `ui-cutaway.jpg`, `ui-data.jpg`, `ui-schlieren.jpg`: the look-dev page with the flow panel and the legend (Chrome via the MCP, 1920 x 889, take-off MOCK field).
- `realistic.png`, `cutaway.png`, `schlieren.png`, `data.png`, `glow-hotsection.png`, `solver-link.png`: the browser test's frames (960 x 540; `VITE_FLOW_LOOKDEV=1`). `timing.json`: the timing pairs and the tracers-on sample.

Indicative ms (back to back, 1080p, threeQuarterFront; other agents' work on the machine; not D0-1)
- Flow visuals at the default preset (Realistic, no tracers by default): 0.56 ms (render passes 0.48, compute 0.08; 3 pairs 0.55-0.57). With the tracers on: 0.92 ms (compute 0.14 with the substeps). Within D4-2's 2 ms.
- P4's render total off/on: 6.42/6.61, 6.47/6.57, 6.46/6.64 ms, paired change +0.18 ms (indicative only; NEXT 1).

NEXT (in order)
1. P4 with the flow passes present: the official D0-1 capture (orchestrator, quiet machine) with the flow off, Realistic on, and Realistic with the tracers on, to confirm P4 and the 2 ms budget.
2. The app shell (w2/app-ui, stacked on this branch) adopts the same contract: draw through `createFlowFieldLink` (the badge from `provenanceLabel(state.coupling, state.fallback)`), so a failed or lost solver falls back visibly there too.
3. The far field: particles die at x = 5 m, and the haze and schlieren march the near field only.
4. W3's coupled field: flip `GpuFlowSolver.fields().coupling` to 'coupled' when the coupling drives it; re-shoot on it; revisit the intake seed zone (W2V-N19); then showcase the solver's own field.
5. Polish still open: a hover probe of the plane's value under the cursor; the cinematic (DoF) presets with a flow layer; a far-field seed zone for the entrained air.

GOTCHAS
- `screenSize` inside an `rtt()` node is that target's size (GPU_FACTS M55): a half-resolution flow target must not turn full-frame pixels into uv with it.
- The flow layers have their own camera (`post.ts` `flowCamera`, copied before the pipeline renders); anything new in the "Flow Overlay" scene gets it. Do not draw flow layers with the scene camera: TRAA jitters it and does not accumulate them.
- A uniform test field must sit off the contour step (110 m/s, not 100: a value on a contour darkens the whole plane by the line).
- The MOCK's take-off core jet is ~645 m/s (Mach 1.28 at 646 K static) behind the nozzle: a MOCK issue for its owner; the speed map was widened to 700 m/s for it.
- White streaks on viridis yellow need the dark halo (display modes); do not remove it without another contrast cue.
- The MOCK's inflow ahead of the lip converges about 10x faster than continuity allows: the intake seed zone is inside the lip for that reason.
- A page in the background gets no rAF: bring the MCP page to the front (`select_page` with `bringToFront`) after every navigation, or the flow ms reads 0.00. Once the shared Chrome ran every page at ~1.5 fps (flow off too) for a minute: other work on the GPU; a reload cleared it.
- The MCP screenshot tool cannot write into the worktree; it saves to a temp path and the file is copied.
- Anything named "Flow ..." is a flow pass and outside P4 (D4-2).
- `src/lookdev/flowPanel.ts` imports `tools/perf/solverPerf.ts` for `?field=solver`: look-dev only.
- Dev port 5193 (kill the node PID listening on it; the Vite child outlives npx). Nothing is left running.

GATES @e2e0858 (the code; the handoff commit after it is this file only)
- npm run typecheck: clean.
- npm run lint: clean (ESLint --max-warnings 0 + Prettier).
- npm run coverage (includes `npm test`): 109 files, 2049 passed + 11 expected fail; lines 99.5 %, statements 98.5 %, branches 87.3 %, functions 99.6 %; thresholds met (exit 0).
- npm run test:mesh: 2 files, 29 passed.
- npm run test:gpu: 12 files, 68 passed (flowParticles 4: + the x1/10 step).
- npm run test:browser: 11 files, 34 passed (flowViz 5, flowPanel 2 new), 0 WebGPU errors; it writes its frames to reports/flow/ now, so docs/ stays clean.
