w0/mesh-spike: DONE, ready for critic review. The 12-block engine mesh builds at 129,913 (130k) and 79,769 (80k) cells and meets every requirement without smoothing. The generator, SVGs, metrics, binary round trip, coverage and docs/MESH.md are done. (from fe260dd; HEAD 6bda5a3 + this handoff)

DONE
- 7a54582 / 9223a38 (previous builder): distributions, curves, TFI, the smoother, metrics, quality, ghost map, binary v1, SVG, placeholder flowpath, and a first, unrun builder.
- 0e0a018 (TDD) / 2d11e66: builder rework. engineMesh.test.ts went from "never run" to 25/28. The rework, construction by construction:
  - duct walls cut by a smoothed mean-line normal, blended to radial over 1.5 duct heights;
  - downstream blocks built column by column, with one radial spacing function per jet shear line;
  - plume-outer designed by its first and top cells; the old top curve dipped through the bypass shear line and folded the block;
  - far-field first-cell targets smoothed along i;
  - the upstream block built as a blend of its west face and progressively smoothed, arc-length-preserving copies of the east face, which turns by 73 and 77 degrees at P1/P2;
  - C-block columns radial next to the fan face;
  - domain extents rounded outwards + 1 cm; station planes exact (`segment` keeps a shared coordinate bitwise);
  - smooth.ts gained a `blocks` option (smooth only the named blocks); smooth.test.ts covers it.
- f81ffcf: specs tuned, and the shear-line spacing changed to 9 mm + 36 mm·u². engineMesh.test.ts 28/28 for both specs.
  - 130k: 8 cells per chord, 8 mm lip axial spacing growing at 0.5 %, a 25 mm plume plateau to 11 D, nFar 36.
  - 80k: 6 cells per chord, 10 mm lips growing at 0.8 %, a 50 mm plateau to 7 D, nFar 36.
- e83873b (TDD) / 48e4642: report.ts (engineMeshReport). report.test.ts runs 7 tests. The SVG (TDD) commits c878f79 and 9d67429, both turned GREEN in 48e4642, add sub-pixel decimation and labels snapped to a node of the block.
- ffcc921: tools/mesh/scripts/generate.ts, run as `npm run mesh`:
  - builds both specs;
  - writes docs/mesh/mesh-<spec>-<view>.svg: the domain and engine views for both specs, plus the inlet lip, splitter, HPC rear, core nozzle and plug zooms for 130k;
  - writes docs/mesh/metrics-<spec>.json;
  - round-trips binary v1 (f64 and f32) through the OS temp dir bitwise; the asset is not committed.
  - docs/mesh/ is listed in .prettierignore because it is generated.
