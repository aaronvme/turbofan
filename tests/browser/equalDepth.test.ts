// W1V-I3: an EqualDepth hole in the fan must fail a test. The fan's shaded copy passes only
// where its depth equals the pre-pass's (src/render/materials.ts); if another adapter or a
// Dawn update compiled the two vertex stages differently (three emits no @invariant), the
// fan would show pinholes or missing blades in every shot. Here the rotor-alpha coverage at
// shutter 0 drawn through the pre-pass and EqualDepth is compared with the same fan drawn
// with an ordinary depth test: 0 differing pixels. A negative control nudges the pre-pass
// copy by 1e-4 rad (a hole pattern) and must differ, so the comparison can see a hole.
import { afterAll, describe, expect, it } from 'vitest';
import { ENGINE_DEFINITION } from '../../src/engine/definition';
import { createEngineView, type EngineView } from '../../src/render/engineView';
import type { LookPresetId } from '../../src/render/presets';
import { grab, settle } from './lib/frames';

const W = 960;
const H = 540;

const differing = (a: Uint8ClampedArray, b: Uint8ClampedArray): number => {
  let n = 0;
  for (let i = 0; i < a.length; i += 4) if (a[i] !== b[i]) n++;
  return n;
};

describe('W1V-I3: the fan drawn through EqualDepth has no holes', () => {
  let view: EngineView | null = null;
  afterAll(async () => {
    if (view !== null) await view.dispose();
  });

  it('matches an ordinary depth test pixel for pixel, and a nudged pre-pass does not', async () => {
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    document.body.appendChild(c);
    view = await createEngineView({
      gpu: navigator.gpu,
      canvas: c,
      definition: ENGINE_DEFINITION,
      width: W,
      height: H,
      dpr: 1,
      quality: 'high',
      debug: 'rotorAlpha',
    });
    const rows: string[] = [];
    for (const preset of ['fanIdle', 'threeQuarterFront', 'hero'] as LookPresetId[]) {
      view.setPreset(preset);
      view.setShutter(0);
      view.setDebugFlags({});
      await settle(view, 6);
      const equal = grab(view, c);
      view.setDebugFlags({ plainFanDepth: true });
      await settle(view, 6);
      const plain = grab(view, c);
      view.setDebugFlags({ fanDepthNudge: 1e-4 });
      await settle(view, 6);
      const holed = grab(view, c);
      view.setDebugFlags({});
      const fanPx = equal.rgba.filter((v, i) => i % 4 === 0 && v > 0).length;
      const d = differing(equal.rgba, plain.rgba);
      const control = differing(equal.rgba, holed.rgba);
      rows.push(`${preset}: fan ${fanPx} px, EqualDepth vs plain ${d} px, nudged ${control} px`);
      expect(fanPx, rows.join('\n')).toBeGreaterThan(1000);
      expect(d, rows.join('\n')).toBe(0);
      expect(control, rows.join('\n')).toBeGreaterThan(100);
    }
    console.warn(`W1V-I3 EqualDepth\n${rows.join('\n')}`);
    expect(view.stats().errors).toEqual([]);
  });
});
