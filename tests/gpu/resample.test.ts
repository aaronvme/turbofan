import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { GpuErrorLog, requestSimDevice, type SimDevice } from '../../src/gpu/device';
import { FlowResample } from '../../spikes/gpu/resample';
import { StageSolver } from '../../spikes/gpu/stageSolver';
import { freestream } from '../../spikes/lib/gas';
import { consToPrim, gaugeContext, initialState } from '../../spikes/lib/initial';
import { buildGhosts, cellIndex, cellMetrics, makeLayout, makeNodes } from '../../spikes/lib/mesh';
import { createDawnGpu } from './helpers/dawn';

// The render hand-off texture A (rgba16float) encodes the gauge ratios of D0-4:
//   A = ((p - pInf) / pInf, (rho - rhoInf) / rhoInf, u, v).
// Near freestream the ratios are near 0, where f16 is fine-grained (a value of 1e-6 is
// 0.1 Pa); p / pInf near 1 would have an f16 step of 2^-11, about 50 Pa.

const P_INF = 101325;
const T_INF = 288.15;
const U_INF = 102;
const GRID = { ni: 32, nj: 16, x0: -1, x1: 3, r1: 1.5, wiggle: 0.25 };

/** IEEE 754 binary16 -> number. */
function halfToFloat(h: number): number {
  const s = h & 0x8000 ? -1 : 1;
  const e = (h >> 10) & 0x1f;
  const f = h & 0x3ff;
  if (e === 0) return s * f * 2 ** -24;
  if (e === 31) return f ? Number.NaN : s * Number.POSITIVE_INFINITY;
  return s * (1 + f / 1024) * 2 ** (e - 15);
}

describe('spike (a/b) flow resample on Dawn', () => {
  const log = new GpuErrorLog();
  let sim: SimDevice;

  beforeAll(async () => {
    sim = await requestSimDevice(createDawnGpu(), { onError: log.sink });
  });

  afterEach(() => {
    log.assertNone('resample');
  });

  afterAll(() => {
    sim.destroy();
  });

  it('writes the D0-4 gauge ratios (p - pInf)/pInf and (rho - rhoInf)/rhoInf, and u, v', async () => {
    const { device } = sim;
    const nodes = makeNodes(GRID);
    const layout = makeLayout(GRID.ni, GRID.nj, 4, 3);
    const inf = freestream(T_INF, P_INF, U_INF);
    const ctx = gaugeContext(inf, P_INF, T_INF);
    // A pulse on the left half only, so the right half stays at freestream.
    const initial = initialState(nodes, layout, ctx, (x, r) => {
      const bump = x < 1 ? Math.exp(-((x - 0.2) ** 2 + (r - 0.6) ** 2) / 0.05) : 0;
      return {
        rho: inf.rho * (1 + 0.1 * bump),
        u: U_INF,
        v: 5 * bump,
        rw: 0,
        pp: 8000 * bump,
        z: 0,
      };
    });
    const solver = await StageSolver.create({
      device,
      nodes,
      layout,
      ghosts: buildGhosts(nodes, layout, {}),
      tile: { x: 16, y: 8 },
      inf,
      ctx,
      cfl: 1.5,
      initial,
    });
    const resample = new FlowResample(device, nodes, layout, inf);
    const bytesPerRow = 8 * GRID.ni; // 256: already a multiple of 256
    const read = device.createBuffer({
      size: bytesPerRow * GRID.nj,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });
    const enc = device.createCommandEncoder();
    const pass = enc.beginComputePass();
    resample.encode(pass, solver.current());
    pass.end();
    enc.copyTextureToBuffer({ texture: resample.textureA }, { buffer: read, bytesPerRow }, [
      GRID.ni,
      GRID.nj,
    ]);
    device.queue.submit([enc.finish()]);
    await read.mapAsync(GPUMapMode.READ);
    const half = new Uint16Array(read.getMappedRange().slice(0));
    read.unmap();
    read.destroy();
    resample.destroy();
    solver.destroy();

    let pulseCells = 0;
    for (let J = 0; J < GRID.nj; J++) {
      for (let I = 0; I < GRID.ni; I++) {
        const c = cellIndex(layout, I, J);
        const q = consToPrim(
          initial.a.subarray(4 * c, 4 * c + 4),
          initial.b.subarray(4 * c, 4 * c + 4),
          cellMetrics(nodes, I, J).rc,
          ctx,
        );
        const k = 4 * (J * GRID.ni + I);
        const at = (i: number) => halfToFloat(half[k + i] ?? 0);
        const [pRatio, rhoRatio, u, v] = [at(0), at(1), at(2), at(3)];
        // f16 half-ulp at 0.08 is 3e-5; the resample's linearised e(T) adds < 1e-5 here.
        expect(pRatio).toBeCloseTo(q.pp / P_INF, 4);
        expect(rhoRatio).toBeCloseTo((q.rho - inf.rho) / inf.rho, 4);
        expect(u).toBeCloseTo(q.u, 1); // f16 step at 100 m/s is 0.06 m/s
        expect(v).toBeCloseTo(q.v, 2);
        if (Math.abs(q.pp) > 100) pulseCells++;
        if (Math.abs(q.pp) < 0.01 && q.rho === inf.rho) {
          // Freestream: resolved to 0.1 Pa and 1e-6 relative density (f32 round-off).
          expect(Math.abs(pRatio)).toBeLessThan(1e-6);
          expect(Math.abs(rhoRatio)).toBeLessThan(1e-6);
        }
      }
    }
    expect(pulseCells).toBeGreaterThan(10);
  });
});
