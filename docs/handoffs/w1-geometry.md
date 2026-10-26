w1/geometry: DONE (all 7 items built; known look-dev artefacts and a render-time overrun listed below) (from ac22ee3; code at c883485, docs commit on top)

DONE
- f3c9a3b (TDD) / 9356d42 D2-2: A8 = 0.1852 m² and A18 = 0.9161 m² (facts `coreNozzleArea`/`bypassNozzleArea`, now `estimate`, derived from the w1/cycle sizing, source [D2-2]); the curves follow (plug r 0.3052 at the core lip, core cowl r 0.5305 at the fan nozzle). Test: definition.test "D2-2: ... are the throats" (areas to 1e-6, area falls monotonically over the last 0.2 m). designPoint.test now pins the constant-cp estimate to its own table values (0.1778 / 0.9067) and keeps it within 5 % / 2 % of the sized areas (it was "equal to the fact", which D2-2 makes untrue). `npm run mesh` + `test:mesh` 29/29. Mesh numbers that moved: 130k worst values unchanged (130,034 cells, stretch 1.140, skew 55.2°, min J 2.61e-6, dt 1.22 µs); 80k worst stretch 1.146 -> 1.143 (core/plug blocks); local block metrics of bypass/core/afterbody/plug moved < 5 % (MESH.md tables updated); hashes 130k bd8e40b0 -> 33c76df6, 80k 03afce80 -> 6f316568 (manifest regenerated).
- b44c703 (TDD) / b261729 / 45c5194 (TDD) / 111d64d / 9314bd9 `src/geometry` (pure, 99.6 % lines, 91.6 % branches), tests in tests/unit/geometry (196):
  - profile.ts / walls.ts: definition curves with quadratic-Bezier fillets (25 mm legs; 4 mm at the splitter, 15 mm at the highlight). A Catmull-Rom spline was tried first and bulged 10 mm on the LPT casing, so it was dropped. Tests: exact on segment midpoints, within 3 mm of every point and of the polylines everywhere, the annulus open everywhere.
  - airfoil.ts: NACA 65-010 thickness table (PCHIP), DCA, NACA 4-digit "turbine" thickness on a front-loaded camber line; circular-arc chords at the mean metal angle (the definition's stagger). Tests: closure, peaks, metal angles at LE/TE, simple polygons for every hub/mid/tip section of the engine.
  - blade.ts: lofted blades on the rendered walls (hub section on the hub, rotor tip exactly one tip clearance inside the casing), centroid stacking, flat caps. Tests per row (38): watertight, outward, no degenerate triangles, inside the annulus with the clearance, LE on the definition line, deterministic.
  - rows.ts, revolve.ts (poles and hard edges), cap.ts (ear clipping), parts.ts (synthesized nacelle shell, cases, drums, a disk per rotor, shafts; every part closed and outside the flowpath), motion.ts (N -> angle with the rotation sign, shutter blur angle), explode.ts, cutaway.ts, engineGeometry.ts.
- 9825d41 .. c883485 `src/render` (worker-safe; the main-thread look-dev page is `lookdev.html` + `src/lookdev/main.ts`; `src/render/worker.ts` runs the same EngineView on an OffscreenCanvas): gpuDevice.ts (own device, addEventListener error sink, loss reporting), materials.ts (TSL), engineScene.ts (main + rotor scenes), post.ts (GTAO, rotational blur composite, TRAA, DOF, bloom, AgX), engineView.ts, presets.ts. tests/browser/engineView.test.ts: every mode on the main thread and the cutaway in a worker render with 0 WebGPU errors (2/2).
- df6b691 docs/look-dev/01..07 (1920x1080 JPEG q90), docs/LOOKDEV.md (what each shows, what is placeholder), NOTICE.md (CC0 HDRI credit), public/hdri (1.7 MB).

NEXT
1. Render time: ~20 ms (front view) and ~23 ms (hot-section cutaway) per GPU-synchronised frame at 1080p (`lookdev.timeFrames(60)`, indicative, other agents running, D0-1 not applied). The target is <= ~8 ms. Likely costs: 1.46 M triangles drawn by two scene passes, GTAO, TRAA, DOF, bloom, and the 24-tap blur. Cheapest wins: LOD the 2,296 core blades (hidden behind the cowls in realistic mode: cull rows and internals unless cutaway), fewer revolve segments on the internals, quarter-res AO, 12 blur taps. Measure with three's trackTimestamp.
2. Fan blur artefacts: replace the single fan-face plane with the intersection of the view ray and the fan's swept volume (LE/TE surfaces), so oblique views and the hub region stop showing blade-edge "teeth" (01, 06).
3. Spinner spiral too faint; the backdrop sweep renders nearly black (not diagnosed).
4. When w0/gpu-spikes merges: swap src/render/gpuDevice.ts for src/gpu/device.ts (same addEventListener pattern) and createRendererOnDevice (compatibility-mode check). File names were chosen not to collide (no src/render/rendererOnDevice.ts here).

GOTCHAS
- In a RenderPipeline post Fn, `cameraPosition`, `cameraProjectionMatrix`, ... refer to the post quad's camera, not the scene's. Pass the scene camera in as `uniform(camera.projectionMatrix)` etc. (by reference, so TRAA's jitter is included). Cost an hour.
- InstancedMesh does not rotate the `tangent` attribute (three r186 Instance.js transforms only position and normal). The blades therefore upload no tangents, and anisotropy uses the uv-derivative frame (u chord, v span).
- The rotor pass needs `renderer.setClearColor(0, 0)`: its alpha is the blade coverage.
- Thin-film iridescence at 120-700 nm reads as rainbow camouflage on large parts. Heat tint is a colour ramp plus a weak iridescence.
- GTAO returns ~0 on a far backdrop: AO is applied only within 30 m.
- The chrome-devtools MCP cannot write files outside its workspace roots. Screenshots were copied from its tool-results cache. The viewport needs `emulate 1920x1080x1` (the laptop runs at DPR 1.5).
- `npx vite --port 5183`, not `npm run dev`: predev rewrites public/mesh/manifest.json (W1M-N1).
- Vitest browser mode prints "The browser did not close within 30000ms" after passing; the process kills it on exit.
- No contract changes. No new dependencies.

GATES @c883485 (plus the uncommitted docs, which are Markdown only)
- npm test: 1169 passed / 0 skipped (39 files)
- npm run lint: clean (ESLint --max-warnings 0 + Prettier)
- npm run typecheck: clean
- npm run coverage: lines 98.13 %, statements 97.06 %, branches 87.64 %, functions 97.9 %; src/geometry lines 99.61 %, branches 91.62 %, functions 100 % (every threshold passes)
- npm run test:mesh: 29 passed (2 files)
- npm run test:browser: 2 passed (tests/browser/engineView.test.ts: main thread, every mode; worker on an OffscreenCanvas; 0 WebGPU errors)
- Dev port 5183. No server or test Chrome left running; the shared MCP Chrome page was closed.
