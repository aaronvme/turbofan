// Benchmark harness for spikes (a) and (d) and the official P1 run, D0-1 protocol
// (docs/reviews/LOG.md). See spikes/README.md for the commands, durations and the checklist.
//
//   npm run bench:throughput [-- --quick] [-- --only=130k-16x8,...] [-- --port=5181] [-- --seed=N]
//   npm run bench:worker     [-- --quick] [-- --only=main-idle,worker-idle,...]
//   npm run bench:p1         [-- --quick] [-- --only=solver-130k-app,...]
//     P1 (D4-54, D4-64; spikes/lib/p1.ts): the app's GpuFlowSolver on the shipped 130k asset at
//     D4-2's budget inside the app's own 1080p engine scene (solver-130k-app: the measurement of
//     record, spikes/p1), the same in the W0 1080p bench scene beside it (solver-130k-bench), and
//     the W0 spike kernel's 130k-16x8 (M34's calibration row), the three rotated as one group, a
//     fresh page (and device) for every run; prints the P1 verdict on the record row and writes
//     docs/bench/p1-<date>-<HHMM>-<protocol>.json
//
// Starts a Vite dev server, launches the installed Chrome headed and maximized (Playwright,
// whose default switches include --disable-backgrounding-occluded-windows: an occluded window
// stays "visible" while its rAF drops to ~1 Hz), measures the display's refresh interval with
// an idle rAF probe, then runs 3 repetitions of the sweep in a seeded, rotated order
// (spikes/lib/order.ts), each configuration a warm-up then one run, with Chrome brought to the
// front (CDP Page.bringToFront) before each. A run that shows the occlusion signature or a
// hidden or blurred page (spikes/lib/validity.ts, D3-6), that reports a GPU error or a
// non-finite solver state (spikes/lib/p1.ts solverValidity, W2I-I2), or that stalls past its
// timeout (spikes/lib/timeout.ts, W0G-N6), is rerun once; a configuration with a run still invalid is
// reported INVALID, without numbers. A slow load is a warning next to its numbers. Records the conditions (D0-1/D0-3: power source, power plan and Windows power
// mode, CPU load before, during and after, other processes using the GPU before and after, GPU
// name, driver and refresh rate, adapter features/limits, Chrome version and command line,
// window size, git HEAD) and writes docs/bench/<kind>-<local date>-<HHMM>-<protocol>.json. Only
// the orchestrator's quiet, official runs count; --quick numbers are "indicative, contaminated".

import { execFileSync } from 'node:child_process';
import { randomInt } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { cpus, totalmem } from 'node:os';
import { chromium, type CDPSession, type Page } from '@playwright/test';
import { createServer, type InlineConfig, type ViteDevServer } from 'vite';
import type { ThroughputResult } from '../throughput/main.ts';
import type { WorkerBenchResult } from '../worker/main.ts';
import { aggregateRuns, type RunResult } from '../lib/benchRun.ts';
import { focusValidity, pageHasFocus, realFocus } from '../lib/focus.ts';
import { orderEffect, sweepOrder } from '../lib/order.ts';
import {
  P1_PAGES,
  p1Configs,
  p1TimeoutMs,
  p1Verdict,
  sceneOf,
  solverValidity,
  type P1Scene,
} from '../lib/p1.ts';
import { benchFileName, parseBenchArgs, protocolLabel, type Protocol } from '../lib/protocol.ts';
import { median } from '../lib/stats.ts';
import { THRESHOLDS } from '../../src/contracts/thresholds.ts';
import {
  LONG_FRAME_FACTOR,
  BELOW_RATE_MEDIAN_FACTOR,
  MAX_THROTTLED_STRETCH_MS,
  OCCLUSION_DELTA_MS,
  OCCLUSION_MIN_STRETCH_MS,
  THROTTLE_FACTOR,
  combineValidity,
  displayIntervalMs,
  runValidity,
  type Validity,
} from '../lib/validity.ts';
import { runTimeoutMs, stalledValidity, withTimeout } from '../lib/timeout.ts';
import {
  cpuBusyFraction,
  gpuBusyByProcess,
  parseActiveScheme,
  powerModeFromOverlay,
  powerSourceFromBatteryStatus,
} from '../lib/system.ts';

