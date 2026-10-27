w2/lookdev-4: PARTIAL, stopped on the usage brake (84 % rule, at ~75 %). P4 pre-registered, the opaque pass measured (fragment-bound, not triangle-bound), first shading cuts (default opaque about -19 % indicative), fan cut rule, exploded spool stop, W1V-I3 test. P4 is probably NOT met yet; W1V-I1 fix (b), rotor AO/shadow and the visual notes are not done. (from 30ce54e; HEAD: this handoff commit)

DONE (ID -> commit)
- P4 pre-registered first (task 1): abc9e13 (TDD: PHYSICS 3.4 row + the doc-sync test) / ffe3335 (thresholds.ts, verbatim; the only src/contracts edit). D4-2's wording; values maxRenderGpuMs 8, reportedTargetMs 10, resolutionLines 1080.
- W1V-I2 / D4-5 measurement (task 2): 045ffde, 64ea253. `stats()` counts only what the camera draws (layer-2 proxies skipped), with main / rotors / fan pre-pass / draw calls apart; `capture.ts --counts` writes docs/look-dev/triangles.json. Front views 1.259 M drawn (main 0.822, rotors 0.438 incl. the 8 shaded fan copies) + 0.219 M pre-pass, 63 draws; side 0.679 + 0.219, 31; cutaway/hotSection 1.588 + 0.027, 186; exploded 1.264 + 0.027, 84. This is the pass-6 probe's 1.06 M + 0.41 M, side 0.48 M, cutaway 1.58 M. Unchanged after the round (no geometry changed).
- What costs the opaque pass: `tools/lookdev/opaqueCost.ts` (paired A/B on one page, every frame of each run; `--saturate` renders back to back) and the debug flags `flat`, `flatNames`, `skinsOnly`, `hide`; `timeRun(ms, saturate)` in the look-dev page. Result: fragment shading. Unlit main materials: opaque ~6 -> ~1 ms; all main blade rows hidden: <= -0.6 ms; skins only = the whole engine; 960x540 halves it. By part (saturated): nacelle skin ~2.5, lip (incl. the inner barrel) ~1.4, cyclorama ~0.8, key shadow lookups ~0.5, core cowl ~0.1 ms. Numbers in LOOKDEV "Look-dev round 4".
- Shading cuts (task 3, what the measurements say): 87b17ff, ea3ba09. Orange peel dropped (sub-pixel in every shot, pass 6), low-frequency noise per vertex (`perVertex`: nacelle, lip, fan case, core cowl, heat tint, plug), oil canning as a per-vertex normal tilt, no lip anisotropy (roughness 0.34 -> 0.42 instead; 01 checked side by side). Saturated paired A/B vs round 3, 3 pairs: default opaque 6.09 -> 4.95 ms median. No geometry LOD: the measurements say triangles do not pay at the default view.
- W1V-I1 part: ccf8809 (TDD) / 87b17ff: the fan row hides only blades wholly inside the wedge (`bladeHidden(..., 'inside')`, mirrored in `bladeHide`, shared by the pre-pass so EqualDepth holds). tests/unit/geometry/lookdev4.test.ts.
- D4-4 part: same commits: `spoolDisplayFactor` / `SPOOL_STOP_S` = 1 s eases the exploded spools to a stop (smoothstep, composes exactly over any dt; tested at 1/60 and 1/30); the cutaway runs.
- W1V-I3 (task 5): afa526d (TDD) / 631ae37: tests/browser/equalDepth.test.ts compares rotor alpha through the pre-pass + EqualDepth against `plainFanDepth` (LessEqual, depth write, no pre-pass) at shutter 0 in fanIdle, threeQuarterFront and hero: 0 differing pixels required; the negative control `fanDepthNudge` 1e-4 rad must differ (> 100 px), so a hole is visible to it.
- Evidence (task 7): cc782b6: shots 00-07 regenerated, the round-3 set in docs/look-dev/before/; LOOKDEV "Look-dev round 4 + LOD".

