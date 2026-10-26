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

Options: `--only=130k-16x8,130k-8x8` (a subset, still rotated), `--port=N` (default 5181; the worker run also uses N+1 for the COOP/COEP server), `--seed=N` (replay a recorded run order). The harness serves Vite on 127.0.0.1 and launches the installed Chrome headed and maximized through Playwright.

The official runs before the W0G fixes took 29 min (throughput, 2026-10-25 22:18) and 19.5 min (worker, 22:47), with a fixed order and one warm-up per configuration.

### What one run does

1. Records the conditions: power source, power plan and Windows power mode, GPU name, driver and current refresh rate, CPU load and other processes' GPU use before (and after), git HEAD and whether tracked files are dirty, Chrome's version, full command line (Playwright's default switches included) and chrome://gpu backend.
2. Measures the display interval with an idle rAF probe on a blank page. It **refuses to start** if the probe is throttled (Chrome not in the foreground) or sees fewer than 10 frames.
3. Runs **3 repetitions** of the sweep (`spikes/lib/order.ts`). Configurations that are compared (the tiles of one grid; main vs worker at one load) stay together and rotate between repetitions, a Latin square for groups of 3. A seeded shuffle picks the base order. Each configuration gets its own warm-up, then one run. This answers W0G-I2: the fixed order confounded the tile ranking.
4. Brings Chrome to the front (CDP `Page.bringToFront`) before every run.
5. Judges every run against the display interval (`spikes/lib/validity.ts`). A run is INVALID when:
   - frames longer than 2.5 display intervals last more than 500 ms in a row (an occluded or unfocused window at ~1 Hz, or a stall);
   - its median frame is longer than 1.5 intervals (a 30 Hz throttle, or a load that cannot hold the display rate);
   - or the page was hidden.

   An invalid run is rerun once. A configuration with a run that is still invalid is printed and stored as INVALID, with `aggregate: null`. Long frames are counted against the display interval (over 1.5 intervals), never against the run's own median.
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
- [ ] Look for INVALID rows and rerun lines in the summary; `rejectedAttempts` should be empty or explained.
- [ ] `conditions.display.hz` matches `conditions.gpu[].currentRefreshHz`.
- [ ] `gpuBusyBefore`/`gpuBusyAfter` list at most dwm and the terminal; CPU load stays low before, during and after; `gitDirty` is false.
- [ ] Commit the JSON as recorded (Prettier ignores `docs/bench/`). Write any annotation in `docs/bench/README.md`; never edit a recorded file.