type Kind = 'throughput' | 'worker' | 'p1';

const GRIDS = [
  { id: '80k', ni: 400, nj: 200 },
  { id: '130k', ni: 512, nj: 256 },
  { id: '256k', ni: 724, nj: 362 },
] as const;
const TILES = [
  { x: 16, y: 8 },
  { x: 8, y: 8 },
  { x: 32, y: 4 },
] as const;

interface PageConfig {
  readonly id: string;
  /** Configurations compared with each other (spikes/lib/order.ts). */
  readonly group: string;
  readonly [key: string]: unknown;
}

function throughputConfigs(protocol: Protocol): PageConfig[] {
  return GRIDS.flatMap((g) =>
    TILES.map((t) => ({
      id: `${g.id}-${t.x}x${t.y}`,
      group: g.id,
      grid: { ni: g.ni, nj: g.nj },
      blocks: { bi: 4, bj: 3 },
      tile: t,
      iterations: 'adaptive',
      protocol,
      particles: 65536,
    })),
  );
}

/** Same scene + compute, fixed 3 iterations per frame so both modes carry the same GPU load. */
function workerConfigs(protocol: Protocol): PageConfig[] {
  const base = {
    grid: { ni: 512, nj: 256 },
    blocks: { bi: 4, bj: 3 },
    tile: { x: 16, y: 8 },
    iterations: 3,
    protocol,
    particles: 65536,
  };
  return [
    // Idle pair: what the worker path costs by itself. 15 Hz: an engine overlay's update rate.
    // 60 Hz: a UI that re-renders every frame (e.g. an unthrottled store subscription).
    { id: 'main-idle', group: 'idle', mode: 'main', reactHz: 0, ...base },
    { id: 'worker-idle', group: 'idle', mode: 'worker', reactHz: 0, ...base },
    { id: 'main-react15', group: 'react15', mode: 'main', reactHz: 15, ...base },
    { id: 'worker-react15', group: 'react15', mode: 'worker', reactHz: 15, ...base },
    { id: 'main-react60', group: 'react60', mode: 'main', reactHz: 60, ...base },
    { id: 'worker-react60', group: 'react60', mode: 'worker', reactHz: 60, ...base },
  ];
}

function powershell(command: string): string {
  return execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', command], {
    encoding: 'utf8',
  }).trim();
}

function powerSource() {
  try {
    const out = powershell('(Get-CimInstance Win32_Battery).BatteryStatus');
    const codes = out
      .split(/\s+/)
      .filter((s) => s.length > 0)
      .map(Number);
    return { source: powerSourceFromBatteryStatus(codes), batteryStatus: codes };
  } catch (e) {
    return { source: 'unknown' as const, error: String(e) };
  }
}

/**
 * Other processes using the (shared, integrated) GPU over a 3 s sample, with their names. A
 * game or video in the background shows up here and explains slow solver timings (D0-1).
 */
function gpuBusyOthers() {
  const samples = 3;
  try {
    const raw = powershell(
      `(Get-Counter '\\GPU Engine(*)\\Utilization Percentage' -SampleInterval 1 -MaxSamples ${samples} -ErrorAction SilentlyContinue).CounterSamples | ` +
        'ForEach-Object { "$($_.InstanceName)|$($_.CookedValue)" }',
    );
    const busy = gpuBusyByProcess(
      raw
        .split(/\r?\n/)
        .map((l) => l.split('|'))
        .map(([instance = '', value = '']) => ({ instance, value: Number(value) })),
      samples,
    );
    const names = new Map<number, string>();
    if (busy.length > 0) {
      const ids = busy.map((b) => b.pid).join(',');
      for (const l of powershell(
        `Get-Process -Id ${ids} -ErrorAction SilentlyContinue | ForEach-Object { "$($_.Id)|$($_.ProcessName)" }`,
      ).split(/\r?\n/)) {
        const [pid = '', name = ''] = l.split('|');
        names.set(Number(pid), name.trim());
      }
    }
    return busy.map((b) => ({ ...b, name: names.get(b.pid) ?? 'exited' }));
  } catch (e) {
    return { error: String(e) };
  }
}

