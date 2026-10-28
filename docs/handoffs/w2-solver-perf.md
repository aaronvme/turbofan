w2/solver-perf: STOP-CLEAN (Aaron asked to pause). D4-54's goal is met where the kernel runs alone: Chrome 2.25 -> 1.29 ms/it, Dawn 1.74 -> 1.04 ms/it, results bitwise equal. Inside the 1080p scene on this loaded machine it is only 2.87 -> 2.49 ms/it (see FINDINGS 2). The P1 command exists but has not been run (never `bench:*`). Gates are partial. (From main c661d5c; HEAD = this handoff's commit.)

All timings here are indicative (the machine was shared, about 20 % CPU from other agents, 3.5 GB free RAM). They come from paired, interleaved A/B runs on one device (tools/perf). No D0-1 timing was made.

DONE
- 42a6733, 4219a85: the tools/perf profiler (Dawn `tools/perf/dawn.ts`, Chrome `tools/perf/chrome.perf.ts` + `vitest.perf.config.ts`). It gives:
  - the per-dispatch GPU time of one iteration, each dispatch in its own timestamped pass;
  - the static bytes per dispatch (`tools/perf/bytes.ts`);
  - a paired A/B of builds (`REF[@TXxTY]`; old refs are exported with `git archive` under test-results/perf-ab);
  - a bitwise comparison after 50 iterations of the state copy, U^n + lo and the four render textures.
