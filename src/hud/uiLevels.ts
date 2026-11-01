// D4-87, D4-91 and D4-97: the app shell's display levels, pre-registered in docs/PHYSICS.md 3.5
// and mirrored here verbatim (tests/unit/hud/uiLevels.test.ts checks the text and the numbers).
// The compressor maps' surge-margin annunciation reads U1; the browser suite's first-switch, boot
// and cold-switch bars read U2-U4 (indicative; they gate only an official quiet run, W2A-N16); the
// cut views' framing reads U5; U6 and U7 are recorded rows with no bar (D4-97 item 4).

export const UI_ROWS = {
  U1: {
    checkText:
      'Surge-margin annunciation on the compressor maps (D4-87): on the map only; an operating point below the map\'s lowest speed line shows its margin dimmed and tagged "below map", with no level',
    passText: 'amber (caution) below 5 %; red (warning) at or below 0 %; normal at 5 % and above',
  },
  U2: {
    checkText:
      'First switch into a warmed view mode (D4-91): the longest gap between snapshots on the main thread in the 3 s after the click (`tests/browser/firstSwitch.test.tsx`, 1366 x 768)',
    passText: '≤ 250 ms; indicative on the shared machine, official only in a quiet run (D0-1)',
  },
  U3: {
    checkText:
      "Boot to ready (D4-91): from mounting the app to the worker's `ready` and the first snapshot, the default view (Realistic) compiled, the other modes warming in the background",
    passText: '≤ 5 s; indicative on the shared machine, official only in a quiet run (D0-1)',
  },
  U4: {
    checkText:
      "An unwarmed switch (D4-97 item 1, W2A-I7): from the click into a view mode whose configuration is not yet warm to that view shown (`preparing` cleared), at a steady frame CPU of any value. The asked view takes its warm slots under the frame-CPU rule, and after 30 frames of preparing one every frame whatever the last frame's CPU (D4-98 item 1); its give-up counts the frames waited (`src/shell/warmUp.ts`; `tests/browser/firstSwitch.test.tsx`, 1366 x 768)",
    passText: '≤ 2 s; indicative on the shared machine, official only in a quiet run (D0-1)',
  },
  U5: {
    checkText:
      "The cut views' framing (D4-97 item 2, W2A-I8): entering Cutaway or Data dollies the camera out and pans it until the engine's screen box (the nacelle to the core nozzle) lies inside the free area above the dock less a label row of 52 px (the tallest label, its 12 px gap and 3 px) above and below it, never below 0.6 of its size at the orbit before (the minimum engine scale, as Schlieren's framing); leaving them puts the orbit back. A label with no room in its row is hidden, by priority: fan, combustor, HPT, LPT, exhaust, then HPC, booster, bypass duct (`src/shell/orbit.ts` cutViewOrbit, `src/hud/callouts.ts` layoutAxial)",
    passText:
      "at 1366 x 768 and 1920 x 1001 the axial rows hold: every label shown sits in a row above or below the engine's screen box, clear of it, each row in the parts' axial order (`tests/browser/app.test.tsx`)",
  },
  U6: {
    checkText:
      "Cutaway's own warm frames (D4-97 item 4, accepted as measured): the background warm-up's frames for Cutaway, once a session, a few seconds after ready; a node build cannot be split, so one large material is let through a frame (`tests/browser/warmStall.test.ts`, the main-thread probe: warm frames, the most warm-frame CPU, those over 16.7 ms, the longest frame gap)",
    passText:
      'recorded on every run, indicative, no bar: critic pass 17 measured 47 warm frames at ≤ 41 ms of CPU each over about 2 s, the longest frame gap 34 ms',
  },
  U7: {
    checkText:
      "The background warm-up's own time (D4-97 item 4): all nine configurations warm, in s after ready, with a switch into Cutaway as soon as it is warm (`tests/browser/firstSwitch.test.tsx`, 1366 x 768)",
    passText:
      'recorded on every run, indicative, no bar: critic pass 17 measured all nine warm 7.0 s after ready, the longest snapshot gap while warming 108 ms (to Cutaway) and 125 ms (to Schlieren)',
  },
} as const;

export const UI_LEVELS = {
  /** U1: amber below this margin (exactly 5 % is normal). */
  surgeMarginCautionFraction: 0.05,
  /** U1: red at or below this margin. */
  surgeMarginWarningFraction: 0,
  /** U2: the longest snapshot gap after the first switch into a warmed mode, ms. */
  firstSwitchMaxGapMs: 250,
  /** U3: boot to ready, ms. */
  bootToReadyMaxMs: 5000,
  /** U4: an unwarmed switch shown within this, at any steady frame CPU, ms. */
  coldSwitchMaxMs: 2000,
  /** U5: the cut views' framing never below this of the engine's size at the orbit before. */
  cutViewMinScale: 0.6,
  /** U5: the room a label row takes above and below the engine, CSS px. */
  calloutRowPx: 52,
} as const;
