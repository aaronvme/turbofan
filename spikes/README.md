# W0 GPU spikes

Throwaway measurement code for the W0 GPU questions. Results, with evidence, are in `docs/GPU_FACTS.md`; the recorded benchmark files are indexed in `docs/bench/README.md`. Only the pure helpers in `spikes/lib` are unit-tested and covered (`npm test`, `npm run coverage`); the GPU and page code is exercised by `npm run test:gpu`, `npm run test:browser` and the benchmark harness.

## The spikes and how to run them

| spike | question | code | run | facts |
|---|---|---|---|---|
| (a) throughput | solver it/s inside the 1080p three.js scene, per grid and tile | `throughput/`, `scene/`, `gpu/`, `lib/kernel.ts`, `lib/scheduler.ts` | `npm run bench:throughput` (below); by hand: `npx vite --port 5183`, open `http://127.0.0.1:5183/spikes/throughput/index.html?demo` (one short 130k-16x8 configuration, prints its aggregate) | M30, M34 |
| (b) interop | our WGSL device and textures inside three r186 (WebGPURenderer, TSL, ExternalTexture, storage buffers, error routing) | `tests/browser/interop.test.ts`, `tests/browser/chrome-gpu.test.ts`, `src/render/rendererOnDevice.ts` | `npm run test:browser` (headed Chrome, ~3 s plus the launch) | M9-M12, M15-M26 |
| kernel | the fused stage kernel vs the f64 reference; resample to `rgba16float`; the timestamp ring | `lib/kernel.ts`, `lib/stageReference.ts`, `lib/slau2.ts`, `gpu/` | `npm run test:gpu` (Dawn/D3D12 in Node, ~2 s) | M8, M32, M33 |
| (d) worker | three in a dedicated worker on an OffscreenCanvas vs the main thread, under a React load; COOP/COEP | `worker/` | `npm run bench:worker` (below); the page is driven through `window.__workerBench` | M13, M27-M29, M35 |
| (e) Dawn in Node | what Dawn sees, and its process and GC behaviour | `dawn/` | `npm run gpu:info` (prints JSON; `docs/bench/dawn-adapter-2026-10-24.json` is its output), `node spikes/dawn/exit-probe.ts`; M5-M7 in `tests/gpu/dawn-smoke.test.ts` (`npm run test:gpu`) | M1-M7 |

The mesh-topology spike (c) lived on `w0/mesh-spike`; its successor is `tools/mesh`.

## Benchmarks (spikes/bench/run.ts)

**Official timings belong to the orchestrator (D0-1).** Builders run `--quick` at most, and only when no official run is going on.

| command | what | expected duration |
|---|---|---|
| `npm run bench:throughput` | 9 configurations (80k/130k/256k x tiles 16x8, 8x8, 32x4), official protocol | ~33 min: 27 runs x (10 s warm-up + 60 s) = 31.5 min, ~1 min of setup, +70 s per rerun |
| `npm run bench:worker` | 6 configurations (main/worker x idle, React 15 Hz, React 60 Hz), official protocol | ~23 min: 18 runs x 70 s = 21 min, page loads, the COOP/COEP check, +70 s per rerun |
| `npm run bench:throughput -- --quick` | same sweep, 2 s warm-up + 1 s per run | ~2 min; "indicative, contaminated" |
| `npm run bench:worker -- --quick` | same sweep, 2 s warm-up + 1 s per run | ~2 min; "indicative, contaminated" |
| `npm run bench:p1` | **P1, the official command** (D4-64, below): 3 configurations, official protocol, a fresh page per run | ~13 min (estimated, not yet run): 9 runs x (about 8 s of page load + 10 s warm-up + 60 s) = 11.7 min, ~1 min of setup, +80 s per rerun |
| `npm run bench:p1 -- --quick` | same 3 configurations, 2 s warm-up + 1 s per run | ~3 min (estimated); "indicative, contaminated" |
| `npm run bench:p1 -- --quick --only=solver-130k-app` | the smoke run: the record row only, 3 repetitions | ~1.5 min (estimated); "indicative, contaminated" |

Options: `--only=130k-16x8,130k-8x8` (a subset, still rotated), `--port=N` (default 5181; the worker run also uses N+1 for the COOP/COEP server), `--seed=N` (replay a recorded run order). A smoke run of the harness itself, for a quiet window before the next official run, is `npm run bench:throughput -- --quick --only=130k-16x8` (about 15 s of runs: 3 repetitions of a 2 s warm-up and a 1 s run; each run times out after 33 s). The harness serves Vite on 127.0.0.1 and launches the installed Chrome headed and maximized through Playwright.

The official runs before the W0G fixes took 29 min (throughput, 2026-10-25 22:18) and 19.5 min (worker, 22:47), with a fixed order and one warm-up per configuration.

### P1 (`npm run bench:p1`, spikes/lib/p1.ts)