NOT DONE (in order of value)
- P4 not shown: estimated ~9.1 ms at the official default (10.18 minus the ~1 ms opaque saving, indicative). More cuts are needed (see NEXT 2).
- W1V-I1 fix (b): rotor motion vectors into TRAA. 03 still shows a ghosted fan band. Rotor AO and self-shadow not done. The fan-blur "shipped" check at dt 1/60 not added.
- Visual notes (task 6): torn moving fan, spinner spiral in shadow, floating engine (stand/pylon), chrome plug: not started. Pass-6 nits W1V-N1..N6: not started (no time), except N2's stale "fill-bound" comment, which this round's measurement actually supports (it is fragment-bound).

NEXT
1. The orchestrator's quiet P4 run (one command, ~15 min; prints `P4: ... PASS/FAIL` and writes results.P4):
   `npx vite --port 5184 --strictPort` then `node tools/lookdev/capture.ts --only none --warmup-s 10 --run-s 60 --reps 3 --seed 1`, then `npx prettier --write docs/look-dev/timings.json`.
   DECISION NEEDED: at vsync pacing the Arc iGPU's clock follows the load, so GPU ms understate savings (the performance profile: opaque +0.4 ms at vsync vs -1.6 ms saturated; flat main: total -3.1 vs -8.1 ms). P4 as written is a vsync-paced D0-1 median. Options: keep it (savings must be ~2x larger than the saturated numbers suggest), or also report a saturated run (`opaqueCost.ts --saturate` style) / pin the GPU clock. Not changed by me (never loosen a threshold).
2. More fragment cuts, by measured cost: the nacelle's remaining ~1.9 ms (lighting + seam SDFs: gate latches/doors by region, or bake the panel layout into a small worker-safe DataTexture), the cyclorama (bake its key shadow and pool into the floor once: the engine is static between mode changes), the lip/inner barrel, the key shadow's 5 PCF taps at radius 6.
3. W1V-I1 fix (b): in the composite, for rotor pixels, reproject the rotor depth's world point by the spool's per-frame angle (rigid rotation about x; lp/hp from the blur MRT) through the previous view-projection and write that velocity for TRAA; then the dt-1/60 moving-vs-still browser test from pass 6; then rotor AO (GTAO on the rotor depth or a cavity term) and rotor self-shadow when the spools are still.
4. The visual notes, then the pass-6 nits.

GOTCHAS
- `lookdev.timeFrames(n)` returns the timer's ROLLING 120-frame medians, so short A/B windows mix configs; use `timeRun` frames (opaqueCost.ts does).
- The machine had another builder on the GPU the whole round: identical configs varied up to 2x between runs. Only paired, interleaved differences were usable.
- `perVertex` is only for periods well above the vertex spacing (192 segments: < 4 cm round the nacelle); the oil canning must stay a per-vertex TILT (a fragment derivative of an interpolated height facets).
- The fan's pre-pass and shaded copies must share `bladeHideOf(u, 'inside')` (EqualDepth); equalDepth.test.ts guards it.
- Dev port 5188 for this worktree. No new dependencies. Contract edit: thresholds.ts only (P4).

GATES @631ae37 (code; docs only after)
- npm test: 1608 passed + 5 expected fail (73 files)
- npm run lint: clean (ESLint --max-warnings 0 and Prettier)
- npm run typecheck: clean
- npm run coverage: lines 99.51 %, statements 98.58 %, branches 88.00 %, functions 99.59 %; src/geometry 99.58 %; thresholds pass
- npm run test:mesh: 29 passed (the mesh is unchanged)
- npm run test:browser: 22 passed (6 files: interop, chrome-gpu, engineView with every preset and the performance profile, culling, fanBlur, the new equalDepth), 0 WebGPU errors. fanBlur (bounds unchanged): fanIdle estimator 0.0017 / 0.027, shipped 0.0058 / 0.061; hero 0.0013 / 0.017, shipped 0.0043 / 0.031; fanTakeoff 0.0021 / 0.031, shipped 0.0043 / 0.038.
- Indicative timings only (another builder on the GPU; no bench:*, no official capture run).
- No dev server or Chrome left running (port 5188 stopped; the capture/opaqueCost runs used their own Playwright Chrome, closed; the shared MCP Chrome was not used).
