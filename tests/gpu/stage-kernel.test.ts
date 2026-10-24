import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { GpuErrorLog, requestSimDevice, type SimDevice } from '../../src/gpu/device';
import { StageSolver, runFluxProbe } from '../../spikes/gpu/stageSolver';
import { freestream } from '../../spikes/lib/gas';
import {
  consToPrim,
  gaugeContext,
  initialState,
  type Field,
  type GaugeContext,
} from '../../spikes/lib/initial';
import { TILES } from '../../spikes/lib/kernel';
import {
  buildGhosts,
  cellIndex,
  cellMetrics,
  makeLayout,
  makeNodes,
  type Layout,
  type Tile,
} from '../../spikes/lib/mesh';
import { slau2Flux, type FluxPrim } from '../../spikes/lib/slau2';
import { createDawnGpu } from './helpers/dawn';

// Spike (a) kernel on Dawn: it is not validated physics (that is W2), but these pin that it
// computes what it claims: the real SLAU2, consistent halos/ghosts across tile shapes and
// block splits, and freestream/quiescent preservation of the gauge formulation.

const P_INF = 101325;
const T_INF = 288.15;
const GRID = { ni: 48, nj: 24, x0: -1, x1: 3, r1: 1.5, wiggle: 0.25 };
const nodes = makeNodes(GRID);

function setup(uInf: number, layout: Layout, wallTop?: [number, number]) {
  const inf = freestream(T_INF, P_INF, uInf);
  const ctx = gaugeContext(inf, P_INF, T_INF);
  const ghosts = buildGhosts(nodes, layout, wallTop ? { wallTop } : {});
  return { inf, ctx, ghosts };
}

/** A pressure pulse with swirl and a fuel blob on an M 0.3 stream: every code path active. */
function pulse(inf: ReturnType<typeof freestream>): Field {
  return (x, r) => {
    const d2 = (x - 0.5) ** 2 + (r - 0.6) ** 2;
    const bump = Math.exp(-d2 / 0.05);
    return {
      rho: inf.rho * (1 + 0.1 * bump),
      u: inf.u,
      v: 5 * bump,
      rw: 20 * r * bump,
      pp: 8000 * bump,
      z: 0.02 * bump,
    };
  };
}