/** D0-3: the active plan ("Balanced" first, as a lower bound). */
function powerPlan() {
  try {
    const out = execFileSync('powercfg', ['/getactivescheme'], { encoding: 'utf8' });
    return parseActiveScheme(out) ?? { error: `unparsed: ${out.trim()}` };
  } catch (e) {
    return { error: String(e) };
  }
}

/** Windows 11 power mode (an overlay on the plan) for AC and battery. */
function powerMode() {
  try {
    const out = powershell(
      "$k = Get-ItemProperty 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Power\\User\\PowerSchemes'; " +
        '"$($k.ActiveOverlayAcPowerScheme) $($k.ActiveOverlayDcPowerScheme)"',
    );
    const [ac = '', dc = ''] = out.split(/\s+/);
    return {
      ac: powerModeFromOverlay(ac),
      dc: powerModeFromOverlay(dc),
      acOverlay: ac,
      dcOverlay: dc,
    };
  } catch (e) {
    return { error: String(e) };
  }
}

/**
 * The GPU name, driver version and the display's current refresh rate as Windows reports them
 * (adapter.info has none of them). The refresh rate cross-checks the rAF probe (W0G-N1).
 */
function gpuDrivers() {
  try {
    return powershell(
      'Get-CimInstance Win32_VideoController | ForEach-Object { "$($_.Name)|$($_.DriverVersion)|$($_.CurrentRefreshRate)" }',
    )
      .split(/\r?\n/)
      .filter((l) => l.includes('|'))
      .map((l) => {
        const [name = '', driverVersion = '', refresh = ''] = l.split('|');
        const hz = Number(refresh.trim());
        return {
          name: name.trim(),
          driverVersion: driverVersion.trim(),
          currentRefreshHz: refresh.trim() !== '' && Number.isFinite(hz) ? hz : null,
        };
      });
  } catch (e) {
    return { error: String(e) };
  }
}

async function cpuLoadOver(ms: number): Promise<number> {
  const before = cpus();
  await new Promise((r) => setTimeout(r, ms));
  return cpuBusyFraction(before, cpus());
}

