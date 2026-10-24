import { describe, expect, it } from 'vitest';
import { geometric, uniform, vinokur } from '../../../tools/mesh/distribution';
import { smoothMesh } from '../../../tools/mesh/smooth';
import { tfi, twoBoundary } from '../../../tools/mesh/tfi';
import {
  BC,
  nodeIndex,
  type Block,
  type MultiBlockMesh,
  type Patch,
  type Pt,
} from '../../../tools/mesh/types';

function edge(fn: (u: number) => Pt, t: ArrayLike<number>): Pt[] {
  return Array.from(t, (u) => fn(u));
}

function isBoundary(b: Block, k: number): boolean {
  const i = k % (b.ni + 1);
  const j = Math.floor(k / (b.ni + 1));
  return i === 0 || j === 0 || i === b.ni || j === b.nj;
}

/** Sum of squared second differences along both index directions (interior nodes). */
function roughness(b: Block): number {
  let sum = 0;
  for (let j = 1; j < b.nj; j++) {
    for (let i = 1; i < b.ni; i++) {
      const c = nodeIndex(b, i, j);
      const e = nodeIndex(b, i + 1, j);
      const w = nodeIndex(b, i - 1, j);
      const n = nodeIndex(b, i, j + 1);
      const s = nodeIndex(b, i, j - 1);
      const X = (k: number): number => b.x[k] ?? NaN;
      const R = (k: number): number => b.r[k] ?? NaN;
      sum += (X(e) - 2 * X(c) + X(w)) ** 2 + (R(e) - 2 * R(c) + R(w)) ** 2;
      sum += (X(n) - 2 * X(c) + X(s)) ** 2 + (R(n) - 2 * R(c) + R(s)) ** 2;
    }
  }
  return sum;
}

function curvedBlock(): Block {
  const ni = 30;
  const nj = 14;
  return tfi(
    'curved',
    edge((u) => ({ x: 2 * u, r: 0.3 + 0.4 * u * (1 - u) }), vinokur(ni, 0.01, 0.06)),
    edge((u) => ({ x: 2 * u, r: 1 + 0.2 * u * (1 - u) }), uniform(ni)),
    edge((v) => ({ x: 0, r: 0.3 * (1 - v) + v }), geometric(nj, 0.04)),
    edge((v) => ({ x: 2, r: 0.3 * (1 - v) + v }), uniform(nj)),
  );
}

