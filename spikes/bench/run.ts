// Benchmark harness for spikes (a) and (d), D0-1 protocol (docs/reviews/LOG.md).
//
//   npm run bench:throughput [-- --quick] [-- --only=130k-16x8,...] [-- --port=5181]
//   npm run bench:worker     [-- --quick] [-- --only=main-idle,worker-idle,...]
//
// Starts a Vite dev server, launches the installed Chrome headed and maximized (Playwright,
// no extra Chrome flags), runs each configuration in the page (warm-up, then 3 runs), records
// the conditions (D0-1/D0-3: power source, power plan and Windows power mode, CPU load before,
// during and after, other processes using the GPU before and after, GPU name and driver,
// adapter features/limits, Chrome version, window size, git HEAD) and writes
// docs/bench/<kind>-<local date>-<HHMM>-<protocol>.json. Only the orchestrator's quiet,
// official runs count for P1/D0-2; --quick numbers are "indicative, contaminated (D0-1)".

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { cpus, totalmem } from 'node:os';
import { chromium, type Page } from '@playwright/test';
import { createServer, type InlineConfig, type ViteDevServer } from 'vite';
import type { ThroughputResult } from '../throughput/main.ts';
import type { WorkerBenchResult } from '../worker/main.ts';
import { benchFileName, parseBenchArgs, protocolLabel, type Protocol } from '../lib/protocol.ts';
import {
  cpuBusyFraction,
  gpuBusyByProcess,
  parseActiveScheme,
  powerModeFromOverlay,
  powerSourceFromBatteryStatus,
} from '../lib/system.ts';

type Kind = 'throughput' | 'worker';

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
  readonly [key: string]: unknown;
}

