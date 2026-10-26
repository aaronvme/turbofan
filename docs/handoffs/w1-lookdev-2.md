w1/lookdev-2: PARTIAL, STOP-CLEAN on the usage brake (84 %). W1L-I1..I4 done; D3-9 (plug) and N1-N7 not done (from 8c8ed6b; HEAD: this handoff commit)

DONE (ID -> commit)
- W1L-I1 (culling hides visible geometry): 3 TDD commits (the unit test, then the browser pixel test) and 6ce5b12, 5c24e0c. `closedViewLimits` now sits at the combustor inlet and the first LPT row. The pixel test showed that more than the critic's fix was needed: the rotors have their own pass, so the main pass's depth reaches past every rotor row and the HPC shows through the fan and booster gaps. Moving `xFront` aft of the booster still left 19-23 differing tiles; at the combustor inlet, 0. So the closed view now culls only the combustor, the HPT and the inner body's contents: 1.52 of 1.66 M triangles at `high`. `TRIANGLE_BUDGET.closed` is raised to test 215k and high 1.56M, and the "culls over half" check is now < 0.95 (a budget, not a physics threshold: orchestrator, please note). tests/browser/culling.test.ts covers every closed preset, the axial intake view and the core-nozzle view, at shutter 0 and two fan phases. Tolerance: a pixel differs when its luminance changes by more than 0.04, and a 16 px tile differs when more than 25 % of its pixels do. The on/off comparison must show no differing tile beyond the on/on floor (the same frame spacing), and no more differing pixels than 2 x the floor + 0.1 %. Diff PNGs are written to test-results/culling/ when it fails.
- W1L-I2 (rotor key unshadowed): 5c24e0c. The rotor pass's key (2048) and rim (1024) cast shadows from proxies of every static part, on layer 2. The shadow cameras see that layer and the rotor pass's camera does not (ShadowNode keeps a shadow camera's own layers when its mask goes beyond layer 0). The maps are static: they are re-rendered with the main key's on mode changes, through `studio.shadowLights`. The rotors and the spinner now receive shadows. Verified on the screenshots (00, 05: the fan face is in the lip's shadow). The exposure is not re-balanced.
- W1L-I3 (fan blur): 3 TDD commits, 5c24e0c, and the follow-up commit "per-frame R2 offset ... 3x3". The march is removed. The fan is drawn as 8 InstancedMesh time copies (`FAN_TIME_SAMPLES`) that share the geometry, instances and material. They are turned to ((k + j)/8 - 1/2) x the exposure angle, which is exact up to 2 pitches and one pitch beyond that. A fragment survives only if its copy is the one the pixel picks: IGN plus a per-frame R2 offset (`fanTimeMask`). The composite then averages the 3 x 3 neighbours' instants, leaving occluding neighbours out. tests/browser/fanBlur.test.ts compares against the mean of 64 shutter-0 stills (the `lpPhase` debug flag) in linear light (the `linear` flag: half radiance, no tone map). Estimator (TRAA off, mean of 64 frames): MAE <= 0.005 and worst tile <= 0.11, measured 0.0024-0.0033 / 0.072-0.083. Shipped (TRAA on, one frame): MAE <= 0.012 and tile <= 0.13, measured 0.0055-0.0067 / 0.081-0.092. The pass-4 march measured MAE 0.07-0.12 and tile 0.40-0.50. The worst tiles are the 1 px bleed of the 3 x 3 average at occluding edges; before the average they were 0.025, but one frame was binary noise, and TRAA cannot average a fan that turns between frames. The shredding, the hub comb and the crescents are gone (00, 05, 06).
- W1L-I4 (timing harness): TDD commit, then the commits "per-run frame recording" and "capture.ts runs the D0-1 protocol". Pure and unit-tested (tests/unit/lookdev/timing.test.ts): `summarizeRun` (every frame, R-7 p10/p50/p90), `RollingPassStats.beginRun/endRun` (not the rolling window), `combineReps` (median of the runs), `parseTimingArgs` (`--warmup-s` `--run-s` `--reps` `--seed` `--diagnostics`), `runOrder` (spikes/lib sweepOrder: seeded, rotated) and `runValidityOf` (spikes/lib D2-11/D3-6). The page adds `renderFor`, `timeRun` (rAF intervals, visibility and blur events, hidden ms) and `conditions` (battery, adapter, UA). The capture records the power plan, CPU load and Chrome version at the start and the end. The exact official command works (smoke-run at 2 x 2 s) and is documented in docs/LOOKDEV.md. passTimings.ts lost its parameter property and imports `./timestamps.ts` so that Node's type stripping can load it.
- Evidence: all of docs/look-dev/00-07 regenerated after the fixes (before/ kept); docs/LOOKDEV.md "Look-dev round 2".

NOT DONE
- D3-9 plug check against public CFM56-7B dimensions: not started (budget). The plug is still the definition's ogive.
- W1L-N1..N7: all skipped for budget. N5 (attach the dispose rejection as the `cause`) and N7 (set `renderer.info.frame` in beginFrame, or document the rule) are the cheap ones.
- The `--worker` timing mode (critic's I4 list): not added.
- GPU_FACTS: no new Measured items. ShadowNode's layer rule and the cost of discard-after-shading come from reading the source and an indicative run.

NEXT
1. Rotor-pass cost (indicative 2 s smoke run on battery: rotors ~5 ms, was ~1.2; default 14.5 ms GPU). The 8 fan copies are each fully shaded before the discard. Options: put the pick test first and early-out in a cheap pre-pass; use 4 copies (the 3 x 3 average still gives ~9 samples); use a lower-LOD fan for copies 1-7; or draw only copy 0 when the blur is below about 1 px.
2. The orchestrator's quiet D0-1 measure (the command in LOOKDEV).
3. Re-balance the exposure and the front strip now that the fan is shadowed. Then D3-9 and the nits.

GOTCHAS
- Two heredocs in one Bash call failed to parse in this harness; write files with the Write tool.
- Dev port 5185 for this worktree's own runs; the capture's `--port` flag selects it.
- No contract changes. No new dependencies.

GATES @HEAD (before this handoff commit; the code is unchanged since)
- npm test (via npm run coverage): 1456 passed (64 files)
- npm run lint: clean. npm run typecheck: clean.
- npm run coverage: thresholds pass (the run exited clean). The per-directory numbers were not extracted before the brake.
- npm run test:mesh: 29 passed
- npm run test:browser: 20 passed (5 files: interop, chrome-gpu, engineView, culling, fanBlur), 0 WebGPU errors
- No dev server or Chrome left running (the 5185 server stopped).
