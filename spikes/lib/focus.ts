// D4-73 (W2L-I7): D3-6's blur rule must take effect in the official capture, ab and bench runs.
// Playwright emulates a focused page: it sends Emulation.setFocusEmulationEnabled { enabled: true }
// for every page it opens (playwright-core FrameSession._initialize), the DevTools "Emulate a
// focused page" feature, so window blur and document.hasFocus() stop reporting the OS focus and a
// run in a visible but unfocused window stayed VALID. The harnesses switch it off and check it
// (realFocus), after EVERY navigation: the override does not survive one (measured, GPU_FACTS M56,
// spikes/bench/focusProbe.ts). A run is then INVALID when the page lost the focus during it (the
// pages count blur events) or did not have it at its start or its end (focusValidity; a page that
// never had the focus gets no blur event).
//
// The parts of Playwright's Page, BrowserContext and CDPSession used here are structural, so the
// sequence is unit-tested with fakes (tests/unit/spikes/focus.test.ts).

import type { Validity } from './validity.ts';

/** The CDP command that switches the emulation off. */
export const FOCUS_EMULATION_OFF = {
  method: 'Emulation.setFocusEmulationEnabled',
  params: { enabled: false },
} as const;

export interface CdpSender {
  send(
    method: 'Emulation.setFocusEmulationEnabled',
    params: { enabled: boolean },
  ): Promise<unknown>;
}

export interface FocusPage {
  evaluate(fn: () => boolean): Promise<boolean>;
  bringToFront(): Promise<void>;
}

/** Opens another tab in the page's window (Playwright: () => context.newPage()). */
export type OpenOtherTab = () => Promise<FocusPage & { close(): Promise<void> }>;

/** What the page says about its focus: document.hasFocus() (false once the window is behind). */
export function pageHasFocus(page: FocusPage): Promise<boolean> {
  return page.evaluate(() => document.hasFocus());
}

/**
 * Switches the page's focus emulation off through its CDP session (Playwright:
 * context.newCDPSession(page)) and checks that it took: with another tab of the same window in
 * front, the page must not report the focus (under the emulation it still does). The other tab is
 * closed and the page brought to the front again either way. Call it after every navigation of
 * the page, before its runs.
 */
export async function realFocus(
  page: FocusPage,
  cdp: CdpSender,
  openOther: OpenOtherTab,
): Promise<void> {
  await cdp.send(FOCUS_EMULATION_OFF.method, FOCUS_EMULATION_OFF.params);
  const other = await openOther();
  let masked: boolean;
  try {
    await other.bringToFront();
    masked = await pageHasFocus(page);
  } finally {
    await other.close();
    await page.bringToFront();
  }
  if (masked)
    throw new Error(
      'focus emulation still on: the page reports the focus with another tab in front, so D3-6 ' +
        "could not see a blur (D4-73); Playwright's Emulation.setFocusEmulationEnabled override did not take",
    );
}

/**
 * D3-6 with D4-73: INVALID when the page did not have the OS focus at the start or at the end of
 * a run (Chrome not in the foreground). A blur during the run is counted by the page itself.
 */
export function focusValidity(atStart: boolean, atEnd: boolean): Validity {
  const reasons: string[] = [];
  if (!atStart)
    reasons.push(
      'page without the focus at the start of the run (document.hasFocus() false: Chrome not in the foreground)',
    );
  if (!atEnd)
    reasons.push(
      'page without the focus at the end of the run (document.hasFocus() false: Chrome not in the foreground)',
    );
  return { valid: reasons.length === 0, reasons, warnings: [] };
}
