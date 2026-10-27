// What the opaque pass pays for (D4-5, W1V-I2): interleaved A/B configs on one page, so the
// machine's drift (other agents) hits every config alike. Indicative, never official.
//
//   npx vite --port 5184 --strictPort
//   node tools/lookdev/opaqueCost.ts [--port 5184] [--rounds 6] [--preset threeQuarterFront]
//
// Each round times the default and then each config for `--frames` frames (after 8 untimed
// ones); the result is the median over the rounds of the paired differences, so slow drift
// cancels. `--extra <regex>` adds a config hiding the matching objects.

import { chromium } from '@playwright/test';

const args = process.argv.slice(2);
const arg = (name: string): string | undefined => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const port = arg('--port') ?? '5184';
const rounds = Number(arg('--rounds') ?? '6');
const preset = arg('--preset') ?? 'threeQuarterFront';
const runMs = Number(arg('--run-ms') ?? '500');

type Flags = Record<string, boolean | number | string>;
interface Config {
  readonly id: string;
  readonly flags: Flags;
  readonly viewport?: readonly [number, number];
  readonly profile?: 'quality' | 'performance';
}
const CONFIGS: readonly Config[] = [
  { id: 'default', flags: {} },
  { id: 'default 960x540', flags: {}, viewport: [960, 540] },
  { id: 'flat main', flags: { flat: true } },
  { id: 'flat main 960x540', flags: { flat: true }, viewport: [960, 540] },
  { id: 'performance profile', flags: {}, profile: 'performance' },
  { id: 'no main rows', flags: { hide: '^main:row:' } },
  { id: 'flat nacelle skin', flags: { flatNames: '^nacelle-skin$' } },
  { id: 'flat core cowl', flags: { flatNames: '^core-cowl-skin$' } },
  { id: 'flat cyclorama', flags: { flatNames: '^cyclorama$' } },
  { id: 'flat lip', flags: { flatNames: 'lip' } },
  {
    id: 'flat all but skins',
    flags: { flatNames: '^(?!nacelle-skin$|core-cowl-skin$|cyclorama$)' },
  },
  { id: 'no shadows', flags: { noShadow: true } },
  ...(arg('--extra') !== undefined
    ? [{ id: `hide ${arg('--extra') ?? ''}`, flags: { hide: arg('--extra') ?? '' } }]
    : []),
];

interface Api {
  lookdev?: {
    ready: boolean;
    setPreset(id: string): void;
    setDebugFlags(f: Flags): void;
    setProfile(id: string): void;
    renderFrames(n: number): Promise<void>;
    timeRun(ms: number): Promise<{ frames: { gpu: Record<string, number> }[] }>;
  };
}

const med = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 === 1 ? (s[m] ?? NaN) : ((s[m - 1] ?? 0) + (s[m] ?? 0)) / 2;
};

async function main(): Promise<void> {
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: false,
    args: ['--enable-unsafe-webgpu'],
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    await page.goto(`http://localhost:${port}/lookdev.html?clean=1&preset=${preset}`);
    await page.waitForFunction(() => (window as Api).lookdev?.ready === true, null, {
      timeout: 120_000,
    });
    // paired: each config right after the default, so the drift cancels in the difference
    const time = async (
      flags: Flags,
      viewport: readonly [number, number],
      profile: 'quality' | 'performance' = 'quality',
    ) => {
      await page.setViewportSize({ width: viewport[0], height: viewport[1] });
      const run = await page.evaluate(
        async ([p, f, ms, prof]) => {
          const l = (window as Api).lookdev;
          if (l === undefined) throw new Error('no lookdev');
          l.setDebugFlags(f);
          l.setProfile(prof);
          l.setPreset(p);
          await l.renderFrames(8);
          const out = await l.timeRun(ms);
          l.setDebugFlags({});
          l.setProfile('quality');
          return out.frames;
        },
        [preset, flags, runMs, profile] as const,
      );
      // every frame of the run (timeFrames would return the timer's rolling 120-frame window)
      return {
        opaque: med(run.map((x) => x.gpu.opaque ?? NaN)),
        total: med(run.map((x) => Object.values(x.gpu).reduce((a, b) => a + b, 0))),
      };
    };
    const got = new Map<string, { opaque: number[]; dOpaque: number[]; dTotal: number[] }>();
    for (let r = 0; r < rounds; r++) {
      for (const c of CONFIGS) {
        const a = await time({}, [1920, 1080]);
        const b = await time(c.flags, c.viewport ?? [1920, 1080], c.profile);
        const e = got.get(c.id) ?? { opaque: [], dOpaque: [], dTotal: [] };
        e.opaque.push(b.opaque);
        e.dOpaque.push(b.opaque - a.opaque);
        e.dTotal.push(b.total - a.total);
        got.set(c.id, e);
      }
    }
    for (const c of CONFIGS) {
      const e = got.get(c.id);
      if (e === undefined) continue;
      const f = (x: number) => `${x >= 0 ? '+' : ''}${x.toFixed(2)}`;
      process.stdout.write(
        `${c.id.padEnd(22)} opaque ${med(e.opaque).toFixed(2)}  vs default: opaque ${f(med(e.dOpaque))}, GPU ${f(med(e.dTotal))} ms
`,
      );
    }
  } finally {
    await browser.close();
  }
}

main().catch((e: unknown) => {
  console.error(e);
  process.exitCode = 1;
});
