// D4-87 and D4-91: the app shell's display levels, pre-registered in docs/PHYSICS.md 3.5 (U1-U3)
// and mirrored here verbatim (tests/unit/hud/uiLevels.test.ts checks the text and the numbers).
// The compressor maps' surge-margin annunciation reads U1; the browser suite's first-switch and
// boot bars read U2 and U3 (indicative; they gate only an official quiet run, W2A-N16).

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
} as const;
