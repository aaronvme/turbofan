# GPU facts (WebGPU, three.js, Dawn, Intel Arc 140T)

Verified behaviour only, like meridian's `ALPACA_FACTS.md`. Each entry says how it was verified (spike script + date + machine) or stays in "Researched, NOT verified" until a spike confirms it.

Machine: Intel Core Ultra 7 255H, Intel Arc 140T integrated GPU (shared 16 GB, driver 32.0.101.8860), Windows 11 Pro 26200, Chrome 155.0.8059.86, Node 24.18.0, `three@0.186.1`, `webgpu@0.6.2` (Dawn).

## Measured

Every entry: the claim, the evidence (test or script, and the command that runs it), the date and the conditions. Functional facts come from tests that pass on HEAD. Timings carry the D0-1 label of the run that produced them:
- **Official (D0-1):** the orchestrator's two quiet runs of 2026-10-25, M34 (throughput) and M35 (worker). P1 (D2-5, D2-8) and D0-2 (D2-4, D2-9) rest on them. Where a quick timing and an official one disagree, the official one stands.
- **Indicative, contaminated (D0-1):** every other timing (M29, M30, M31): `--quick` protocol (1 s runs), other agents running, power mode Best performance.

How to run the spikes and the official benchmarks: `spikes/README.md`. The recorded files and their annotations: `docs/bench/README.md`. "C" marks a researched claim confirmed, "X" a researched claim corrected, "N" something new.

### Official D0-1 runs (orchestrator, 2026-10-25)

Common conditions (from `conditions` in both JSON files): AC power (battery status 2), plan Balanced with power mode Balanced (D0-3: a lower bound), no other agents; Intel Arc 140T, driver 32.0.101.8860; Chrome 155.0.8059.86 headed and maximized (inner 1920x945, DPR 1), drawing buffer 1920x1080; Node 24.18.0; code at 019683d. Protocol: per configuration a 10 s warm-up, then 3 runs of 60 s, median per metric, configurations in a **fixed order** (the harness before the W0G-I1/I2 fixes). A "long frame" in these files exceeds 1.5x the run's median frame time; wherever the median is 16.7 ms (every valid row) that equals 1.5 display intervals at 60 Hz. `pageHiddenMs` is 0 in every row, but it cannot see an occluded window under Playwright (M31), so validity was judged from the frame times (critic pass 2).

