w2/lookdev-4: DONE except P4 both ways and rotor AO/self-shadow. The D4-24 measurement is settled: back-to-back pacing, the two-commit A/B, no regression at bad7ad0. W1V-I1 fix (b) passes its moving-vs-still test, and the stand, plug and spinner notes are done. Indicative default view: back to back 7.49 ms (passes 8), vsync 10.71 ms (fails), so P4 is not shown both ways. (resumed from bad7ad0; HEAD: this handoff commit)

DONE, part 2 (ID -> commit)
- D4-24 back-to-back pacing: fb6f529 (TDD, tests/unit/lookdev/timing.test.ts) / 6216abe, 0e8ca25, 24c49ec (TDD) / dad5570.
  - `capture.ts --pacing both|vsync|back-to-back`, default both. The warm-up runs at the run's pacing, and back-to-back ids end in "[back to back]".
  - P4 is printed per pacing and passes only if both do.
  - Recorded per run: frames per second, GPU busy fraction, render scale and GPU errors (W1V-N1). The JSON is Prettier-formatted (W1V-B1). Exit 1 on a P4 FAIL, and the JSON is still written.
  - The page keeps two frames queued. A rAF watcher makes a back-to-back run INVALID in an occluded window.
- D4-24 A/B, `tools/lookdev/ab.ts`: 6216abe, ada669a.
  - Detached checkouts `.claude/worktrees/ab-<sha7>`, each with its own `npm ci`. This tree's `src/lookdev/main.ts` (the harness only) is copied into each.
  - One Vite server per side on `--port` and `--port` + 1. Pairs are adjacent, and both the side and the pacing that lead alternate.
  - Output: each side's median and the paired a - b per pass, in `<out>/ab-<a>-<b>.json`.
- Regression verdict (indicative): NO regression. Source: `docs/look-dev/ab-bad7ad0-23239a1.indicative.json`, 4 pairs per pacing.
  - bad7ad0 - 23239a1 opaque: -0.64 ms at vsync, -0.96 ms back to back. Every pair was negative in both pacings.
  - Rotors: +0.12 at vsync (+0.06 +0.31 -0.03 +0.17), +0.01 back to back.
  - DVFS evidence, same commit, same page: vsync 10.79 ms against back to back 9.75 ms. The vsync runs are bimodal and the back-to-back runs are tight (GPU_FACTS M45, for the critic).
- W1V-I1 fix (b), D4-4: adcb3eb (TDD) / 1f8de34.
  - Rotor motion vectors in TRAA's velocity read: the spool step, wrapped to half a pitch, turns the rotor-depth world point back. The rotor depth also joins TRAA's current depth.
  - Our TRAA resolve, `src/render/traaResolve.ts`: Catmull-Rom history, plus a cross-tap depth search and variance clip.
  - tests/browser/rotorMotion.test.ts (bound fixed before measuring: moving <= rest + 6 tiles), rest -> moving tiles: cutaway 31 -> 36, close-up 2 -> 8, exploded 4 -> 4, exploded close-up 7 -> 9, hotSection 0 -> 0.
  - Control `legacyTraa` (the pre-fix pipeline): close-up 1 -> 34. It replaced the first control, `noRotorMotion` (see LOOKDEV).
  - fanBlur shipped in motion at dt 1/60, under the unchanged bound: fanIdle 0.0061/0.064, hero 0.0058/0.036, fanTakeoff 0.0053/0.051.
