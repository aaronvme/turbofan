// D4-91 in Chrome: the progressive warm-up. The worker posts `ready` once the default view
// (Realistic) is compiled and warms the other modes in the background (src/shell/warmUp.ts,
// EngineView.warmFrame), so:
// - boot-to-ready is short (U3);
// - the viewer's first switch into a warmed mode does not stall the view (U2);
// - a switch into a mode not yet warmed shows "preparing" over the running view, never a freeze,
//   and switches as soon as the mode is warm;
// - the background warm-up itself keeps the snapshots coming;
// - D4-95: a switch started while the background warm-up is in progress suspends it (no warm
//   frame from the switch until a second after it settles), so U2 holds with the queue active.
//
// Measured on the main thread (the round-3 measure: the GPU process's compile stalls the worker's
// frames without the worker's CPU seeing it): the longest gap between snapshots (20 Hz) in a
// window, the window's ends included. Recorded to reports/ui/first-switch-<case>.json.
//
// The bars come from docs/PHYSICS.md 3.5 (src/hud/uiLevels.ts). They are indicative on the shared
// machine and official only in a quiet run (D0-1), so they fail the suite only with
// VITE_UI_QUIET=1 (W2A-N16); every run records them and fails on a freeze, a gap over
// FREEZE_MS, whatever the load.
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { commands, page } from 'vitest/browser';
import type { ViewMode } from '../../src/contracts/ui';
import { UI_LEVELS } from '../../src/hud/uiLevels';
import { configFor } from '../../src/shell/warmUp';
import { APP_DEFAULT_VIEW, withViewMode } from '../../src/shell/viewState';
import { App } from '../../src/ui/App';
import { useApp } from '../../src/ui/store';
import '../../src/ui/global.css';

const env = (import.meta as { env?: Record<string, string | undefined> }).env;
/** W2A-N16: the wall-time bars gate only an official quiet run. */
const QUIET = env?.VITE_UI_QUIET === '1';
const MAX_GAP_MS = UI_LEVELS.firstSwitchMaxGapMs;
const MAX_BOOT_MS = UI_LEVELS.bootToReadyMaxMs;
/** U4 (D4-97 item 1): an unwarmed switch is shown within this, at any steady frame CPU. */
const MAX_COLD_MS = UI_LEVELS.coldSwitchMaxMs;
/**
 * A freeze, on any machine: four times the first-switch bar (round 3's stalls were 1.3-2.8 s).
 * Test-local, so a regression to a stalling switch fails a loaded run too.
 */
const FREEZE_MS = 4 * MAX_GAP_MS;
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

function problems(): string[] {
  const s = useApp.getState();
  return [...s.gpuErrors, ...(s.diagnostics?.errors ?? [])];
}

/** Records snapshot arrivals from now on; the longest gap over [from, to] with its ends. */
function arrivals() {
  const list: {
    t: number;
    mode: ViewMode;
    preparing: ViewMode | null;
    settledFrames: number;
    warmFrames: number;
    queue: number;
    suspended: boolean;
  }[] = [];
  const unsubscribe = useApp.subscribe((s, p) => {
    if (s.snapshot !== null && s.snapshot !== p.snapshot)
      list.push({
        t: performance.now(),
        mode: s.snapshot.view.viewMode,
        preparing: s.diagnostics?.view.preparing ?? null,
        settledFrames: s.diagnostics?.view.settledFrames ?? 0,
        warmFrames: s.diagnostics?.warm.frames ?? 0,
        queue: s.diagnostics?.warm.queue.length ?? 0,
        suspended: s.diagnostics?.warm.suspended ?? false,
      });
  });
  const longestGap = (from: number, to: number) => {
    const times = [from, ...list.filter((a) => a.t >= from && a.t <= to).map((a) => a.t), to];
    let g = 0;
    for (let k = 1; k < times.length; k++) g = Math.max(g, (times[k] ?? 0) - (times[k - 1] ?? 0));
    return Math.round(g);
  };
  return { list, unsubscribe, longestGap };
}

const fresh = useApp.getState();
const warmOf = (mode: ViewMode) => configFor(withViewMode(APP_DEFAULT_VIEW, mode));
const isWarm = (mode: ViewMode) =>
  useApp.getState().diagnostics?.warm.warm.includes(warmOf(mode)) ?? false;

async function boot() {
  await page.viewport(1366, 768);
  useApp.setState(fresh, true);
  const t0 = performance.now();
  const rec = arrivals();
  render(<App />);
  await until('ready and a snapshot', () => {
    const s = useApp.getState();
    return s.connection.state === 'running' && s.snapshot !== null;
  });
  return { t0, bootMs: Math.round(performance.now() - t0), rec };
}

