// W2A-I4 / D4-88 in Chrome: the viewer's first switch into Schlieren, and into Cutaway, must not
// stall the view. Before D4-88 the first use of a mode compiled its pipelines in the worker's
// frame (the critic's probe: no snapshot at all in the 1.5 s after the Schlieren echo); the
// engine view now warms every mode's pipelines behind the boot spinner, and the worker posts
// `ready` only after it.
//
// Measured per mode on a fresh worker (its first switch): the wall time from the click to the
// mode's echo, the longest gap between snapshots (20 Hz) in the 3 s after the click, and the boot
// (render to ready, the warm-up included). Recorded to reports/ui/first-switch-<mode>.json.
//
// The bar (pre-registered here, W2 app-ui round 3): no snapshot gap over 250 ms in the 3 s after
// the first switch. A frame of the shared machine's 30-60 fps is 17-33 ms and a snapshot every
// third frame, so 250 ms is several missed snapshots: a hitch a viewer sees, not one compile.
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { commands, page } from 'vitest/browser';
import type { ViewMode } from '../../src/contracts/ui';
import { App } from '../../src/ui/App';
import { useApp } from '../../src/ui/store';
import '../../src/ui/global.css';

const MAX_GAP_MS = 250;
const WINDOW_MS = 3000;

const sleep = (ms: number) =>
  new Promise<void>((r) => {
    setTimeout(r, ms);
  });

async function until(what: string, pred: () => boolean, timeoutMs = 90_000): Promise<void> {
  const t0 = performance.now();
  while (!pred()) {
    const c = useApp.getState().connection;
    if (c.state === 'failed' || c.state === 'lost' || c.state === 'unsupported')
      throw new Error(`${what}: the app stopped (${c.state}: ${c.message})`);
    if (performance.now() - t0 > timeoutMs) throw new Error(`${what}: not within ${timeoutMs} ms`);
    await sleep(20);
  }
}

const fresh = useApp.getState();

describe('the first switch into a flow mode (W2A-I4, D4-88)', () => {
  afterEach(() => {
    cleanup();
  });

  for (const mode of ['schlieren', 'cutaway'] as const satisfies readonly ViewMode[])
    it(`the first switch into ${mode} keeps the snapshots coming (no gap over ${String(MAX_GAP_MS)} ms)`, async () => {
      await page.viewport(1366, 768);
      useApp.setState(fresh, true);
      const t0 = performance.now();
      render(<App />);
      await until('ready and a snapshot', () => {
        const s = useApp.getState();
        return s.connection.state === 'running' && s.snapshot !== null;
      });
      const bootMs = performance.now() - t0;
      // two seconds of Realistic first (the app's first view), as a viewer would see it
      const v0 = useApp.getState().snapshot?.version ?? 0;
      await until('40 snapshots', () => (useApp.getState().snapshot?.version ?? 0) >= v0 + 40);
      const arrivals: { t: number; mode: ViewMode; simS: number }[] = [];
      const unsubscribe = useApp.subscribe((s, p) => {
        if (s.snapshot !== null && s.snapshot !== p.snapshot)
          arrivals.push({
            t: performance.now(),
            mode: s.snapshot.view.viewMode,
            simS: s.snapshot.clock.simTimeS,
          });
      });
      const click = performance.now();
      await page.getByRole('radio', { name: new RegExp(`^${mode}`, 'i') }).click();
      await sleep(WINDOW_MS + 500);
      unsubscribe();
      const inWindow = arrivals.filter((a) => a.t - click <= WINDOW_MS);
      // the gaps from the click to the first snapshot, between snapshots, and from the last one
      // to the window's end (a stall that outlasts the window is a gap too)
      const times = [click, ...inWindow.map((a) => a.t), click + WINDOW_MS];
      let longestGapMs = 0;
      for (let k = 1; k < times.length; k++)
        longestGapMs = Math.max(longestGapMs, (times[k] ?? 0) - (times[k - 1] ?? 0));
      const echo = arrivals.find((a) => a.mode === mode);
      const record = {
        mode,
        viewport: '1366x768',
        bootMs: Math.round(bootMs),
        echoMs: echo === undefined ? null : Math.round(echo.t - click),
        longestGapMs: Math.round(longestGapMs),
        snapshotsInWindow: inWindow.length,
        simSInWindow:
          inWindow.length < 2
            ? 0
            : Number(((inWindow.at(-1)?.simS ?? 0) - (inWindow[0]?.simS ?? 0)).toFixed(2)),
        fpsAfter: useApp.getState().diagnostics?.budget.fps ?? null,
        frameCpuMaxMsAfter: useApp.getState().diagnostics?.budget.frameCpuMaxMs ?? null,
      };
      await commands.writeFile(
        `reports/ui/first-switch-${mode}.json`,
        `${JSON.stringify(record, null, 2)}\n`,
      );
      expect(useApp.getState().snapshot?.view.viewMode).toBe(mode);
      expect(record.longestGapMs, JSON.stringify(record)).toBeLessThanOrEqual(MAX_GAP_MS);
    });
});
