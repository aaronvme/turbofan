// The look-dev A/B of two commits (D4-24 result: is the default view's opaque and rotor
// increase between w1/lookdev-3 @23239a1 and w2/lookdev-4 @bad7ad0 a regression, or the iGPU
// clock following the load at vsync?). One command:
//
//   node tools/lookdev/ab.ts --refs bad7ad0,23239a1 --warmup-s 10 --run-s 60 --reps 3
//     [--preset threeQuarterFront] [--profile quality] [--pacing both | vsync | back-to-back]
//     [--port 5186] [--out docs/look-dev] [--keep]
//
// What it does, in order:
// 1. Each ref gets a detached checkout, `git worktree add --detach .claude/worktrees/ab-<sha7>`
//    under the main repository (reused if it is already there at that commit), with its own
//    `npm ci` (no shared node_modules: two Vite servers must not share a dependency cache).
// 2. The page harness is made identical on both sides: this checkout's src/lookdev/main.ts
//    (the timing loop, back-to-back pacing included) is copied over each checkout's. Only
//    the harness: the render code (src/render, src/geometry, src/gpu) is each commit's own.
// 3. A Vite server per checkout (ports --port and --port + 1), then its own headed Chrome
//    (Playwright, --enable-unsafe-webgpu, 1920 x 1080 DPR 1).
// 4. The runs in `abOrder` (tools/lookdev/timing.ts): per repetition one adjacent pair per
//    pacing, the side that goes first and the pacing that leads alternating, so the drift of
//    the machine hits both sides alike. Each run loads its side's page fresh, warms up for
//    --warmup-s (at the run's pacing), then records every frame of --run-s.
// 5. The result per pacing (`abSummary`): each side's median of the runs per pass, and the
//    paired differences refs[0] - refs[1] (median and every pair), written to
//    <out>/ab-<sha7 a>-<sha7 b>.json (Prettier-formatted) and printed.
// 6. Cleanup, whatever happened: Chrome closed, the Vite servers killed (process tree), and
//    each checkout removed (`git worktree remove --force`) unless --keep.
//
// Official only under D0-1 (AC throughout by the OS power source, read before and after every
// run, W2L-I4; nothing else running, Chrome in the foreground, 10 s warm-up, 3 x 60 s) and
// with every run VALID; otherwise indicative. INVALID runs and their pairs never enter the
// summary (W2L-I2). About (2 sides x 2 pacings x reps) x (warm-up + run + page
// load): 3 reps at D0-1 is 12 runs, about 15 min, plus the checkouts' `npm ci`.

import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { chromium } from '@playwright/test';
import type { PowerSource } from '../../spikes/lib/system.ts';
import { combineValidity, displayIntervalMs } from '../../spikes/lib/validity.ts';
import { summarizeRun, type FrameSample, type RunSummary } from '../../src/gpu/passTimings.ts';
import { osPowerSource } from './os.ts';
import {
  abOrder,
  abSummary,
  acThroughout,
  backToBackLoad,
  pacedValidity,
  parseTimingArgs,
  powerValidity,
  type AbRun,
} from './timing.ts';

const log = (line: string): void => {
  process.stdout.write(`${line}\n`);
};

const args = process.argv.slice(2);
const arg = (name: string): string | undefined => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const refsArg = (arg('--refs') ?? 'bad7ad0,23239a1').split(',');
if (refsArg.length !== 2) throw new Error('--refs takes two commits: a,b (the result is a - b)');
const preset = arg('--preset') ?? 'threeQuarterFront';
const profile = arg('--profile') ?? 'quality';
const basePort = Number(arg('--port') ?? '5186');
const out = arg('--out') ?? 'docs/look-dev';
const keep = args.includes('--keep');
const t = parseTimingArgs(args);

const git = (cwd: string, ...argv: string[]): string =>
  execFileSync('git', argv, { cwd, encoding: 'utf8' }).trim();

const here = git(process.cwd(), 'rev-parse', '--show-toplevel');
// the main repository (worktrees live under its .claude/worktrees, CLAUDE.md)
const mainRepo = dirname(resolve(here, git(here, 'rev-parse', '--git-common-dir')));
const harnessFile = join('src', 'lookdev', 'main.ts');

interface Side {
  readonly ref: string;
  readonly sha: string;
  readonly short: string;
  readonly dir: string;
  readonly port: number;
  created: boolean;
  server: ChildProcess | null;
}

