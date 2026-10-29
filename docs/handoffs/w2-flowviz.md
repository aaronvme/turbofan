w2/flowviz: round 2 DONE (the air is visible, driven by the live GPU solver's textures or the labelled MOCK; every handoff NEXT item built; a polish list below) (from main 1eb1e62; round 1 stopped at 89ef843; HEAD: see `git log -1`, the handoff commit)

DONE (round 2, in the order asked)
- e791f14 (TDD) the failing tests first: `tests/unit/flow/viz/{seeding,schlieren,glow,legend}.test.ts`, the flow pass group in `tests/unit/gpu/passTimings.test.ts`, the D4-76 composite and crop in `colormaps.test.ts`. Two of my own TDD expectations were wrong and were fixed, not loosened: `visualDtS(1, ...)` contradicted the 0.1 s frame cap the same test asserts, and "invisible below the Draper point" is now stated as below one 8-bit display step of a lit white wall (the first version guessed 1e-6; the real figure is 4e-6 at 750 K).
- 3c8fc20 the pure modules:
  - `src/gpu/passTimings.ts` (flagged contract edit, minimal): passes named "Flow ..." (`isFlowPass`) are left out of every render group and of `gpuTotal`, so P4 stays "render excluding the solver and flow visuals" (D4-2); `sumFlowMs` and `PassMedians.flow`, `FrameSample.flow?` (optional, so no tool changes).
  - `src/flow/viz/seeding.ts`: the PCG hash (Jarzynski & Olano 2020) and its 24-bit float stream (the kernel's RNG, mirrored), the seed zones from the flowpath (inside the lip, bypass and core entries, the core nozzle's last 25 cm), dilation, streak length, speed and edge fades.
  - `src/flow/viz/schlieren.ts`: the line-of-sight deflection eps = K ∫ grad⊥ρ ds through the axisymmetric field, checked against the Gaussian column's closed form (four impact parameters, 2nd-order convergence, a ray stopped by a surface keeps half), the knife-edge image (Settles 2001 eq. 3.5), the haze's apparent shift.
  - `src/flow/viz/glow.ts`: metal temperatures from the station temperatures (HPT cooled toward T3, phi = 0.6, assumed), grey-body radiance in scene units (studio at 1000 lux, assumed), all assumptions in one exported object and in the ledger.
  - `src/flow/viz/legend.ts`: the legend model (LUT stops, ticks inside the range, log2 quantities labelled as ratios, the schlieren's µrad grey scale), `provenanceLabel`, `flowModeNote` (what a mode shows, derived from what).
  - `src/flow/viz/modes.ts`: `composite` ('scene' Realistic, 'display' the data modes, D4-76), `crop` (D4-76's near field from the definition: lip − 0.6 m to plug tip + 0.9 m, r ≤ 1.15 × the nacelle's radius), `schlierenRangeRad` (500 µrad, reasoned in the comment).
- 6ab1736 `src/flow/viz/particleKernel.ts`: the particle and density-gradient WGSL kernels and the particle step's f64 TS mirror. `tests/gpu/flowParticles.test.ts` (Dawn): one GPU step against the TS step on the MOCK take-off raster, 4096 particles: 0 branch mismatches, positions 1.7e-6 m, velocities 0.027 m/s (bounds 1e-5 m and 0.25 m/s, justified in the test); a 10 % swirl-step mutant fails at 7e-3 m. 300 steps stay finite and in the field; the gradient kernel equals the central differences, zero across walls.
- 48ac9bd..92cfe1b the render side:
  - `src/render/flowCompute.ts`: the field binding (the solver's `FlowField` textures as they are, or a CPU field uploaded into our own textures: the MOCK fallback and the tests; `source` travels with it), one timestamped "Flow compute" pass per frame (gradient + 32768 particles), a particle readback for inspection.
  - `src/render/flowViz.ts`: every layer reads the bound textures through ExternalTextures. The cut plane (LUT bytes with NoColorSpace, contours, the D4-76 crop, the full-domain option) and the streaks (camera-facing capsules from the particle buffer via `injectGpuBuffer`, length |u| × dilation × 0.25 s capped at 0.45 m, a laser sheet of ±3 cm at the cut faces in the cut modes, a dark halo in the display modes, opacity ∝ 1/length beyond 12 cm in Realistic) are in the "Flow Overlay" scene, depth-tested by hand against the scene and rotor depths with 8 cm of slack (4848367: rows and vanes straddling the faces, and the rotors' shutter blur, must not hide the data; the fan in front still does). The haze and schlieren raymarch the gradient texture along each pixel's ray (32 and 96 samples, half resolution, a fixed per-pixel jitter: no synthetic flicker).
  - `src/render/post.ts`: `attachFlow` builds three more pipelines (as the cinematic one): Realistic (haze-shifted TRAA output + overlay in linear light, then AgX), display (D4-76: `renderOutput` first, then the overlay in display space), schlieren (knife-edge grey, the engine a dim silhouette). With the flow off the frame is the old pipeline exactly.
  - `src/render/engineView.ts`: `setFlowField` (CPU), `setFlowSolverField` (GpuFlowSolver.fields()), `setFlowMode`, `setFlowQuantity`, `setFlowTimeScale`, `setFlowFullDomain`, `readFlowParticles`; `stats().flow` (mode, source, quantity, dilation, render/compute/visuals ms); the glow uniforms set every frame from the cycle state; debug flags `noGlow`, `noFlowParticles`, `noHaze` for the A/B checks. `src/render/materials.ts`: `LookUniforms.glow` on the HPT/LPT airfoils, the core nozzle and the plug.
  - `spikes/p1/appScene.ts`: hands the view's measured flow-visual ms to D4-2's `solverBudgetMs` (null while no flow mode is set, so P1's record is unchanged).
- 23e6693, df53ed1 the look-dev page: `src/lookdev/flowPanel.ts` (mode segmented control, slow-motion slider ×1/1000..×1/10, cut-plane quantity, provenance badge, flow GPU ms, the "what is shown" note; `?field=solver` runs the live solver on the view's device from its timing start state, stepped at D4-2's budget) and the legend (bottom right, from the LUT stops; dataviz: text in text tokens, round ticks, unit, provenance).
- 4e34bc3, 167e8a8 `tests/browser/flowViz.test.ts` (3 tests): every mode, 0 WebGPU errors, frames saved; D4-76: 68 % of sampled cut-plane pixels within 3/255 of a viridis LUT entry (round 1 through AgX: none); glow A/B: 15732 px red-lifted at take-off; haze A/B: 3006 px change side on; the live solver's textures drawn and labelled 'solver'; [timing] the default preset at 1080p back to back.
- f9ee742 docs: PHYSICS.md ledger rows (tracers are a visualization device; laser sheet; mean-field schlieren and haze, no shimmer; the glow's assumptions); GPU_FACTS M49-M53; LOOKDEV.md "Flow visuals" with the screenshot table.

Indicative ms per pass (D4-42 style back to back, 1080p, threeQuarterFront, Realistic, a reference builder's CPU tests running; not D0-1)
- Flow visuals 1.18 ms (the gate run's 3 paired runs: 1.15, 1.18, 1.22): render passes ("Flow Overlay" + "Flow Haze [ RTT ]") 0.99-1.06, compute 0.16. Within D4-2's 2 ms. An earlier run: 1.28 (1.16-1.56).
- P4's render total with the flow off/on (the gate run): 7.99/8.02, 7.59/7.53, 7.38/7.78 ms, paired change median +0.03 ms: unchanged within noise (an earlier run had a +5.8 ms outlier pair). Indicative only; see NEXT 1.
- Other views at vsync in the shared Chrome (DVFS-inflated, D4-45): cutaway 0.59-0.79 ms, side Realistic 1.8-3.0 ms (long jet streaks' overdraw), schlieren side 2.7 ms (not budget-gated).

Screenshots (`docs/look-dev/flow/`)
- `ui-realistic.jpg`, `ui-data.jpg`, `ui-schlieren.jpg`, `ui-solver-cutaway.jpg`: the look-dev page with the flow panel and legend (Chrome via the MCP, 1925 × 1001).
- `realistic.png`, `cutaway.png`, `schlieren.png`, `data.png`, `solver-data.png`, `solver-cutaway.png`, `glow-hotsection.png`: the browser test's frames (960 × 540). `timing.json`: the timing pairs.

NEXT (in order)
1. P4 with the flow passes present: run the official D0-1 capture (orchestrator, quiet machine) with the flow off and with Realistic on, and confirm P4 holds and the flow visuals stay ≤ 2 ms. This round only ran indicative pairs (above).
2. Check the core annulus in Data after 4848367 (static airfoils now get the rotors' 8 cm slack so the vanes straddling the faces no longer hide the plane); if parts of the stand or the far cowl edge get painted over in some view, cut the airfoils at the faces instead (as a cutaway model would).
3. The far field: particles die at x = 5 m and the haze and schlieren march the near field only. March the far texture past it (the plume to 32 m) and let particles continue into it.
4. W3's coupled solver field: re-shoot the screenshots on the live solver once body forces drive it (today it runs from its timing start state, so its field is weak; the MOCK carries the look).
5. Polish: TRAA for the overlay (it is not accumulated, so streaks shimmer by the jitter), a hover probe of the plane's value under the cursor (dataviz interaction), the cinematic (DoF) presets with a flow layer, a far-field seed zone for the entrained ambient air.

GOTCHAS
- White streaks on viridis yellow (or any light colour) are invisible: the display modes draw a dark halo round each light core. Do not remove it without another contrast cue.
- The MOCK field's inflow ahead of the lip converges about 10× faster than continuity allows (u_r ≈ −131 m/s at x = −1 m, r = 0.3 m against u_x 99): tracers seeded there pile onto the axis and burst at the spinner. The intake zone is inside the lip for that reason. A MOCK issue for its owner, not fixed here.
- A page in the background gets no rAF: the look-dev loop stops (particles stay unborn). Bring the MCP page to the front (`select_page` with `bringToFront`) before reading anything.
- The MCP screenshot tool cannot write into the worktree; it saves to a temp path and the file is copied.
- `three` RTT passes are labelled "<name> [ RTT ]"; anything named "Flow ..." is a flow pass and outside P4. An unclassified pass "" (~0.5-0.8 ms) shows once per view creation in the browser suite, with every label of that frame empty: the studio's PMREM bake, not a flow pass.
- `src/lookdev/flowPanel.ts` imports `tools/perf/solverPerf.ts` (the solver's timing start state) for `?field=solver`: look-dev only, never the app.
- Dev port 5193 (the Vite child outlives a stopped npx: kill the node PID listening on it). Nothing is left running.

GATES @eddce14 (the code at 4848367; later commits are docs and screenshots)
- npm run typecheck: clean.
- npm run lint: clean (ESLint --max-warnings 0 + Prettier).
- npm run coverage: 108 files, 2016 passed + 11 expected fail; lines 99.51 %, statements 98.55 %; thresholds met (exit 0). Run at 097a569+ (src/render, excluded from coverage, changed after).
- npm run test:mesh: 2 files, 29 passed.
- npm run test:gpu: 12 files, 67 passed (64 + tests/gpu/flowParticles.test.ts's 3).
- npm run test:browser: 10 files, 30 passed (28 + 2 new in flowViz.test.ts), 0 WebGPU errors.
