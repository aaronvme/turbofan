w1/mesh: DONE, ready for critic review. Production 130k / 80k meshes on the real EngineDefinition meet every requirement unsmoothed, with stations and blade edges on grid lines (from 6619a45; HEAD see GATES)

DONE
- W0M-I2 / W0M-I3 (first, before any retuning, D1-6):
  - 29bc705 (TDD) and 1817195: tests that kill the critic's mutants, each hand-applied and confirmed killed:
    - in-block stretch (metrics 312, 317-321), skew (291) and aspect (301), with their locations;
    - exact centroids against a shoelace polygon centroid (55, 59);
    - TFI Soni blending against the analytic line intersection on a parallelogram with four different edge clusterings (tfi 77-79);
    - the Vinokur interior against Vinokur's closed form on the tanh, tan and B = 1 branches (distribution 104, 67, 79).
  - Equivalent mutants found:
    - distribution 104 (A - (1-A)u) is equivalent unless A < 1/2: normalised, it is the same family with A' = A/(2A-1), and Newton re-solves the slopes. So a case with A = 0.3 kills it.
    - distribution 88 (B = sqrt(s0 s1)) is equivalent: it reflects the slope parametrisation Newton solves for.
- W0M-N2: 29bc705 (TDD) and 6037503. maxRatio returns Infinity on a fold or a zero spacing; both orientations are tested.
- W0M-N5: 29bc705. Each TFI corner check is pinned, by name, with only x or only r off; counts are checked before corners.
- W0M-I1 (D1-4):
  - e2800fb (TDD) and 7a0e062: tools/mesh/geometry/definition.ts, `flowpathFromDefinition`.
    - hub = spinner + coreInner + plug;
    - the knife-edge closure of the blunt lips onto the duct-side line, over 10 base thicknesses;
    - the blade edges extended wall to wall;
    - the stations and the combustor.
  - definitionGeometry.test.ts:
    - stated tolerance: only the external line moves, only over the last 10 base thicknesses, inwards, by at most the base thickness (15.0 / 18.0 mm);
    - coreOuter and nacelleInner bitwise, so A8/A18 are unchanged;
    - monotone x on every curve, falling boattails, positive thickness to the lip;
    - edges collinear with the definition's to 1e-12.
  - The placeholder flowpath is deleted.
