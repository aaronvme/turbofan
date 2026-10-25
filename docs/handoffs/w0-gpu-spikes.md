w0/gpu-spikes: STOP-CLEAN (WIP). All spikes run in --quick mode; GPU_FACTS Measured written; spikes/README.md NOT written (from fe260dd; HEAD = the commit of this handoff)

DONE
- Lint clean on the bench, worker and scene code; bench JSON excluded from Prettier as generated output (.prettierignore).
- Harness (spikes/bench/run.ts) records D0-1/D0-3 conditions in every JSON:
  - power source, power plan (powercfg), Windows 11 power mode overlay, GPU name and driver
  - CPU load before, during and after
  - other processes' GPU use before and after (gpuBusyByProcess)
  - pageHiddenMs per configuration, with an INVALID flag when the page was hidden
  - Vite pre-bundles the deps, which fixes a mid-run page reload in worker mode.
  - Files are named docs/bench/<kind>-<local date>-<HHMM>-<protocol>.json.
- benchRun gains longFrames, window, solverMsPerItP10 and callbackDelay (rAF callback lateness). New tests: tests/unit/spikes/{system,protocol,benchRun,visibility}.
- Worker spike: runs idle, React 15 Hz and React 60 Hz on the main thread and in the worker. The probe now also covers GLTFLoader, OrbitControls and devicePixelRatio. COOP/COEP check run.
- Resample follows D0-4 (gauge ratios); tests/gpu/resample.test.ts.
- tests/browser/chrome-gpu.test.ts covers adapter.info and unquantized timestamps; spikes/dawn/exit-probe.ts.
- docs/GPU_FACTS.md M1-M33: every researched item is confirmed or corrected.

NEXT
1. Write spikes/README.md: how to run each spike, plus the official commands.
   - `npm run bench:throughput`: about 30 min.
   - `npm run bench:worker`: about 20 min.
   - Quick modes: about 75 s and 60 s.
2. Orchestrator official runs (D0-1). Set the power plan AND the power mode: the AC mode changed to Best performance at about 21:40 while the plan stayed Balanced. Check that gpuBusyBefore is empty and pageHiddenMs is 0.
3. D0-2 recommendation: **worker**, pending the quiet run.
   - Quick results, contaminated:
     - CPU 42%, React 60 Hz: main thread 14/60 long frames per run, p95 50 ms; worker 0.
     - CPU 14%, React 60 Hz: main thread has 0 long frames, but its rAF callbacks start up to 13.4 ms late (p99); worker 0.4 ms.
     - Idle: no cost to the worker.
   - Three caveats (M28): TextureLoader fails (use ImageBitmapLoader); OrbitControls needs an event proxy; setSize(w, h, false); DPR and resize must come from the main thread.

GOTCHAS
- The quick throughput numbers vary up to 2x per configuration from one sweep to the next. Run alone, the 130k tiles all measure 0.88-0.97 ms/it (2154-2156). Order and clock drift dominate, so there is no tile winner yet.
- A game on the GPU (GeometryDash, 63%) inflated timings 1.2-2.5x and occlusion throttled rAF to 1 Hz (2133).
- f32 -> rgba16float stores truncate (M8).

GATES @this handoff (run before the last bench changes; not rerun at HEAD)
- npm test: 109 passed (then +1 benchRun test: benchRun file 10/10)
- lint: eslint + prettier clean at the last check
- typecheck: clean
- coverage: lines 99.84%, branches 79.89%
- test:gpu: 15/15
- test:browser: 12/12 interop + 2/2 chrome-gpu (the full suite was not rerun after chrome-gpu was added)
