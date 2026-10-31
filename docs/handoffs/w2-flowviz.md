w2/flowviz: round 4 STOP-CLEAN at the brake (W2V-I7, D4-86: the code, tests, frames and docs DONE; the full gates partly unrun, below) (from main cf87af0, merged in fast-forward; HEAD: see `git log -1`, the handoff commit)

DONE (round 4, W2V-I7 / D4-86)
- c67e5a7 (TDD) the failing tests first: `tests/unit/flow/viz/floor.test.ts` (new) and a W2V-I7 case in `tests/browser/flowViz.test.ts`. **The bar, stated before the fix:** at ground idle, on the MOCK and on the uncoupled solver's field, at most 10 % of the Data plane's footprint is drawn (alpha >= 0.5) at or below the lightness of viridis' darkest 5 % (contour lines included); unit level, at most 10 % of the crop's fluid texels in the ambient's colour band (5 % of the scale) for each of p, rho, T, Mach. Take-off guard: >= 98 % of the old look's flow pixels (lighter than viridis at 10 %) unchanged. (The bar was set after probing the MOCK's value histogram, before any fix existed; the take-off share guard was set from it to 2 %, since p's fully expanded jets are at p∞.)
- d41acfe **the fix: a transparent ambient floor, not a range from the field.** Air within `AMBIENT_FLOOR_FRACTION` = 2.5 % of a quantity's scale of its ambient value (M, |u| 0; log2 p/p∞ = log2 ρ/ρ∞ = 0; T∞) is not drawn (`fields.ts` `ambientValue`, `ambientFloor`, `drawnOnPlane`, the TS mirror; `flowViz.ts`: a crisp fwidth-anti-aliased edge, so every drawn pixel is still a LUT colour, D4-76; the crop outline still frames the undrawn sheet; `tInf` uniform from the bound reference). Why: the maps are perceptually uniform, so 2.5 % is a fixed colour step from the ambient's colour (CIE76 ΔE 3.6 viridis, 3.8 diverging centre, under two JNDs; inferno's near-blacks ΔE 12 within ±45 K), and the scale stays fixed so idle and take-off share one legend; a field-derived range would move the legend and still put the ambient at the map's end. Legend: `Legend.floor` {from, to, label}, e.g. "Not drawn: 0 to 0.04 M (the ambient ± 2.5 % of the scale)", hatched on the bar in the look-dev panel and **the app's dock (`src/ui/dock.tsx`, `src/ui/global.css`: a small additive edit in app-ui's files, flagged)**; the panel note says "air within 2.5 % of the scale of the ambient is not drawn"; `legendFor` takes an optional `tInfK` (ISA SLS default). `setDebugFlags({ noFlowFloor: true })` draws the old look (the negative control and the "before" frames; identical formula where drawn).
- b7adc77 frames and numbers (Chrome, `floor.txt`): **MOCK idle 46.6 % → 7.0 %** of 273798 px; **uncoupled solver idle 98.9 % → 0.0 %**; **take-off 99.22 %** of 156467 flow px unchanged. Unit (MOCK idle, crop texels, ambient band): p 0.2 %, ρ 0.7 %, T 0.6 %, Mach 5.9 % (before 98/87/84/44 %); air at rest 100 % → 0. Cutaway's |u| has the same floor (11 % of texels stay in its band at idle: the MOCK intake's sink field; not under the bar, which is the Data plane's). Realistic and Schlieren have no cut plane: unchanged (their browser checks pass).
- Screenshots (`docs/look-dev/flow/`, 960 x 540, tracers on): `data-idle-before.png`, `data-idle-after.png`, `data-takeoff-before.png`, `data-takeoff-after.png`; `cutaway.png`, `data.png` re-shot with the floor. Viewed: at idle the board is gone (studio and nacelle show; the intake capture region, ducts and jets stay); the idle flow itself is still dark purple-blue, which is honest (idle Mach <= 0.32 on a 0-1.6 scale); at take-off the jets and intake suction are unchanged, the still air beyond the jets' spreading edge is clear.
- Docs: LOOKDEV "Flow visuals" round 4 paragraph and table rows; PHYSICS.md's flow-visuals ledger row (the fixed scales and the floor, a display choice).

NEXT (in order)
1. The gates below that are unrun: `npm run lint` (whole repo), `npm run test:browser` (full, detached, >= 2 GB free), and read the coverage run's result.
2. Re-shoot `ui-data.jpg` and `ui-cutaway.jpg` (MCP Chrome) to see the legend's hatched floor band and its label; they are round 3's and still show the board. The legend's look is unit-tested as data only.
3. The app-ui builder adopts the dock edit (or moves it): `legend.floor` in `FlowLegend`; pass the field reference's `tInfK` to `legendFor` when the ambient can change.
4. Flight ambient: `FieldReference` has no flight speed, so the floor for Mach and |u| is about rest; with flight conditions it must be measured from u∞ (a contract addition then).
5. Earlier NEXT items (P4 with the flow passes, the far field, W3's coupled field, polish) stand.

GOTCHAS
- A mesh hidden with `setDebugFlags({ hide })` stays hidden after the flags are cleared (`engineView.ts` only sets visible = false each frame); take composited frames before any hide, or in a fresh view.
- The contour lines include the value 0 (and the ambient log2 0), so a uniform field at rest sits on a contour line; the floor now discards it.
- Vitest 5 prints `[look]` annotations only for failing tests; the W2V-I7 case also writes `floor.txt`.
- The detached runner `reports/run/browser.ps1` (-Files, -Filter, -Lookdev, -Name) logs UTF-16 (read with iconv -f UTF-16LE); browser API port 5199.

GATES @b7adc77 (the code; the commits after it are docs only)
- npm run typecheck: clean (at d41acfe; the later test edits linted with eslint + prettier per file).
- npm run lint: UNRUN for the whole repo (eslint --max-warnings 0 clean on every touched file; prettier applied to them).
- npm test, unit: `tests/unit/flow/viz` and `tests/unit/ui`: 156 passed (after `npm install --ignore-scripts`: the worktree's node_modules was stale, 33 ui tests failed the same at baseline).
- npm run coverage: RUNNING detached at the brake (PID 48708, `reports/run/cov.status`, log `reports/run/cov.log`, reports to `reports/coverage-w2fv`); status at handoff: running.
- npm run test:browser: full suite UNRUN. `tests/browser/flowViz.test.ts` alone: 5 of 6 passed (W2V-I7 passed; its rerun `-t W2V-I7` passed); the indicative [timing] case failed, tracers-on 3.44 ms > 2 ms, with P4's render total at 18.9 ms against round 3's 6.4 (another builder's browser tests on the GPU; Realistic draws no cut plane, so this change cannot move it). Re-run it on a quiet machine.

---

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
