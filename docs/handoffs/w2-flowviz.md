w2/flowviz: PARTIAL (STOP-CLEAN on the usage brake). The pure flow-visual math is done and tested; the cut plane is drawn from the MOCK field; particles, haze/schlieren, glow, legend and the timer are NOT built yet (from main 1eb1e62; HEAD: see `git log -1`, the handoff commit)

DONE
- ac66b6e (TDD) `tests/unit/flow/viz/*.test.ts`: 36 tests, committed before the code.
- 88525c6 `src/flow/viz/particles.ts` (particles.test.ts):
  - Particles are advected in (x, r, θ) by the solver's u_x, u_r, u_θ (midpoint RK2, dθ/dt = u_θ/max(r, 1e-4)), so r is exact in pure swirl. A step through the axis reflects (r → −r, θ + π).
  - They are drawn at (x, r cos θ, r sin θ) with the PHYSICS.md 2.1 frame: θ = 0 is +y, θ = π/2 is +z.
  - `velocity3D` gives the streak direction.
  - Checked against analytic fields: uniform flow, solid body, free vortex, a helix, and u_r = kr, whose error falls 4× per halving (second order).
  - The particle dies outside the field or where the fluid fraction is < 0.5.
  - Seeding: seeded mulberry32 and uniform-by-area annular zones split by weight. `particleAlpha` fades in, out and at the edge.
- `src/flow/viz/optics.ts` (optics.test.ts):
  - Edlén 1966 refractivity: 2.77e-4 at 589 nm, so the Gladstone–Dale K = 2.26e-4 m³/kg (within 1 % of Merzkirch). Also `refractiveIndex` and the small-angle `hazeDeflectionRad`.
  - Planck: the Wien peak checks, and σT⁴/π to 0.1 %.
  - CIE 1931 colour from the Wyman–Sloan–Shirley 2013 fit: illuminant A comes out at (0.4476, 0.4074) ± 0.005.
  - `blackbodyLinearSrgb` (out-of-gamut colours lifted with white) and `blackbodyLuminance` (cd/m²).
