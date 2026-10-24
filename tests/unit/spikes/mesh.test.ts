import { describe, expect, it } from 'vitest';
import {
  BC,
  buildGeometry,
  buildGhosts,
  buildTopology,
  cellIndex,
  cellMetrics,
  faceVectors,
  ghostCount,
  ghostSlot,
  makeLayout,
  makeNodes,
  splitSizes,
  type Layout,
} from '../../../spikes/lib/mesh';

const SPEC = { ni: 24, nj: 12, x0: -1, x1: 3, r1: 1.5, wiggle: 0.25 };

describe('makeNodes', () => {
  it('puts the bottom row on the axis and the top row at r1', () => {
    const n = makeNodes(SPEC);
    for (let i = 0; i <= SPEC.ni; i++) {
      expect(n.r[i]).toBe(0);
      expect(n.r[SPEC.nj * (SPEC.ni + 1) + i]).toBeCloseTo(SPEC.r1, 12);
    }
  });
});

describe('cell and face metrics (per radian, r-weighted)', () => {
  const nodes = makeNodes(SPEC);

  it('a unit square at r in [1, 2] has V = 1.5, A = 1, rc = 1.5', () => {
    const square = { ni: 1, nj: 1, x: Float64Array.of(0, 1, 0, 1), r: Float64Array.of(1, 1, 2, 2) };
    expect(cellMetrics(square, 0, 0)).toEqual({ vol: 1.5, area: 1, rc: 1.5 });
    expect(faceVectors(square, 0, 0)).toEqual({ si: [1.5, 0], sj: [0, 1], rfi: 1.5, rfj: 1 });
  });

  it('every cell closes: outward sum of S is (0, A), which makes p-gauge freestream exact', () => {
    for (let j = 0; j < SPEC.nj; j++) {
      for (let i = 0; i < SPEC.ni; i++) {
        const w = faceVectors(nodes, i, j);
        const e = faceVectors(nodes, i + 1, j);
        const n = faceVectors(nodes, i, j + 1);
        const { area, vol, rc } = cellMetrics(nodes, i, j);
        const sx = e.si[0] - w.si[0] + n.sj[0] - w.sj[0];
        const sr = e.si[1] - w.si[1] + n.sj[1] - w.sj[1];
        expect(Math.abs(sx)).toBeLessThan(1e-14);
        expect(Math.abs(sr - area)).toBeLessThan(1e-14);
        expect(vol).toBeGreaterThan(0);
        expect(rc * area).toBeCloseTo(vol, 14);
      }
    }
  });

  it('axis faces have zero area', () => {
    for (let i = 0; i < SPEC.ni; i++) {
      const f = faceVectors(nodes, i, 0);
      expect(f.sj).toEqual([0, 0]);
      expect(f.rfj).toBe(0);
    }
  });
});

describe('splitSizes / makeLayout', () => {
  it('splits as evenly as possible', () => {
    expect(splitSizes(10, 3)).toEqual([4, 3, 3]);
    expect(splitSizes(256, 3)).toEqual([86, 85, 85]);
  });

  it('numbers cells block by block, row-major inside a block, covering every cell once', () => {
    const layout = makeLayout(SPEC.ni, SPEC.nj, 4, 3);
    expect(layout.blocks).toHaveLength(12);
    const seen = new Set<number>();
    for (let J = 0; J < SPEC.nj; J++) {
      for (let I = 0; I < SPEC.ni; I++) seen.add(cellIndex(layout, I, J));
    }
    expect(seen.size).toBe(SPEC.ni * SPEC.nj);
    expect(Math.max(...seen)).toBe(SPEC.ni * SPEC.nj - 1);
    expect(layout.nCells).toBe(SPEC.ni * SPEC.nj);
  });

  it('a single block is plain row-major order', () => {
    const one = makeLayout(SPEC.ni, SPEC.nj, 1, 1);
    expect(cellIndex(one, 5, 3)).toBe(3 * SPEC.ni + 5);
  });
});

describe('ghostSlot', () => {
  it('maps the 2-cell ring around an ni x nj block one-to-one onto [0, ghostCount)', () => {
    const ni = 5;
    const nj = 3;
    const slots = new Set<number>();
    for (let j = -2; j < nj + 2; j++) {
      for (let i = -2; i < ni + 2; i++) {
        const inside = i >= 0 && i < ni && j >= 0 && j < nj;
        if (inside) continue;
        const s = ghostSlot(i, j, ni, nj);
        expect(s).toBeGreaterThanOrEqual(0);
        expect(s).toBeLessThan(ghostCount(ni, nj));
        slots.add(s);
      }
    }
    expect(slots.size).toBe(ghostCount(ni, nj));
  });
});