- 1f045bd (TDD) / 32d6de4: **the stage kernel computes its halo's primitives and ghosts itself** from U (consToPrim + ghostPrim in the halo load; boundary.ts split into BOUNDARY_FNS + the ghost pass). One dispatch per RK stage.
  - The prim and ghost passes stay for readPrimitives, the physical-time lambda and the source model.
  - The resample's prim pass drops its ghost pass (it reads cells only).
  - The stage kernel no longer binds prim: 7 storage buffers, 8 with sources (fits WebGPU's default), 9 with the dump.
  - Results are **bitwise equal** to main on Dawn and on Chrome (0 differing words in state, lo and textures).
  - test:gpu prints every §12.2 number identical to main to the digit: C, C-pre, C physical, D, E-L5, E-L9a, S, and the moving rows.
- Tile re-sweep (fused kernel, Dawn, paired, 10-16 reps). **16x8 stays**:
  - 16x8 1.042-1.046 ms/it;
  - 32x8 1.089; 16x16 1.10; 8x16 1.10; 16x4 1.66;
  - all bitwise equal to 16x8.
  - The bigger tiles lose occupancy to workgroup memory. No change committed.
- c3dc45a (TDD) / 8bb64a0: GpuFlowSolverOptions.onFrameTiming: each timed frame's iterations, solver and resample ms, by field version. TDD test in tests/gpu/flow-solver.test.ts.
- 2264e49 (WIP): `npm run bench:p1`. This is the official P1 command, built on the D0-1 harness (spikes/bench/run.ts kind p1; D3-6 validity, rotated order, conditions JSON). It runs:
  - `solver-130k`: the app's GpuFlowSolver on the 130k asset, at D4-2's budget, inside the W0 1080p bench scene (spikes/scene/productionRun.ts);
  - `spike-130k-16x8`: the calibration row against M34's 1.277.
  - It prints `P1 (>= 150 it/s ...): PASS/FAIL`.
  - The page path has a 5 s smoke test: tests/browser/p1Bench.test.ts (passes).
  - The runner itself was NOT run: the brief forbids `bench:*`.

PROFILE (one iteration, 130k, 16x8, perf state)

| | dispatches | Chrome ms | Dawn ms | MB/it upper (unique) |
|---|---|---|---|---|
| main | 9 (3 x prim, ghost, stage) | prim 0.18, ghost 0.055-0.074, stage 0.44 / 0.44 / 0.54; sum 2.16-2.19 | prim 0.17-0.19, ghost 0.05-0.06, stage 0.41 / 0.43 / 0.55; 2.06-2.19 | 161 (132) |
| fused | 3 | A/B 1.29 | stage 0.36 / 0.32 / 0.39; 1.06-1.09 | about 105 (70): the prim and ghost passes go, the halo reads U instead of prim |

- The one-pass time equals the sum of the dispatches, so the drains between dispatches cost little.
- The stage kernel is near the memory bandwidth (about 70-80 GB/s).
- Stage 3 costs about 0.07 ms more than stage 2: the lo read and write (14.6b).

A/B (main c661d5c vs fused)

| | Chrome ms/it | Chrome resample ms/frame | Dawn ms/it | Dawn resample ms/frame |
|---|---|---|---|---|
| main | 2.254 | 0.722 | 1.741 | 0.569 |
| fused | 1.286 | 0.658 | 1.043 | 0.506 |

FINDINGS FOR THE ORCHESTRATOR (decisions needed)
1. **Main's default preconditioned tracking diverges on the 130k engine mesh.** The engine default is minMach 0.003, CFL 0.8.
   - A 0.1 % pressure wave at rest gives NaN within 50 iterations. It starts at the inflow-axis corner, cell 0, x -8.2.
   - A hot fuel plume at rest gives NaN within 100 iterations (block 8, near the axis).
   - The jet/plume timing state gives NaN at about 150-200 iterations.
   - The plain scheme (`--plain`) keeps all of them finite for 1000-4000 iterations.
   - Repro: `node --import ./tools/mesh/ts-resolve.mjs tools/perf/dawn.ts soak [--ref c661d5c] --iterations 300 --every 50 --amp 0,0,0,0,0.001,0 [--plain]` (amp = jet,dT,swirl,z,dp,v).
   - Likely D4-51 / W2S-B-N9: the GPU's M_ref is not yet taken from the face's beta, so a Delta-p-raised beta^2 meets an M_cut-scaled pressure diffusion. That is a scheme item, not D4-54's.
   - The bench re-sets its state every 100 iterations (RESET_ITERATIONS).
2. **Inside a 1080p scene in Chrome, the solver runs about 2x slower than alone (2.4-2.9 ms/it).** The scheduler then stays at its floor of 2 it/frame: 120 it/s, a P1 fail today.
   - Main is hit too. Paired in-scene, main is 2.87 and fused 2.49 ms/it.
   - Probes (test-results only, not committed) narrow it down:
     - it is not the device features, not cache flushing, not vsync pacing alone, and not the render order;
     - allocating more than 128 MB of other GPU buffers in Chrome AFTER the solver's own makes it slow, and it stays slow after they are freed;
     - allocations made before it do no harm;
     - in Dawn/Node there is no effect;
     - at fixed iterations per frame in the scene: 1 it 2.5, 2 it 2.35, 4 it 1.6, 6 it 1.2 ms/it, so the cost falls with the load (iGPU clock or memory DVFS).
   - The spike kernel measures 1.27 ms/it in the same scene today (M34's official value).
   - Decide:
     - run `npm run bench:p1 -- --quick` and then the official run in a quiet window: a quiet machine may not show this;
     - whether P1 should be measured in the app's EngineView (D4-54 says "the app's 1080p scene") rather than the W0 bench scene. The started work is NEXT 1;
     - whether D4-2's scheduler needs a floor or a model that avoids the low-load equilibrium (B-I4 (b), carry the fractional budget).
3. FLOW_SOLVER_LIMITS stays at maxStorageBuffersPerShaderStage 9. 8 is now enough with sources. The host test now pins `>=` instead of `==`. Keep 9 or lower it to 8?
4. Flagged edits outside the solver: `GpuFlowSolverOptions.onFrameTiming` (additive); spikes/scene/benchApp.ts (production branch, preferredLimits); spikes/bench/run.ts (kind p1); package.json `bench:p1`.

NEXT
1. Finish the app-scene P1 configuration. Started: BenchConfig.scene 'app' is declared but not wired. Then the P1 page: spikes/p1/index.html + main.ts:
   - createEngineView at 1920x1080 DPR 1, default preset;
   - GpuFlowSolver on view.device.device;
   - runProductionSolver with scene.render = view.frame and renderMs = view.stats().timings.gpuTotal.
   - In run.ts, give each p1 config its own page (page.goto per run, like runWorker); a fresh page per run also gives a fresh device.
2. Gates in sequence. Owed: npm test, lint, coverage, test:mesh, test:gpu-ladder, test:browser. test:gpu passed at 32d6de4 (58 + 1 expected fail). tsc is clean at 2264e49.
3. Update docs: spikes/README.md (bench:p1 row, duration about 7 min for 2 configs), GPU_FACTS (the tile sweep and the in-scene slowdown as indicative), SOLVER.md §2/§5 wording (the ghosts are now computed in the halo).
4. If time allows:
   - the last stage 3 of a frame writes the cells' primitives, to drop the resample's prim pass (about 0.1 ms/frame; needs prim bound again or a variant);
   - A-I3 (a browser-safe oracle shell).

GOTCHAS
- The bitwise A/B must run the iterations on the kernel directly. The FlowSolver scheduler can cut a frame short, which made an early 32x4 comparison look wrong.
- perfState goes non-finite after about 150 preconditioned iterations. Profiles and A/B runs re-set it, so keep their iteration counts below that.
- Chrome perf results go to test-results/perf-logs/chrome-*.json via commands.writeFile, a path relative to the root. The console does not print on a pass.
- GNU tar reads "C:" as a host: extract with cwd set.
- In Chrome, back-to-back frame brackets are submission-bound. Use pass timestamps, as onFrameTiming does.
- Port 5189. Nothing is left running.

GATES @32d6de4 / 2264e49 (partial, STOP-CLEAN)
- npm run typecheck: clean (2264e49). eslint on tools/perf: clean (42a6733); the full lint is owed.
- npm run test:gpu: 10 files, 58 passed + 1 expected fail (32d6de4). flow-solver.test.ts: 7 passed after onFrameTiming.
- tests/browser/p1Bench.test.ts: passed (port 5189).
- npm test, coverage, test:mesh, test:gpu-ladder, the full test:browser: not run this round (owed).
