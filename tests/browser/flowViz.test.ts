// Flow visuals in the engine view (w2/flowviz), in the installed Chrome:
// - every flow mode renders with zero WebGPU errors on the MOCK field, and each mode's frame is
//   saved to docs/look-dev/flow/ (960 x 540, indicative look-dev evidence, not a timing run);
// - D4-76: the Data mode's cut-plane pixels are the colour map's own colours (composited after
//   the tone map, so the legend matches them);
// - the live GpuFlowSolver's resample textures drive the same visuals on the view's device, and
//   the provenance says so;
// - [timing] the flow visuals at the default preset, 1080p, back to back (D4-42 style, but
//   indicative: not D0-1's protocol, and other processes share the GPU).
import { commands } from 'vitest/browser';
import { afterAll, describe, expect, it } from 'vitest';
import { ISA_SLS } from '../../src/contracts/ambient';
import { ENGINE_DEFINITION } from '../../src/engine/definition';
import { GpuFlowSolver } from '../../src/flow/gpu/device/flowSolver';
import { loadMeshAsset, parseMeshManifest } from '../../src/flow/mesh/loader';
import { solverMeshFromFile } from '../../src/flow/reference/solverMesh';
import { bakeLut } from '../../src/flow/viz/colormaps';
import { FIELD_QUANTITIES } from '../../src/flow/viz/fields';
import {
  FLOW_VISUALS_BUDGET_MS,
  FLOW_VIZ_MODE_IDS,
  FLOW_VIZ_MODES,
  type FlowVizModeId,
} from '../../src/flow/viz/modes';
import { FLOW_SOLVER_LIMITS } from '../../src/gpu/device';
import { mockSteadyState } from '../../src/mocks/mockCycle';
import { createMockFlowField } from '../../src/mocks/mockFlowField';
import { createEngineView, type EngineView } from '../../src/render/engineView';
import type { LookPresetId } from '../../src/render/presets';
import { perfState } from '../../tools/perf/solverPerf';

const W = 960;
const H = 540;

function canvas(w = W, h = H): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  c.style.width = `${String(Math.min(w, W))}px`;
  c.style.height = `${String(Math.min(h, H))}px`;
  document.body.appendChild(c);
  return c;
}

function pixels(c: HTMLCanvasElement): { px: Uint8ClampedArray; png: string } {
  const copy = document.createElement('canvas');
  copy.width = c.width;
  copy.height = c.height;
  const ctx = copy.getContext('2d');
  if (ctx === null) throw new Error('no 2d context');
  ctx.drawImage(c, 0, 0);
  const px = ctx.getImageData(0, 0, c.width, c.height).data;
  const png = copy.toDataURL('image/png').replace(/^data:image\/png;base64,/, '');
  return { px, png };
}