describe('buildGhosts (index map + BC codes)', () => {
  const nodes = makeNodes(SPEC);
  const layout: Layout = makeLayout(SPEC.ni, SPEC.nj, 4, 3);
  const ghosts = buildGhosts(nodes, layout, { wallTop: [6, 12] });
  const f32 = new Float32Array(ghosts.buffer);
  const entry = (b: number, i: number, j: number) => {
    const blk = layout.blocks[b];
    if (!blk) throw new Error('no block');
    const k = 4 * (blk.ghostOffset + ghostSlot(i, j, blk.ni, blk.nj));
    return {
      src: ghosts[k],
      code: ghosts[k + 1],
      n: [f32[k + 2] ?? Number.NaN, f32[k + 3] ?? Number.NaN],
    };
  };

  it('block interfaces copy the neighbouring block cell', () => {
    // block 0 = I in [0, 6), J in [0, 4). Its east ghost (6, 1) is cell (6, 1) of block 1.
    expect(entry(0, 6, 1)).toMatchObject({ src: cellIndex(layout, 6, 1), code: BC.INTERFACE });
    expect(entry(0, 3, 5)).toMatchObject({ src: cellIndex(layout, 3, 5), code: BC.INTERFACE });
  });

  it('the axis mirrors the cell across r = 0', () => {
    expect(entry(0, 2, -1)).toMatchObject({ src: cellIndex(layout, 2, 0), code: BC.AXIS });
    expect(entry(0, 2, -2)).toMatchObject({ src: cellIndex(layout, 2, 1), code: BC.AXIS });
  });

  it('inflow and the top are far field, the exit is outflow, and the wall segment mirrors', () => {
    expect(entry(0, -1, 2)).toMatchObject({ src: cellIndex(layout, 0, 2), code: BC.FARFIELD });
    const top = 8; // blocks 8..11 are the top row
    expect(entry(top, 1, 4)).toMatchObject({ code: BC.FARFIELD, src: cellIndex(layout, 1, 11) });
    expect(entry(top + 1, 0, 4)).toMatchObject({ code: BC.WALL, src: cellIndex(layout, 6, 11) });
    expect(entry(top + 1, 0, 5)).toMatchObject({ code: BC.WALL, src: cellIndex(layout, 6, 10) });
    expect(entry(3, 6, 0)).toMatchObject({ code: BC.OUTFLOW, src: cellIndex(layout, 23, 0) });
  });

  it('stores outward unit normals for the boundary codes', () => {
    const left = entry(0, -1, 2).n;
    expect(Math.hypot(left[0] ?? 0, left[1] ?? 0)).toBeCloseTo(1, 6);
    expect(left[0]).toBeLessThan(0);
    expect(entry(0, 2, -1).n).toEqual([0, -1]);
    expect(entry(8, 1, 4).n[1]).toBeGreaterThan(0.9);
    expect(entry(3, 6, 0).n[0]).toBeGreaterThan(0.9);
  });
});

describe('buildGeometry', () => {
  it('stores (vol, rc) per cell, then 2 vec4 per face slot per block', () => {
    const nodes = makeNodes(SPEC);
    const layout = makeLayout(SPEC.ni, SPEC.nj, 4, 3);
    const geo = buildGeometry(nodes, layout);
    const c = cellIndex(layout, 7, 5);
    const m = cellMetrics(nodes, 7, 5);
    expect(geo[4 * c]).toBeCloseTo(m.vol, 6);
    expect(geo[4 * c + 1]).toBeCloseTo(m.rc, 6);
    const blk = layout.blocks[5]; // p = 1, q = 1: I in [6, 12), J in [4, 8)
    if (!blk) throw new Error('no block');
    const slot = blk.faceVec4 + 2 * ((5 - blk.j0) * (blk.ni + 1) + (7 - blk.i0));
    const f = faceVectors(nodes, 7, 5);
    expect(geo[4 * slot]).toBeCloseTo(f.si[0], 6);
    expect(geo[4 * slot + 3]).toBeCloseTo(f.sj[1], 6);
    expect(geo[4 * (slot + 1)]).toBeCloseTo(f.rfi, 6);
    expect(geo.length).toBe(4 * (layout.nCells + 2 * layout.nFaceSlots));
  });
});

describe('buildTopology', () => {
  it('lists block descriptors, then one entry per tile, then the ghosts', () => {
    const nodes = makeNodes(SPEC);
    const layout = makeLayout(SPEC.ni, SPEC.nj, 4, 3); // blocks 6 x 4
    const ghosts = buildGhosts(nodes, layout, {});
    const topo = buildTopology(layout, ghosts, { x: 4, y: 4 });
    expect(topo.wgBase).toBe(2 * 12);
    expect(topo.workgroups).toBe(12 * 2 * 1); // ceil(6/4) x ceil(4/4) per block
    expect(topo.ghostBase).toBe(topo.wgBase + topo.workgroups);
    const d = topo.data;
    expect([...d.subarray(0, 4)]).toEqual([0, 6, 4, 0]);
    expect([...d.subarray(4 * topo.wgBase, 4 * topo.wgBase + 8)]).toEqual([0, 0, 0, 0, 0, 1, 0, 0]);
    expect(d.length).toBe(4 * (topo.ghostBase + layout.nGhosts));
  });
});