describe('spike (a) stage kernel on Dawn', () => {
  const log = new GpuErrorLog();
  let sim: SimDevice;

  beforeAll(async () => {
    sim = await requestSimDevice(createDawnGpu(), {
      powerPreference: 'high-performance',
      onError: log.sink,
    });
  });

  afterEach(() => {
    log.assertNone('stage-kernel');
  });

  afterAll(() => {
    sim.destroy();
  });

  async function run(
    layout: Layout,
    tile: Tile,
    uInf: number,
    field: Field | null,
    iterations: number,
    wallTop?: [number, number],
  ) {
    const { inf, ctx, ghosts } = setup(uInf, layout, wallTop);
    const f: Field =
      field ?? (() => ({ rho: inf.rho, u: uInf, v: 0, rw: 0, pp: 0, z: 0 }) satisfies FluxPrim);
    const solver = await StageSolver.create({
      device: sim.device,
      nodes,
      layout,
      ghosts,
      tile,
      inf,
      ctx,
      cfl: 1.5,
      initial: initialState(nodes, layout, ctx, f),
    });
    const encoder = sim.device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    solver.encode(pass, iterations);
    pass.end();
    sim.device.queue.submit([encoder.finish()]);
    const state = await solver.readState();
    solver.destroy();
    return { state, ctx, inf };
  }

  /** Primitives of every logical cell, in logical (I, J) order. */
  function prims(layout: Layout, state: { a: Float32Array; b: Float32Array }, ctx: GaugeContext) {
    const out: FluxPrim[] = [];
    for (let J = 0; J < GRID.nj; J++) {
      for (let I = 0; I < GRID.ni; I++) {
        const c = cellIndex(layout, I, J);
        const { rc } = cellMetrics(nodes, I, J);
        out.push(
          consToPrim(state.a.subarray(4 * c, 4 * c + 4), state.b.subarray(4 * c, 4 * c + 4), rc, ctx),
        );
      }
    }
    return out;
  }

  it('compiles and creates a pipeline for every tile shape without errors', async () => {
    const layout = makeLayout(GRID.ni, GRID.nj, 4, 3);
    for (const tile of TILES) {
      const { state } = await run(layout, tile, 100, null, 1);
      expect(state.a.every(Number.isFinite)).toBe(true);
    }
  });

  it('computes the SLAU2 flux of the f64 reference (f32 round-off only)', async () => {
    const inf = freestream(T_INF, P_INF, 0);
    const ctx = gaugeContext(inf, P_INF, T_INF);
    // Deterministic pseudo-random faces (LCG), subsonic and supersonic, both flow directions.
    let seed = 12345;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const faces = Array.from({ length: 256 }, () => {
      const speed = rnd() < 0.3 ? 700 : 200;
      const st = (): FluxPrim => ({
        rho: 0.5 + rnd(),
        u: speed * (2 * rnd() - 1),
        v: speed * (2 * rnd() - 1),
        rw: 40 * (2 * rnd() - 1),
        pp: 30000 * (2 * rnd() - 1),
        z: 0.03 * rnd(),
      });
      const ang = 2 * Math.PI * rnd();
      const mag = 0.05 + rnd();
      return {
        L: st(),
        R: st(),
        S: [mag * Math.cos(ang), mag * Math.sin(ang)] as [number, number],
        rf: 0.1 + rnd(),
      };
    });
    const gpu = await runFluxProbe(sim.device, inf, ctx, faces);
    faces.forEach((f, k) => {
      const ref = slau2Flux(f.L, f.R, f.S, f.rf, { pInf: P_INF, h0Inf: inf.h0, zMix: ctx.zMix });
      const got = gpu[k] ?? [];
      // Scale: |S| (rho |V| (|V| + h-scale) + |p'|), the size of the terms being summed.
      const area = Math.hypot(f.S[0], f.S[1]);
      const scale = area * (1.5 * 800 * 800 + 1.5 * 800 * 3e5 + 3e4);
      ref.forEach((x, m) => {
        const err = Math.abs((got[m] ?? Number.NaN) - x);
        // Momentum-sized terms are ~1e6, energy-sized ~1e8; f32 relative error 1e-6 on those.
        expect(err / scale).toBeLessThan(2e-6);
      });
    });
  });

  it('keeps quiescent ambient quiescent on the wiggled 12-block mesh (axis, far field, outflow)', async () => {
    const layout = makeLayout(GRID.ni, GRID.nj, 4, 3);
    const { state, ctx } = await run(layout, { x: 16, y: 8 }, 0, null, 10);
    const q = prims(layout, state, ctx);
    // f32 noise level: ~1e-7 relative on p ~ 1e5 Pa gives ~0.01-0.1 Pa, i.e. velocities
    // ~p / (rho c) ~ 1e-4 m/s per step. Bounds are 10x that over 10 iterations.
    expect(Math.max(...q.map((p) => Math.hypot(p.u, p.v)))).toBeLessThan(1e-2);
    expect(Math.max(...q.map((p) => Math.abs(p.pp)))).toBeLessThan(1);
  });

  it('preserves an M 0.3 freestream on the same mesh (the gauge p\' against the radial source)', async () => {
    const layout = makeLayout(GRID.ni, GRID.nj, 4, 3);
    const { state, ctx, inf } = await run(layout, { x: 16, y: 8 }, 102, null, 10);
    const q = prims(layout, state, ctx);
    expect(Math.max(...q.map((p) => Math.hypot(p.u - inf.u, p.v)))).toBeLessThan(5e-2);
    expect(Math.max(...q.map((p) => Math.abs(p.pp)))).toBeLessThan(5);
  });

  it('gives the same result for every tile shape (halo and partial-tile logic)', async () => {
    const layout = makeLayout(GRID.ni, GRID.nj, 4, 3);
    const inf = freestream(T_INF, P_INF, 102);
    const results = [];
    for (const tile of TILES) {
      results.push((await run(layout, tile, 102, pulse(inf), 3, [16, 32])).state);
    }
    const ref = results[0];
    if (!ref) throw new Error('no result');
    for (const r of results.slice(1)) {
      let worst = 0;
      r.a.forEach((x, k) => {
        worst = Math.max(worst, Math.abs(x - (ref.a[k] ?? Number.NaN)) / (1 + Math.abs(ref.a[k] ?? 0)));
      });
      r.b.forEach((x, k) => {
        worst = Math.max(worst, Math.abs(x - (ref.b[k] ?? Number.NaN)) / (1 + Math.abs(ref.b[k] ?? 0)));
      });
      expect(worst).toBeLessThan(1e-6);
    }
  });

  it('gives the same result on 12 blocks as on one (ghost index map at block interfaces)', async () => {
    const inf = freestream(T_INF, P_INF, 102);
    const multi = makeLayout(GRID.ni, GRID.nj, 4, 3);
    const single = makeLayout(GRID.ni, GRID.nj, 1, 1);
    const m = await run(multi, { x: 16, y: 8 }, 102, pulse(inf), 3, [16, 32]);
    const s = await run(single, { x: 16, y: 8 }, 102, pulse(inf), 3, [16, 32]);
    let worst = 0;
    for (let J = 0; J < GRID.nj; J++) {
      for (let I = 0; I < GRID.ni; I++) {
        const cm = cellIndex(multi, I, J);
        const cs = cellIndex(single, I, J);
        for (let k = 0; k < 4; k++) {
          const a = m.state.a[4 * cm + k] ?? Number.NaN;
          const b = s.state.a[4 * cs + k] ?? Number.NaN;
          worst = Math.max(worst, Math.abs(a - b) / (1 + Math.abs(b)));
          const c = m.state.b[4 * cm + k] ?? Number.NaN;
          const d = s.state.b[4 * cs + k] ?? Number.NaN;
          worst = Math.max(worst, Math.abs(c - d) / (1 + Math.abs(d)));
        }
      }
    }
    expect(worst).toBeLessThan(1e-6);
  });

  it('evolves a pressure pulse (non-trivial work) and stays finite for 200 iterations', async () => {
    const layout = makeLayout(GRID.ni, GRID.nj, 4, 3);
    const inf = freestream(T_INF, P_INF, 102);
    const { ctx } = setup(102, layout);
    const before = prims(layout, initialState(nodes, layout, ctx, pulse(inf)), ctx);
    const { state } = await run(layout, { x: 16, y: 8 }, 102, pulse(inf), 200, [16, 32]);
    expect(state.a.every(Number.isFinite) && state.b.every(Number.isFinite)).toBe(true);
    const after = prims(layout, state, ctx);
    const peakBefore = Math.max(...before.map((p) => p.pp));
    const peakAfter = Math.max(...after.map((p) => p.pp));
    expect(peakAfter).toBeLessThan(0.8 * peakBefore); // the pulse has spread
    // Every cell got a positive local time step in stage 1 (B.z).
    for (let c = 0; c < layout.nCells; c++) expect(state.b[4 * c + 2]).toBeGreaterThan(0);
  });
});