- P4 cuts, D4-5 round 2: 1f8de34 and ada669a.
  - Sub-pixel noise gated: the lip's buffing grain and the fan grain.
  - Nacelle latches, doors and rivets are evaluated only near them, and the wipe pattern is per vertex.
  - TRAA cross taps; 6 fan time copies.
  - Tried and reverted: GTAO 6 samples with temporal filtering (hero fan-blur tile 0.108), and a baked blade cavity (82798a7, reverted in 660d092: it failed engineView's centre-contrast check, which was not loosened).
- W1V-N5:
  - The stand, `src/geometry/stand.ts`: c31c47f (TDD) / ada669a.
  - Plug and core nozzle made dull and heat-stained, and the spinner's paint lifted: ada669a.
  - W1V-N3 TRAA internals asserted: 1f8de34.
  - GPU_FACTS M45-M47 and the M43 evidence (W1V-I3): dad5570.
- Shots 00-07 regenerated at this HEAD; the part-1 set is in docs/look-dev/before/. LOOKDEV has "Look-dev round 4, part 2".

DONE, part 1 (bad7ad0 and before)
- P4 pre-registered: abc9e13 / ffe3335.
- Triangle counts (W1V-I2, D4-5): 045ffde, 64ea253.
- Opaque-cost tooling: opaqueCost.ts.
- First shading cuts: 87b17ff, ea3ba09.
- Fan cut rule 'inside' and the exploded spool stop: ccf8809 / 87b17ff.
- W1V-I3 equalDepth test: afa526d / 631ae37.

NOT DONE
- P4 both ways. Indicative, dad5570 against bad7ad0, 4 pairs, all valid:
  - back to back: 7.49 against 8.25 ms (paired -0.46);
  - vsync: 10.71 against 10.49 ms (paired -0.54, with the vsync rotor pass +0.35 ms, not understood).
- Rotor AO and rotor self-shadow when still.
- 03's fan, seen nearly edge-on, still reads as a band at that distance.
- Pass-6 nits skipped (reasons in LOOKDEV): W1V-N1's cost model and wording; W1V-N5's doors, 04's framing and 07's speckle; W1V-N6.

NEXT
1. Orchestrator, quiet window (D0-1):
   - The A/B of record (about 15 min plus two `npm ci`; then `git add docs/look-dev/ab-bad7ad0-23239a1.json`):
     `node tools/lookdev/ab.ts --refs bad7ad0,23239a1 --warmup-s 10 --run-s 60 --reps 3`
   - P4 at this HEAD, both ways (8 configs, about 30 min):
     `npx vite --port 5184 --strictPort`, then `node tools/lookdev/capture.ts --only none --warmup-s 10 --run-s 60 --reps 3 --seed 1`
2. Critic: confirm or refute M45 (DVFS) from the A/B JSONs, as D4-24 requires.
3. If P4 is still short:
   - the vsync rotor pass (+0.35 ms in the pairs);
   - the opaque pass: bake the cyclorama's key shadow and pool once, and the nacelle's lighting;
   - the fan's anisotropic lobe.
4. Rotor AO and self-shadow; a camera for 03 that sees the cut fan less edge-on.

GOTCHAS
- No fwidth or dFdx inside a TSL `If`: compute the filter width before the branch (`gated`, `seamLineAA` in materials.ts).
- TRAA reads `depthNode.load` and `velocityNode.load` once per pixel, and post.ts overrides both. `traaDepth.value` must stay the scene depth, because TRAA copies it into its history. Our resolve replaces three's `colorNode` after its setup.
- GTAO's `useTemporalFiltering` breaks the hero fan-blur bound.
- engineView's centre-contrast check (> 0.015) is sensitive to darkening the fan (fanIdle).
- Back-to-back runs fill only 72-77 % of the wall time with timed passes (M46). An occluded window shows only in the rAF watcher.
- ab.ts:
  - Vite reloads a fresh checkout's first page; the tool waits for it.
  - Prettier ignores test-results/, so `--out` belongs in docs/ for a formatted record.
  - Ports 5190 and up may be the critic's.
- Indicative numbers drift up to 2x between sessions here; trust only paired runs.
- Dev port 5188. No new dependencies and no contract edits this resume.

GATES @660d092 (code; this commit changes only docs and shots)
- npm test: 1623 passed + 5 expected fail (74 files)
- npm run lint: clean. npm run typecheck: clean.
- npm run coverage: lines 99.51 %, statements 98.58 %, branches 87.97 %, functions 99.59 %; src/geometry 99.59 %
- npm run test:mesh: 29 passed
- npm run test:browser: 23 passed (7 files: every preset and the performance profile, culling, fanBlur, equalDepth, rotorMotion), 0 WebGPU errors
- Nothing left running: the dev server is stopped, and the ab-* worktrees are removed and pruned.
