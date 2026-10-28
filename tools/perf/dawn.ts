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
// --ballast N: N MB of other GPU buffers allocated (and written once) before the solvers, as the
// app's three.js scene does: the solvers' memory then behaves as it does inside the app (handoff)
const ballast: GPUBuffer[] = [];
const addBallast = (mbTotal: number) => {
  for (let mb = 0; mb < mbTotal; mb += 64) {
    const b = sim.device.createBuffer({
      size: 64 * 2 ** 20,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    sim.device.queue.writeBuffer(b, 0, new Uint8Array(64 * 2 ** 20));
    ballast.push(b);
  }
};
addBallast(Number(arg('--ballast', '0')));
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
  const f = new mod.GpuFlowSolver({
    ...(tileSpec === undefined ? {} : { tile: { x, y } }),
    // --plain: the unpreconditioned tracking scheme (the default is the engine's preconditioning)
    ...(args.includes('--plain') ? { lowMachPreconditioning: null } : {}),
  });
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
    // --ballast-after N: the same after the solvers exist (as a scene created after the solver)
    addBallast(Number(arg('--ballast-after', '0')));
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
  } else if (mode === 'soak') {
    // how long a state stays finite: --iterations N --every K (the bench re-sets its state well before)
    const flow = await flowFrom(arg('--ref', 'WORKTREE'));
    const kernel = flow.kernel;
    if (kernel === null) throw new Error('no kernel');
    // --amp jet,dT,swirl,z,dp,v (default: PERF_AMPLITUDES); --plain: the unpreconditioned scheme
    const [jet = 60, dT = 300, swirl = 20, z = 0.025, dp = 0.02, v = 8] = arg(
      '--amp',
      '60,300,20,0.025,0.02,8',
    )
      .split(',')
      .map(Number);
    kernel.setConserved(perfState(mesh, kernel.ref, { jet, dT, swirl, z, dp, v }));
    const total = Number(arg('--iterations', '16000'));
    const every = Number(arg('--every', '1000'));
    for (let done = 0; done < total; done += every) {
      for (let k = 0; k < Math.ceil(every / 50); k++) {
        const enc = sim.device.createCommandEncoder();
        const pass = enc.beginComputePass();
        kernel.encodeIterations(pass, Math.min(50, every));
        pass.end();
        sim.device.queue.submit([enc.finish()]);
      }
      await sim.device.queue.onSubmittedWorkDone();
      const st = await kernel.readState();
      let finite = true;
      let maxRho = 0;
      let bad = 0;
      let first = -1;
      for (let c = 0; c < kernel.layout.nCells; c++) {
        const v = st[8 * c] ?? NaN;
        if (!Number.isFinite(v)) {
          finite = false;
          bad++;
          if (first < 0) first = c;
        }
        maxRho = Math.max(maxRho, Math.abs(v));
      }
      const where =
        first < 0
          ? ''
          : `; ${bad} cells, the first ${first} at x ${(mesh.cellX[first] ?? NaN).toFixed(3)} r ${(mesh.cellR[first] ?? NaN).toFixed(3)} (block ${mesh.blocks.findIndex((b) => first >= b.cellOffset && first < b.cellOffset + b.ni * b.nj)})`;
      out(
        `${done + every} iterations: finite ${finite}, max |rho'| ${maxRho.toExponential(3)}${where}`,
      );
    }
    flow.dispose();
  } else {
    throw new Error(`unknown mode ${mode}`);
  }
  if (log.reports.length > 0) throw new Error(`GPU errors: ${JSON.stringify(log.reports)}`);
} finally {
  sim.destroy();
}
