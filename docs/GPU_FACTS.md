# GPU facts (WebGPU, three.js, Dawn, Intel Arc 140T)

Verified behaviour only, like meridian's `ALPACA_FACTS.md`. Each entry says how it was verified (spike script + date + machine) or stays in "Researched, NOT verified" until a spike confirms it.

Machine: Intel Core Ultra 7 255H, Intel Arc 140T integrated GPU (shared 16 GB), Windows 11 Pro 26200, Chrome 155.0.8059.86, Node 24.18.0.

## Measured

(none yet: w0/spikes fills this)

## Researched, NOT verified (from the 2026-10-23 solver design review; spikes must confirm or correct)

- three.js latest stable is r186 (`three@0.186.1`). `WebGPURenderer` accepts `parameters.device`; `dispose()` does not destroy a supplied device.
- There is no public accessor for the GPUBuffer behind a `StorageBufferAttribute`; it is internal (`renderer.backend.get(attr).buffer`), so the three version stays pinned.
- Storage attributes with `itemSize` 3 are padded to vec4 and the attribute array is mutated: use `itemSize` 4.
- `StorageBufferNode` defaults to read-write; `.toReadOnly()` exists. Read-write storage buffers are not allowed in vertex shaders.
- `rgba32float` cannot be filtered without the `float32-filterable` feature.
- Let three create its buffer first (one render/compute) before raw WGSL writes to it; never set `needsUpdate` afterwards or the CPU array overwrites the GPU data.
- Submit raw compute command buffers before `renderer.render()`; queue order makes results visible.
- `ExternalTexture` accepts a `GPUTexture` created with the same device; sampling arbitrary formats from TSL is unconfirmed (spike b).
- Chrome quantizes timestamp queries (believed ~100 µs).
- `webgpu@0.6.2` (Dawn node bindings) ships `dist/win32-x64/dawn.node` with `dxcompiler.dll`/`d3dcompiler_47.dll`; usage `import { create, globals } from 'webgpu'`, `Object.assign(globalThis, globals)`, `create([])`. The process stays alive while a device is referenced.
