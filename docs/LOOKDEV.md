# Look-dev (W1 geometry + look-dev round)

The procedural engine (`src/geometry`) rendered by the look-dev view (`src/render`) in a procedural product-shot studio (D3-1). Run it with `npx vite --port 5184 --strictPort` (not `npm run dev`, W1M-N1) and open `/lookdev.html` (`?preset=<id>&clean=1&shutter=<deg>&quality=test&profile=performance`; keys 1-8 presets, `c`/`e`/`r` modes, `t`/`g` throttle, `p` the GPU pass overlay, `q` the render profile). The spools turn at N1/N2 from the **MOCK** cycle (`src/mocks/mockCycle`), with the definition's rotation sign.

## Screenshots (`docs/look-dev/`, 1920x1080, Chrome 155, Arc 140T)

Regenerate with `node tools/lookdev/capture.ts --no-timing` (own headed Chrome through Playwright, viewport 1920x1080 DPR 1, 90 frames per preset, one per animation frame so TRAA converges; JPEG q92). The pre-round shots (round 4's) are in `docs/look-dev/before/` (same names) for comparison.

| File | Preset | What it shows |
|---|---|---|
| `00-hero.jpg` | `hero`, idle, 1/500 s, depth of field + bloom | Low three-quarter product shot of the intake: satin nacelle, brushed lip, the fan disc and the painted spinner |
| `01-three-quarter-front.jpg` | `threeQuarterFront`, idle, 1/1000 s (the default) | The closed engine on its wheeled transport stand on the cyclorama, the spinner stripe, key shadow and contact shadow |
| `02-side.jpg` | `side`, idle | Profile: the satin skin's softbox highlight, panel joints, core cowl with exhaust stain, the dull heat-stained core nozzle and plug, the stand (casters, tow bar, pads, tied posts) |
| `03-cutaway.jpg` | `cutaway` | 100 degree wedge: red-orange hatched section caps, fan case, splitter, booster, fan-frame struts, HPC, combustor liner and dome, HPT/LPT, TRF struts, shafts |
| `04-exploded.jpg` | `exploded` | Modules slid apart in flow order; the fan case slides forward with the intake so the fan shows; per-part floor shadows |
| `05-fan-idle.jpg` | `fanIdle`, 1/1000 s | 24 wide-chord blades overlapping at the tip, the dark gaps toward the spinner, 6.4 degrees of blur |
| `06-fan-takeoff.jpg` | `fanTakeoff`, 1/1000 s | 30 degrees per exposure, 8 time copies: the fan reads as a smooth disc, no blade-edge teeth at the hub |
| `07-hot-section.jpg` | `hotSection` (cutaway close-up) | Combustor liner and dome, HPT and LPT disks and blades (10 span sections), heat tint graded along x, TRF struts, plug |

## Flow visuals (w2/flowviz round 2: the air made visible)

Run the look-dev page with `?flow=realistic|cutaway|schlieren|data` (`&field=solver` draws the live GPU solver, `&dilation=200` the slow motion, `&domain=full` the uncropped plane); keys `f` (mode), `[` `]` (slow motion), `m` (cut-plane quantity), `n` (crop). The flow panel (top left) shows the mode, the slow-motion factor, the cut-plane quantity, where the field comes from (an amber MOCK badge or a green live-solver one) and the flow visuals' GPU ms; the legend (bottom right) is drawn from the cut plane's own LUT stops. Every layer is derived from the bound field (PHYSICS.md 1); nothing is synthesized.

| File (`docs/look-dev/flow/`) | What it shows |
|---|---|
| `ui-realistic.jpg` | Realistic at the default view, take-off MOCK field: tracer streaks drawn into the intake and leaving the nozzles, ×1/200 |
| `ui-data.jpg` | Data (Mach on viridis) on the cutaway faces, laser-sheet tracers on the faces, the legend |
| `ui-schlieren.jpg` | Knife-edge schlieren (a/f 500 µrad), side on: the hot core jet's shear layers (light above, dark below), the bypass layer, the intake; the engine a silhouette |
| `ui-solver-cutaway.jpg` | The live `GpuFlowSolver` field (130k cells) on the cut plane, labelled as the solver. It runs from the solver's timing start state, not an engine solution (the coupling's body forces are W3's) |
| `realistic.png`, `cutaway.png`, `schlieren.png`, `data.png` | The browser test's frames of each mode (960 × 540, MOCK) |
| `solver-data.png`, `solver-cutaway.png` | The browser test's frames on the live solver field |
| `glow-hotsection.png` | The hot section at take-off: the HPT/LPT airfoils' blackbody glow (a faint warm lift, physically dim) |

Not done or not right yet: the MOCK field's inflow ahead of the lip converges about ten times faster than continuity allows, which piled tracers on the axis, so the intake tracers are born inside the lip; the haze is a mean-field refraction (3006 of 518400 pixels change side on: physically about a pixel), so there is no shimmer; particles live in the near field only (they fade out at x = 5 m); the cinematic (depth-of-field) presets draw no flow layer.

## Look-dev round 5 (w2/lookdev-5: W2L-I1..I5, P4's last 0.5 ms, the pass-8 visual notes)

All eight shots (00-07) were regenerated at the end; the round-4 set is in `docs/look-dev/before/`. Every timing below is **indicative**: back to back (D4-42's measure), paired and interleaved, a reference builder's CPU tests on the machine, never the official D0-1 run.

### The measurement tools (W2L-I2..I5, D4-42, D4-46)

- **W2L-I2, only VALID runs:** `abSummary` drops a pair with an INVALID side and records the repetitions it used and dropped (no valid pair gives NaN, never a number); `combineValid` gives a config's medians over its valid runs only (`runsUsed` in `timings.json`); `p4Verdict` is INVALID when a default back-to-back run is INVALID.
- **D4-42 in `p4Verdict`:** back to back is the measure of record, vsync is judged beside it but does not decide; official only under D0-1's protocol with the OS power source on AC throughout; the GPU busy fraction is reported beside the number (`results.P4.gpuBusy`). The capture exits 1 on FAIL or INVALID.
- **W2L-I3, the rAF watcher:** the interval still open when the run stops is pushed (an occlusion that lasts past the end shows as the occlusion signature), and a watcher that ticked fewer than `MIN_WATCHER_COVERAGE` = half the run's display intervals makes the run INVALID (measured: 605 ticks in a 10 s back-to-back run at 60 Hz).
- **W2L-I4, the OS power source:** `tools/lookdev/os.ts` reads Win32_Battery before and after every run in `capture.ts` and `ab.ts` (and in `conditions`); `powerValidity` makes a run on battery INVALID for an official result and a warning otherwise; an unreadable source is never AC.
- **W2L-I5 (D4-46):** blurs are counted in `timeRun` and passed as D3-6's `pageBlurs` at both pacings; the watcher's INVALID is D3-6's occlusion signature, its 2.5-interval stretch a warning.
- The pure parts are pinned in `tests/unit/lookdev/timing.test.ts` (12 new cases, among them the pass-8 failure scenarios: the official A/B's INVALID rep 0, an occlusion until after the end).
- **`tools/lookdev/variantAb.ts`** (new): the paired back-to-back A/B of two query-string variants of this tree on one Vite server (`abOrder`, `pacedValidity`, `abSummary`); how each P4 cut was judged.

### W2L-I1: a rotor-motion test that fails without the motion vectors

`tests/browser/rotorMotion.test.ts` gets a second test. The velocity debug view is now linear and signed (`post.ts`: red/green 0.5 + velocity in px / 64, blue the visible-rotor flag), so it reads back exactly. After one moving frame, the earlier TRAA-off still sampled at u - v(u) must match the later still at u wherever the rotor's image moved (a displayed change of 16/255 at zero vector; drums and disk faces turn into themselves): the shipped vectors' warp error at most 0.6 of both the zero and the flipped vector's. Measured (cutaway close-up, shutter 0): shipped 27.1 against zero 54.9 and flipped 58.7 /255 (7359 moved pixels). Both controls run on the shipped resolve and fail it: `noRotorMotion` 73.4 = 73.4, `rotorMotionScale: -1` 59.4 against 27.4. Over every rotor pixel the first measurement did not separate (shipped 7.1, zero 8.1), so the moved-pixel selection was added after it; the 0.6 ratio was not changed. The critic's other suggestion, moving TRAA against TRAA converged at rest, was measured and could not see the vectors either (2.3 % of pixels changed with them, 2.3 % without): with our resolve's tight clip, a kept history and a clipped one look alike at that pose, which is worth knowing about what the vectors buy.

### P4: the scene pass writes colour and depth only

The opaque pass is fragment- and bandwidth-bound (round 4), and it wrote three rgba16float targets per sample: colour, the view normal for GTAO and the velocity for TRAA. Both extras are in the depth already:
- GTAO reconstructs the normal from the depth (three's GTAONode without a normal node);
- TRAA's velocity at a scene texel is the camera's reprojection of the depth's world point, unprojected with the unjittered view-projection, so a still camera gives exactly zero, as three's velocity node does. It is computed in the same per-texel load as the rotor motion vectors (no pass). The main pass is static except the exploded and cutaway transitions, which now reproject as the camera alone (TRAA's variance clip handles them, as it did any moving object).

`?gbuffer=legacy` keeps the old targets for the A/B. `node tools/lookdev/variantAb.ts --b gbuffer=legacy --reps 4` (default view, back to back, every run VALID, busy 69-72 %): **7.87 against 8.68 ms, paired -0.76 ms** (-0.15, -1.25, -2.28, -0.28), opaque **-0.78**, rotors -0.00, GTAO +0.03, TRAA -0.04. No other candidate was needed for the 0.5 ms: the rotor pass, TRAA's resolve and the composite/output merges are untouched (GPU_FACTS M48).

Quality: GTAO's reconstructed normal differs from the stored one only at depth edges, at half resolution, under TRAA; no difference shows in the shots, and the pixel tests (every preset, fan blur, equalDepth, culling, rotor motion) pass at their unchanged bounds.

### HEAD against main 0bb473f, back to back (indicative)

`node tools/lookdev/ab.ts --refs ba76d17,0bb473f --preset <p> --pacing back-to-back --warmup-s 4 --run-s 10 --reps 3` (`docs/look-dev/ab-ba76d17-0bb473f-<preset>.indicative.json`; every run VALID, AC before and after every run, busy 70-75 %). This session ran slower than the official one (main's default 10.18 here against 8.50 official), so read the paired differences, not the levels:

| view | main 0bb473f | HEAD ba76d17 | paired (3 pairs) | opaque | rotors | GTAO | composite | TRAA | output |
|---|---|---|---|---|---|---|---|---|---|
| default | 10.18 ms | 9.38 ms | **-0.86** (-1.21 -0.15 -0.86) | 4.92 -> 4.01 (-0.80) | 1.44 -> 1.46 | 1.04 -> 1.10 | 0.87 -> 0.91 | 1.23 -> 1.29 | 0.32 |
| cutaway | 10.84 ms | 9.62 ms | **-0.89** (-1.64 -0.89 -0.87) | 6.57 -> 5.34 (-1.15) | 0.92 -> 0.93 | 0.95 -> 0.98 | 0.70 -> 0.69 | 1.12 -> 1.11 | 0.31 |
| hero | 13.09 ms | 11.94 ms | **-0.81** (-0.79 -1.27 -0.81) | 5.02 -> 4.03 (-0.92) | 1.47 -> 1.59 (+0.13: 8 fan copies) | 0.87 -> 0.91 | 0.90 -> 0.92 | 1.23 -> 1.03 | 0.51 |

If the default's saving carries over to the quiet official run, P4 would read about 7.6-7.8 ms back to back (8.50 - 0.76..0.86), under 8.0; the official D0-1 run decides (handoff NEXT 1). That is about 0.8 ms more for the flow solver's frame budget (D4-67: roughly +0.5 it/frame).

### The visual notes (critic pass 8)

- **The matte nacelle:** a satin topcoat, roughness 0.27 -> 0.15 and the white a touch darker (0.78 -> 0.75), so the softboxes' long highlights read on the skin (02, 00). No clear coat: the nacelle skin is the costliest surface (round 4: about 2.5 ms), and a second lobe would have spent the P4 cut.
- **The stippled moving fan, 06 regressed (W2L-N5):** 8 fan time copies are built and the count follows the exposure (`fanTimeCopies`, `src/geometry/motion.ts`, unit-tested): 6 within half a blade pitch of blur (the default view at idle, 6.4 degrees, so P4 keeps its cost), 8 beyond (the hero at 1/500 s, take-off at 1/1000 s). 06's dot screen is gone (as in the round-3 set); 00's lower half is smoother. 05 is unchanged (6 copies at 6.4 degrees).
- **The spinner stripe in 01 (W2L-N4):** the white paint's bounce-light lift 0.085 -> 0.2 and the stripe wider at the nose (half width 0.14 + 0.3 s rad): it reads in 01, 05 and 06 at this capture's phase.
- **The toy-like stand:** an engineering transport stand (`src/geometry/stand.ts`, TDD): a frame of 100 x 80 mm tube 1.24 m wide (wider than the posts, so it would not tip) on four swivel casters with safety-yellow forks, cross members under each saddle, each pair of posts tied across at mid height, 10 mm rubber pads between the saddles and the skins, a yellow tow bar ahead; satin blue-grey shop paint instead of flat black. The floor is fixed by the studio, so the frame rides low (the fan-case saddle sits nearly on it).
- **The flat cutaway:** the section caps are a glossier enamel (roughness 0.6 -> 0.36), so the softboxes put a gradient across the large flat faces, with section shading (the faces deep inside, at small radius, down to 0.62 of the cases'), and the interior parts' cavity occlusion deepened (compressor/turbine cases 0.5 -> 0.42, drums 0.4, disks and shafts 0.38, the liner 0.4).
- **Pass-8 nits:** W2L-N1 done (round 4's "P4 cuts" list no longer claims the GTAO cut); W2L-N4 and N5 done above; W2L-N3 recorded (back to back measured 69-72 % busy again, the CPU time per frame not split out); skipped: W2L-N2 (the cutaway pose's 1-tile margin; this round's run gave 36 against the bound 37 and the close-up 8-9 against 8, so the old bound flaked once at the edge here, see the handoff), W2L-N6 (culling's timeout), W2L-N7 (`optimizeDeps`), for time.

### Still CG-like / not done

- The nacelle is satin now but still a clean axisymmetric shell: no clear-coat depth, stencils, flattened lower cowl or chine; the doors and latches read as drawn outlines.
- The moving fan at idle (05) keeps its torn slivers where the booster shows through; 6 copies at idle remain a noisy per-frame estimate.
- The stand is credible in silhouette but plain: no bolts, mount adapters or the engine's own mount points; the frame rides low because the floor is fixed.
- The cutaway is deeper in tone, but the blades and vanes are still simple shells and the combustor a lumpy tube; 07 keeps its speckle; no rotor AO or self-shadow.
- 04 (exploded): the parts still float without a fixture.

## Look-dev round 4, part 2 (w2/lookdev-4 resumed: D4-24, P4, W1V-I1 fix b, the visual notes)

All eight shots (00-07) were regenerated at the end; the part-1 set is in `docs/look-dev/before/`. Every timing below is **indicative** (the critic's tests shared the GPU; interleaved, paired runs only), never the official D0-1 run.

### The measurement (D4-24)

- **Back-to-back pacing** in `tools/lookdev/capture.ts` (`--pacing both | vsync | back-to-back`, default both): each config runs at vsync (one frame per animation frame, as the app) and back to back (the next frame submitted as soon as the GPU has taken the previous ones, two queued; warm-up included), the same per-pass medians, ids of the back-to-back runs ending in `[back to back]`. P4 is printed per pacing and passes only if both do (until the critic confirms the DVFS evidence). Back-to-back runs also record frames per second and the GPU busy fraction (the timed passes' share of the wall time; a warning under 60 %). Each run's render scale and GPU error count now go into `timings.json` too (W1V-N1), and the JSON is Prettier-formatted when written (W1V-B1). The pure parts (`withPacings`, `backToBackLoad`, `pacedValidity`, `p4Verdict`, `abOrder`, `abSummary`) are unit-tested in `tests/unit/lookdev/timing.test.ts`.
- **The two-commit A/B** (`tools/lookdev/ab.ts`): detached checkouts under `.claude/worktrees/ab-<sha7>` (own `npm ci`), the page harness (`src/lookdev/main.ts`) made identical on both sides, a Vite server each, one headed Chrome; per repetition one adjacent pair per pacing, the side that goes first and the pacing that leads alternating; the result is each side's median and the paired differences a - b per pass; the checkouts are removed afterwards. The official command (the orchestrator, in a quiet window, about 15 min plus two `npm ci`):

```
node tools/lookdev/ab.ts --refs bad7ad0,23239a1 --warmup-s 10 --run-s 60 --reps 3
```

  (writes `docs/look-dev/ab-bad7ad0-23239a1.json`; `--port 5186` and 5187 by default).
- **Regression verdict (indicative): bad7ad0 did not regress the default view.** `ab.ts --refs bad7ad0,23239a1 --warmup-s 4 --run-s 10 --reps 4` (`docs/look-dev/ab-bad7ad0-23239a1.indicative.json`), paired bad7ad0 - 23239a1: vsync opaque **-0.64 ms** (every pair negative: -0.62, -0.29, -0.66, -0.83), rotors +0.12 (+0.06, +0.31, -0.03, +0.17), GPU total -0.69; back to back opaque **-0.96 ms** (-0.81, -0.56, -1.10, -1.75), rotors +0.01, total -0.82. The official run's 5.59 -> 6.29 ms opaque and 1.36 -> 1.87 ms rotors were between two sessions (D3-7 and D4-24 result), not a change in the code; the shading cuts of part 1 did save opaque time, more of it back to back than at vsync.
- **The DVFS evidence, same commit, same page:** bad7ad0 at vsync 10.79 ms against 9.75 ms back to back (opaque 5.20 against 4.30); the vsync runs are bimodal inside a run (p10 8.2-9.7, p90 14.3-15.6 ms) while the back-to-back ones are tight (p10 8.5-9.3, p90 10.8-13.2). The same frame takes longer when the GPU has idle time each frame, which is the clock following the load.

### P4 cuts (where the measurements point)

- **TRAA resolve** (`src/render/traaResolve.ts`, installed into three's TRAANode, its history, jitter and copies kept): the closest-depth search and the variance clip over the 4-neighbour cross (5 taps) instead of 3 x 3 (9), the history read with a 5-tap Catmull-Rom filter (sharper under reprojection, see W1V-I1).
- **Opaque:** the fine noise lookups that are sub-pixel in every shot but the closest are evaluated only where their fade is non-zero (the lip's 5.5 mm buffing grain, the fan's 4 mm grain), with the filter width computed before the branch (WGSL uniformity); the nacelle's latch, door and fastener outlines are evaluated only near them (the skin's footprint taken once); its wipe streaks per vertex.
- **Fan time copies** 6 instead of 8 (TRAA now accumulates the fan's instants across frames as well). (GTAO 6 samples with the noise rotated every frame was tried and reverted: W2L-N1.)
- Indicative result: indicative, `ab.ts --refs dad5570,bad7ad0 --warmup-s 4 --run-s 10 --reps 4` (`docs/look-dev/ab-dad5570-bad7ad0.indicative.json`, every run valid; dad5570's render code is HEAD's plus the reverted blade-cavity multiply in two blade materials), the default view:

| pacing | bad7ad0 (part 1) | this round | paired (4 pairs) | opaque | rotors | GTAO | composite | TRAA | output |
|---|---|---|---|---|---|---|---|---|---|
| back to back | 8.25 ms | **7.49 ms** | -0.46 (-0.60 -0.32 -1.09 -0.16) | 3.96 -> 3.49 | 1.19 -> 0.99 | 0.77 -> 0.72 | 0.72 -> 0.72 | 1.06 -> 1.08 | 0.28 |
| vsync | 10.49 ms | **10.71 ms** | -0.54 (-0.89 -0.55 -0.54 +0.99) | 5.55 -> 5.09 | 1.66 -> 2.00 | 1.00 -> 1.11 | 0.84 -> 0.91 | 1.17 -> 1.25 | 0.39 |

  Back to back the default view is under 8 ms here; at vsync it is not (the vsync rotor pass rose 0.35 ms in the pairs while it fell 0.16 ms back to back: not understood; the vsync runs are bimodal, p10 7.1-8.1 against p90 12.8-16.6 ms). Earlier pairs in this session: 1f8de34 - bad7ad0 -1.28 ms back to back (3 pairs, opaque -0.80), a run whose later vsync half was INVALID (occluded window) taught the back-to-back runs their rAF watcher. **P4 as pre-registered (must pass both ways until the critic confirms the DVFS evidence) is not shown to pass**; back to back alone it would, indicatively.

### W1V-I1 fix (b): the cut fan reads while the spools turn (D4-4)

- **Rotor motion vectors** (`src/render/post.ts`): a rotor turns rigidly about the engine axis, so a rotor pixel's previous position is exact: the rotor depth's world point turned back by its spool's step (LP or HP, from the rotor MRT's alpha) and projected with the previous frame's unjittered view-projection. The step is wrapped to half the row's blade pitch (the spinner's is a full turn): at idle the fan turns 107 degrees a frame, about 7 pitches plus 2.4 degrees, so the history comes from the next blade along, a few pixels away. TRAA reads its velocity at one texel per pixel, so the rotor velocity is computed in that read and costs no pass. The rotors' depth also joins TRAA's current depth (its closest-depth search and disocclusion test), and our resolve's Catmull-Rom history keeps the thin dark gaps between stacked blades that bilinear resampling blurred away in motion.
- **The test** (`tests/browser/rotorMotion.test.ts`, the critic's probe made a test; bound stated before the fix: moving tiles at most the held-still floor + 6): cutaway 32 -> 37 (bound 38), cutaway close-up 2 -> 8 (8), exploded 4 -> 4, exploded close-up 7 -> 9, hotSection 0 -> 0. Negative control, the pre-fix pipeline (`legacyTraa`: three's resolve, zero rotor velocity): close-up 1 -> 34 tiles. (The first control was zero velocity alone; with our resolve's tighter clip that no longer ghosts, 8 tiles, because it throws the history away instead of averaging it.)
- **The fan blur shipped in motion** (`fanBlur.test.ts`, pass 6: the app never holds the fan still): 48 frames at dt 1/60, then against a 64-still reference at the final phase, the same bound as at rest. Measured (6 time copies): fanIdle shipped at rest MAE 0.0051 / worst tile 0.053, in motion 0.0061 / 0.064; hero 0.0041 / 0.028, in motion 0.0058 / 0.036; fanTakeoff 0.0043 / 0.043, in motion 0.0053 / 0.051 (bound 0.012 / 0.13). With 8 copies and the motion vectors, at rest: fanIdle 0.0047 / 0.045, hero 0.0043 / 0.030; part 1 (no motion vectors): 0.0058 / 0.061, 0.0043 / 0.031.
- Not done: rotor AO and rotor self-shadow (see "Still CG-like").

### The visual notes and pass-6 nits

- **The floating engine (W1V-N5):** it rests on a transport-stand cradle (`src/geometry/stand.ts`, pure and unit-tested; `createStandMesh` in studio.ts): a saddle under the fan cowl over the fan case and one under the core cowl aft of the nacelle, each on two posts from a floor frame, satin charcoal, casting into the key's static map; it goes with the cowls in the exploded view.
- **The chrome-bullet plug (W1V-N5):** the plug and core nozzle are oxidised and dull (metalness 0.45, roughness 0.58-0.83), darker aft toward the tip, with flow streaks (per vertex).
- **The spinner spiral in shadow (W1V-N5):** a faint lift of the white paint stands in for the light the white intake walls bounce onto the spinner (the image-based light has no visibility), so the stripe reads at every phase.
- **The torn moving fan:** the rotor motion vectors let TRAA average the fan's instants across frames (shipped fanIdle MAE 0.0058 -> 0.0047, worst tile 0.061 -> 0.045 at rest).
- Pass-6 nits: W1V-N1 run scale and errors in timings.json (done), W1V-N3 TRAA internals asserted (done, post.ts and traaResolve.ts). Skipped, with reasons: W1V-N1's render-scale cost model and its "TAA upsampling" wording (the performance profile was not touched); W1V-N5's doors (flush step, fastener ring), 04's framing and 07's speckle; W1V-N6 more presets at `high` in the tests (time). W1V-N2's "fill-bound" comment stays: this round's measurement supports it (the opaque pass is fragment-bound).

### Still CG-like / not done

- **P4 is not shown to pass** by these indicative numbers (see the cuts above); the official runs decide (handoff NEXT 1).
- **The cutaway fan at 03's framing** is seen nearly edge-on, so the stacked blades still read as a smooth band at that distance; up close (the test's close-up) they are separate, crisp blades now. No rotor AO (GTAO on the rotor depth) and no rotor self-shadow. A baked blade cavity (darker toward the root and over the overlapped aft chord) was tried and reverted: it failed engineView's centre-contrast check for fanIdle (not loosened) and did not separate the edge-on blades at 03's distance.
- **The moving fan** (00, 05): the far side still shows torn slivers where the booster shows through the gaps, and 00 keeps a stipple in its lower half; TRAA now averages the instants across frames, but a 6-copy frame is still a noisy estimate.
- The stand is a plain charcoal cradle: no pads, bolts or wheels; the nacelle is still axisymmetric (no flattened lower cowl, chine or drain mast); the doors still read as drawn outlines.
- GTAO was not cut (its per-frame rotation broke the hero fan-blur bound).

## Look-dev round 4 + LOD (w2/lookdev-4, D4-2, D4-4, D4-5)

PARTIAL: the measurement, the first shading cuts, the fan's cut rule and the exploded spool stop. P4 is not reached by the indicative numbers; W1V-I1 fix (b), W1V-I3 and the visual notes are not done (see the handoff). All eight shots (00-07) were regenerated; the round-3 set is in `docs/look-dev/before/`.

### P4 (pre-registered first, PHYSICS 3.4 and thresholds.ts)

P4: the render GPU time (engine plus post, excluding the solver and flow visuals) at the default preset, 1080p, default three-quarter front view, at most 8.0 ms median under D0-1; the cutaway and hero are reported against 10 ms, not gated. The official measure is the D0-1 set, and `capture.ts` now prints and records the verdict (`results.P4` in `timings.json`; marked indicative unless the run used at least 10 s warm-up, 60 s runs and 3 reps):

```
npx vite --port 5184 --strictPort
node tools/lookdev/capture.ts --only none --warmup-s 10 --run-s 60 --reps 3 --seed 1
npx prettier --write docs/look-dev/timings.json
```

### Drawn triangles per view (W1V-I2, D4-5)

`stats()` now counts only what the camera draws (the layer-2 shadow proxies are skipped) and reports the main pass, the rotor pass and the fan's depth pre-pass apart, plus draw calls; `node tools/lookdev/capture.ts --counts --no-timing` writes `docs/look-dev/triangles.json`. At `high` (unchanged by this round: no geometry changed):

| view | drawn (M) | main | rotors (incl. the 8 shaded fan copies, 0.219) | + fan depth pre-pass | draws |
|---|---|---|---|---|---|
| threeQuarterFront, hero, fanIdle, fanTakeoff | 1.259 | 0.822 | 0.438 | 0.219 | 63 |
| side | 0.679 | 0.442 | 0.237 | 0.219 | 31 |
| cutaway, hotSection | 1.588 | 1.139 | 0.449 | 0.027 (shutter 0: copy 0 only) | 186 |
| exploded | 1.264 | 0.815 | 0.449 | 0.027 | 84 |

This restates the pass-6 probe: front 1.06 M with one fan copy (1.259 - 7 x 0.027) plus 0.41 M of fan-copy vertex work (the pre-pass and the 7 extra shaded copies), side 0.48 M plus the fan, cutaway 1.58 M.

### What the opaque pass pays for (measured, not assumed)

`node tools/lookdev/opaqueCost.ts --saturate` (new): A/B configs on one page, each timed right after the default (paired, every frame of a 0.6 s run kept, the median of 5-10 rounds), with the debug flags `flat` (one unlit material for the whole main pass), `flatNames` (that material on matching meshes), `skinsOnly`, `hide` (a regex on `main:`/`rotors:` names). Indicative: another builder was using the GPU throughout (identical configs varied by up to 2x between runs; the paired differences are the reliable part).

- **The opaque pass is bound by its fragment shading, not by triangles.** With every main material replaced by an unlit one it falls from about 6 ms to about 1 ms (saturated: -4.9 to -6.3 ms). Hiding every main-pass blade row (0.33 M triangles) saves 0.6 ms or less, culling off is within the noise, and drawing only the nacelle and core-cowl skins costs as much as the whole engine. At 960 x 540 the pass falls by half or more.
- By part (saturated, paired): the nacelle skin about 2.5 ms, the inlet lip (the solid includes the whole inner barrel) about 1.4 ms, the cyclorama about 0.8 ms, the key's shadow lookups about 0.5 ms, the core cowl about 0.1 ms, everything that is not a skin about 1.8 ms.
- **Why the D3-7 run saw a geometry-bound pass: the GPU clock follows the load at vsync pacing.** One frame per animation frame leaves the Arc iGPU idle for most of each 16.7 ms, and its clock drops with the work: at vsync the performance profile changed the opaque pass by +0.4 ms (the official run: 5.59 -> 5.64), saturated (frames back to back, `timeRun(ms, true)`) by -1.6 ms; the flat main pass saved 5.1 ms of opaque but only 3.1 ms of total at vsync (the other passes slowed), 8.1 ms saturated. So the GPU ms of a vsync-paced run understate any saving, which matters for P4 (orchestrator: see the handoff).

### What changed

- **Shading cuts (the measured lever):** the nacelle's orange peel is gone (two noise lookups per pixel; no shot resolved it, pass 6); the low-frequency noise (nacelle tone and gloss, the lip, the fan case, the core-cowl stain, the heat tint, the plug soot) is evaluated per vertex and interpolated (`perVertex`, periods well above the vertex spacing); the nacelle's oil canning is a per-vertex tilt of the normal (central differences in the object frame, smooth across triangles) instead of a per-pixel derivative bump; the lip has no anisotropic lobe (roughness 0.42 instead of 0.34 stands in for it; at 0.34 without it the band read as chrome again). Saturated, paired against the round-3 materials (3 alternating pairs): **default opaque 6.09 -> 4.95 ms** (median; 5.80-6.53 -> 4.82-5.04), the main materials' cost (default minus flat) 4.9-5.4 -> 3.7-4.0 ms. Estimated against the official run: about 10.2 -> 9.1 ms, so **P4 is probably not met yet**.
- **No geometry LOD:** the measurements say triangles are not what the default view pays for, so per-row blade LOD and row culling would not move P4; they stay available (the culling pixel test is the acceptance harness) if a later measurement says otherwise.
- **The fan's cut rule (W1V-I1, part):** in the cutaway only a fan blade wholly inside the wedge is hidden (`bladeHidden(..., 'inside')`, mirrored in `bladeHide`; the pre-pass and the shaded copies share it, as EqualDepth needs), so the blades at the cut faces keep their profile instead of the 8 nearest vanishing.
- **The exploded engine stops (D4-4):** `spoolDisplayFactor` eases the displayed spool speeds to a stop over `SPOOL_STOP_S` = 1 s (smoothstep in a linear progress, exact over any frame step) and back up when the view closes. The cutaway keeps the running engine (D4-4).

### Still CG-like / not done

- **The cutaway fan still does not read (03):** the spools turn and the rotor pixels still enter TRAA with zero velocity, so the blades are ghosted; fix (b) of W1V-I1 (rotor motion vectors) is the next step, then rotor AO and self-shadow.
- The visual notes are untouched: the moving fan's torn far side, the spinner spiral in shadow (it shows in 01 only at some phases), the floating engine, the plug as a uniform bright ogive.
- The lip is slightly smoother than round 3's brushed band (isotropic lobe).

## Look-dev round 3 (w1/lookdev-3)

All eight shots (00-07) were regenerated at the end of the round; the round-2 set is in `docs/look-dev/before/` (00-07, same names).

### Rotor pass and the render budget

- **The fan is shaded once per pixel, not once per time copy.** The 8 time copies stay (the estimator, its per-pixel pick and the composite's 3 x 3 average are unchanged), but the pick now happens in a depth pre-pass with a trivial shader, and the shaded copies draw at `depthFunc = EqualDepth` with no discard, so only the picked copy's front fragment is shaded (GPU_FACTS M43: a WGSL discard saves no shading on Dawn, which is why 8 copies had cost 8 shaded fans).
- **Fan loft 13 x 23 at `high`** (was 25 x 45; the chord points are cosine-spaced). At the default view the old fan's triangles were a few pixels each and the pass paid for quad overshading; no visible difference at `fanIdle` (side-by-side crops).
- **The composite's fan average runs only inside the fan's screen rectangle** (`src/geometry/screenRect.ts`, set every frame from the fan's box): 45 texture reads per pixel were most of its cost.
- **View-dependent closed culling** (`src/geometry/visibility.ts`): inside the core cowl, the booster, transition duct and HPC are drawn only for an eye ahead of the splitter, the LPT, exhaust and TRF only for an eye aft of the first LPT row (the default view no longer draws the LPT; the side view draws neither). The opaque pass turned out to be geometry-bound: it barely changed with the render scale (W1L-N6, GPU_FACTS M42 revised).
- **D3-7 performance profile** (`src/gpu/renderScale.ts`, `?profile=performance`, key `q`): the scene, rotor and composite passes and TRAA at a render scale in [0.75, 0.85] that follows the GPU time (down a step over 8 ms, up a step only when the bigger scale is predicted under 7.2 ms, 120 frames between changes); the output pass upsamples TRAA's result. three r186's TRAA skipped its history depth copy below scale 1 (it then stopped accumulating) and errored on the frame the scale changed; `post.ts` fixes both (GPU_FACTS M44).
- **The fan-blur reference test** (`tests/browser/fanBlur.test.ts`, bounds unchanged; it now writes its numbers to `test-results/fanBlur.txt`): fanIdle estimator MAE 0.0017 / worst tile 0.027, shipped 0.0058 / 0.061; hero 0.0013 / 0.017, shipped 0.0043 / 0.036; fanTakeoff 0.0021 / 0.031, shipped 0.0044 / 0.047 (round 2: estimator 0.0024-0.0033 / 0.072-0.083, shipped 0.0055-0.0067 / 0.081-0.092). The coarser loft and the shading change did not cost accuracy.
- **Not done as asked: the fan blur is not accumulated across frames through TRAA.** At idle the fan turns about 110 degrees (7 blade pitches) between frames, so TRAA's history at a fan pixel is the fan at another phase: with zero velocity it smears the blades into a disc, and a rotational velocity cannot be defined for a semi-transparent smear whose depth changes through the exposure (the gaps show the booster and static vanes behind). Accumulation does work when the fan holds still between frames (the tests render at dt 0, and the 8 copies' R2 jitter resolves through TRAA there). So the cost was cut by shading each pixel once instead of cutting the samples per frame; the per-frame estimate (and its look in motion) is the round-2 one.

Indicative per-pass GPU ms (1080p, `high`, `node tools/lookdev/capture.ts --only none --warmup-s 3 --run-s 5 --reps 2 --seed 1`, 2026-10-26: AC power, Balanced, other agents and a Stryker run on the machine, so NOT D0-1; the medians of 2 runs):

| run | opaque | rotors | GTAO | composite | TRAA | DoF | bloom | output | GPU total | CPU |
|---|---|---|---|---|---|---|---|---|---|---|
| default, round start (8 shaded copies, 25 x 45 fan) | 4.89 | 5.73 | 1.03 | 2.06 | 1.14 | - | - | 0.31 | **15.60** | 4.80 |
| default (`quality`) | 4.98 | 1.22 | 0.80 | 0.82 | 1.09 | - | - | 0.43 | **9.39** | 4.55 |
| default, `performance` (scale settled at 0.75) | 3.86 | 1.02 | 0.57 | 0.59 | 0.73 | - | - | 0.26 | **7.15** | 4.45 |
| `cutaway` | 6.97 | 0.80 | 0.84 | 0.73 | 1.14 | - | - | 0.30 | **10.97** | 6.80 |
| `hero` (DoF + bloom) | 6.30 | 1.65 | 0.84 | 0.91 | 1.11 | 2.24 | 0.57 | 0.50 | **14.27** | 5.65 |

Single short runs in the same session gave the default 8.6-9.6 ms and the performance profile 6.8-7.2 ms. The default `quality` profile stays over 8 ms here; the performance profile is under it (D3-7: the battery default if the quiet AC measure confirms). The official D0-1 set now includes the default in the performance profile (4 configs, about 15 minutes):

```
npx vite --port 5184 --strictPort
node tools/lookdev/capture.ts --only none --warmup-s 10 --run-s 60 --reps 3 --seed 1
```

### Nacelle (W1L-N1)

- **Panels:** inlet cowl (from the bare lip to the fan-case flange), fan-cowl doors and thrust-reverser sleeves left and right, each a slightly different white and gloss.
- **Seams:** 3 mm gaps drawn as shallow grooves (a bevel up close, a dark line far away that keeps a minimum contrast instead of vanishing), the hinge lines either side of the top, the latch line at the bottom with three flush latches on the fan cowl and two on the reverser, an oil-service access door and a pressure-relief door on the camera side, and fastener rows aft of the circumferential joints.
- **Surface:** a two-scale orange peel, a faint skin waviness ("oil canning") that makes the long strip highlights wobble slightly, wipe streaks and lower-skin handling marks in the roughness.
- **Lip:** the bare satin-aluminium band is now the leading edge only (it ends 8 cm aft of the highlight outside, 11 cm inside, at a seam), so it no longer reads as a fat chrome torus; it is rougher (0.34) with a fine circumferential buffing grain and a lighter anisotropy.
- **Elsewhere (cheap nits):** spinner matte (roughness 0.52, so it no longer mirrors the softboxes), fan blades darker in the intake (indirect occlusion 0.52, was 0.62) with shorter anisotropic streaks, the acoustic liner and fan case lighter (they read as holes in the cutaway's shadow, W1L-N2), and a little more chroma in the heat tint.

### Plug (D3-9)

Checked against public data: no published length, base diameter or cone angle exists for the CFM56-7B plug (ENGINE_FACTS "Exhaust plug against public data"). The plug is **not reshaped**: A8, the definition and the mesh are unchanged.

### Still CG-like

- The engine still floats over the floor with no stand or pylon, and the nacelle is axisymmetric (the CFM56-7's flattened lower cowl, the 737NG inlet chine and the drain mast are not modelled). No stencils or placards.
- The fan in motion: each frame is the round-2 nine-sample estimate, so at 1/1000 s idle the far side still shows grain and torn slivers where the booster shows through the gaps (05); the blades are still a little bright inside the intake.
- The cutaway's grey cases keep a fine speckle at close range (07), and the plug reads as a large ogive in section (03).
- In the performance profile the image is visibly softer (a bilinear upsample of TRAA's output, no sharpening).

## Look-dev round 2 (w1/lookdev-2, critic pass 4)

All eight shots (00-07) were regenerated after the culling fix; the pass-4 shots stay in `before/` only for the pass-3 set (the pass-4 versions are in git history at 3dd23f0).

- **Culling (W1L-I1):** the closed view now culls only what cannot show: the combustor, the HPT and the inner body's contents (disks, bores, shafts). Every booster, HPC and LPT row, the transition duct and the fan-frame struts are drawn: the rotors have their own pass, so the main pass's depth reaches past every rotor row, and the HPC shows through the fan and booster gaps. `tests/browser/culling.test.ts` compares culling on and off in pixels over every closed preset plus an axial intake view and a look up the core nozzle, at shutter 0 and two fan phases: no differing 16 px tile beyond the on/on noise floor. The saving is now small (1.52 of 1.66 M triangles drawn at `high`).
- **Rotor lighting (W1L-I2):** the rotor pass's key and rim cast shadows from proxies of the static parts (layer 2, seen by the shadow cameras only), so the fan face is in the nacelle's shadow and lit only through the intake mouth and by the studio's image light.
- **Fan blur (W1L-I3):** the march is gone. The fan is drawn as 8 time copies spread over the exposure (re-jittered every frame); each pixel keeps one copy's fragments (interleaved gradient noise plus a per-frame R2 offset), and the composite averages each pixel's 3 x 3 neighbours' instants, so one frame is a nine-sample estimate that TRAA then smooths. `tests/browser/fanBlur.test.ts` compares against the mean of 64 shutter-0 stills across the exposure, in linear light: estimator mean absolute error 0.002-0.003 (the pass-4 march: 0.07-0.12), shipped frame 0.006-0.007.
- **Timing harness (W1L-I4):** `tools/lookdev/capture.ts` runs the D0-1 protocol (below).

### The quiet official measure (D0-1, D3-7)

On AC power, nothing else running, Chrome in the foreground:

```
npx vite --port 5184 --strictPort
node tools/lookdev/capture.ts --only none --warmup-s 10 --run-s 60 --reps 3 --seed 1
```

About 11 minutes: the default, `cutaway` and `hero`, each 3 runs of 60 s with a 10 s warm-up before each run, in a seeded order rotated per repetition (D2-12). Every frame of a run is kept (p10/p50/p90 per pass); the result is the median of the runs. A run is INVALID on the occlusion signature or a hidden page (D2-11 as amended by D3-6); a slow load is a warning. Power plan, battery state, CPU load, Chrome version and the adapter are recorded at the start and the end in `docs/look-dev/timings.json`. `--diagnostics` runs the A/B set (culling, cyclorama, shadows, post, caps) instead; run it once at `--run-s 20 --reps 1`.

### Indicative timings (2 s smoke runs, NOT D0-1)

From a 2 x 2 s smoke run of the harness on 2026-10-26, on battery with another agent running: the default 14.5 ms GPU (opaque 4.5, **rotors 5.2**, GTAO 1.0, composite 1.9, TRAA 1.1, output 0.3), `cutaway` 13.2 ms, `hero` 18.1 ms. **The rotor pass went from about 1.2 ms to about 5 ms**: the 8 fan copies are each fully shaded before the per-pixel discard. This is the round's main cost and the first thing to reduce (see the handoff's NEXT).

### Still CG-like

- The nacelle is a smooth shell (no latches, hinges, reverser split, drain mast or stencils), and the engine floats with no stand or pylon (W1L-N1).
- The cutaway's liner panels in shadow read as holes, and the hot section is near neutral grey (W1L-N2).
- The plug is still the definition's ogive (D3-9 not done this round).
- At 1/1000 s idle the fan shows a faint residual grain at the blade edges; the 3 x 3 average blurs the fan by one pixel.

## What changed in the look-dev round

- **Studio (D3-1, LD-3):** `src/render/studio.ts`. No HDRI: an environment scene of softboxes (overhead key, two long horizontal strips, rim and kicker strips, a dim fill card, a low front strip) in a dark room, baked by `PMREMGenerator.fromScene` at 512 px per face, so reflections are smooth softbox gradients instead of the 1k HDRI's texel blocks. A visible infinity cove (floor sweeping into a wall all round, Lambert, neutral grey darkening away from the engine), a shadowed key light (2048 PCF map, re-rendered only while the engine moves), a cool rim light, and an analytic contact shadow under the nacelle (faded out in the exploded view). The Poly Haven HDRI and its notice are no longer used.
- **Fan (LD-1):** 25 x 45 sections per blade at `high`; satin titanium brushed along the span, a lighter eroded leading edge and per-blade roughness/colour jitter. Realistic presets use a 1/1000 s still shutter (idle 6.4 degrees, takeoff 30 degrees); 180 degrees remains available with `?shutter=180`. The rotational blur now marches the turned-back view ray through the fan's swept volume (4 jittered axial planes, 8 jittered time samples, only fan-blade hits count) instead of one fan-face plane, which removes the hub "teeth".
- **Nacelle and lip (LD-2):** satin white paint (roughness 0.24, a faint procedural orange-peel normal, faint handling-mark roughness variation), anti-aliased panel joints and fastener rows; the lip is polished aluminium at roughness 0.24 with circumferential anisotropy along the exact revolve tangents (the uv-derivative frame faceted it).
- **Materials (LD-5, V2, V4):** cases matte painted/cast grey (metalness <= 0.3); hot section dull superalloy with a low-chroma heat tint graded along x from the combustor exit; plug and exhaust dull grey (no copper); spinner matte dark with the white spiral; per-blade jitter on every row so highlights break up; liner perforation and composite patterns fade where sub-pixel (V3).
- **Cutaway (LD-4):** caps in one distinct red-orange section family with an anti-aliased 45 degree hatch; a combustor liner with a rounded dome (`linerLoop`); fan-frame hub struts (12) and turbine-rear-frame struts (16) as synthesized rows (`src/geometry/struts.ts`); turbine blades at 10 span sections (V1).
- **Exploded:** the fan case belongs to the intake module and slides forward 0.75 m extra (`INTAKE_LEAD`), clear of the fan; the camera frames the whole 6.2 m spread (V5).
- **Performance (LD-6, W1G-I2):** per-pass GPU timestamps (`src/render/passTimer.ts`, `src/gpu/passTimings.ts`) in the overlay and `lookdev.timeFrames`; closed-engine culling of everything the cowls hide (`src/geometry/visibility.ts`: 0.75 of 1.66 M triangles drawn); depth of field and bloom only in the cinematic preset; GTAO at half resolution with 8 samples; a static shadow map; no clear coat on the large painted surfaces; a Lambert cyclorama.
- **Device (D2-4):** `src/render/gpuDevice.ts` is gone; the view uses `src/gpu/device.ts` (`requestSimDevice`) and `createRendererOnDevice` (core mode checked), destroys the device on any init failure, and awaits `renderer.dispose()` before destroying it. The worker queues messages that arrive during init and posts `gpu-error` as soon as the device reports one.

## Per-pass GPU timings (1080p, `high`)

Measured with `node tools/lookdev/capture.ts` (Chrome 155 with `--enable-unsafe-webgpu`, so timestamps are not quantized; 30 warm-up frames, then the median of 150 frames per run, one frame per animation frame), 2026-10-26 18:05 UTC, recorded in `docs/look-dev/timings.json`. **Indicative only (D0-1 not applied): the laptop was on battery (Balanced), another agent shared the machine, and identical work varied up to ~2x between runs** (the rotor pass ranged 0.64-1.65 ms over the session; the default view's total ranged 9.2-14.2 ms). Read the columns as proportions; the orchestrator's quiet AC window should re-run `node tools/lookdev/capture.ts --only none`. "GPU" is the sum of the timed render passes; "CPU" is the JS time to encode and submit a frame (separately, W1G-I2). The shadow map is static (re-rendered only while the engine moves), so it shows as "-" in steady frames.

| run (all at quality `high`) | opaque | rotors | GTAO | composite (fan blur + AO) | TRAA | DoF | bloom | output | GPU total | CPU | M tris drawn |
|---|---|---|---|---|---|---|---|---|---|---|---|
| default (`threeQuarterFront`) | 6.76 | 1.22 | 1.42 | 1.77 | 1.36 | - | - | 0.45 | **13.02** | 1.30 | 0.75 |
| default, repeated last | 7.35 | 1.39 | 1.59 | 1.82 | 1.44 | - | - | 0.45 | **14.23** | 1.20 | 0.75 |
| default, culling off | 6.06 | 1.26 | 1.12 | 1.42 | 1.18 | - | - | 0.34 | **11.39** | 2.50 | 1.66 |
| default, no cyclorama | 6.88 | 1.41 | 0.74 | 1.76 | 1.45 | - | - | 0.48 | **12.75** | 1.20 | 0.74 |
| default, no shadow lookups | 5.99 | 1.23 | 1.32 | 1.60 | 1.28 | - | - | 0.47 | **12.11** | 1.50 | 0.75 |
| default, scene straight to screen (no post) | 9.24 (one pass) | | | | | | | | **9.24** | 1.70 | 0.75 |
| `fanTakeoff` | 5.40 | 1.50 | 0.80 | 1.57 | 1.01 | - | - | 0.28 | **10.57** | 1.60 | 0.75 |
| `hero` (cinematic: DoF + bloom) | 4.03 | 0.70 | 0.73 | 1.25 | 0.97 | 1.92 | 0.47 | 0.46 | **10.97** | 1.90 | 0.75 |
| `cutaway` | 9.75 | 1.17 | 1.25 | 1.40 | 1.28 | - | - | 0.36 | **15.67** | 3.15 | 1.67 |
| `cutaway`, caps off | 8.16 | 1.16 | 1.03 | 1.20 | 1.15 | - | - | 0.35 | **13.05** | 2.40 | 1.66 |
| `exploded` | 4.52 | 1.18 | 1.70 | 1.84 | 1.51 | - | - | 0.51 | **11.50** | 2.30 | 1.34 |
| `hotSection` | 7.18 | 0.99 | 0.93 | 1.19 | 1.09 | - | - | 0.30 | **11.62** | 2.50 | 1.67 |

The lowest default measured in the session (10:57 local, plugged-in state unknown, before the static shadow map and the cinematic-only bloom) was **9.15 ms**: opaque 4.11, rotors 0.62, GTAO 0.85, composite 1.34, TRAA 1.19, bloom 0.53, output 0.47 (CPU 1.9 ms).

Readings:
- **The ~8 ms budget is not met reliably** at the default preset on this machine in these conditions; it is close in the best run (with bloom, now removed from the default, it was 9.15 ms; without it about 8.6 ms).
- **The opaque pass is about half of the frame and is fill-bound, not triangle-bound:** drawing 1.66 M instead of 0.75 M triangles did not raise it measurably, and the cyclorama and the shadow lookups are each within the noise. Overdraw of the internals was cut by drawing the outer skins first (early depth test) and the cyclorama last.
- The fixed post costs are TRAA (~1.0-1.5), the composite (~1.2-1.8, full-screen setup plus the fan march), GTAO at half resolution with 8 samples (~0.7-1.6) and the tone-map output (~0.3-0.5). Depth of field costs ~1.9 ms and now runs only in the cinematic preset; bloom ~0.5 ms, cinematic only.
- Next levers, in order of expected gain: a quiet AC re-measure first; a reduced-resolution 3D pass for a "performance" quality preset (TRAA as the reconstruction); skipping the composite's fan setup outside the fan's projected bounding box; GTAO at 0.35 scale; profiling the paint shader (procedural noise and the derivative bump) against a baked normal map.

## Still placeholder or wrong

- **Fan blur:** the march approximates the turned ray with the camera's depth buffer; at 1/1000 s idle a few blocky smudges remain at blade edges near the hub on the far side, and booster blades seen through the gaps are not blurred.
- **Synthesized internals:** drums, disks, shafts, case thicknesses, the nacelle shell, the liner, struts (counts 12 and 16) and cavities are plausible proportions, not engine data. No fuel nozzles, swirlers, bleed ducts, accessories, pylon, thrust-reverser cascades, blade fillets, platforms or shrouds.
- **Plug shape** is the definition's hub curve (r 0.305 m at the core lip); only its material changed.
- **Heat tint** is static (permanent discoloration), not driven by temperature. Blackbody emission is W2/flowviz.
- **Studio:** procedural softboxes only; no textured floor, no reflections of the engine in the floor, no pylon or stand.
- **Performance:** see the table: the default preset is near, not reliably under, the ~8 ms render budget on the Arc 140T; the opaque pass (fill-rate bound, not triangle bound: culling 55 % of the triangles did not change it measurably) is the largest item.
