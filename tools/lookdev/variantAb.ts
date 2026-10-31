// A paired A/B of two variants of the same tree, chosen by the look-dev page's query string
// (e.g. `gbuffer=legacy`), on one running Vite server: the round-5 measure of each P4 cut,
// D4-42's back-to-back pacing, adjacent pairs in `abOrder`, VALID runs only (`abSummary`).
// Indicative (a builder's machine), never official; the two-commit A/B of record is ab.ts.
//
//   npx vite --port 5188 --strictPort
//   node tools/lookdev/variantAb.ts --b gbuffer=legacy [--a ""] [--preset threeQuarterFront]
//     [--warmup-s 4] [--run-s 10] [--reps 4] [--pacing back-to-back] [--port 5188] [--out f.json]

import { writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { focusValidity, pageHasFocus, realFocus } from '../../spikes/lib/focus.ts';
import { combineValidity, displayIntervalMs } from '../../spikes/lib/validity.ts';
import { summarizeRun, type FrameSample, type RunSummary } from '../../src/gpu/passTimings.ts';
import { abOrder, abSummary, backToBackLoad, pacedValidity, parseTimingArgs } from './timing.ts';

const args = process.argv.slice(2);
const arg = (name: string): string | undefined => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const query = { a: arg('--a') ?? '', b: arg('--b') ?? '' };
const preset = arg('--preset') ?? 'threeQuarterFront';
const port = arg('--port') ?? '5188';
const t = parseTimingArgs([
  '--pacing',
  'back-to-back',
  '--warmup-s',
  '4',
  '--run-s',
  '10',
  ...args,
]);
const log = (line: string): void => {
  process.stdout.write(`${line}\n`);
};

interface Api {
  lookdev?: {
    ready: boolean;
    setPreset(id: string): void;
    renderFor(ms: number, saturate?: boolean): Promise<void>;
    timeRun(
      ms: number,
      saturate?: boolean,
    ): Promise<{
      frames: FrameSample[];
      rafDeltas: number[];
      hiddenMs: number;
      blurs?: number;
      vsyncDeltas?: number[];
    }>;
    stats(): { errors: unknown[] };
  };
}

async function main(): Promise<void> {
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: false,
    args: ['--enable-unsafe-webgpu'],
  });
  try {
    // a context of its own (not browser.newPage): realFocus opens a second tab in it (D4-73)
    const context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    const openOther = () => context.newPage();
    const open = async (q: string) => {
      await page.goto(`http://localhost:${port}/lookdev.html?clean=1&preset=${preset}&${q}`);
      await page.waitForFunction(() => (window as Api).lookdev?.ready === true, null, {
        timeout: 120_000,
      });
      // D4-73: D3-6's blur rule sees the OS focus (after every navigation)
      await realFocus(page, cdp, openOther);
    };
    await open(query.a);
    const probe = await page.evaluate(async () => {
      const d: number[] = [];
      let last = performance.now();
      for (let i = 0; i < 90; i++) {
        await new Promise((r) => requestAnimationFrame(r));
        const now = performance.now();
        d.push(now - last);
        last = now;
      }
      return d;
    });
    const displayMs = displayIntervalMs(probe);
    const runs: {
      ref: string;
      pacing: 'vsync' | 'backToBack';
      rep: number;
      summary: RunSummary;
      valid: boolean;
      busy: number;
    }[] = [];
    for (const r of abOrder(['a', 'b'], t.pacings, t.reps)) {
      await open(r.ref === 'a' ? query.a : query.b);
      const sat = r.pacing === 'backToBack';
      const focusStart = await pageHasFocus(page);
      const run = await page.evaluate(
        async ([p, w, ms, s]) => {
          const l = (window as Api).lookdev;
          if (l === undefined) throw new Error('no lookdev');
          l.setPreset(p);
          await l.renderFor(w, s);
          return { ...(await l.timeRun(ms, s)), errors: l.stats().errors.length };
        },
        [preset, t.warmupS * 1000, t.runS * 1000, sat] as const,
      );
      const focusEnd = await pageHasFocus(page);
      const summary = summarizeRun(run.frames);
      const v = combineValidity([
        pacedValidity(
          r.pacing,
          {
            intervalsMs: run.rafDeltas,
            hiddenMs: run.hiddenMs,
            blurs: run.blurs ?? 0,
            frames: run.frames,
            vsyncDeltasMs: run.vsyncDeltas ?? [],
          },
          displayMs,
        ),
        focusValidity(focusStart, focusEnd),
      ]);
      const busy = backToBackLoad(run.frames, run.rafDeltas).gpuBusy;
      runs.push({ ...r, summary, valid: v.valid && run.errors === 0, busy });
      log(
        `rep ${String(r.rep + 1)} ${r.pacing} ${r.ref}: GPU ${summary.gpuTotal.p50.toFixed(2)} ms, busy ${(100 * busy).toFixed(0)} %, watcher ${String((run.vsyncDeltas ?? []).length)} ticks, ${v.valid ? 'valid' : v.reasons.join('; ')}, errors ${String(run.errors)}`,
      );
    }
    const s = abSummary(['a', 'b'], runs);
    const shown = [
      'opaque',
      'rotors',
      'gtao',
      'composite',
      'traa',
      'dof',
      'bloom',
      'output',
    ] as const;
    const f = (x: number) => `${x >= 0 ? '+' : ''}${x.toFixed(2)}`;
    for (const pacing of t.pacings) {
      const sm = s[pacing];
      if (sm === undefined) continue;
      for (const side of ['a', 'b'] as const) {
        const c = sm.side[side];
        if (c !== undefined)
          log(
            `${pacing} ${side} (${query[side] || 'HEAD'}): GPU ${c.gpuTotal.p50.toFixed(2)} ms (${shown.map((k) => `${k} ${c.gpu[k].p50.toFixed(2)}`).join(', ')})`,
          );
      }
      log(
        `${pacing} a - b paired (${String(sm.pairs)} valid, dropped ${sm.dropped.join(',') || 'none'}): GPU ${f(sm.diff.gpuTotal.median)} [${sm.diff.gpuTotal.values.map(f).join(' ')}]; ${shown.map((k) => `${k} ${f(sm.diff[k].median)}`).join(', ')}`,
      );
    }
    const out = arg('--out');
    if (out !== undefined)
      writeFileSync(
        out,
        `${JSON.stringify({ date: new Date().toISOString(), query, preset, protocol: t, summary: s, runs: runs.map(({ summary, ...r }) => ({ ...r, gpuTotal: summary.gpuTotal, gpu: summary.gpu })) }, null, 2)}\n`,
      );
  } finally {
    await browser.close();
  }
}

main().catch((e: unknown) => {
  console.error(e);
  process.exitCode = 1;
});
