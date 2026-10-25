// The full 12-block topology on the placeholder flowpath, at both production resolutions.
import { beforeAll, describe, expect, it } from 'vitest';
import { Polyline } from '../../../tools/mesh/curve';
import {
  BLOCK_NAMES,
  MESH_130K,
  MESH_80K,
  buildEngineMesh,
  type BlockName,
  type EngineMesh,
} from '../../../tools/mesh/engineMesh';
import { keyPoints, type FlowpathCurves } from '../../../tools/mesh/geometry/flowpath';
import { placeholderFlowpath } from '../../../tools/mesh/geometry/placeholder';
import { blockGeometry, meshQuality, type BlockQuality } from '../../../tools/mesh/metrics';
import { faceNodeIJ, mapIndex, validateMesh } from '../../../tools/mesh/topology';
import { BC, nodeIndex, type Block, type Face } from '../../../tools/mesh/types';

const geometry = placeholderFlowpath();
const kp = keyPoints(geometry);

const WALL_CURVES: Readonly<Record<string, keyof FlowpathCurves>> = {
  hub: 'hub',
  'core-outer': 'coreOuter',
  'core-cowl': 'coreCowl',
  'nacelle-inner': 'nacelleInner',
  'nacelle-outer': 'nacelleOuter',
};

function nodeAt(b: Block, i: number, j: number): { x: number; r: number } {
  const k = nodeIndex(b, i, j);
  return { x: b.x[k] ?? NaN, r: b.r[k] ?? NaN };
}

function dist(a: { x: number; r: number }, b: { x: number; r: number }): number {
  return Math.hypot(a.x - b.x, a.r - b.r);
}

/** Face vector (n * length) of face cell c on a block face, from blockGeometry. */
function faceVector(
  b: Block,
  g: ReturnType<typeof blockGeometry>,
  face: Face,
  c: number,
): [number, number] {
  if (face === 'imin' || face === 'imax') {
    const k = c * (b.ni + 1) + (face === 'imin' ? 0 : b.ni);
    return [g.iFaceNx[k] ?? NaN, g.iFaceNr[k] ?? NaN];
  }
  const k = (face === 'jmin' ? 0 : b.nj) * b.ni + c;
  return [g.jFaceNx[k] ?? NaN, g.jFaceNr[k] ?? NaN];
}

