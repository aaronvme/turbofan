// Look-dev evidence: the committed 1920x1080 screenshots and the per-pass GPU timings.
//
//   npx vite --port 5184 --strictPort        (in another shell; not `npm run dev`, W1M-N1)
//   node tools/lookdev/capture.ts [--out docs/look-dev] [--only hero,side | none] [--no-timing]
//     [--warmup-s 10] [--run-s 60] [--reps 3] [--seed 1] [--diagnostics] [--port 5184]
//
// It launches its own headed Chrome (Playwright, channel "chrome", --enable-unsafe-webgpu so
// timestamps are not quantized to 65.5 us, GPU_FACTS M12), opens the look-dev page at a
// 1920x1080 viewport with DPR 1, renders each preset for 90 frames (one per animation frame,
// so TRAA converges) and saves a JPEG (`--only none` saves none). Then the D0-1 timing
// protocol (tools/lookdev/timing.ts): the official set (default, cutaway, hero; or the A/B
// `--diagnostics`), a warm-up before EACH run, `--reps` runs per config in a seeded order
// rotated per repetition (D2-12), every frame of a run kept (p10/p50/p90 per pass), the
// median of the runs, and each run marked INVALID on the occlusion signature or a hidden
// page (D2-11 as amended by D3-6). The conditions (battery, power plan, CPU load, Chrome,
// adapter) are recorded at the start and the end. Official only on AC with nothing else
// running and Chrome in the foreground; otherwise the numbers are indicative.

import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Page } from '@playwright/test';
import { displayIntervalMs, type Validity } from '../../spikes/lib/validity.ts';
import { summarizeRun, type FrameSample, type RunSummary } from '../../src/gpu/passTimings.ts';
import {
  combineReps,
  DIAGNOSTIC_CONFIGS,
  OFFICIAL_CONFIGS,
  parseTimingArgs,
  runOrder,
  runValidityOf,
} from './timing.ts';

// a command-line tool: its progress goes to stdout
const log = (line: string): void => {
  process.stdout.write(`${line}
`);
};

const SHOTS: readonly (readonly [string, string])[] = [
  ['hero', '00-hero'],
  ['threeQuarterFront', '01-three-quarter-front'],
  ['side', '02-side'],
  ['cutaway', '03-cutaway'],
  ['exploded', '04-exploded'],
  ['fanIdle', '05-fan-idle'],
  ['fanTakeoff', '06-fan-takeoff'],
  ['hotSection', '07-hot-section'],
];

const args = process.argv.slice(2);
const arg = (name: string): string | undefined => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const out = arg('--out') ?? 'docs/look-dev';
const only = arg('--only')?.split(',');
const timing = !args.includes('--no-timing');
const port = arg('--port') ?? '5184';
// --clip x,y,w,h saves only that region (close inspection of artefacts)
const clipArg = arg('--clip')?.split(',').map(Number);
const clip =
  clipArg?.length === 4
    ? { x: clipArg[0] ?? 0, y: clipArg[1] ?? 0, width: clipArg[2] ?? 1, height: clipArg[3] ?? 1 }
    : undefined;

interface Medians {
  frames: number;
  gpu: Record<string, number>;
  gpuTotal: number;
  cpu: number;
}
interface LookdevPage {
  lookdev?: {
    ready: boolean;
    setPreset(id: string): void;
    setDebugFlags(f: Readonly<Record<string, boolean | number | string>>): void;
    renderFrames(n: number): Promise<void>;
    timeFrames(n: number): Promise<Medians>;
    renderFor(ms: number): Promise<void>;
    timeRun(ms: number): Promise<{
      frames: FrameSample[];
      rafDeltas: number[];
      hiddenMs: number;
      events: string[];
    }>;
    conditions(): Promise<Record<string, unknown>>;
    stats(): { errors: unknown[]; drawnTriangles: number; triangles: number };
  };
}

/** Fixed-argument Windows queries (no input reaches a shell); an error is recorded, not thrown. */
function query(cmd: string, argv: readonly string[]): string {
  try {
    return execFileSync(cmd, argv, { encoding: 'utf8', timeout: 20_000 }).trim();
  } catch (e) {
    return `error: ${String(e)}`;
  }
}

/** D0-1 conditions: power source and level, power plan, CPU load, browser and adapter. */
async function conditions(page: Page, chrome: string): Promise<Record<string, unknown>> {
  const fromPage = await page.evaluate(async () => {
    const l = (window as LookdevPage).lookdev;
    return l ? await l.conditions() : {};
  });
  return {
    ...fromPage,
    chrome,
    powerPlan: query('powercfg', ['/getactivescheme']),
    cpuLoadPercent: query('powershell', [
      '-NoProfile',
      '-Command',
      '(Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average',
    ]),
    at: new Date().toISOString(),
  };
}

