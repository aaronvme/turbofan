w0/mesh-spike: WIP at STOP-CLEAN. Numerics, metrics, ghost map, format and SVG are done and tested; the 12-block builder is written but has never been run (from fe260dd; HEAD see GATES)

DONE
- d3e437d (TDD) / 7a54582: `tools/mesh/distribution.ts` (uniform, geometric, Vinokur two-sided with exact discrete end spacings, spacing-function `bySpacing`, `maxRatio`), `curve.ts` (arc-length polylines, ray hits, Hermite/Bezier helpers), `tfi.ts` (Soni arc-length-blended TFI, boundaries copied bitwise; `twoBoundary` for the C-block), `smooth.ts` (multi-block Winslow/TTM, point SOR; floating interfaces via canonical nodes + halo stencils, both copies written back bitwise equal; physical boundaries, station planes and patch ends fixed). Tests: tfi.test.ts (boundary curves bitwise, analytic annular duct, bilinear exact), smooth.test.ts (boundary nodes fixed, stretched tensor grid is a fixed point, floating interface moves and stays matched), distribution/curve tests.
  - Decision in 7a54582: the default control functions are Thomas-Middlecoff from the block boundaries. Initial-grid (per-line) control preserved interior distortion (the roughness test only fell 4x), so it is opt-in per block/direction (`blockControl`) for the C-block's wall-normal clustering (test pins both behaviours).
- de9609a (TDD) / 9223a38 (WIP):
  - `geometry/flowpath.ts`: the named-curve input interface (hub, coreOuter, coreCowl, nacelleInner, nacelleOuter + blade rows + combustor) and `validateFlowpath`.
  - `geometry/placeholder.ts`: CFM56-7B-class placeholder. Only D = 1.55 m is a public figure; everything else is labelled as illustrative. It has a 2.5-2.7 cm HPC rear annulus and 19 HPC rows. Tests in geometry.test.ts.
  - `metrics.ts`: cell centroid, planar area, r-weighted volume, face n*L and rbar*L. Closure test: sum n_r rbar L = A to 1e-12, the L1 free-stream identity.
  - Quality metrics: corner Jacobians, scaled Jacobian, skew, stretching including across interfaces, wall and interface orthogonality, interface kink, aspect ratio.
  - `ghost.ts`: 2-layer ghost map; interfaces are index copies, physical boundaries point at the mirror cell plus a BC code.
  - `format.ts`: binary v1, a 64-byte header, a section table, and 8-byte-aligned SoA sections. Nodes are f64; metrics are f64 or f32 by flag. Writer -> reader -> writer round-trips bitwise.
  - `svg.ts`: per-block colours from the dataviz reference palette, plus labels and a legend.
  - All tested: 69 tests pass.
- 9223a38 (WIP, UNVERIFIED): `engineMesh.ts`, the full 12-block builder.
  - Blocks: upstream, inlet, lip (C-block), fan, bypass, core, afterbody, plug, plume-core, plume-bypass, plume-outer, farfield.
  - Specs `MESH_130K` and `MESH_80K` (the values are first guesses).
  - `tests/unit/mesh/engineMesh.test.ts` checks both specs:
    - Jacobian > 0;
    - interface nodes and face vectors bitwise (equal for min/max face pairs, negated for max/max);
    - counts and a ±5% target;
    - stretching <= 1.15 across interfaces;
    - 16/48/32 cells across the core/fan/bypass;
    - >= 4 cells per chord;
    - 8-10 mm at both lips;
    - domain >= 5 D upstream/radial and 20-21 D downstream;
    - walls on their curves;
    - station planes exact.

NEXT
1. Run `npx vitest run tests/unit/mesh/engineMesh.test.ts`. Expect to debug the builder first:
   - the valence-5 points P1/P2 at the ±45° smoothed-normal points of the C-block;
   - the Bezier inlet-west and farfield-west faces;
   - the duct mean-line ray cuts;
   - the inlet south-face count matching (`iP1`).
2. Tune the `MESH_130K`/`MESH_80K` parameters to hit 130k/80k ±5% with stretching <= 1.15. My budget estimate put the first guess near 70-80k for "130k". The levers are plume Δx (`plumeSpacingMax`, `nearPlumeD`), `nFar`, `nLip` and `cellsPerChord`. Never relax a test threshold.
3. If the 130k build plus 300 sweeps is too slow for the unit suite (budget < 30 s total), move the production-spec assertions to the script and test a coarser spec of the same topology.
4. Write `tools/mesh/scripts/generate.ts`, run via `node --import ./tools/mesh/ts-resolve.mjs` with a ~12-line `module.registerHooks` resolve hook that appends `.ts`; this was tested on Node 24.18, no new deps. Add an `npm run mesh` script. It should:
   - build both specs;
   - write `docs/mesh/*.svg`: the full domain (lineStride 4), the engine overview, and zooms on the inlet lip, splitter, HPC rear, core nozzle and plug;
   - write a metrics JSON;
   - round-trip the binary file to a temp dir (do not commit the asset).
5. Extend `vitest.config.ts` coverage `include` with `tools/mesh/**/*.ts` and add a 90%-lines threshold for `tools/mesh/**` (exclude `tools/mesh/scripts/**`).
6. Write `docs/MESH.md`:
   - block list and connectivity diagram;
   - BC codes;
   - per-block counts;
   - the quality table;
   - the SVGs;
   - the binary layout (section ids and record layouts are in `format.ts`);
   - decisions;
   - risks for W1.
7. Run the full gates, then rewrite this handoff.

GOTCHAS
- The C-block topology forces two valence-5 points (P1 inside the inlet, P2 outside). One block gets squeezed there; with floating interfaces the smoother balances the angles (the ideal is ~72° per cell). Only patch ends are fixed.
- Face vectors across an interface are bitwise *negated* for max/max or min/min face pairs: inlet.jmax|lip.jmax and upstream.imax|lip.jmax. They are equal for min/max pairs.
- Initial-grid control preserves any irregularity of the algebraic grid. Use it only where the algebraic grid is smooth by construction.
- Do not use `rm -rf` (a hook blocks it). Do not use `python` here either (a Store stub hangs).
- `Polyline.atX` is a linear scan, so building is O(nodes × curve points). Watch the build time.

GATES @9223a38
- npm test: not run in full. `vitest run --exclude engineMesh.test.ts`: 69 passed / 0 skipped (10 files). engineMesh.test.ts not run.
- npm run lint: not run at HEAD (eslint was clean on tools/mesh at 7a54582).
- npm run typecheck: clean.
- coverage: not run; tools/mesh not yet in the coverage include.
- gpu/browser suites: not touched.