- `src/flow/viz/colormaps.ts`:
  - viridis and inferno (Zucker's CC0 polynomial fits) are within 0.02 of matplotlib at 0, 0.5 and 1, and rise monotonically in L*.
  - The diverging map is built in CIELAB, with L* symmetric to within 1.5.
  - `bakeLut` makes the 256-texel GPU LUT; `niceTicks` gives the legend's 1-2-5 ticks.
- `src/flow/viz/fields.ts`: p, ρ, T, Mach and |u|.
  - p and ρ are shown as log2 of the ratio to the ambient, on the diverging map.
  - Mach uses the thermally perfect a = sqrt(γ(T, FAR) R T).
  - Each quantity has its contour step. ISA a = 340.3 m/s is checked.
- `src/flow/viz/modes.ts`:
  - Realistic, Cutaway, Schlieren and Data, each mapped to a look mode with `lookModeFor`.
  - `synthesized: []` is pinned by a test (honesty).
  - `FLOW_VISUALS_BUDGET_MS = 2` (D4-2).
- 892367a PHYSICS.md §1: fidelity-ledger rows for the flow visuals and for the hot-part glow, which is derived and rests on a metal-temperature assumption.
- 0bc9e65 `src/render/flowViz.ts`: the cut-plane display.
  - The near-extent field is painted on the two faces of the cutaway wedge. Solid texels are alpha-tested away, where the caps show the metal. Colour comes from the LUT, with anti-aliased contours (fwidth).
  - `EngineView.setFlowField(cpu)` and `setFlowMode(id)` are added; the mode also sets its look mode. This round feeds the field through DataTextures (HalfFloat).
  - Proven by `tests/browser/flowViz.test.ts`: every mode renders with 0 WebGPU errors, the Data and Cutaway frames gain more than 0.02 mean chroma, and it writes `docs/look-dev/flow/{realistic,cutaway,schlieren,data}.png` (960×540, MOCK takeoff field). Realistic and Schlieren look like the plain engine: those modes are not built yet.

NEXT (in order)
1. GPU particles (the main missing piece). Port `advectParticle`, `seedParticle` and `particleAlpha` to a WGSL or TSL compute pass over a storage buffer of (x, r, θ, age).
   - Sample the D0-4 velocity texture; mirror u_r and u_θ across the axis like `sampleCpuField`.
   - Dawn test: the GPU step must match the TS step on the MOCK raster.
   - Render: instanced, camera-facing streak quads along `velocity3D`, length ∝ |u| dt_visual, additive or soft-alpha, `particleAlpha`.
   - Seed zones: upstream disc, bypass and core inlet, from the flowpath (`geo.walls`).
   - Time dilation: dt_visual = dilation × dt_frame, with a UI control. Something like 1/200 at takeoff, so 300 m/s reads as about 1.5 m/s.
2. Solver textures: `GpuFlowSolver.fields()` returns GPUTextures on the same device. Wrap them with three's ExternalTexture (tests/browser/interop.test.ts already does this) instead of the DataTextures. Then re-run the browser test with `source: 'solver'`.
3. Data colours after tone mapping. The cut plane currently goes through AgX, so its colours are desaturated against the legend LUT (see `cutaway.png`: pale yellow). Draw it in an overlay after `outputColorTransform`, or apply the inverse; the legend must match the pixels.
4. Legend (UI overlay, the `dataviz` skill): a gradient from `bakeLut`, `niceTicks(spec.min, spec.max, 5)`, the unit, and a 'MOCK' or 'solver' badge.
5. Schlieren and haze:
   - Schlieren: screen-space |∇ρ| of the ρ gauge texture, raymarched through the axisymmetric field along the view ray. It needs ρ = ρ∞(1 + g) and Gladstone–Dale K from optics.ts, shown on a grey map.
   - Haze: offset the background UV by `hazeDeflectionRad` × (distance to the background) / (px per rad), only in the plume (far extent).
6. Blackbody glow: emissive on the nozzle, plug and LPT exit from the cycle's T5, plus a stated cooling offset for the HPT. Use `blackbodyLinearSrgb` × `blackbodyLuminance` × the camera exposure; it is physically dim below about 900 K. Keep it restrained.
7. Timer and budget:
   - Add a `flow` pass group to `src/gpu/passTimings.ts` RULES (name the passes "Flow ..."). Measure back to back (D4-42) at the default preset; ≤ 2 ms is required.
   - Check P4 unchanged with the flow mode off, and that the scheduler (`src/flow/gpu/scheduler.ts solverBudgetMs`) gets the measured visuals ms.
8. Polish: fade the plane beyond the nacelle (r > about 1.2 m) with alpha hash and TRAA, so the far-field slab does not cover the studio. Add a "What's simulated" data entry from `FLOW_VIZ_MODES`.

GOTCHAS
- vitest 5 browser: import `commands` and `page` from `'vitest/browser'` (not `@vitest/browser/context`). `commands.writeFile(path, b64, 'base64')` paths are relative to the project root. `page.screenshot` captures the whole runner UI, so it is not used.
- `src/thermo/gas.ts gamma()` throws outside 200–3500 K: the Mach LUT spans 200–2400 K.
- The cut plane is at the wedge faces, not the wedge centre: the centre faces the camera edge-on (the wedge opens toward the camera).
- On screen, Mach uses γR(T) of air, with FAR ignored; `deriveQuantities` uses FAR. The difference is about 1 % in the core jet. Either bake a 2D LUT or label it.
- `node_modules` and the mesh come from `npm ci && npm run mesh`, done in this worktree. Dev port 5193 was not used, and no server or Chrome is left running.

GATES (WIP; numbers in the final reply / below)
- npm run typecheck: clean. eslint on the touched files: clean.
- tests/unit/flow/viz: 36 passed. tests/browser/flowViz.test.ts: 1 passed (0 WebGPU errors).
- Full lint, coverage, test:mesh, test:gpu, test:browser: see the commit that updates this section.
- Indicative visuals ms: not measured (no flow pass group yet; NEXT 7). The cut plane is one full-screen-ish quad pair with 3 texture reads per pixel, expected well under 0.5 ms.