- **M34 (N, official). Solver throughput inside the 1080p bench scene** (spike a; the M30 scene and kernel, adaptive iterations at the 7 ms budget).
  - Run: `npm run bench:throughput`, 2026-10-25 22:18-22:47 local -> `docs/bench/throughput-2026-10-25-2218-official.json`. CPU load 17% before (WindowsTerminal 2% and dwm 1% on the GPU), 7-9% during, 8% after (GPU otherwise idle). 0 GPU errors, finite state and timestamp quantum 65536 ns in every configuration.
  - Run order within each grid: 16x8, then 8x8, then 32x4; grids 80k, 130k, 256k.

    | grid (cells) | tile | ms/it | p10 ms/it | budget it/s | achieved it/s | fps | frame p99 (ms) | long frames/run |
    |---|---|---|---|---|---|---|---|---|
    | 400x200 (80k) | 16x8 | **INVALID** (D2-8) | - | - | - | - | - | - |
    | 400x200 (80k) | 8x8 | 0.945 | 0.852 | 444 | 427 | 60.0 | 16.8 | 0 |
    | 400x200 (80k) | 32x4 | 1.015 | 0.909 | 414 | 384 | 60.0 | 16.8 | 0 |
    | 512x256 (131k) | 16x8 | 1.277 | 1.088 | 329 | **299** | 60.0 | 16.8 | 0 |
    | 512x256 (131k) | 8x8 | 1.403 | 1.285 | 299 | **265** | 60.0 | 16.8 | 0 |
    | 512x256 (131k) | 32x4 | 1.498 | 1.350 | 280 | **251** | 60.0 | 16.8 | 0 |
    | 724x362 (262k) | 16x8 | 2.863 | 2.785 | 147 | 121 | 60.0 | 16.8 | 0 |
    | 724x362 (262k) | 8x8 | 2.904 | 2.720 | 145 | 122 | 60.0 | 16.8 | 0 |
    | 724x362 (262k) | 32x4 | 2.968 | 2.753 | 141 | 122 | 60.0 | 16.8 | 0 |

  - **The 80k-16x8 row is invalid** (D2-8); the JSON is kept as recorded. About 52 s into the configuration (42 s into run 0) Chrome's rAF dropped to ~1 Hz and stayed there: run 0 has 2561 frames, 23 of them ~1017 ms; runs 1 and 2 have 59 and 60 frames, every delta ~1016 ms. The file's median therefore reads 4.8 it/s, frame p50 1016 ms and 0 long frames (the run-median rule cannot see a run that is entirely slow), and 1.33 ms/it, which is the GPU at one frame per second, not the kernel's cost. The window lost focus or was covered (M31); the next configuration, after `bringToFront()`, ran at 60 fps. Not a number to quote.
  - Render GPU (three's passes) 3.6-3.8 ms in every row; the resample pass 0.066 / 0.131 / 0.262 ms at 80k / 130k / 256k.
  - Readings:
    - **P1 PASS (D2-5, D2-8):** every valid 130k row holds 60 fps at >= 250 it/s, against the kill line of 150, on Balanced.
    - **16x8 is the default tile, not a measured best.** The per-grid ranking follows run order at all three sizes (130k 1.277 / 1.403 / 1.498 ms/it, 256k 2.863 / 2.904 / 2.968), and later runs of one configuration are slower (130k-8x8 achieved 281.7, 265.2, 264.7 it/s). The fixed order confounds the tile comparison (W0G-I2); the harness now rotates it.
    - 256k reaches ~121 it/s, below its budget rate (141-147): the scheduler stays under 7 ms.
    - The official 130k ms/it (1.28-1.50) is higher than the quick runs' 0.88-1.01 (M30), which ran on power mode Best performance, ran the configuration first or alone, and lasted 1 s.
- **M35 (N, official). Main thread vs worker under a synthetic React load** (spike d; the M29 setup: 130k cells, 16x8, a fixed 3 it/frame, the React 19 **development** build re-rendering 240 gauges, sparklines and a table on the main thread).
  - Run: `npm run bench:worker`, 2026-10-25 22:47-23:06 local -> `docs/bench/worker-2026-10-25-2247-official.json`. CPU load 5% before, 9-16% during, 7% after; no other process on the GPU before or after. Its `gitDirty: true` comes only from the untracked throughput JSON of the run before (W0G-N2, fixed in the harness).

    | configuration | frame p50 / p95 / p99 (ms) | fps | long frames per run (runs) | rAF delay p95 / p99 (ms) | React commit p50 / p95 (ms) | solver GPU per frame p50 (ms) |
    |---|---|---|---|---|---|---|
    | main-idle | 16.7 / 16.8 / 16.8 | 60.0 | 0 | 0.8 / 1.2 | - | 4.5 |
    | worker-idle | 16.7 / 16.8 / 16.9 | 60.0 | 0 (0, 0, 1) | 0.4 / 0.5 | - | 4.3 |
    | main-react15 | 16.7 / 16.8 / 16.8 | 60.0 | 0 | 5.2 / 10.0 | 5.1 / 12.7 | 4.1 |
    | worker-react15 | 16.7 / 16.8 / 16.9 | 60.0 | 0 | 0.2 / 0.3 | 5.9 / 12.6 | 4.1 |
    | main-react60 | 16.7 / 33.2 / 33.5 | 56.6 | 177 (138, 177, 187) | 15.8 / 20.7 | 4.4 / 11.6 | 6.4 |
    | worker-react60 | 16.7 / 16.8 / 33.3 | 58.9 | 60 (60, 67, 51) | 5.7 / 12.7 | 4.3 / 11.5 | 5.8 |

  - "rAF delay" is how late the rendering thread's rAF callback started after its frame time. No main-thread long task (> 50 ms) in any configuration. COOP/COEP: `crossOriginIsolated` true on both threads, SharedArrayBuffer shared, WebGPU in the worker (as M13).
  - Readings, with the D2-9 caveats:
    - **At the realistic 15 Hz load neither mode drops a frame.** The worker's gain is the rAF start delay (p99 10.0 ms on the main thread vs 0.3 ms in the worker), which matters once the app's per-frame main-thread work grows.
    - **The worker is not immune at 60 Hz:** it drops about 60 frames per 60 s run (main thread 177). M29's quick-run "the worker holds 60 fps" is wrong.
    - The solver ran a fixed 3 it/frame: 4.1-4.5 ms of GPU per frame, 5.8-6.4 ms under the 60 Hz load (which also slows the solver per iteration: ~2.3 vs 1.4-1.6 ms/it), below the 7 ms budget.
    - React was the development build; production commits are faster.
    - D2-4 adopts the worker as a headroom decision on this evidence.

### Dawn in Node (spike e)

- **M1 (N). Dawn sees the Arc 140T through D3D12.** Hardware adapter (not the fallback), vendor `intel`, architecture `xe-lpg`, description "D3D12 driver version 32.0.101.8860". It offers `timestamp-query`, `shader-f16`, `subgroups` and `float32-filterable`, with `maxComputeWorkgroupStorageSize` 32768 and `maxStorageBuffersPerShaderStage` 16. Evidence: `spikes/dawn/adapter-info.ts` (`npm run gpu:info`) -> `docs/bench/dawn-adapter-2026-10-24.json`; `tests/gpu/dawn-smoke.test.ts` "gets a hardware adapter" (`npm run test:gpu`). 2026-10-24.
- **M2 (C). The `webgpu@0.6.2` package and its usage.** It ships `dist/win32-x64/dawn.node` with `dxcompiler.dll` and `d3dcompiler_47.dll`. `import { create, globals } from 'webgpu'`, `Object.assign(globalThis, globals)` (the WebGPU enums are not globals in Node otherwise), `create([])`. Evidence: `tests/gpu/helpers/dawn.ts`, used by every `npm run test:gpu` file (15/15 on 2026-10-24).
- **M3 (X). A live device does NOT keep the Node process alive.** The process exits as soon as nothing else is scheduled, even with the device and the GPU object still referenced. Evidence: `node spikes/dawn/exit-probe.ts` prints "process exited 1 ms after the last await, device never destroyed". 2026-10-24.
- **M4 (N, observed, no repro). dawn.node segfaults if the GPU object from `create()` is garbage-collected while one of its devices lives.** Seen as a native crash while the Dawn tests were being written (2026-10-24); there is no standalone repro script, and the test pins the mitigation, not the crash. `SimDevice` keeps the GPU object referenced for the device's lifetime, pinned by `tests/unit/gpu/device.test.ts` "keeps a reference to the GPU object" (`npm test`).
- **M5 (N). Dawn quantizes timestamps to 2^16 ns (65.536 us) by default.** Every value is a multiple of 65536. The toggle `disable-dawn-features=timestamp_quantization` gives full resolution. Evidence: `tests/gpu/dawn-smoke.test.ts` "rounds every timestamp down to a multiple of 2^16 ns" and "times dispatches with unquantized timestamp queries when the quantization toggle is off" (`npm run test:gpu`).
- **M6 (N, observed, no repro). The first timestamp written on a fresh D3D12 device can be ~200 s stale.** Seen on Dawn while writing `tests/gpu/timestamp-ring.test.ts` (2026-10-24); no repro script, and the test pins the mitigation, not the stale value. No pass can outlast the 2 s Windows TDR limit, so `pairDurationMs` rejects pairs longer than 2 s (`MAX_PASS_MS`), pinned by `tests/unit/gpu/timestamps.test.ts` "is NaN for a pair longer than the Windows TDR limit" (`npm test`).
- **M7 (N). Validation errors reach a listener and are never swallowed.** Evidence: `tests/gpu/dawn-smoke.test.ts` "delivers a validation error to our sink" (`npm run test:gpu`).
- **M8 (N). f32 -> `rgba16float` storage-texture stores truncate toward zero.** 101.99999758 is stored as 101.9375 (one f16 step low), not 102, so values read back carry up to one f16 step of error, not half a step. Evidence: `tests/gpu/resample.test.ts` (`npm run test:gpu`), Dawn D3D12 in Node, 2026-10-24. Chrome uses the same Dawn D3D12 backend, but its stores were not measured separately.

### WebGPU in Chrome 155

- **M9 (N). `adapter.info` gives only vendor `intel` and architecture `xe-lpg`.** `device` and `description` are empty strings. The GPU name comes from chrome://gpu (`<Integrated GPU>  D3D12 backend - Intel(R) Arc(TM) 140T GPU (8GB)`) or from Windows (`Win32_VideoController`), and the bench harness records both (`conditions.chromeGpu`, `conditions.gpu`). Evidence: `tests/browser/chrome-gpu.test.ts` (`npm run test:browser`); any `docs/bench/*-quick.json`. 2026-10-24.
- **M10 (N). `powerPreference` is ignored on Windows.** Chrome logs "The powerPreference option is currently ignored when calling requestAdapter() on Windows" (crbug.com/369219127). Evidence: `consoleErrors` in every bench JSON (e.g. `docs/bench/throughput-2026-10-24-quick.json`).
- **M11 (N). The device gets `core-features-and-limits`, so three runs in core mode, not compatibility mode.** Evidence: `tests/browser/interop.test.ts` "three adopts the supplied device in core mode" (`npm run test:browser`).
- **M12 (X). Chrome quantizes timestamps to 2^16 ns (65.536 us), not ~100 us.** With `--enable-unsafe-webgpu` the step is under 1 us. A pass shorter than one quantum can read as 0, so the harness times whole per-frame passes (several ms) and reports medians. Evidence: `timestampQuantumNs: "65536"` in every bench JSON (Chrome without flags; `npm run bench:throughput -- --quick`); `tests/browser/chrome-gpu.test.ts` "with --enable-unsafe-webgpu, timestamps are not quantized to 2^16 ns" (`npm run test:browser`, which launches Chrome with that flag). 2026-10-24.
- **M13 (N). `crossOriginIsolated` and `SharedArrayBuffer` work with COOP/COEP from the Vite dev server, and WebGPU still works in a worker under COEP.**
  - Without headers (Vite's default): `crossOriginIsolated` is false and `SharedArrayBuffer` is undefined (ReferenceError), on the main thread and in a worker.
  - With `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` (Vite `server.headers`): both threads report `crossOriginIsolated` true. A SharedArrayBuffer posted to a module worker is shared (the main thread reads the worker's `Atomics.store`), and `navigator.gpu.requestAdapter()` in that worker still returns an adapter.
  - Evidence: `spikes/worker/main.ts` `coiCheck` and `spikes/worker/coiWorker.ts`, run by `npm run bench:worker -- --quick` on a second server at port 5182 -> `workerProbe.coopCoep` and `workerProbe.withoutHeaders` in `docs/bench/worker-2026-10-24-2141-quick.json`. 2026-10-24.
  - Not done: `vite.config.ts` still sends no COOP/COEP headers. Deployment would need them, and COEP `require-corp` blocks cross-origin assets that lack CORP/CORS headers.
- **M14 (N). The solver's compute shows up as the 3D engine in Windows' `GPU Engine` counters.** Dawn's D3D12 direct queue runs it, and there is no separate compute-engine entry. During a throughput run, Chrome's GPU process showed only `engtype_3D`, at 53-91%. Evidence: `Get-Counter '\GPU Engine(*)\Utilization Percentage'` sampled during `npm run bench:throughput -- --quick`, 2026-10-24 21:34. `gpuBusyByProcess` therefore sums the 3D and compute engines (`tests/unit/spikes/system.test.ts`).

### three r186 on our device (spike b)

All in `tests/browser/interop.test.ts` (`npm run test:browser`, 12/12 on 2026-10-24) unless noted.

- **M15 (C). `WebGPURenderer` adopts a supplied device (`parameters.device`), and `dispose()` leaves it alive.** Evidence: "three adopts the supplied device in core mode"; "three replaces a pre-set onuncapturederror; dispose() leaves a supplied device alive ...".
- **M16 (N). three assigns `device.onuncapturederror`, replacing any handler set before it, and only logs.** Register error handling with `addEventListener('uncapturederror', ...)` (`src/gpu/device.ts` does). Evidence: "uncaptured errors reach our listener although three replaced device.onuncapturederror"; the device-lifetime test.
- **M17 (N). three ignores a device loss with reason `'destroyed'`, so its `onDeviceLost` never fires for it.** Our sink still reports an unexpected destroy. Evidence: the device-lifetime test.
- **M18 (N). `renderer.onError` receives an object (`{ message, ... }`), although `@types/three` types it as `(string) => void`.** Evidence: the "uncaptured errors reach our listener" test casts its handler to the runtime shape.
- **M19 (C). Queue order holds.** Raw compute submitted before `renderer.render()` is seen by that frame; compute submitted after it is not. Evidence: "queue order: compute submitted before render() is seen by that frame; submitted after, it is not".
- **M20 (C, extended). An `ExternalTexture` wrapping our `rgba16float` GPUTexture (same device) is sampled exactly.** A TSL material reads it, and so does TSL compute, through a sampler at texel centres and through `textureLoad`. Only `rgba16float` was tested (plus `rgba32float`, M26); other formats remain unverified. Evidence: "raw WGSL -> rgba16float GPUTexture -> TSL material on a plane: the pixels are the written values"; "a TSL compute particle pass samples the same texture".
- **M21 (N). TSL `texture(uv)` does not flip, and `readRenderTargetPixelsAsync` returns rows top-down.** Evidence: the plane test above, which compares pixel rows exactly.
- **M22 (C). three never uploads over our writes.**
  - An `ExternalTexture` keeps our data across renders.
  - Raw writes into a `StorageBufferAttribute`'s buffer survive until `needsUpdate` is set, or until `DynamicDrawUsage` re-uploads the CPU array on every use.
  - Evidence: "three never uploads over an ExternalTexture we write"; "a StorageBufferAttribute GPUBuffer exists only after first use; raw writes to it survive until needsUpdate (or DynamicDrawUsage) re-uploads the CPU array".
- **M23 (C + N). There is no public accessor for the GPUBuffer behind a `StorageBufferAttribute`.**
  - It is `renderer.backend.get(attr).buffer` (`gpuBufferOf` in `src/render/rendererOnDevice.ts`), and it exists only after the attribute's first use.
  - New: pre-seeding `backend.get(attr).buffer` with our own GPUBuffer makes three bind ours instead of creating one (`injectGpuBuffer`).
  - Both rely on internals, so `three` stays pinned at 0.186.1.
  - Evidence: the StorageBufferAttribute test; "pre-seeding the backend entry with our own GPUBuffer makes three bind it".
- **M24 (C). Storage attributes with `itemSize` 3 are padded to 4, and the attribute array is replaced.** Use `itemSize` 4. Evidence: "pads itemSize-3 storage attributes to 4 and replaces the attribute array".
- **M25 (X). `toReadOnly()` is not needed for vertex-shader reads.** three emits `var<storage, read>` outside compute on its own. Evidence: "a storage buffer read in a vertex shader needs no toReadOnly()".
- **M26 (C). `rgba32float` with a filtering sampler needs `float32-filterable`.** The Arc 140T has it in Chrome and in Dawn. Evidence: "rgba32float with a filtering sampler needs float32-filterable".

### three r186 in a dedicated worker on an OffscreenCanvas (spike d)

Evidence for M27-M29: the worker probe (`spikes/worker/workerProbe.ts`, run inside the worker) and the six configurations of `npm run bench:worker -- --quick` -> `workerProbe` and `results` in `docs/bench/worker-2026-10-24-2141-quick.json`, 2026-10-24.

- **M27 (N). These work in a module worker:**
  - `WebGPURenderer` on our device with a transferred OffscreenCanvas, running the full bench scene: instanced PBR, `RoomEnvironment` through `PMREMGenerator`, AgX, the bloom `RenderPipeline`, a TSL particle compute pass sampling an `ExternalTexture`, raw compute with timestamp queries, and three's `trackTimestamp`. 0 GPU errors and a finite solver state in every worker configuration.
  - `self.requestAnimationFrame` and `renderer.setAnimationLoop`.
  - Loaders: `ImageBitmapLoader` (upload and sample), `FileLoader` (fetch), `HDRLoader` with `PMREMGenerator.fromEquirectangular`, and `GLTFLoader` with an embedded texture (in Chrome it loads textures through `ImageBitmapLoader`; the image is an `ImageBitmap`).
  - A `CanvasTexture` drawn with OffscreenCanvas 2D text, for labels.
- **M28 (N). These fail in a worker and need a workaround:**
  - `TextureLoader` throws "ReferenceError: document is not defined": `ImageLoader` creates an `<img>`. Use `ImageBitmapLoader`.
  - `renderer.setSize(w, h)` with the default `updateStyle = true` throws "TypeError: Cannot set properties of undefined (setting 'width')": an OffscreenCanvas has no `style`. Call `setSize(w, h, false)` and size the canvas element with CSS on the main thread.
  - `self.devicePixelRatio` is undefined. The main thread must send the DPR and resizes (from a ResizeObserver) as messages.
  - `new OrbitControls(camera, offscreenCanvas)` throws "Cannot read properties of undefined (reading 'removeEventListener')": it needs `ownerDocument`, `getRootNode()` and `style` on its element. Either forward pointer, wheel and key events from the main thread to a proxy element in the worker, or run the controls on the main thread and post the camera pose.
- **M29 (N, quick; superseded by M35). Main thread vs worker frame times under a synthetic React load.**
  - Setup: same scene, 130k-cell solver at a fixed 3 it/frame, 1920x1080 drawing buffer. The React 19 development build (Vite dev server) re-renders 240 gauges with SVG sparklines and a 24x10 table on the main thread, at 15 Hz or 60 Hz. The worker draws through `self.requestAnimationFrame`.
  - A "long frame" exceeds 1.5x the run's median frame time, i.e. at least one missed vsync. Every value is the median over 3 runs of 1 s. Conditions: AC power, plan Balanced, power mode Best performance, CPU load 38% before and 15-58% during the runs (other agents), no other process on the GPU, page visible throughout.

    | configuration | frame p50 / p95 / p99 (ms) | long frames per run | React commit p50 / p95 (ms) |
    |---|---|---|---|
    | main-idle | 16.7 / 16.7 / 16.8 | 0 | - |
    | worker-idle | 16.7 / 16.7 / 16.8 | 0 | - |
    | main-react15 | 16.7 / 16.8 / 17.0 | 0 (runs: 0, 1, 0) | 7.3 / 21.3 |
    | worker-react15 | 16.7 / 16.8 / 17.0 | 0 | 11.3 / 36.8 |
    | main-react60 | 16.7 / **50.0 / 50.1** | **14** (runs: 1, 14, 14) | 8.6 / 29.3 |
    | worker-react60 | 16.7 / 16.8 / 16.8 | 0 | 4.3 / 14.4 |

  - Readings:
    - The worker path costs nothing when idle.
    - At 15 Hz neither mode drops frames. React 19's concurrent renderer yields every ~5 ms, so a long render rarely blocks a frame.
    - At 60 Hz the main-thread renderer missed about 14 of 60 vsyncs per second and the worker none, in these 1 s runs. **Corrected by the official 60 s runs (M35): the worker does drop frames at 60 Hz, about 60 per minute (main thread 177).**
    - An earlier run, with a game also on the GPU (`docs/bench/worker-2026-10-24-2125-quick.json`), shows the same pattern: main-react60 2 long frames per run (11 in run 1), worker-react60 0.
  - Caveats: these are development-build React commit times (production is faster); 1 s runs; contaminated (D0-1). Use M35.

### Spike (a): solver throughput inside the 1080p scene

- **M30 (N, quick; the official numbers are M34). Per-iteration GPU cost of the representative fused kernel inside the bench scene** (3 stage dispatches per iteration, 12 blocks).
  - Scene: 571k triangles (403k instanced PBR metal, nacelle, 65k particle sprites), RoomEnvironment PMREM, AgX, bloom, 1920x1080.
  - Method: the IterationScheduler sizes iterations per frame to the plan's 7 ms solver budget.
  - Conditions: AC power, plan Balanced, power mode Best performance, CPU load 46% before and 46-66% during (other agents), no other process on the GPU (`gpuBusyBefore` only WindowsTerminal at 1.2%), page visible. Evidence: `docs/bench/throughput-2026-10-24-2140-quick.json` (`npm run bench:throughput -- --quick`, 73 s for all 9), 2026-10-24.
  - "ms/it" is total solver GPU time over iterations; "p10" is the 10th percentile of the per-frame ms/it (robust to other GPU work landing inside our timestamp pair); "budget" is 420 / ms-per-it (7 ms per 60 Hz frame); "achieved" is the scheduler's actual rate.

    | grid (cells) | tile | ms/it | p10 ms/it | budget it/s | achieved it/s | frame p99 (ms) | render GPU (ms) |
    |---|---|---|---|---|---|---|---|
    | 400x200 (80k) | 16x8 | 0.621 | 0.590 | 676 | 658 | 16.9 | 2.6 |
    | 400x200 (80k) | 8x8 | 1.410 | 1.258 | 298 | 279 | 16.8 | 4.9 |
    | 400x200 (80k) | 32x4 | 1.708 | 1.425 | 246 | 223 | 16.8 | 5.3 |
    | 512x256 (131k) | **16x8** | **1.013** | 0.961 | 414 | **398** | 16.8 | 2.9 |
    | 512x256 (131k) | 8x8 | 1.409 | 1.114 | 298 | 263 | 17.0 | 3.8 |
    | 512x256 (131k) | 32x4 | 2.083 | 1.964 | 202 | 176 | 16.8 | 5.0 |
    | 724x362 (262k) | 16x8 | 2.392 | 2.206 | 176 | 153 | 16.8 | 3.2 |
    | 724x362 (262k) | 8x8 | 4.888 | 3.998 | 86 | 60 | 17.0 | 5.3 |
    | 724x362 (262k) | 32x4 | 2.759 | 2.010 | 152 | 107 | 33.4 | 3.1 |

  - Readings:
    - The tile ranking does NOT hold up. A second sweep at low CPU load (`throughput-2026-10-24-2153-quick.json`) ranked the tiles differently. Run alone, each as the first configuration (`--only`, files 2154-2156), the 130k tiles all came in at 0.88-0.97 ms/it (16x8 0.898 and 0.877, 32x4 0.973, 8x8 0.923). So the gaps within a sweep come from run order or GPU clock/power drift (not measured), not from the tile shape.
    - 130k cells reached ~400 it/s inside the budget in this quick run (the official run: 251-299, M34), against P1's kill line of 150.
    - The previous builder's run (`docs/bench/throughput-2026-10-24-quick.json`, 0795d0a, CPU 17-24%, power plan and mode not recorded) measured 0.82 ms/it and 480 it/s for 130k-16x8.
    - The resample pass costs at most 0.33 ms, the particle compute one quantum (0.066 ms).
    - Render GPU time (three's `trackTimestamp`) varies 2.6-5.3 ms for the same scene and runs higher next to the slower tiles. This is unexplained; treat it as unreliable until the quiet run.
  - P1 is decided on the official run (M34, D2-5): 251-299 it/s at 130k on Balanced, lower than these quick numbers.
- **M31 (N). Another process on the shared GPU wrecks the timings, and an occluded Chrome stops drawing.**
  - With a game using 63% of the 3D engine before the run (`conditions.gpuBusyBefore` in `docs/bench/throughput-2026-10-24-2133-quick.json`), ms/it rose 1.2-2.5x over the clean run.
  - In 130k-16x8, the page got one frame per second for two of the three runs (6 it/s achieved), consistent with Chrome throttling rAF while another window covered it.
  - The harness records `gpuBusyBefore`/`gpuBusyAfter` (other processes' 3D/compute engine use).
  - **Corrected (critic pass 2, W0G-I1): `pageHiddenMs` does not detect this.** Playwright launches Chrome with `--disable-backgrounding-occluded-windows` and `--disable-renderer-backgrounding` (both in `conditions.chromeFlags` since the fix; seen on chrome://version 2026-10-26), so an occluded or unfocused window stays `visibilityState === 'visible'` while its rAF drops to ~1 Hz. `pageHiddenMs` was 0 in every run, including the official 80k-16x8 row that ran at 1 Hz (M34).
  - The mitigation now (`spikes/lib/validity.ts`, `tests/unit/spikes/validity.test.ts`): the harness measures the display interval with an idle rAF probe before the sweep and refuses to start if the probe is throttled; brings Chrome to the front (CDP `Page.bringToFront`) before every run; counts long frames against the display interval; marks a run INVALID when frames over 2.5 display intervals last more than 500 ms in a row or the page was hidden (a median frame over 1.5 intervals only adds a "below display rate" warning, D2-13); reruns an invalid run once; and reports a configuration with a run still invalid as INVALID, without an aggregate. The gate is unit-tested on synthetic 1 Hz and 80k-16x8-shaped runs and keeps the official main-react60 shape valid. It has not yet met a real occlusion in a live run.
- **M32 (N). How the spike kernel differs from the final W2 kernel** (it is a cost model, not validated physics):
  - Missing: body forces (blade rows), the combustor heat source, point-implicit sources, eddy viscosity, a residual reduction, and SSP-RK3 physical-time mode.
  - Thermo uses placeholder NASA-7-shaped coefficients.
  - The synthetic wiggled mesh has no index-orientation changes at block interfaces.
  - The positivity fallback (first order) acts per face side, not per cell.
  - The gauge is `p' = rho R T - pInf`, with no `T'` gauge.
  - What matches the plan's design: 2 vec4 state buffers x 3 copies, 8 storage bindings, a TX x TY tile plus a 2-cell halo of primitives in workgroup memory with shared face fluxes, a ghost index map with BC codes, Newton for T, MUSCL/van Albada, real SLAU2, the per-radian radial source, local dt and the RK3 update.
  - Correctness is pinned by `tests/gpu/stage-kernel.test.ts`: it matches the f64 reference cell by cell, is identical across tiles and across block splits, preserves quiescent and freestream flow, and stays finite for 200 iterations of a pulse. The reference comparison covers one iteration with absolute tolerances (1 Pa, 1e-2 m/s), enough for a cost model; W2's kernel test should compare several iterations with relative errors on the real mesh (W0G-N4).
- **M33 (N). Render hand-off texture encoding (D0-4).**
  - Texture A is `rgba16float` ((p - pInf)/pInf, (rho - rhoInf)/rhoInf, u, v).
  - Freestream reads back within 1e-6 (0.1 Pa); the old `p / pInf` encoding read 0.99951 (49 Pa off) because the f16 step below 1 is 2^-11.
  - Evidence: `tests/gpu/resample.test.ts` (`npm run test:gpu`), 2026-10-24.

### three r186 post chain in the look-dev view (w1/lookdev, 2026-10-26)

Chrome 155, Arc 140T, `src/render` at w1/lookdev. Timings here are **indicative, contaminated** (D0-1): on battery, Balanced, another agent on the machine.

- **M36 (N). Per-pass GPU time is available from three's own timestamp queries.** With `trackTimestamp`, three writes one timestamp pair per render context and keeps per-uid durations in `backend.timestampQueryPool.render.timestamps` after `resolveTimestampsAsync('render')` (internals; three stays pinned). An `InspectorBase` subclass set as `renderer.inspector` receives `beginRender(uid, scene, ...)` for every pass, and `scene.name` names it: a PassNode renders under its own `name`, GTAO's quad is "AO", TRAA's "TRAA", bloom "Bloom [ ... ]", depth of field "DoF [ ... ]" plus "Gaussian Blur [ ... ]", an RTT node "<name> [ RTT ]", the shadow map "Shadow Map [ <light> ]", the RenderPipeline's final quad "Render Pipeline". Evidence: `src/render/passTimer.ts`, `tests/unit/gpu/passTimings.test.ts`, and `tests/browser/engineView.test.ts` "renders every preset ... and times its passes" (`npm run test:browser`).
- **M37 (N). Post nodes render once per node-frame id.** PassNode, GTAO, TRAA, bloom and DoF use `NodeUpdateType.FRAME`; the frame id advances in three's own rAF loop. Several `RenderPipeline.render()` calls inside one task therefore re-run only the final quad, so TRAA cannot converge in a synchronous loop. The look-dev view advances `nodeFrame` itself each frame (`passTimer.beginFrame`) and its capture renders one frame per animation frame. Evidence: three r186 `NodeFrame.updateBeforeNode`, `TRAANode.updateBeforeType`; read from source.
- **M38 (X). GTAONode needs a texture node for its normals.** Passing `unpackRGBToNormal(texture)` fails the node build ("this.normalNode.sample is not a function", console only), and AO silently disappears (the "AO" pass then times 0.01 ms). The w1/geometry look-dev ran without AO for this reason. Storing `vec4(normalView, 1)` in the rgba16float MRT target and passing the texture node works (~0.7-1.6 ms at half resolution, 8 samples). Evidence: `node tools/lookdev/capture.ts` console output and timings before and after the fix.
- **M39 (N). Swapping `RenderPipeline.outputNode` at runtime (with `needsUpdate`) can leave the frame tiled.** Switching from a DoF output to the plain TRAA output showed the image repeated in quadrants (a target of a stale size sampled with repeat). Two RenderPipelines over the same nodes, rendering one or the other, work. Evidence: look-dev screenshot of `threeQuarterFront` after `hero`, 2026-10-26.
- **M40 (N). `PCFSoftShadowMap` is removed in the WebGPU renderer;** three warns and uses `PCFShadowMap`. Evidence: Chrome console during the capture.
- **M41 (N). `TRAANode.getTextureNode()` exists in r186 but is missing from `@types/three` 0.186.** Passing the TRAA node itself to `dof()` makes it copy the input through an RTT (~0.4 ms per frame). Evidence: the "RTT" pass in the hero preset's timings, gone after the change.
- **M42 (N, indicative; REVISED by w1/lookdev-3, W1L-N6). The look-dev opaque and rotor passes are geometry-bound, not fill-bound, and contaminated timings swing ~2x.** The pass-4 reading ("fill-bound") came from runs inside the 2x noise. lookdev-3, same page and session (MCP Chrome, quantized timestamps): the default view at render scale 1, 0.8, 1 gave opaque 5.90 / 5.64 / 6.23 ms and rotors 2.29 / 2.23 / 2.36 ms, while GTAO, the composite and TRAA scaled with the pixel count (1.31 -> 1.05, 0.92 -> 0.66, 1.25 -> 0.98). The view-dependent culling (src/geometry/visibility.ts: no LPT from the front, neither core half from the side) then took the default opaque pass from ~5.0-6.3 to ~4.1-5.0 ms. Evidence: `docs/LOOKDEV.md` "Look-dev round 3", `docs/look-dev/timings.json` (2026-10-26, AC, Balanced, other agents running).
- **M43 (N, indicative). A fragment `discard` saves no shading on Dawn (Chrome 155, D3D12, Arc 140T).** WGSL's `discard` demotes the invocation to a helper that runs the shader to its end. The fan's 8 time copies with a per-pixel pick in `maskNode` (a discard) cost rotors 5.7 ms at the default view; the same 8 copies with a trivial `MeshBasicNodeMaterial` 1.2 ms; one copy 1.75 ms. A depth pre-pass that makes the pick (trivial shader), then the shaded copies at `depthFunc = EqualDepth` with no discard (early depth test, one shaded fragment per pixel): 3.2 ms with the same mesh, 1.2-1.6 ms with the 13 x 23 fan loft. Equal depth held across the two pipelines here (the fan-blur reference test stayed within its bounds, no holes in `?debug=rotorAlpha`); it relies on both vertex stages computing the position identically (three emits no `@invariant`). Evidence: `tools/lookdev/capture.ts` 2-5 s smoke runs, 2026-10-26, `docs/LOOKDEV.md`.
- **M44 (N). three r186's TRAANode skips its history depth copy below render scale 1.** It copies the scene depth into its history only when the history matches the drawing buffer, so with the 3D passes at a scale < 1 every pixel read as disoccluded and TRAA stopped accumulating; on the frame the scale changes it copied the resized depth into the old-size history (a WebGPU copy-size error). `src/render/post.ts` makes the copy itself when three skipped it and resizes the composite target at once. Evidence: the WebGPU error text in `?profile=performance` before the fix, `tests/browser/engineView.test.ts` (profile switches, zero errors) after.

- **M45 (N, indicative; for the critic to confirm, D4-24). At vsync pacing the Arc 140T's GPU time per frame follows the load: the same frame is slower when the GPU idles part of each 16.7 ms.** Same commit (w2/lookdev-4 @bad7ad0), same page, interleaved: the default view 10.79 ms GPU at vsync against 9.75 ms back to back (opaque 5.20 against 4.30 ms), the vsync runs bimodal within a run (p10 8.2-9.7, p90 14.3-15.6 ms), the back-to-back ones tight (p10 8.5-9.3, p90 10.8-13.2). Consequence: a vsync-paced GPU timestamp overstates a frame's cost where there is headroom and understates savings. Evidence: `node tools/lookdev/ab.ts --refs bad7ad0,23239a1 --warmup-s 4 --run-s 10 --reps 4` (`docs/look-dev/ab-bad7ad0-23239a1.indicative.json`), 2026-10-27, AC, another agent's tests on the machine.
- **M46 (N). Back-to-back submission (the next frame as soon as the queue has taken the previous ones) fills only 72-77 % of the wall time with timed render passes,** with one frame queued or two. The cause is not measured; the candidates are GPU work the pass timestamps do not cover (copies between passes, TRAA's history copies) and the canvas's presentation. Evidence: the GPU busy fraction `tools/lookdev/timing.ts backToBackLoad` in the A/B runs above.
- **M47 (N). A per-pixel TSL `If` around a detail works on Dawn when its derivatives are taken before the branch** (WGSL requires `fwidth`/`dpdx` in uniform control flow; the filter width is computed outside and passed in), and lets whole warps skip a sub-pixel detail (`gated`, `seamLineAA` in `src/render/materials.ts`). Evidence: the browser suite at w2/lookdev-4 (0 WebGPU errors) with the gated nacelle features.
- **M48 (N, indicative). The look-dev opaque pass paid about 0.8 ms back to back for its two extra rgba16float MRT targets (view normal, velocity: 24 B per sample instead of 8).** Writing colour and depth only, with GTAO's normal reconstructed from the depth and TRAA's camera velocity from the depth's world point, took the default view from 8.68 to 7.87 ms (paired -0.76 ms, opaque -0.78, GTAO +0.03; 4 of 4 pairs negative). Evidence: `node tools/lookdev/variantAb.ts --b gbuffer=legacy --reps 4` (4 s warm-up, 10 s runs, back to back, every run VALID), w2/lookdev-5 @a610005, 2026-10-28, AC, a reference builder's CPU tests on the machine.
- **M49 (N). Raw-WGSL particle records in our own GPUBuffer, injected into a `StorageBufferAttribute` (M23 `injectGpuBuffer`), are read by a TSL vertex stage every frame,** the raw compute submitted before three's render (M19). 32768 particles × 48 B, `itemSize` 4 (M24), no `toReadOnly` (M25). Evidence: `tests/browser/flowViz.test.ts` (0 WebGPU errors in every flow mode), w2/flowviz round 2, 2026-10-29.
- **M50 (N). The solver's own resample textures (`STORAGE_BINDING | TEXTURE_BINDING`) wrapped in `ExternalTexture`s are sampled by TSL materials and by a raw compute pass on the same device in the same frame;** swapping a texture node's `.value` to a new `ExternalTexture` (a rebind, solver to MOCK) rebuilds three's bindings without errors. Evidence: the same file, "draws the live GpuFlowSolver textures on the view device".
- **M51 (N). `NodeMaterial.vertexNode` takes a clip-space position built from `instanceIndex` storage reads** (camera-facing streak quads), and TRAA's view-offset jitter applies to every pass inside the `RenderPipeline` (three r186 TRAANode sets it in `OnBeforeRenderPipeline` and clears it after), so an extra pass's hand-made depth test against the scene pass's depth texture is consistent. Evidence: the flow overlay in the same file (particles hidden behind the nacelle, the cut plane over the section).
- **M52 (N). `renderOutput(node, AgXToneMapping, SRGBColorSpace)` in a `RenderPipeline` with `outputColorTransform = false` gives the tone-mapped display image, over which a LUT read with `NoColorSpace` composites unchanged:** 24828 of 36348 sampled cut-plane pixels (68 %) are within 3/255 of a viridis LUT entry; the rest are contour lines and anti-aliased edges (D4-76). Evidence: the same file, 2026-10-29.
- **M53 (N, indicative). The flow visuals at the default preset (Realistic: 32768 streaks + haze), 1080p, back to back: 1.28 ms GPU** (render passes 1.11, compute 0.17; 3 paired runs 1.16-1.56), inside D4-2's 2 ms. Evidence: the `[timing]` test in the same file (`docs/look-dev/flow/timing.json`), w2/flowviz round 2, 2026-10-29, a reference builder's CPU tests on the machine (not D0-1).
- **M43 evidence (W1V-I3):** the EqualDepth fan is now checked by `tests/browser/equalDepth.test.ts` (0 differing pixels against an ordinary depth test, with a nudged pre-pass as the negative control), not by the fan-blur test, which cannot see a hole.

## Researched, NOT verified

Every claim from the 2026-10-23 solver design review is now resolved above:

| Researched claim | Result |
|---|---|
| three r186 is `three@0.186.1`; `WebGPURenderer` takes `parameters.device`; `dispose()` keeps a supplied device | Confirmed: M15 |
| No public GPUBuffer accessor for a `StorageBufferAttribute` (internal `backend.get(attr).buffer`), so pin three | Confirmed, plus injection: M23 |
| `itemSize` 3 storage attributes are padded to vec4 and the array is mutated | Confirmed: M24 |
| `StorageBufferNode` is read-write by default; read-write storage is not allowed in vertex shaders, so use `.toReadOnly()` | Corrected: three emits read-only access outside compute (M25) |
| `rgba32float` cannot be filtered without `float32-filterable` | Confirmed: M26 |
| Let three create its buffer first; never set `needsUpdate` afterwards | Confirmed, plus `DynamicDrawUsage`: M22, M23 |
| Submit raw compute before `renderer.render()` | Confirmed: M19 |
| `ExternalTexture` accepts our GPUTexture; sampling formats from TSL unconfirmed | Confirmed for `rgba16float` (and `rgba32float` filtering): M20 |
| Chrome quantizes timestamp queries (~100 us) | Corrected: 65.536 us, under 1 us with `--enable-unsafe-webgpu` (M12) |
| `webgpu@0.6.2` ships `dawn.node` + compilers; usage `create`/`globals`; the process stays alive while a device is referenced | Usage confirmed (M2); "stays alive" corrected (M3); the GC crash is new (M4) |

Still unverified (new):

- Production-build React commit times and the main-thread frame drops they cause; spike (d) used the development build.
- Input latency of camera controls proxied from the main thread into a worker.
- `rgba16float` store rounding in Chrome (M8 was measured in Dawn/Node only).
- GPU clock and thermal state during runs (not readable from the harness).
- The tile ranking: the official run's fixed order confounds it (M34). The next official run uses the rotated order (W0G-I2) and reports the order effect.
- Timings on the Best performance plan (D0-3): both official runs used Balanced.
