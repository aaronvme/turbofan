import { describe, expect, it } from 'vitest';
import { freestream } from '../../../spikes/lib/gas';
import { consToPrim, gaugeContext, initialState } from '../../../spikes/lib/initial';
import {
  buildGhosts,
  cellIndex,
  cellMetrics,
  makeLayout,
  makeNodes,
} from '../../../spikes/lib/mesh';
import { referenceIteration } from '../../../spikes/lib/stageReference';

const GRID = { ni: 16, nj: 8, x0: -1, x1: 3, r1: 1.5, wiggle: 0.25 };
const nodes = makeNodes(GRID);
const layout = makeLayout(GRID.ni, GRID.nj, 2, 2);

describe('referenceIteration (f64 mirror of the WGSL stage kernel)', () => {
  it('preserves an M 0.3 freestream to round-off on the wiggled multi-block mesh', () => {
    const inf = freestream(288.15, 101325, 102);
    const ctx = gaugeContext(inf, 101325, 288.15);
    const ghosts = buildGhosts(nodes, layout, {});
    const s0 = initialState(nodes, layout, ctx, () => ({
      rho: inf.rho,
      u: 102,
      v: 0,
      rw: 0,
      pp: 0,
      z: 0,
    }));
    const s1 = referenceIteration(nodes, layout, ghosts, inf, ctx, 1.5, s0);
    for (let J = 0; J < GRID.nj; J++) {
      for (let I = 0; I < GRID.ni; I++) {
        const c = cellIndex(layout, I, J);
        const q = consToPrim(
          s1.a.subarray(4 * c, 4 * c + 4),
          s1.b.subarray(4 * c, 4 * c + 4),
          cellMetrics(nodes, I, J).rc,
          ctx,
        );
        // f32 input state (Float32Array) limits this to ~1e-5, not the f64 metrics.
        expect(Math.abs(q.u - 102)).toBeLessThan(1e-3);
        expect(Math.abs(q.v)).toBeLessThan(1e-3);
        expect(Math.abs(q.pp)).toBeLessThan(0.1);
      }
    }
  });

  it('moves a pressure pulse and writes a positive local dt into B.z', () => {
    const inf = freestream(288.15, 101325, 102);
    const ctx = gaugeContext(inf, 101325, 288.15);
    const ghosts = buildGhosts(nodes, layout, { wallTop: [4, 10] });
    const s0 = initialState(nodes, layout, ctx, (x, r) => {
      const bump = Math.exp(-((x - 0.5) ** 2 + (r - 0.6) ** 2) / 0.1);
      return { rho: inf.rho, u: 102, v: 3 * bump, rw: 5 * r * bump, pp: 5000 * bump, z: 0.01 };
    });
    const s1 = referenceIteration(nodes, layout, ghosts, inf, ctx, 1.5, s0);
    let changed = 0;
    for (let k = 0; k < s0.b.length; k += 4) {
      if (Math.abs((s1.b[k] ?? 0) - (s0.b[k] ?? 0)) > 1) changed++;
      expect(s1.b[k + 2]).toBeGreaterThan(0);
    }
    expect(changed).toBeGreaterThan(layout.nCells / 4);
    expect([...s1.a, ...s1.b].every(Number.isFinite)).toBe(true);
  });
});
