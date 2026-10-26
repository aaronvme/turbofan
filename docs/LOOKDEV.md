# Look-dev (W1 geometry + look-dev round)

The procedural engine (`src/geometry`) rendered by the look-dev view (`src/render`) in a procedural product-shot studio (D3-1). Run it with `npx vite --port 5184 --strictPort` (not `npm run dev`, W1M-N1) and open `/lookdev.html` (`?preset=<id>&clean=1&shutter=<deg>&quality=test`; keys 1-8 presets, `c`/`e`/`r` modes, `t`/`g` throttle, `p` the GPU pass overlay). The spools turn at N1/N2 from the **MOCK** cycle (`src/mocks/mockCycle`), with the definition's rotation sign.

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
