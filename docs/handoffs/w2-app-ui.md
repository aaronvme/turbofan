w2/app-ui: round 4 (D4-91, D4-92 zz, W2A-I6, N13-N20). Main @cf87af0 merged (a fast-forward; the lockfile did not change). STOP-CLEAN (usage brake): code at 2082e56; test:gpu and test:browser still running detached (see GATES); the re-shoot not yet looked at.

# Round 4 (2026-10-31)

DONE (TDD: each test commit first)
- **D4-91, the progressive warm-up** (357bbbb, d3f4ca1, 33bdf0e TDD; 1f0a49d, 27a120c, f5dd316, 2082e56). **FLAGGED RENDER EDIT** (engineView, post, passTimer, flowViz).
  - `src/shell/warmUp.ts` (pure): the configuration each view needs, BOOT_CONFIGS (Realistic with and without tracers), BACKGROUND_ORDER (Cutaway, Schlieren, Data:mach, Exploded, Data p/rho/T), a slot every 2 frames after a frame under 8.3 ms CPU, a 400-slot give-up (shown anyway, listed in `diagnostics.warm.gaveUp`), `shownView` (the asked view once warm, else the shown one plus `preparing`).
  - `EngineView.warmFrame(config, budget)`: one warm frame before the tick's real frame (which overwrites the canvas). New render pipelines go through createRenderPipelineAsync (three's compileAsync path) and draw once ready; new objects get at most 4 ms of own CPU a frame (nested passes timed apart, one always let through); TRAA's history, jitter and camera uniforms, the rotor motion's previous view-projection and the pass timer's medians are untouched. `warmUp(configs)` warms the boot configurations the same way and waits on them.
  - The worker posts `ready` after the boot configurations; the rest warm in the background. A view not yet warm is held: the shown view keeps running, the overlay shows "Preparing the <mode> view…" (role status), and the switch happens when it is warm. The settled count stays 0 while preparing (callouts and shots wait).
  - flowViz keeps one cut-plane material per quantity (no node rebuild per quantity switch).
- **W2A-I6, Schlieren's own check** (4b6ca8d TDD, 15fd68d). `tests/browser/lib/schlierenCheck.ts`: >= 30 % of the free area outside the engine at the knife-edge grey (0.4-0.6), the engine box's middle under 0.5 x that grey, the jet behind it with a luminance spread >= 0.08. Unit-tested on synthetic frames. In Chrome it must pass on the Schlieren shot and FAIL on the Realistic and Exploded shots (the controls), every run.
- **D4-91 item 3 + W2A-N19** (33bdf0e TDD, cf06c30). PHYSICS.md 3.5 rows U1 (amber below 5 %, red at or below 0, on the map only), U2 (first switch into a warmed mode <= 250 ms), U3 (boot-to-ready <= 5 s), both indicative. `src/hud/uiLevels.ts` mirrors them verbatim (its own mirror test; the T/C/L/P mirror is untouched). The map reads U1; the 5.0 % case is pinned normal (kills C1).
- **D4-92 (zz), the callouts** (07db72a, dd66262 TDD; eab74c9, 0bd12e8, 15fd68d, 2fb0730).
  - N13: the crossing prune cuts only when the best also shows every later label: 0 of 400 seeded probe cases short of the brute force (unit test).
  - `calloutPoint`: the closed views' Fan at the fan face on the far side, when the eye sees it through the intake (else the intake lip on the eye's side); the cut views' anchors on the upper cut face, so the bypass duct's is in the duct.
  - `layoutAxial`: in Cutaway and Data the labels sit in a row above and one below the engine's screen box (clamped under the top bar and over the station strip), alternating in axial order, each as near its anchor as the row allows, order kept. The row places go first in the general search, so its guarantees hold (no overlap, no panel, fewest crossings) and a label without room in its row gets an offset place.
  - Schlieren's framing: the overlay posts its free area (`viewArea`); entering Schlieren frames the engine and the near-field jet in it (`framedOrbit`: dolly out, at most to 0.6, and pan), leaving it restores the orbit; a camera preset cancels the restore.
