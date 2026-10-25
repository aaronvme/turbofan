import { describe, expect, it } from 'vitest';
import { geometric, uniform } from '../../../tools/mesh/distribution';
import { blockGeometry, meshQuality } from '../../../tools/mesh/metrics';
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
