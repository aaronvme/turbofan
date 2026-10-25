# GPU facts (WebGPU, three.js, Dawn, Intel Arc 140T)

Verified behaviour only, like meridian's `ALPACA_FACTS.md`. Each entry says how it was verified (spike script + date + machine) or stays in "Researched, NOT verified" until a spike confirms it.

Machine: Intel Core Ultra 7 255H, Intel Arc 140T integrated GPU (shared 16 GB, driver 32.0.101.8860), Windows 11 Pro 26200, Chrome 155.0.8059.86, Node 24.18.0, `three@0.186.1`, `webgpu@0.6.2` (Dawn).

## Measured

Every entry: the claim, the evidence (test or script, and the command that runs it), the date and the conditions. Functional facts come from tests that pass on HEAD. Timings carry the D0-1 label of the run that produced them: **all timings below are "indicative, contaminated (D0-1)"** (`--quick` protocol, other agents running), so they are not P1 or D0-2 results. The official quiet runs are in `spikes/README.md`. "C" marks a researched claim confirmed, "X" a researched claim corrected, "N" something new.

### Dawn in Node (spike e)

- **M1 (N). Dawn sees the Arc 140T through D3D12.** Hardware adapter (not the fallback), vendor `intel`, architecture `xe-lpg`, description "D3D12 driver version 32.0.101.8860". It offers `timestamp-query`, `shader-f16`, `subgroups` and `float32-filterable`, with `maxComputeWorkgroupStorageSize` 32768 and `maxStorageBuffersPerShaderStage` 16. Evidence: `spikes/dawn/adapter-info.ts` (`npm run gpu:info`) -> `docs/bench/dawn-adapter-2026-10-24.json`; `tests/gpu/dawn-smoke.test.ts` "gets a hardware adapter" (`npm run test:gpu`). 2026-10-24.
- **M2 (C). The `webgpu@0.6.2` package and its usage.** It ships `dist/win32-x64/dawn.node` with `dxcompiler.dll` and `d3dcompiler_47.dll`. `import { create, globals } from 'webgpu'`, `Object.assign(globalThis, globals)` (the WebGPU enums are not globals in Node otherwise), `create([])`. Evidence: `tests/gpu/helpers/dawn.ts`, used by every `npm run test:gpu` file (15/15 on 2026-10-24).
- **M3 (X). A live device does NOT keep the Node process alive.** The process exits as soon as nothing else is scheduled, even with the device and the GPU object still referenced. Evidence: `node spikes/dawn/exit-probe.ts` prints "process exited 1 ms after the last await, device never destroyed". 2026-10-24.
- **M4 (N). dawn.node segfaults if the GPU object from `create()` is garbage-collected while one of its devices lives.** Seen as a native crash while the Dawn tests were being written (2026-10-24); there is no standalone repro script. `SimDevice` keeps the GPU object referenced for the device's lifetime, pinned by `tests/unit/gpu/device.test.ts` "keeps a reference to the GPU object" (`npm test`).
- **M5 (N). Dawn quantizes timestamps to 2^16 ns (65.536 us) by default.** Every value is a multiple of 65536. The toggle `disable-dawn-features=timestamp_quantization` gives full resolution. Evidence: `tests/gpu/dawn-smoke.test.ts` "rounds every timestamp down to a multiple of 2^16 ns" and "times dispatches with unquantized timestamp queries when the quantization toggle is off" (`npm run test:gpu`).
- **M6 (N). The first timestamp written on a fresh D3D12 device can be ~200 s stale.** Seen on Dawn while writing `tests/gpu/timestamp-ring.test.ts` (2026-10-24). No pass can outlast the 2 s Windows TDR limit, so `pairDurationMs` rejects pairs longer than 2 s (`MAX_PASS_MS`), pinned by `tests/unit/gpu/timestamps.test.ts` "is NaN for a pair longer than the Windows TDR limit" (`npm test`).
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
- **M29 (N). Main thread vs worker frame times under a synthetic React load.**
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
    - At 60 Hz the main-thread renderer misses about 14 of 60 vsyncs per second, while the worker holds 60 fps.
    - An earlier run, with a game also on the GPU (`docs/bench/worker-2026-10-24-2125-quick.json`), shows the same pattern: main-react60 2 long frames per run (11 in run 1), worker-react60 0.
  - Caveats: these are development-build React commit times (production is faster); 1 s runs; contaminated (D0-1).

### Spike (a): solver throughput inside the 1080p scene

- **M30 (N). Per-iteration GPU cost of the representative fused kernel inside the bench scene** (3 stage dispatches per iteration, 12 blocks).
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
    - 130k cells reach ~400 it/s inside the budget, against P1's kill line of 150.
    - The previous builder's run (`docs/bench/throughput-2026-10-24-quick.json`, 0795d0a, CPU 17-24%, power plan and mode not recorded) measured 0.82 ms/it and 480 it/s for 130k-16x8.
    - The resample pass costs at most 0.33 ms, the particle compute one quantum (0.066 ms).
    - Render GPU time (three's `trackTimestamp`) varies 2.6-5.3 ms for the same scene and runs higher next to the slower tiles. This is unexplained; treat it as unreliable until the quiet run.
  - P1 needs the official quiet run (D0-1) before it counts.
- **M31 (N). Another process on the shared GPU wrecks the timings, and an occluded Chrome stops drawing.**
  - With a game using 63% of the 3D engine before the run (`conditions.gpuBusyBefore` in `docs/bench/throughput-2026-10-24-2133-quick.json`), ms/it rose 1.2-2.5x over the clean run.
  - In 130k-16x8, the page got one frame per second for two of the three runs (6 it/s achieved), consistent with Chrome throttling rAF while another window covered it.
  - The harness now records `gpuBusyBefore`/`gpuBusyAfter` (other processes' 3D/compute engine use) and `pageHiddenMs` per configuration, and prints `PAGE HIDDEN ... INVALID (D0-1)` when the page was hidden during a run. 2026-10-24.
- **M32 (N). How the spike kernel differs from the final W2 kernel** (it is a cost model, not validated physics):
  - Missing: body forces (blade rows), the combustor heat source, point-implicit sources, eddy viscosity, a residual reduction, and SSP-RK3 physical-time mode.
  - Thermo uses placeholder NASA-7-shaped coefficients.
  - The synthetic wiggled mesh has no index-orientation changes at block interfaces.
  - The positivity fallback (first order) acts per face side, not per cell.
  - The gauge is `p' = rho R T - pInf`, with no `T'` gauge.
  - What matches the plan's design: 2 vec4 state buffers x 3 copies, 8 storage bindings, a TX x TY tile plus a 2-cell halo of primitives in workgroup memory with shared face fluxes, a ghost index map with BC codes, Newton for T, MUSCL/van Albada, real SLAU2, the per-radian radial source, local dt and the RK3 update.
  - Correctness is pinned by `tests/gpu/stage-kernel.test.ts`: it matches the f64 reference cell by cell, is identical across tiles and across block splits, preserves quiescent and freestream flow, and stays finite for 200 iterations of a pulse.
- **M33 (N). Render hand-off texture encoding (D0-4).**
  - Texture A is `rgba16float` ((p - pInf)/pInf, (rho - rhoInf)/rhoInf, u, v).
  - Freestream reads back within 1e-6 (0.1 Pa); the old `p / pInf` encoding read 0.99951 (49 Pa off) because the f16 step below 1 is 2^-11.
  - Evidence: `tests/gpu/resample.test.ts` (`npm run test:gpu`), 2026-10-24.

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
- Any official D0-1 timing: everything above is `--quick` and contaminated.
