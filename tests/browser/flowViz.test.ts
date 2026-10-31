// Flow visuals in the engine view (w2/flowviz), in the installed Chrome:
// - every flow mode renders with zero WebGPU errors on the MOCK field, and each mode's frame is
//   saved (960 x 540, indicative look-dev evidence, not a timing run);
// - D4-76: the Data mode's cut-plane pixels are the colour map's own colours (composited after
//   the tone map, so the legend matches them);
// - W2V-I2: the live GpuFlowSolver's resample textures drive the same visuals on the view's
//   device: a known solver state (uniform 100 m/s) paints the plane its LUT colour, which a zero
//   or a misbound texture would not; the provenance says "solver, uncoupled" (D4-82);
// - W2V-I3: the schlieren and haze targets equal their TS model (schlieren.ts on the gradient
//   kernel's mirror) ray for ray;
// - W2V-I7 (D4-86): at ground idle the Data plane leaves the ambient air undrawn, on the MOCK and
//   the uncoupled solver, and keeps the take-off flow beyond its floor;
// - W2V-I5: the overlay is drawn unjittered, so a still frame repeats exactly (TRAA's jitter,
//   the negative control, makes it crawl);
// - [timing] the flow visuals at the default preset, 1080p, back to back (D4-42 style, but
//   indicative: not D0-1's protocol, and other processes share the GPU). D4-96 item 4: recorded
//   on every run; D4-2's 2 ms bar fails the suite only with VITE_UI_QUIET=1 (src/flow/viz/
//   timingRow.ts); the measure of record is the official P4 / P4flow capture.
// W2V-N8: the frames and timing.json go to reports/flow/ (ignored); VITE_FLOW_LOOKDEV=1 writes
// them to docs/look-dev/flow/ instead (a deliberate look-dev re-shoot).
import { commands } from 'vitest/browser';
import { afterAll, describe, expect, it } from 'vitest';
import { Vector3, Vector4, type PerspectiveCamera } from 'three/webgpu';
import { ISA_SLS } from '../../src/contracts/ambient';
import { FIELD_EXTENTS } from '../../src/contracts/flow';
import { ENGINE_DEFINITION } from '../../src/engine/definition';
import { GpuFlowSolver } from '../../src/flow/gpu/device/flowSolver';
import { loadMeshAsset, parseMeshManifest } from '../../src/flow/mesh/loader';
import { bakeLut, lightnessL } from '../../src/flow/viz/colormaps';
import { airGammaR, FIELD_QUANTITIES } from '../../src/flow/viz/fields';
import { gladstoneDaleK } from '../../src/flow/viz/optics';
import { densityGradientRaster, sampleGradientRaster } from '../../src/flow/viz/particleKernel';
import {
  hazeShiftPx,
  marchOffset,
  rayDeflection,
  type DensityGradient,
} from '../../src/flow/viz/schlieren';
import {
  FLOW_VISUALS_BUDGET_MS,
  FLOW_VIZ_MODE_IDS,
  FLOW_VIZ_MODES,
  type FlowVizModeId,
} from '../../src/flow/viz/modes';
import { flowTimingProblems, quietRun } from '../../src/flow/viz/timingRow';
import { FLOW_SOLVER_LIMITS } from '../../src/gpu/device';
import { mockSteadyState } from '../../src/mocks/mockCycle';
import { createMockFlowField } from '../../src/mocks/mockFlowField';
import { createEngineView, type EngineView } from '../../src/render/engineView';
import type { LookPresetId } from '../../src/render/presets';

const W = 960;
const H = 540;
const ENV = (import.meta as { env?: Record<string, string | undefined> }).env;
const OUT = ENV?.VITE_FLOW_LOOKDEV === '1' ? 'docs/look-dev/flow' : 'reports/flow';
/** D4-96 item 4: the timing row's bar gates only a quiet run (app-ui's W2A-N16 flag). */
const QUIET = quietRun(ENV);

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
  const { asset } = await loadMeshAsset(bytes, entry);
  const solver = new GpuFlowSolver();
  await solver.init({ device: view.device.device, mesh: asset, definition: ENGINE_DEFINITION });
  if (solver.kernel === null) throw new Error('no kernel');
  return solver;
}

