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
- unit: tests/unit/shell (16) and tests/unit/hud (18) pass; W2F-I1 (3) and gasPathHold pass.
- Not run this round: coverage, test:mesh, test:gpu, test:browser (NEXT 1-2).