const record = async (name: string, r: Record<string, unknown>) => {
  const d = useApp.getState().diagnostics;
  await commands.writeFile(
    `reports/ui/first-switch-${name}.json`,
    `${JSON.stringify(
      {
        ...r,
        quiet: QUIET,
        viewport: '1366x768',
        fpsAfter: d?.budget.fps ?? null,
        frameCpuMaxMsAfter: d?.budget.frameCpuMaxMs ?? null,
        warmUpMs: d?.warmUpMs ?? null,
        warmUpSteps: (d?.warmUpSteps ?? []).map(
          (s) => `${s.name} ${s.ms.toFixed(0)} ms (warm-frame CPU ${s.cpuMs.toFixed(0)} ms)`,
        ),
        warm: d?.warm ?? null,
        problems: problems(),
      },
      null,
      2,
    )}\n`,
  );
};

describe('the progressive warm-up (D4-91)', () => {
  afterEach(() => {
    cleanup();
  });

  for (const mode of ['schlieren', 'cutaway'] as const satisfies readonly ViewMode[])
    it(`boots to ready, warms ${mode} in the background without a freeze, then switches into it at once`, async () => {
      const { t0, bootMs, rec } = await boot();
      const ready = performance.now();
      // the background warm-up: the mode's configuration compiled while Realistic runs
      await until(`${mode} warm`, () => isWarm(mode), 120_000);
      const warmedMs = Math.round(performance.now() - ready);
      const warmGapMs = rec.longestGap(ready, performance.now());
      await sleep(500);
      const click = performance.now();
      await page.getByRole('radio', { name: new RegExp(`^${mode}`, 'i') }).click();
      await sleep(WINDOW_MS + 500);
      rec.unsubscribe();
      const echo = rec.list.find((a) => a.t >= click && a.mode === mode);
      const r = {
        case: `${mode} (warmed first)`,
        mode,
        bootMs,
        warmedMs,
        longestGapWhileWarmingMs: warmGapMs,
        echoMs: echo === undefined ? null : Math.round(echo.t - click),
        longestGapMs: rec.longestGap(click, click + WINDOW_MS),
        bootStartToClickMs: Math.round(click - t0),
      };
      await record(mode, r);
      expect(problems(), JSON.stringify(r)).toEqual([]);
      expect(useApp.getState().snapshot?.view.viewMode).toBe(mode);
      expect(useApp.getState().diagnostics?.view.preparing).toBeNull();
      // a warmed mode is shown at once: never through "preparing"
      expect(rec.list.some((a) => a.t >= click && a.preparing !== null)).toBe(false);
      expect(r.longestGapMs, JSON.stringify(r)).toBeLessThanOrEqual(FREEZE_MS);
      if (QUIET) {
        // the background warm-up's own gaps: recorded every run; on the shared machine they
        // include the other jobs' GPU load (round 4: 108-113 ms quiet, 0.65-1.6 s loaded)
        expect(r.longestGapWhileWarmingMs, JSON.stringify(r)).toBeLessThanOrEqual(FREEZE_MS);
        expect(r.bootMs, JSON.stringify(r)).toBeLessThanOrEqual(MAX_BOOT_MS);
        expect(r.longestGapMs, JSON.stringify(r)).toBeLessThanOrEqual(MAX_GAP_MS);
      }
    });

  it('a switch while the background warm-up is in progress suspends it until a second after the switch (D4-95)', async () => {
    const { bootMs, rec } = await boot();
    const ready = performance.now();
    // Cutaway is warmed first; switch into it at once, while the rest of the queue still warms
    await until('cutaway warm', () => isWarm('cutaway'), 120_000);
    const warmedMs = Math.round(performance.now() - ready);
    const click = performance.now();
    await page.getByRole('radio', { name: /^cutaway/i }).click();
    await sleep(WINDOW_MS + 500);
    // then the background goes on to the end (item 4: its time, recorded)
    await until(
      'all warm',
      () => (useApp.getState().diagnostics?.warm.queue.length ?? 1) === 0,
      120_000,
    );
    const allWarmMs = Math.round(performance.now() - ready);
    rec.unsubscribe();
    const after = rec.list.filter((a) => a.t >= click);
    const echoAt = after.findIndex((a) => a.mode === 'cutaway');
    const echo = after[echoAt];
    const fromEcho = after.slice(Math.max(0, echoAt));
    const settled = fromEcho.find((a) => a.settledFrames > 0);
    const resumed = fromEcho.find((a) => !a.suspended);
    const r = {
      case: 'cutaway (a switch while the background warms)',
      mode: 'cutaway',
      bootMs,
      warmedMs,
      allWarmMs,
      queueAtEcho: echo?.queue ?? null,
      echoMs: echo === undefined ? null : Math.round(echo.t - click),
      settledMs: settled === undefined ? null : Math.round(settled.t - click),
      resumedMs: resumed === undefined ? null : Math.round(resumed.t - click),
      warmFramesSuspended:
        fromEcho.filter((a) => a.suspended).length > 0
          ? Math.max(...fromEcho.filter((a) => a.suspended).map((a) => a.warmFrames)) -
            (echo?.warmFrames ?? 0)
          : null,
      longestGapMs: rec.longestGap(click, click + WINDOW_MS),
    };
    await record('while-warming', r);
    expect(problems(), JSON.stringify(r)).toEqual([]);
    expect(echo, JSON.stringify(r)).toBeDefined();
    // the precondition: the queue was still warming when the switch reached the worker
    expect(r.queueAtEcho, JSON.stringify(r)).toBeGreaterThan(0);
    // suspended from the switch until it settled, and no warm frame while suspended
    expect(echo?.suspended, JSON.stringify(r)).toBe(true);
    expect(settled, JSON.stringify(r)).toBeDefined();
    const toSettled = fromEcho.filter((a) => settled !== undefined && a.t <= settled.t);
    expect(
      toSettled.every((a) => a.suspended),
      JSON.stringify(r),
    ).toBe(true);
    expect(r.warmFramesSuspended, JSON.stringify(r)).toBe(0);
    // and it resumed: the queue went on to the end
    expect(resumed, JSON.stringify(r)).toBeDefined();
    expect(r.longestGapMs, JSON.stringify(r)).toBeLessThanOrEqual(FREEZE_MS);
    if (QUIET) expect(r.longestGapMs, JSON.stringify(r)).toBeLessThanOrEqual(MAX_GAP_MS);
  });

  // U4 (D4-97 item 1, W2A-I7): also at a steady frame CPU over the slot rule's bar (critic pass
  // 17's probe: 8.4 ms, and 11.2 ms, critic 15's held frame), which before held the switch in
  // "Preparing" for good. The worker pads each frame's CPU to it (the `debug` message)
  for (const frameCpuMs of [null, 8.4, 11.2] as const)
    it(`a switch into a mode not yet warmed shows "preparing" over the running view, then the mode${frameCpuMs === null ? '' : ` (a steady ${String(frameCpuMs)} ms frame CPU)`}`, async () => {
      const { bootMs, rec } = await boot();
      if (frameCpuMs !== null) {
        useApp.getState().post({ type: 'debug', frameCpuMs });
        await until('the steady frame CPU', () => {
          const b = useApp.getState().diagnostics?.budget;
          return b !== undefined && b.frameCpuMs >= frameCpuMs;
        });
      }
      // at once after ready: the background warm-up has not reached the Data view yet (Cutaway and
      // Schlieren come first), so the view asked for is prepared first
      const mode: ViewMode = 'data';
      expect(isWarm(mode)).toBe(false);
      const click = performance.now();
      await page.getByRole('radio', { name: /^data/i }).click();
      await until(
        'the preparing state',
        () => useApp.getState().diagnostics?.view.preparing === mode,
      );
      const preparingMs = Math.round(performance.now() - click);
      const chip = page.getByRole('status', { name: /preparing the data view/i });
      await expect.element(chip).toBeVisible();
      await until(
        'data shown',
        () => {
          const d = useApp.getState().diagnostics;
          return d !== null && d.view.preparing === null && d.view.mode === mode;
        },
        120_000,
      );
      const shownMs = Math.round(performance.now() - click);
      await until(
        'data settled',
        () => (useApp.getState().diagnostics?.view.settledFrames ?? 0) > 0,
      );
      rec.unsubscribe();
      const d = useApp.getState().diagnostics;
      const r = {
        case: `data (cold: preparing)${frameCpuMs === null ? '' : ` at a steady ${String(frameCpuMs)} ms frame CPU`}`,
        mode,
        frameCpuMs,
        bootMs,
        preparingMs,
        shownMs,
        u4MaxMs: MAX_COLD_MS,
        longestGapMs: rec.longestGap(click, click + shownMs),
        snapshotsWhilePreparing: rec.list.filter((a) => a.preparing === mode).length,
        warmFramesWhilePreparing: d?.warm.frames ?? null,
        gaveUp: d?.warm.gaveUp ?? null,
      };
      await record(frameCpuMs === null ? 'data-cold' : `data-cold-${String(frameCpuMs)}ms`, r);
      expect(problems(), JSON.stringify(r)).toEqual([]);
      await expect.element(chip).not.toBeInTheDocument();
      // the view kept running while it prepared the mode: snapshots, and no freeze
      expect(r.snapshotsWhilePreparing).toBeGreaterThan(2);
      expect(r.longestGapMs, JSON.stringify(r)).toBeLessThanOrEqual(FREEZE_MS);
      // shown by its warm frames, not by the give-up
      expect(r.gaveUp, JSON.stringify(r)).toEqual([]);
      if (QUIET) expect(r.shownMs, JSON.stringify(r)).toBeLessThanOrEqual(MAX_COLD_MS);
    });
});
