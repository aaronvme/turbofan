// W1L-I1 (critic pass 4): the closed-engine culling (src/geometry/visibility.ts) must not
// change the picture. For every closed preset plus two orbit poses a user can reach (straight
// into the intake, and up the core nozzle from behind), the frame with culling on is compared
// with the frame with culling off, at quality `high` (what ships). Adapted from the critic's
// probe docs/reviews/probes/w1l-culling.browser.probe.ts.txt.
//
// Noise tolerance (stated): a pixel "differs" when its displayed luminance changes by more
// than 0.04; a tile differs when more than 25 % of its 16 x 16 pixels do. The noise floor is
// the same view rendered twice with culling on (TRAA jitter, the stochastic fan samples). The
// culling on/off comparison must show NO differing tile beyond the floor's count, and no more
// differing pixels than twice the floor plus 0.1 % of the frame. A culled row that shows
// makes a cluster of 24-48 differing tiles (the probe, at 09c6a11).

import { afterAll, describe, expect, it } from 'vitest';
import { ENGINE_DEFINITION } from '../../src/engine/definition';
import { createEngineView, type EngineView } from '../../src/render/engineView';
import type { LookPresetId } from '../../src/render/presets';
import { diff, grab, settle } from './lib/frames';

const W = 960;
const H = 540;
const THRESHOLD = 0.04;

type Pose = {
  preset: LookPresetId;
  camera?: [number, number, number];
  target?: [number, number, number];
};
const POSES: Record<string, Pose> = {
  threeQuarterFront: { preset: 'threeQuarterFront' },
  side: { preset: 'side' },
  hero: { preset: 'hero' },
  fanIdle: { preset: 'fanIdle' },
  fanTakeoff: { preset: 'fanTakeoff' },
  // a user orbit: straight down the axis into the intake (the booster through the fan)
  axialFront: { preset: 'fanIdle', camera: [-3.2, 0.06, 0.12], target: [0.6, 0, 0] },
  // a user orbit: up the core nozzle from behind (the LPT stages, and past them)
  rearNozzle: { preset: 'side', camera: [5.4, 0.3, 0.45], target: [2.3, 0, 0] },
};

describe('W1L-I1: closed-engine culling changes nothing visible', () => {
  let view: EngineView | null = null;
  afterAll(async () => {
    if (view !== null) await view.dispose();
  });

  it('culling on vs off is within the on/on noise floor in every closed view', async () => {
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
    });
    const rows: string[] = [];
    const failures: string[] = [];
    for (const [name, pose] of Object.entries(POSES)) {
      view.setDebugFlags({});
      view.setPreset(pose.preset);
      if (pose.camera && pose.target) view.setCameraPose(pose.camera, pose.target);
      await settle(view, 40);
      const a1 = grab(view, c);
      await settle(view, 12);
      const a2 = grab(view, c);
      view.setDebugFlags({ noCull: true });
      await settle(view, 40);
      const b = grab(view, c);
      view.setDebugFlags({});
      const floor = diff(a1, a2, THRESHOLD);
      const cull = diff(a2, b, THRESHOLD);
      rows.push(
        `${name}: floor ${(100 * floor.changed).toFixed(3)} % px, ${floor.tilesOver25} tiles | on/off ${(100 * cull.changed).toFixed(3)} % px, ${cull.tilesOver25} tiles, worst tile ${(100 * cull.worstTile).toFixed(1)} %`,
      );
      if (cull.tilesOver25 > floor.tilesOver25 || cull.changed > 2 * floor.changed + 0.001)
        failures.push(name);
    }
    console.log(`W1L-I1 culling\n${rows.join('\n')}`);
    expect(view.stats().errors).toEqual([]);
    expect(failures, rows.join('\n')).toEqual([]);
  });
});