describe('smoothMesh on a single block', () => {
  it('keeps every boundary node fixed (bitwise) while smoothing a distorted interior', () => {
    const b = curvedBlock();
    // Deterministic distortion of the interior nodes.
    for (let j = 1; j < b.nj; j++) {
      for (let i = 1; i < b.ni; i++) {
        const k = nodeIndex(b, i, j);
        b.x[k] = (b.x[k] ?? 0) + 0.02 * Math.sin(7 * i + 3 * j);
        b.r[k] = (b.r[k] ?? 0) + 0.01 * Math.cos(5 * i - 2 * j);
      }
    }
    const x0 = Float64Array.from(b.x);
    const r0 = Float64Array.from(b.r);
    const rough0 = roughness(b);
    const report = smoothMesh({ blocks: [b], patches: [] }, { sweeps: 300 });
    expect(report.sweeps).toBe(300);
    expect(report.freeNodes).toBe((b.ni - 1) * (b.nj - 1));
    expect(report.lastMaxMove).toBeLessThan(report.firstMaxMove);
    let moved = 0;
    for (let k = 0; k < b.x.length; k++) {
      if (isBoundary(b, k)) {
        expect(b.x[k]).toBe(x0[k]);
        expect(b.r[k]).toBe(r0[k]);
      } else if (b.x[k] !== x0[k] || b.r[k] !== r0[k]) {
        moved++;
      }
    }
    expect(moved).toBe((b.ni - 1) * (b.nj - 1));
    expect(roughness(b)).toBeLessThan(0.05 * rough0);
  });

  it('leaves a stretched tensor-product grid unchanged (control functions keep the clustering)', () => {
    const ni = 30;
    const nj = 12;
    const tx = geometric(ni, 0.01);
    const tr = vinokur(nj, 0.02, 0.2);
    const b = tfi(
      'rect',
      edge((u) => ({ x: 2 * u, r: 0.5 }), tx),
      edge((u) => ({ x: 2 * u, r: 1.5 }), tx),
      edge((v) => ({ x: 0, r: 0.5 * (1 - v) + 1.5 * v }), tr),
      edge((v) => ({ x: 2, r: 0.5 * (1 - v) + 1.5 * v }), tr),
    );
    const x0 = Float64Array.from(b.x);
    const r0 = Float64Array.from(b.r);
    smoothMesh({ blocks: [b], patches: [] }, { sweeps: 200 });
    let maxMove = 0;
    for (let k = 0; k < b.x.length; k++) {
      maxMove = Math.max(
        maxMove,
        Math.abs((b.x[k] ?? 0) - (x0[k] ?? 0)),
        Math.abs((b.r[k] ?? 0) - (r0[k] ?? 0)),
      );
    }
    // smallest spacing is 0.02 m; require the grid to stay put to 1e-9 of it
    expect(maxMove).toBeLessThan(2e-11);
  });

  it('keeps the analytic uniform annular duct', () => {
    const ni = 16;
    const nj = 8;
    const b = tfi(
      'annulus',
      edge((u) => ({ x: u, r: 0.25 }), uniform(ni)),
      edge((u) => ({ x: u, r: 0.4 }), uniform(ni)),
      edge((v) => ({ x: 0, r: 0.25 * (1 - v) + 0.4 * v }), uniform(nj)),
      edge((v) => ({ x: 1, r: 0.25 * (1 - v) + 0.4 * v }), uniform(nj)),
    );
    smoothMesh({ blocks: [b], patches: [] }, { sweeps: 100, control: 'none' });
    for (let j = 0; j <= nj; j++) {
      for (let i = 0; i <= ni; i++) {
        const k = nodeIndex(b, i, j);
        expect(Math.abs((b.x[k] ?? 0) - i / ni)).toBeLessThan(1e-13);
        expect(Math.abs((b.r[k] ?? 0) - (0.25 + (0.15 * j) / nj))).toBeLessThan(1e-13);
      }
    }
  });

  it('does nothing with zero sweeps', () => {
    const b = curvedBlock();
    const x0 = Float64Array.from(b.x);
    const report = smoothMesh({ blocks: [b], patches: [] }, { sweeps: 0 });
    expect(report.sweeps).toBe(0);
    expect(Array.from(b.x)).toEqual(Array.from(x0));
  });

  it('keeps a column-varying wall clustering only with initial-grid control (the C-block case)', () => {
    // Wall at r = 1, outer row at r = 1.5; first wall spacing 0.005 m mid-block, 0.04 m at the ends.
    const ni = 20;
    const nj = 10;
    const ds0 = (i: number): number => 0.01 + 0.07 * ((i - 10) / 10) ** 2;
    const build = (): Block =>
      twoBoundary(
        'lip',
        edge((u) => ({ x: 2 * u, r: 1 }), uniform(ni)),
        edge((u) => ({ x: 2 * u, r: 1.5 }), uniform(ni)),
        (i) => geometric(nj, ds0(i)),
      );
    const firstSpacingMid = (b: Block): number =>
      (b.r[nodeIndex(b, 10, 1)] ?? 0) - (b.r[nodeIndex(b, 10, 0)] ?? 0);
    const kept = build();
    smoothMesh(
      { blocks: [kept], patches: [] },
      { sweeps: 200, blockControl: { lip: { psi: 'initial-grid' } } },
    );
    expect(firstSpacingMid(kept) / 0.005).toBeGreaterThan(0.85);
    expect(firstSpacingMid(kept) / 0.005).toBeLessThan(1.15);
    const lost = build();
    smoothMesh({ blocks: [lost], patches: [] }, { sweeps: 200 });
    expect(firstSpacingMid(lost) / 0.005).toBeGreaterThan(2);
  });

  it('applies the none and initial-grid sources to both directions on request', () => {
    const a = curvedBlock();
    const b = curvedBlock();
    smoothMesh({ blocks: [a], patches: [] }, { sweeps: 50, control: 'none' });
    smoothMesh({ blocks: [b], patches: [] }, { sweeps: 50, control: 'initial-grid' });
    // pure Winslow pulls the clustered west-face distribution towards uniform; initial-grid keeps it
    const first = (blk: Block): number =>
      (blk.r[nodeIndex(blk, 1, 1)] ?? 0) - (blk.r[nodeIndex(blk, 1, 0)] ?? 0);
    expect(first(a)).toBeGreaterThan(first(b));
  });
});