describe.each([MESH_130K, MESH_80K])('engine mesh $name', (spec) => {
  let mesh: EngineMesh;
  let quality: BlockQuality[];
  const block = (name: BlockName): Block => {
    const b = mesh.blocks[mesh.index[name]];
    if (b === undefined) throw new Error(`no block ${name}`);
    return b;
  };

  beforeAll(() => {
    mesh = buildEngineMesh(geometry, spec);
    quality = meshQuality(mesh);
  }, 120_000);

  it('has the 12 documented blocks', () => {
    expect(mesh.blocks.map((b) => b.name)).toEqual([...BLOCK_NAMES]);
  });

  it('is structurally valid: every face covered once, interfaces paired, axis at r = 0', () => {
    expect(validateMesh(mesh)).toEqual([]);
  });

  it('has a positive Jacobian at all four corners of every cell', () => {
    for (const q of quality) expect(q.minJacobian, q.name).toBeGreaterThan(0);
  });

  it('matches interface nodes bitwise across blocks', () => {
    let checked = 0;
    for (const p of mesh.patches) {
      if (p.bc !== BC.INTERFACE || p.nbr === undefined) continue;
      const a = mesh.blocks[p.block] as Block;
      const b = mesh.blocks[p.nbr.block] as Block;
      for (let k = p.start; k <= p.end; k++) {
        const [ia, ja] = faceNodeIJ(a, p.face, k);
        const [ib, jb] = faceNodeIJ(b, p.nbr.face, mapIndex(p, k));
        expect(a.x[nodeIndex(a, ia, ja)]).toBe(b.x[nodeIndex(b, ib, jb)]);
        expect(a.r[nodeIndex(a, ia, ja)]).toBe(b.r[nodeIndex(b, ib, jb)]);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(1000);
  });

  it('matches interface face vectors bitwise, so ghost exchange is exactly conservative', () => {
    // A max face against a min face: both normals point from one block into the other (equal).
    // Max against max or min against min: the normals point into each block (exactly negated).
    const isMax = (f: Face): boolean => f === 'imax' || f === 'jmax';
    const geo = mesh.blocks.map((b) => blockGeometry(b));
    for (const p of mesh.patches) {
      if (p.bc !== BC.INTERFACE || p.nbr === undefined) continue;
      const a = mesh.blocks[p.block] as Block;
      const b = mesh.blocks[p.nbr.block] as Block;
      const sign = isMax(p.face) !== isMax(p.nbr.face) ? 1 : -1;
      for (let c = p.start; c < p.end; c++) {
        const cb = Math.min(mapIndex(p, c), mapIndex(p, c + 1));
        const va = faceVector(a, geo[p.block] as ReturnType<typeof blockGeometry>, p.face, c);
        const vb = faceVector(
          b,
          geo[p.nbr.block] as ReturnType<typeof blockGeometry>,
          p.nbr.face,
          cb,
        );
        // === (not Object.is) so that +0 and -0 compare equal; IEEE negation is exact otherwise
        expect(va[0] === sign * vb[0] && va[1] === sign * vb[1]).toBe(true);
      }
    }
  });

  it('adds the per-block cell counts up to the reported total', () => {
    const sum = mesh.blocks.reduce((s, b) => s + b.ni * b.nj, 0);
    expect(sum).toBe(mesh.totalCells);
    expect(quality.reduce((s, q) => s + q.cells, 0)).toBe(mesh.totalCells);
  });

  it('lands within 5% of its target cell count', () => {
    expect(Math.abs(mesh.totalCells / spec.targetCells - 1)).toBeLessThan(0.05);
  });

  it('keeps the stretching ratio at or below 1.15 everywhere, including across interfaces', () => {
    for (const q of quality)
      expect(q.maxStretch, `${q.name} at ${JSON.stringify(q.maxStretchAt)}`).toBeLessThanOrEqual(
        1.15,
      );
  });

  it('has 16 cells across the core, 48 across the fan and 32 across the bypass', () => {
    expect(block('core').nj).toBe(16);
    expect(block('fan').nj).toBe(48);
    expect(block('bypass').nj).toBe(32);
    expect(block('afterbody').nj).toBe(32);
    expect(block('plume-bypass').nj).toBe(32);
    // and they really span hub to casing: j = 0 on one wall, j = nj on the other, every column
    const core = block('core');
    const hub = new Polyline(geometry.curves.hub);
    const outer = new Polyline(geometry.curves.coreOuter);
    for (let i = 0; i <= core.ni; i++) {
      expect(hub.distanceTo(nodeAt(core, i, 0))).toBeLessThan(1e-9);
      expect(outer.distanceTo(nodeAt(core, i, core.nj))).toBeLessThan(1e-9);
    }
  });

  it('has at least 4 cells per blade chord in every blade row', () => {
    const ductBlock = { fan: 'fan', bypass: 'bypass', core: 'core' } as const;
    for (const row of geometry.bladeRows) {
      const b = block(ductBlock[row.duct]);
      const j = Math.floor(b.nj / 2);
      let n = 0;
      for (let i = 0; i < b.ni; i++) {
        const xc =
          0.25 *
          (nodeAt(b, i, j).x +
            nodeAt(b, i + 1, j).x +
            nodeAt(b, i, j + 1).x +
            nodeAt(b, i + 1, j + 1).x);
        if (xc >= row.xLE && xc <= row.xTE) n++;
      }
      expect(n, row.name).toBeGreaterThanOrEqual(4);
    }
  });

  it('has 8-10 mm radial spacing at both nozzle lips', () => {
    const aft = block('afterbody');
    const outer = block('plume-outer');
    const plug = block('plug');
    const pb = block('plume-bypass');
    const spacings = {
      'bypass lip, inside': dist(nodeAt(aft, 0, aft.nj), nodeAt(aft, 0, aft.nj - 1)),
      'bypass lip, outside': dist(nodeAt(outer, 0, 0), nodeAt(outer, 0, 1)),
      'core lip, inside': dist(nodeAt(plug, 0, plug.nj), nodeAt(plug, 0, plug.nj - 1)),
      'core lip, outside': dist(nodeAt(pb, 0, 0), nodeAt(pb, 0, 1)),
    };
    for (const [where, h] of Object.entries(spacings)) {
      expect(h, where).toBeGreaterThanOrEqual(0.008);
      expect(h, where).toBeLessThanOrEqual(0.01);
    }
    // the lips are where the blocks say they are
    expect(nodeAt(aft, 0, aft.nj)).toEqual(kp.bypassLip);
    expect(nodeAt(pb, 0, 0)).toEqual(kp.coreLip);
  });

  it('extends at least 5 D upstream and radially and about 20 D downstream', () => {
    const D = geometry.fanTipDiameter;
    let xMin = Infinity;
    let xMax = -Infinity;
    let rMax = -Infinity;
    for (const b of mesh.blocks) {
      for (let k = 0; k < b.x.length; k++) {
        xMin = Math.min(xMin, b.x[k] ?? 0);
        xMax = Math.max(xMax, b.x[k] ?? 0);
        rMax = Math.max(rMax, b.r[k] ?? 0);
      }
    }
    expect(xMin).toBe(mesh.domain.xIn);
    expect(xMax).toBe(mesh.domain.xOut);
    expect(rMax).toBe(mesh.domain.rOut);
    expect(kp.highlight.x - xMin).toBeGreaterThanOrEqual(5 * D);
    expect(rMax).toBeGreaterThanOrEqual(5 * D);
    expect((xMax - kp.coreLip.x) / D).toBeGreaterThanOrEqual(20);
    expect((xMax - kp.coreLip.x) / D).toBeLessThan(21);
  });

  it('keeps every wall node on its geometry curve', () => {
    const curves = Object.fromEntries(
      Object.entries(WALL_CURVES).map(([label, key]) => [
        label,
        new Polyline(geometry.curves[key]),
      ]),
    );
    let walls = 0;
    for (const p of mesh.patches) {
      if (p.bc !== BC.SLIP_WALL) continue;
      const curve = curves[p.label];
      expect(curve, p.label).toBeDefined();
      if (curve === undefined) continue;
      const b = mesh.blocks[p.block] as Block;
      for (let k = p.start; k <= p.end; k++) {
        const [i, j] = faceNodeIJ(b, p.face, k);
        expect(curve.distanceTo(nodeAt(b, i, j))).toBeLessThan(1e-9);
        walls++;
      }
    }
    expect(walls).toBeGreaterThan(500);
  });

  it('puts the station planes exactly where the geometry puts them', () => {
    const fan = block('fan');
    for (let j = 0; j <= fan.nj; j++) expect(nodeAt(fan, 0, j).x).toBe(0);
    for (let j = 0; j <= fan.nj; j++) expect(nodeAt(fan, fan.ni, j).x).toBe(kp.splitter.x);
    const aft = block('afterbody');
    for (let j = 0; j <= aft.nj; j++) expect(nodeAt(aft, 0, j).x).toBe(kp.bypassLip.x);
    const plug = block('plug');
    for (let j = 0; j <= plug.nj; j++) expect(nodeAt(plug, 0, j).x).toBe(kp.coreLip.x);
  });
});
