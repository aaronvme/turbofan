w2/lookdev-5: STOP-CLEAN (usage 86 %). DONE: W2L-I1..I5, P4's cut (indicatively 0.8-0.9 ms back to back), the five pass-8 visual notes, shots, LOOKDEV. NOT RUN: the full browser suite at HEAD (stopped by STOP-CLEAN). Indicative back to back, HEAD ba76d17 against main 0bb473f, paired: default -0.86 ms (10.18 -> 9.38 in a slow session), cutaway -0.89 (10.84 -> 9.62), hero -0.81 (13.09 -> 11.94). (HEAD: this handoff commit)

DONE (ID -> commit)
- W2L-I2..I5 (D4-42, D4-46): 37dfba8 (TDD, tests/unit/lookdev/timing.test.ts) / b181949.
  - `abSummary` drops pairs with an INVALID side (`reps`, `dropped`); `combineValid` (config medians over VALID runs, `runsUsed`); `p4Verdict` INVALID on an INVALID default back-to-back run.
  - D4-42: back to back is P4's measure of record, vsync beside it; official only under D0-1 with the OS power source AC throughout; GPU busy beside the number; exit 1 on FAIL or INVALID.
  - W2L-I3: the watcher pushes its open interval on stop; fewer than half the run's display intervals of ticks is INVALID.
  - W2L-I4: `tools/lookdev/os.ts` (Win32_Battery) before and after every run in capture.ts and ab.ts; `powerValidity`, `acThroughout`.
  - W2L-I5: blurs counted and passed as D3-6's `pageBlurs`; the watcher's INVALID is the occlusion signature, its stretch a warning.
- W2L-I1: 0cef4cc. A second rotorMotion test: the velocity debug view (linear, signed) warps the earlier still onto the later at the moved rotor pixels; shipped 27.1 vs zero 54.9 / flipped 58.7 (/255, bound 0.6 x); `noRotorMotion` and `rotorMotionScale: -1` run as controls that fail it. The moved-pixel selection was added after a first, unselective measurement (7.1 / 8.1 / 12.9); the ratio was stated first and not changed.
- P4 cut: a610005. The scene pass writes colour and depth only (GTAO's normal from the depth; TRAA's camera velocity from the depth, unjittered). `?gbuffer=legacy` keeps the old targets. `tools/lookdev/variantAb.ts` (new). Paired back to back, 4 of 4 negative: -0.76 ms (opaque -0.78). GPU_FACTS M48.
- Visual notes: stand 71344e8 (TDD) / 4c854b3; fan copies follow the exposure (W2L-N5) 73816a6 (TDD) / 4c854b3; satin nacelle, spinner lift (W2L-N4), cap section shading, deeper cavity occlusion 4c854b3; shots 00-07 ba76d17 (round 4's set in before/).
- HEAD vs main A/B (indicative, `ab.ts --pacing back-to-back --warmup-s 4 --run-s 10 --reps 3`, every run VALID, AC throughout): docs/look-dev/ab-ba76d17-0bb473f-<preset>.indicative.json; LOOKDEV "Look-dev round 5", GPU_FACTS M48; W2L-N1 fixed in LOOKDEV.

NOT DONE / SKIPPED
- `npm run test:browser` at HEAD: stopped by STOP-CLEAN before any file reported. Run it first (every preset, fanBlur, equalDepth, culling, rotorMotion). Risks to check: (1) rotorMotion's first test sat at its bound edge before this round (cutawayFanClose moved 8-9 tiles against 8 in two runs here, W2L-N2), (2) the satin nacelle, spinner lift and caps against engineView's checks, (3) GTAO from depth against the fan-blur bounds. Only `rotorMotion.test.ts -t W2L-I1` ran green at 0cef4cc.
- The official P4 run (orchestrator).
- W2L-N2 (the cutaway pose's margin), W2L-N6 (culling timeout), W2L-N7 (optimizeDeps): time.
- Rotor AO and self-shadow; 05's torn slivers at idle; the exploded fixture.

NEXT
1. Orchestrator, quiet window, the official P4 (D4-42: back to back of record, vsync beside it; about 30 min):
   `npx vite --port 5184 --strictPort`, then `node tools/lookdev/capture.ts --only none --warmup-s 10 --run-s 60 --reps 3 --seed 1`
   Optionally the A/B of record: `node tools/lookdev/ab.ts --refs <this HEAD>,0bb473f --pacing back-to-back --warmup-s 10 --run-s 60 --reps 3`.
2. Then P1's re-measure (D4-67) after the kernel-tuning round.
3. Critic: W2L-I1's moved-pixel selection; the camera-only velocity during the exploded/cutaway transitions; the hero's rotor pass +0.13 ms from 8 fan copies.
0. Next builder first: `npm run test:browser` at HEAD and fix anything it finds (see NOT DONE).

GOTCHAS
- Heredocs with backticks break this Bash tool's parser: write scripts with the Write tool.
- The velocity debug view is linear now (`outputColorTransform = false`): it looks dark on screen; that is intended (the test reads it back).
- `ao(depth, null, camera)`: three's types require the normal node; the cast is deliberate.
- A capture with an INVALID default run now exits 1 with "P4: INVALID".
- Dev port 5188; ab.ts used 5186/5187 and its ab-* checkouts were removed.

GATES @ba76d17 (code; later commits are docs only)
- npm test: 1931 passed + 11 expected fail (100 files)
- npm run lint: clean. npm run typecheck: clean.
- npm run coverage: lines 99.60 %, statements 98.71 %, branches 87.77 %, functions 99.65 %; src/geometry 99.59 % lines
- npm run test:mesh: 29 passed
- npm run test:browser: NOT RUN to the end (STOP-CLEAN)
- Nothing left running: the dev server on 5188 stopped, the ab-* checkouts removed and pruned, the browser run stopped.