/**
 * Two blocks on [0, 2] x [0, 1] meeting at an interface that starts bulged to x = 1 + 0.2 v(1-v).
 * Uniform boundary distributions, so pure Winslow (no control functions) drives it back to x = 1.
 */
function twoBlocks(floating: boolean): MultiBlockMesh {
  const n = 10;
  const iface = edge((v) => ({ x: 1 + 0.8 * v * (1 - v), r: v }), uniform(n));
  const A = tfi(
    'A',
    edge((u) => ({ x: u, r: 0 }), uniform(n)),
    edge((u) => ({ x: u, r: 1 }), uniform(n)),
    edge((v) => ({ x: 0, r: v }), uniform(n)),
    iface,
  );
  const B = tfi(
    'B',
    edge((u) => ({ x: 1 + u, r: 0 }), uniform(n)),
    edge((u) => ({ x: 1 + u, r: 1 }), uniform(n)),
    iface,
    edge((v) => ({ x: 2, r: v }), uniform(n)),
  );
  const patches: Patch[] = [
    {
      block: 0,
      face: 'imax',
      start: 0,
      end: n,
      bc: BC.INTERFACE,
      label: 'A|B',
      floating,
      nbr: { block: 1, face: 'imin', start: 0, end: n },
    },
    {
      block: 1,
      face: 'imin',
      start: 0,
      end: n,
      bc: BC.INTERFACE,
      label: 'B|A',
      floating,
      nbr: { block: 0, face: 'imax', start: 0, end: n },
    },
  ];
  return { blocks: [A, B], patches };
}

describe('smoothMesh across a floating interface', () => {
  it('moves the interface, keeps both copies bitwise equal and the physical boundary fixed', () => {
    const mesh = twoBlocks(true);
    const [A, B] = mesh.blocks as [Block, Block];
    const ax0 = Float64Array.from(A.x);
    const ar0 = Float64Array.from(A.r);
    const report = smoothMesh(mesh, { sweeps: 400, control: 'none' });
    // interior nodes of both blocks plus the 9 interior interface nodes, counted once
    expect(report.freeNodes).toBe(2 * 9 * 9 + 9);
    let maxBulge = 0;
    for (let j = 0; j <= A.nj; j++) {
      const ka = nodeIndex(A, A.ni, j);
      const kb = nodeIndex(B, 0, j);
      expect(A.x[ka]).toBe(B.x[kb]);
      expect(A.r[ka]).toBe(B.r[kb]);
      maxBulge = Math.max(maxBulge, Math.abs((A.x[ka] ?? 0) - 1));
    }
    expect(maxBulge).toBeLessThan(1e-3);
    for (let k = 0; k < A.x.length; k++) {
      const i = k % (A.ni + 1);
      if (isBoundary(A, k) && i !== A.ni) {
        expect(A.x[k]).toBe(ax0[k]);
        expect(A.r[k]).toBe(ar0[k]);
      }
    }
    // corners of the interface stay where they were
    expect(A.x[nodeIndex(A, A.ni, 0)]).toBe(1);
    expect(A.x[nodeIndex(A, A.ni, A.nj)]).toBe(1);
  });

  it('keeps a non-floating interface fixed, like any block boundary', () => {
    const mesh = twoBlocks(false);
    const [A] = mesh.blocks as [Block, Block];
    const ax0 = Float64Array.from(A.x);
    const report = smoothMesh(mesh, { sweeps: 50 });
    expect(report.freeNodes).toBe(2 * 9 * 9);
    for (let j = 0; j <= A.nj; j++) {
      const k = nodeIndex(A, A.ni, j);
      expect(A.x[k]).toBe(ax0[k]);
    }
  });

  it('can be told to hold every interface fixed', () => {
    const mesh = twoBlocks(true);
    const report = smoothMesh(mesh, { sweeps: 5, floatInterfaces: false });
    expect(report.freeNodes).toBe(2 * 9 * 9);
  });

  it('keeps the copies bitwise equal with initial-grid control functions too', () => {
    const mesh = twoBlocks(true);
    const [A, B] = mesh.blocks as [Block, Block];
    smoothMesh(mesh, { sweeps: 100 });
    for (let j = 0; j <= A.nj; j++) {
      expect(A.x[nodeIndex(A, A.ni, j)]).toBe(B.x[nodeIndex(B, 0, j)]);
      expect(A.r[nodeIndex(A, A.ni, j)]).toBe(B.r[nodeIndex(B, 0, j)]);
    }
  });
});
