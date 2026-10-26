import { describe, expect, it } from 'vitest';
import { geometric, uniform } from '../../../tools/mesh/distribution';
import {
  blockGeometry,
  faceCellIJ,
  meshQuality,
  type BlockQuality,
} from '../../../tools/mesh/metrics';
import { tfi } from '../../../tools/mesh/tfi';
import { connect } from '../../../tools/mesh/topology';
import { BC, nodeIndex, type Block, type Patch } from '../../../tools/mesh/types';
import { edge, rectBlock, reversedPair, sideBySide } from './fixtures';

/** Outward face vectors (n * length) of cell (i, j), in the order W, E, S, N. */
function outward(
  b: Block,
  g: ReturnType<typeof blockGeometry>,
  i: number,
  j: number,
): [number, number][] {
  const fi = (ii: number): number => j * (b.ni + 1) + ii;
  const fj = (jj: number): number => jj * b.ni + i;
  return [
    [-(g.iFaceNx[fi(i)] ?? 0), -(g.iFaceNr[fi(i)] ?? 0)],
    [g.iFaceNx[fi(i + 1)] ?? 0, g.iFaceNr[fi(i + 1)] ?? 0],
    [-(g.jFaceNx[fj(j)] ?? 0), -(g.jFaceNr[fj(j)] ?? 0)],
    [g.jFaceNx[fj(j + 1)] ?? 0, g.jFaceNr[fj(j + 1)] ?? 0],
  ];
}

describe('blockGeometry', () => {
  it('gives exact per-radian volumes and areas for an annular duct', () => {
    const L = 0.8;
    const rh = 0.25;
    const rt = 0.4;
    const b = rectBlock('annulus', 0, L, rh, rt, 8, 5);
    const g = blockGeometry(b);
    let vol = 0;
    for (let c = 0; c < b.ni * b.nj; c++) {
      const j = Math.floor(c / b.ni);
      const r1 = rh + ((rt - rh) * j) / b.nj;
      const r2 = rh + ((rt - rh) * (j + 1)) / b.nj;
      // integral of r dx dr over the cell = dx (r2^2 - r1^2) / 2
      expect(g.volR[c]).toBeCloseTo(((L / b.ni) * (r2 * r2 - r1 * r1)) / 2, 14);
      expect(g.area[c]).toBeCloseTo((L / b.ni) * (r2 - r1), 14);
      expect(g.centreR[c]).toBeCloseTo((r1 + r2) / 2, 14);
      vol += g.volR[c] ?? 0;
    }
    expect(vol).toBeCloseTo((L * (rt * rt - rh * rh)) / 2, 13);
  });

  it('points i-face vectors in +i and j-face vectors in +j, scaled by length', () => {
    const b = rectBlock('box', 0, 1, 2, 3, 2, 4);
    const g = blockGeometry(b);
    expect(g.iFaceNx[0]).toBeCloseTo(0.25, 14);
    expect(g.iFaceNr[0]).toBe(0);
    expect(g.jFaceNx[0]).toBe(0);
    expect(g.jFaceNr[0]).toBeCloseTo(0.5, 14);
    // per-radian face area = mean radius * length
    expect(g.iFaceAreaR[0]).toBeCloseTo(2.125 * 0.25, 14);
    expect(g.jFaceAreaR[0]).toBeCloseTo(2 * 0.5, 14);
  });

  it('closes every cell: outward face vectors sum to zero and sum(n_r r L) = planar area', () => {
    // curved, stretched block so nothing cancels by symmetry
    const ni = 12;
    const nj = 6;
    const b = tfi(
      'curved',
      edge((u) => ({ x: 2 * u, r: 0.1 + 0.3 * u * (1 - u) }), geometric(ni, 0.03)),
      edge((u) => ({ x: 2 * u + 0.4 * u * (1 - u), r: 1 }), uniform(ni)),
      edge((v) => ({ x: 0.2 * v * (1 - v), r: 0.1 * (1 - v) + v }), geometric(nj, 0.08)),
      edge((v) => ({ x: 2, r: 0.1 * (1 - v) + v }), uniform(nj)),
    );
    const g = blockGeometry(b);
    for (let j = 0; j < nj; j++) {
      for (let i = 0; i < ni; i++) {
        const f = outward(b, g, i, j);
        const sx = f.reduce((s, v) => s + v[0], 0);
        const sr = f.reduce((s, v) => s + v[1], 0);
        expect(Math.abs(sx)).toBeLessThan(1e-15);
        expect(Math.abs(sr)).toBeLessThan(1e-15);
        const fi = (ii: number): number => j * (ni + 1) + ii;
        const fj = (jj: number): number => jj * ni + i;
        const ar = (n: number, a: number): number => n * a;
        // sum over faces of n_r * L * rbar (outward), with iFaceAreaR = rbar * L
        const len = (nx: number, nr: number): number => Math.hypot(nx, nr);
        const term = (nx: number, nr: number, areaR: number, sign: number): number =>
          (sign * ar(nr, areaR)) / len(nx, nr);
        const s =
          term(g.iFaceNx[fi(i)] ?? 0, g.iFaceNr[fi(i)] ?? 0, g.iFaceAreaR[fi(i)] ?? 0, -1) +
          term(
            g.iFaceNx[fi(i + 1)] ?? 0,
            g.iFaceNr[fi(i + 1)] ?? 0,
            g.iFaceAreaR[fi(i + 1)] ?? 0,
            1,
          ) +
          term(g.jFaceNx[fj(j)] ?? 0, g.jFaceNr[fj(j)] ?? 0, g.jFaceAreaR[fj(j)] ?? 0, -1) +
          term(
            g.jFaceNx[fj(j + 1)] ?? 0,
            g.jFaceNr[fj(j + 1)] ?? 0,
            g.jFaceAreaR[fj(j + 1)] ?? 0,
            1,
          );
        const c = j * ni + i;
        expect(Math.abs(s / (g.area[c] ?? 1) - 1)).toBeLessThan(1e-12);
      }
    }
  });
});

