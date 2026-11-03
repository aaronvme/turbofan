w3/audio: STOP-CLEAN (on battery, low RAM); the engine synth is built and its Node rows A1-A6 pass; the browser suite is owed on AC (from e6c48de; HEAD see the commit of this file, code at 5e755c7)

DONE
- 8d80538, 3f2a481 A1-A6 mirrored in `src/contracts/thresholds.ts` (section '3.6'; the mirror test reads `A` rows). The 3 remaining failures in `tests/unit/contracts/thresholds.test.ts` are L14 only: PHYSICS.md has L14 since e6c48de, its mirror is w3/scheme's and is on main. At merge the count line conflicts trivially: take `4 + 12 + 14 + 6 + 6`.
- eeaa85b/93d61f0 `src/audio/dsp.ts`: xorshift32 noise; RBJ biquads with the exact white-noise gain (closed-form discrete Lyapunov); ramps; additive band-limited, phase-continuous oscillator bank (fade 0.40-0.45 f_s, none above); peak limiter at -1.05 dBFS; denormal flush. `tests/unit/audio/dsp.test.ts`, with the test-side FFT/analysis in `tests/unit/audio/lib/analysis.ts`.
- efde5da The cycle model counts its Greitzer surge cycles: flow breakdowns with hysteresis (`countBreakdown` in `src/cycle/greitzer.ts`), exposed as `CycleDiagnostics.surgeCycles()`. The contract is unchanged. Test: `tests/unit/cycle/surgeCycles.test.ts`. An injected surge gives 6-7 cycles in about 0.1 s.
- 1bf6748 ENGINE_FACTS unknown rows with sources: `starterSpeedRatio` 5.557 (an estimate: [MAKRIS] 40-50k rpm turbine at the 56 % cut-out) and `igniterSparkRate` 2 Hz ([HON19], a generic exciter). Mirrored in facts.ts.
- dced0b9 `src/audio/params.ts`: the voice table from the definition (fan BPF x1-4 at 24 published blades; EO 1-23; booster-r1 67, HPC r1-r3 35/36/37, LPT r4 70, all estimates; starter h1-4), the SoundFrame, mask and validate. `src/audio/sources.ts`: the source model:
  - M_rel,tip from N1, the fan tip radius and the station-2 Tt/axial Mach;
  - buzz-saw onset at M_rel 1;
  - Lighthill (rho_j/rho_inf)^2 U^8 A per stream from the cycle's `nozzle()`, with U^3 above a_inf;
  - St 0.2 large-scale and 0.6 fine-scale bands;
  - Heidmann-trend tone levels, synthesized directivity lobes, a level map that halves the dB range, and exact event gating.