function checkout(ref: string, port: number): Side {
  const sha = git(here, 'rev-parse', `${ref}^{commit}`);
  const short = sha.slice(0, 7);
  const dir = join(mainRepo, '.claude', 'worktrees', `ab-${short}`);
  let created = false;
  if (existsSync(dir)) {
    const at = git(dir, 'rev-parse', 'HEAD');
    if (at !== sha) throw new Error(`${dir} exists at ${at}, not ${sha}: remove it first`);
    log(`reusing ${dir}`);
  } else {
    git(mainRepo, 'worktree', 'add', '--detach', dir, sha);
    created = true;
    log(`checked out ${ref} (${short}) at ${dir}`);
  }
  // the harness, identical on both sides (the timing loop only)
  const src = join(here, harnessFile);
  const dst = join(dir, harnessFile);
  if (readFileSync(src, 'utf8') !== readFileSync(dst, 'utf8')) {
    copyFileSync(src, dst);
    log(`  harness: ${harnessFile} from ${here}`);
  }
  if (!existsSync(join(dir, 'node_modules', 'vite'))) {
    log(`  npm ci in ${dir} ...`);
    execFileSync('npm', ['ci', '--no-audit', '--no-fund'], {
      cwd: dir,
      stdio: 'inherit',
      shell: true,
    });
  }
  return { ref, sha, short, dir, port, created, server: null };
}

async function startServer(s: Side): Promise<void> {
  s.server = spawn(
    process.execPath,
    [join('node_modules', 'vite', 'bin', 'vite.js'), '--port', String(s.port), '--strictPort'],
    { cwd: s.dir, stdio: 'ignore' },
  );
  const url = `http://localhost:${String(s.port)}/lookdev.html`;
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`no Vite server for ${s.ref} at ${url}`);
}

function stopServer(s: Side): void {
  const pid = s.server?.pid;
  if (pid === undefined) return;
  // the whole tree (Vite's esbuild service with it)
  if (process.platform === 'win32')
    try {
      execFileSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' });
    } catch {
      // already gone
    }
  else s.server?.kill();
  s.server = null;
}

interface LookdevPage {
  lookdev?: {
    ready: boolean;
    setPreset(id: string): void;
    setProfile(id: string): void;
    renderFor(ms: number, saturate?: boolean): Promise<void>;
    timeRun(
      ms: number,
      saturate?: boolean,
    ): Promise<{
      frames: FrameSample[];
      rafDeltas: number[];
      hiddenMs: number;
      blurs?: number;
      events: string[];
      vsyncDeltas?: number[];
    }>;
    conditions(): Promise<Record<string, unknown>>;
    stats(): { errors: unknown[]; renderScale: number };
  };
}