describe('meshQuality', () => {
  it('reports an ideal uniform rectangle', () => {
    const b = rectBlock('box', 0, 1, 0, 0.5, 10, 10);
    const q = meshQuality({ blocks: [b], patches: [] })[0];
    if (q === undefined) throw new Error('no quality');
    expect(q.cells).toBe(100);
    expect(q.minJacobian).toBeCloseTo(0.1 * 0.05, 15);
    expect(q.maxJacobian).toBeCloseTo(0.1 * 0.05, 15);
    expect(q.minScaledJacobian).toBeCloseTo(1, 12);
    expect(q.maxSkewDeg).toBeLessThan(1e-9);
    expect(q.maxStretch).toBeCloseTo(1, 12);
    expect(q.aspectMin).toBeCloseTo(2, 12);
    expect(q.aspectMax).toBeCloseTo(2, 12);
    expect(q.minEdge).toBeCloseTo(0.05, 12);
    expect(q.maxEdge).toBeCloseTo(0.1, 12);
  });

  it('detects a folded cell with a negative Jacobian', () => {
    const b = rectBlock('box', 0, 1, 0, 1, 4, 4);
    const k = nodeIndex(b, 2, 2);
    b.x[k] = 0.9; // pull an interior node past its east neighbour
    const q = meshQuality({ blocks: [b], patches: [] })[0];
    expect(q?.minJacobian).toBeLessThan(0);
  });

  it('measures skew and wall orthogonality of a sheared block', () => {
    // parallelogram sheared by 20 degrees: i-lines vertical-ish lean, j-lines horizontal
    const t = Math.tan((20 * Math.PI) / 180);
    const ni = 4;
    const nj = 4;
    const b = tfi(
      'shear',
      edge((u) => ({ x: u, r: 0 }), uniform(ni)),
      edge((u) => ({ x: u + t, r: 1 }), uniform(ni)),
      edge((v) => ({ x: t * v, r: v }), uniform(nj)),
      edge((v) => ({ x: 1 + t * v, r: v }), uniform(nj)),
    );
    const patches: Patch[] = [
      { block: 0, face: 'jmin', start: 0, end: ni, bc: BC.SLIP_WALL, label: 'wall' },
      { block: 0, face: 'jmax', start: 0, end: ni, bc: BC.FARFIELD, label: 'top' },
      { block: 0, face: 'imin', start: 0, end: nj, bc: BC.INFLOW, label: 'in' },
      { block: 0, face: 'imax', start: 0, end: nj, bc: BC.OUTFLOW, label: 'out' },
    ];
    const q = meshQuality({ blocks: [b], patches })[0];
    expect(q?.maxSkewDeg).toBeCloseTo(20, 9);
    expect(q?.wallOrthoMaxDeg).toBeCloseTo(20, 9);
    expect(q?.interfaceOrthoMaxDeg).toBe(0);
  });

  it('includes the stretching ratio across an interface', () => {
    // A has 0.1 m cells, B has 0.05 m cells in x at the shared face x = 0.3: ratio 2 across it
    const mesh = sideBySide();
    const q = meshQuality(mesh);
    expect(q[0]?.maxStretch).toBeCloseTo(1, 12);
    const B = mesh.blocks[1];
    if (B === undefined) throw new Error('no B');
    const fine = rectBlock('B', 0.3, 0.4, 0, 0.2, 2, 2);
    B.x.set(fine.x);
    // re-glue B's outflow side; only the interface matters for this check
    const q2 = meshQuality(mesh);
    expect(q2[0]?.maxStretch).toBeCloseTo(2, 12);
    expect(q2[1]?.maxStretch).toBeCloseTo(2, 12);
  });

  it('measures orthogonality and grid-line kinks at an interface', () => {
    const mesh = reversedPair();
    const q = meshQuality(mesh);
    expect(q[0]?.interfaceOrthoMaxDeg).toBeLessThan(1e-9);
    expect(q[0]?.interfaceKinkMaxDeg).toBeLessThan(1e-9);
    expect(q[1]?.interfaceOrthoMaxDeg).toBeLessThan(1e-9);
  });

  it('flags a kinked interface', () => {
    const patches: Patch[] = [];
    const A = rectBlock('A', 0, 1, 0, 1, 2, 2);
    const t = Math.tan((30 * Math.PI) / 180);
    const B = tfi(
      'B',
      edge((u) => ({ x: 1 + u, r: t * u }), uniform(2)),
      edge((u) => ({ x: 1 + u, r: 1 + t * u }), uniform(2)),
      edge((v) => ({ x: 1, r: v }), uniform(2)),
      edge((v) => ({ x: 2, r: t + v }), uniform(2)),
    );
    connect(
      patches,
      { block: 0, face: 'imax', start: 0, end: 2 },
      { block: 1, face: 'imin', start: 0, end: 2 },
      'A|B',
      false,
    );
    const q = meshQuality({ blocks: [A, B], patches });
    expect(q[0]?.interfaceKinkMaxDeg).toBeCloseTo(30, 9);
    expect(q[1]?.interfaceOrthoMaxDeg).toBeCloseTo(30, 9);
  });
});

