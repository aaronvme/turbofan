// The GPU solver's exactness properties (docs/SOLVER.md 12.1), checked analytically, with no
// oracle comparison (critic pass 7: those wait for the reference's SLAU2 value tests and the
// 12.2 preconditioned rows):
// - the quiescent ambient is bitwise zero on the real 130k asset, in both modes;
// - every interface face flux is the bitwise negation (or copy) of the other block's;
// - slip-wall faces carry exactly zero mass, angular momentum, energy and fuel;
// - the result does not depend on the tile shape or on splitting a block (bitwise);
// - the volume sources and the point-implicit update follow their closed forms.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { SimDevice } from '../../src/gpu/device';
import { GpuSolver, type GpuSolverOptions } from '../../src/flow/gpu/device/gpuSolver';
import { tileFaceSlots } from '../../src/flow/gpu/wgsl/kernels';
import { THERMALLY_PERFECT, caloricallyPerfectGas } from '../../src/flow/reference/gas';
import type { SolverMesh } from '../../src/flow/reference/solverMesh';
import { BC, rectangle, singleBlock, solverMesh, threeBlockRow } from '../unit/flow/helpers';
import { connect } from '../../tools/mesh/topology';
import type { MultiBlockMesh, Patch } from '../../tools/mesh/types';
import { GpuErrorLog, shippedMesh, solverDevice } from './helpers/solver';

const ISA = { pressure: 101325, temperature: 288.15, velocity: 0 };

/** A smooth pulse with swirl and a hot fuel-air spot on top of the ambient (every code path). */
function pulse(x0: number, r0: number, scale: number) {
  return (x: number, r: number) => {
    const d2 = ((x - x0) ** 2 + (r - r0) ** 2) / (scale * scale);
    const bump = Math.exp(-d2);
    return {
      rho: 1.225 * (1 + 0.05 * bump),
      u: 20 * bump,
      v: -8 * bump,
      w: 30 * bump,
      p: 101325 + 6000 * bump,
      z: 0.03 * bump,
    };
  };
}

