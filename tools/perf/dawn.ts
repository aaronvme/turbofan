// The GPU flow solver's indicative profile on Dawn (Node, D3D12), D4-54. Not a D0-1 timing.
//
//   node --import ./tools/mesh/ts-resolve.mjs tools/perf/dawn.ts profile [--reps 40]
//     the GPU time of every dispatch of one tracking iteration at 130k (each in its own pass), the
//     sum, the same iteration in one pass, and the static bytes per dispatch
//   node --import ./tools/mesh/ts-resolve.mjs tools/perf/dawn.ts ab --refs c661d5c,WORKTREE [--reps 12]
//     paired, interleaved A/B (or A/B/C...) of builds on one device (ms/it, ms per frame of 2
//     iterations + the resample, the resample frame alone), then the bitwise comparison of each
//     side's results with the first's. A side is REF or REF@TXxTY (a tile): REF is a commit (its
//     src/ is exported with `git archive` under test-results/perf-ab/) or WORKTREE (this checkout).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { GpuErrorLog, requestSimDevice } from '../../src/gpu/device';
import { loadMeshAsset, parseMeshManifest } from '../../src/flow/mesh/loader';
import { solverMeshFromFile } from '../../src/flow/reference/solverMesh';
import { ENGINE_DEFINITION } from '../../src/engine/definition';
import { create, globals } from 'webgpu';
import { compareSides, pairedAb, perfState, profileIteration, type FlowLike } from './solverPerf';
import { dispatchBytes } from './bytes';

Object.assign(globalThis, globals);

const out = (line: string): void => {
  process.stdout.write(`${line}\n`);
};
const args = process.argv.slice(2);
const arg = (name: string, fallback: string): string => {
  const i = args.indexOf(name);
  return i >= 0 ? (args[i + 1] ?? fallback) : fallback;
};
const mode = args[0] ?? 'profile';

/** src/ of a ref, exported once under test-results/perf-ab/<sha7>, or this checkout. */
function sourceRoot(ref: string): string {
  if (ref === 'WORKTREE') return resolve('.');
  const sha = execFileSync('git', ['rev-parse', '--short=7', ref], { encoding: 'utf8' }).trim();
  const dir = resolve('test-results', 'perf-ab', sha);
  if (!existsSync(join(dir, 'src'))) {
    mkdirSync(dir, { recursive: true });
    execFileSync('git', ['archive', '-o', join(dir, 'src.tar'), sha, 'src']);
    // relative to cwd: GNU tar reads "C:..." as a remote host
    execFileSync('tar', ['-xf', 'src.tar'], { cwd: dir });
  }
  return dir;
}

const gpu = create(['disable-dawn-features=timestamp_quantization']);
const log = new GpuErrorLog();
const sim = await requestSimDevice(gpu, {
  powerPreference: 'high-performance',
  optionalFeatures: ['timestamp-query'],
  maxLimits: [
    'maxStorageBuffersPerShaderStage',
    'maxComputeWorkgroupStorageSize',
    'maxStorageBufferBindingSize',
    'maxBufferSize',
  ],
  onError: log.sink,
});
if (!sim.hasTimestamps) throw new Error('no timestamp-query on this adapter');
const manifest = parseMeshManifest(JSON.parse(readFileSync('public/mesh/manifest.json', 'utf8')));
const entry = manifest.specs['130k'];
if (entry === undefined) throw new Error('no 130k mesh');
const { asset, file } = await loadMeshAsset(readFileSync(`public/mesh/${entry.file}`), entry);
const mesh = solverMeshFromFile(file);

/** A side REF[@TXxTY]: the ref's GpuFlowSolver at that tile (default: the ref's default tile). */
async function flowFrom(side: string): Promise<FlowLike> {
  const [ref = 'WORKTREE', tileSpec] = side.split('@');
  const url = pathToFileURL(
    join(sourceRoot(ref), 'src', 'flow', 'gpu', 'device', 'flowSolver.ts'),
  ).href;
  const mod = (await import(url)) as {
    GpuFlowSolver: new (o: object) => FlowLike & { init(p: unknown): Promise<void> };
  };
  const [x, y] = (tileSpec ?? '').split('x').map(Number);
  const f = new mod.GpuFlowSolver(tileSpec === undefined ? {} : { tile: { x, y } });
  await f.init({ device: sim.device, mesh: asset, definition: ENGINE_DEFINITION });
  return f;
}

try {
  if (mode === 'profile') {
    const flow = await flowFrom(arg('--ref', 'WORKTREE'));
    const kernel = flow.kernel;
    if (kernel === null) throw new Error('no kernel');
    const U = perfState(mesh, kernel.ref);
    const reps = Number(arg('--reps', '40'));
    const p = await profileIteration(sim.device, kernel, U, reps);
    const bytes = dispatchBytes(mesh, kernel.layout);
    out(JSON.stringify({ backend: 'dawn', reps, ...p, bytes }, null, 2));
    flow.dispose();
  } else if (mode === 'ab') {
    const refs = arg('--refs', 'c661d5c,WORKTREE').split(',');
    if (refs.length < 2) throw new Error('--refs takes two or more sides: a,b[,c...]');
    const sides = [];
    for (const ref of refs) sides.push({ label: ref, flow: await flowFrom(ref) });
    const k0 = sides[0]?.flow.kernel;
    if (k0 === null || k0 === undefined) throw new Error('no kernel');
    const U = perfState(mesh, k0.ref);
    const reps = Number(arg('--reps', '12'));
    const r = await pairedAb(sim.device, sides, U, {
      reps,
      iterations: 60,
      frames: 20,
      perFrame: 2,
      warmup: 10,
    });
    const [a, ...rest] = sides;
    if (a === undefined) throw new Error('no sides');
    const bitwise: Record<string, Record<string, number>> = {};
    for (const b of rest) {
      bitwise[`${a.label} vs ${b.label}`] = await compareSides(
        sim.device,
        a.flow,
        b.flow,
        U,
        25,
        2,
      );
    }
    out(
      JSON.stringify(
        {
          backend: 'dawn',
          reps,
          results: r.map((x) => ({
            label: x.label,
            msPerIteration: +x.msPerIteration.toFixed(4),
            msPerFrame2: +x.msPerFrame.toFixed(4),
            msPerResampleFrame: +x.msPerResampleFrame.toFixed(4),
            it: x.samples.it.map((v) => +v.toFixed(4)),
          })),
          bitwise,
        },
        null,
        2,
      ),
    );
    for (const s of sides) s.flow.dispose();
  } else {
    throw new Error(`unknown mode ${mode}`);
  }
  if (log.reports.length > 0) throw new Error(`GPU errors: ${JSON.stringify(log.reports)}`);
} finally {
  sim.destroy();
}