The rows, one group rotated together, each run on a freshly loaded page (so a fresh device):
- `solver-130k-app`, **the measurement of record** (D4-64): the app's GpuFlowSolver on the shipped 130k asset inside the app's own 1080p engine scene (`spikes/p1`: `src/render/engineView.ts` at 1920 x 1080, DPR 1, its defaults: high geometry, the quality profile, the three-quarter front preset), on the view's device with `FLOW_SOLVER_LIMITS` (D4-50). Its D4-2 budget comes from the view's measured render GPU time; the view draws no flow visuals yet. The page renders 10 frames before the run, so the pipeline compile is not in the warm-up.
- `solver-130k-bench`: the same solver in the W0 1080p bench scene (PHYSICS P1's "W0 spike a"), reported beside the record for continuity, never the verdict.
- `spike-130k-16x8`: the W0 spike kernel in the bench scene, the calibration against M34's official 1.277 ms/it.

The summary ends with `P1 of record (D4-64: >= 150 it/s ...): PASS|FAIL at N it/s` on `solver-130k-app` and the bench scene's line beside it. An INVALID record row gives no verdict. A miss counts only after a quiet re-run (PHYSICS P1), then goes to P1's logged decision (D4-66 expects a miss, about 120 it/s). The JSON's results carry `scene`, `nonFiniteResiduals` and `solverStatus` for each production run.

- **Official** (the orchestrator, quiet machine, the D0-1 checklist below): `npm run bench:p1`
- **Smoke** (a builder, only when no official run is going on): `npm run bench:p1 -- --quick --only=solver-130k-app`

### What one run does

1. Records the conditions: power source, power plan and Windows power mode, GPU name, driver and current refresh rate, CPU load and other processes' GPU use before (and after), git HEAD and whether tracked files are dirty, Chrome's version, full command line (Playwright's default switches included) and chrome://gpu backend.
2. Measures the display interval with an idle rAF probe on a blank page. It **refuses to start** if the probe is throttled (Chrome not in the foreground) or sees fewer than 10 frames.
3. Runs **3 repetitions** of the sweep (`spikes/lib/order.ts`). Configurations that are compared (the tiles of one grid; main vs worker at one load) stay together and rotate between repetitions, a Latin square for groups of 3. A seeded shuffle picks the base order. Each configuration gets its own warm-up, then one run. This answers W0G-I2: the fixed order confounded the tile ranking.
4. Brings Chrome to the front (CDP `Page.bringToFront`) before every run.
5. Judges every run against the display interval (`spikes/lib/validity.ts`, D2-11 as amended by D3-6). A run is INVALID only when:
   - it shows the occlusion signature: rAF intervals of 500 ms or more, sustained (consecutive ones spanning at least 1 s), which is Chrome's ~1 Hz throttle of an occluded or background window;
   - or the page was hidden, or lost focus (a window `blur` event) during the run;
   - or it stalled: no result within its warm-up + run + 30 s (`spikes/lib/timeout.ts`, W0G-N6; P1 adds 60 s for its fresh page's load). The page is then reloaded before the sweep goes on;
   - or the solver was not healthy (`spikes/lib/p1.ts` solverValidity, W2I-I2): the device reported any GPU error (a rejected three timestamp resolve counts), the solver state is non-finite after the run, a frame's density residual read back non-finite (production runs, whose timing state is reset every 100 iterations, `RESET_ITERATIONS`), or the production solver is not `running` at the end.

   A slow load is a WARNING printed next to its numbers, which are kept (D3-6, pass-3 N5): frames over 2.5 display intervals for more than 500 ms in a row ("sustained missed vsyncs"), a single stall of 500 ms or more, or a median frame over 1.5 intervals ("below display rate", D2-13; a 30 Hz throttle shows up only as this). Warnings are stored in `validity.warnings`.

   An invalid run is rerun once. A configuration with a run that is still invalid is printed and stored as INVALID, with `aggregate: null`. Long frames are counted against the display interval (over 1.5 intervals), never against the run's own median. Without a probe interval (the in-page `?demo` path) the warm-up's median frame time is used, under the same 24-500 Hz check as the probe (W0G-N6).
6. Writes `docs/bench/<kind>-<local date>-<HHMM>-<official|quick>.json` and prints a per-run line, a summary (the median of the 3 repetitions per configuration) and the order effect on ms/it (% per slot and over the sweep).

JSON layout:
- `conditions`, including `display` (probe interval, Hz) and `chromeFlags`;
- `gate` (the validity thresholds);
- `order`: `seed`, the order of each repetition, `effectOnMsPerIt`;
- `results[]`: `id`, `group`, `validity`, `aggregate` (or null), and `repetitions[]`, each the page's full result for one run with its `validity`, `seq` and CPU load;
- `rejectedAttempts` (the invalid runs that were rerun), `workerProbe`, `consoleErrors`.

### D0-1 checklist (official runs)

Before:
- [ ] AC power. Plan **and** power mode set: Balanced first (D0-3), Best performance only on the orchestrator's call. The AC power mode is a separate overlay that can differ from the plan.
- [ ] No other agents, builds, installs, tests, games or video. A game on the GPU inflated timings 1.2-2.5x (M31).
- [ ] Display sleep and the screen saver off for longer than the run (~35 min): a display that turns off stops rAF.
- [ ] Notifications off (Do not disturb), so no toast takes focus. No other window over Chrome. Don't touch the machine until the summary prints.

After:
- [ ] Look for INVALID rows, rerun lines and WARNING notes in the summary; `rejectedAttempts` should be empty or explained. A "below display rate" warning on a configuration that should hold 60 fps points to a 30 Hz throttle (energy saver): check the power source and rerun.
- [ ] `conditions.display.hz` matches `conditions.gpu[].currentRefreshHz`.
- [ ] `gpuBusyBefore`/`gpuBusyAfter` list at most dwm and the terminal; CPU load stays low before, during and after; `gitDirty` is false.
- [ ] Commit the JSON as recorded (Prettier ignores `docs/bench/`). Write any annotation in `docs/bench/README.md`; never edit a recorded file.
