// D4-73 (W2L-I7) evidence, GPU_FACTS M56: what Playwright's focus emulation does to D3-6's blur
// rule, and that spikes/lib/focus.ts's realFocus undoes it. Headless Chrome (channel "chrome",
// no window, so it takes no OS focus from anyone): page A, then a second tab B brought to the
// front, and A's document.hasFocus() and blur count read back.
//
//   node spikes/bench/focusProbe.ts
//
// One JSON line per case. With Playwright's default emulation A keeps the focus behind B (no blur);
// after realFocus it loses it (one blur); a navigation of A brings the emulation back, and
// realFocus after it switches it off again.
import { chromium, type Page } from '@playwright/test';
import { pageHasFocus, realFocus } from '../lib/focus.ts';

interface Probe {
  readonly hasFocusBehindOtherTab: boolean;
  readonly blurs: number;
  readonly visibility: string;
}

async function behindOtherTab(a: Page, openOther: () => Promise<Page>): Promise<Probe> {
  // one blur listener per document, the count reset for each case
  await a.evaluate(() => {
    const w = window as { blurs?: number; counting?: boolean };
    w.blurs = 0;
    if (w.counting === true) return;
    w.counting = true;
    addEventListener('blur', () => {
      w.blurs = (w.blurs ?? 0) + 1;
    });
  });
  const b = await openOther();
  await b.bringToFront();
  await new Promise((r) => setTimeout(r, 500));
  const hasFocusBehindOtherTab = await pageHasFocus(a);
  const rest = await a.evaluate(() => ({
    blurs: (window as { blurs?: number }).blurs ?? -1,
    visibility: document.visibilityState,
  }));
  await b.close();
  await a.bringToFront();
  return { hasFocusBehindOtherTab, ...rest };
}

async function main(): Promise<void> {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const context = await browser.newContext();
    const a = await context.newPage();
    const cdp = await context.newCDPSession(a);
    const openOther = () => context.newPage();
    const line = (name: string, p: Probe) => {
      process.stdout.write(`${JSON.stringify({ case: name, ...p })}\n`);
    };
    await a.setContent('<p>a</p>');
    line("Playwright's default (focus emulation on)", await behindOtherTab(a, openOther));
    await realFocus(a, cdp, openOther);
    line('after realFocus', await behindOtherTab(a, openOther));
    await a.goto('data:text/html,<p>navigated</p>');
    line('after a navigation, realFocus not repeated', await behindOtherTab(a, openOther));
    await realFocus(a, cdp, openOther);
    line('after a navigation and realFocus', await behindOtherTab(a, openOther));
    process.stdout.write(`chrome ${browser.version()}\n`);
  } finally {
    await browser.close();
  }
}

main().catch((e: unknown) => {
  console.error(e);
  process.exitCode = 1;
});