async function main(): Promise<void> {
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: false,
    args: ['--enable-unsafe-webgpu'],
  });
  const results: Record<string, unknown> = {};
  try {
    const page = await browser.newPage({
      viewport: { width: 1920, height: 1080 },
      deviceScaleFactor: 1,
    });
    page.on('console', (m) => {
      if (m.type() === 'error' || m.type() === 'warning') log(`[page ${m.type()}] ${m.text()}`);
    });
    await page.goto(`http://localhost:${port}/lookdev.html?clean=1`);
    await page.waitForFunction(() => (window as LookdevPage).lookdev?.ready === true, null, {
      timeout: 120_000,
    });
    for (const [preset, file] of SHOTS) {
      if (only && !only.includes(preset)) continue;
      await page.evaluate(async (p) => {
        const l = (window as LookdevPage).lookdev;
        l?.setPreset(p);
        await l?.renderFrames(90);
      }, preset);
      const path = join(out, `${file}.jpg`);
      await page.screenshot({ path, type: 'jpeg', quality: 92, ...(clip ? { clip } : {}) });
      log(`saved ${path}`);
    }
    if (timing) {
      const t = parseTimingArgs(args);
      const configs = t.diagnostics ? DIAGNOSTIC_CONFIGS : OFFICIAL_CONFIGS;
      const order = runOrder(configs, t.reps, t.seed);
      const atStart = await conditions(page, browser.version());
      log(
        `timing: ${configs.length} configs x ${t.reps} reps, ${t.warmupS} s warm-up + ${t.runS} s per run, seed ${t.seed}`,
      );
      log(`conditions: ${JSON.stringify(atStart)}`);
      // the display interval, from an idle rAF probe (refuses a throttled, background page)
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
      const perConfig = new Map<string, { runs: RunSummary[]; validity: Validity[] }>();
      for (const [rep, ids] of order.entries()) {
        for (const id of ids) {
          const c = configs.find((k) => k.id === id);
          if (c === undefined) throw new Error(`no config ${id}`);
          const run = await page.evaluate(
            async ([preset, flags, warmMs, runMs]) => {
              const l = (window as LookdevPage).lookdev;
              if (l === undefined) throw new Error('no lookdev');
              l.setDebugFlags(flags);
              l.setPreset(preset);
              await l.renderFor(warmMs);
              const r = await l.timeRun(runMs);
              const errors = l.stats().errors.length;
              l.setDebugFlags({});
              return { ...r, errors };
            },
            [c.preset, c.flags, t.warmupS * 1000, t.runS * 1000] as const,
          );
          const summary = summarizeRun(run.frames);
          const validity = runValidityOf(run.rafDeltas, displayMs, run.hiddenMs);
          const e = perConfig.get(id) ?? { runs: [], validity: [] };
          e.runs.push(summary);
          e.validity.push(validity);
          perConfig.set(id, e);
          log(
            `rep ${rep + 1} ${id}: GPU p50 ${summary.gpuTotal.p50.toFixed(2)} ms (p10 ${summary.gpuTotal.p10.toFixed(2)}, p90 ${summary.gpuTotal.p90.toFixed(2)}), ${summary.frames} frames, ${validity.valid ? 'valid' : validity.reasons.join('; ')}${validity.warnings.length > 0 ? ` [${validity.warnings.join('; ')}]` : ''}${run.events.length > 0 ? ` events: ${run.events.join(', ')}` : ''}, errors ${run.errors}`,
          );
        }
      }
      const atEnd = await conditions(page, browser.version());
      for (const c of configs) {
        const e = perConfig.get(c.id);
        if (e === undefined) continue;
        const combined = combineReps(e.runs);
        const valid = e.validity.every((v) => v.valid);
        results[c.id] = { ...combined, valid, validity: e.validity };
        const passes = Object.entries(combined.gpu)
          .filter(([, v]) => v.p50 > 0.0005)
          .map(([k, v]) => `${k} ${v.p50.toFixed(2)}`)
          .join(', ');
        log(
          `${c.id}: GPU ${combined.gpuTotal.p50.toFixed(2)} ms median of ${combined.runs} runs (${passes}); CPU ${combined.cpu.p50.toFixed(2)} ms; ${valid ? 'VALID' : 'INVALID'}`,
        );
      }
      const file = join(out, 'timings.json');
      writeFileSync(
        file,
        `${JSON.stringify(
          {
            date: new Date().toISOString(),
            viewport: '1920x1080 DPR 1',
            quality: 'high',
            protocol: { warmupS: t.warmupS, runS: t.runS, reps: t.reps, seed: t.seed, order },
            displayIntervalMs: displayMs,
            note: 'official only on AC, nothing else running, Chrome in the foreground (D0-1); otherwise indicative',
            conditions: { start: atStart, end: atEnd },
            results,
          },
          null,
          2,
        )}\n`,
      );
      log(`saved ${file}`);
    }
  } finally {
    await browser.close();
  }
}

main().catch((e: unknown) => {
  console.error(e);
  process.exitCode = 1;
});