- `src/audio/synth.ts` (EngineSynth, the worklet's code: per-sample glides to each posting, sparks, bangs at least 90 ms apart, limiter) and `src/audio/render.ts` (the offline render in 128-frame quanta).
- 3a9e097, 14893eb The A1-A6 Node checks (`tests/unit/audio/a1..a6*.test.ts`) pass. They write their numbers to `reports/audio/A*.txt`.
- 9e59a16 PHYSICS.md §1: four engine-sound ledger rows replace the old one (frequencies and gating simulated; onset and laws simulated; levels, shapes and directivity synthesized). §2.4 gives the equations.
- 44a0423, 3a5b1c4 The glue:
  - **Worklet:** `src/audio/worklet/processor.ts` (an AudioWorkletProcessor on EngineSynth, loaded via `?worker&url`).
  - **Controller:** `src/audio/worklet/engineSound.ts` makes the AudioContext only inside `enable()` from the click, then a GainNode for the volume (square law) and an AnalyserNode. It posts a frame per snapshot, with a ramp equal to the interval since the last one, and suspends the context after a mute.
  - **Worker boundary:** the snapshot message carries `listener` (the camera position), and `AppDiagnostics.surgeCycles` carries the surge count.
  - **Store:** `listener` and `sound` (sound survives `resetSession`).
  - **HUD:** `src/ui/sound.tsx` (the Sound switch, off by default, plus the Volume slider with WAI-ARIA keys) in the dock row. Unit tests: `tests/unit/ui/sound.test.tsx`, `tests/unit/audio/glue.test.ts`, and the listener in `faults.test.tsx`.
  - **Coverage bar:** `src/audio/**` lines 90 in vitest.config.ts.
- 7063430..5e755c7 `tests/browser/sound.test.tsx`:
  - checks: no AudioContext before the click (a counting subclass); the switch starts the worklet; analyser output finite, bounded and not silent; the volume 10 -> 30 % changes the RMS about 9x; mute fades out and suspends; turning it on again reuses the same context; an OfflineAudioContext render of the real worklet module; zero console errors.
  - Last run (sound3, on battery): the click and the start pass, so the AudioContext and the worklet run in Chrome. It failed at the volume step only because the focus was on the switch. 5e755c7 refocuses the slider. Not re-run.

A1-A6 (Node, 48 kHz, seeded; reports/audio)
| Row | Result | Bar |
|---|---|---|
| A1 | worst tone error 0.0005-0.032 % over N1 5-105 %; 1 s 20->100 % ramp: worst quantum-boundary step 0.008 %, lag error vs N1(t - one posting) 0.0002 %; > 0.45 f_s < -100 dB at 48/44.1/16 kHz | 0.25 %, 0.5 %, none |
| A2 | M_rel 0.802/0.925/1.173/1.440 vs independent within 0.05 %; EO sum -129/-118/-122 dB at M_rel 0.80/0.92/0.98; -6.0/-1.6/+3.0 dB at 1.05/1.17/1.44 | 0.5 %; <= -30; within 20 |
| A3 | slope 8 exactly (function); played 8.07 core, 8.00 bypass; St at 150 deg: core 0.222 (U 554, D 0.485), bypass 0.199 (U 273, D 1.08) | 8 +- 0.2; 0.15-0.3 |
| A4 | fan BPF 45 vs 150 deg: 14.3 dB (68.6 % and 101 % N1); jet peaks at 150 deg | >= 6 dB; 140-160 |
| A5 | sparks 6/6, 6/6, 4/4 heard (start, relight, surge recovery); rumble exactly 0 while unlit, amplitude / fuel flow constant to 1e-12; 6 surge cycles -> 6 bangs, none without | exact |
| A6 | 60 s script: finite, 0 denormals, peak -1.05 dBFS, 6 bangs; median 93 us per quantum alone (213 us in a parallel run), p99 253-447 us | <= -1 dBFS; <= 0.4 ms (indicative) |

ARCHITECTURE (where the parameters come from)
- **Worker:** cycle state, snapshot (20 Hz) + `listener` (orbitPose position) + `diagnostics.surgeCycles`.
- **Main thread:** store, then `soundInputsOf` (src/audio/sources.ts), then `engineSoundFrame`, then `port.postMessage({frame, rampFrames})`.
- **Audio thread:** `EngineSynth.push`/`process`, then the GainNode (volume), the AnalyserNode and the destination.
- Theta is taken from the inlet axis about x = (x2 + x8)/2 = 1.375 m.

NEXT
1. On AC, with nothing else on the GPU:
   - `npx vitest run -c vitest.browser.config.ts tests/browser/sound.test.tsx --browser.api.port=5194` through `reports/scratch/run.ps1` (detached, awake; it now also waits for other worktrees' gpu/gpu-ladder runs);
   - then the full test:browser, alone.
2. Coverage: `npx vitest run --coverage --coverage.reportsDirectory=<worktree>/reports/scratch/coverage`. Report the `src/audio` lines (not yet run). Then `npm run lint` and `npm test` in full.
3. Look at `reports/audio/hud-sound-on.png` (written by the browser test) for the dock's fit at 1366 px.
4. A6's "P1 and P4 do not change beyond their noise" is owed to a quiet D0-1 window.

GOTCHAS
- Under load, level comparisons must use a fixed master well under the limiter: master 1 at take-off clips, which made A4 read 6.6 dB instead of 14.3.
- vitest's default browser viewport is a phone's, so the dock is off screen; set `page.viewport(1366, 768)`. A click leaves the focus on the switch.
- In tests, no console.log (lint). The A-rows use `tests/unit/audio/lib/record.ts`.
- `?worker&url` is module-type in dev and IIFE in build, with no `importScripts`. Both are valid in AudioWorkletGlobalScope (not checked in a build).

DECISIONS NEEDED
- Is `surgeCycles` acceptable in AppDiagnostics, beside the contract like lostSolveCause, or should it move into CycleState?
- The synthesized mix constants and the level map (ground idle about 25 dB under take-off instead of about 50) were set by judgement, not by listening. Aaron should listen.
- U^3 above a_inf for the hot core jet at take-off (U/a 1.63) is an assumption, labelled in the ledger.

GATES @5e755c7 (partial: STOP-CLEAN)
- npm test: not run in full. Audio 76/76, UI + glue 64/64, cycle surge/greitzer/modelPaths/surgeRecovery 35/35 + 5/5, facts 367/367; thresholds 130/133 (the 3 L14 failures are pre-existing, see DONE).
- typecheck: clean (at 7063430; later changes are test-only). eslint on src/tests: clean; prettier --check .: clean. Full `npm run lint` not run.
- coverage: not run (owed).
- test:browser: sound.test.tsx 0/2 at its last run (the focus bug, fixed in 5e755c7, not re-run); the full suite is owed on AC.
- Dev port 5194 (vitest browser API). No dev server, Chrome or MCP page left running.
