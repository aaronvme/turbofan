// The GPU flow solver's indicative profile in the installed Chrome (D3D12, Arc 140T), D4-54: the
// same measurements as tools/perf/dawn.ts (vitest.perf.config.ts says how to run it). Timestamps
// are exact under --enable-unsafe-webgpu (GPU_FACTS M12). Not a D0-1 timing.
import { expect, it } from 'vitest';
import { commands } from 'vitest/browser';
import { GpuErrorLog, requestSimDevice } from '../../src/gpu/device';
import { loadMeshAsset, parseMeshManifest } from '../../src/flow/mesh/loader';
import { solverMeshFromFile } from '../../src/flow/reference/solverMesh';
import { ENGINE_DEFINITION } from '../../src/engine/definition';
import { GpuFlowSolver } from '../../src/flow/gpu/device/flowSolver';
import { compareSides, pairedAb, perfState, profileIteration, type FlowLike } from './solverPerf';
import { dispatchBytes } from './bytes';

declare const __PERF_MODE__: string;
declare const __PERF_REFS__: { ref: string; path: string }[];
declare const __PERF_REPS__: number;

it(`solver perf (${__PERF_MODE__})`, async ({ annotate }) => {
  const log = new GpuErrorLog();
  const sim = await requestSimDevice(navigator.gpu, {
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
  expect(sim.hasTimestamps).toBe(true);
  const manifest = parseMeshManifest(await (await fetch('/mesh/manifest.json')).json());
  const entry = manifest.specs['130k'];
  if (entry === undefined) throw new Error('no 130k mesh');
  const bytes = await (await fetch(`/mesh/${entry.file}`)).arrayBuffer();
  const { asset, file } = await loadMeshAsset(bytes, entry);
  const mesh = solverMeshFromFile(file);
  const flowFrom = async (path: string): Promise<FlowLike> => {
    let Ctor: new () => FlowLike & { init(p: unknown): Promise<void> } = GpuFlowSolver;
    if (path !== '') {
      const mod = (await import(
        /* @vite-ignore */ `${path}/src/flow/gpu/device/flowSolver.ts`
      )) as {
        GpuFlowSolver: typeof Ctor;
      };
      Ctor = mod.GpuFlowSolver;
    }
    const f = new Ctor();
    await f.init({ device: sim.device, mesh: asset, definition: ENGINE_DEFINITION });
    return f;
  };
  let result: unknown;
  try {
    if (__PERF_MODE__ === 'profile') {
      const flow = await flowFrom(__PERF_REFS__.at(-1)?.path ?? '');
      const kernel = flow.kernel;
      if (kernel === null) throw new Error('no kernel');
      const p = await profileIteration(
        sim.device,
        kernel,
        perfState(mesh, kernel.ref),
        3 * __PERF_REPS__,
      );
      result = { backend: 'chrome', ...p, bytes: dispatchBytes(mesh, kernel.layout) };
      flow.dispose();
    } else {
      const sides = [];
      for (const r of __PERF_REFS__) sides.push({ label: r.ref, flow: await flowFrom(r.path) });
      const [a, b] = sides;
      const k0 = a?.flow.kernel;
      if (a === undefined || b === undefined || k0 === null || k0 === undefined) {
        throw new Error('two sides');
      }
      const U = perfState(mesh, k0.ref);
      const r = await pairedAb(sim.device, sides, U, {
        reps: __PERF_REPS__,
        iterations: 30,
        frames: 20,
        perFrame: 2,
        warmup: 10,
      });
      result = {
        backend: 'chrome',
        results: r.map((x) => ({
          label: x.label,
          msPerIteration: +x.msPerIteration.toFixed(4),
          msPerFrame2: +x.msPerFrame.toFixed(4),
          msPerResampleFrame: +x.msPerResampleFrame.toFixed(4),
          it: x.samples.it.map((v) => +v.toFixed(4)),
        })),
        bitwise: await compareSides(sim.device, a.flow, b.flow, U, 25, 2),
      };
      for (const s of sides) s.flow.dispose();
    }
  } finally {
    sim.destroy();
  }
  const text = JSON.stringify(result, null, 2);
  // the page cannot print to the runner's terminal on a pass: the result goes to a file
  await commands.writeFile(`test-results/perf-logs/chrome-${__PERF_MODE__}.json`, text);
  await annotate(`[perf] ${text}`);
  expect(log.reports).toEqual([]);
});