describe('GPU solver exactness (SOLVER.md 12.1)', () => {
  const log = new GpuErrorLog();
  let sim: SimDevice;
  let engine: SolverMesh;

  beforeAll(async () => {
    sim = await solverDevice(log);
    engine = await shippedMesh();
  });

  afterEach(() => {
    log.assertNone('solver-exact');
  });

  afterAll(() => {
    sim.destroy();
  });

  const create = (mesh: SolverMesh, opts: Partial<GpuSolverOptions> = {}) =>
    GpuSolver.create(sim.device, mesh, { gas: THERMALLY_PERFECT, freeStream: ISA, ...opts });

  it('keeps the quiescent ambient bitwise zero on the 130k asset in both modes', async () => {
    const s = await create(engine);
    expect(s.layout.nCells).toBe(130_034);
    s.iterate(100);
    const state = await s.readState();
    const conserved = Array.from(state).filter((_, k) => k % 8 < 6);
    expect(conserved.every((v) => v === 0)).toBe(true);
    expect(await s.readResidual()).toBe(0);
    const P = await s.readPrimitives();
    // every primitive gauge (cells and ghosts) is exactly zero; the sound speed is c_inf
    for (let e = 0; e < P.length / 8; e++) {
      for (const k of [0, 1, 2, 3, 4, 5, 6]) {
        if (P[8 * e + k] !== 0) throw new Error(`prim ${e}.${k} = ${P[8 * e + k]}`);
      }
    }
    expect(P[7]).toBeCloseTo(s.ref.c, 3);
    for (let k = 0; k < 10; k++) s.stepPhysical();
    const after = await s.readState();
    expect(Array.from(after).every((v, k) => k % 8 >= 6 || v === 0)).toBe(true);
    expect(await s.readResidual()).toBe(0);
    expect(await s.readTime()).toBeGreaterThan(0);
    s.destroy();
  });

  /** For every interface face: (block, dir, i, j) of both sides and whether S is negated. */
  function interfacePairs(mesh: SolverMesh) {
    type FaceRef = { block: number; dir: 'i' | 'j'; i: number; j: number; global: number };
    // the boundary face of face cell c on block face `side`, seen from block b
    const boundaryFace = (b: number, side: number, c: number): FaceRef => {
      const blk = mesh.blocks[b];
      if (blk === undefined) throw new Error('no block');
      if (side < 2) {
        const i = side === 0 ? 0 : blk.ni;
        return { block: b, dir: 'i', i, j: c, global: blk.iFaceOffset + c * (blk.ni + 1) + i };
      }
      const j = side === 2 ? 0 : blk.nj;
      return { block: b, dir: 'j', i: c, j, global: blk.jFaceOffset + j * blk.ni + c };
    };
    const ghostInfo = (g: number) => {
      // which block, block face and face cell a ghost belongs to
      let b = mesh.blocks.length - 1;
      while (b > 0 && (mesh.blocks[b]?.ghostOffset ?? 0) > g) b--;
      const blk = mesh.blocks[b];
      if (blk === undefined) throw new Error('no block');
      let k = g - blk.ghostOffset;
      const sizes = [blk.nj, blk.nj, blk.ni, blk.ni];
      let side = 0;
      while (k >= 2 * (sizes[side] ?? 0)) {
        k -= 2 * (sizes[side] ?? 0);
        side++;
      }
      const n = sizes[side] ?? 0;
      return { block: b, side, layer: Math.floor(k / n) + 1, c: k % n };
    };
    const cellOf = (cell: number) => {
      let b = mesh.blocks.length - 1;
      while (b > 0 && (mesh.blocks[b]?.cellOffset ?? 0) > cell) b--;
      const blk = mesh.blocks[b];
      if (blk === undefined) throw new Error('no block');
      const local = cell - blk.cellOffset;
      return { block: b, i: local % blk.ni, j: Math.floor(local / blk.ni) };
    };
    const faceCell = (info: ReturnType<typeof ghostInfo>) => {
      const blk = mesh.blocks[info.block];
      if (blk === undefined) throw new Error('no block');
      const [i, j] =
        info.side === 0
          ? [0, info.c]
          : info.side === 1
            ? [blk.ni - 1, info.c]
            : info.side === 2
              ? [info.c, 0]
              : [info.c, blk.nj - 1];
      return blk.cellOffset + j * blk.ni + i;
    };
    // layer-1 interface ghosts, keyed by (face cell, source cell)
    const byPair = new Map<string, ReturnType<typeof ghostInfo>>();
    for (let g = 0; g < mesh.nGhosts; g++) {
      if (mesh.ghostBc[g] !== 0 || mesh.ghostLayer[g] !== 1) continue;
      const info = ghostInfo(g);
      byPair.set(`${faceCell(info)}:${mesh.ghostSrc[g]}`, info);
    }
    const pairs: { a: FaceRef; b: FaceRef; negated: boolean }[] = [];
    for (const [key, info] of byPair) {
      const [fc, src] = key.split(':').map(Number) as [number, number];
      if (fc > src) continue;
      const other = byPair.get(`${src}:${fc}`);
      if (other === undefined) throw new Error(`interface ghost ${key} has no partner`);
      const a = boundaryFace(info.block, info.side, info.c);
      const b = boundaryFace(other.block, other.side, other.c);
      expect(cellOf(src).block).toBe(other.block);
      const nx = (f: FaceRef) => (f.dir === 'i' ? mesh.iNx : mesh.jNx)[f.global] ?? NaN;
      const nr = (f: FaceRef) => (f.dir === 'i' ? mesh.iNr : mesh.jNr)[f.global] ?? NaN;
      const negated = nx(a) * nx(b) + nr(a) * nr(b) < 0;
      pairs.push({ a, b, negated });
    }
    return pairs;
  }

  /** The dumped flux (8 f32) of a face, as computed by the tile that owns it as a west/south face. */
  function dumpedFlux(
    s: GpuSolver,
    dump: Float32Array,
    f: { block: number; dir: 'i' | 'j'; i: number; j: number },
  ) {
    const t = s.layout.tile;
    const blk = s.mesh.blocks[f.block];
    if (blk === undefined) throw new Error('no block');
    // the tile containing the face's cell on its +side (or the last tile for the max face)
    const ci = f.dir === 'i' ? Math.min(f.i, blk.ni - 1) : f.i;
    const cj = f.dir === 'j' ? Math.min(f.j, blk.nj - 1) : f.j;
    const ti = Math.floor(ci / t.x);
    const tj = Math.floor(cj / t.y);
    const w = s.layout.tiles.findIndex((x) => x.block === f.block && x.ti === ti && x.tj === tj);
    const fx = f.dir === 'i' ? f.i - ti * t.x : f.i - ti * t.x;
    const fy = f.dir === 'i' ? f.j - tj * t.y : f.j - tj * t.y;
    const slot = f.dir === 'i' ? fy * (t.x + 1) + fx : (t.x + 1) * t.y + fy * t.x + fx;
    const o = 8 * (w * tileFaceSlots(t) + slot);
    return Array.from(dump.subarray(o, o + 6));
  }

  async function checkInterfaces(mesh: SolverMesh, label: string) {
    const s = await create(mesh, { faceDump: true });
    s.setState(
      pulse(
        0.5 *
          (mesh.cellX.reduce((a, b) => Math.max(a, b), -Infinity) +
            mesh.cellX.reduce((a, b) => Math.min(a, b), Infinity)),
        0.5,
        0.4,
      ),
    );
    s.iterate(1);
    const dump = await s.readFaceDump();
    const pairs = interfacePairs(mesh);
    expect(pairs.length, label).toBeGreaterThan(0);
    let nonzero = 0;
    for (const p of pairs) {
      const fa = dumpedFlux(s, dump, p.a);
      const fb = dumpedFlux(s, dump, p.b);
      const expected = p.negated ? fb.map((v) => -v) : fb;
      for (let k = 0; k < 6; k++) {
        if (!Object.is(fa[k] === 0 ? 0 : fa[k], expected[k] === 0 ? 0 : expected[k])) {
          throw new Error(
            `${label}: interface face ${JSON.stringify(p.a)} / ${JSON.stringify(p.b)} component ${k}: ${fa[k]} vs ${expected[k]}`,
          );
        }
      }
      if (fa.some((v) => v !== 0)) nonzero++;
    }
    expect(nonzero, `${label}: interface fluxes that are not zero`).toBeGreaterThan(0);
    s.destroy();
    return pairs.length;
  }

  it('computes every interface face flux bitwise equal or negated on both sides', async () => {
    const row = solverMesh(
      threeBlockRow(1, 1, 20, 12, {
        left: BC.SLIP_WALL,
        right: BC.SLIP_WALL,
        bottom: BC.AXIS,
        top: BC.SLIP_WALL,
      }),
      'f32',
    );
    expect(await checkInterfaces(row, 'three-block row')).toBe(24);
    expect(await checkInterfaces(engine, '130k asset')).toBeGreaterThan(1000);
  });

  it('gives slip-wall faces exact zeros in mass, angular momentum, energy and fuel', async () => {
    const box = solverMesh(
      singleBlock(rectangle('box', 0, 1, 0.2, 1.2, 24, 20), {
        imin: BC.SLIP_WALL,
        imax: BC.SLIP_WALL,
        jmin: BC.SLIP_WALL,
        jmax: BC.SLIP_WALL,
      }),
      'f32',
    );
    const s = await create(box, { faceDump: true });
    s.setState(pulse(0.1, 0.25, 0.2));
    s.iterate(1);
    const dump = await s.readFaceDump();
    const blk = box.blocks[0];
    if (blk === undefined) throw new Error('no block');
    let pressure = 0;
    for (let j = 0; j < blk.nj; j++) {
      for (const i of [0, blk.ni]) {
        const F = dumpedFlux(s, dump, { block: 0, dir: 'i', i, j });
        expect([F[0], F[3], F[4], F[5]]).toEqual([0, 0, 0, 0]);
        if (F[1] !== 0) pressure++;
      }
    }
    for (let i = 0; i < blk.ni; i++) {
      for (const j of [0, blk.nj]) {
        const F = dumpedFlux(s, dump, { block: 0, dir: 'j', i, j });
        expect([F[0], F[3], F[4], F[5]]).toEqual([0, 0, 0, 0]);
      }
    }
    expect(pressure).toBeGreaterThan(0);
    s.destroy();
  });

  it('does not depend on the tile shape (bitwise)', async () => {
    const mesh = solverMesh(
      threeBlockRow(1, 1, 37, 21, {
        left: BC.INFLOW,
        right: BC.OUTFLOW,
        bottom: BC.AXIS,
        top: BC.FARFIELD,
      }),
      'f32',
    );
    const results: Float32Array[] = [];
    for (const tile of [
      { x: 16, y: 8 },
      { x: 8, y: 8 },
      { x: 32, y: 4 },
      { x: 5, y: 3 },
    ]) {
      const s = await create(mesh, {
        tile,
        freeStream: { ...ISA, velocity: 60 },
      });
      s.setState(pulse(1.5, 0.5, 0.3));
      s.iterate(20);
      results.push(await s.readState());
      s.destroy();
    }
    const [first, ...rest] = results;
    for (const r of rest) expect(r).toEqual(first);
  });

  it('gives the same result for a block and the same block split in three (bitwise)', async () => {
    const whole = rectangle('whole', 0, 3, 0, 1, 36, 12);
    const one = solverMesh(
      singleBlock(whole, {
        imin: BC.INFLOW,
        imax: BC.OUTFLOW,
        jmin: BC.AXIS,
        jmax: BC.FARFIELD,
      }),
      'f32',
    );
    const parts = [0, 1, 2].map((k) => rectangle(`p${k}`, k, k + 1, 0, 1, 12, 12));
    const patches: Patch[] = [
      { block: 0, face: 'imin', start: 0, end: 12, bc: BC.INFLOW, label: 'in' },
      { block: 2, face: 'imax', start: 0, end: 12, bc: BC.OUTFLOW, label: 'out' },
      ...[0, 1, 2].flatMap((b): Patch[] => [
        { block: b, face: 'jmin', start: 0, end: 12, bc: BC.AXIS, label: 'axis' },
        { block: b, face: 'jmax', start: 0, end: 12, bc: BC.FARFIELD, label: 'far' },
      ]),
    ];
    connect(
      patches,
      { block: 0, face: 'imax', start: 0, end: 12 },
      { block: 1, face: 'imin', start: 0, end: 12 },
      '0|1',
      false,
    );
    connect(
      patches,
      { block: 1, face: 'imax', start: 0, end: 12 },
      { block: 2, face: 'imin', start: 0, end: 12 },
      '1|2',
      false,
    );
    const split = solverMesh({ blocks: parts, patches } satisfies MultiBlockMesh, 'f32');
    const run = async (mesh: SolverMesh) => {
      const s = await create(mesh, { freeStream: { ...ISA, velocity: 40 } });
      s.setState(pulse(1.4, 0.4, 0.3));
      s.iterate(15);
      for (let k = 0; k < 3; k++) s.stepPhysical();
      const st = await s.readState();
      s.destroy();
      return st;
    };
    const a = await run(one);
    const b = await run(split);
    // cell (i, j) of the whole block is cell (i mod 12, j) of part floor(i / 12)
    for (let j = 0; j < 12; j++) {
      for (let i = 0; i < 36; i++) {
        const ca = j * 36 + i;
        const cb = Math.floor(i / 12) * 144 + j * 12 + (i % 12);
        for (let m = 0; m < 6; m++) {
          if (a[8 * ca + m] !== b[8 * cb + m]) {
            throw new Error(
              `cell (${i}, ${j}) component ${m}: ${a[8 * ca + m]} vs ${b[8 * cb + m]}`,
            );
          }
        }
      }
    }
  });

  it('adds a uniform volume source exactly and divides by 1 + dt d (closed box, SSP-RK3)', async () => {
    const gas = caloricallyPerfectGas(1.4, 287.05287);
    const box = solverMesh(
      singleBlock(rectangle('box', 0, 1, 0.5, 1.5, 8, 8), {
        imin: BC.SLIP_WALL,
        imax: BC.SLIP_WALL,
        jmin: BC.SLIP_WALL,
        jmax: BC.SLIP_WALL,
      }),
    );
    const s = await create(box, { gas, linearSource: true });
    const n = box.nCells;
    // a heat source s_eta = 1e4 W/m^3 and a fuel source, no damping: U grows linearly
    const rate0 = new Float64Array(6 * n);
    const k = new Float64Array(6 * n);
    for (let c = 0; c < n; c++) {
      rate0[6 * c + 4] = 1e4;
      rate0[6 * c + 5] = 1e-3;
    }
    s.setLinearSource(rate0, k);
    const dt = 1e-4;
    for (let step = 0; step < 10; step++) s.stepPhysical(dt);
    const U = await s.readConserved();
    for (let c = 0; c < n; c++) {
      expect(U[6 * c + 4]).toBeCloseTo(1e4 * 10 * dt, 3);
      expect(U[6 * c + 5]).toBeCloseTo(1e-3 * 10 * dt, 9);
      // uniform state: no pressure gradient, so no motion (rounding of the f32 face sums only)
      expect(Math.abs(U[6 * c + 1] ?? NaN)).toBeLessThan(1e-6);
    }
    // the clock is an f32 Kahan sum: good to the f32 rounding of dt (6e-8 relative)
    expect(Math.abs((await s.readTime()) / (10 * dt) - 1)).toBeLessThan(1e-7);
    s.destroy();
  });

  it('applies a point-implicit sink as E(U) = U / (1 + dt k) in each SSP-RK3 stage', async () => {
    const box = solverMesh(
      singleBlock(rectangle('box', 0, 1, 0.5, 1.5, 8, 8), {
        imin: BC.SLIP_WALL,
        imax: BC.SLIP_WALL,
        jmin: BC.SLIP_WALL,
        jmax: BC.SLIP_WALL,
      }),
    );
    const s = await create(box, { linearSource: true });
    const n = box.nCells;
    const rate0 = new Float64Array(6 * n);
    const kk = new Float64Array(6 * n);
    const K = 5000; // stiff: dt K = 5
    for (let c = 0; c < n; c++) kk[6 * c + 5] = K; // fuel only: no effect on the flow
    s.setLinearSource(rate0, kk);
    s.setUniform({ rho: s.ref.rho, u: 0, v: 0, w: 0, p: s.ref.p, z: 0.02 });
    const before = await s.readConserved();
    const dt = 1e-3;
    s.stepPhysical(dt);
    const after = await s.readConserved();
    // with R = -b V (-k U) per stage: E(U) = U - dt k U / (1 + dt k) = U / (1 + dt k)
    const g = 1 / (1 + dt * K);
    const e1 = g;
    const e2 = 0.75 + 0.25 * g * e1;
    const e3 = 1 / 3 + (2 / 3) * g * e2;
    for (let c = 0; c < n; c++) {
      expect((after[6 * c + 5] ?? NaN) / (before[6 * c + 5] ?? NaN)).toBeCloseTo(e3, 6);
    }
    s.destroy();
  });
});
