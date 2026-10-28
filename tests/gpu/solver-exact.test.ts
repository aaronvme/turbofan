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
function pulse(x0: number, r0: number, scale: number, uInf = 0) {
  return (x: number, r: number) => {
    const d2 = ((x - x0) ** 2 + (r - r0) ** 2) / (scale * scale);
    const bump = Math.exp(-d2);
    return {
      rho: 1.225 * (1 + 0.05 * bump),
      u: uInf + 20 * bump,
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

  async function checkInterfaces(mesh: SolverMesh, label: string, uInf = 0) {
    const s = await create(mesh, { faceDump: true, freeStream: { ...ISA, velocity: uInf } });
    s.setState(
      pulse(
        0.5 *
          (mesh.cellX.reduce((a, b) => Math.max(a, b), -Infinity) +
            mesh.cellX.reduce((a, b) => Math.min(a, b), Infinity)),
        0.5,
        0.4,
        uInf,
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

  it('keeps the f32 free stream at M 0.5 bitwise zero in every gauge and face flux (130k)', async () => {
    // SOLVER.md 14: with the momentum and velocity gauges and the gauge flux differences, the
    // kernel's own free stream (rho u = fround(rho_inf) fround(u_inf)) is an exact zero like the
    // quiescent ambient; only the f32 metrics' sum of S_x (the add-back) forces it (ladder L1)
    const probe = await create(engine);
    const u = 0.5 * probe.ref.c;
    probe.destroy();
    const s = await create(engine, {
      freeStream: { ...ISA, velocity: u },
      // the inflow BC's isentrope is rounding-level in f32 (12.1): a far field there too
      bcRemap: { [BC.SLIP_WALL]: BC.FARFIELD, [BC.INFLOW]: BC.FARFIELD },
      faceDump: true,
      cfl: 0, // tau = 0: the three stages see the same state, so the dump is the free stream's
    });
    const U = new Float64Array(6 * engine.nCells);
    for (let c = 0; c < engine.nCells; c++) U[6 * c + 1] = Math.fround(s.ref.rho) * Math.fround(u);
    s.setConserved(U);
    s.iterate(1);
    const dump = await s.readFaceDump();
    const bad = dump.findIndex((v) => v !== 0);
    expect(bad, `face dump value ${bad}: ${dump[bad]}`).toBe(-1);
    const state = await s.readState();
    expect(Array.from(state).every((v, k) => k % 8 >= 6 || v === 0)).toBe(true);
    const P = await s.readPrimitives();
    for (let e = 0; e < P.length / 8; e++) {
      for (const k of [0, 2, 3, 4, 5, 6]) {
        if (P[8 * e + k] !== 0) throw new Error(`prim ${e}.${k} = ${P[8 * e + k]}`);
      }
      if (P[8 * e + 1] !== Math.fround(u)) throw new Error(`prim ${e} u = ${P[8 * e + 1]}`);
    }
    s.destroy();
  });

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
    // in a free stream (u_inf != 0) the gauge flux differences of SOLVER.md 14 are used
    expect(await checkInterfaces(row, 'three-block row, u_inf 170 m/s', 170)).toBe(24);
    expect(await checkInterfaces(engine, '130k asset, u_inf 170 m/s', 170)).toBeGreaterThan(1000);
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
    const s = await create(box, { gas, cellSource: true });
    const n = box.nCells;
    // a heat source s_eta = 1e4 W/m^3 and a fuel source, no damping: U grows linearly
    const rate0 = new Float64Array(6 * n);
    const k = new Float64Array(6 * n);
    for (let c = 0; c < n; c++) {
      rate0[6 * c + 4] = 1e4;
      rate0[6 * c + 5] = 1e-3;
    }
    s.setCellSource({ rate0, kU: k, damping: k });
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

  // SOLVER.md 14.6(b): U^n is kept as the f32 copy plus a low part, so a source whose increment
  // per step is 1/40 of the state's ulp still moves the state at its exact rate. Both records of
  // the state (W2S-A-I5): rho Z in (eta, rho Z) and rho' in (rho', (rho u)', rho v, rho r w). The
  // calorically perfect gas has the same R and cp for air and products, so a uniform fuel
  // fraction in the ambient is a quiet state (every flux an exact zero) with a large rho Z; a
  // uniform rho' at p_inf is one with a large rho', and a mass source at u = 0 keeps rho e = p /
  // (gamma - 1), so p stays p_inf while rho' grows.
  for (const comp of [5, 0] as const) {
    it(`accumulates increments below the state ulp (compensated update, both modes, component ${comp})`, async () => {
      const box = solverMesh(
        singleBlock(rectangle('box', 0, 1, 0.5, 1.5, 8, 8), {
          imin: BC.SLIP_WALL,
          imax: BC.SLIP_WALL,
          jmin: BC.SLIP_WALL,
          jmax: BC.SLIP_WALL,
        }),
      );
      const n = box.nCells;
      const N = 400;
      for (const mode of ['physical', 'tracking'] as const) {
        const s = await create(box, {
          gas: caloricallyPerfectGas(1.4, 287.05287),
          cellSource: true,
        });
        s.setUniform(
          comp === 5
            ? { rho: s.ref.rho, u: 0, v: 0, w: 0, p: s.ref.p, z: 0.03 }
            : { rho: 1.1 * s.ref.rho, u: 0, v: 0, w: 0, p: s.ref.p, z: 0 },
        );
        if (mode === 'tracking') s.iterate(1); // the local tau of this quiet state, in the copy
        const before = await s.readConserved();
        const st = await s.readState();
        const dt = 1e-4;
        // per step and cell: dt rate (physical) or tau_c b V_c rate (tracking: alpha_3 = 1)
        const perRate = Array.from({ length: n }, (_, c) =>
          mode === 'physical' ? Math.fround(dt) : (st[8 * c + 6] ?? NaN) * (box.cellVolR[c] ?? NaN),
        );
        const q0 = before[comp] ?? NaN;
        const ulp = 2 ** (Math.floor(Math.log2(Math.abs(q0))) - 23);
        // increments of 1/40 ulp (rho Z) or 1/4 ulp (rho': its 1e-9 flow noise below stays ~1 %
        // of the 100 ulps it then moves); either rounds away without the low part
        const rate = ulp / (comp === 5 ? 40 : 4) / Math.max(...perRate);
        const rate0 = new Float64Array(6 * n);
        for (let c = 0; c < n; c++) rate0[6 * c + comp] = rate;
        s.setCellSource({ rate0 });
        if (mode === 'physical') for (let k = 0; k < N; k++) s.stepPhysical(dt);
        else s.iterate(N);
        const after = await s.readConserved();
        const hi = await s.readState();
        for (let c = 0; c < n; c++) {
          const want = N * rate * (perRate[c] ?? NaN);
          const d = (after[6 * c + comp] ?? NaN) - (before[6 * c + comp] ?? NaN);
          // rho' (tracking): the f32 rounding of p' (a few ulp) leaves the walls' pressure and
          // the pressure source unbalanced by an ulp, a flow of ~1e-6 m/s whose mass flux moves
          // rho' by ~1e-9; without the low part the state would move 1/400 of the increments
          const tol = comp === 0 && mode === 'tracking' ? 0.05 : 1e-3;
          expect(Math.abs(d / want - 1), `${mode} cell ${c}: moved ${d}, ${want}`).toBeLessThan(
            tol,
          );
          // the f32 copy moves by whole ulps as the low part carries: it is not stuck at U^0
          expect(Math.abs((hi[8 * c + comp] ?? NaN) - Math.fround(q0)) / ulp, mode).toBeGreaterThan(
            3,
          );
          for (const k of [0, 1, 2, 3, 4, 5]) {
            if (k === comp) continue;
            const dk = (after[6 * c + k] ?? NaN) - (before[6 * c + k] ?? NaN);
            // rho Z: every other component an exact zero; rho': that ~1e-6 m/s flow only
            if (comp === 5) expect(after[6 * c + k], `${mode} ${c}.${k}`).toBe(0);
            else expect(Math.abs(dk), `${mode} ${c}.${k}`).toBeLessThan(k === 4 ? 1e-3 : 1e-5);
          }
        }
        s.destroy();
      }
    });
  }

  it('adds the power of a force source to the energy (work: s_eta = u s_x + v s_r + w s_L / r)', async () => {
    // ladder L9b's actuator disk: a force density f along x with s_eta = f u, in a uniform stream
    // at the free stream (every gauge flux an exact zero), so only the source moves the state
    const box = solverMesh(
      singleBlock(rectangle('box', 0, 1, 0.5, 1.5, 8, 8), {
        imin: BC.FARFIELD,
        imax: BC.FARFIELD,
        jmin: BC.FARFIELD,
        jmax: BC.FARFIELD,
      }),
    );
    const gas = caloricallyPerfectGas(1.4, 287.05287);
    const u0 = 40;
    const s = await create(box, { gas, freeStream: { ...ISA, velocity: u0 }, cellSource: true });
    s.setUniform({ rho: s.ref.rho, u: u0, v: 0, w: 0, p: s.ref.p, z: 0 });
    const n = box.nCells;
    const f = 50; // N/m^3
    const rate0 = new Float64Array(6 * n);
    const work = new Float64Array(n);
    const inner: number[] = [];
    for (let j = 2; j < 6; j++) for (let i = 2; i < 6; i++) inner.push(j * 8 + i);
    for (const c of inner) {
      rate0[6 * c + 1] = f;
      work[c] = 1;
    }
    s.setCellSource({ rate0, work });
    const before = await s.readConserved();
    const dt = 1e-7; // short: the flux response to the forced cells is O(dt c / dx) of the increment
    s.stepPhysical(dt);
    const after = await s.readConserved();
    for (const c of inner) {
      const dm = (after[6 * c + 1] ?? NaN) - (before[6 * c + 1] ?? NaN);
      const de = (after[6 * c + 4] ?? NaN) - (before[6 * c + 4] ?? NaN);
      expect(dm / (f * dt)).toBeCloseTo(1, 3);
      expect(de / (f * u0 * dt)).toBeCloseTo(1, 3);
    }
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
    const s = await create(box, { cellSource: true });
    const n = box.nCells;
    const rate0 = new Float64Array(6 * n);
    const kk = new Float64Array(6 * n);
    const K = 5000; // stiff: dt K = 5
    for (let c = 0; c < n; c++) kk[6 * c + 5] = K; // fuel only: no effect on the flow
    s.setCellSource({ rate0, kU: kk, damping: kk });
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
