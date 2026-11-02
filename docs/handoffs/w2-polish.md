w2/polish: STOP-CLEAN at the 84 % brake, the work DONE, the browser gate still running detached; the final W2 polish round (D4-99 item 3, D4-100's U4 fix and the browser-gate timeouts). From local main 9b5a6c2; code at ae67362, gates at ae67362 (see GATES; test:browser running at the stop); this handoff on top.

DONE (TDD: each failing test committed first, "(TDD)" in its message)
1. **The browser-gate timeouts (D4-100)** (9d63da3, ab30fba; test plumbing, no bar touched).
   - Measured on AC (status 2), 2026-11-01, another builder's GPU/vitest jobs on the machine (`reports/scratch/polish/t-*.json`):
     | test | alone | in the full suite (600 s timeout) |
     |---|---|---|
     | fanBlur "fanIdle, hero and fanTakeoff" | 25.9 s | 26.6 s |
     | rotorMotion "in motion, every shutter-0 pose" | 87.0 s | 86.6 s |
     The full suite passed 47/47 in 536 s with those timeouts, so the official window's 120 s timeouts were a slowdown of at least 4.6x of unknown cause (the critic's battery run was 2.3-2.7x slower overall), not the tests' own length.
   - Split: fanBlur is one test per shot, rotorMotion one per pose and per legacyTraa control, in the same order on the same views (the controls' view opens in the first control). Split, the pieces took 7-23 s (fanBlur) and 9-27 s (rotorMotion) alone; each has a 240 s timeout, over 8x the longest piece. The rotor rows repeated the unsplit run's to the digit, sample by sample (`base-rotorMotion.txt` against `test-results/rotorMotion.txt`); fanBlur's differ in the 4th decimal of two worst tiles (it is not claimed deterministic).
   - W2L-N16 / D4-99 item 4: the fallback is now stated in rotorMotion's comment (a passing default-pose control takes the pose out of the moving bound; the band is never re-tuned).
2. **U4 (D4-100)** (c35093e TDD, c84b996; d311830 TDD, ae67362; b0544d5 publish, 685d6ba text). FLAGGED: the scheduler and a contract text edit (below).
   - `src/shell/warmUp.ts`: the asked view's slot is several warm frames, each budgeted `cap - spent`, until the frame's warm CPU reaches `PREPARE_FRAME_CPU_MS` = 200 ms, or a warm frame draws nothing new (`nextWarmBudget`); the background keeps one warm frame at `WARM_BUDGET_MS` = 4 ms, its CPU rule and SLOT_EVERY. `COLD_SWITCH_WAIT_FRAMES` is 0 (was 30): see NEEDS A DECISION 1.
   - `src/shell/publish.ts` (`snapshotDue`): a snapshot every 3 frames or once 50 ms passed since the last, so a heavy preparing frame posts its own (with every-3rd-frame posting the main thread saw three 250 ms frames as one 612-868 ms gap).
   - Diagnostics record the warm frames' CPU total (`warm.cpuMs`) and the most one frame took (`warm.slotCpuMaxMs`).
   - Unit: the cap and the budgets; the slot kinds; a model of the cold switch (57 objects of 4-26 ms; the official run's 56-57 warm frames) shows within 2 s at light, 8.4 and 11.2 ms with no frame over 260 ms, where D4-98's rule in the same model misses 2 s at 8.4 and 11.2 ms.
   - U4's check text (PHYSICS 3.5 and `uiLevels.ts`) states the mechanism and D4-99 item 2's scope ("at any steady frame CPU up to 11.2 ms (tested)"); the bar is unchanged.
3. **W2A-I11** (170d1fc TDD, a39d8e1): `explodedRings` is what Exploded draws: every part that is not a skin, and the blade rows' edges, each slid by its module's offset (`geometry/parts.ts` engineParts). Unit: the drawn parts' box, framed, is centred within 8 px each way and fills the area one way at both sizes; the rings start at the fan case, not the hidden inlet lip.
   | Exploded, the unit test's rows | before (round 7): scale, gaps left / right / top / bottom | after |
   |---|---|---|
   | 1366 | 0.602 (the floor), 111 / 13 / 60 / 64 px | 0.723, 0 / -2 / 24 / 27 px |
   | 1920 | 0.702, 231 / 74 / 84 / 92 px | 0.888, 32 / 32 / 6 / 13 px |
   In Chrome (the app's own rows): 1366 content 312-1032 px against the area 312-1030; 1920 content 358-1538 px, 25 / 29 px to the columns.
   - **N31** (310c301 TDD, 6d01134): the snapshot carries `framedBox` (the framed view's content box), and app.test's modes loop fails Schlieren or Exploded outside the posted rows less FRAME_MARGIN_PX (2 px residual). At 310c301 (no box posted) both sizes failed "no framed content box".
4. **N29** (c35093e TDD, c84b996): only background slots count toward MAX_WARM_FRAMES. The critic's probe as unit tests: after 300, 420, 500 or 790 frames as the asked view the view is warmed in the background (500 was given up); a background configuration is still given up after 400 background slots.
5. **N30** (a0def7d TDD, 3d5f543): the knife-edge band is 0.5 +- 0.01 (was 0.4-0.6). Measured on HEAD (310c301, the canvas): Schlieren 0.914-0.917 of its field in it, the studio-backed controls 0.01-0.29 (the cut views 0.08-0.11). After: Schlieren passes (0.914 / 0.917), the cut views fail the grey bar at 0.08 / 0.11, Exploded's control is the silhouette (0.64-0.66) with a grey share of 0.14-0.29, S1 fails the jet bar. The share bar stays 0.7.
6. **The Schlieren Core exhaust label** (170d1fc TDD, a39d8e1, 6d01134): `jetBox` (the core jet's tube from the nozzle exit, r 0.405 m, to the near field's end, cut at the exit's centre) is posted in Schlieren and passed to `layoutCallouts` as content to avoid (an anchor inside it is still called out). Unit at both sizes; app.test's layout bar fails a label on the jet.
7. **W2V-N26** (ab30fba, 3b066dd): the W2V-I8 case compares the GPU floor with its TS mirror (`drawnOnPlane`) pixel by pixel at idle and take-off, for p, rho, T, Mach. Shipped: 0-93 px disagree (T 0.02 % idle, 0.04 % take-off). **Mutant V2 (T's floor 4x) is killed**: 1689 px (0.63 %) and 3026 px (1.14 %) against the bar of 0.2 %. The bar was stated at 2 % before the first run, which let V2 through: it is 0.2 % now, a stricter bar set after that run (said in the test).
8. **W2H-N10** (310c301 TDD, 6d01134): the fixed-dt record steps P5's window read from the contract: idleS at idle, the 1 s ramp, then windowS - idleS - leverRampS (1140 frames), 1380 in all (23 s). It failed at 310c301 with 1440; it records 1380 now (run4).

MEASURED, U4 (1366 x 768, `reports/scratch/polish/u4-*.txt`; AC, status 2, every run; another builder's GPU and vitest jobs running throughout, so INDICATIVE, not quiet)
| cold switch into Data, shown (gap) | official window (old rule) | cap, 30-frame wait (run4, 3d5f543) | cap, 30-frame wait (run5) | cap, no wait (run5) |
|---|---|---|---|---|
| light | 2.46 s (125 ms) | 2.24 s (656 ms) | 3.33 s (264 ms) | 2.15 s (504 ms) |
| steady 8.4 ms | 2.56 s (143 ms) | 2.42 s (868 ms) | 3.94 s (1205 ms) | 1.89 s (308 ms) |
| steady 11.2 ms | 2.51 s (145 ms) | 2.28 s (612 ms) | 3.13 s (870 ms) | 1.96 s (268 ms) |
- run4 had no time-based snapshot (gaps of 3 heavy frames); run5 had it. run5's waited cases were the most loaded (boot 4.6-6.8 s against the quiet 3.5 s; 656-837 ms in one frame, a single cap build of 689 ms), and its 8.4 ms case stalled 1.26 s at the click, before any warm frame (the same stall showed in a loaded run of the old code's first cases).
- The warm frames' CPU for the Data view cold from Realistic: 1.07-1.36 s in the no-wait run (20-27 warm frames, at most 224-229 ms in a frame).

NEEDS AN ORCHESTRATOR DECISION
1. **The asked view no longer waits 30 frames (D4-98 item 1).** D4-100 says the asked view warms several per frame "while preparing"; I read that as from the first frame of preparing. With the wait kept, U4 measured 2.24-2.42 s on AC (loaded); without it 1.89-2.15 s. The wait was 0.5 s of the 2 s in which a frame over the slot rule warmed nothing. D4-97 had declined skipping the CPU rule for the asked view ("the bound keeps the frame budget the default"). Reverting is one constant (`COLD_SWITCH_WAIT_FRAMES` = 30) and the unit tests that state it.
2. **U4 on a quiet machine is still owed.** Every run here shared the GPU with another builder; the light case was over 2 s in the no-wait run (2.15 s, boot 6.3 s). The firstSwitch run in the next quiet window decides it.
3. **W2V-N26's bar** was tightened after its first run (2 % stated, 0.2 % now; above).
4. **Small display and protocol additions** (not physics): the snapshot's `framedBox` and `jetBox` (`src/shell/protocol.ts`, not contracts), `warm.cpuMs` / `warm.slotCpuMaxMs` in the diagnostics; layoutCallouts' `avoid` argument.
5. Flagged contract text edit: U4's check text (mechanism, and D4-99 item 2's scope wording).

SHOTS
- NOT LOOKED AT: the re-shoot of `docs/look-dev/ui/` is the running browser gate (`VITE_UI_LOOKDEV=1`); when it ends the new shots are uncommitted in `docs/look-dev/ui/`. Look at all 13 (Exploded centred, the Schlieren Core exhaust label off the jet) and commit them.
- run4 (3d5f543, `reports/ui/`, not committed): the app test passed at both sizes, with every layout check, N31's framing check and the jet check.

NEXT
1. Read `reports/scratch/polish/gates.status` and `gate-browser.log` (the full test:browser, PID 2476, started after gpu-ladder); if it passed, look at and commit the re-shot `docs/look-dev/ui/` shots and fill the U4 gate-run row from `reports/ui/first-switch-data-cold*.json` (`node reports/scratch/polish/u4.cjs`).
2. Critic pass 19 on w2/polish (the U4 wait decision, the split tests, the framing and the jet box in the shots).
3. U4 in the next quiet window: `firstSwitch.test.tsx` alone with `VITE_UI_QUIET=1`.
4. Still open: W2S-B1 (the solver's divergence, its own round); camera easing (W4); "Preparing the pressure field"; labels in Exploded.

GOTCHAS
- Do not edit `src` or the tests while a vitest browser run is going: the run's vite serves the files from disk as each worker or test boots (run3 here, started before the implementation commits, kept the TDD state only because its modules were already loaded).
- Detached runs: `reports/scratch/polish/run.ps1` (-Name, -Cmd, -NeedFreeMB, -Browser) and `gates.ps1` (coverage to `reports/scratch/polish/coverage`); the U4 summary `u4.cjs`; mutant V2 `mutV2.cjs apply|restore`.
- The `debug` frame-CPU padding and another job on the GPU both lengthen every warm frame; read `warm.slotCpuMaxMs` and `bootMs` in the records before comparing U4 runs.
- Vitest browser API port 5194 here; nothing left running.

GATES @ae67362 (detached, `reports/scratch/polish/gates.ps1`, logs `gate-*.log` there; AC, BatteryStatus 2 at every step; another builder's jobs on the machine)
- npm run typecheck: clean (12 s).
- npm run lint (ESLint --max-warnings 0 + Prettier): clean (61 s).
- coverage (`--coverage.reportsDirectory=reports/scratch/polish/coverage`): 139 files, 2394 passed + 11 expected fail, exit 0 (thresholds held), 821 s. Lines 99.55 %, statements 98.54 %, branches 87.95 %, functions 99.56 %. warmUp 100 / 93.8, publish 100 / 100, anchors 100 / 83.3, callouts 100 / 88.2 (lines / branches).
- test:mesh: 2 files, 29 passed.
- test:gpu: 12 files, 71 passed (83 s).
- test:gpu-ladder: 3 files, 13 passed + 1 expected fail (314 s).
- test:browser (full, `VITE_UI_LOOKDEV=1`): RUNNING at the stop (gates.ps1 PID 2476; status `reports/scratch/polish/gates.status`, log `gate-browser.log`, JSON `gate-browser.json`). Before it, at 3d5f543-b0544d5: the split fanBlur and rotorMotion passed alone (163 s); firstSwitch passed (run4); app.test passed at both sizes (run4); flowViz W2V-I8 passed shipped and failed under V2 (run5). The baseline full suite at 9b5a6c2 with a 600 s timeout passed 47/47 in 536 s.