const chroma = (px: Uint8ClampedArray): number => {
  let s = 0;
  for (let i = 0; i < px.length; i += 4) {
    const r = px[i] ?? 0;
    const g = px[i + 1] ?? 0;
    const b = px[i + 2] ?? 0;
    s += (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
  }
  return s / (px.length / 4);
};

/** The preset each mode's look-dev frame is taken from (the schlieren reads best side on). */
const SHOT: Record<FlowVizModeId, LookPresetId> = {
  realistic: 'threeQuarterFront',
  cutaway: 'cutaway',
  schlieren: 'side',
  data: 'cutaway',
};

async function loadSolver(view: EngineView): Promise<GpuFlowSolver> {
  const manifest = parseMeshManifest(await (await fetch('/mesh/manifest.json')).json());
  const entry = manifest.specs['130k'];
  if (entry === undefined) throw new Error('no 130k mesh');
  const bytes = await (await fetch(`/mesh/${entry.file}`)).arrayBuffer();
  const { asset, file } = await loadMeshAsset(bytes, entry);
  const solver = new GpuFlowSolver();
  await solver.init({ device: view.device.device, mesh: asset, definition: ENGINE_DEFINITION });
  const kernel = solver.kernel;
  if (kernel === null) throw new Error('no kernel');
  // the solver's timing start state (a jet, swirl, a pressure wave, a hot plume: not an engine
  // solution; the coupling's body forces are W3's), so the live field has structure to show
  kernel.setConserved(perfState(solverMeshFromFile(file), kernel.ref));
  return solver;
}

describe('flow visuals', () => {
  const views: EngineView[] = [];
  let solver: GpuFlowSolver | null = null;
  afterAll(async () => {
    solver?.dispose();
    for (const v of views) await v.dispose();
  });

  it('renders every mode with zero WebGPU errors on the MOCK field; data colours are the LUT colours (D4-76)', async ({
    annotate,
  }) => {
    const c = canvas();
    const v = await createEngineView({
      gpu: navigator.gpu,
      canvas: c,
      definition: ENGINE_DEFINITION,
      width: W,
      height: H,
      dpr: 1,
    });
    views.push(v);
    v.setThrottle(1, true);
    v.setFlowField(
      createMockFlowField(ENGINE_DEFINITION, mockSteadyState(ENGINE_DEFINITION, 1), ISA_SLS),
    );
    const settle = (n = 150) => {
      for (let k = 0; k < n; k++) v.frame(1 / 60);
    };
    const shots: Partial<Record<FlowVizModeId, Uint8ClampedArray>> = {};
    const bases: Partial<Record<LookPresetId, Uint8ClampedArray>> = {};
    for (const id of FLOW_VIZ_MODE_IDS) {
      v.setPreset(SHOT[id]);
      v.setThrottle(1, true);
      if (bases[SHOT[id]] === undefined) {
        v.setFlowMode(null);
        v.setMode(FLOW_VIZ_MODES[id].cutPlane ? 'cutaway' : 'realistic', true);
        settle(60);
        bases[SHOT[id]] = pixels(c).px;
      }
      v.setFlowMode(id);
      settle();
      const g = pixels(c);
      shots[id] = g.px;
      await commands.writeFile(`docs/look-dev/flow/${id}.png`, g.png, 'base64');
      expect(v.stats().flow.mode).toBe(id);
      expect(v.stats().flow.source).toBe('mock');
    }
    await v.device.device.queue.onSubmittedWorkDone();
    expect(v.stats().errors).toEqual([]);
    const base = bases.cutaway;
    // D4-76's colour check on the plane alone (the particles' white cores and dark halos are
    // off the map by design)
    v.setPreset('cutaway');
    v.setThrottle(1, true);
    v.setDebugFlags({ noFlowParticles: true });
    v.setFlowMode('data');
    settle(60);
    const data = pixels(c).px;
    v.setDebugFlags({});
    if (base === undefined || data === undefined) throw new Error('missing frames');
    expect(chroma(data) - chroma(base)).toBeGreaterThan(0.02);
    expect(chroma(shots.cutaway ?? base) - chroma(base)).toBeGreaterThan(0.02);
    // D4-76: of the pixels the cut plane changed, most are a colour of the viridis LUT within
    // 3/255 per channel (the rest: contour lines and the faded edges). Through AgX they were
    // desaturated far off the map (round 1: none within 3/255)
    const lut = bakeLut(FIELD_QUANTITIES[FLOW_VIZ_MODES.data.quantity].colormap);
    let changed = 0;
    let onMap = 0;
    for (let i = 0; i < data.length; i += 4 * 7) {
      const d = [data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0];
      const b = [base[i] ?? 0, base[i + 1] ?? 0, base[i + 2] ?? 0];
      if (Math.max(...d.map((x, k) => Math.abs(x - (b[k] ?? 0)))) < 12) continue;
      changed++;
      let best = 255;
      for (let k = 0; k < 256; k++) {
        const e = Math.max(
          Math.abs((d[0] ?? 0) - (lut[4 * k] ?? 0)),
          Math.abs((d[1] ?? 0) - (lut[4 * k + 1] ?? 0)),
          Math.abs((d[2] ?? 0) - (lut[4 * k + 2] ?? 0)),
        );
        if (e < best) best = e;
      }
      if (best <= 3) onMap++;
    }
    expect(changed).toBeGreaterThan(2000);
    expect(onMap / changed).toBeGreaterThan(0.5);

    // the hot parts' blackbody glow (src/flow/viz/glow.ts) at take-off: an A/B of the hot
    // section with and without the emission. It is physically dim (the HPT's coated vanes at
    // ~1150 K are a few % of a lit white wall), so it shows only as a red lift, and only there
    v.setFlowMode(null);
    v.setPreset('hotSection');
    v.setThrottle(1, true);
    v.setMode('cutaway', true);
    const glowFrame = (off: boolean) => {
      v.setDebugFlags(off ? { noGlow: true } : {});
      settle(60);
      return pixels(c);
    };
    const without = glowFrame(true).px;
    const withGlow = glowFrame(false);
    await commands.writeFile('docs/look-dev/flow/glow-hotsection.png', withGlow.png, 'base64');
    let red = 0;
    let lifted = 0;
    for (let i = 0; i < without.length; i += 4) {
      const dr = (withGlow.px[i] ?? 0) - (without[i] ?? 0);
      const db = (withGlow.px[i + 2] ?? 0) - (without[i + 2] ?? 0);
      red += dr;
      if (dr >= 3 && dr > db) lifted++;
    }
    v.setDebugFlags({});
    await annotate(
      `[look] D4-76: ${String(onMap)} of ${String(changed)} sampled cut-plane pixels on the viridis LUT within 3/255 (${(onMap / changed).toFixed(3)}); glow: ${String(lifted)} pixels red-lifted by >= 3/255, total red +${String(red)}`,
    );
    expect(red).toBeGreaterThan(0);
    expect(lifted).toBeGreaterThan(50);
  });

  it('draws the live GpuFlowSolver textures on the view device, labelled as the solver', async () => {
    const c = canvas();
    const v = await createEngineView({
      gpu: navigator.gpu,
      canvas: c,
      definition: ENGINE_DEFINITION,
      width: W,
      height: H,
      dpr: 1,
      preferredLimits: FLOW_SOLVER_LIMITS,
    });
    views.push(v);
    solver = await loadSolver(v);
    const s = solver;
    v.setFlowSolverField(s.fields());
    v.setPreset('cutaway');
    v.setFlowMode('data');
    for (let k = 0; k < 120; k++) {
      s.step({ gpuTimeBudgetMs: 4, maxIterations: 4 });
      v.frame(1 / 60);
    }
    const g = pixels(c);
    await commands.writeFile('docs/look-dev/flow/solver-data.png', g.png, 'base64');
    v.setFlowMode('cutaway');
    for (let k = 0; k < 90; k++) {
      s.step({ gpuTimeBudgetMs: 4, maxIterations: 4 });
      v.frame(1 / 60);
    }
    await commands.writeFile('docs/look-dev/flow/solver-cutaway.png', pixels(c).png, 'base64');
    await v.device.device.queue.onSubmittedWorkDone();
    expect(v.stats().errors).toEqual([]);
    expect(s.status().status).toBe('running');
    expect(v.stats().flow.source).toBe('solver');
    expect(s.fields().source).toBe('solver');
    // the solver's field paints the plane: the frame carries the map's colour
    expect(chroma(g.px)).toBeGreaterThan(0.05);
  });

  it('[timing] the default preset at 1080p, back to back: flow visuals within D4-2 (indicative)', async ({
    annotate,
  }) => {
    const c = canvas(1920, 1080);
    const v = await createEngineView({
      gpu: navigator.gpu,
      canvas: c,
      definition: ENGINE_DEFINITION,
      width: 1920,
      height: 1080,
      dpr: 1,
    });
    views.push(v);
    if (!v.stats().timestamps) return;
    v.setFlowField(
      createMockFlowField(ENGINE_DEFINITION, mockSteadyState(ENGINE_DEFINITION, 1), ISA_SLS),
    );
    const q = v.device.device.queue;
    // back to back: two frames in flight, the next submitted as soon as the GPU takes one
    const run = async (frames: number) => {
      const inFlight: Promise<undefined>[] = [];
      for (let k = 0; k < frames; k++) {
        v.frame(1 / 60);
        inFlight.push(q.onSubmittedWorkDone());
        if (inFlight.length > 2) await inFlight.shift();
      }
      await q.onSubmittedWorkDone();
    };
    const sample = async (flowOn: boolean) => {
      v.setFlowMode(flowOn ? 'realistic' : null);
      await run(240);
      const st = v.stats();
      return { render: st.timings.gpuTotal, flow: st.flow };
    };
    v.setPreset('threeQuarterFront');
    await run(120);
    // paired A/B, alternating (off, on) x 3
    const pairs: {
      off: number;
      on: number;
      flow: number;
      compute: number | null;
      overlay: number;
    }[] = [];
    for (let rep = 0; rep < 3; rep++) {
      const off = await sample(false);
      const on = await sample(true);
      pairs.push({
        off: off.render,
        on: on.render,
        flow: on.flow.visualsMs,
        compute: on.flow.computeMs,
        overlay: on.flow.renderMs,
      });
    }
    await q.onSubmittedWorkDone();
    expect(v.stats().errors).toEqual([]);
    const med = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? NaN;
    const flowMs = med(pairs.map((p) => p.flow));
    const deltaRender = med(pairs.map((p) => p.on - p.off));
    await annotate(
      `[timing] flow visuals (realistic, default preset, 1080p, back to back, indicative): ${flowMs.toFixed(3)} ms (render passes ${med(pairs.map((p) => p.overlay)).toFixed(3)}, compute ${med(pairs.map((p) => p.compute ?? NaN)).toFixed(3)}); P4 render total off ${med(pairs.map((p) => p.off)).toFixed(2)} / on ${med(pairs.map((p) => p.on)).toFixed(2)} ms (paired change ${deltaRender.toFixed(3)} ms) ${JSON.stringify(pairs)}`,
    );
    await commands.writeFile(
      'docs/look-dev/flow/timing.json',
      `${JSON.stringify({ note: 'indicative, back to back, 1080p, threeQuarterFront, realistic flow mode; not D0-1', pairs }, null, 2)}\n`,
    );
    expect(flowMs).toBeLessThanOrEqual(FLOW_VISUALS_BUDGET_MS);
  });
});
