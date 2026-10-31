// D4-73 (W2L-I7): D3-6's blur rule must take effect in the official capture, ab and bench runs.
// Playwright emulates a focused page (Emulation.setFocusEmulationEnabled { enabled: true } on
// every page it opens), so window blur and document.hasFocus() never report the OS focus. The
// harnesses switch it off after every navigation (the override does not survive one, measured:
// GPU_FACTS), check that it took (with another tab in front the page must not have focus), and
// make a run INVALID when the page did not have the focus at its start or its end.
import { describe, expect, it } from 'vitest';
import {
  FOCUS_EMULATION_OFF,
  focusValidity,
  realFocus,
  type FocusContext,
  type FocusPage,
} from '../../../spikes/lib/focus';

/** A page whose hasFocus() follows the fake browser: the front tab has focus unless emulated. */
function fakeBrowser(opts: {
  readonly ignoresOverride?: boolean;
  readonly windowFocused?: boolean;
}) {
  const calls: string[] = [];
  let front: FocusPage | null = null;
  const emulated = new Set<FocusPage>();
  const pages: FocusPage[] = [];
  const page = (name: string): FocusPage & { close(): Promise<void> } => {
    const p: FocusPage & { close(): Promise<void> } = {
      evaluate: (fn) => {
        calls.push(`${name}.evaluate`);
        // document.hasFocus() as Chrome answers it: always true under emulation
        void fn;
        const focused = emulated.has(p) || (front === p && opts.windowFocused !== false);
        return Promise.resolve(focused);
      },
      bringToFront: () => {
        calls.push(`${name}.bringToFront`);
        front = p;
        return Promise.resolve();
      },
      close: () => {
        calls.push(`${name}.close`);
        if (front === p) front = null;
        return Promise.resolve();
      },
    };
    pages.push(p);
    emulated.add(p); // Playwright's default
    return p;
  };
  const measured = page('measured');
  front = measured;
  const context: FocusContext = {
    newCDPSession: (target) =>
      Promise.resolve({
        send: (method, params) => {
          calls.push(`cdp ${method} ${JSON.stringify(params)}`);
          if (!opts.ignoresOverride && method === FOCUS_EMULATION_OFF.method && !params.enabled)
            emulated.delete(target);
          return Promise.resolve({});
        },
      }),
    newPage: () => {
      calls.push('newPage');
      const p = page('other');
      return Promise.resolve(p);
    },
  };
  return { calls, measured, context, front: () => front };
}

describe('D4-73: the real OS focus for D3-6', () => {
  it('switches the emulation off, checks it with another tab in front, and gives the front back', async () => {
    const b = fakeBrowser({});
    await realFocus(b.context, b.measured);
    expect(b.calls).toEqual([
      'cdp Emulation.setFocusEmulationEnabled {"enabled":false}',
      'newPage',
      'other.bringToFront',
      'measured.evaluate',
      'other.close',
      'measured.bringToFront',
    ]);
    expect(b.front()).toBe(b.measured);
  });

  it('refuses to run when the page still reports the focus behind another tab (emulation on)', async () => {
    const b = fakeBrowser({ ignoresOverride: true });
    await expect(realFocus(b.context, b.measured)).rejects.toThrow(/focus emulation/);
    // the other tab is closed and the measured page brought back either way
    expect(b.calls.slice(-2)).toEqual(['other.close', 'measured.bringToFront']);
  });

  it('a run is INVALID when the page did not have the focus at its start or its end', () => {
    expect(focusValidity(true, true)).toEqual({ valid: true, reasons: [], warnings: [] });
    const start = focusValidity(false, true);
    expect(start.valid).toBe(false);
    expect(start.reasons.join()).toMatch(/start.*hasFocus/);
    const end = focusValidity(true, false);
    expect(end.valid).toBe(false);
    expect(end.reasons.join()).toMatch(/end.*hasFocus/);
    expect(focusValidity(false, false).reasons).toHaveLength(2);
  });

  it('a page in an unfocused window has no focus once the emulation is off (D0-1: Chrome in front)', async () => {
    const b = fakeBrowser({ windowFocused: false });
    await realFocus(b.context, b.measured);
    expect(await b.measured.evaluate(() => document.hasFocus())).toBe(false);
  });
});