- W0M-I4 (D1-6):
  - 9409367 (TDD) and 7a0e062 / 3647e54: every reduction station (2 13 18 25 3 4 45 49.5 5 8) is an exact radial grid line, and every blade LE/TE is a grid line (the fan's are swept), so body-force zones are whole cells.
  - New in build.ts: `wallRows` and `wallSpacing` (per-wall arc-length spacing with shared counts), `fixedSpacing`, `segmentCounts` and `pchip`.
  - EngineMesh.stations and EngineMesh.rows are the station map and the row map.
  - bbfe538 (TDD) and 3647e54: binary v2 with STATIONS (32 B) and ROWS (48 B) sections; writer -> reader -> writer stays bitwise.
- W0M-N3: bbfe538 (TDD) and 3647e54. `meshFileProblems`; the decoder rejects:
  - element types that disagree with the precision flag;
  - block offsets that do not add up;
  - out-of-range patches, ghosts and BC codes;
  - stations and rows outside their blocks.
- Retune on the real geometry, 3647e54 (numbers in docs/MESH.md):
  - the C-block wall spacing is capped at outer-layer thickness / offset stretch, with normals on a fine, placement-independent sampling;
  - the fan face is matched to the swept fan LE wedge (4:1);
  - arc-length plug wall nodes fix the 45-degree plug tip (1.393 -> 1.140).
  - Results:
    - 130k: 130,034 cells (+0.03 %); max stretch 1.140 (plume-core at the plug tip).
    - 80k: 80,588 (+0.7 %); max stretch 1.146 (core at the core lip, and the plug).
    - Both: 16/48/32 across; >= 6 cells per chord (130k: 8-29); lips 9.0 mm; 5.01 D up, 5.69 D radial, 20.01 D down; min Jacobian 2.6e-6 / 2.8e-6 m2.
- Test split, 3647e54: the full-size requirement suite is tests/mesh (`npm run test:mesh`, added to `npm run gates`), with 29 tests in about 1.2 s. The unit suite builds a 43k smoke mesh for structure and coverage.
- Asset, 3647e54:
  - `npm run mesh` writes public/mesh/mesh-{130k,80k}.bin (f32, git-ignored) and public/mesh/manifest.json (sha256, committed).
  - `mesh:assets` runs before dev and build.
  - tests/mesh/asset.test.ts rebuilds and checks bytes and hash.
  - Why generate: deterministic in 0.5 s, the history avoids 12 MB of binary churn, and the manifest diff shows every mesh change.
- D0-7, 3647e54 / 669178a: `explicitDtLimit` gives 1.22 us at 130k and 1.30 us at 80k (HPC exit at the hub, CFL 1, mean-line wave speeds), against W0's estimate of 1.4 / 1.6 us.
- W0M-N1, 669178a: MESH.md D3 now records the critic's measured smoothing numbers and options, says the singular points stay pinned while the cells around them degrade, and adds W1's corner-constrained plug-tip smoothing evidence: worse in every variant (1.43-1.44 with control, 2.35 without), so D0-6 stands.
- WONTFIX:
  - W0M-N4 (corner ghosts) is a solver choice for W2/W3 (MESH.md notes);
  - the far field's 32 % share (R5) is inherent to point matching; the options and their costs are in MESH.md.
- Open for contracts:
  - W0M-I5: FIELD_EXTENTS.far reaches r = 10 m, and the mesh ends at r_out = 8.82 m.

NEXT
1. Critic review. Run all three: `npm run gates` (now includes test:mesh), `npm run mesh`, then `git status` should show only public/mesh/*.bin (ignored) and no diff.
2. Orchestrator decisions:
   - (a) The physical-time dt is about 1.2 us at 130k: update D0-7 (was ~1.4 us) and the plan's 2 us.
   - (b) MeshAsset (src/contracts/flow.ts): consider an optional `sha256` so the W2 loader can check the asset against public/mesh/manifest.json; the format version is now 2.
   - (c) W0M-I5: define out-of-domain far texels (ambient), or size the far extent from the mesh (r_out 8.82 m).
3. W2: load public/mesh/mesh-130k.bin, check the hash, use the STATIONS/ROWS sections for station reductions and body-force zones; add corner ghosts if the eddy viscosity needs them (N4).

GOTCHAS
- Every construction spaces wall nodes by arc length because the definition's walls are coarse polylines (kinks up to 28 degrees): ducts by wallRows, the plug by arc length, the C-block by arc length. Do not round the polylines: the station-plane areas would move (up to 10 % in the HPC-exit annulus).
- If a definition change moves a blade edge or a station, the duct counts move with it; tests/mesh catches quality. Then rerun `npm run mesh` and commit public/mesh/manifest.json, or asset.test.ts fails on the hash.
- C-block: P1/P2 need outer-edge spacing = outer-layer thickness. The cap in hWall does this, and the normals come from a fine sampling (independent of where nodes go); keep it that way.
- Fan: the swept LE is 5 mm behind the fan face at the hub and 20 mm at the tip. The inlet and C-block take the fan block's first-cell widths (1.7 / 6.6 mm) as their fan-face spacing; the fan block is built before the C-block for this.
- The asset hash depends on V8 Math (Node 24); a Node major upgrade may change it.
- Scratch and debug scripts lived outside the repo. Rasterising SVGs for a look works with `npx playwright screenshot --channel chrome <file:///...svg> out.png`; the bundled headless shell does not match the installed Playwright version.
- Do not use `python` (a Store stub) or `rm -rf` (a hook blocks it); `git checkout -- <file>` also trips a safety hook.

GATES @669178a (+ this handoff)
- npm test: 871 passed / 0 skipped (31 files, 2.4 s)
- npm run test:mesh: 29 passed (2 files, 1.2-1.7 s): both production meshes, every requirement, the asset hash
- npm run lint: clean (eslint --max-warnings 0, prettier --check)
- npm run typecheck: clean
- npm run coverage: lines 99.44 %, statements 98.05 %, branches 86.89 %, functions 99.38 %; tools/mesh lines 99.21 % (gate 90 %); every threshold passes
- npm run mesh: regenerates docs/mesh and public/mesh/manifest.json byte-identically (git status clean afterwards)
- Mutation (Stryker 10.1.1, tools/mesh tfi/distribution/metrics):
  - stage 1 (the critic's protocol: mesh unit tests without the full-size builds), before -> after:
    - tfi 76.7 -> 99.1 %;
    - distribution 73.2 -> 83.6 %;
    - metrics 84.6 -> 95.2 %;
    - all 79.1 -> 92.2 % (1050 mutants).
  - The critic's combined pass-1 numbers were tfi 80.6 %, distribution 71.4 %, metrics 87.6 %, all 80.8 %.
  - The remaining distribution survivors are equivalent: bisection < vs <=, normalisation no-ops, Newton/damping internals that still converge, mutant 88.
  - Default config, `npx stryker run --mutate tools/mesh/tfi.ts,tools/mesh/distribution.ts,tools/mesh/metrics.ts` (full unit suite, 11 min):
    - tfi 100 %, distribution 98.9 %, metrics 99.2 %, all 99.25 %;
    - 728 killed, 325 timeouts, 8 survived, of 1061.
    - Stryker counts timeouts as detected, and many are mutants that only slow the smoke-mesh build, so the stage-1 figures are the stricter measure.
- No new dependencies. No dev server or Chrome page left open.
