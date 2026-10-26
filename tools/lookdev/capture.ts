// Look-dev evidence: the committed 1920x1080 screenshots and the per-pass GPU timings.
//
//   npx vite --port 5184 --strictPort        (in another shell; not `npm run dev`, W1M-N1)
//   node tools/lookdev/capture.ts [--out docs/look-dev] [--only hero,side] [--no-timing]
//
// It launches its own headed Chrome (Playwright, channel "chrome", --enable-unsafe-webgpu so
// timestamps are not quantized to 65.5 us, GPU_FACTS M12), opens the look-dev page at a
// 1920x1080 viewport with DPR 1, renders each preset for 90 frames (one per animation frame,
// so TRAA converges), saves a JPEG, then times the default and the heavy presets over 150
// frames each. Timings are indicative unless taken in a quiet window (D0-1): the script
// records the load it cannot control in its output.

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

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
    setDebugFlags(f: Record<string, boolean>): void;
    renderFrames(n: number): Promise<void>;
    timeFrames(n: number): Promise<Medians>;
    stats(): { errors: unknown[]; drawnTriangles: number; triangles: number };
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
      const runs: readonly (readonly [string, string, Record<string, boolean>])[] = [
        ['default (threeQuarterFront)', 'threeQuarterFront', {}],
        ['threeQuarterFront, no cyclorama', 'threeQuarterFront', { noStage: true }],
        ['threeQuarterFront, no shadows', 'threeQuarterFront', { noShadow: true }],
        ['threeQuarterFront, no post', 'threeQuarterFront', { noPost: true }],
        ['threeQuarterFront, culling off', 'threeQuarterFront', { noCull: true }],
        ['fanTakeoff', 'fanTakeoff', {}],
        ['hero (cinematic, DoF on)', 'hero', {}],
        ['cutaway', 'cutaway', {}],
        ['cutaway, caps off', 'cutaway', { noCaps: true }],
        ['exploded', 'exploded', {}],
        ['hotSection', 'hotSection', {}],
        // the GPU clock and other load drift during a run: the default again, last
        ['default (threeQuarterFront), repeat', 'threeQuarterFront', {}],
      ];
      for (const [label, preset, flags] of runs) {
        const r = await page.evaluate(
          async ([p, f]) => {
            const l = (window as LookdevPage).lookdev;
            if (l === undefined) throw new Error('no lookdev');
            l.setDebugFlags(f);
            l.setPreset(p);
            await l.renderFrames(30);
            const m = await l.timeFrames(150);
            const s = l.stats();
            l.setDebugFlags({});
            return {
              ...m,
              drawnTriangles: s.drawnTriangles,
              triangles: s.triangles,
              errors: s.errors.length,
            };
          },
          [preset, flags] as const,
        );
        results[label] = r;
        const passes = Object.entries(r.gpu)
          .filter(([, v]) => v > 0.0005)
          .map(([k, v]) => `${k} ${v.toFixed(2)}`)
          .join(', ');
        log(
          `${label}: GPU ${r.gpuTotal.toFixed(2)} ms (${passes}); CPU ${r.cpu.toFixed(2)} ms; ${(r.drawnTriangles / 1e6).toFixed(3)} M tris drawn; errors ${r.errors}`,
        );
      }
      const file = join(out, 'timings.json');
      writeFileSync(
        file,
        `${JSON.stringify({ date: new Date().toISOString(), viewport: '1920x1080 DPR 1', quality: 'high', note: 'indicative: other agents may share the CPU/GPU (D0-1 not applied)', results }, null, 2)}\n`,
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