/** Block from explicit node coordinate rows: node (i, j) at (xs[i], rs[j]) (axis-aligned). */
function gridBlock(name: string, xs: readonly number[], rs: readonly number[]): Block {
  const ni = xs.length - 1;
  const nj = rs.length - 1;
  const b: Block = {
    name,
    ni,
    nj,
    x: new Float64Array((ni + 1) * (nj + 1)),
    r: new Float64Array((ni + 1) * (nj + 1)),
  };
  for (let j = 0; j <= nj; j++) {
    for (let i = 0; i <= ni; i++) {
      b.x[nodeIndex(b, i, j)] = xs[i] ?? NaN;
      b.r[nodeIndex(b, i, j)] = rs[j] ?? NaN;
    }
  }
  return b;
}

/** Centre (mean of the four nodes) of cell (i, j), as meshQuality reports locations. */
function cellMean(b: Block, i: number, j: number): { x: number; r: number } {
  const ks = [
    nodeIndex(b, i, j),
    nodeIndex(b, i + 1, j),
    nodeIndex(b, i, j + 1),
    nodeIndex(b, i + 1, j + 1),
  ];
  return {
    x: 0.25 * ks.reduce((s, k) => s + (b.x[k] ?? NaN), 0),
    r: 0.25 * ks.reduce((s, k) => s + (b.r[k] ?? NaN), 0),
  };
}

