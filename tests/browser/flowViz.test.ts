// Flow visuals in the engine view (w2/flowviz): every flow mode renders with zero WebGPU
// errors, the cut plane paints the (MOCK) field on the cutaway faces, and each mode's frame is
// saved to docs/look-dev/flow/ (960 x 540, indicative look-dev evidence, not a timing run).
import { commands } from 'vitest/browser';
import { afterAll, describe, expect, it } from 'vitest';
import { ISA_SLS } from '../../src/contracts/ambient';
import { ENGINE_DEFINITION } from '../../src/engine/definition';
import { FLOW_VIZ_MODE_IDS, type FlowVizModeId } from '../../src/flow/viz/modes';
import { mockSteadyState } from '../../src/mocks/mockCycle';
import { createMockFlowField } from '../../src/mocks/mockFlowField';
import { createEngineView, type EngineView } from '../../src/render/engineView';

const W = 960;
const H = 540;

function canvas(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  c.style.width = `${W}px`;
  c.style.height = `${H}px`;
  document.body.appendChild(c);
  return c;
}

/** Mean chroma (max - min channel) of the frame, 0..1: the colour maps add it, the engine has little. */
function grab(view: EngineView, c: HTMLCanvasElement): { chroma: number; png: string } {
  view.frame(1 / 60);
  const copy = document.createElement('canvas');
  copy.width = W;
  copy.height = H;
  const ctx = copy.getContext('2d');
  if (ctx === null) throw new Error('no 2d context');
  ctx.drawImage(c, 0, 0);
  const px = ctx.getImageData(0, 0, W, H).data;
  let s = 0;
  for (let i = 0; i < px.length; i += 4) {
    const r = px[i] ?? 0;
    const g = px[i + 1] ?? 0;
    const b = px[i + 2] ?? 0;
    s += (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
  }
  const png = copy.toDataURL('image/png').replace(/^data:image\/png;base64,/, '');
  return { chroma: s / (px.length / 4), png };
}

describe('flow visuals (MOCK field)', () => {
  let view: EngineView | null = null;
  afterAll(async () => {
    await view?.dispose();
  });

  it('renders every flow mode with zero WebGPU errors; the cut plane adds the field colours', async () => {
    const c = canvas();
    view = await createEngineView({
      gpu: navigator.gpu,
      canvas: c,
      definition: ENGINE_DEFINITION,
      width: W,
      height: H,
      dpr: 1,
    });
    const v = view;
    v.setPreset('cutaway');
    v.setThrottle(1, true);
    v.setFlowField(
      createMockFlowField(ENGINE_DEFINITION, mockSteadyState(ENGINE_DEFINITION, 1), ISA_SLS),
    );
    const settle = () => {
      for (let k = 0; k < 100; k++) v.frame(1 / 60);
    };
    settle();
    const base = grab(v, c).chroma;
    const got: Partial<Record<FlowVizModeId, number>> = {};
    for (const id of FLOW_VIZ_MODE_IDS) {
      v.setFlowMode(id);
      settle();
      const g = grab(v, c);
      got[id] = g.chroma;
      await commands.writeFile(`docs/look-dev/flow/${id}.png`, g.png, 'base64');
    }
    await v.device.device.queue.onSubmittedWorkDone();
    expect(v.stats().errors).toEqual([]);
    // the Data mode's cut plane (viridis Mach) colours a large part of the frame
    expect((got.data ?? 0) - base).toBeGreaterThan(0.02);
    expect((got.cutaway ?? 0) - base).toBeGreaterThan(0.02);
  });
});
