w0/gpu-spikes: STOP-CLEAN (WIP). Spikes (e), (b) done and tested; (a) built, one quick config measured; (d) written, never run; GPU_FACTS.md and spikes/README.md not yet written (from fe260dd; HEAD see GATES)

DONE
- 937d64c..fa63bbe spike (e) Dawn in Node: src/gpu/device.ts (own device: selected features, max limits, errors via addEventListener, loss reporting that knows about an intentional destroy, GpuErrorLog); src/gpu/timestamps.ts. Tests: tests/unit/gpu/*, tests/gpu/dawn-smoke.test.ts.
- 0540f90..8c9872b spike (a) kernel: spikes/lib/kernel.ts generates a fused per-RK-stage WGSL kernel. It has 2 vec4 state buffers x 3 copies (dt kept in B.z, 8 storage bindings); a TX x TY tile + 2-cell halo of primitives in workgroup memory with shared face fluxes; a multi-block tile table; and a ghost index map with BC codes (interface, axis, wall, far field, outflow). Per stage: thermally perfect gas with placeholder NASA-7-shaped coefficients and 2 Newton steps for T, MUSCL/van Albada on i- and j-faces with a positivity fallback, real SLAU2, the per-radian radial source (p' + rho w^2) A, local dt in stage 1, and the RK3 update (0.1918/0.4929/1).
  - Supporting modules: spikes/lib/mesh.ts (wiggled 12-block mesh; the closure sum S = (0, A) is tested), gas.ts, slau2.ts (f64), stageReference.ts (f64 mirror of a full iteration), initial.ts; spikes/gpu/stageSolver.ts (raw WebGPU, 6 rotating bind groups).
  - Tests: tests/gpu/stage-kernel.test.ts. The GPU matches the f64 reference cell by cell, the WGSL SLAU2 matches the f64 reference, results are identical across 16x8/8x8/32x4 tiles and across 12 blocks vs 1, quiescent and M0.3 freestream are preserved, and a pulse stays finite over 200 iterations.
  - Hand mutants: 6/7 killed. The survivor removes the positivity fallback, which is unreachable: van Albada on primitive variables keeps face values between neighbour values.
- 74d722c..5b226ba spike (b) interop: src/render/rendererOnDevice.ts (createRendererOnDevice with core-mode check, gpuBufferOf, injectGpuBuffer, computeNow). tests/browser/interop.test.ts is 12/12 and pins every fact in GOTCHAS.
- f4956f9..0795d0a bench libs: spikes/lib/{stats,protocol,system,scheduler,benchRun}.ts (unit-tested); spikes/gpu/timestampRing.ts (Dawn test).
- a659398 WIP: spikes/scene/{benchScene,benchApp}.ts, spikes/gpu/resample.ts, spikes/throughput/*, spikes/bench/run.ts, spikes/worker/* (worker page, React 15 Hz load, worker feature probe, COOP/COEP check on a second Vite server; never executed). npm scripts: bench:throughput, bench:worker, gpu:info.

INDICATIVE NUMBERS: contaminated (D0-1), --quick, other agents running, AC power, CPU load 8-24%
- 130k cells (512x256, 12 blocks), 16x8 tile, inside the 1080p scene (571k triangles: 403k instanced PBR metal + nacelle + 65k particle sprites; RoomEnvironment PMREM, AgX, bloom): **0.82 ms GPU per iteration**.
  - Scheduler: ran 8 it/frame at the 7 ms budget, i.e. 480 it/s achieved. The budget allows 515 it/s; with the whole GPU it would be 1226 it/s. P1 kill line is 150.
  - Frame time p50/p95/p99: 16.7/16.8/16.8 ms (60 fps held).
  - Render GPU (three trackTimestamp: scene + bloom): 2.2 ms. Resample: <0.07 ms (one quantum).
  - State finite, 0 GPU errors. File: docs/bench/throughput-2026-10-24-quick.json.
- Not measured: the 80k/256k grids, the 8x8/32x4 tiles, and the whole worker spike.

NEXT
1. Run `npm run lint` and fix the spikes/worker + spikes/bench lint (the typecheck was clean at the WIP commit; lint was not rerun after the worker files).
2. Smoke the worker page once: `npm run bench:worker -- --quick`. Fix anything that breaks. The OffscreenCanvas path, worker rAF, the React load and the probe are untested.
3. Optional: `npm run bench:throughput -- --quick` (about 2 min) for all 9 configs.
4. Write docs/GPU_FACTS.md "Measured" from GOTCHAS below plus the bench JSON. Mark each researched item confirmed or corrected. Say how the kernel differs from the final one: no body forces, heat source, point-implicit sources, eddy viscosity, residual reduction or SSP-RK3 physical-time mode; placeholder thermo; synthetic mesh with no interface orientation changes; positivity fallback per face side, not per cell; p' = rho R T - pInf, with no T' gauge.
5. Write spikes/README.md: how to run each spike.
6. Run the gates and finish this handoff.
7. Orchestrator quiet runs (D0-1: AC power, nothing else running, Chrome in front):
   `npm run bench:throughput` (9 configs x 190 s, about 30 min) and `npm run bench:worker` (3 configs x 190 s plus the COI check, about 10 min). Both write docs/bench/*-official.json.
8. D0-2 recommendation is still open: there is no worker data yet.

GOTCHAS (measured 2026-10-24, Arc 140T, driver 32.0.101.8860, Chrome 155.0.8059.86, Node 24.18, webgpu 0.6.2)
- **Dawn:**
  - D3D12 backend, vendor intel, architecture xe-lpg. It offers timestamp-query, shader-f16, subgroups and float32-filterable, with 32 KiB of workgroup memory and 16 storage buffers per stage. Output: docs/bench/dawn-adapter-2026-10-24.json via `npm run gpu:info`.
  - **dawn.node segfaults if the GPU object from create() is garbage-collected while a device lives.** SimDevice keeps it alive.
  - Corrected: the process does NOT stay alive with a live device; it exits.
- **Timestamps:**
  - Corrected: Dawn and default Chrome quantize to 2^16 ns (65.536 us), not ~100 us. `disable-dawn-features=timestamp_quantization` (Dawn) or `--enable-unsafe-webgpu` (Chrome) gives full resolution.
  - The first timestamp on a fresh D3D12 device can be ~200 s stale. Pairs longer than 2 s are rejected (MAX_PASS_MS).
- **Chrome:**
  - adapter.info has no device or description. chrome://gpu shows "D3D12 backend - Intel(R) Arc(TM) 140T GPU (8GB)".
  - powerPreference is ignored on Windows (console warning).
  - The device gets core-features-and-limits automatically, so three is not in compatibility mode.
- **three r186 on our device:**
  - Confirmed: it adopts the device, dispose() keeps it alive, and queue order holds (compute before render() is seen by that frame; compute after it is not).
  - **It assigns device.onuncapturederror, replacing ours**, and only logs. Use addEventListener.
  - It ignores device loss with reason 'destroyed'.
  - @types/three types onError as (string) => void; the runtime passes an object.
- **Textures and storage:**
  - Confirmed: an ExternalTexture wrapping our rgba16float GPUTexture is sampled exactly by TSL materials, and by compute through both a sampler and textureLoad.
  - TSL texture(uv) does not flip; readRenderTargetPixelsAsync returns rows top-down.
  - three never re-uploads over raw writes unless needsUpdate is set or DynamicDrawUsage is used, which re-uploads every use.
  - Confirmed: storage attribute buffers exist only after first use; itemSize 3 is padded to 4 and the attribute array is replaced.
  - New: pre-seeding backend.get(attr).buffer injects our own GPUBuffer.
  - Corrected: three emits var<storage, read> outside compute automatically, so toReadOnly() is not needed for vertex reads.
  - Confirmed: rgba32float with a filtering layout needs float32-filterable.
- **Not yet checked:** crossOriginIsolated under the Vite dev server without headers was false in the vitest probe. With COOP/COEP it is unchecked: the code exists in run.ts but has not been run. No headers were added to vite.config.ts.
- Node runs the harness TypeScript natively, so relative imports there need `.ts` extensions (tsconfig now has allowImportingTsExtensions; "spikes" was added to tsconfig include, and spikes/lib to coverage include).
- Dev-server ports: 5181 for the bench, 5182 for the COI server.

GATES @a659398 (last runs before STOP-CLEAN; not rerun at HEAD)
- npm test: 96 unit tests passing at their last run (all of tests/unit)
- npm run lint: clean at 0795d0a; NOT run on the spikes/scene, bench and worker files
- npm run typecheck: clean at a659398
- coverage: 99.3% lines at ab8df10 (spikes/lib was added later; not rerun)
- test:gpu: 14/14 (Dawn) at 0795d0a
- test:browser: 12/12 at 5b226ba