/** Planar centroid and area of a simple polygon (shoelace), independent of blockGeometry. */
function polygonCentroid(px: readonly number[], pr: readonly number[]): [number, number, number] {
  let a = 0;
  let cx = 0;
  let cr = 0;
  for (let k = 0; k < px.length; k++) {
    const n = (k + 1) % px.length;
    const x0 = px[k] ?? NaN;
    const r0 = pr[k] ?? NaN;
    const x1 = px[n] ?? NaN;
    const r1 = pr[n] ?? NaN;
    const w = x0 * r1 - x1 * r0;
    a += w / 2;
    cx += ((x0 + x1) * w) / 6;
    cr += ((r0 + r1) * w) / 6;
  }
  return [cx / a, cr / a, a];
}

describe('blockGeometry centroids (W0M-I3)', () => {
  it('puts the cell centre at the planar centroid of an irregular quadrilateral', () => {
    // convex, non-symmetric quad P0 P1 P2 P3 (counter-clockwise) = nodes (0,0) (1,0) (1,1) (0,1)
    const px = [0.1, 2.0, 1.6, 0.4];
    const pr = [0.2, 0.35, 1.7, 1.1];
    const b: Block = {
      name: 'quad',
      ni: 1,
      nj: 1,
      x: Float64Array.from([px[0] ?? 0, px[1] ?? 0, px[3] ?? 0, px[2] ?? 0]),
      r: Float64Array.from([pr[0] ?? 0, pr[1] ?? 0, pr[3] ?? 0, pr[2] ?? 0]),
    };
    const g = blockGeometry(b);
    const [cx, cr, a] = polygonCentroid(px, pr);
    expect(g.area[0]).toBeCloseTo(a, 14);
    expect(g.centreX[0]).toBeCloseTo(cx, 14);
    expect(g.centreR[0]).toBeCloseTo(cr, 14);
    expect(g.volR[0]).toBeCloseTo(a * cr, 14);
    // the centroid is not the mean of the nodes for this shape
    expect(Math.abs(cx - 0.25 * (0.1 + 2.0 + 1.6 + 0.4))).toBeGreaterThan(1e-3);
  });

  it('gets every centroid of a curved, stretched block right, away from the origin', () => {
    const ni = 5;
    const nj = 4;
    const b = tfi(
      'curved',
      edge((u) => ({ x: 1 + 2 * u, r: 0.1 + 0.3 * u * (1 - u) }), geometric(ni, 0.08)),
      edge((u) => ({ x: 1 + 2 * u + 0.4 * u * (1 - u), r: 1 }), uniform(ni)),
      edge((v) => ({ x: 1 + 0.2 * v * (1 - v), r: 0.1 * (1 - v) + v }), geometric(nj, 0.1)),
      edge((v) => ({ x: 3, r: 0.1 * (1 - v) + v }), uniform(nj)),
    );
    const g = blockGeometry(b);
    for (let j = 0; j < nj; j++) {
      for (let i = 0; i < ni; i++) {
        const ks = [
          nodeIndex(b, i, j),
          nodeIndex(b, i + 1, j),
          nodeIndex(b, i + 1, j + 1),
          nodeIndex(b, i, j + 1),
        ];
        const [cx, cr, a] = polygonCentroid(
          ks.map((k) => b.x[k] ?? NaN),
          ks.map((k) => b.r[k] ?? NaN),
        );
        const c = j * ni + i;
        expect(Math.abs((g.centreX[c] ?? NaN) - cx)).toBeLessThan(1e-14);
        expect(Math.abs((g.centreR[c] ?? NaN) - cr)).toBeLessThan(1e-14);
        expect(Math.abs((g.area[c] ?? NaN) / a - 1)).toBeLessThan(1e-12);
      }
    }
  });
});

