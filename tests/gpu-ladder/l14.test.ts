// Ladder L14 (PHYSICS.md 3.3, D5-2; W2S-I1) on the GPU kernel: the CPU ladder's hot gas pocket
// (tests/ladder/hotPocket.ts: the same mesh, start, engine defaults and rows), the GPU run from the
// oracle's f32-rounded state, and after every iteration the GPU's state (f32 copy plus low parts)
// in the oracle shell, whose f64 primitives give max and min T' and the finiteness and rho > 0
// checks, as the GPU ladder's other rows read their metrics.
import { afterAll, afterEach, beforeAll, describe, it } from 'vitest';
import type { SimDevice } from '../../src/gpu/device';
import { ReferenceSolver } from '../../src/flow/reference/solver';
import { NP } from '../../src/flow/reference/state';
import type { LadderRow } from '../ladder/common';
import {
  HOT_POCKET_CASES,
  HOT_POCKET_OPTIONS,
  caseName,
  hotPocketMesh,
  hotPocketRows,
  hotPocketState,
  samplePocket,
  tracePocket,
} from '../ladder/hotPocket';
import { GpuErrorLog, solverDevice } from '../gpu/helpers/solver';
import { back, onGpu, report } from './helpers';

describe('GPU ladder L14: the hot gas pocket', () => {
  const log = new GpuErrorLog();
  let sim: SimDevice;

  beforeAll(async () => {
    sim = await solverDevice(log);
  });

  afterEach(() => {
    log.assertNone('gpu ladder L14');
  });

  afterAll(() => {
    sim.destroy();
  });

  it('a hot gas pocket stays finite and bounded at the engine defaults (GPU)', async () => {
    const rows: LadderRow[] = [];
    const traces: Record<string, unknown> = {};
    for (const c of HOT_POCKET_CASES) {
      const mesh = hotPocketMesh();
      const s = new ReferenceSolver(mesh, HOT_POCKET_OPTIONS);
      s.setState(hotPocketState(c));
      const g = await onGpu(sim.device, s, HOT_POCKET_OPTIONS);
      try {
        const sample = async () => {
          await back(g, s);
          const P = s.primitives();
          const out = samplePocket(P, s.U, s.ref.rho, mesh.nCells);
          let at = -1;
          for (let k = 0; k < mesh.nCells; k++) if (P[NP * k + 6] === out.tMax) at = k;
          return { ...out, at };
        };
        const trace = await tracePocket(await sample(), async () => {
          g.iterate(1);
          return sample();
        });
        traces[caseName(c)] = trace;
        rows.push(...hotPocketRows(c, trace, 'GPU '));
      } finally {
        g.destroy();
      }
    }
    report('L14', rows, { traces });
  }, 1_800_000);
});