async function main(): Promise<void> {
  const sides: Side[] = [];
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: false,
    args: ['--enable-unsafe-webgpu'],
  });
  try {
    sides.push(checkout(refsArg[0] ?? '', basePort), checkout(refsArg[1] ?? '', basePort + 1));
    for (const s of sides) await startServer(s);
    const [a, b] = sides as [Side, Side];
    const page = await browser.newPage({
      viewport: { width: 1920, height: 1080 },
      deviceScaleFactor: 1,
    });
    page.on('console', (m) => {
      if (m.type() === 'error') log(`[page error] ${m.text()}`);
    });
    const open = async (s: Side): Promise<void> => {
      await page.goto(`http://localhost:${String(s.port)}/lookdev.html?clean=1`);
      await page.waitForFunction(() => (window as LookdevPage).lookdev?.ready === true, null, {
        timeout: 120_000,
      });
    };
    // a fresh checkout's first page load makes Vite optimize its dependencies and reload the
    // page: load each side until a load holds still for 5 s
    for (const s of sides)
      for (let tries = 0; ; tries++) {
        await open(s);
        await page.waitForTimeout(5000);
        const ok = await page
          .evaluate(() => (window as LookdevPage).lookdev?.ready === true)
          .catch(() => false);
        if (ok) break;
        if (tries > 5) throw new Error(`the ${s.ref} page does not settle`);
      }
    await open(a);
    const atStart = await page.evaluate(async () => {
      const l = (window as LookdevPage).lookdev;
      return l ? await l.conditions() : {};
    });
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
    const order = abOrder([a.short, b.short], t.pacings, t.reps);
    log(
      `A/B ${a.ref} (${a.short}) - ${b.ref} (${b.short}): ${preset}, ${profile}, pacing ${t.pacings.join(' + ')}, ${String(t.reps)} reps x ${String(t.warmupS)} s warm-up + ${String(t.runS)} s, ${String(order.length)} runs`,
    );
    const protocol = t.warmupS >= 10 && t.runS >= 60 && t.reps >= 3;
    const power: PowerSource[] = [];
    const runs: (AbRun & {
      summary: RunSummary;
      valid: boolean;
      reasons: readonly string[];
      warnings: readonly string[];
      framesPerS: number;
      gpuBusy: number;
      errors: number;
      power: readonly PowerSource[];
    })[] = [];
    for (const r of order) {
      const s = r.ref === a.short ? a : b;
      await open(s);
      const sat = r.pacing === 'backToBack';
      const powerBefore = osPowerSource();
      const run = await page.evaluate(
        async ([p, prof, warmMs, runMs, saturate]) => {
          const l = (window as LookdevPage).lookdev;
          if (l === undefined) throw new Error('no lookdev');
          l.setProfile(prof);
          l.setPreset(p);
          await l.renderFor(warmMs, saturate);
          const res = await l.timeRun(runMs, saturate);
          return { ...res, errors: l.stats().errors.length };
        },
        [preset, profile, t.warmupS * 1000, t.runS * 1000, sat] as const,
      );
      const powerAfter = osPowerSource();
      power.push(powerBefore, powerAfter);
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
        powerValidity([powerBefore, powerAfter], protocol),
      ]);
      const load = backToBackLoad(run.frames, run.rafDeltas);
      runs.push({
        ...r,
        summary,
        ...v,
        ...load,
        errors: run.errors,
        power: [powerBefore, powerAfter],
      });
      const g = summary.gpu;
      log(
        `rep ${String(r.rep + 1)} ${r.pacing.padEnd(10)} ${s.short}: GPU ${summary.gpuTotal.p50.toFixed(2)} ms (p10 ${summary.gpuTotal.p10.toFixed(2)}, p90 ${summary.gpuTotal.p90.toFixed(2)}; opaque ${g.opaque.p50.toFixed(2)}, rotors ${g.rotors.p50.toFixed(2)}), ${String(summary.frames)} frames, ${load.framesPerS.toFixed(1)} fps, busy ${(100 * load.gpuBusy).toFixed(0)} %, ${v.valid ? 'valid' : v.reasons.join('; ')}${v.warnings.length > 0 ? ` [${v.warnings.join('; ')}]` : ''}, errors ${String(run.errors)}, power ${powerBefore} -> ${powerAfter}`,
      );
    }
    const atEnd = await page.evaluate(async () => {
      const l = (window as LookdevPage).lookdev;
      return l ? await l.conditions() : {};
    });
    const summary = abSummary([a.short, b.short], runs);
    const shown = ['opaque', 'rotors', 'gtao', 'composite', 'traa', 'output'] as const;
    for (const pacing of t.pacings) {
      const sm = summary[pacing];
      if (sm === undefined) continue;
      for (const s of [a, b]) {
        const c = sm.side[s.short];
        if (c === undefined) continue;
        log(
          `${pacing} ${s.short}: GPU ${c.gpuTotal.p50.toFixed(2)} ms (${shown.map((k) => `${k} ${c.gpu[k].p50.toFixed(2)}`).join(', ')})`,
        );
      }
      const d = sm.diff;
      const f = (x: number) => `${x >= 0 ? '+' : ''}${x.toFixed(2)}`;
      log(
        `${pacing} ${a.short} - ${b.short}, paired (${String(sm.pairs)} valid${sm.dropped.length > 0 ? `; dropped repetitions ${sm.dropped.join(', ')}` : ''}): GPU ${f(d.gpuTotal.median)} [${d.gpuTotal.values.map(f).join(' ')}]; ${shown.map((k) => `${k} ${f(d[k].median)} [${d[k].values.map(f).join(' ')}]`).join('; ')}`,
      );
    }
    const allValid = runs.every((r) => r.valid);
    log(allValid ? 'every run VALID' : 'INVALID runs: see above (their pairs are dropped)');
    const ac = acThroughout(power);
    if (!ac) log('the OS power source was not AC throughout: indicative');
    const official = protocol && ac && allValid;
    const file = join(out, `ab-${a.short}-${b.short}.json`);
    writeFileSync(
      file,
      `${JSON.stringify(
        {
          date: new Date().toISOString(),
          what: `${a.ref} (${a.sha}) - ${b.ref} (${b.sha})`,
          harness: `${harnessFile} from ${git(here, 'rev-parse', 'HEAD')}${git(here, 'status', '--porcelain', harnessFile) === '' ? '' : ' (uncommitted changes)'}`,
          preset,
          profile,
          viewport: '1920x1080 DPR 1',
          protocol: { warmupS: t.warmupS, runS: t.runS, reps: t.reps, pacings: t.pacings, order },
          official: official
            ? 'D0-1 protocol, AC throughout, every run VALID (official if the machine was quiet)'
            : 'indicative',
          powerSourceAcThroughout: ac,
          displayIntervalMs: displayMs,
          conditions: { start: atStart, end: atEnd },
          allValid,
          summary,
          runs: runs.map(({ summary: s, ...r }) => ({
            ...r,
            gpuTotal: s.gpuTotal,
            gpu: s.gpu,
            frames: s.frames,
          })),
        },
        null,
        2,
      )}\n`,
    );
    // Prettier-formatted, so `npm run lint` stays green (W1V-B1)
    execFileSync(
      process.execPath,
      [join('node_modules', 'prettier', 'bin', 'prettier.cjs'), '--write', file],
      {
        cwd: here,
        stdio: 'ignore',
      },
    );
    log(`saved ${file}`);
  } finally {
    await browser.close();
    for (const s of sides) stopServer(s);
    for (const s of sides)
      if (!keep && existsSync(s.dir)) {
        try {
          git(mainRepo, 'worktree', 'remove', '--force', s.dir);
          log(`removed ${s.dir}`);
        } catch (e) {
          log(`could not remove ${s.dir}: ${String(e)}`);
        }
      }
    if (!keep) git(mainRepo, 'worktree', 'prune');
  }
}

main().catch((e: unknown) => {
  console.error(e);
  process.exitCode = 1;
});