function git(args: string[]): string {
  try {
    return execFileSync('git', args, { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

/** Best effort: the Dawn backend line from chrome://gpu (adapter.info has no description). */
async function chromeGpuBackend(page: Page): Promise<string[] | null> {
  try {
    await page.goto('chrome://gpu', { waitUntil: 'load' });
    await page.waitForTimeout(3000);
    const text = await page.evaluate(() => {
      const parts: string[] = [];
      const walk = (n: Node) => {
        if (n.nodeType === Node.TEXT_NODE) parts.push(n.textContent ?? '');
        const el = n as Element;
        if (el.shadowRoot) el.shadowRoot.childNodes.forEach(walk);
        n.childNodes.forEach(walk);
      };
      walk(document.body);
      return parts.join('\n');
    });
    const lines = text
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && l.length < 300);
    // The Dawn section lists adapters as "<Integrated GPU> D3D12 backend - <name>".
    return lines.filter((l) => /backend - |driver version|driver d3d12/i.test(l)).slice(0, 12);
  } catch {
    return null;
  }
}

// Every bare import the spike pages and their workers use. Without the list, Vite discovers
// the worker's imports (e.g. HDRLoader in the probe) only when the worker requests them,
// re-optimizes and reloads the page in the middle of a run.
const PREBUNDLE = [
  'react',
  'react/jsx-dev-runtime',
  'react-dom/client',
  'three',
  'three/webgpu',
  'three/tsl',
  'three/addons/controls/OrbitControls.js',
  'three/addons/environments/RoomEnvironment.js',
  'three/addons/loaders/GLTFLoader.js',
  'three/addons/loaders/HDRLoader.js',
  'three/addons/tsl/display/BloomNode.js',
  // the app's engine scene (the P1 page, src/render/post.ts)
  'three/addons/tsl/display/DepthOfFieldNode.js',
  'three/addons/tsl/display/GTAONode.js',
  'three/addons/tsl/display/TRAANode.js',
  'three/addons/tsl/utils/TAAUtils.js',
];

function devServer(port: number, headers?: Record<string, string>): InlineConfig {
  return {
    logLevel: 'warn',
    optimizeDeps: {
      entries: ['spikes/throughput/index.html', 'spikes/worker/index.html', 'spikes/p1/index.html'],
      include: PREBUNDLE,
    },
    server: { port, strictPort: true, host: '127.0.0.1', ...(headers ? { headers } : {}) },
  };
}

/**
 * Chrome's full command line from chrome://version, so the record holds Playwright's default
 * switches as well as ours (W0G-N1), and the switches parsed from it.
 */
async function chromeCommandLine(
  page: Page,
): Promise<{ commandLine: string | null; flags: string[]; error?: string }> {
  try {
    await page.goto('chrome://version', { waitUntil: 'load' });
    const commandLine = (await page.locator('#command_line').textContent())?.trim() ?? null;
    return { commandLine, flags: commandLine?.match(/--[^\s"=]+(?:=(?:"[^"]*"|\S*))?/g) ?? [] };
  } catch (e) {
    return { commandLine: null, flags: [], error: String(e) };
  }
}

/** Idle rAF deltas on a blank page (up to 120 frames or 3 s): the display's refresh interval. */
async function rafProbe(page: Page): Promise<number[]> {
  return page.evaluate(
    () =>
      new Promise<number[]>((resolve) => {
        const deltas: number[] = [];
        let last: number | null = null;
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          resolve(deltas);
        };
        setTimeout(finish, 3000);
        const frame = (t: number) => {
          if (done) return;
          if (last !== null) deltas.push(t - last);
          last = t;
          if (deltas.length >= 120) finish();
          else requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
      }),
  );
}

/** One run of one configuration, as the page returned it. */
interface Attempt {
  readonly rep: number;
  /** Position in the whole sweep, reruns included. */
  readonly seq: number;
  readonly attempt: 1 | 2;
  readonly validity: Validity;
  readonly cpuLoadDuring: number;
  /** Null for a run that stalled past its timeout (W0G-N6). */
  readonly run: RunResult | null;
  readonly result: ThroughputResult | WorkerBenchResult | null;
}

type PageRun = (config: PageConfig) => Promise<Omit<Attempt, 'rep' | 'seq' | 'attempt'>>;

function onlyRun(runs: readonly RunResult[]): RunResult {
  const r = runs[0];
  if (!r || runs.length !== 1) throw new Error(`expected one run per attempt, got ${runs.length}`);
  return r;
}

const fmt = (x: number | null | undefined, digits: number) => x?.toFixed(digits) ?? '-';

/** D2-13: a warning (e.g. below display rate) is printed next to the numbers, not instead. */
const warningNote = (v: Validity) =>
  v.warnings.length > 0 ? ` WARNING: ${v.warnings.join('; ')}` : '';

function attemptLine(kind: Kind, a: Attempt): string {
  const r = a.run;
  if (!a.validity.valid || r === null) return `INVALID: ${a.validity.reasons.join('; ')}`;
  const cpu = `CPU ${(100 * a.cpuLoadDuring).toFixed(0)}%`;
  if (kind !== 'worker') {
    return (
      `${fmt(r.solverMsPerIt, 3)} ms/it (p10 ${fmt(r.solverMsPerItP10, 3)}), ${r.itPerSec.toFixed(0)} it/s, ` +
      `frame p99 ${r.frameTime.p99.toFixed(1)} ms, long frames ${r.longFrames}, ${cpu}`
    );
  }
  const w = a.result as WorkerBenchResult;
  return (
    `frame p50/p95/p99 ${r.frameTime.p50.toFixed(2)}/${r.frameTime.p95.toFixed(2)}/${r.frameTime.p99.toFixed(2)} ms, ` +
    `long frames ${r.longFrames}, rAF delay p99 ${fmt(r.callbackDelay?.p99, 1)} ms, ` +
    `React commit p95 ${fmt(w.reactCommitMs?.p95, 1)} ms, ${cpu}`
  );
}

function serialize(a: Attempt) {
  return {
    rep: a.rep,
    seq: a.seq,
    attempt: a.attempt,
    validity: a.validity,
    cpuLoadDuring: a.cpuLoadDuring,
    result: a.result,
  };
}

async function main(): Promise<void> {
  const kindArg = process.argv[2];
  if (kindArg !== 'throughput' && kindArg !== 'worker' && kindArg !== 'p1') {
    throw new Error(
      'usage: node spikes/bench/run.ts <throughput|worker|p1> [--quick] [--only=..] [--port=N] [--seed=N]',
    );
  }
  const kind: Kind = kindArg;
  const args = parseBenchArgs(process.argv.slice(3));
  const all =
    kind === 'throughput'
      ? throughputConfigs(args.protocol)
      : kind === 'p1'
        ? p1Configs(args.protocol)
        : workerConfigs(args.protocol);
  const configs = args.only ? all.filter((c) => args.only?.includes(c.id)) : all;
  if (configs.length === 0)
    throw new Error(`no configuration matches --only=${args.only?.join(',')}`);
  const byId = new Map(configs.map((c) => [c.id, c]));
  // W0G-I2: the protocol's 3 runs are 3 repetitions of the sweep in rotated order.
  const seed = args.seed ?? randomInt(0, 2 ** 32);
  const orders = sweepOrder(configs, args.protocol.runs, seed);
  const single: Protocol = { ...args.protocol, runs: 1 };

  const started = new Date();
  const conditions = {
    date: started.toISOString(),
    protocol: args.protocol,
    label: protocolLabel(args.protocol),
    gitHead: git(['rev-parse', '--short', 'HEAD']),
    // Tracked files only: an untracked bench JSON from the run before is not a code change (N2).
    gitDirty: git(['status', '--porcelain', '--untracked-files=no']).length > 0,
    power: powerSource(),
    powerPlan: powerPlan(),
    powerMode: powerMode(),
    gpu: gpuDrivers(),
    cpu: cpus()[0]?.model ?? 'unknown',
    logicalCpus: cpus().length,
    memoryGiB: Math.round(totalmem() / 2 ** 30),
    // Other work on the machine shows up here; the official run wants this near idle.
    cpuLoadBefore: await cpuLoadOver(3000),
    // Should be empty (apart from dwm, the desktop compositor) for an official run.
    gpuBusyBefore: gpuBusyOthers(),
    node: process.version,
  };
  process.stdout.write(
    `${kind}: ${configs.length} configs x ${orders.length} repetitions, seed ${seed}, ${conditions.label}\n`,
  );

  let server: ViteDevServer | null = null;
  let coiServer: ViteDevServer | null = null;
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: false,
    args: ['--start-maximized'],
  });
  try {
    server = await createServer(devServer(args.port));
    await server.listen();
    const context = await browser.newContext({ viewport: null });
    const page = await context.newPage();
    // Playwright's page.bringToFront() sends this same CDP command; sent directly so the
    // harness says what it does. Before every run: an occluded or unfocused window is
    // throttled to ~1 Hz without becoming "hidden" (W0G-I1). D4-73 (W2L-I7): then Playwright's
    // focus emulation is switched off and checked, so D3-6's blur rule sees the OS focus; it does
    // not survive a navigation (GPU_FACTS M56), and every navigation here is followed by this.
    const cdp: CDPSession = await context.newCDPSession(page);
    const refocus = async () => {
      await cdp.send('Page.bringToFront');
      await realFocus(page, cdp, () => context.newPage());
    };
    const consoleErrors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error' || m.type() === 'warning')
        consoleErrors.push(`${m.type()}: ${m.text()}`);
    });
    page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));

    const chromeCmd = await chromeCommandLine(page);
    const gpuPage = await chromeGpuBackend(page);
    await page.goto('about:blank');
    await refocus();
    const probe = await rafProbe(page);
    // Throws (and ends the run) if the probe ran throttled: no sweep with Chrome in the back.
    const intervalMs = displayIntervalMs(probe);
    const display = {
      intervalMs,
      hz: 1000 / intervalMs,
      probeFrames: probe.length,
      probeMaxMs: Math.max(...probe),
    };
    process.stdout.write(
      `display: rAF every ${intervalMs.toFixed(2)} ms (${display.hz.toFixed(1)} Hz) on an idle page\n`,
    );

    const base = `http://127.0.0.1:${args.port}`;
    let pageInfo: unknown = null;
    let workerProbe: unknown = null;

    const runThroughput: PageRun = async (config) => {
      const focusStart = await pageHasFocus(page);
      const before = cpus();
      const r = (await page.evaluate(
        (c) => window.__bench?.run(c as never),
        config,
      )) as ThroughputResult;
      const focusEnd = await pageHasFocus(page);
      const cpuLoadDuring = cpuBusyFraction(before, cpus());
      const run = onlyRun(r.runs);
      return {
        validity: combineValidity([
          runValidity(run, r.pageHiddenMs, r.pageBlurs),
          solverValidity(r),
          focusValidity(focusStart, focusEnd),
        ]),
        cpuLoadDuring,
        run,
        result: r,
      };
    };
    // P1: a fresh page for every run, so every run gets a fresh device: the app's engine scene
    // (spikes/p1, the record) or the W0 bench scene (the throughput page)
    const p1Pages: Partial<Record<P1Scene, unknown>> = {};
    const runP1: PageRun = async (config) => {
      const scene = sceneOf(config.scene);
      await page.goto(`${base}${P1_PAGES[scene]}`);
      await refocus();
      const app = scene === 'app';
      const info = app
        ? await page.evaluate(() => window.__p1?.ready)
        : await page.evaluate(() => window.__bench?.ready);
      p1Pages[scene] ??= info;
      const focusStart = await pageHasFocus(page);
      const before = cpus();
      const r = (
        app
          ? await page.evaluate((c) => window.__p1?.run(c as never), config)
          : await page.evaluate((c) => window.__bench?.run(c as never), config)
      ) as ThroughputResult;
      const focusEnd = await pageHasFocus(page);
      const cpuLoadDuring = cpuBusyFraction(before, cpus());
      if (app) await page.evaluate(() => window.__p1?.dispose());
      else await page.evaluate(() => window.__bench?.dispose());
      if (r.scene !== scene) throw new Error(`${config.id}: ran in scene ${r.scene}, not ${scene}`);
      const run = onlyRun(r.runs);
      return {
        validity: combineValidity([
          runValidity(run, r.pageHiddenMs, r.pageBlurs),
          solverValidity(r),
          focusValidity(focusStart, focusEnd),
        ]),
        cpuLoadDuring,
        run,
        result: r,
      };
    };
    const runWorker: PageRun = async (config) => {
      await page.goto(
        `${base}/spikes/worker/index.html?mode=${String(config.mode)}&react=${String(config.reactHz)}`,
      );
      await refocus();
      const info = await page.evaluate(() => window.__workerBench?.ready);
      pageInfo ??= info;
      const focusStart = await pageHasFocus(page);
      const before = cpus();
      const w = (await page.evaluate(
        (c) => window.__workerBench?.run(c as never),
        config,
      )) as WorkerBenchResult;
      const focusEnd = await pageHasFocus(page);
      const cpuLoadDuring = cpuBusyFraction(before, cpus());
      workerProbe ??= await page.evaluate(() => window.__workerBench?.probe());
      await page.evaluate(() => window.__workerBench?.dispose());
      const run = onlyRun(w.frame.runs);
      return {
        validity: combineValidity([
          runValidity(run, w.pageHiddenMs, w.pageBlurs),
          solverValidity(w.frame),
          focusValidity(focusStart, focusEnd),
        ]),
        cpuLoadDuring,
        run,
        result: w,
      };
    };

    // the throughput sweep keeps one page; P1 loads one per run (runP1)
    const onThroughputPage = kind === 'throughput';
    if (onThroughputPage) {
      await page.goto(`${base}/spikes/throughput/index.html`);
      await refocus();
      pageInfo = await page.evaluate(() => window.__bench?.ready);
    }
    const pageRun = kind === 'throughput' ? runThroughput : kind === 'p1' ? runP1 : runWorker;
    // W0G-N6: a stalled run is abandoned after this; the page is then reloaded before going on.
    // A P1 run's time includes its fresh page's load.
    const timeoutMs = kind === 'p1' ? p1TimeoutMs(single) : runTimeoutMs(single);
    const reloadPage = async () => {
      const target = onThroughputPage ? `${base}/spikes/throughput/index.html` : 'about:blank';
      const reloaded = await withTimeout(
        (async () => {
          await page.goto(target);
          if (onThroughputPage) await page.evaluate(() => window.__bench?.ready);
        })(),
        timeoutMs,
      );
      if (!reloaded.ok)
        throw new Error(`the page did not come back within ${timeoutMs} ms after a stall`);
    };

    const attempts: Attempt[] = [];
    const final = new Map<string, Attempt[]>(configs.map((c) => [c.id, []]));
    let seq = 0;
    for (const [rep, order] of orders.entries()) {
      process.stdout.write(`repetition ${rep + 1}/${orders.length}\n`);
      for (const id of order) {
        const config = byId.get(id);
        if (!config) throw new Error(`unknown configuration ${id}`);
        const pageConfig = { ...config, protocol: single, displayIntervalMs: intervalMs };
        let last: Attempt | null = null;
        // A run the gate rejects is rerun once, after another bringToFront (W0G-I1).
        for (const attempt of [1, 2] as const) {
          process.stdout.write(`  ${id}${attempt === 2 ? ' (rerun)' : ''} ... `);
          await refocus();
          const timed = await withTimeout(pageRun(pageConfig), timeoutMs);
          last = timed.ok
            ? { rep, seq: seq++, attempt, ...timed.value }
            : {
                rep,
                seq: seq++,
                attempt,
                validity: stalledValidity(timed.afterMs),
                cpuLoadDuring: Number.NaN,
                run: null,
                result: null,
              };
          attempts.push(last);
          if (!timed.ok) await reloadPage();
          process.stdout.write(`${attemptLine(kind, last)}${warningNote(last.validity)}\n`);
          if (last.validity.valid) break;
        }
        if (last) final.get(id)?.push(last);
      }
    }
    if (onThroughputPage) await page.evaluate(() => window.__bench?.dispose());

    if (kind === 'worker') {
      // crossOriginIsolated / SharedArrayBuffer with COOP/COEP from a Vite dev server, set
      // here on a second server rather than in vite.config.ts (D0-2 asks whether it works,
      // not to turn it on).
      coiServer = await createServer(
        devServer(args.port + 1, {
          'Cross-Origin-Opener-Policy': 'same-origin',
          'Cross-Origin-Embedder-Policy': 'require-corp',
        }),
      );
      await coiServer.listen();
      await page.goto(`http://127.0.0.1:${args.port + 1}/spikes/worker/index.html?mode=coi`);
      const coi = await page.evaluate(() => window.__workerBench?.coiCheck());
      await page.goto(`${base}/spikes/worker/index.html?mode=coi`);
      const noCoi = await page.evaluate(() => window.__workerBench?.coiCheck());
      workerProbe = { ...(workerProbe as object), coopCoep: coi, withoutHeaders: noCoi };
    }

    const idOf = new Map<Attempt, string>();
    for (const [id, list] of final) for (const a of list) idOf.set(a, id);
    const results = configs.map((c) => {
      const reps = final.get(c.id) ?? [];
      const validity = combineValidity(
        reps.map((a) => ({
          valid: a.validity.valid,
          reasons: a.validity.reasons.map((r) => `repetition ${a.rep + 1}: ${r}`),
          warnings: a.validity.warnings.map((w) => `repetition ${a.rep + 1}: ${w}`),
        })),
      );
      return {
        id: c.id,
        group: c.group,
        validity,
        // D0-1: the median over the repetitions of each metric; none for an invalid
        // configuration, so an invalid row cannot be quoted as a number (W0G-I1).
        aggregate: validity.valid
          ? aggregateRuns(reps.flatMap((a) => (a.run === null ? [] : [a.run])))
          : null,
        repetitions: reps.map(serialize),
      };
    });
    // W0G-I2: how much later runs drift, on ms/it, from the kept valid runs.
    const effect = orderEffect(
      [...idOf].flatMap(([a, id]) =>
        a.validity.valid && a.run !== null && a.run.solverMsPerIt !== null
          ? [{ id, seq: a.seq, value: a.run.solverMsPerIt }]
          : [],
      ),
    );

    process.stdout.write(`summary (median of ${orders.length} repetitions):\n`);
    for (const r of results) {
      const a = r.aggregate;
      if (!a) {
        process.stdout.write(`  ${r.id}: INVALID (${r.validity.reasons.join('; ')})\n`);
        continue;
      }
      const tail = `long frames/run ${a.longFrames}`;
      if (kind !== 'worker') {
        process.stdout.write(
          `  ${r.id}: ${fmt(a.solverMsPerIt, 3)} ms/it (p10 ${fmt(a.solverMsPerItP10, 3)}), ${a.itPerSec.toFixed(0)} it/s, ` +
            `${a.fps.toFixed(1)} fps, frame p99 ${a.frameTimeP99.toFixed(1)} ms, ${tail}${warningNote(r.validity)}\n`,
        );
      } else {
        const commits = (final.get(r.id) ?? []).flatMap((x) => {
          const p95 = (x.result as WorkerBenchResult | null)?.reactCommitMs?.p95;
          return p95 === undefined ? [] : [p95];
        });
        process.stdout.write(
          `  ${r.id}: frame p50/p95/p99 ${a.frameTimeP50.toFixed(2)}/${a.frameTimeP95.toFixed(2)}/${a.frameTimeP99.toFixed(2)} ms, ` +
            `${tail}, rAF delay p99 ${fmt(a.callbackDelayP99, 1)} ms, ` +
            `React commit p95 ${commits.length > 0 ? median(commits).toFixed(1) : '-'} ms${warningNote(r.validity)}\n`,
        );
      }
    }
    if (kind === 'p1') {
      // P1's verdict on the app scene's row of record (D4-64), the bench scene's beside it
      const min = THRESHOLDS.P1.values.minIterationsPerS.value;
      for (const line of p1Verdict(results, min, args.protocol.name === 'quick'))
        process.stdout.write(`${line}\n`);
    }
    process.stdout.write(
      effect
        ? `order effect on ms/it: ${(100 * effect.slopePerSlot).toFixed(2)} % per slot, ` +
            `${(100 * effect.overSweep).toFixed(1)} % over the sweep (n = ${effect.n})\n`
        : 'order effect: not enough valid runs\n',
    );

    const out = {
      kind,
      conditions: {
        ...conditions,
        chrome: browser.version(),
        chromeCommandLine: chromeCmd.commandLine,
        chromeFlags: chromeCmd.flags,
        ...(chromeCmd.error ? { chromeCommandLineError: chromeCmd.error } : {}),
        chromeGpu: gpuPage,
        display,
        page: kind === 'p1' ? p1Pages : pageInfo,
        cpuLoadAfter: await cpuLoadOver(2000),
        gpuBusyAfter: gpuBusyOthers(),
        finished: new Date().toISOString(),
      },
      gate: {
        displayIntervalMs: intervalMs,
        longFrameFactor: LONG_FRAME_FACTOR,
        throttleFactor: THROTTLE_FACTOR,
        // D3-6: INVALID only on the occlusion signature or a hidden or blurred page; a throttled
        // stretch over maxThrottledStretchMs and a slow median are warnings
        rule: 'D2-11 as amended by D3-6',
        occlusionDeltaMs: OCCLUSION_DELTA_MS,
        occlusionMinStretchMs: OCCLUSION_MIN_STRETCH_MS,
        maxThrottledStretchMs: MAX_THROTTLED_STRETCH_MS,
        runTimeoutMs: timeoutMs,
        // D2-13: a median frame over this many intervals is a warning, not INVALID.
        belowRateMedianFactor: BELOW_RATE_MEDIAN_FACTOR,
        rerun: 'once, after Page.bringToFront',
      },
      order: { seed, repetitions: orders, effectOnMsPerIt: effect },
      results,
      // Runs the gate rejected and that were rerun; kept for the record, never aggregated.
      rejectedAttempts: attempts.filter((a) => !idOf.has(a)).map(serialize),
      workerProbe,
      consoleErrors,
    };
    mkdirSync('docs/bench', { recursive: true });
    const file = benchFileName(kind, started, args.protocol);
    writeFileSync(file, JSON.stringify(out, null, 2) + '\n');
    process.stdout.write(`wrote ${file}\n`);
  } finally {
    await browser.close();
    await server?.close();
    await coiServer?.close();
  }
}

await main();
