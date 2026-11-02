// L14 (PHYSICS.md 3.3, D5-2; W2S-I1): the hot gas pocket on the f64 oracle at the engine's
// defaults. Each case runs 2000 tracking iterations from its start, sampled after every iteration
// (tests/ladder/hotPocket.ts has the set-up and the rows, shared with the GPU ladder).
import { ReferenceSolver } from '../../../src/flow/reference/solver';
import { NP } from '../../../src/flow/reference/state';
import type { LadderRow } from '../common';
import {
  HOT_POCKET_CASES,
  HOT_POCKET_OPTIONS,
  caseName,
  hotPocketMesh,
  hotPocketRows,
  hotPocketState,
  samplePocket,
  tracePocket,
} from '../hotPocket';

export async function run() {
  const rows: LadderRow[] = [];
  const traces: Record<string, unknown> = {};
  for (const c of HOT_POCKET_CASES) {
    const mesh = hotPocketMesh();
    const s = new ReferenceSolver(mesh, HOT_POCKET_OPTIONS);
    s.setState(hotPocketState(c));
    const sample = () => {
      const P = s.primitives();
      const out = samplePocket(P, s.U, s.ref.rho, mesh.nCells);
      let at = -1;
      for (let k = 0; k < mesh.nCells; k++) if (P[NP * k + 6] === out.tMax) at = k;
      return { ...out, at };
    };
    const trace = await tracePocket(sample(), () => {
      s.iterate(1);
      return sample();
    });
    traces[caseName(c)] = trace;
    rows.push(...hotPocketRows(c, trace));
  }
  return { id: 'L14', rows, extra: { traces } };
}