function throughputConfigs(protocol: Protocol): PageConfig[] {
  return GRIDS.flatMap((g) =>
    TILES.map((t) => ({
      id: `${g.id}-${t.x}x${t.y}`,
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
    { id: 'main-idle', mode: 'main', reactHz: 0, ...base },
    { id: 'worker-idle', mode: 'worker', reactHz: 0, ...base },
    { id: 'main-react15', mode: 'main', reactHz: 15, ...base },
    { id: 'worker-react15', mode: 'worker', reactHz: 15, ...base },
    { id: 'main-react60', mode: 'main', reactHz: 60, ...base },
    { id: 'worker-react60', mode: 'worker', reactHz: 60, ...base },
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

/** The GPU name and driver version as Windows reports them (adapter.info has neither). */
function gpuDrivers() {
  try {
    return powershell(
      'Get-CimInstance Win32_VideoController | ForEach-Object { "$($_.Name)|$($_.DriverVersion)" }',
    )
      .split(/\r?\n/)
      .filter((l) => l.includes('|'))
      .map((l) => {
        const [name = '', driverVersion = ''] = l.split('|');
        return { name: name.trim(), driverVersion: driverVersion.trim() };
      });
  } catch (e) {
    return { error: String(e) };
  }
}

/** Another window covered Chrome during the runs: rAF stopped, so the timing is invalid. */
function hiddenNote(ms: number): string {
  return ms > 0 ? `, PAGE HIDDEN ${ms.toFixed(0)} ms: INVALID (D0-1)` : '';
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
];

function devServer(port: number, headers?: Record<string, string>): InlineConfig {
  return {
    logLevel: 'warn',
    optimizeDeps: {
      entries: ['spikes/throughput/index.html', 'spikes/worker/index.html'],
      include: PREBUNDLE,
    },
    server: { port, strictPort: true, host: '127.0.0.1', ...(headers ? { headers } : {}) },
  };
}

async function main(): Promise<void> {
  const kindArg = process.argv[2];
  if (kindArg !== 'throughput' && kindArg !== 'worker') {
    throw new Error('usage: node spikes/bench/run.ts <throughput|worker> [--quick] [--only=..]');
  }
  const kind: Kind = kindArg;
  const args = parseBenchArgs(process.argv.slice(3));
  const all =
    kind === 'throughput' ? throughputConfigs(args.protocol) : workerConfigs(args.protocol);
  const configs = args.only ? all.filter((c) => args.only?.includes(c.id)) : all;
  if (configs.length === 0)
    throw new Error(`no configuration matches --only=${args.only?.join(',')}`);

  const started = new Date();
  const conditions = {
    date: started.toISOString(),
    protocol: args.protocol,
    label: protocolLabel(args.protocol),
    gitHead: git(['rev-parse', '--short', 'HEAD']),
    gitDirty: git(['status', '--porcelain']).length > 0,
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
    chromeFlags: [] as string[],
  };
  process.stdout.write(`${kind}: ${configs.length} configs, ${conditions.label}\n`);

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
    const consoleErrors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error' || m.type() === 'warning')
        consoleErrors.push(`${m.type()}: ${m.text()}`);
    });
    page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));

    const gpuPage = await chromeGpuBackend(page);
    const base = `http://127.0.0.1:${args.port}`;
    const results: unknown[] = [];
    let pageInfo: unknown = null;
    let workerProbe: unknown = null;

    if (kind === 'throughput') {
      await page.goto(`${base}/spikes/throughput/index.html`);
      await page.bringToFront();
      pageInfo = await page.evaluate(() => window.__bench?.ready);
      for (const config of configs) {
        process.stdout.write(`  ${config.id} ... `);
        await page.bringToFront();
        const before = cpus();
        const r = await page.evaluate((c) => window.__bench?.run(c as never), config);
        const load = cpuBusyFraction(before, cpus());
        results.push({ ...(r as object), cpuLoadDuring: load });
        const tr = r as ThroughputResult;
        const agg = tr.aggregate;
        process.stdout.write(
          `${agg.solverMsPerIt?.toFixed(3) ?? '-'} ms/it (p10 ${agg.solverMsPerItP10?.toFixed(3) ?? '-'}), ` +
            `achieved ${agg.itPerSec.toFixed(0)} it/s, frame p99 ${agg.frameTimeP99.toFixed(1)} ms, CPU ${(100 * load).toFixed(0)}%${hiddenNote(tr.pageHiddenMs)}\n`,
        );
      }
      await page.evaluate(() => window.__bench?.dispose());
    } else {
      for (const config of configs) {
        process.stdout.write(`  ${config.id} ... `);
        const url = `${base}/spikes/worker/index.html?mode=${String(config.mode)}&react=${String(config.reactHz)}`;
        await page.goto(url);
        await page.bringToFront();
        const info = await page.evaluate(() => window.__workerBench?.ready);
        pageInfo ??= info;
        const before = cpus();
        const r = await page.evaluate((c) => window.__workerBench?.run(c as never), config);
        const load = cpuBusyFraction(before, cpus());
        results.push({ ...(r as object), cpuLoadDuring: load });
        const w = r as WorkerBenchResult;
        const ft = w.frame.aggregate;
        process.stdout.write(
          `frame p50/p95/p99 ${ft.frameTimeP50.toFixed(2)}/${ft.frameTimeP95.toFixed(2)}/${ft.frameTimeP99.toFixed(2)} ms, ` +
            `long frames/run ${ft.longFrames}, rAF delay p99 ${ft.callbackDelayP99?.toFixed(1) ?? '-'} ms, React commit p95 ${w.reactCommitMs?.p95.toFixed(1) ?? '-'} ms, CPU ${(100 * load).toFixed(0)}%${hiddenNote(w.pageHiddenMs)}\n`,
        );
        workerProbe ??= await page.evaluate(() => window.__workerBench?.probe());
        await page.evaluate(() => window.__workerBench?.dispose());
      }
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

    const out = {
      kind,
      conditions: {
        ...conditions,
        chrome: browser.version(),
        chromeGpu: gpuPage,
        page: pageInfo,
        cpuLoadAfter: await cpuLoadOver(2000),
        gpuBusyAfter: gpuBusyOthers(),
        finished: new Date().toISOString(),
      },
      results,
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
