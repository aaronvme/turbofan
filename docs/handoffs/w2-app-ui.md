w2/app-ui: round 7 (D4-98 items 1, 2 and 4, the four visual notes, N23). Main b5ae7ef merged (6bf986f). Code at dd0c060, the shots at 35a16c9 (the gate run's), gates at dd0c060 (see GATES); this handoff on top. U4 met in the targeted run, over 2 s at a steady CPU in the gate run, both on battery: U4 on AC is owed.

# Round 7 (2026-10-31): D4-98 (U4 by scheduling, W2H-I5's fixed-dt gate), the visual notes, N23

DONE (TDD: each failing test committed first, "(TDD)" in its message)
- **U4 / D4-98 item 1** (deca3d7, 82476b3 TDD; b6d6715): `src/shell/warmUp.ts` `COLD_SWITCH_WAIT_FRAMES` = 30 (was 60); after it the asked view takes a slot every frame whatever the last frame's CPU (was every 2nd). Its give-up stays 800 frames waited and it no longer counts against the background's 400-slot cap (that cap would have given it up at about frame 430). The background keeps the CPU rule and SLOT_EVERY. Unit: first slot at frame 30, then one per frame at 8.4/11.2/16 ms; k warm frames shown at 30 + (k - 1); at a light CPU 15 slots in the wait then every frame. U4's check text in PHYSICS 3.5 and the mirror states the mechanism; the 2 s bar is unchanged.
- **W2H-I5 / D4-98 item 2** (fab0dfb TDD; a5190f9): `src/shell/simSteps.ts`. The worker steps the real frame time (the app) or the suite's counted fixed steps (the `debug` message's `simSteps`; with none left the sim holds). The diagnostics carry `fixedSteps`. A frame that did not step is no longer tagged held. The W2F-N5 case: hold, reset to ground idle, 180 frames of 1/60 s at 0.05, the lever 0.05 to 1.0 in 20 steps of 3 frames (each sent while it holds), then 1200 frames. The cycle cause is untouched.
- **D4-98 item 4** (e620f67): a production build ignores `debug` (`import.meta.env.PROD`). Checked on a production bundle (`npx vite build --outDir reports/scratch/app-ui/r7/dist`): the worker's handler is `case"debug":return;`, and its body (the frame-CPU padding, the knife edge, the fixed steps) is gone from the bundle.
- **N23** (2e80b3c TDD; 6eb6d10; FLAGGED RENDER EDIT `engineView.ts`, the report only): `warmUp` reports `done` per configuration; only finished boot configurations are marked warm (`bootWarmed`); the rest warm first in the background; `shownView` never shows "Preparing" for the view already shown; Diagnostics counts the unfinished; warmStall checks both boot configurations finished.
- **Visual notes** (unit-tested; checked in the gate run's shots, SHOTS below):
  - Schlieren and Exploded framing (b4b8dc5 TDD; 33f346a; FLAGGED RENDER EDIT: `EXPLODE_GAP` moved unchanged to `geometry/explode.ts`). Both are framed in the free area above the dock less `FRAME_MARGIN_PX` = 24 on every side (`fitOrbit`, 3 re-projected passes, `FRAMED_MIN_SCALE` 0.6). Exploded's content is `explodedRings`. Unit at both sizes: inside the margin; at least 0.9 of the area across or down; Exploded at 1366 needs scale 0.602.
  - The crop outline, W2V-N25 (d56294b TDD; 808b785; FLAGGED RENDER EDIT `flowViz.ts`): dashed along its nearest edge (0.06 m drawn, 0.045 m gap; `cropDash` mirrors the shader) and lighter (alpha 0.4, was 0.55). The legend note now reads "Not drawn in the dashed frame: ... (ambient ± 2.5 % of scale)" after a dashed swatch, on one line (legend 440 px). The browser layout bar fails a wrapped note.
  - The 1366 drawer's long leader (53feaf0 TDD; ea8e5af). Measured in Chrome (`reports/scratch/app-ui/r7/diag-drawer.json`), there were three causes:
    - the unlit annunciator strip, a 0 x 0 reserved box at x = 671, pushed the top row right;
    - the top row ignored the top bar because it sits at y = 8 (only bars at y <= 1 counted), so at the minimum scale the whole top row was hidden;
    - equal layouts did not prefer shorter leaders.
  - All three are fixed, and a row place pushed onto the engine is dropped, never put on the section. Unit with the measured inputs: closed, all 8 labels in rows; drawer open, the fan above with a leader < 130 px.
- Small: frameView's comment reflowed (8524c97); the floor-note layout check's lint fix (dd0c060).

MEASURED (1366 x 768, `reports/ui/first-switch-*.json`; ON BATTERY, status 1, shared machine, not quiet: indicative, not conclusive)
| cold switch into Data (U4 <= 2 s) | round 6 gate run (AC) | round 7 t1 (ea8e5af) | round 7 gate run (dd0c060) |
|---|---|---|---|
| light frame CPU | 2.53 s | 1.61 s | 1.45 s |
| steady 8.4 ms | 3.10 s | 1.93 s | **2.16 s** |
| steady 11.2 ms | 3.19 s | 1.83 s | **2.20 s** |
- **U4 is met in t1 and not in the gate run at a steady 8.4 and 11.2 ms (2.16 and 2.20 s), both on battery**, the gate run after 13 min of coverage on the same laptop. Reported, not restated. The mechanism's floor is 30 + 45-47 frames, about 1.3 s at 60 Hz; the rest is frames lengthened by the warm frames' node builds (up to about 41 ms each, critic 17), which a battery-clocked CPU stretches. An AC run decides it.
- No switch given up; the longest snapshot gap while preparing 86-126 ms (FREEZE_MS is 1 s).
- U2 (<= 250 ms), the longest gap in the 3 s after the click: Schlieren 53 / 53 ms, Cutaway 56 / 53 ms, a switch while the queue warms 59 / 58 ms (t1 / gate run; the echo 66-120 ms).
- U3 (<= 5 s): boot 2.90-3.39 s in t1, 2.93-3.19 s in the gate run. U7: all nine warm 6.1 / 6.2 s after ready.
- W2F-N5 on the fixed dt (t1): all 1440 fixed frames stepped (180 + 60 + 1200), 1005 lost solves, 168 held snapshots, held step 3.7 ms CPU, held frame 5.6 ms; no throw (the test checks no problem). Gate run: the same 1440 frames, 1005 lost solves and 168 held snapshots (the same inputs on the same steps), held step 3.5 ms, held frame 5.7 ms.

SHOTS (`docs/look-dev/ui/`, from the gate run at dd0c060, `VITE_UI_LOOKDEV=1`, committed in 35a16c9; the signatures and the callouts shown are in `*-shots.txt`). Before is round 6 at d267488.
I looked at all 13 against the bar (both sizes, every mode, the drawer, the solver).
- **The 1366 drawer** (`1366-6-drawer.jpg`):
  - Before: the one label shown (Fan) sat in the row below the engine, with a 265 px leader across the cut section.
  - Now: Fan sits in the row above, centred over its part, under the top bar and left of the drawer, with a short straight leader (about 110 px). At 1920 the drawer leaves six labels in their rows, and the Background warm-up row reads 9 of 9.
- **Schlieren** (`*-4-schlieren.jpg`):
  - Before, at 1920: the nacelle touched the left column (about 7 px), and its bottom ran under the legend.
  - Now: framed above the dock with margin. At 1920 there is about 100 px to the left column and the jet's fade ends about 120 px short of the right one. At 1366 there is about 48 px left, and the nacelle ends above the legend.
  - The signature still passes on the canvas: grey share 0.95, silhouette 0.25, jet 0.13-0.15. S1 still fails the jet bar (0.012).
- **Exploded** (`*-3-exploded.jpg`):
  - Before: unframed, the core modules ran under the right column, and the intake under the left panels and the strip.
  - Now: the whole exploded engine lies in the free area. At 1366 it runs from the intake ring at x 415 to the last module at about 1030, with the right column at 1062. At 1920 it runs from 560 to about 1510, with the column at 1572.
  - Its framing is left-light: more room left of the intake than right of the turbine, because the intake ring is the nearest and largest part.
  - Its control still fails the silhouette bar (0.65-0.66). Its grey share rose to 0.48-0.50 (was 0.24), now framed smaller and still under the 0.7 bar: a smaller margin for the critic to judge.
- **The crop outline, W2V-N25** (`*-2-cutaway.jpg`, `*-5-data.jpg`, the drawer, the solver):
  - Before: a solid light line crossing the studio and the label rows like a stray leader.
  - Now: a light dashed frame, clearly not a leader, which the legend's dashed swatch names ("Not drawn in the dashed frame: ..."), on one line at both sizes.
  - The top edge passes just under the 1920 top row (Fan's label bottom at y 112, the dashes at about 118), never through a label.
- **The cut views** (`*-2-cutaway.jpg`, `*-5-data.jpg`): eight labels in their rows at both sizes, each row in axial order, as in round 6. At 1366 the top row now sits just under the top bar, and Fan is centred over its anchor (round 6's unlit-annunciator box had pushed it right).
- **Realistic** (`*-1-realistic.jpg`): unchanged. Fan is on the fan face through the intake and Core exhaust on the cowl. The nacelle still runs under the panels by design: the viewer's camera, not framed.
- **The solver** (`1920-data-solver.jpg`):
  - The uncoupled field is mostly under the floor, so the dashed frame shows where the plane would be.
  - The legend's two-line solver badge makes the dock taller, and seven labels still fit at 1920. Core exhaust is under the drawer.
  - The drawer's last row scrolls, as designed.
- Nothing is clipped or overlapping in any shot; the layout bar (now with the floor-note check) passed at both sizes.

NEEDS AN ORCHESTRATOR DECISION
1. **UI choices this round made beyond the brief** (display only, not physics):
   - the legend is 440 px wide (was 380), and its floor note reads "Not drawn in the dashed frame: ... (ambient ± 2.5 % of scale)", shortened from "(the ambient ± 2.5 % of the scale)" to keep it on one line;
   - Schlieren is now framed in the area above the dock (was the whole centre column, where the nacelle ran under the legend), so its engine is a little smaller;
   - Exploded is framed (it was not): entering it moves the camera, and leaving it puts the orbit back, as in Schlieren.
2. **At 1366 the cut views have little slack.** They stop at U5's minimum scale (0.6) with about 8 px to spare above and 15 px below. A taller dock hid most labels in a mid-round run (a two-line legend note). The browser layout bar now fails a wrapped note, but any taller dock content (a fallback reason in the badge, say) would cost labels by priority, as D4-97 allows.
3. **U4 on AC is owed:** both runs were on battery (status 1, 86 % then 71 %), and the steady-CPU cases were 1.83-1.93 s in t1 and 2.16-2.20 s in the gate run.

NEXT
1. Critic pass 18: app-ui rounds 6-7 with w2/followups-2 (U4 as measured; W2H-I5's gate; the framings and the outline in the shots).
2. Open from earlier: "Preparing the pressure field" for a quantity change; labels in Exploded (critic 17's suggestion 4); visual notes 5 and 7.

GOTCHAS
- Detached runs: `reports/scratch/app-ui/r7/run.ps1` (-Name, -Cmd, -NeedFreeMB, -Browser) and `gates.ps1` (coverage to `reports/scratch/app-ui/r7/coverage`). The layout diagnostic test is kept as `reports/scratch/app-ui/r7/zzDiag.test.tsx.txt`, and its measurements as `diag-drawer.json`.
- The callouts reserve every `[data-reserve]` element. An empty one (the annunciator strip with nothing lit) now reserves nothing; before, it pushed the top row right of x = 671.
- The `debug` message's `simSteps` add to the frames left. The sim holds with none left, so a test sends its inputs between batches and waits on `diagnostics.fixedSteps.frames`.
- Dev port 5194 unused; no MCP page opened; no run left going.

GATES @dd0c060
Detached, `reports/scratch/app-ui/r7/gates.ps1`, logs `gate-*.log` there. ON BATTERY (status 1 throughout, 81 % then 71 %), 5.1 GB free before the browser step, no other vitest browser run.
- npm run typecheck: clean. npm run lint: clean at dd0c060. The gate run's lint at 1e870e5 failed one `no-unnecessary-condition` in app.test.tsx, fixed in dd0c060 (test only) and re-run clean.
- coverage (`--coverage.reportsDirectory=reports/scratch/app-ui/r7/coverage`, at 1e870e5; src is the same at dd0c060): 137 files, 2363 passed + 11 expected fail, exit 0 (thresholds met). Lines 99.54 %, statements 98.56 %, branches 87.97 %, functions 99.55 %; 755 s.
- npm run test:mesh: 2 files, 29 passed.
- npm run test:gpu: 12 files, 70 passed, 45 s.
- npm run test:browser (`VITE_UI_LOOKDEV=1`, the re-shoot, at dd0c060): 14 files, 46 passed, 0 failed, 454 s.
- Earlier targeted run t1 (firstSwitch, app, warmStall at ea8e5af): 3 files passed, 152 s.
- D4-98 item 4 checked on a production bundle (above).


# Round 6 (2026-10-31): critic pass 17's findings, as D4-97 decided

DONE (TDD: each failing test committed first, "(TDD)" in its message)
- **W2A-I9, a warm frame zeroed the next real frame's camera motion** (748e7b9 TDD; 379f1c1). **FLAGGED RENDER EDIT** (`post.ts`).
  - The view-projection roll moved out of `post.ts`, unchanged, to the pure `src/render/viewProjRoll.ts`; the fix saves and restores all three matrices (previous, current and its inverse), not only the previous.
  - `tests/unit/render/viewProjRoll.test.ts`: an orbiting camera with a warm frame before each real frame (a cold switch preparing while the viewer drags). Each real frame's matrices equal those of the same frames without warm frames, its previous is the last real frame's, and a scene point's camera motion is the orbit's, not zero. It failed on the old restore (2 of 3).
- **W2A-I7 / D4-97 item 1, a cold switch has a bound** (1795061 TDD; 9a4448e).
  - `src/shell/warmUp.ts`: the asked view takes its slots under the CPU rule, and once it has waited `COLD_SWITCH_WAIT_FRAMES` = 60 frames, whatever the last frame's CPU (one every SLOT_EVERY). Its give-up counts the frames waited (`MAX_PREPARE_FRAMES` = 800, about 13 s, the slots' old give-up). The background keeps the CPU rule (D4-95 item 3).
  - **U4 pre-registered** in PHYSICS.md 3.5 and `src/hud/uiLevels.ts` (`coldSwitchMaxMs` 2000): an unwarmed switch shown within 2 s at any steady frame CPU, indicative, official only quiet.
  - Unit tests from the critic's probe: at a steady 8.4, 11.2 and 16 ms frame, the first slot at frame 60, then one every 2 frames; 8.0 ms from frame 0, as before; the loaded pattern; a configuration needing k warm frames shown at exactly 60 + 2(k - 1) frames at 8.4, 11.2 and 30 ms; a never-finishing view given up at 800 frames waited; no background slot at a steady 8.4 ms; the wait restarting for the next cold switch.
  - Chrome (`firstSwitch.test.tsx`): the cold switch into Data now also runs at a steady 8.4 and 11.2 ms frame CPU. The worker pads each frame to it through a test-only `debug` protocol message (never sent by the app, not an input for the quiet rule). It records U4 every run, fails a freeze or a give-up every run, and gates U4 in a quiet run.
- **W2A-I8 / D4-97 item 2, the cut views framed for their label rows** (55786c7 TDD; 19acf3f).
  - `src/shell/orbit.ts` `cutViewOrbit`: entering Cutaway or Data dollies the camera out and pans it until the engine's screen box lies inside the free area above the dock, less a 52 px label row above and below. It re-projects after each pass, three passes, and stops at the minimum engine scale, 0.6 of the size at the orbit before (Schlieren's). Leaving puts the orbit back. The overlay posts `viewArea.rows`, the centre column above the dock; a change re-frames from the saved orbit (the dock's legend appears with the mode).
  - **U5 pre-registered** beside U1-U4 (`cutViewMinScale` 0.6, `calloutRowPx` 52, the stated priority).
  - `layoutAxial` now offers only the row places. A label with no room in its row is hidden by D4-97's priority, never placed on the section: `anchors.ts` PRIORITY is now fan, combustor, HPT, LPT, exhaust, then HPC, booster, bypass duct.
  - Unit: the framing checked by projecting the engine rings after the orbit, at both sizes. Chrome: the layout bar asserts the axial rows hold in Cutaway and Data at both sizes (every shown label clear of the engine box above or below it, each row in axial order).
  - In the targeted run (t1) and the gate run: 8 of 8 labels in their rows in both cut views at 1366 and 1920.
- **W2A-I10 / D4-97 item 3, the Schlieren signature on the canvas alone** (915d710 TDD; 4539b72, 70338fe). W2A-I6 is closed only if the critic agrees.
  - `app.test.tsx` computes the signature from a second screenshot with the overlay hidden.
  - Each bar has its own failing control, asserted by name (`failedBars`):
    - S1, the knife edge off (a new `knifeEdge` uniform in `post.ts`, set through EngineView's `noKnifeEdge` and the `debug` message, in the same run), fails the jet bar;
    - Cutaway and Data fail the grey-share bar;
    - Realistic and Exploded fail the silhouette bar.
  - The grey-share bar is tightened from 0.3 to 0.7, midway between Schlieren on the canvas (0.84-0.90) and the controls (≤ 0.55 once the cut views are framed for their rows). The jet (0.08) and silhouette (0.5) bars are unchanged.
  - The unit controls are drawn at the studio's grey (0.47). One more case shows a label in the jet box passing a bandless jet, which is why the signature is taken on the canvas.
- **D4-97 item 4** (33c74c9): **U6** (Cutaway's own warm frames, 47 at ≤ 41 ms, about 2 s, once) and **U7** (all nine configurations warm, s after ready) are recorded rows with no bar in PHYSICS.md 3.5 and the mirror. warmStall writes `u6Cutaway` (with `warmFramesOver16_7Ms`); firstSwitch's while-warming case writes `allWarmMs`.
- **Nits**:
  - N21 (32299c6 TDD; 70338fe): the search tries every crossing place, fewest crossings first. The critic's probe, dense (5 anchors in 360 x 280): 0 of 600 short of the exhaustive best (was 17 of 1500). The BIG case was not rerun to the end (timeout).
  - N22 (78be8d7 TDD; 70812f9): Diagnostics shows "Boot warm-up (D4-91)" and a "Background warm-up" row (n of 9 warm, the next, paused for input, given up).
  - N24 (19acf3f): an orbit in a framed view (Schlieren, the cut views) cancels the restore.
  - N25 (55786c7, 19acf3f): `fitViewOffset` is deleted; `framedOrbit` is tested by projecting the engine after the orbit.
  - N26 (d40758d): the guard pins every field TRAANode's `updateBefore` writes (the six camera uniforms, the previous depth and the one-shot `_needsPostProcessingSync`, which setup sets and the first frame clears: not per-frame state). Critic mutant G4 would now fail it (not re-run: it edits `node_modules/three`).
  - N27 (379f1c1): `post.ts` cites GPU_FACTS M57.
  - N28 (e41d6f0): the drawn layout bar checks that no callout anchor is under a panel and no leader runs through one.
  - **Skipped: N23** (the boot's `warmUp` reports no done flag).

MEASURED (1366 x 768, `reports/ui/first-switch-*.json`; AC, shared machine, not quiet: indicative)
| cold switch into Data (U4 ≤ 2 s), shown / warm frames | before (critic 17's probe) | t1 (19acf3f) | gate run (70812f9) |
|---|---|---|---|
| light frame CPU | 3.07 s (critic's run) | 1.95 s, 43 warm frames | 2.53 s, 46 |
| steady 8.4 ms | never (0 slots in 10 min) | 3.89 s, 44 warm frames | 3.10 s, 45 |
| steady 11.2 ms | never | 4.29 s, 47 warm frames | 3.19 s, 45 |
- No switch was given up; the longest snapshot gap while preparing stayed under FREEZE_MS.
- U2: Schlieren 57 / 85 ms, Cutaway 67 / 53 ms, a switch while the queue warms 65 / 57 ms (t1 / gate run). U3 in the gate run: boot 2.8-3.4 s.
- U6 (gate run, warmStall): Cutaway's own warm, 41 warm frames over 1.37 s, at most 22 ms of warm-frame CPU, 9 frames over 16.7 ms, the longest frame gap 17 ms, 42 pipelines.
- U7: all nine warm 6.2 s after ready (both runs).
- The Schlieren signature on the canvas (t1):
  - Schlieren passes: grey share 0.90 / 0.84 (1366 / 1920), silhouette 0.25, jet 0.16 / 0.15.
  - S1 fails the jet bar: 0.0009 / 0.0056.
  - Cutaway fails the grey bar: 0.55 / 0.50; Data 0.55 / 0.50.
  - Realistic fails the silhouette bar: 1.18; Exploded: 0.67.

NEEDS AN ORCHESTRATOR DECISION
1. **U4 (≤ 2 s) is not met at a steady frame CPU over the slot bar.** The cold switch is no longer stuck, but D4-97's mechanism shows it in about 3.9-4.3 s at 8.4 and 11.2 ms.
   - The time is about 1 s of waiting (60 frames), then the view's own 44-47 warm frames, one every 2 frames, each frame longer by its node build (up to 41 ms).
   - At a light CPU it was 1.95 s in t1 and 2.53 s in the gate run. A quiet run gates U4, so it would fail at 8.4 and 11.2 ms, and maybe at a light CPU too.
   - Options, none adopted here:
     - (a) after the 60-frame bound, the asked view warms every frame instead of every 2nd: about 1 s off, maybe still over 2 s at 11.2 ms;
     - (b) a shorter bound, or none for the asked view (D4-97 declined the latter);
     - (c) U4 restated as "60 frames plus the view's own warm frames".
   - U4 is pre-registered as decided and not loosened.
2. **The W2F-N5 held-frame case threw in the cycle in the targeted run (t1)**: `cycle step failed: Error: enthalpy 4475806.6 is outside the range of [200, 3500] K`, on the part-power fit's slam, so the sim stopped and the test's "no problems" failed.
   - The cycle code is unchanged since critic 17's passing run (main 664203f had the same `src/cycle`), and this round touches no cycle code. So it is a timing-dependent path on the part-power fit (W2H-I1 / W2H-I4's ground), surfaced correctly as SIM STOPPED.
   - The gate run's same case passed (990 lost solves, no problem), so it is intermittent. It needs the cycle owner's look: the scenario is the browser's real-time lever ramp, and t1's log has the message.
3. **The grey-share bar's move to 0.7** was set after seeing t1's controls (0.50-0.55, the cut views framed). It tightens the test's own bar (Schlieren passes at 0.84-0.90); the critic may want it stated differently.
4. **New test-only protocol message `debug`** (`frameCpuMs`, `knifeEdge`) in `src/shell/protocol.ts` and the worker (not `src/contracts`). It is not an input for the quiet rule.
5. **Display rules changed** (UI, not physics): the callout priority order (D4-97's), and in the cut views a label with no room in its row is hidden rather than placed on the section.

NOT DONE
- N23 (the boot `warmUp` without a done flag).
- Visual notes 5 and 7; flowviz's crop outline (W2V-N25) in the app's shots; labels in Exploded (critic's suggestion 4); "Preparing the pressure field" for a quantity change (small note).

SHOTS (`docs/look-dev/ui/`, from the gate run at 70812f9, `VITE_UI_LOOKDEV=1`; the signatures and the callouts shown are in `*-shots.txt`)
I looked at 11 of the 14: both sizes of Cutaway, Data, Schlieren and the drawer, plus 1366's Realistic and Exploded.
- 1920 Realistic, 1920 Exploded and `1920-data-solver.jpg` I did not open, to stay under the usage brake. Their code paths are unchanged this round, and their numeric checks passed (the layout bar, the signature controls).
- `*-2-cutaway.jpg`, `*-5-data.jpg`: the engine is dollied out, with Fan, Bypass duct, Combustor and Low-pressure turbine in the row above, and Booster, HPC, HPT and Core exhaust in the row below. Both rows keep axial order, with straight leaders to dots on the parts, nothing on the section, and nothing clipped or overlapping, at both sizes. That meets W2A-I8.
- `*-6-drawer.jpg` (Data with Diagnostics open):
  - at 1920, six labels (those left of the drawer), the Background warm-up row reading "9 of 9 warm";
  - at 1366, one label (Fan: the rest are under the drawer), placed in the lower row with a long leader. It is clear of everything.
- `*-4-schlieren.jpg`: the knife-edge grey, the dim silhouette, the banded jet. The framing is the same as round 5's: at 1920 there is still no margin at the left column (critic visual note 2, open).
- `1366-1-realistic.jpg`: Fan on the fan face, Core exhaust on the cowl, as before.
- `1366-3-exploded.jpg`: the parts run under the right column, as in round 5 (Exploded is not framed; a suggestion for later).
- Short of the bar, still open: flowviz's crop outline (W2V-N25) crosses the cut views like a stray leader; the 1366 drawer's single long leader; Schlieren's margin at 1920.

GOTCHAS
- `viewArea.rows` is the centre column above the dock. The dock's legend appears with the cut modes, so the worker re-frames when the area changes (a jump of a few px, a snapshot after the switch).
- The `debug` message is the only way the browser suite reaches the knife edge and the frame CPU. A worker frame padded to N ms still runs at 60 fps up to about 16 ms.
- The critic's exact-search probe needs `--import ./tools/mesh/ts-resolve.mjs` and a `.ts` copy (`reports/scratch/app-ui/r6/probe/`). Its BIG case runs for minutes.
- Detached runs: `reports/scratch/app-ui/r6/run.ps1` (one command: waits for free RAM and no other browser run, records the battery) and `gates.ps1`. Dev port 5194 unused; no MCP page opened.

GATES @70812f9 (detached, `reports/scratch/app-ui/r6/gates.ps1`, logs `gate-*.log` there; AC, battery status 2, 5.3 GB free before the browser step, no other vitest browser run)
- npm run typecheck: clean, 12 s. npm run lint: clean, 59 s.
- coverage (`--coverage.reportsDirectory=reports/scratch/app-ui/r6/coverage`): 136 files, 2339 passed + 11 expected fail, exit 0 (thresholds met). Lines 99.52 %, statements 98.53 %, branches 87.87 %, functions 99.55 %; 763 s.
- npm run test:mesh: 2 files, 29 passed.
- npm run test:gpu: 12 files, 70 passed, 44 s.
- npm run test:browser (`VITE_UI_LOOKDEV=1`, the re-shoot): 14 files, 46 passed, 0 failed, 428 s.
- Earlier targeted run t1 (app + firstSwitch at 19acf3f): 9 of 10. W2F-N5 failed on the cycle's throw (decision 2), and everything else passed.

NEXT
1. Decisions 1-5 above.
2. Critic: W2A-I6/I10's controls, and U4/U5 as measured.
3. N23. Schlieren's margin at 1920, Exploded framing and labels, "Preparing the pressure field" for a quantity change, visual notes 5 and 7.

# Round 5 (2026-10-31)

DONE (TDD: each failing test committed first)
- **D4-95 item 1: the background warm-up is suspended around input and switches** (5800e4d TDD; fe31b1a; the Chrome case 63ed6d4).
  - `src/shell/warmUp.ts`: `next(frame, cpuMs, asked, { nowMs, switchPending })`, `input(nowMs)`, `suspended(nowMs)`, `QUIET_AFTER_INPUT_MS` = 1000. No background slot while a switch is pending, nor for 1 s after any input or after the switch is done. A cold switch still prepares its own view, with the slot rule kept, since the viewer waits for that one.
  - The worker: a switch is pending while `preparing` is set or the view is not yet settled in the asked mode (`settledFrames` 0, which covers the 1.4 s transition into Cutaway). The inputs are every message except `init` and `viewArea`; `viewArea` is the overlay's own layout report and follows the panels and the window, not the viewer. `diagnostics.warm.suspended` says whether the frame waited.
  - Unit tests: 6 cases. One starts a switch while the queue is warming Schlieren: no slot from the click until 1 s after the switch's last pending frame, then Schlieren again.
  - Chrome (`firstSwitch.test.tsx`, a new case): a switch into Cutaway as soon as Cutaway is warm, with the rest of the queue still warming (6 configurations queued at the echo). Checked every run: suspended from the echo until settled, 0 warm frames while suspended, then resumed. U2 is gated in a quiet run, FREEZE_MS every run.
  - The quiet run (10:20-10:29, `VITE_UI_QUIET=1`, after the critic's browser run had finished; `quiet.log`): `firstSwitch` and `warmStall`, 5 of 5 passed with every wall-time bar gated (U2, U3, the longest gap while warming).
- **D4-95 item 2: Schlieren's warm stall, found and fixed** (665ad81 TDD; 7d17994; GPU_FACTS M56 and M57 in 57ab2bc). **FLAGGED RENDER EDITS** in `post.ts` and `engineView.ts`. Path taken: found and fixed; Schlieren is not warmed at boot.
  - The cause was not the GPU process. Schlieren's first warm frame spent 645-706 ms of the calling thread's CPU, while a GPU ping each frame peaked at 73-161 ms. That frame built 44 pipelines, 42 of them for engine objects the boot had already drawn.
  - Why: three r186 keys its render contexts by the renderer's call depth, and its render objects by the render context (M56). Schlieren's composite read the scene depth before TRAA's chain, so its scene passes rendered a call level up. Every engine object got a second render object, a node build (~15 ms each) and a second pipeline.
  - Round 4's warm budget keyed objects by their render target, so it counted none of these as new. Its "slowest new object 3 ms" figure covered only the new objects (M57).
  - Fix 1 (`post.ts`): Schlieren's composite builds the beauty first, as a statement, as the other composites do. It now shares the boot's render objects. The image is the same, since the passes render once a frame (shots below).
  - Fix 2 (`engineView.ts`): the warm key is three's own render object key (the object, the material, the render context, the lights node and the pass), so a render context the budget has not seen is budgeted. A warm frame also reports `unbudgeted`, the pipelines built while drawing an object the budget did not count as new.
  - `tests/browser/warmStall.test.ts` warms every background configuration after the boot's, on the main thread, as the worker warms them. It records each one's frame CPU, frame gaps, a GPU ping, and every pipeline's object, material and render context (`reports/ui/warm-stall.json`). Checked every run: no warm frame builds an unbudgeted pipeline, and no configuration recompiles an object the boot drew.
- **D4-95 item 4 (the guard on the three internals)** (a90317a TDD; 1798fda). `src/render/threeInternals.ts` lists them, with the startup checks that throw if one moved; `post.ts` and `engineView.ts` call those checks. `tests/unit/render/threeInternals.test.ts` (Node, part of `npm test`) pins each against the installed three:
  - the revision (186) and the 0.186.1 pin;
  - `renderObject`'s parameters, and that `_renderScene` calls the instance's `renderObject` with `_currentRenderContext` set;
  - three's render object key (`RenderObjects.get`'s chain: object, material, render context, lights node) and its render context key (attachments, MRT, call depth);
  - `createRenderPipeline(renderObject, promises)`, whose promises path is `createRenderPipelineAsync`, and the draw that waits for `isReady`;
  - TRAANode's history target, previous depth node, jitter index and the six camera uniforms its updateBefore rolls;
  - the inspector's node frame.
- **D4-95 item 3 (the background warm-up under load)**: the slot rule is unchanged. It is measured below.
- **The re-shoot** (`docs/look-dev/ui/`, both sizes, every mode, the drawer, the solver; committed with the gate run at 3612355). I looked at every shot (notes below).
  - One shot missed the bar: in 1920's drawer shot, Core exhaust's leader ran under the open drawer to a part the drawer covers. Fixed in d1304f8 TDD and 3612355: a part whose anchor is under a reserved panel is not called out, in either layout.
- **W2A-N14** (7831ec1 TDD; 1d8dbed): the worker's fault paths are pure functions in `src/shell/faults.ts`. `stepFault` covers the throwing cycle step (SIM STOPPED, with its name and message). `createPostFaults` covers snapshot posts: fatal on the 3rd failure in a row, said once, with a good post restarting the count. The worker uses both; the messages are unchanged.
- **W2A-N20** (63ed6d4): measured in Chrome; nothing to warm. The solver field's first bind (Cutaway, then Data) and a quality change (the performance profile's 0.85 render scale, and back) compile no pipeline: frame CPU <= 7 ms, no frame gap over 17 ms. warmStall checks it every run.
- Not adopted, per D4-95: flowviz's dock and legend edits (flowviz round 4 is under review).

MEASURED (1366 x 768; `reports/ui/first-switch-*.json`, `reports/ui/warm-stall.json`; indicative, shared machine. "Before" is the round-4 source, 602f9bb, run today with the same tests.)

| | Before | After |
|---|---|---|
| Schlieren's warm, main-thread probe (warm frames / pipelines / max warm-frame CPU / longest frame gap / GPU ping) | 13 / 44 / 645-706 ms / 633-700 ms / 73-161 ms | 3-5 / 2 / 6-13 ms / 17 ms / <= 48 ms (5 runs) |
| U2, a switch while the queue warms (longest gap in the 3 s after the click) | 786 ms (a Schlieren warm frame in the window) | 95 ms; 84 ms in the gate run; **100 ms in the quiet run (gated)** |
| U2, Schlieren warmed first / Cutaway warmed first | 211 ms / (round 4: 89-706 ms) | 70 / 78 ms; gate run 115 / 88 ms; **74 / 105 ms in the quiet run (gated)** |
| Longest gap while the background warms to Schlieren | 667 ms (round 4: 593-1068 ms) | 166 ms; 357 ms in the loaded gate run; 189 ms quiet (Cutaway: 108 ms quiet) |
| Boot-to-ready (U3 <= 5 s) | 3.7-4.1 s | 3.4-4.8 s; 4.8-7.7 s in the loaded gate run; **3.6-4.8 s in the quiet run (gated)** |

- Item 3, the background warm-up (unchanged rule): all 9 configurations warm 8.5-10.1 s after ready. Cutaway is warm 3.0-4.8 s after ready on the quieter runs, but 45-48 s in the loaded gate run, because a slot needs the last frame under 8.3 ms of CPU. On the main-thread probe, Cutaway's own warm takes 45-52 warm frames (1.7-2.4 s) and builds 42 pipelines for its new objects, with at most 29-51 ms of warm-frame CPU. That is one large material let through ("one always let through"). In the quiet run, Cutaway was warm 3.2-4.2 s after ready, and the whole queue 20.9 s after ready in the switch case (the switch held it 2.5 s).
- A cold switch into Data: "preparing" after 161-225 ms, shown 3.8-4.4 s later, longest gap 111-119 ms.

NEEDS AN ORCHESTRATOR DECISION
1. **The quiet rule as read here:** a cold switch's own view still warms while suspended (otherwise it could never be shown), and `viewArea` is not an input. Both are in the unit tests.
2. **Cutaway's own warm frames** let one large material through each, up to ~30-50 ms of CPU, which is about two dropped frames at 60 fps, 45-52 times over ~2 s. Each is within U2 (the longest gap while warming to Cutaway is 114-280 ms), but under load the whole queue waits on the 8.3 ms slot rule (45-48 s to Cutaway in the gate run). D4-95 keeps the rule; both trade-offs stay as measured.
3. **The callouts' new rule** (3612355) hides a part whose anchor a panel covers. It is a UI display rule, like round 3's "Realistic and Schlieren call out only the fan and the exhaust".

NOT DONE
- Visual notes 5 and 7; flowviz's purple board (W2V-I7, D4-86); adopting flowviz's dock and legend edits (after flowviz merges, D4-95).

SHOTS (looked at, each against the bar: nothing clipped or overlapping, the labels on their parts, Schlieren framed in the free area)
- `1366-1-realistic.jpg`, `1920-1-realistic.jpg`: Fan at the fan face through the intake, Core exhaust at the nozzle.
- `*-2-cutaway.jpg`, `*-5-data.jpg`: eight labels, each on its part. At 1920 the axial row sits above the engine with four labels, the rest beside their anchors. At 1366 there is no room for the rows, so the general search puts them beside their anchors, clear of one another.
- `*-3-exploded.jpg`: no callouts (as before); the parts are clear of the panels.
- `*-4-schlieren.jpg`: the knife-edge grey, the engine a dim silhouette, the banded jet fading out before the right column at both sizes. The same framing and image as round 4.
- `*-6-drawer.jpg`: Data with Diagnostics open. Labels only for parts left of the drawer.
- `1920-data-solver.jpg`: the solver's field, badge and legend.

GOTCHAS
- three's render objects are per render context, and the context includes the renderer's call depth. A composite that reads a pass's texture before the node that renders it nested changes the depth that pass renders at, and every object in it is built again (M56). Build the beauty (TRAA's chain) first. warmStall's "recompiled" check catches it.
- `git checkout <rev> -- src/` for a before measure also stages the files; `git checkout HEAD -- src/` restores both.
- Detached runs: `reports/scratch/app-ui/r5/run.ps1` (waits for >= 2 GB free and for no other vitest browser run or playwright Chrome) and `gates.ps1`. A `-t` filter with quotes goes in a `.cmd` file (`u2case.cmd`). Dev port 5194 unused; no MCP page opened.

GATES @3612355 (detached, `reports/scratch/app-ui/r5/gates.ps1`; logs `gate-*.log` there)
- npm run typecheck: clean, 13 s. npm run lint: clean, 59 s.
- coverage (`--coverage.reportsDirectory=reports/scratch/app-ui/r5/coverage`): 127 files, 2223 passed + 11 expected fail, exit 0 (thresholds met); lines 99.47 %, statements 98.49 %, branches 87.53 %, functions 99.54 %; 838 s.
- npm run test:mesh: 2 files, 29 passed.
- npm run test:gpu: 12 files, 68 passed, 57 s (vitest-pool teardown warnings only).
- npm run test:browser (`VITE_UI_LOOKDEV=1`, the re-shoot): 14 files, 43 passed, 0 failed, 443 s, 3.8 GB free. This includes flowviz's indicative flow-visuals timing row, which failed in round 4 under load.
- The same gates also passed at 57ab2bc (before the callout rule): 127 files / 2222 + 11 expected fail; browser 14 files / 43 passed.
- Quiet run (`VITE_UI_QUIET=1`) at 3612355: firstSwitch and warmStall, 5 of 5 passed.

# Round 4 (2026-10-31)

DONE (TDD: each test commit first)
- **D4-91, the progressive warm-up** (357bbbb, d3f4ca1, 33bdf0e TDD; 1f0a49d, 27a120c, f5dd316, 2082e56). **FLAGGED RENDER EDIT** (engineView, post, passTimer, flowViz).
  - `src/shell/warmUp.ts` (pure): the configuration each view needs, BOOT_CONFIGS (Realistic with and without tracers), BACKGROUND_ORDER (Cutaway, Schlieren, Data:mach, Exploded, Data p/rho/T), a slot every 2 frames after a frame under 8.3 ms CPU, a 400-slot give-up (shown anyway, listed in `diagnostics.warm.gaveUp`), `shownView` (the asked view once warm, else the shown one plus `preparing`).
  - `EngineView.warmFrame(config, budget)`: one warm frame before the tick's real frame (which overwrites the canvas). New render pipelines go through createRenderPipelineAsync (three's compileAsync path) and draw once ready; new objects get at most 4 ms of own CPU a frame (nested passes timed apart, one always let through); TRAA's history, jitter and camera uniforms, the rotor motion's previous view-projection and the pass timer's medians are untouched. `warmUp(configs)` warms the boot configurations the same way and waits on them.
  - The worker posts `ready` after the boot configurations; the rest warm in the background. A view not yet warm is held: the shown view keeps running, the overlay shows "Preparing the <mode> view…" (role status), and the switch happens when it is warm. The settled count stays 0 while preparing (callouts and shots wait).
  - flowViz keeps one cut-plane material per quantity (no node rebuild per quantity switch).
- **W2A-I6, Schlieren's own check** (4b6ca8d TDD, 15fd68d). `tests/browser/lib/schlierenCheck.ts`: >= 30 % of the free area outside the engine at the knife-edge grey (0.4-0.6), the engine box's middle under 0.5 x that grey, the jet behind it with a luminance spread >= 0.08. Unit-tested on synthetic frames. In Chrome it must pass on the Schlieren shot and FAIL on the Realistic and Exploded shots (the controls), every run.
- **D4-91 item 3 + W2A-N19** (33bdf0e TDD, cf06c30). PHYSICS.md 3.5 rows U1 (amber below 5 %, red at or below 0, on the map only), U2 (first switch into a warmed mode <= 250 ms), U3 (boot-to-ready <= 5 s), both indicative. `src/hud/uiLevels.ts` mirrors them verbatim (its own mirror test; the T/C/L/P mirror is untouched). The map reads U1; the 5.0 % case is pinned normal (kills C1).
- **D4-92 (zz), the callouts** (07db72a, dd66262 TDD; eab74c9, 0bd12e8, 15fd68d, 2fb0730).
  - N13: the crossing prune cuts only when the best also shows every later label: 0 of 400 seeded probe cases short of the brute force (unit test).
  - `calloutPoint`: the closed views' Fan at the fan face on the far side, when the eye sees it through the intake (else the intake lip on the eye's side); the cut views' anchors on the upper cut face, so the bypass duct's is in the duct.
  - `layoutAxial`: in Cutaway and Data the labels sit in a row above and one below the engine's screen box (clamped under the top bar and over the station strip), alternating in axial order, each as near its anchor as the row allows, order kept. The row places go first in the general search, so its guarantees hold (no overlap, no panel, fewest crossings) and a label without room in its row gets an offset place.
  - Schlieren's framing: the overlay posts its free area (`viewArea`); entering Schlieren frames the engine and the near-field jet in it (`framedOrbit`: dolly out, at most to 0.6, and pan), leaving it restores the orbit; a camera preset cancels the restore.
- **Nits**: N15 (SIM STOPPED says "frozen until a reload"), N16 (the wall-time bars gate only with VITE_UI_QUIET=1; every run records them, fails a first-switch gap over 1000 ms, and checks the errors), N17 (each boot clears the slow message), N18 (pixelCap: ultra keeps the DPR up to the client's cap of 2), N19 (above).
- **FLAGGED RENDER EDIT in flowViz (2fb0730)**: the raymarch samples the gradient at an explicit level 0 (one mip, the same texels). It aimed at Schlieren's first-use stall (an implicit-derivative sample in a loop forces FXC to unroll it); the loaded run after it still showed ~1.1 s, so the cause is not settled (decision 1).

BOOT AND FIRST SWITCH (1366 x 768, `reports/ui/first-switch-*.json`; indicative, shared machine)
| | boot-to-ready | first switch, longest gap (echo) | background warm, longest gap |
|---|---|---|---|
| Before (round 3 code at cf87af0) | 10.8 / 12.7 s (warm-up 9.4-9.9 s) | Schlieren 99 ms (298), Cutaway 89 ms (113) | none (all at boot) |
| After, quieter run (27a120c) | 3.9-4.4 s | Schlieren 195 ms (183); Cutaway 706 ms (706, a Schlieren warm frame in the window) | Cutaway 108 ms, Schlieren 750 ms |
| After, loaded runs (f5dd316..2fb0730) | 3.9-7.7 s | Schlieren 205-636 ms, Cutaway 133-582 ms | 0.65-1.6 s |
- A cold switch into Data: "preparing" within 100-177 ms, shown 3.5 s (quiet) to 33 s (loaded) later, longest gap 123-171 ms, 47-540 snapshots while preparing.
- Background warm time to Cutaway: 5.2 s quiet, 17-34 s loaded (slots need a frame under 8.3 ms CPU).

NEEDS AN ORCHESTRATOR DECISION
1. **The background warm-up still stalls the GPU process once, about 0.65-1.1 s, on Schlieren's configuration** (and up to 1.6 s on a loaded run). The worker's CPU is not the cause: the slowest warm frame's new objects took 3-6 ms and its time outside the draws 1-2 ms; the stall is in the GPU process (the round-3 measure). Cutaway's many pipelines compile asynchronously with gaps of 108-113 ms (quiet). Options: (a) warm Schlieren at boot (about +1 s of boot, against U3's 5 s); (b) the render owner finds what in Schlieren's composite compiles on the GPU process's main thread (the level-0 sample did not remove it); (c) accept one ~1 s hitch a few seconds after boot. The test records it and gates it only in a quiet run.
2. Under load the background warm-up is slow (17-34 s to Cutaway), since a slot needs the last frame under 8.3 ms. A cold switch then waits behind "preparing" (33 s seen). A looser slot rule trades smoothness for speed.
3. The warm-up reaches into three r186 internals (pinned): `backend.createRenderPipeline`'s promises argument, the prototype `renderObject`, TRAANode's `_historyRenderTarget`, `_previousDepthNode`, `_jitterIndex` and camera uniforms (checked at creation, a rename throws).

NOT DONE (listed)
- N14: the worker's fault paths still have no worker-level test (a pure tick-fault function or a test CycleChoice that throws).
- N20: the solver's first bind is not warmed (it binds new textures; warming it means binding the solver field in a warm frame). A quality change compiles nothing new here (the profiles change the render scale and the DPR only); not measured in Chrome.
- The Schlieren stall (decision 1); visual notes 5 and 7; flowviz's purple board (W2V-I7, D4-86).

GOTCHAS
- A warm frame's pass inputs render nested inside the object that samples them (the output quad holds TRAA, which holds the scene passes): budget the objects' own time, not their inclusive time.
- The warm frame and the real frame share three's node frame: the pass timer's `beginFrame(true)` advances it, or the real frame would not re-render the passes.
- Runs were detached (`reports/scratch/app-ui/r4/run.ps1`, `gates.ps1`). Dev port 5194 unused; no MCP page opened.

GATES (code at 2082e56; STOP-CLEAN at the usage brake, so the last two are still running)
- npm run typecheck: clean, 14 s. npm run lint: clean, 64 s.
- coverage (`--coverage.reportsDirectory=reports/scratch/app-ui/r4/coverage`): 125 files, 2202 passed + 11 expected fail, exit 0 (thresholds met), 835 s.
- npm run test:mesh: 2 files, 29 passed.
- **UNRUN at handoff: test:gpu and test:browser.** They run in the detached gates script, PID 48328: status `reports/scratch/app-ui/r4/gates.status`, logs `gate-gpu.log` and `gate-browser.log` there. The browser step waits for >= 2 GB free and runs with VITE_UI_LOOKDEV=1, so it also re-shoots `docs/look-dev/ui/` (both sizes, every mode, the drawer). Those shots are uncommitted and **not looked at** (item 6 not done).
- Before the gates, the browser app suite (both sizes, all modes, the layout bar, the Schlieren check and its controls) passed at 2fb0730; the first-switch file failed there only on the background-warm gap (1.1-1.6 s, loaded), which 2082e56 now records and gates only in a quiet run.

NEXT
1. Read gates.status; if test:browser passed, look at every new shot in `docs/look-dev/ui/` against the bar (nothing clipped or overlapping, labels on their parts, the hierarchy reads) and commit them with their `*-shots.txt` (the Schlieren signature rows are in it).
2. Decisions 1-3 above. 3. N14, N20.

# Round 3 (2026-10-30)

DONE (each finding: its (TDD) commit, then the fix)
- **W2A-I1, the worker's faults on screen** (4b529f8 TDD, 3f531cb). A thrown cycle step posts a new `sim-stopped` message (src/shell/protocol.ts). The annunciators show SIM STOPPED with the message beside it, the clock reads "stopped" and Pause is disabled. A `fatal` always stops the app; no message-prefix test anymore. GPU ERRORS (n), MOCK RASTER ON FRAME / FAILED (from the new `AppDiagnostics.raster`) and REFUSED (n) are chips that open Diagnostics. Pure: `faultAnnunciations` (src/hud/annunciators.ts). Tests: `tests/unit/ui/faults.test.tsx` (the store's `receive` for every message, which kills M13; Status's boot and fault screens, which kills M14; the chips) and simCore's equal-seq (M10) and refused-echo (M11) pins. N5's dead-guard fake (M1) is fixed too: the fake reads healthy after dispose.
- **W2A-I2 + D4-87, the fan map at idle** (fff91a3 TDD, 3fcdbc7). Each map is drawn from its own lowest speed line (`lowestMapPercent`, `chartSpeedPercents`: the fan's 30.6 %, the HPC's 44 %), so the idle fan point (20 %, 65 kg/s, PR 1.02) is inside the chart. A point still off the plot is clamped to its edge with a chevron (`plotPoint`). Below the lowest line, `surgeMarginView` shows the margin dimmed with a "below map" tag and a hollow point. Amber (< 5 %) and red (<= 0) apply only on the map.
- **W2A-I3, the callouts** (df1853d and df2cd39 TDD, 9ccc1dc; Schlieren's rule in ae0b8bf).
  - The layout measures each label as drawn (border-box, one line; an unplaced label is drawn hidden so it is measured too), so the reserved box is the rendered box.
  - A bounded search (2000 nodes, pair tests precomputed, about 1-2 ms) places the most labels with the fewest leader crossings (`leaderCrossings`). It has more outward offsets and is memoized on the anchors' values.
  - Realistic and Schlieren (both the closed engine) call out only the fan and the exhaust (`calloutShownIn`).
  - Callouts show only on a settled view (N10). The reserved panels are measured on resize and panel toggles (N10). Every value has its unit (N8).
  - The browser layout bar now checks the drawn labels against each other, the reserved blocks and text cut-off, plus leader crossings. It passes in every mode at both sizes.
- **W2A-I4 + D4-88, warm-up and the settled signal** (df1853d TDD, 094ccaf, 64f7732). **FLAGGED RENDER EDIT** in src/render/engineView.ts: `warmUp()` and `viewSettled()`.
  - `warmUp()` renders one frame of each configuration and waits for `onSubmittedWorkDone` after each: Cutaway with tracers, Data with tracers at p, rho, T and Mach, Schlieren, Exploded, Realistic with tracers, and the boot view last. It then puts the state back and reports each step's wall and frame-CPU ms.
  - I did not use `compileAsync`: three compiles for the renderer's current target and MRT, not the post passes', so only a real frame compiles the variants the app uses.
  - The worker calls it after the MOCK is bound and posts `ready` only after it. The canvas is hidden while booting.
  - `src/shell/settle.ts` counts the frames the view has been settled in the asked mode (`AppDiagnostics.view.settledFrames`). The shots wait for SETTLED_FRAMES (30) and two more snapshots, not a fixed 1.5 s.
  - `setCycleState`'s source is now required (N3).
- **W2A-I5, the lever** (df1853d TDD, beef497). The lever keeps a local value and its seq (`store.send` returns the seq) until the snapshot's `lastCommandSeq` reaches it (`leverShown`). RTL: quick changes send 0.01, 0.02, ... 0.05. In Chrome, five real ArrowUp presses land at 0.05 in the worker (the W2F-N5 test).
- **D4-85, the pixel cap** (df1853d TDD, 094ccaf). `src/shell/pixelCap.ts` caps the backing store at 1920 x 1080 px (2.07 MP) up to quality high, at the true DPR on ultra (the client's cap of 2 stays). The worker applies it on resize and quality changes. Unit-tested; Diagnostics shows the backing store.
- **Nits** (ae0b8bf TDD, f58e846, c54b3ca):
  - N1: the field choice's rejection goes to the errors, and Diagnostics says "switching to the solver…" while it starts.
  - N2: 3 failed snapshot posts in a row are fatal, and `onmessageerror` is handled.
  - N3: an unknown coupling is "uncoupled" on the badge (a deliberate test change), and the dock's default is pinned (M8).
  - N4: the ledger splits rows on unescaped pipes.
  - N6: sub-idle ends a held episode (src/cycle/model.ts, one line).
  - N7: a late raster reply is dropped; a raster worker silent for 10 s is given up on, visibly.
  - N8: the limiter in words ("RUN · idle floor"), "Burner lit/out", a dash for an unmeasured solver, SOLVER IDLE when it is not drawn.
  - N9: --faint #838c9b and the panel at 0.86 alpha (4.9:1 over a mid grey; was 3.3:1). The drawer's panels are nearly opaque (visual note 4).
  - N10: `projectPoint` is tested.
  - N11: `startClient` resets the session, and the spinner says so after 60 s.
  - N12: round 1's shot moved to `docs/look-dev/ui/before/`.
- d6fed99: flowviz's 40000-seed zone test has an explicit 60 s runtime limit. Under coverage on the loaded machine it took 5.1 s, past vitest's 5 s default. It is not a threshold.

FIRST SWITCH (W2A-I4; `tests/browser/firstSwitch.test.tsx`, 1366 x 768, a fresh worker each)
- Measured: the longest gap between snapshots in the 3 s after the click, the window's end included; snapshots normally come every 50 ms. The bar, new and pre-registered in the test: <= 250 ms.

| | Schlieren: echo / longest gap | Cutaway: echo / longest gap | Boot (render to ready) |
|---|---|---|---|
| Before (two runs) | 1517 / 1323 ms; 1848 / 1581 ms | 461 / 421 ms (window not yet fixed); none / 2818 ms | 2.4-4.7 s |
| After (the gate run) | 98 / 52 ms | 87 / 70 ms | 9.9-10.6 s |
| After (loaded runs) | 230-326 / 75-188 ms | 104-160 / 82-127 ms | 14-26 s |

- The warm-up costs 9.1-23 s at boot, behind the spinner. Of that, the Cutaway frame takes 6.9-14.5 s, but only 1.1-2.6 s of it is the worker's CPU. The rest is the GPU process compiling pipelines (D3D12). Schlieren takes 1.6-3.3 s, the four Data quantities 30-260 ms each, and Realistic with tracers 0.24-1.0 s.
- The Schlieren and Cutaway shots now show the right views (looked at): the knife-edge grey with the engine as a silhouette, and the wedge fully open.

RENDER TIME (D4-85; indicative, shared machine; `reports/ui/render-*.json`)
- Chrome ran at DPR 1 this round, not round 2's 1.5x: the shots are 1920 x 1001 px. So 1920 x 1001 renders 1.92 MP, under the cap, and the cap is not exercised in Chrome. It is unit-tested.
- Realistic over a full window: 10.1 ms at 1920 x 1001 and 9.9 ms at 1366 x 768, against P4's 8 ms at 1080p.
- Per mode at 1920: Realistic 13.4, Cutaway 16.0, Exploded 8.6, Schlieren 12.4, Data 12.6 ms (the medians shortly after each switch).
- Round 2 measured 27.9 ms at 4.33 MP.

NEEDS AN ORCHESTRATOR DECISION
1. **The warm-up's boot cost: 9-23 s on the shared machine (boot 10-26 s, against 2.4-4.7 s before).** About 80 % of it is the GPU process compiling Cutaway's pipelines, every internal mesh visible at once. Options:
   - (a) keep it, as D4-88 says;
   - (b) compile asynchronously: three's `compileAsync` with the scene and rotor passes' render target and MRT set on the renderer, so Dawn's `createRenderPipelineAsync` can compile in parallel. That is a deeper render edit into three internals;
   - (c) fewer distinct pipelines in the cut view, the render owner's.
2. The browser suite's lit-centre bar is skipped for Schlieren (a test change, in the commit). The true Schlieren draws the engine as a 0.22 silhouette, and round 2's shots passed the bar only because they showed the exploded engine.
3. App-ui's own display levels, not in PHYSICS.md: the SM caution under 5 % and the warning at <= 0; the 250 ms first-switch bar; Realistic and Schlieren calling out only the fan and the exhaust.

NEXT
1. Decision 1. Also, the solver field's first bind (`bindSolver`) may compile new pipelines; it is not warmed.
2. D4-84's held-step budget (the cycle round): the held step is still 534 ms (`reports/ui/frame-cost.json`). D4-86 (flowviz's Data-plane board).
3. In Realistic the fan's anchor projects onto the nacelle skin. Anchor the closed views at the fan face. In the cut views the callouts still cluster on the core.
4. Not done: the app-level fallback case in Chrome (a failed solver start inside `<App/>`, N5's last item) and worker-level tests of N2's fatal. Visual notes 5 (a quadrant lever) and 7 (the T-s burner along its isobar).
5. Round 2's NEXT 2-5: colormaps, `selectedComponent`, the setBleed/setAmbient UI, a stall-margin trend.

GOTCHAS
- A browser run fetches the worker's modules again for each new Worker. Editing worker-imported `src/` files during a run changes what the later tests boot.
- The first-switch stall is mostly in the GPU process: the worker's frame CPU missed it (91 ms against a 2.8 s gap). Measure snapshot gaps on the main thread.
- Chrome's DPR was 1 this round. Check `diagnostics.backingStore` before reading render times.
- A hook asks for facts before `Remove-Item`. The tests overwrite their outputs, so nothing needs deleting.
- The gates ran as one detached script (`reports/scratch/app-ui/gates.ps1`, status per step, waiting for >= 2 GB free before test:browser). Dev port 5194 was not used, and no MCP page was opened.

GATES (typecheck, lint, mesh, gpu and browser at ab2866d; since then only a unit test's runtime limit, d6fed99. Coverage at d6fed99)
- npm run typecheck: clean, 16 s. npm run lint: clean, 66 s.
- npm run coverage (own reportsDirectory): 120 files, 2166 passed + 11 expected fail, exit 0 (thresholds met), 876 s; statements / branches / functions / lines see the log %. The first run (at ab2866d) failed only on the 5 s timeout fixed in d6fed99.
- npm run test:mesh: 2 files, 29 passed.
- npm run test:gpu: 12 files, 68 passed, 65 s (vitest-pool teardown warnings only).
- npm run test:browser (VITE_UI_LOOKDEV=1, the re-shoot): 13 files, 40 passed (flowviz's 34, app 4, first switch 2), 0 WebGPU errors, exit 0, 405 s, 3.8 GB free.
# Round 2 (2026-10-30)

DONE
- 4c19678 `git merge main` @7d6495c: no conflicts, and typecheck was clean on the merge. The merge commit keeps git's default message, because a hook blocked the amend to a "W2-app-ui:" message.
- **D4-82 in the shell** (0b1b32d (TDD), 8bd9550). No contract edit this round.
  - `src/shell/fieldSwitch.ts`: the drawn-field switch over flowviz's `createFlowFieldLink`. The MOCK is labelled `'mock'` and the solver `'uncoupled'` (until W3).
  - The solver starts once (the worker's boot start). Going back to the MOCK keeps it alive and idle. A solver the link disposed after a failure is not resurrected: asking for it again falls back with the reason it failed. Only the latest choice may bind, so a slow solver start cannot draw over a MOCK chosen after it.
  - A failed start, a lost or diverged solver, or a throwing step falls back to the MOCK **visibly**: the reason is in `AppDiagnostics.field`, which the badge, the legend and the annunciator show. It is **never silent**: `console.warn` plus the worker's error list.
  - Test: `tests/unit/shell/fieldSwitch.test.ts` (7 cases: the MOCK start, the uncoupled solver stepped only with a budget, a failed start, lost mid-run then not resurrected, diverged on a NaN residual, back to the MOCK keeps it idle, the latest choice wins).
  - `src/app/simWorker.ts` draws only through the switch. `sources.flow` is `switch.drawn()` (derived, W1F-N1). The snapshot's flow status goes through `sanitizeFlowStatus`. The solver steps at D4-2's budget only while it is drawn and a flow mode draws it.
- **D4-83** (same commits): `src/shell/viewState.ts`.
  - Realistic always draws its flow mode (haze, schlieren). The tracers follow `overlays.particles`.
  - A mode switch (`setViewMode`, or a `setRenderState` that changes the mode) puts the tracers at that mode's default (Realistic and Schlieren none; Cutaway and Data on).
  - `APP_DEFAULT_VIEW`: Realistic without tracers, `cutPlaneField` `'mach'` (the Data mode's own quantity).
  - Tests: `viewState.test.ts` (6) and `simCore.test.ts` (the D4-83 case). The default-view case now expects `APP_DEFAULT_VIEW` instead of the contract's defaults: a deliberate test change, for the decision.
- **The badges** (`src/hud/annunciators.ts`, `hud.test.ts`).
  - `provenanceBadges(sources, link)` gives "FIELD: solver (uncoupled until W3)" (cyan), "FIELD: SOLVER (coupled)" (for W3), "FIELD: MOCK" and "FIELD: MOCK fallback" (amber, with `provenanceLabel` and the reason as the detail).
  - `fieldFallbackAnnunciation` gives "MOCK FALLBACK: <reason>" in the annunciator row.
- **NEXT 1, the RTL suite** (6b7cc00 (TDD), 317665b, bc2c0c3): `tests/unit/ui/overlay.test.tsx`, 17 cases under happy-dom, with `fixtures.ts` building a real snapshot from `createSimCore({ cycle: createCycleModel() })`. `vitest.config.ts` includes `tests/unit/**/*.test.tsx`. The cases:
  - the N1, EGT and N2 dials are meters with the snapshot's values;
  - the lever sends `setThrottle`; a mode radio and the 1-5 keys send `setViewMode`;
  - a held gas path shows GAS PATH HELD with its W2F-I1 cause and the count, as text beside the badge;
  - the ledger renders every row of PHYSICS.md §1 and expands one;
  - every button, switch, radio, slider and select has a name;
  - D4-82: the uncoupled badge and legend; a fallback shown on the badge, the annunciator and the legend; the asked-for MOCK shows no fallback; the drawn-field switch asks for the solver even when it is not running; the diagnostics name the fallback;
  - the camera presets, the D4-83 tracers switch, the Data view's cut-plane field;
  - the frame-cost rows;
  - a new snapshot re-renders the overlay.
- **NEXT 2, the browser suite** (23da970, d714547, f55f13b): `tests/browser/app.test.tsx`, 4 tests.
  - `<App/>` boots the D2-4 worker on the real model, with a fresh store per test.
  - At 1920 x 1001 and at 1366 x 768 it steps through all 5 modes. Each mode must show 0 gpu-error/fatal messages and 0 worker errors, and the centre of the view must not be flat (luminance spread > 0.03 and lit fraction > 0.02; measured 0.146-0.284 and 0.134-0.859).
  - It shoots each mode and the open drawer. The shots go to `reports/ui/`; `VITE_UI_LOOKDEV=1` writes them to `docs/look-dev/ui/` (as flowviz's W2V-N8).
  - D4-82 in Chrome: with the solver chosen, the badge and the legend say "solver (uncoupled until W3)" and the solver steps.
  - W2F-N5: the frame cost on the part-power fit's ramp (below).
- **NEXT 3, the layout** (d714547 (TDD), c66c1b1, f55f13b). The browser suite's layout bar is: at both sizes, in every mode and with the drawer open, no block off screen, none cut off (a column or panel whose content overflows it), no two blocks overlapping, no two chart labels overlapping, no two dials overlapping. Before the fix it found the four handoff items and four more: the "30" tick over the axis title, the T-s "45" over "5", "Tt K" over "800", and the open panels pushed off screen. It now passes.
  - The top bar is one row. The mode keys hide below 1500 px, and the panel switches moved to the head of the right column.
  - The engine display: N1 and EGT above, N2 beside the FF, thrust, TSFC and start readouts.
  - The dials' 210-degree sweep now has its gap at the bottom, where the readout sits, and the viewBox fits the arc. This was the N2 crowding: the arc drew outside its SVG box.
  - The controls: the lever beside the fuel, start and ignition switches, with the reset and fault rows under them.
  - The charts are 300 x 168, with the y titles up the left edge and the x ticks above the x title.
  - Labels: `placeSpeedLabels` in `src/hud/compressorMap.ts` places the round tens first and drops the 95 and 105 that crowd the HPC's 100. `placePointLabels` in `src/hud/labels.ts` places the T-s station labels. Both are unit-tested.
  - The station strip has equal columns.
  - Diagnostics and What's simulated open as a drawer at the view's right edge, which scrolls on its own. They no longer push the maps or the T-s off screen.
  - I looked at every shot. Notes are in the decisions below.
- **NEXT 4, the cost per frame, measured** (23da970). The numbers are below. **The MOCK raster moved off the frame**: `src/app/mockRasterWorker.ts`, with the scheduler `src/shell/mockRaster.ts` (3 tests): one raster in flight at a time, a new one when N1 moves 1.5 % or after 2 s. If the raster worker fails, it falls back to rastering on the frame and says so.
- **NEXT 5, the cheap parts.**
  - `cutPlaneField` drives `setFlowQuantity` for the Data plane: `CUT_PLANE_FIELDS` = pressure, density, temperature, mach, mapped to p, rho, t, mach. The other contract fields have no plane quantity, so they are not offered rather than drawn as something else. Cutaway keeps its velocity magnitude.
  - Camera presets: 4 buttons in the dock.
  - The tracers switch.
  - The Diagnostics frame budget adds the worst and the held cycle step and the off-frame MOCK raster.
- Docs: LOOKDEV.md has a new section, "The app shell", with the shot table.

SCREENSHOTS (`docs/look-dev/ui/`, taken by the browser suite with `VITE_UI_LOOKDEV=1`, at CSS size; the shared Chrome runs at 1.5x)
- `1920-1-realistic.jpg` … `1920-5-data.jpg` and `1366-1-realistic.jpg` … `1366-5-data.jpg`: the 5 modes at each size.
- `1920-6-drawer.jpg` and `1366-6-drawer.jpg`: Data with the drawer open.
- `1920-data-solver.jpg`: the solver's field, badge and legend.
- `*-shots.txt`: each shot's centre statistics (no layout problems listed).
- `01-realistic-idle.jpg` is round 1's (the old layout), kept for comparison.
- The drawer shots predate bc2c0c3's two extra diagnostics rows. The layout bar passes with those rows: the drawer scrolls.

FRAME COST (NEXT 4: in the worker, Chrome at 1.5x, Arc, 1366 x 768; another builder's jobs were on the machine, so these are indicative, not D0-1)
- Matched cycle step: median 1.7-1.9 ms at idle, 2.8-3.6 ms over a slam (reference model and part-power fit).
- Worker frame CPU (the sim plus the render submit): median 6.6-9.5 ms.
- **Held step (W2F-N5), on the W1K-I2 part-power fit's 1 s lever ramp** (the w2f-c12 probe's case; `<App cycle="partPowerFit"/>`):
  - 162-178 lost solves;
  - the held cycle step costs a median of 551 ms, 602 ms and 411 ms in three runs (the last is the gate run), up to 682 ms;
  - the held frame costs 414-605 ms, 25-36x the 16.7 ms frame; the frame rate falls to 8-31 fps;
  - a Node cross-check of the same model (`reports/scratch/app-ui/cost.ts`, not committed) gives 452 ms held against 1.66 ms matched, about 270x;
  - so W2F-N5's "12x" is the solver-call count, not the time: each failed call iterates to its limit;
  - the reference model, which the app runs by default, had **0** lost solves on the same ramp.
- **MOCK raster** (near 1024 x 256 + far 512 x 108): 152-361 ms of CPU per raster in the worker (about 515 ms in Node).
  - On the frame thread it stalled the render and the sim clock (`MAX_WALL_STEP_S` clamps the step) every 2 s at idle and every few frames in a slam. Run 1 of the slam only reached N1 31 % in 12 s for this reason.
  - It now runs on its own worker: the frame no longer pays it, and the slam reaches the held region.
- GPU (the diagnostics, indicative): the engine render 18.4 ms at 1366 x 768 (2.36 MP backing store) and 27.9 ms at 1920 x 1001 (4.33 MP), in Data, on the shared machine. Flow visuals 0.8-1.1 ms, the solver 2.9 ms at its 2-iteration floor (D4-2's budget is 0 ms there).

NEEDS AN ORCHESTRATOR DECISION
1. **W2F-N5, the held frame breaks 16.7 ms by 25-36x (414-605 ms).** No budget was loosened. My proposals, in order:
   - (a) The cycle owner bounds the retry while held: only the direct solve from the held point each step, and the full halving walk at most once per 0.5 s of sim (the critic's "once per 0.1 s" idea, extended). That makes most held frames cost about a matched step, with one bounded spike.
   - (b) Better still, the retry gets a CPU budget per step (for example 4 ms) and continues on the next step (an incremental continuation).
   - (c) For the app's robustness either way: run the cycle on its own worker, apart from the render worker's rAF, so the render holds 60 fps and the clock shows the sim lagging. This changes D2-4's single sim+render worker.
   - The default (reference) model shows no hold on the ramp, so this bites only on the fit calibration or a hard transient.
2. **Render pixels on a 1.5x display.** The client caps the DPR at 2, so 1920 x 1001 renders 4.33 MP, 2.1x P4's 1080p, and the measured engine render (27.9 ms, shared machine) leaves D4-2's solver at its floor. Proposal: cap the backing store at 1080p-equivalent pixels for quality ≤ high, with ultra at the full DPR. That is one pure function in the client or the worker. It is a look-versus-frame-rate decision, so I did not make it. A quiet-machine capture of the app would settle the numbers.
3. **W2V-N21 is very visible in the app.** At ground idle the Data plane is almost all the darkest viridis purple (Mach about 0 outside the nacelle): `1920-5-data.jpg`. It is flowviz's (a lower opacity outside the nacelle, or a smaller rMax). It would lift the app's Data view more than anything on the overlay.

NEXT (in order; not W3)
1. The decisions above: the held retry or a separate sim worker; the render pixel cap.
2. Colormaps. The contract's `ColormapId` (viridis, magma, inferno, plasma, cividis, balance) is not the flow visuals' set (viridis, inferno and diverging, fixed per quantity in `src/flow/viz/fields.ts`), so offering it needs flowviz to bake LUTs per contract map. Not wired.
3. `selectedComponent` (click a part: highlight it and its callout), and the callouts in Exploded (they do not follow the explode offsets).
4. The `setBleed` and `setAmbient` UI (the title says "SLS ISA"; the ambient belongs with W3's scenarios).
5. A stall-margin trend, and a "sim lagging" clock indicator if NEXT 1 picks the separate sim worker.

GOTCHAS
- `page.screenshot` in the shared Chrome is at the OS's 1.5x scale (2880 x 1503 for 1920 x 1001). The suite scales its JPEGs to the CSS size.
- The store is a module singleton. A browser test must reset it (`useApp.setState(fresh, true)`) before it boots another `<App/>`, or the last test's snapshot passes for the new app (run 1's D4-82 failure).
- `Start-Process … -ArgumentList` joins its elements without quoting. Put the command in literal double quotes (`'"npx vitest …"'`), and pass `-ExecutionPolicy Bypass`, or the detached script dies before it writes its status file.
- A layout check must clip a block to its scroll container (`shown()` in the test), or a panel scrolled inside the drawer reads as off screen.
- The flow quantities (`FieldQuantityId`) have velocity magnitude, which no contract `FieldId` names. So Cutaway keeps its own quantity, and `cutPlaneField` drives the Data plane only.
- Dev port 5194. No dev server or MCP page was opened this round; the browser suite drives its own Chrome.

GATES @016680a
- npm run typecheck: clean.
- npm run lint (ESLint --max-warnings 0 + Prettier): clean, 63 s.
- npm run coverage (includes npm test; own reportsDirectory): 118 files, 2122 passed + 11 expected fail, exit 0 (thresholds met), 837 s. Statements 98.36 %, branches 87.36 %, functions 99.34 %, lines 99.33 %. New modules: src/shell/fieldSwitch.ts, viewState.ts, mockRaster.ts and src/hud/labels.ts at 100 % lines.
  - The first coverage run (at bc2c0c3) timed out round 1's `hud.test.ts` "inside its surge line" at vitest's 5 s default (11.6 s on the loaded machine). 016680a gives the model-stepping describes the cycle tests' explicit 120 s.
- npm run test:mesh: 2 files, 29 passed.
- npm run test:gpu: 12 files, 68 passed, 59 s.
- npm run test:browser: 12 files, 38 passed (flowviz's 34 + tests/browser/app.test.tsx's 4), 0 WebGPU errors, exit 0, 392 s, with 2.6 GB free. The run left docs/ clean; its frame-cost record gives a held cycle step of 411 ms median (max 541), a held frame of 414 ms, a matched step of 3.0 ms and a worker frame of 6.2-6.9 ms.
- All long gates ran detached, one at a time (`reports/scratch/app-ui/run.ps1`, a status file each).

# Round 1 (2026-10-29)

w2/app-ui: STOP-CLEAN at the usage brake (84 %). Priorities 1-3 are built and boot in Chrome on the real cycle model. Priority 4 is partial: unit tests only, no RTL or browser suite yet, one screenshot. (Stacked on w2/flowviz @2cfd469; HEAD: see `git log -1`, the handoff commit.)

DONE
- b68446c (TDD), 063b067 `src/shell/simCore.ts`: the pure, thread-agnostic sim core. It applies commands in seq order (an invalid command or a stale seq is refused, not applied), steps the clock (advanceClock, MAX_WALL_STEP_S) and the cycle, and publishes frozen snapshots through nextSnapshot.
  - Provenance is derived, never declared (W1F-N1): `sources.cycle` is `cycle.source` and `sources.flow` is the bound field's source. The tests pin mock to 'mock' and the real model to 'model'.
  - `runScenario` is refused with a message ("not available in this build (W3)"); it is not faked.
  - Starts at ground idle (fuel RUN, ignition auto). A reset restores the inputs that match the reset state.
  - New dev dependencies (exact versions): @testing-library/react 16.3.3, @testing-library/dom 10.4.2, @testing-library/user-event 14.6.8, happy-dom 21.0.4. They are for the RTL suite, which is **not written yet** (NEXT 1).
- 75a… (TDD), cbc866b: the pure view-model in `src/hud/`, covered by `tests/unit/hud/hud.test.ts` and `tests/unit/shell/orbit.test.ts`.
  - `compressorMap.ts`: speed lines and the stall-line surge line on the model's own scaled maps (`referenceEngine().maps`), in the frame the state reports. A test puts the idle and take-off points inside the line. Also the trail, scales and nice ticks.
  - `tsDiagram.ts`: Tt against s − s0 from the stations and the gas tables, plus the Pt0 and Pt3 isobars.
  - `callouts.ts`: deterministic collision-free label placement (10 candidate offsets, reserved panel rects, on screen, never over another anchor's dot).
  - `ledger.ts`: parses PHYSICS.md §1 itself.
  - `format.ts`: SI and US units, cockpit EGT in °C, FF per hour, a dash for missing values.
  - `annunciators.ts`: the gas path, flags, solver and provenance badges.
  - `src/shell/orbit.ts`: the orbit state, plus the keyboard map (arrows, +/-, [ ]).
  - `src/shell/protocol.ts`: the worker messages (FrameBudget, AppDiagnostics).
- 9fab970 (TDD), 01019e3 **W2F-I1 fixed.** `attempt` in `src/cycle/matchedSolve.ts` records why a solve was refused: a thrown error by `name: message` (so a TypeError can't pass for a physical loss), a residual not below 1e-6, or a non-physical root (BPR). The model keeps the last cause and exposes `lostSolveCause()` (`CycleDiagnostics`; `createCycleModel` returns `CycleModel & CycleDiagnostics`). It is logged once per held episode with `console.warn`. The contract is unchanged. Test: `tests/unit/cycle/lostSolveCause.test.ts`.
- 084adf7 `src/app/simWorker.ts`, the D2-4 worker. It holds the EngineView on the OffscreenCanvas, the real cycle model, and the GpuFlowSolver on the view's device with FLOW_SOLVER_LIMITS (130k asset).
  - Each rAF it advances the core and hands the state to the view, then steps the solver at D4-2's budget (`solverBudgetMs` from the view's measured render and flow-visual medians, read every 15 frames as P1 does), orbits, renders, and publishes every 3rd frame (about 20 Hz).
  - The MOCK field is rasterized from the real cycle state when N1 moves 1.5 % or after 2 s, and is labelled 'mock'.
  - A throwing cycle step stops the sim, posts `fatal` and keeps rendering. GPU errors and device loss are posted as they happen, and the loss also feeds `flow.reportGpuError`.
  - **Flagged edit** in `src/render/engineView.ts`: `setCycleState(state, source)` drives the spools and glow from the app's state, and `stats().cycleSource` was added. With null, or never set, the view keeps its old MOCK behaviour, so look-dev, the benches and P1 are unchanged.
- 2fd76f8 the UI.
  - `src/app/client.ts`: creates the worker, transfers a fresh canvas per mount (StrictMode), owns DPR and resize (ResizeObserver + matchMedia), and is the OrbitControls event proxy (pointer drag, wheel, keys become OrbitInput messages).
  - `src/ui/store.ts`: zustand store, with seq-stamped commands and the trails.
  - `src/ui/instruments.tsx`: N1, EGT and N2 dials with the definition's redlines, the amber EGT max-continuous band and the N1-target bug, all role=meter. Also FF, net thrust, TSFC and the start phase, and the throttle quadrant: a vertical range lever with detents, the fuel lever, the start switch, ignition, reset and fault injection.
  - `src/ui/charts.tsx`: the fan and HPC maps (speed lines, dashed surge line, a viridis-faded trail, the point, SM and η), the T-s chart and the station strip.
  - `src/ui/panels.tsx`: the top bar (radiogroup mode switch, keys 1-5, pause, time scale, quality, units, panel toggles, provenance badges), the annunciators (aria-live), the What's simulated panel (`docs/PHYSICS.md?raw`, expandable rows), the diagnostics (gasPathSolve status, lostSolves (D4-17), the cause (W2F-I1), solver status/iterations/residual, the drawn-field switch, the D4-2 budget bar against 15 ms, cycle and worker CPU ms, fps, errors and refused commands) and the callouts (layout above, leader lines).
  - `src/ui/global.css`: dark tokens, cockpit status colours, tabular numerals, focus rings, reduced motion.

SCREENSHOT
- `docs/look-dev/ui/01-realistic-idle.jpg`: Chrome via the MCP, 1925 × 1001, the app at ground idle on the real model (CYCLE: MODEL, FIELD: MOCK), Realistic, t = 10.8 s. The callouts don't collide; the maps show the trail on the model's maps.

NEXT (in order)
1. RTL tests in `tests/unit/ui/*.test.tsx` with `// @vitest-environment happy-dom`. vitest.config.ts `include` needs `tests/unit/**/*.test.tsx`. Build a snapshot from `createSimCore({ cycle: createCycleModel() })` and set it in `useApp`. Assert:
   - the dials are meters with values;
   - the lever's change sends setThrottle;
   - a mode radio sends setViewMode;
   - a held gas path shows "GAS PATH HELD" with the cause;
   - the ledger rows render;
   - every button has a name.
2. `tests/browser/app.test.tsx`: render `<App/>` in the browser suite. Wait for `ready` and a snapshot, step through the 5 modes, assert 0 gpu-error/fatal messages and that the canvas has content. Then take screenshots of every mode into `docs/look-dev/ui/` (Cutaway, Exploded, Schlieren and Data are not yet shot; the browser wasn't driven past the boot).
3. Layout polish seen in the screenshot:
   - the Controls panel is cut off at 1001 px tall, so the left column scrolls. Make the dials smaller or put the quadrant beside them;
   - the N2 dial crowds the N1 readout;
   - the HPC map's 95/100/105 labels overlap;
   - the T-s panel sits below the fold.
4. Measure, in the worker, what the cycle step and the MOCK re-raster cost per frame (diagnostics shows the cycle CPU ms). W2F-N5: a held step costs about 12× a normal step, so check the frame stays inside 16.7 ms while held.
5. Not wired yet:
   - `cutPlaneField` → `setFlowQuantity` (FieldId and FieldQuantityId differ);
   - colormaps;
   - `selectedComponent`;
   - setBleed and setAmbient UI;
   - camera presets UI (the protocol has 'camera').
   Callouts are hidden in Exploded (they don't follow the explode offsets).
6. The solver runs uncoupled (ambient at rest) until W3, and the diagnostics say so. The drawn-field switch lets the user pick it.

GOTCHAS
- Usage brake: this round stopped at 80-84 %, so the gates below were only partly run.
- `transferControlToOffscreen` works only once per canvas: the Viewport creates its canvas in the effect.
- `docs/PHYSICS.md?raw` is imported by the UI: the ledger panel is the document itself.
- Dev port 5194 is used for this branch. Nothing is left running (the vite PID was killed and the MCP page closed).
- A formatter hook rewrites files on save, so re-read before Edit.

GATES @2fd76f8 (+ the lint fix in the handoff commit)
- npm run typecheck: clean.
- npm run lint: clean (ESLint --max-warnings 0 + Prettier), after the client.ts fix in the handoff commit.
- unit (tests/unit/shell + hud + cycle, after the lint fix): 259 passed + 5 expected fail, exit 0.
- Not run this round: coverage, test:mesh, test:gpu, test:browser (NEXT 1-2).