/** The LUT colour (bytes) the plane's linear sampler gives a quantity's value. */
function lutColour(lut: Uint8Array, t: number): [number, number, number] {
  const f = Math.min(1, Math.max(0, t)) * 255;
  const i = Math.floor(f);
  const j = Math.min(255, i + 1);
  const w = f - i;
  return [0, 1, 2].map((c) => (1 - w) * (lut[4 * i + c] ?? 0) + w * (lut[4 * j + c] ?? 0)) as [
    number,
    number,
    number,
  ];
}

/** The world ray of a target pixel's centre, as flowViz.ts viewRay builds it (unjittered). */
function pixelRay(cam: PerspectiveCamera, i: number, j: number, w: number, h: number) {
  const ndc = new Vector3(((i + 0.5) / w) * 2 - 1, 1 - ((j + 0.5) / h) * 2, 0.5);
  const hv = new Vector4(ndc.x, ndc.y, ndc.z, 1).applyMatrix4(cam.projectionMatrixInverse);
  const dirV = new Vector3(hv.x / hv.w, hv.y / hv.w, hv.z / hv.w).normalize();
  const dir = dirV.clone().transformDirection(cam.matrixWorld);
  const camUp = new Vector3(0, 1, 0).transformDirection(cam.matrixWorld);
  const right = new Vector3().crossVectors(dir, camUp).normalize();
  const up = new Vector3().crossVectors(right, dir);
  const t = (v: Vector3) => [v.x, v.y, v.z] as const;
  return { origin: t(cam.position), dir: t(dir), right: t(right), up: t(up) };
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
      await commands.writeFile(`${OUT}/${id}.png`, g.png, 'base64');
      expect(v.stats().flow.mode).toBe(id);
      expect(v.stats().flow.source).toBe('mock');
      expect(v.stats().flow.coupling).toBe('mock');
      // D4-83: Realistic draws no tracers unless asked; the cut modes do
      expect(v.stats().flow.tracers).toBe(id === 'cutaway' || id === 'data');
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
    if (base === undefined) throw new Error('missing frames');
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
    await commands.writeFile(`${OUT}/glow-hotsection.png`, withGlow.png, 'base64');
    let red = 0;
    let lifted = 0;
    for (let i = 0; i < without.length; i += 4) {
      const dr = (withGlow.px[i] ?? 0) - (without[i] ?? 0);
      const db = (withGlow.px[i + 2] ?? 0) - (without[i + 2] ?? 0);
      red += dr;
      if (dr >= 3 && dr > db) lifted++;
    }
    v.setDebugFlags({});

    // the heat haze (Realistic): the background seen through the hot jets shifts by the
    // Gladstone-Dale deflection of the field's density gradient, a pixel or so; side on, against
    // the studio, with the particles off so only the refraction differs
    v.setPreset('side');
    v.setThrottle(1, true);
    v.setFlowMode('realistic');
    const hazeFrame = (off: boolean) => {
      v.setDebugFlags({ noFlowParticles: true, ...(off ? { noHaze: true } : {}) });
      settle(40);
      return pixels(c).px;
    };
    const flat = hazeFrame(true);
    const hazy = hazeFrame(false);
    v.setDebugFlags({});
    let shifted = 0;
    for (let i = 0; i < flat.length; i += 4) {
      const d = Math.max(
        Math.abs((hazy[i] ?? 0) - (flat[i] ?? 0)),
        Math.abs((hazy[i + 1] ?? 0) - (flat[i + 1] ?? 0)),
        Math.abs((hazy[i + 2] ?? 0) - (flat[i + 2] ?? 0)),
      );
      if (d >= 2) shifted++;
    }
    await annotate(
      `[look] heat haze: ${String(shifted)} of ${String(flat.length / 4)} pixels changed by >= 2/255 (side view, take-off MOCK field)`,
    );
    expect(shifted).toBeGreaterThan(0);
    await annotate(
      `[look] D4-76: ${String(onMap)} of ${String(changed)} sampled cut-plane pixels on the viridis LUT within 3/255 (${(onMap / changed).toFixed(3)}); glow: ${String(lifted)} pixels red-lifted by >= 3/255, total red +${String(red)}`,
    );
    expect(red).toBeGreaterThan(0);
    expect(lifted).toBeGreaterThan(50);
  });

  // W2V-I2: chroma > 0 cannot tell the solver's values from a zero field (the started field is
  // near rest, viridis' low end either way). A known solver state, uniform 110 m/s at the
  // reference, must paint the plane that value's LUT colour in Data (Mach 0.323) and Cutaway
  // (110 m/s); a zero velocity texture, the state bound as velocity or a scale error would not
  it('W2V-I2: a known solver state paints the plane its LUT colour on the view device, labelled solver, uncoupled (D4-82)', async ({
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
      preferredLimits: FLOW_SOLVER_LIMITS,
    });
    views.push(v);
    solver = await loadSolver(v);
    const s = solver;
    const kernel = s.kernel;
    if (kernel === null) throw new Error('no kernel');
    // resample only (0 iterations): the textures hold exactly the state set
    const settle = (n: number) => {
      for (let k = 0; k < n; k++) {
        s.step({ gpuTimeBudgetMs: 4, maxIterations: 0 });
        v.frame(1 / 60);
      }
    };
    v.setPreset('cutaway');
    v.setDebugFlags({ noFlowParticles: true });
    v.setFlowSolverField(s.fields());
    v.setMode('cutaway', true);
    settle(60);
    const base = pixels(c).px;
    // 110 m/s: off every contour (50 m/s, Mach 0.1), so no line darkens the plane
    const U = 110;
    const ref = kernel.ref;
    kernel.setUniform({ rho: ref.p / (ref.r * ref.t), u: U, v: 0, w: 0, p: ref.p, z: 0 });
    const notes: string[] = [];
    for (const [mode, value] of [
      ['data', U / Math.sqrt(airGammaR(ref.t) * ref.t)],
      ['cutaway', U],
    ] as const) {
      v.setFlowMode(mode);
      settle(40);
      const g = pixels(c);
      if (mode === 'data') await commands.writeFile(`${OUT}/solver-link.png`, g.png, 'base64');
      const spec = FIELD_QUANTITIES[FLOW_VIZ_MODES[mode].quantity];
      const want = lutColour(bakeLut(spec.colormap), (value - spec.min) / (spec.max - spec.min));
      const zero = lutColour(bakeLut(spec.colormap), (0 - spec.min) / (spec.max - spec.min));
      let changed = 0;
      let onColour = 0;
      let onZero = 0;
      for (let i = 0; i < g.px.length; i += 4 * 5) {
        const d = [g.px[i] ?? 0, g.px[i + 1] ?? 0, g.px[i + 2] ?? 0];
        const b = [base[i] ?? 0, base[i + 1] ?? 0, base[i + 2] ?? 0];
        if (Math.max(...d.map((x, k) => Math.abs(x - (b[k] ?? 0)))) < 12) continue;
        changed++;
        const off = (ref3: readonly number[]) =>
          Math.max(...d.map((x, k) => Math.abs(x - (ref3[k] ?? 0))));
        if (off(want) <= 3) onColour++;
        if (off(zero) <= 3) onZero++;
      }
      notes.push(
        `${mode} (${spec.label} ${value.toFixed(3)}): ${String(onColour)} of ${String(changed)} plane pixels within 3/255 of its LUT colour, ${String(onZero)} of the zero colour`,
      );
      expect(changed).toBeGreaterThan(2000);
      // 8-bit LUT filtering is within 3/255; the rest are the anti-aliased fluid and crop edges
      expect(onColour / changed).toBeGreaterThan(0.8);
      expect(onZero / changed).toBeLessThan(0.05);
    }
    await annotate(`[look] W2V-I2 solver link: ${notes.join('; ')}`);
    await v.device.device.queue.onSubmittedWorkDone();
    expect(v.stats().errors).toEqual([]);
    expect(s.status().status).toBe('running');
    expect(v.stats().flow.source).toBe('solver');
    // D4-82: no blade or combustor forces until W3
    expect(v.stats().flow.coupling).toBe('uncoupled');
    expect(s.fields().coupling).toBe('uncoupled');
  });

  // W2V-I7 (D4-86): at ground idle the Data plane painted the ambient air as viridis' darkest end
  // over most of its area (a heavy purple board). The bar, stated before the fix: at ground idle,
  // on the MOCK and the uncoupled solver's field, at most 10 % of the plane's footprint is drawn
  // (alpha >= 0.5) at or below the lightness of viridis' darkest 5 % (contour lines included).
  // The footprint and the negative control are the same frame with the floor off
  // (`noFlowFloor`, the old look). At take-off the floor must keep the flow: of the pixels the
  // old look drew lighter than viridis at 10 % of the scale (well beyond the floor), at least
  // 98 % are unchanged. The plane alone (everything else hidden, no tracers), read back from the
  // overlay target (premultiplied display-space colour)
  it('W2V-I7: at ground idle the Data plane leaves the ambient air undrawn (MOCK and uncoupled solver); take-off keeps its flow', async ({
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
      preferredLimits: FLOW_SOLVER_LIMITS,
    });
    views.push(v);
    const lut = bakeLut('viridis');
    const lOf = (k: number) =>
      lightnessL(
        [lut[4 * k] ?? 0, lut[4 * k + 1] ?? 0, lut[4 * k + 2] ?? 0].map((b) => b / 255) as [
          number,
          number,
          number,
        ],
      );
    const darkL = lOf(Math.round(0.05 * 255));
    const flowL = lOf(Math.round(0.1 * 255));
    const settle = (n: number, step?: () => void) => {
      for (let k = 0; k < n; k++) {
        step?.();
        v.frame(1 / 60);
      }
    };
    v.setPreset('cutaway');
    v.setMode('cutaway', true);
    v.setFlowMode('data');
    const read = async (floorOff: boolean, step?: () => void) => {
      v.setDebugFlags({
        hide: '.',
        noFlowParticles: true,
        ...(floorOff ? { noFlowFloor: true } : {}),
      });
      settle(30, step);
      return (await v.readFlowTarget('overlay')).rgba;
    };
    const lightness = (o: Float32Array, k: number) => {
      const a = o[k + 3] ?? 0;
      return lightnessL(
        [0, 1, 2].map((ch) => Math.min(1, (o[k + ch] ?? 0) / a)) as [number, number, number],
      );
    };
    const bar = (old: Float32Array, now: Float32Array) => {
      let footprint = 0;
      let darkOld = 0;
      let darkNow = 0;
      for (let k = 0; k < old.length; k += 4) {
        if ((old[k + 3] ?? 0) < 0.5) continue;
        footprint++;
        if (lightness(old, k) <= darkL) darkOld++;
        if ((now[k + 3] ?? 0) >= 0.5 && lightness(now, k) <= darkL) darkNow++;
      }
      return { footprint, before: darkOld / footprint, after: darkNow / footprint };
    };
    // the look, as the viewer sees it (tracers on), before (the old look) and after; first,
    // since a mesh hidden by `hide` stays hidden
    for (const [lever, name] of [
      [0, 'idle'],
      [1, 'takeoff'],
    ] as const) {
      v.setThrottle(lever, true);
      v.setFlowField(
        createMockFlowField(ENGINE_DEFINITION, mockSteadyState(ENGINE_DEFINITION, lever), ISA_SLS),
      );
      for (const [off, when] of [
        [true, 'before'],
        [false, 'after'],
      ] as const) {
        v.setDebugFlags(off ? { noFlowFloor: true } : {});
        settle(150);
        await commands.writeFile(`${OUT}/data-${name}-${when}.png`, pixels(c).png, 'base64');
      }
    }
    v.setDebugFlags({});
    const notes: string[] = [];
    // the MOCK at ground idle (lever 0)
    v.setThrottle(0, true);
    v.setFlowField(
      createMockFlowField(ENGINE_DEFINITION, mockSteadyState(ENGINE_DEFINITION, 0), ISA_SLS),
    );
    const mock = bar(await read(true), await read(false));
    notes.push(
      `MOCK idle: ${(100 * mock.before).toFixed(1)} % of ${String(mock.footprint)} px dark before, ${(100 * mock.after).toFixed(1)} % after`,
    );
    // the uncoupled solver at ground idle: nothing drives it, so its air stays the ambient at rest
    const s = await loadSolver(v);
    try {
      const step = () => s.step({ gpuTimeBudgetMs: 4, maxIterations: 4 });
      v.setFlowSolverField(s.fields());
      const sol = bar(await read(true, step), await read(false, step));
      notes.push(
        `solver idle: ${(100 * sol.before).toFixed(1)} % of ${String(sol.footprint)} px dark before, ${(100 * sol.after).toFixed(1)} % after`,
      );
      expect(v.stats().flow.coupling).toBe('uncoupled');
      expect(s.status().status).toBe('running');
      // take-off on the MOCK: the flow beyond the floor is untouched
      v.setThrottle(1, true);
      v.setFlowField(
        createMockFlowField(ENGINE_DEFINITION, mockSteadyState(ENGINE_DEFINITION, 1), ISA_SLS),
      );
      const old = await read(true);
      const now = await read(false);
      let flow = 0;
      let kept = 0;
      for (let k = 0; k < old.length; k += 4) {
        if ((old[k + 3] ?? 0) < 0.99 || lightness(old, k) < flowL) continue;
        flow++;
        if (
          [0, 1, 2, 3].every((ch) => Math.abs((now[k + ch] ?? 0) - (old[k + ch] ?? 0)) <= 3 / 255)
        )
          kept++;
      }
      notes.push(
        `take-off: ${String(kept)} of ${String(flow)} flow px unchanged (${((100 * kept) / flow).toFixed(2)} %)`,
      );
      v.setDebugFlags({});
      await annotate(`[look] W2V-I7: ${notes.join('; ')}`);
      await commands.writeFile(`${OUT}/floor.txt`, notes.map((n) => `${n}\n`).join(''));
      expect(mock.footprint).toBeGreaterThan(20_000);
      expect(mock.before).toBeGreaterThan(0.3);
      expect(mock.after).toBeLessThanOrEqual(0.1);
      expect(sol.before).toBeGreaterThan(0.3);
      expect(sol.after).toBeLessThanOrEqual(0.1);
      expect(flow).toBeGreaterThan(5000);
      expect(kept / flow).toBeGreaterThanOrEqual(0.98);
      await v.device.device.queue.onSubmittedWorkDone();
      expect(v.stats().errors).toEqual([]);
    } finally {
      s.dispose();
    }
  });

  // W2V-I3: the TSL march (flowViz.ts) against its TS model (schlieren.ts) on the same rays: the
  // half-resolution targets' pixel rays, the same per-pixel sample offset, the gradient kernel's
  // TS mirror sampled as the linear sampler does. No surfaces (every mesh hidden), so each ray
  // runs through the whole near field. A factor or sign in K, rho_inf, the r scale or the
  // right/up basis is a 100 % error; the tolerance is 1 % of the column's peak (f16 storage of
  // the gradient, 2^-11, and the sampler's 8-bit filter weights, ~0.4 % of a texel step) plus
  // the step count's own quadrature error (the steps against 768) at that pixel
  it('W2V-I3: the schlieren and haze targets equal their TS model ray for ray', async ({
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
    const field = createMockFlowField(
      ENGINE_DEFINITION,
      mockSteadyState(ENGINE_DEFINITION, 1),
      ISA_SLS,
    );
    v.setThrottle(1, true);
    v.setFlowField(field);
    v.setPreset('side');
    v.setDebugFlags({ hide: '.', noFlowParticles: true });
    const e = FIELD_EXTENTS.near;
    const raster = densityGradientRaster(field.near);
    const rhoInf = field.reference.rhoInfKgPerM3;
    const grad: DensityGradient = (x, r) => {
      const g = sampleGradientRaster(raster, e, x, r);
      return { gx: rhoInf * g.gx, gr: rhoInf * g.gr };
    };
    const K = gladstoneDaleK(550);
    const cam = v.camera;
    const fovY = (cam.fov * Math.PI) / 180;

    /** The column through the core jet behind the nozzle, and the march along each of its rays. */
    const check = (
      t: { width: number; height: number; rgba: Float32Array },
      steps: number,
      gpu: (k: number) => readonly [number, number],
      ts: (d: { ex: number; ey: number; centroidM: number }) => readonly [number, number],
    ) => {
      const p = new Vector3(3.0, 0, 0).project(cam);
      const i = Math.floor(((p.x + 1) / 2) * t.width);
      const rows: {
        got: readonly [number, number];
        want: readonly [number, number];
        quad: number[];
      }[] = [];
      for (let j = 0; j < t.height; j++) {
        const ray = {
          ...pixelRay(cam, i, j, t.width, t.height),
          xMin: e.xMin,
          xMax: e.xMax,
          rMax: e.rMax,
        };
        const d = rayDeflection({ ...ray, steps, offset: marchOffset(i + 0.5, j + 0.5) }, grad, K);
        const conv = rayDeflection({ ...ray, steps: 768 }, grad, K);
        const want = ts(d);
        const exact = ts(conv);
        rows.push({
          got: gpu(4 * (j * t.width + i)),
          want,
          quad: [Math.abs(want[0] - exact[0]), Math.abs(want[1] - exact[1])],
        });
      }
      const peak = Math.max(...rows.map((r) => Math.hypot(r.want[0], r.want[1])));
      let bad = 0;
      let worst = 0;
      let strong = 0;
      for (const r of rows) {
        if (Math.hypot(r.want[0], r.want[1]) > 0.1 * peak) strong++;
        for (const k of [0, 1] as const) {
          const err = Math.abs(r.got[k] - r.want[k]);
          const tol = 0.01 * peak + (r.quad[k] ?? 0);
          worst = Math.max(worst, err / peak);
          if (!(err <= tol)) bad++;
        }
      }
      return { column: i, peak, bad, worst, strong, rows: rows.length };
    };

    v.setFlowMode('schlieren');
    for (let k = 0; k < 8; k++) v.frame(1 / 60);
    const sch = await v.readFlowTarget('schlieren');
    // the schlieren target holds eps (up, right), rad
    const s = check(
      sch,
      96,
      (k) => [sch.rgba[k] ?? NaN, sch.rgba[k + 1] ?? NaN],
      (d) => [d.ey, d.ex],
    );

    v.setFlowMode('realistic');
    for (let k = 0; k < 8; k++) v.frame(1 / 60);
    const hz = await v.readFlowTarget('haze');
    // the haze target holds the background's shift in the full frame's uv (y down): the shift
    // in px of the full-resolution image (hazeShiftPx) over its size; no surface, so the
    // background is the march's far distance (1e4 m)
    const hzs = check(
      hz,
      32,
      (k) => [hz.rgba[k] ?? NaN, hz.rgba[k + 1] ?? NaN],
      (d) => [
        hazeShiftPx(d.ex, d.centroidM, 1e4, fovY, H) / W,
        -hazeShiftPx(d.ey, d.centroidM, 1e4, fovY, H) / H,
      ],
    );
    await annotate(
      `[look] W2V-I3: schlieren column ${String(s.column)}: peak ${s.peak.toExponential(3)} rad, worst error ${(100 * s.worst).toFixed(2)} % of it, ${String(s.bad)} of ${String(2 * s.rows)} outside the tolerance, ${String(s.strong)} strong rows; haze column ${String(hzs.column)}: peak ${hzs.peak.toExponential(3)} uv, worst ${(100 * hzs.worst).toFixed(2)} %, ${String(hzs.bad)} outside`,
    );
    for (const r of [s, hzs]) {
      expect(r.strong).toBeGreaterThan(20);
      expect(r.bad).toBeLessThanOrEqual(2);
    }
    // the jet is visible: a deflection well above the knife edge's noise
    expect(s.peak).toBeGreaterThan(1e-4);
    await v.device.device.queue.onSubmittedWorkDone();
    expect(v.stats().errors).toEqual([]);
  });

  // W2V-I5: TRAA does not accumulate the overlay (D4-76), so it must not carry TRAA's jitter: a
  // still frame's overlay repeats exactly. The negative control (the overlay drawn with the
  // jitter, as round 2 did) moves its contours and edges every frame
  it('W2V-I5: the overlay is unjittered: a still frame repeats exactly; with the jitter it crawls', async ({
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
    v.setPreset('cutaway');
    v.setFlowMode('data');
    // the plane alone, and nothing that moves in front of it (the spools turn)
    const flags = { hide: '.', noFlowParticles: true } as const;
    v.setDebugFlags(flags);
    for (let k = 0; k < 90; k++) v.frame(1 / 60);
    const pair = async () => {
      v.frame(1 / 60);
      const a = await v.readFlowTarget('overlay');
      v.frame(1 / 60);
      const b = await v.readFlowTarget('overlay');
      let plane = 0;
      let changed = 0;
      for (let k = 0; k < a.rgba.length; k += 4) {
        if ((a.rgba[k + 3] ?? 0) > 0) plane++;
        for (let ch = 0; ch < 4; ch++)
          if (a.rgba[k + ch] !== b.rgba[k + ch]) {
            changed++;
            break;
          }
      }
      return { plane, changed };
    };
    const still = await pair();
    v.setDebugFlags({ ...flags, jitterFlow: true });
    v.frame(1 / 60);
    const jittered = await pair();
    v.setDebugFlags({});
    await annotate(
      `[look] W2V-I5: overlay ${String(still.plane)} plane pixels; changed between two still frames: unjittered ${String(still.changed)}, with TRAA's jitter ${String(jittered.changed)}`,
    );
    expect(still.plane).toBeGreaterThan(5000);
    expect(still.changed).toBe(0);
    expect(jittered.changed).toBeGreaterThan(200);
    await v.device.device.queue.onSubmittedWorkDone();
    expect(v.stats().errors).toEqual([]);
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
    // D4-83: Realistic draws no tracers by default; with the option on (32768 streaks, the
    // substeps of W2V-I4) the visuals must still fit D4-2's budget
    v.setFlowTracers(true);
    const traced = await sample(true);
    v.setFlowTracers(null);
    await q.onSubmittedWorkDone();
    expect(v.stats().errors).toEqual([]);
    expect(traced.flow.tracers).toBe(true);
    const tracers = {
      flow: traced.flow.visualsMs,
      compute: traced.flow.computeMs,
      overlay: traced.flow.renderMs,
    };
    const med = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? NaN;
    const flowMs = med(pairs.map((p) => p.flow));
    const deltaRender = med(pairs.map((p) => p.on - p.off));
    // D4-96 item 4: recorded on every run (the log line and timing.json); the 2 ms bar fails the
    // suite only in a quiet run (VITE_UI_QUIET=1, app-ui's W2A-N16 flag); a reading that measured
    // nothing fails every run
    const problems = flowTimingProblems({ visualsMs: flowMs, tracersMs: tracers.flow }, QUIET);
    const record = `[timing] flow visuals (realistic, default preset, 1080p, back to back, indicative; ${QUIET ? 'quiet run: gated' : 'not a quiet run: recorded, not gated'} at ${String(FLOW_VISUALS_BUDGET_MS)} ms): ${flowMs.toFixed(3)} ms (render passes ${med(pairs.map((p) => p.overlay)).toFixed(3)}, compute ${med(pairs.map((p) => p.compute ?? NaN)).toFixed(3)}); P4 render total off ${med(pairs.map((p) => p.off)).toFixed(2)} / on ${med(pairs.map((p) => p.on)).toFixed(2)} ms (paired change ${deltaRender.toFixed(3)} ms); with the tracers on ${tracers.flow.toFixed(3)} ms (compute ${(tracers.compute ?? NaN).toFixed(3)}) ${JSON.stringify(pairs)}`;
    console.warn(record);
    await annotate(record);
    await commands.writeFile(
      `${OUT}/timing.json`,
      `${JSON.stringify({ note: 'indicative, back to back, 1080p, threeQuarterFront, realistic flow mode (D4-83: no tracers by default; tracers: the option on); not D0-1. D4-96: gated at the 2 ms bar only in a quiet run (VITE_UI_QUIET=1)', quiet: QUIET, budgetMs: FLOW_VISUALS_BUDGET_MS, flowMs, pairs, tracers, problems }, null, 2)}\n`,
    );
    expect(problems, record).toEqual([]);
  });
});