- **Nits**: N15 (SIM STOPPED says "frozen until a reload"), N16 (the wall-time bars gate only with VITE_UI_QUIET=1; every run records them, fails a first-switch gap over 1000 ms, and checks the errors), N17 (each boot clears the slow message), N18 (pixelCap: ultra keeps the DPR up to the client's cap of 2), N19 (above).
- **FLAGGED RENDER EDIT in flowViz (2fb0730)**: the raymarch samples the gradient at an explicit level 0 (one mip, the same texels). It aimed at Schlieren's first-use stall (an implicit-derivative sample in a loop forces FXC to unroll it); the loaded run after it still showed ~1.1 s, so the cause is not settled (decision 1).

BOOT AND FIRST SWITCH (1366 x 768, `reports/ui/first-switch-*.json`; indicative, shared machine)
| | boot-to-ready | first switch, longest gap (echo) | background warm, longest gap |
|---|---|---|---|
| Before (round 3 code at cf87af0) | 10.8 / 12.7 s (warm-up 9.4-9.9 s) | Schlieren 99 ms (298), Cutaway 89 ms (113) | none (all at boot) |
| After, quieter run (27a120c) | 3.9-4.4 s | Schlieren 195 ms (183); Cutaway 706 ms (706, a Schlieren warm frame in the window) | Cutaway 108 ms, Schlieren 750 ms |
| After, loaded runs (f5dd316..2fb0730) | 3.9-7.7 s | Schlieren 205-636 ms, Cutaway 133-582 ms | 0.65-1.6 s |
- A cold switch into Data: "preparing" within 100-177 ms, shown 3.5 s (quiet) to 33 s (loaded) later, longest gap 123-171 ms, 47-540 snapshots while preparing.
- Background warm time to Cutaway: 5.2 s quiet, 17-34 s loaded (slots need a frame under 8.3 ms CPU).

NEEDS AN ORCHESTRATOR DECISION
1. **The background warm-up still stalls the GPU process once, about 0.65-1.1 s, on Schlieren's configuration** (and up to 1.6 s on a loaded run). The worker's CPU is not the cause: the slowest warm frame's new objects took 3-6 ms and its time outside the draws 1-2 ms; the stall is in the GPU process (the round-3 measure). Cutaway's many pipelines compile asynchronously with gaps of 108-113 ms (quiet). Options: (a) warm Schlieren at boot (about +1 s of boot, against U3's 5 s); (b) the render owner finds what in Schlieren's composite compiles on the GPU process's main thread (the level-0 sample did not remove it); (c) accept one ~1 s hitch a few seconds after boot. The test records it and gates it only in a quiet run.
2. Under load the background warm-up is slow (17-34 s to Cutaway), since a slot needs the last frame under 8.3 ms. A cold switch then waits behind "preparing" (33 s seen). A looser slot rule trades smoothness for speed.
3. The warm-up reaches into three r186 internals (pinned): `backend.createRenderPipeline`'s promises argument, the prototype `renderObject`, TRAANode's `_historyRenderTarget`, `_previousDepthNode`, `_jitterIndex` and camera uniforms (checked at creation, a rename throws).

NOT DONE (listed)
- N14: the worker's fault paths still have no worker-level test (a pure tick-fault function or a test CycleChoice that throws).
- N20: the solver's first bind is not warmed (it binds new textures; warming it means binding the solver field in a warm frame). A quality change compiles nothing new here (the profiles change the render scale and the DPR only); not measured in Chrome.
- The Schlieren stall (decision 1); visual notes 5 and 7; flowviz's purple board (W2V-I7, D4-86).

GOTCHAS
- A warm frame's pass inputs render nested inside the object that samples them (the output quad holds TRAA, which holds the scene passes): budget the objects' own time, not their inclusive time.
- The warm frame and the real frame share three's node frame: the pass timer's `beginFrame(true)` advances it, or the real frame would not re-render the passes.
- Runs were detached (`reports/scratch/app-ui/r4/run.ps1`, `gates.ps1`). Dev port 5194 unused; no MCP page opened.

GATES (code at 2082e56; STOP-CLEAN at the usage brake, so the last two are still running)
- npm run typecheck: clean, 14 s. npm run lint: clean, 64 s.
- coverage (`--coverage.reportsDirectory=reports/scratch/app-ui/r4/coverage`): 125 files, 2202 passed + 11 expected fail, exit 0 (thresholds met), 835 s.
- npm run test:mesh: 2 files, 29 passed.
- **UNRUN at handoff: test:gpu and test:browser.** They run in the detached gates script, PID 48328: status `reports/scratch/app-ui/r4/gates.status`, logs `gate-gpu.log` and `gate-browser.log` there. The browser step waits for >= 2 GB free and runs with VITE_UI_LOOKDEV=1, so it also re-shoots `docs/look-dev/ui/` (both sizes, every mode, the drawer). Those shots are uncommitted and **not looked at** (item 6 not done).
- Before the gates, the browser app suite (both sizes, all modes, the layout bar, the Schlieren check and its controls) passed at 2fb0730; the first-switch file failed there only on the background-warm gap (1.1-1.6 s, loaded), which 2082e56 now records and gates only in a quiet run.

NEXT
1. Read gates.status; if test:browser passed, look at every new shot in `docs/look-dev/ui/` against the bar (nothing clipped or overlapping, labels on their parts, the hierarchy reads) and commit them with their `*-shots.txt` (the Schlieren signature rows are in it).
2. Decisions 1-3 above. 3. N14, N20.

# Round 3 (2026-10-30)

DONE (each finding: its (TDD) commit, then the fix)
- **W2A-I1, the worker's faults on screen** (4b529f8 TDD, 3f531cb). A thrown cycle step posts a new `sim-stopped` message (src/shell/protocol.ts). The annunciators show SIM STOPPED with the message beside it, the clock reads "stopped" and Pause is disabled. A `fatal` always stops the app; no message-prefix test anymore. GPU ERRORS (n), MOCK RASTER ON FRAME / FAILED (from the new `AppDiagnostics.raster`) and REFUSED (n) are chips that open Diagnostics. Pure: `faultAnnunciations` (src/hud/annunciators.ts). Tests: `tests/unit/ui/faults.test.tsx` (the store's `receive` for every message, which kills M13; Status's boot and fault screens, which kills M14; the chips) and simCore's equal-seq (M10) and refused-echo (M11) pins. N5's dead-guard fake (M1) is fixed too: the fake reads healthy after dispose.
- **W2A-I2 + D4-87, the fan map at idle** (fff91a3 TDD, 3fcdbc7). Each map is drawn from its own lowest speed line (`lowestMapPercent`, `chartSpeedPercents`: the fan's 30.6 %, the HPC's 44 %), so the idle fan point (20 %, 65 kg/s, PR 1.02) is inside the chart. A point still off the plot is clamped to its edge with a chevron (`plotPoint`). Below the lowest line, `surgeMarginView` shows the margin dimmed with a "below map" tag and a hollow point. Amber (< 5 %) and red (<= 0) apply only on the map.
- **W2A-I3, the callouts** (df1853d and df2cd39 TDD, 9ccc1dc; Schlieren's rule in ae0b8bf).
  - The layout measures each label as drawn (border-box, one line; an unplaced label is drawn hidden so it is measured too), so the reserved box is the rendered box.
  - A bounded search (2000 nodes, pair tests precomputed, about 1-2 ms) places the most labels with the fewest leader crossings (`leaderCrossings`). It has more outward offsets and is memoized on the anchors' values.
  - Realistic and Schlieren (both the closed engine) call out only the fan and the exhaust (`calloutShownIn`).
  - Callouts show only on a settled view (N10). The reserved panels are measured on resize and panel toggles (N10). Every value has its unit (N8).
  - The browser layout bar now checks the drawn labels against each other, the reserved blocks and text cut-off, plus leader crossings. It passes in every mode at both sizes.
- **W2A-I4 + D4-88, warm-up and the settled signal** (df1853d TDD, 094ccaf, 64f7732). **FLAGGED RENDER EDIT** in src/render/engineView.ts: `warmUp()` and `viewSettled()`.
  - `warmUp()` renders one frame of each configuration and waits for `onSubmittedWorkDone` after each: Cutaway with tracers, Data with tracers at p, rho, T and Mach, Schlieren, Exploded, Realistic with tracers, and the boot view last. It then puts the state back and reports each step's wall and frame-CPU ms.
  - I did not use `compileAsync`: three compiles for the renderer's current target and MRT, not the post passes', so only a real frame compiles the variants the app uses.
  - The worker calls it after the MOCK is bound and posts `ready` only after it. The canvas is hidden while booting.
  - `src/shell/settle.ts` counts the frames the view has been settled in the asked mode (`AppDiagnostics.view.settledFrames`). The shots wait for SETTLED_FRAMES (30) and two more snapshots, not a fixed 1.5 s.
  - `setCycleState`'s source is now required (N3).
- **W2A-I5, the lever** (df1853d TDD, beef497). The lever keeps a local value and its seq (`store.send` returns the seq) until the snapshot's `lastCommandSeq` reaches it (`leverShown`). RTL: quick changes send 0.01, 0.02, ... 0.05. In Chrome, five real ArrowUp presses land at 0.05 in the worker (the W2F-N5 test).
- **D4-85, the pixel cap** (df1853d TDD, 094ccaf). `src/shell/pixelCap.ts` caps the backing store at 1920 x 1080 px (2.07 MP) up to quality high, at the true DPR on ultra (the client's cap of 2 stays). The worker applies it on resize and quality changes. Unit-tested; Diagnostics shows the backing store.
- **Nits** (ae0b8bf TDD, f58e846, c54b3ca):
  - N1: the field choice's rejection goes to the errors, and Diagnostics says "switching to the solver…" while it starts.
  - N2: 3 failed snapshot posts in a row are fatal, and `onmessageerror` is handled.
  - N3: an unknown coupling is "uncoupled" on the badge (a deliberate test change), and the dock's default is pinned (M8).
  - N4: the ledger splits rows on unescaped pipes.
  - N6: sub-idle ends a held episode (src/cycle/model.ts, one line).
  - N7: a late raster reply is dropped; a raster worker silent for 10 s is given up on, visibly.
  - N8: the limiter in words ("RUN · idle floor"), "Burner lit/out", a dash for an unmeasured solver, SOLVER IDLE when it is not drawn.
  - N9: --faint #838c9b and the panel at 0.86 alpha (4.9:1 over a mid grey; was 3.3:1). The drawer's panels are nearly opaque (visual note 4).
  - N10: `projectPoint` is tested.
  - N11: `startClient` resets the session, and the spinner says so after 60 s.
  - N12: round 1's shot moved to `docs/look-dev/ui/before/`.
- d6fed99: flowviz's 40000-seed zone test has an explicit 60 s runtime limit. Under coverage on the loaded machine it took 5.1 s, past vitest's 5 s default. It is not a threshold.

FIRST SWITCH (W2A-I4; `tests/browser/firstSwitch.test.tsx`, 1366 x 768, a fresh worker each)
- Measured: the longest gap between snapshots in the 3 s after the click, the window's end included; snapshots normally come every 50 ms. The bar, new and pre-registered in the test: <= 250 ms.

| | Schlieren: echo / longest gap | Cutaway: echo / longest gap | Boot (render to ready) |
|---|---|---|---|
| Before (two runs) | 1517 / 1323 ms; 1848 / 1581 ms | 461 / 421 ms (window not yet fixed); none / 2818 ms | 2.4-4.7 s |
| After (the gate run) | 98 / 52 ms | 87 / 70 ms | 9.9-10.6 s |
| After (loaded runs) | 230-326 / 75-188 ms | 104-160 / 82-127 ms | 14-26 s |

- The warm-up costs 9.1-23 s at boot, behind the spinner. Of that, the Cutaway frame takes 6.9-14.5 s, but only 1.1-2.6 s of it is the worker's CPU. The rest is the GPU process compiling pipelines (D3D12). Schlieren takes 1.6-3.3 s, the four Data quantities 30-260 ms each, and Realistic with tracers 0.24-1.0 s.
- The Schlieren and Cutaway shots now show the right views (looked at): the knife-edge grey with the engine as a silhouette, and the wedge fully open.

RENDER TIME (D4-85; indicative, shared machine; `reports/ui/render-*.json`)
- Chrome ran at DPR 1 this round, not round 2's 1.5x: the shots are 1920 x 1001 px. So 1920 x 1001 renders 1.92 MP, under the cap, and the cap is not exercised in Chrome. It is unit-tested.
- Realistic over a full window: 10.1 ms at 1920 x 1001 and 9.9 ms at 1366 x 768, against P4's 8 ms at 1080p.
- Per mode at 1920: Realistic 13.4, Cutaway 16.0, Exploded 8.6, Schlieren 12.4, Data 12.6 ms (the medians shortly after each switch).
- Round 2 measured 27.9 ms at 4.33 MP.

NEEDS AN ORCHESTRATOR DECISION
1. **The warm-up's boot cost: 9-23 s on the shared machine (boot 10-26 s, against 2.4-4.7 s before).** About 80 % of it is the GPU process compiling Cutaway's pipelines, every internal mesh visible at once. Options:
   - (a) keep it, as D4-88 says;
   - (b) compile asynchronously: three's `compileAsync` with the scene and rotor passes' render target and MRT set on the renderer, so Dawn's `createRenderPipelineAsync` can compile in parallel. That is a deeper render edit into three internals;
   - (c) fewer distinct pipelines in the cut view, the render owner's.
2. The browser suite's lit-centre bar is skipped for Schlieren (a test change, in the commit). The true Schlieren draws the engine as a 0.22 silhouette, and round 2's shots passed the bar only because they showed the exploded engine.
3. App-ui's own display levels, not in PHYSICS.md: the SM caution under 5 % and the warning at <= 0; the 250 ms first-switch bar; Realistic and Schlieren calling out only the fan and the exhaust.

NEXT
1. Decision 1. Also, the solver field's first bind (`bindSolver`) may compile new pipelines; it is not warmed.
2. D4-84's held-step budget (the cycle round): the held step is still 534 ms (`reports/ui/frame-cost.json`). D4-86 (flowviz's Data-plane board).
3. In Realistic the fan's anchor projects onto the nacelle skin. Anchor the closed views at the fan face. In the cut views the callouts still cluster on the core.
4. Not done: the app-level fallback case in Chrome (a failed solver start inside `<App/>`, N5's last item) and worker-level tests of N2's fatal. Visual notes 5 (a quadrant lever) and 7 (the T-s burner along its isobar).
5. Round 2's NEXT 2-5: colormaps, `selectedComponent`, the setBleed/setAmbient UI, a stall-margin trend.

GOTCHAS
- A browser run fetches the worker's modules again for each new Worker. Editing worker-imported `src/` files during a run changes what the later tests boot.
- The first-switch stall is mostly in the GPU process: the worker's frame CPU missed it (91 ms against a 2.8 s gap). Measure snapshot gaps on the main thread.
- Chrome's DPR was 1 this round. Check `diagnostics.backingStore` before reading render times.
- A hook asks for facts before `Remove-Item`. The tests overwrite their outputs, so nothing needs deleting.
- The gates ran as one detached script (`reports/scratch/app-ui/gates.ps1`, status per step, waiting for >= 2 GB free before test:browser). Dev port 5194 was not used, and no MCP page was opened.

GATES (typecheck, lint, mesh, gpu and browser at ab2866d; since then only a unit test's runtime limit, d6fed99. Coverage at d6fed99)
- npm run typecheck: clean, 16 s. npm run lint: clean, 66 s.
- npm run coverage (own reportsDirectory): 120 files, 2166 passed + 11 expected fail, exit 0 (thresholds met), 876 s; statements / branches / functions / lines see the log %. The first run (at ab2866d) failed only on the 5 s timeout fixed in d6fed99.
- npm run test:mesh: 2 files, 29 passed.
- npm run test:gpu: 12 files, 68 passed, 65 s (vitest-pool teardown warnings only).
- npm run test:browser (VITE_UI_LOOKDEV=1, the re-shoot): 13 files, 40 passed (flowviz's 34, app 4, first switch 2), 0 WebGPU errors, exit 0, 405 s, 3.8 GB free.
# Round 2 (2026-10-30)

DONE
- 4c19678 `git merge main` @7d6495c: no conflicts, and typecheck was clean on the merge. The merge commit keeps git's default message, because a hook blocked the amend to a "W2-app-ui:" message.
- **D4-82 in the shell** (0b1b32d (TDD), 8bd9550). No contract edit this round.
  - `src/shell/fieldSwitch.ts`: the drawn-field switch over flowviz's `createFlowFieldLink`. The MOCK is labelled `'mock'` and the solver `'uncoupled'` (until W3).
  - The solver starts once (the worker's boot start). Going back to the MOCK keeps it alive and idle. A solver the link disposed after a failure is not resurrected: asking for it again falls back with the reason it failed. Only the latest choice may bind, so a slow solver start cannot draw over a MOCK chosen after it.
  - A failed start, a lost or diverged solver, or a throwing step falls back to the MOCK **visibly**: the reason is in `AppDiagnostics.field`, which the badge, the legend and the annunciator show. It is **never silent**: `console.warn` plus the worker's error list.
  - Test: `tests/unit/shell/fieldSwitch.test.ts` (7 cases: the MOCK start, the uncoupled solver stepped only with a budget, a failed start, lost mid-run then not resurrected, diverged on a NaN residual, back to the MOCK keeps it idle, the latest choice wins).
  - `src/app/simWorker.ts` draws only through the switch. `sources.flow` is `switch.drawn()` (derived, W1F-N1). The snapshot's flow status goes through `sanitizeFlowStatus`. The solver steps at D4-2's budget only while it is drawn and a flow mode draws it.
- **D4-83** (same commits): `src/shell/viewState.ts`.
  - Realistic always draws its flow mode (haze, schlieren). The tracers follow `overlays.particles`.
  - A mode switch (`setViewMode`, or a `setRenderState` that changes the mode) puts the tracers at that mode's default (Realistic and Schlieren none; Cutaway and Data on).
  - `APP_DEFAULT_VIEW`: Realistic without tracers, `cutPlaneField` `'mach'` (the Data mode's own quantity).
  - Tests: `viewState.test.ts` (6) and `simCore.test.ts` (the D4-83 case). The default-view case now expects `APP_DEFAULT_VIEW` instead of the contract's defaults: a deliberate test change, for the decision.
- **The badges** (`src/hud/annunciators.ts`, `hud.test.ts`).
  - `provenanceBadges(sources, link)` gives "FIELD: solver (uncoupled until W3)" (cyan), "FIELD: SOLVER (coupled)" (for W3), "FIELD: MOCK" and "FIELD: MOCK fallback" (amber, with `provenanceLabel` and the reason as the detail).
  - `fieldFallbackAnnunciation` gives "MOCK FALLBACK: <reason>" in the annunciator row.
- **NEXT 1, the RTL suite** (6b7cc00 (TDD), 317665b, bc2c0c3): `tests/unit/ui/overlay.test.tsx`, 17 cases under happy-dom, with `fixtures.ts` building a real snapshot from `createSimCore({ cycle: createCycleModel() })`. `vitest.config.ts` includes `tests/unit/**/*.test.tsx`. The cases:
  - the N1, EGT and N2 dials are meters with the snapshot's values;
  - the lever sends `setThrottle`; a mode radio and the 1-5 keys send `setViewMode`;
  - a held gas path shows GAS PATH HELD with its W2F-I1 cause and the count, as text beside the badge;
  - the ledger renders every row of PHYSICS.md §1 and expands one;
  - every button, switch, radio, slider and select has a name;
  - D4-82: the uncoupled badge and legend; a fallback shown on the badge, the annunciator and the legend; the asked-for MOCK shows no fallback; the drawn-field switch asks for the solver even when it is not running; the diagnostics name the fallback;
  - the camera presets, the D4-83 tracers switch, the Data view's cut-plane field;
  - the frame-cost rows;
  - a new snapshot re-renders the overlay.
- **NEXT 2, the browser suite** (23da970, d714547, f55f13b): `tests/browser/app.test.tsx`, 4 tests.
  - `<App/>` boots the D2-4 worker on the real model, with a fresh store per test.
  - At 1920 x 1001 and at 1366 x 768 it steps through all 5 modes. Each mode must show 0 gpu-error/fatal messages and 0 worker errors, and the centre of the view must not be flat (luminance spread > 0.03 and lit fraction > 0.02; measured 0.146-0.284 and 0.134-0.859).
  - It shoots each mode and the open drawer. The shots go to `reports/ui/`; `VITE_UI_LOOKDEV=1` writes them to `docs/look-dev/ui/` (as flowviz's W2V-N8).
  - D4-82 in Chrome: with the solver chosen, the badge and the legend say "solver (uncoupled until W3)" and the solver steps.
  - W2F-N5: the frame cost on the part-power fit's ramp (below).
- **NEXT 3, the layout** (d714547 (TDD), c66c1b1, f55f13b). The browser suite's layout bar is: at both sizes, in every mode and with the drawer open, no block off screen, none cut off (a column or panel whose content overflows it), no two blocks overlapping, no two chart labels overlapping, no two dials overlapping. Before the fix it found the four handoff items and four more: the "30" tick over the axis title, the T-s "45" over "5", "Tt K" over "800", and the open panels pushed off screen. It now passes.
  - The top bar is one row. The mode keys hide below 1500 px, and the panel switches moved to the head of the right column.
  - The engine display: N1 and EGT above, N2 beside the FF, thrust, TSFC and start readouts.
  - The dials' 210-degree sweep now has its gap at the bottom, where the readout sits, and the viewBox fits the arc. This was the N2 crowding: the arc drew outside its SVG box.
  - The controls: the lever beside the fuel, start and ignition switches, with the reset and fault rows under them.
  - The charts are 300 x 168, with the y titles up the left edge and the x ticks above the x title.
  - Labels: `placeSpeedLabels` in `src/hud/compressorMap.ts` places the round tens first and drops the 95 and 105 that crowd the HPC's 100. `placePointLabels` in `src/hud/labels.ts` places the T-s station labels. Both are unit-tested.
  - The station strip has equal columns.
  - Diagnostics and What's simulated open as a drawer at the view's right edge, which scrolls on its own. They no longer push the maps or the T-s off screen.
  - I looked at every shot. Notes are in the decisions below.
- **NEXT 4, the cost per frame, measured** (23da970). The numbers are below. **The MOCK raster moved off the frame**: `src/app/mockRasterWorker.ts`, with the scheduler `src/shell/mockRaster.ts` (3 tests): one raster in flight at a time, a new one when N1 moves 1.5 % or after 2 s. If the raster worker fails, it falls back to rastering on the frame and says so.
- **NEXT 5, the cheap parts.**
  - `cutPlaneField` drives `setFlowQuantity` for the Data plane: `CUT_PLANE_FIELDS` = pressure, density, temperature, mach, mapped to p, rho, t, mach. The other contract fields have no plane quantity, so they are not offered rather than drawn as something else. Cutaway keeps its velocity magnitude.
  - Camera presets: 4 buttons in the dock.
  - The tracers switch.
  - The Diagnostics frame budget adds the worst and the held cycle step and the off-frame MOCK raster.
- Docs: LOOKDEV.md has a new section, "The app shell", with the shot table.

SCREENSHOTS (`docs/look-dev/ui/`, taken by the browser suite with `VITE_UI_LOOKDEV=1`, at CSS size; the shared Chrome runs at 1.5x)
- `1920-1-realistic.jpg` … `1920-5-data.jpg` and `1366-1-realistic.jpg` … `1366-5-data.jpg`: the 5 modes at each size.
- `1920-6-drawer.jpg` and `1366-6-drawer.jpg`: Data with the drawer open.
- `1920-data-solver.jpg`: the solver's field, badge and legend.
- `*-shots.txt`: each shot's centre statistics (no layout problems listed).
- `01-realistic-idle.jpg` is round 1's (the old layout), kept for comparison.
- The drawer shots predate bc2c0c3's two extra diagnostics rows. The layout bar passes with those rows: the drawer scrolls.

FRAME COST (NEXT 4: in the worker, Chrome at 1.5x, Arc, 1366 x 768; another builder's jobs were on the machine, so these are indicative, not D0-1)
- Matched cycle step: median 1.7-1.9 ms at idle, 2.8-3.6 ms over a slam (reference model and part-power fit).
- Worker frame CPU (the sim plus the render submit): median 6.6-9.5 ms.
- **Held step (W2F-N5), on the W1K-I2 part-power fit's 1 s lever ramp** (the w2f-c12 probe's case; `<App cycle="partPowerFit"/>`):
  - 162-178 lost solves;
  - the held cycle step costs a median of 551 ms, 602 ms and 411 ms in three runs (the last is the gate run), up to 682 ms;
  - the held frame costs 414-605 ms, 25-36x the 16.7 ms frame; the frame rate falls to 8-31 fps;
  - a Node cross-check of the same model (`reports/scratch/app-ui/cost.ts`, not committed) gives 452 ms held against 1.66 ms matched, about 270x;
  - so W2F-N5's "12x" is the solver-call count, not the time: each failed call iterates to its limit;
  - the reference model, which the app runs by default, had **0** lost solves on the same ramp.
- **MOCK raster** (near 1024 x 256 + far 512 x 108): 152-361 ms of CPU per raster in the worker (about 515 ms in Node).
  - On the frame thread it stalled the render and the sim clock (`MAX_WALL_STEP_S` clamps the step) every 2 s at idle and every few frames in a slam. Run 1 of the slam only reached N1 31 % in 12 s for this reason.
  - It now runs on its own worker: the frame no longer pays it, and the slam reaches the held region.
- GPU (the diagnostics, indicative): the engine render 18.4 ms at 1366 x 768 (2.36 MP backing store) and 27.9 ms at 1920 x 1001 (4.33 MP), in Data, on the shared machine. Flow visuals 0.8-1.1 ms, the solver 2.9 ms at its 2-iteration floor (D4-2's budget is 0 ms there).

NEEDS AN ORCHESTRATOR DECISION
1. **W2F-N5, the held frame breaks 16.7 ms by 25-36x (414-605 ms).** No budget was loosened. My proposals, in order:
   - (a) The cycle owner bounds the retry while held: only the direct solve from the held point each step, and the full halving walk at most once per 0.5 s of sim (the critic's "once per 0.1 s" idea, extended). That makes most held frames cost about a matched step, with one bounded spike.
   - (b) Better still, the retry gets a CPU budget per step (for example 4 ms) and continues on the next step (an incremental continuation).
   - (c) For the app's robustness either way: run the cycle on its own worker, apart from the render worker's rAF, so the render holds 60 fps and the clock shows the sim lagging. This changes D2-4's single sim+render worker.
   - The default (reference) model shows no hold on the ramp, so this bites only on the fit calibration or a hard transient.
2. **Render pixels on a 1.5x display.** The client caps the DPR at 2, so 1920 x 1001 renders 4.33 MP, 2.1x P4's 1080p, and the measured engine render (27.9 ms, shared machine) leaves D4-2's solver at its floor. Proposal: cap the backing store at 1080p-equivalent pixels for quality ≤ high, with ultra at the full DPR. That is one pure function in the client or the worker. It is a look-versus-frame-rate decision, so I did not make it. A quiet-machine capture of the app would settle the numbers.
3. **W2V-N21 is very visible in the app.** At ground idle the Data plane is almost all the darkest viridis purple (Mach about 0 outside the nacelle): `1920-5-data.jpg`. It is flowviz's (a lower opacity outside the nacelle, or a smaller rMax). It would lift the app's Data view more than anything on the overlay.

NEXT (in order; not W3)
1. The decisions above: the held retry or a separate sim worker; the render pixel cap.
2. Colormaps. The contract's `ColormapId` (viridis, magma, inferno, plasma, cividis, balance) is not the flow visuals' set (viridis, inferno and diverging, fixed per quantity in `src/flow/viz/fields.ts`), so offering it needs flowviz to bake LUTs per contract map. Not wired.
3. `selectedComponent` (click a part: highlight it and its callout), and the callouts in Exploded (they do not follow the explode offsets).
4. The `setBleed` and `setAmbient` UI (the title says "SLS ISA"; the ambient belongs with W3's scenarios).
5. A stall-margin trend, and a "sim lagging" clock indicator if NEXT 1 picks the separate sim worker.

GOTCHAS
- `page.screenshot` in the shared Chrome is at the OS's 1.5x scale (2880 x 1503 for 1920 x 1001). The suite scales its JPEGs to the CSS size.
- The store is a module singleton. A browser test must reset it (`useApp.setState(fresh, true)`) before it boots another `<App/>`, or the last test's snapshot passes for the new app (run 1's D4-82 failure).
- `Start-Process … -ArgumentList` joins its elements without quoting. Put the command in literal double quotes (`'"npx vitest …"'`), and pass `-ExecutionPolicy Bypass`, or the detached script dies before it writes its status file.
- A layout check must clip a block to its scroll container (`shown()` in the test), or a panel scrolled inside the drawer reads as off screen.
- The flow quantities (`FieldQuantityId`) have velocity magnitude, which no contract `FieldId` names. So Cutaway keeps its own quantity, and `cutPlaneField` drives the Data plane only.
- Dev port 5194. No dev server or MCP page was opened this round; the browser suite drives its own Chrome.

GATES @016680a
- npm run typecheck: clean.
- npm run lint (ESLint --max-warnings 0 + Prettier): clean, 63 s.
- npm run coverage (includes npm test; own reportsDirectory): 118 files, 2122 passed + 11 expected fail, exit 0 (thresholds met), 837 s. Statements 98.36 %, branches 87.36 %, functions 99.34 %, lines 99.33 %. New modules: src/shell/fieldSwitch.ts, viewState.ts, mockRaster.ts and src/hud/labels.ts at 100 % lines.
  - The first coverage run (at bc2c0c3) timed out round 1's `hud.test.ts` "inside its surge line" at vitest's 5 s default (11.6 s on the loaded machine). 016680a gives the model-stepping describes the cycle tests' explicit 120 s.
- npm run test:mesh: 2 files, 29 passed.
- npm run test:gpu: 12 files, 68 passed, 59 s.
- npm run test:browser: 12 files, 38 passed (flowviz's 34 + tests/browser/app.test.tsx's 4), 0 WebGPU errors, exit 0, 392 s, with 2.6 GB free. The run left docs/ clean; its frame-cost record gives a held cycle step of 411 ms median (max 541), a held frame of 414 ms, a matched step of 3.0 ms and a worker frame of 6.2-6.9 ms.
- All long gates ran detached, one at a time (`reports/scratch/app-ui/run.ps1`, a status file each).

# Round 1 (2026-10-29)

w2/app-ui: STOP-CLEAN at the usage brake (84 %). Priorities 1-3 are built and boot in Chrome on the real cycle model. Priority 4 is partial: unit tests only, no RTL or browser suite yet, one screenshot. (Stacked on w2/flowviz @2cfd469; HEAD: see `git log -1`, the handoff commit.)

DONE
- b68446c (TDD), 063b067 `src/shell/simCore.ts`: the pure, thread-agnostic sim core. It applies commands in seq order (an invalid command or a stale seq is refused, not applied), steps the clock (advanceClock, MAX_WALL_STEP_S) and the cycle, and publishes frozen snapshots through nextSnapshot.
  - Provenance is derived, never declared (W1F-N1): `sources.cycle` is `cycle.source` and `sources.flow` is the bound field's source. The tests pin mock to 'mock' and the real model to 'model'.
  - `runScenario` is refused with a message ("not available in this build (W3)"); it is not faked.
  - Starts at ground idle (fuel RUN, ignition auto). A reset restores the inputs that match the reset state.
  - New dev dependencies (exact versions): @testing-library/react 16.3.3, @testing-library/dom 10.4.2, @testing-library/user-event 14.6.8, happy-dom 21.0.4. They are for the RTL suite, which is **not written yet** (NEXT 1).
- 75a… (TDD), cbc866b: the pure view-model in `src/hud/`, covered by `tests/unit/hud/hud.test.ts` and `tests/unit/shell/orbit.test.ts`.
  - `compressorMap.ts`: speed lines and the stall-line surge line on the model's own scaled maps (`referenceEngine().maps`), in the frame the state reports. A test puts the idle and take-off points inside the line. Also the trail, scales and nice ticks.
  - `tsDiagram.ts`: Tt against s − s0 from the stations and the gas tables, plus the Pt0 and Pt3 isobars.
  - `callouts.ts`: deterministic collision-free label placement (10 candidate offsets, reserved panel rects, on screen, never over another anchor's dot).
  - `ledger.ts`: parses PHYSICS.md §1 itself.
  - `format.ts`: SI and US units, cockpit EGT in °C, FF per hour, a dash for missing values.
  - `annunciators.ts`: the gas path, flags, solver and provenance badges.
  - `src/shell/orbit.ts`: the orbit state, plus the keyboard map (arrows, +/-, [ ]).
  - `src/shell/protocol.ts`: the worker messages (FrameBudget, AppDiagnostics).
- 9fab970 (TDD), 01019e3 **W2F-I1 fixed.** `attempt` in `src/cycle/matchedSolve.ts` records why a solve was refused: a thrown error by `name: message` (so a TypeError can't pass for a physical loss), a residual not below 1e-6, or a non-physical root (BPR). The model keeps the last cause and exposes `lostSolveCause()` (`CycleDiagnostics`; `createCycleModel` returns `CycleModel & CycleDiagnostics`). It is logged once per held episode with `console.warn`. The contract is unchanged. Test: `tests/unit/cycle/lostSolveCause.test.ts`.
- 084adf7 `src/app/simWorker.ts`, the D2-4 worker. It holds the EngineView on the OffscreenCanvas, the real cycle model, and the GpuFlowSolver on the view's device with FLOW_SOLVER_LIMITS (130k asset).
  - Each rAF it advances the core and hands the state to the view, then steps the solver at D4-2's budget (`solverBudgetMs` from the view's measured render and flow-visual medians, read every 15 frames as P1 does), orbits, renders, and publishes every 3rd frame (about 20 Hz).
  - The MOCK field is rasterized from the real cycle state when N1 moves 1.5 % or after 2 s, and is labelled 'mock'.
  - A throwing cycle step stops the sim, posts `fatal` and keeps rendering. GPU errors and device loss are posted as they happen, and the loss also feeds `flow.reportGpuError`.
  - **Flagged edit** in `src/render/engineView.ts`: `setCycleState(state, source)` drives the spools and glow from the app's state, and `stats().cycleSource` was added. With null, or never set, the view keeps its old MOCK behaviour, so look-dev, the benches and P1 are unchanged.
- 2fd76f8 the UI.
  - `src/app/client.ts`: creates the worker, transfers a fresh canvas per mount (StrictMode), owns DPR and resize (ResizeObserver + matchMedia), and is the OrbitControls event proxy (pointer drag, wheel, keys become OrbitInput messages).
  - `src/ui/store.ts`: zustand store, with seq-stamped commands and the trails.
  - `src/ui/instruments.tsx`: N1, EGT and N2 dials with the definition's redlines, the amber EGT max-continuous band and the N1-target bug, all role=meter. Also FF, net thrust, TSFC and the start phase, and the throttle quadrant: a vertical range lever with detents, the fuel lever, the start switch, ignition, reset and fault injection.
  - `src/ui/charts.tsx`: the fan and HPC maps (speed lines, dashed surge line, a viridis-faded trail, the point, SM and η), the T-s chart and the station strip.
  - `src/ui/panels.tsx`: the top bar (radiogroup mode switch, keys 1-5, pause, time scale, quality, units, panel toggles, provenance badges), the annunciators (aria-live), the What's simulated panel (`docs/PHYSICS.md?raw`, expandable rows), the diagnostics (gasPathSolve status, lostSolves (D4-17), the cause (W2F-I1), solver status/iterations/residual, the drawn-field switch, the D4-2 budget bar against 15 ms, cycle and worker CPU ms, fps, errors and refused commands) and the callouts (layout above, leader lines).
  - `src/ui/global.css`: dark tokens, cockpit status colours, tabular numerals, focus rings, reduced motion.

SCREENSHOT
- `docs/look-dev/ui/01-realistic-idle.jpg`: Chrome via the MCP, 1925 × 1001, the app at ground idle on the real model (CYCLE: MODEL, FIELD: MOCK), Realistic, t = 10.8 s. The callouts don't collide; the maps show the trail on the model's maps.

NEXT (in order)
1. RTL tests in `tests/unit/ui/*.test.tsx` with `// @vitest-environment happy-dom`. vitest.config.ts `include` needs `tests/unit/**/*.test.tsx`. Build a snapshot from `createSimCore({ cycle: createCycleModel() })` and set it in `useApp`. Assert:
   - the dials are meters with values;
   - the lever's change sends setThrottle;
   - a mode radio sends setViewMode;
   - a held gas path shows "GAS PATH HELD" with the cause;
   - the ledger rows render;
   - every button has a name.
2. `tests/browser/app.test.tsx`: render `<App/>` in the browser suite. Wait for `ready` and a snapshot, step through the 5 modes, assert 0 gpu-error/fatal messages and that the canvas has content. Then take screenshots of every mode into `docs/look-dev/ui/` (Cutaway, Exploded, Schlieren and Data are not yet shot; the browser wasn't driven past the boot).
3. Layout polish seen in the screenshot:
   - the Controls panel is cut off at 1001 px tall, so the left column scrolls. Make the dials smaller or put the quadrant beside them;
   - the N2 dial crowds the N1 readout;
   - the HPC map's 95/100/105 labels overlap;
   - the T-s panel sits below the fold.
4. Measure, in the worker, what the cycle step and the MOCK re-raster cost per frame (diagnostics shows the cycle CPU ms). W2F-N5: a held step costs about 12× a normal step, so check the frame stays inside 16.7 ms while held.
5. Not wired yet:
   - `cutPlaneField` → `setFlowQuantity` (FieldId and FieldQuantityId differ);
   - colormaps;
   - `selectedComponent`;
   - setBleed and setAmbient UI;
   - camera presets UI (the protocol has 'camera').
   Callouts are hidden in Exploded (they don't follow the explode offsets).
6. The solver runs uncoupled (ambient at rest) until W3, and the diagnostics say so. The drawn-field switch lets the user pick it.

GOTCHAS
- Usage brake: this round stopped at 80-84 %, so the gates below were only partly run.
- `transferControlToOffscreen` works only once per canvas: the Viewport creates its canvas in the effect.
- `docs/PHYSICS.md?raw` is imported by the UI: the ledger panel is the document itself.
- Dev port 5194 is used for this branch. Nothing is left running (the vite PID was killed and the MCP page closed).
- A formatter hook rewrites files on save, so re-read before Edit.

GATES @2fd76f8 (+ the lint fix in the handoff commit)
- npm run typecheck: clean.
- npm run lint: clean (ESLint --max-warnings 0 + Prettier), after the client.ts fix in the handoff commit.
- unit (tests/unit/shell + hud + cycle, after the lint fix): 259 passed + 5 expected fail, exit 0.
- Not run this round: coverage, test:mesh, test:gpu, test:browser (NEXT 1-2).
