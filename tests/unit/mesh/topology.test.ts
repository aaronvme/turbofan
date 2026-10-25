// Block-face helpers and the multi-block consistency check: every problem class validateMesh
// reports, on small hand-built meshes.
import { describe, expect, it } from 'vitest';
import {
  connect,
  faceNodeCount,
  faceNodeIJ,
  findPatch,
  inwardNodeIJ,
  mapIndex,
  partnerPatch,
  validateMesh,
} from '../../../tools/mesh/topology';
import { BC, nodeIndex, type MultiBlockMesh, type Patch } from '../../../tools/mesh/types';
import { rectBlock, reversedPair, sideBySide } from './fixtures';

/** A deep-enough copy that tests can break one mesh without touching the fixture. */
function copy(mesh: MultiBlockMesh): MultiBlockMesh {
  return {
    blocks: mesh.blocks.map((b) => ({
      ...b,
      x: Float64Array.from(b.x),
      r: Float64Array.from(b.r),
    })),
    patches: mesh.patches.map((p) => ({ ...p })),
  };
}

function withPatches(mesh: MultiBlockMesh, f: (p: Patch[]) => Patch[]): MultiBlockMesh {
  return { blocks: mesh.blocks, patches: f(mesh.patches.slice()) };
}

describe('face index helpers', () => {
  const b = { ni: 4, nj: 2 };

  it('walks every face', () => {
    expect(faceNodeCount(b, 'imin')).toBe(3);
    expect(faceNodeCount(b, 'jmax')).toBe(5);
    expect(faceNodeIJ(b, 'imin', 1)).toEqual([0, 1]);
    expect(faceNodeIJ(b, 'imax', 1)).toEqual([4, 1]);
    expect(faceNodeIJ(b, 'jmin', 3)).toEqual([3, 0]);
    expect(faceNodeIJ(b, 'jmax', 3)).toEqual([3, 2]);
    expect(inwardNodeIJ(b, 'imin', 1, 1)).toEqual([1, 1]);
    expect(inwardNodeIJ(b, 'imax', 1, 1)).toEqual([3, 1]);
    expect(inwardNodeIJ(b, 'jmin', 3, 1)).toEqual([3, 1]);
    expect(inwardNodeIJ(b, 'jmax', 3, 1)).toEqual([3, 1]);
  });

  it('maps interface indices forwards and backwards, and refuses non-interfaces', () => {
    const mesh = reversedPair();
    const p = findPatch(mesh.patches, 0, 'jmax', 1);
    expect(p?.nbr?.face).toBe('imin');
    expect(p === undefined ? NaN : mapIndex(p, 1)).toBe(3);
    const wall = findPatch(mesh.patches, 0, 'imin', 1);
    expect(wall).toBeDefined();
    expect(() => mapIndex(wall as Patch, 0)).toThrow(/not an interface/);
    expect(partnerPatch(mesh.patches, wall as Patch)).toBeUndefined();
    expect(partnerPatch(mesh.patches, p as Patch)?.block).toBe(1);
  });

  it('refuses to connect ranges of different lengths', () => {
    expect(() => {
      connect(
        [],
        { block: 0, face: 'imax', start: 0, end: 2 },
        { block: 1, face: 'imin', start: 0, end: 3 },
        'bad',
        false,
      );
    }).toThrow(/different lengths/);
  });
});

describe('validateMesh', () => {
  it('accepts the fixtures', () => {
    expect(validateMesh(sideBySide())).toEqual([]);
    expect(validateMesh(reversedPair())).toEqual([]);
  });

  it('reports node arrays of the wrong length', () => {
    const mesh = copy(sideBySide());
    const A = mesh.blocks[0];
    if (A === undefined) throw new Error('fixture');
    mesh.blocks[0] = { ...A, x: A.x.slice(1) };
    expect(validateMesh(mesh).join(' ')).toMatch(/node arrays have the wrong length/);
  });

  it('reports bad patch ranges and cells covered zero or two times', () => {
    const base = sideBySide();
    const bad = withPatches(base, (ps) => [
      ...ps,
      { block: 0, face: 'jmax', start: 2, end: 1, bc: BC.SLIP_WALL, label: 'backwards' },
    ]);
    expect(validateMesh(bad).join(' ')).toMatch(/bad patch range 2\.\.1/);
    const twice = withPatches(base, (ps) => [
      ...ps,
      { block: 0, face: 'jmax', start: 0, end: 1, bc: BC.SLIP_WALL, label: 'again' },
    ]);
    expect(validateMesh(twice)).toContain('A jmax: cell 0 covered 2 times');
    const none = withPatches(base, (ps) => ps.filter((p) => p.label !== 'wall'));
    expect(validateMesh(none)).toContain('A jmax: cell 0 covered 0 times');
  });

  it('reports patches on unknown blocks and non-interfaces with a neighbour', () => {
    const base = sideBySide();
    const unknown = withPatches(base, (ps) => [
      ...ps,
      { block: 7, face: 'imin', start: 0, end: 1, bc: BC.SLIP_WALL, label: 'ghost' },
    ]);
    expect(validateMesh(unknown)).toContain('patch ghost: unknown block 7');
    const nbr = withPatches(base, (ps) =>
      ps.map((p) =>
        p.label === 'wall' ? { ...p, nbr: { block: 1, face: 'jmax', start: 0, end: 3 } } : p,
      ),
    );
    expect(validateMesh(nbr)).toContain('A wall: non-interface patch has a neighbour');
  });

  it('reports axis nodes off the axis', () => {
    const mesh = copy(sideBySide());
    const A = mesh.blocks[0];
    if (A === undefined) throw new Error('fixture');
    A.r[nodeIndex(A, 1, 0)] = 1e-9;
    expect(validateMesh(mesh)).toContain('A axis: axis node 1 has r != 0');
  });

  it('reports unpaired interfaces, count and floating mismatches, and nodes that differ', () => {
    const base = sideBySide();
    const lonely = withPatches(base, (ps) =>
      ps.filter((p) => !(p.block === 1 && p.label === 'A|B')),
    );
    expect(validateMesh(lonely).join(' ')).toMatch(/interface has no partner patch/);
    // A's side still spans 2 cells but names a 1-cell partner range, which B's side matches
    const counts = withPatches(base, (ps) =>
      ps.map((p) => {
        if (p.label !== 'A|B' || p.nbr === undefined) return p;
        return p.block === 0 ? { ...p, nbr: { ...p.nbr, end: 1 } } : { ...p, end: 1 };
      }),
    );
    expect(validateMesh(counts).join(' ')).toMatch(/interface cell counts differ/);
    const floating = withPatches(base, (ps) =>
      ps.map((p) => (p.block === 0 && p.label === 'A|B' ? { ...p, floating: true } : p)),
    );
    expect(validateMesh(floating).join(' ')).toMatch(/floating flag differs from partner/);
    const moved = copy(base);
    const B = moved.blocks[1];
    if (B === undefined) throw new Error('fixture');
    B.x[nodeIndex(B, 0, 1)] = 0.3000001;
    expect(validateMesh(moved).join(' ')).toMatch(/node 1 does not match A bitwise/);
  });

  it('copes with a single isolated block', () => {
    const b = rectBlock('solo', 0, 1, 0, 1, 2, 2);
    const patches: Patch[] = (['imin', 'imax', 'jmin', 'jmax'] as const).map((face) => ({
      block: 0,
      face,
      start: 0,
      end: 2,
      bc: face === 'jmin' ? BC.AXIS : BC.FARFIELD,
      label: face,
    }));
    expect(validateMesh({ blocks: [b], patches })).toEqual([]);
  });
});
