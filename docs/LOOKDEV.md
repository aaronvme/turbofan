# Look-dev (W1 geometry + look-dev round)

The procedural engine (`src/geometry`) rendered by the look-dev view (`src/render`) in a procedural product-shot studio (D3-1). Run it with `npx vite --port 5184 --strictPort` (not `npm run dev`, W1M-N1) and open `/lookdev.html` (`?preset=<id>&clean=1&shutter=<deg>&quality=test&profile=performance`; keys 1-8 presets, `c`/`e`/`r` modes, `t`/`g` throttle, `p` the GPU pass overlay, `q` the render profile). The spools turn at N1/N2 from the **MOCK** cycle (`src/mocks/mockCycle`), with the definition's rotation sign.

## Screenshots (`docs/look-dev/`, 1920x1080, Chrome 155, Arc 140T)

Regenerate with `node tools/lookdev/capture.ts` (own headed Chrome through Playwright, viewport 1920x1080 DPR 1, 90 frames per preset, one per animation frame so TRAA converges; JPEG q92). The pre-round shots are in `docs/look-dev/before/` (same names) for comparison.

| File | Preset | What it shows |
|---|---|---|
| `00-hero.jpg` | `hero`, idle, 1/500 s, depth of field + bloom | Low three-quarter product shot of the intake: satin nacelle, brushed lip, the fan disc and the painted spinner |
| `01-three-quarter-front.jpg` | `threeQuarterFront`, idle, 1/1000 s (the default) | The closed engine on the cyclorama, key shadow and contact shadow under the nacelle |
| `02-side.jpg` | `side`, idle | Profile: panel joints, core cowl with exhaust stain, core nozzle and plug, the long strip highlights |
| `03-cutaway.jpg` | `cutaway` | 100 degree wedge: red-orange hatched section caps, fan case, splitter, booster, fan-frame struts, HPC, combustor liner and dome, HPT/LPT, TRF struts, shafts |
| `04-exploded.jpg` | `exploded` | Modules slid apart in flow order; the fan case slides forward with the intake so the fan shows; per-part floor shadows |
| `05-fan-idle.jpg` | `fanIdle`, 1/1000 s | 24 wide-chord blades overlapping at the tip, the dark gaps toward the spinner, 6.4 degrees of blur |
| `06-fan-takeoff.jpg` | `fanTakeoff`, 1/1000 s | 30 degrees per exposure: the fan reads as a disc, no blade-edge teeth at the hub |
| `07-hot-section.jpg` | `hotSection` (cutaway close-up) | Combustor liner and dome, HPT and LPT disks and blades (10 span sections), heat tint graded along x, TRF struts, plug |

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
