w1/lookdev: DONE, with the ~8 ms render budget NOT reliably met (indicative 9.2-14 ms default on battery; see Performance) (from ca0f264; HEAD: the docs commit on top of 96ebd49)

DONE (ID -> commit)
- W1G-I1 (high preset never tested; 384 non-manifold fan-case edges): 270c652 (TDD) / b1da8f9. `xsBetween` and `dedupe` merge samples closer than `X_MERGE` = 1e-6 m (float32-coincident x samples made zero-length loop segments). tests/unit/geometry/lookdev.test.ts runs, for EVERY `GEOMETRY_QUALITY` preset (test and high), every part, row and strut: boundary, non-manifold, misoriented and degenerate counts all 0, positive volume, simple CCW loops. The high build plus topology runs in ~1 s.
- W1G-N1 (annulus test mid-span only): 270c652 / b1da8f9: every part-loop vertex against every component annulus (1 mm inside the walls), at both presets; parts flagged `decorative` (the combustor liner, visual only) are skipped by design.
- W1G-I2 (render time cannot steer the work): 3c260e8 (TDD) / 191924a / 48c60ca / a33646c (TDD) / 6e78ae1. Per-pass GPU timestamps from three's own queries, labelled through an `InspectorBase` (src/render/passTimer.ts) and grouped by the pure src/gpu/passTimings.ts (shadow, opaque, rotors, gtao, composite, traa, dof, bloom, output); CPU encode time separately; rolling medians in the look-dev overlay (key `p`), `lookdev.timeFrames(n)`, the worker's `timings` message and `tools/lookdev/capture.ts`. Table in docs/LOOKDEV.md and docs/look-dev/timings.json. Measured on the main thread only; the worker reports the same medians but its timings were not run separately.
- LD-6 performance: b1da8f9 / 48c60ca / 6e78ae1 / 26beb6d. Closed-engine culling (src/geometry/visibility.ts, tested both ways: 0.75 of 1.66 M triangles drawn in realistic mode); triangle budgets per preset (`TRIANGLE_BUDGET`, tested); depth of field and bloom only in the cinematic preset (two RenderPipelines, GPU_FACTS M39); GTAO half resolution, 8 samples; static shadow map; skins drawn first and the cyclorama last (early depth test); no clear coat on the big painted surfaces; Lambert cyclorama; DoF reads TRAA's texture (no RTT copy). Instancing was already per row (one InstancedMesh per row).
- LD-3 / D3-1 studio: 48c60ca / 5cc6a2a. src/render/studio.ts: softbox environment baked by PMREM at 512 px (no HDRI file: the Poly Haven HDRI and NOTICE.md are removed), infinity cove, shadowed key, rim, contact shadow, two long strip lights.
- LD-1 fan: b1da8f9 (25x45 sections) / 48c60ca / e46d9f4 / 96ebd49. Satin titanium with per-blade jitter, 1/1000 s shutter in the realistic presets (pass-3 note), rotational blur by a ray march through the fan's swept volume (fan-blade hits only), own-surface sampling for short exposures. The hub teeth are gone; small blotches remain on the far-side, edge-on blades at idle (LOOKDEV "Still placeholder").
- LD-2 nacelle and lip: 48c60ca / 5cc6a2a / 6e78ae1: satin paint, faint orange-peel normal, handling-mark roughness, anti-aliased joints and fasteners; polished aluminium lip at roughness 0.24 with circumferential anisotropy on the exact revolve tangents (parts now upload tangents).
- LD-4 cutaway: b1da8f9 / 48c60ca / 26beb6d: distinct red-orange hatched caps (fwidth anti-aliasing), combustor liner with dome (`linerLoop`), fan-frame (12) and TRF (16) struts (src/geometry/struts.ts), dull grey plug (the plug's shape is the definition's hub curve and was not changed). Proportions: the engine geometry is the definition's (fan 61 in, 2.508 m flange to flange); no artwork copied.
- LD-5 materials, V2, V3, V4: 48c60ca / 26beb6d: matte cases, dull superalloy with heat tint graded along x, per-blade roughness and colour jitter, sub-pixel pattern fades, matte dark spinner with a readable spiral, cavity occlusion of indirect light per part family (interiors were lit by the whole studio).
- V1 (stair-step core blades): b1da8f9: HPT/LPT rows at 10 span sections (`turbineBlade`).
- V5 (exploded clips the exhaust) and exploded fan hidden in its case: b1da8f9 / 48c60ca: the fan case belongs to the intake and slides forward an extra `INTAKE_LEAD` = 0.75 m (tested: clear of the fan); the exploded camera frames the 6.2 m spread.
- Device swap (D2-4) and W1G-N3: 48c60ca. src/render/gpuDevice.ts deleted; `requestSimDevice` (src/gpu/device.ts) + `createRendererOnDevice` (core mode checked, trackTimestamp); the device is destroyed on any init failure; `dispose()` is async and awaits three before destroying the device (a rejection is recorded, not dropped); the worker queues messages sent during init and posts `gpu-error` immediately.
- W1G-N2 (browser test blind to broken frames): 48c60ca. tests/browser/engineView.test.ts reads the canvas back for every look preset (mean luminance, structure, black fraction, centre contrast bands), renders `high` too (hero and cutaway), checks the culling and the pass timings, and runs the worker with messages queued before init.
- W1G-N4 (notices): this docs commit. NOTICE.md (HDRI) removed with the HDRI; one NOTICE; LICENSES/Apache-2.0.txt added (the Apache 2.0 terms, copied from the typescript package).
- W1G-N5: 48c60ca: src/lookdev/** excluded from unit coverage like src/render.
- Evidence: 96ebd49 docs/look-dev/00-hero, 01-three-quarter-front, 02-side, 03-cutaway, 04-exploded, 05-fan-idle, 06-fan-takeoff, 07-hot-section (1920x1080, `node tools/lookdev/capture.ts`); old shots in docs/look-dev/before/. docs/LOOKDEV.md and docs/GPU_FACTS.md M36-M42 updated.

NEXT
1. Orchestrator: re-measure on AC in a quiet window (D0-1): `npx vite --port 5184 --strictPort`, then `node tools/lookdev/capture.ts --only none` (timings only; writes docs/look-dev/timings.json). This session's numbers were taken on battery with another agent running and swing ~2x.
2. If the default is still over ~8 ms: a reduced-resolution 3D pass for a "performance" preset (TRAA reconstructs), bounding-box early-out of the composite's fan setup, GTAO at 0.35 scale, and profiling the paint shader (procedural noise + derivative bump) against a baked normal map. The opaque pass is fill-bound; more culling will not help.
3. Fan blur: the far-side, edge-on blades at idle still blotch; a per-sample stochastic render of the fan rotor (time-jittered instances, one survivor per pixel, TRAA accumulation) would be exact if the march is not enough.
4. Remaining placeholders (LOOKDEV.md): fuel nozzles and swirlers, pylon, reverser cascades, blade platforms and fillets, temperature-driven heat tint.

GOTCHAS
- Post nodes render once per node-frame id (GPU_FACTS M37): render frames one per animation frame (the capture and `lookdev.renderFrames` do), or TRAA never converges.
- GTAO needs a texture node for normals (M38); `PCFSoftShadowMap` is gone in WebGPU (M40); do not swap `RenderPipeline.outputNode` at runtime (M39); `TRAANode.getTextureNode` is untyped (M41).
- The format-on-write hook rewrites files; Vite's HMR then reloads the look-dev page and kills a running capture ("Execution context was destroyed"): do not edit sources while `tools/lookdev/capture.ts` runs.
- Dev port 5184; `npx vite`, not `npm run dev` (W1M-N1). The capture launches its own headed Chrome (Playwright), not the shared MCP Chrome.
- A first `npm test` took 44 min and showed 2 failures while the machine was loaded (another agent; load-sensitive timeouts in the cycle files); rerun quiet it passed 1445/1445 in 47 s (below).
- No contract changes. No new dependencies (tools/lookdev/capture.ts uses the existing @playwright/test).

GATES @HEAD
- npm test: 1445 passed / 0 skipped (63 files, 47 s)
- npm run coverage: lines 99.57 %, statements 98.65 %, branches 88.54 %, functions 99.55 %; src/geometry lines 99.56 %, branches 90.07 % (every threshold passes)
- npm run lint: clean (ESLint --max-warnings 0 + Prettier)
- npm run typecheck: clean
- npm run test:mesh: 29 passed (2 files)
- npm run test:browser: 18 passed (3 files: interop 12, chrome-gpu 2, engineView 4), 0 WebGPU errors in every mode and preset
- No dev server or Chrome left running.