describe('meshQuality in-block measurements (W0M-I2)', () => {
  const only = (b: Block): BlockQuality => {
    const q = meshQuality({ blocks: [b], patches: [] })[0];
    if (q === undefined) throw new Error('no quality');
    return q;
  };

  it('measures an in-block stretching ratio along i, away from the last cell', () => {
    // i spacings 1, 1, q, q, q: the only non-unit ratio is q, between cells 1 and 2
    const q = 1.3;
    const b = gridBlock('si', [0, 1, 2, 2 + q, 2 + 2 * q, 2 + 3 * q], [0, 1, 2, 3]);
    const res = only(b);
    expect(res.maxStretch).toBeCloseTo(q, 12);
    expect(res.maxStretchAt.i).toBe(1);
    expect(res.maxStretchAt.j).toBe(0);
    expect(res.maxStretchAt.x).toBeCloseTo(cellMean(b, 1, 0).x, 14);
    expect(res.maxStretchAt.r).toBeCloseTo(cellMean(b, 1, 0).r, 14);
  });

  it('measures a shrinking in-block stretching ratio along j, away from the last cell', () => {
    // j spacings 1, 1, 1/q, 1/q: the ratio q is between cells 1 and 2 (shrinking)
    const q = 1.2;
    const b = gridBlock('sj', [0, 1, 2, 3], [0, 1, 2, 2 + 1 / q, 2 + 2 / q]);
    const res = only(b);
    expect(res.maxStretch).toBeCloseTo(q, 12);
    expect(res.maxStretchAt.i).toBe(0);
    expect(res.maxStretchAt.j).toBe(1);
    expect(res.maxStretchAt.x).toBeCloseTo(cellMean(b, 0, 1).x, 14);
    expect(res.maxStretchAt.r).toBeCloseTo(cellMean(b, 0, 1).r, 14);
  });

  it('reports the largest of several in-block ratios, not the last one measured', () => {
    // i ratios 1.3 then 1.05 (measured last along i); j ratio 1.1 (measured after all i ratios)
    const b = gridBlock('mix', [0, 1, 2.3, 2.3 + 1.365], [0, 1, 2.1]);
    const res = only(b);
    expect(res.maxStretch).toBeCloseTo(1.3, 12);
    expect(res.maxStretchAt.i).toBe(0);
  });

  it('measures the skew of one displaced interior node', () => {
    // moving node (3, 2) of a unit grid by d along x tilts the corners around it by atan(d)
    const d = 0.25;
    const b = gridBlock('skew', [0, 1, 2, 3, 4, 5, 6], [0, 1, 2, 3, 4]);
    b.x[nodeIndex(b, 3, 2)] = 3 + d;
    const res = only(b);
    expect(res.maxSkewDeg).toBeCloseTo((Math.atan(d) * 180) / Math.PI, 9);
    expect([2, 3]).toContain(res.maxSkewAt.i);
    expect([1, 2]).toContain(res.maxSkewAt.j);
    expect(res.maxSkewAt.x).toBeCloseTo(cellMean(b, res.maxSkewAt.i, res.maxSkewAt.j).x, 14);
    // sin of the worst corner angle (90 +- atan d)
    expect(res.minScaledJacobian).toBeCloseTo(1 / Math.hypot(1, d), 12);
  });

  it('measures the aspect ratio of wide and tall cells and says where the largest is', () => {
    // column 2 is 3 wide (aspect 3 in row 0); row 1 is 1.5 tall (aspect 1.5 in column 0)
    const b = gridBlock('ar', [0, 1, 2, 5, 6], [0, 1, 2.5]);
    const res = only(b);
    expect(res.aspectMax).toBeCloseTo(3, 12);
    expect(res.aspectMaxAt.i).toBe(2);
    expect(res.aspectMaxAt.j).toBe(0);
    expect(res.aspectMaxAt.r).toBeCloseTo(0.5, 14);
    expect(res.aspectMin).toBeCloseTo(1, 12);
    const tall = only(gridBlock('tall', [0, 1, 2], [0, 1, 4, 5]));
    expect(tall.aspectMax).toBeCloseTo(3, 12);
    expect(tall.aspectMaxAt.j).toBe(1);
  });

  it('includes the stretching ratio across a j-face interface', () => {
    // A = [0, 1] x [0, 1] with 0.5 m radial cells; B on top of it with 0.25 m radial cells
    const A = gridBlock('A', [0, 0.5, 1], [0, 0.5, 1]);
    const B = gridBlock('B', [0, 0.5, 1], [1, 1.25, 1.5]);
    const patches: Patch[] = [];
    connect(
      patches,
      { block: 0, face: 'jmax', start: 0, end: 2 },
      { block: 1, face: 'jmin', start: 0, end: 2 },
      'A|B',
      false,
    );
    const q = meshQuality({ blocks: [A, B], patches });
    expect(q[0]?.maxStretch).toBeCloseTo(2, 12);
    expect(q[0]?.maxStretchAt.j).toBe(1);
    expect(q[1]?.maxStretch).toBeCloseTo(2, 12);
    expect(q[1]?.maxStretchAt.j).toBe(0);
    // the radial grid lines run straight through the interface, square to it
    expect(q[0]?.interfaceKinkMaxDeg).toBeLessThan(1e-9);
    expect(q[1]?.interfaceKinkMaxDeg).toBeLessThan(1e-9);
    expect(q[1]?.interfaceOrthoMaxDeg).toBeLessThan(1e-9);
  });

  it('compares the cells along the line that crosses an i-face interface', () => {
    // A has 0.5 x 0.25 cells, B has 0.25 x 0.25: ratio 2 along x across x = 1, and 1 along r
    const A = gridBlock('A', [0, 0.5, 1], [0, 0.25, 0.5]);
    const B = gridBlock('B', [1, 1.25, 1.5], [0, 0.25, 0.5]);
    const patches: Patch[] = [];
    connect(
      patches,
      { block: 0, face: 'imax', start: 0, end: 2 },
      { block: 1, face: 'imin', start: 0, end: 2 },
      'A|B',
      false,
    );
    const q = meshQuality({ blocks: [A, B], patches });
    expect(q[0]?.maxStretch).toBeCloseTo(2, 12);
    expect(q[0]?.maxStretchAt.i).toBe(1);
    expect(q[1]?.maxStretch).toBeCloseTo(2, 12);
    expect(q[1]?.maxStretchAt.i).toBe(0);
  });

  it('compares radial cell sizes within one column, not across columns', () => {
    // node (i, j) at (i, j (1 + i / 2)): every column is uniform in j, but columns differ
    const ni = 4;
    const nj = 3;
    const b: Block = {
      name: 'fan-out',
      ni,
      nj,
      x: new Float64Array((ni + 1) * (nj + 1)),
      r: new Float64Array((ni + 1) * (nj + 1)),
    };
    for (let j = 0; j <= nj; j++) {
      for (let i = 0; i <= ni; i++) {
        b.x[nodeIndex(b, i, j)] = i;
        b.r[nodeIndex(b, i, j)] = j * (1 + i / 2);
      }
    }
    expect(only(b).maxStretch).toBeCloseTo(1, 12);
  });
});

describe('faceCellIJ', () => {
  it('maps a face cell and a depth to cell indices on every face', () => {
    const b = { ni: 5, nj: 3 };
    expect(faceCellIJ(b, 'imin', 2, 1)).toEqual([1, 2]);
    expect(faceCellIJ(b, 'imax', 2, 1)).toEqual([3, 2]);
    expect(faceCellIJ(b, 'jmin', 4, 0)).toEqual([4, 0]);
    expect(faceCellIJ(b, 'jmin', 4, 1)).toEqual([4, 1]);
    expect(faceCellIJ(b, 'jmax', 4, 0)).toEqual([4, 2]);
  });
});