- 751da24: vitest.config.ts coverage now includes tools/mesh/**/*.ts (scripts excluded), with a threshold of tools/mesh/** lines 90. Also: topology.test.ts (every validateMesh problem class), extra flowpath validation tests, and smooth.ts reads arrays through one accessor (behaviour unchanged).
- 4ba2b7b: docs/MESH.md:
  - requirements table and representative chords;
  - block list, schematic and interface table;
  - BC codes, per-block counts for both specs and the full quality tables;
  - worst values with locations;
  - the SVGs;
  - the binary v1 layout;
  - decisions D1-D8 and W1 risks R1-R7.
- 3141006 / 6bda5a3: the engine-independent helpers moved to tools/mesh/build.ts, plus cleanups. npm run mesh regenerates docs/mesh byte-identically.

Results (130k / 80k):
- Total: 129,913 (-0.1 %) / 79,769 (-0.3 %).
- Cells across: core 16, fan 48, bypass 32. Lips: 9.0 mm radial inside and outside both lips. Domain: 5.006 D upstream, r_out 5.65 D, 20.006 D downstream.
- Worst stretching: 1.137 / 1.135, in the upstream block next to P2.
- Minimum Jacobian: 2.6e-6 / 3.5e-6 m^2, at the HPC rear.
- Worst skew: 46.5 deg, upstream corner at P2 (the far field reaches 46.3 deg at O).
- Wall orthogonality: 36.5 deg at the spinner nose; 16-23 deg at the radial station planes.
- Aspect ratio: up to 96 / 77 at the top of the far field.
- Smallest edge: 1.39 mm, HPC rear.
- Cells per chord: HPC rear 8 / 6; all rows 8-19 / 6-19.
- Per-block counts are in docs/MESH.md.

NEXT
1. Critic review of w0/mesh-spike. Orchestrator decisions are needed on:
   - D3: the production mesh runs 0 elliptic smoothing sweeps (measured evidence in MESH.md);
   - R2: the HPC rear's 1.4-1.9 mm cells put the explicit 2D time-step limit at about 1.4 us (130k) / 1.6 us (80k). That is below the plan's 2 us physical-time step. The options are a smaller step, local subcycling, or relaxing "16 across the core everywhere" in the HPC rear.
2. W1 (w1/mesh):
   - write an adapter from the real EngineDefinition to FlowpathGeometry (tools/mesh/geometry/flowpath.ts);
   - run `npm test` and `npm run mesh`;
   - if engineMesh.test.ts fails, retune using MESH.md R1's list of sensitive spots: the C-block's outer layer against its outer-edge spacing at P1/P2, the far-field ratio next to P2, sharp duct bends, and the boattail at O.
3. Optional W1 improvements:
   - singular-point-aware smoothing (free valence-5 points; junctions O and the shear-line T-points with a face-interior home frame) if the solver wants better skew;
   - a patched far-field interface to free about 25-30k cells (R5);
   - shipping nodes only, 2.2 MB (R6).
4. Optionally add a one-line pointer from GPU_FACTS.md (where the plan files spike results) to docs/MESH.md.

GOTCHAS
- Interfaces match by construction, not by smoothing. If you change one block's distribution, keep its neighbours in step. The functions that re-space to a neighbour are:
  - `eastCross`/`hEast` for the upstream block;
  - `ffBelow` for the far field;
  - the inlet column re-spacing;
  - `hBs`/`hCs`, shared across the shear lines.
  engineMesh.test.ts checks stretching across every interface.
- Do not rebuild the upstream block with a TFI. The east face turns by about 75 deg at the valence-5 points P1/P2, and a TFI (or per-row geometric fractions) carries that into every column as a step; we measured up to 7.7. The blend with arc-length-preserving smoothed guides is what keeps it at 1.14.
- Smoothing:
  - floating interfaces with pinned junction points spike around P1, P2, O and the shear-line T-points;
  - TM control on column-designed blocks drifts the cells next to fixed interfaces.
  - See MESH.md D3 before turning sweeps on; smoothingOptions limits any smoothing to fan/core/bypass.
- `segment()` in build.ts keeps a coordinate both ends share exactly. Station planes are checked bitwise (`toBe`), so never lerp x on a radial line.
- The full production-size engineMesh.test.ts runs in about 1 s for both specs, so it stays in the unit suite. The whole unit suite takes about 1.3 s.
- Branch coverage is sensitive to `?? 0` fallbacks under noUncheckedIndexedAccess (each one is an unreachable branch). Use a local accessor in hot loops, as smooth.ts does.
- Debugging: run the mesher under plain Node with `node --import ./tools/mesh/ts-resolve.mjs <script.ts>`, where the script imports tools/mesh with relative or file:// specifiers. Builds take about 0.2 s. Open docs/mesh/*.svg in Chrome to look at the grid.
- Do not use `rm -rf` (a hook blocks it) or `python` (a Store stub hangs).

GATES @6bda5a3
- npm test: 120 passed / 0 skipped (13 files, 1.27 s)
- npm run lint: clean (eslint --max-warnings 0, prettier --check)
- npm run typecheck: clean
- coverage: lines 99.14 % (tools/mesh 99.15 %, tools/mesh/geometry 98.96 %), branches 80.38 %, functions 100 %, statements 98.17 %. All thresholds pass, including the new tools/mesh/** lines >= 90.
- npm run build: ok
- gpu/browser suites: not touched
- No new dependencies. No dev server or Chrome page left open.
