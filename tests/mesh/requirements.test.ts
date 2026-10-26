// The production meshes on the real EngineDefinition: every requirement in docs/MESH.md, at both
// resolutions (130k production, 80k fallback). Run by `npm run test:mesh`.
import { beforeAll, describe, expect, it } from 'vitest';
import { SOLVER_REDUCTION_STATIONS } from '../../src/contracts/stations';
import { ENGINE_DEFINITION } from '../../src/engine/definition';
import { Polyline } from '../../tools/mesh/curve';
import {
  BLOCK_NAMES,
  MESH_130K,
  MESH_80K,
  buildEngineMesh,
  type BlockName,
  type EngineMesh,
} from '../../tools/mesh/engineMesh';
import { flowpathFromDefinition } from '../../tools/mesh/geometry/definition';
import { keyPoints, type CutLine, type FlowpathCurves } from '../../tools/mesh/geometry/flowpath';
import { blockGeometry, meshQuality, type BlockQuality } from '../../tools/mesh/metrics';
import { faceNodeIJ, mapIndex, validateMesh } from '../../tools/mesh/topology';
import { BC, nodeIndex, type Block, type Face, type Pt } from '../../tools/mesh/types';

const geometry = flowpathFromDefinition(ENGINE_DEFINITION);
const kp = keyPoints(geometry);

const WALL_CURVES: Readonly<Record<string, keyof FlowpathCurves>> = {
  hub: 'hub',
  'core-outer': 'coreOuter',
  'core-cowl': 'coreCowl',
  'nacelle-inner': 'nacelleInner',
  'nacelle-outer': 'nacelleOuter',
};
const DUCT_WALLS = {
  fan: ['hub', 'nacelleInner'],
  bypass: ['coreCowl', 'nacelleInner'],
  core: ['hub', 'coreOuter'],
} as const;

function nodeAt(b: Block, i: number, j: number): Pt {
  const k = nodeIndex(b, i, j);
  return { x: b.x[k] ?? NaN, r: b.r[k] ?? NaN };
}

const dist = (a: Pt, b: Pt): number => Math.hypot(a.x - b.x, a.r - b.r);

/** Signed distance of p from the straight line through a cut (positive downstream). */
function side(c: CutLine, p: Pt): number {
  const tx = c.tip.x - c.hub.x;
  const tr = c.tip.r - c.hub.r;
  return (tr * -(p.x - c.hub.x) + tx * (p.r - c.hub.r)) / -Math.hypot(tx, tr);
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

describe.each([MESH_130K, MESH_80K])('production mesh $name on the EngineDefinition', (spec) => {
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
  });

  it('has the 12 documented blocks and is structurally valid', () => {
    expect(mesh.blocks.map((b) => b.name)).toEqual([...BLOCK_NAMES]);
    expect(validateMesh(mesh)).toEqual([]);
  });

  it('has a positive Jacobian at all four corners of every cell', () => {
    for (const q of quality) expect(q.minJacobian, q.name).toBeGreaterThan(0);
  });

  it('matches interface nodes and face vectors bitwise across blocks', () => {
    const isMax = (f: Face): boolean => f === 'imax' || f === 'jmax';
    const geo = mesh.blocks.map((b) => blockGeometry(b));
    let nodes = 0;
    for (const p of mesh.patches) {
      if (p.bc !== BC.INTERFACE || p.nbr === undefined) continue;
      const a = mesh.blocks[p.block] as Block;
      const b = mesh.blocks[p.nbr.block] as Block;
      for (let k = p.start; k <= p.end; k++) {
        const [ia, ja] = faceNodeIJ(a, p.face, k);
        const [ib, jb] = faceNodeIJ(b, p.nbr.face, mapIndex(p, k));
        expect(nodeAt(a, ia, ja)).toEqual(nodeAt(b, ib, jb));
        nodes++;
      }
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
        // === so that +0 and -0 compare equal; IEEE negation is exact otherwise
        expect(va[0] === sign * vb[0] && va[1] === sign * vb[1]).toBe(true);
      }
    }
    expect(nodes).toBeGreaterThan(1000);
  });

  it('lands within 5% of its target cell count', () => {
    expect(mesh.blocks.reduce((s, b) => s + b.ni * b.nj, 0)).toBe(mesh.totalCells);
    expect(Math.abs(mesh.totalCells / spec.targetCells - 1)).toBeLessThan(0.05);
  });

  it('keeps the stretching ratio at or below 1.15 everywhere, including across interfaces', () => {
    for (const q of quality)
      expect(q.maxStretch, `${q.name} at ${JSON.stringify(q.maxStretchAt)}`).toBeLessThanOrEqual(
        1.15,
      );
  });

  it('keeps the stretching ratio at or below 1.15 at the plug tip (45 degree cone)', () => {
    for (const name of ['plug', 'plume-core'] as const) {
      const q = quality[mesh.index[name]];
      expect(q?.maxStretch, name).toBeLessThanOrEqual(1.15);
    }
  });

  it('has 16 cells across the core, 48 across the fan and 32 across the bypass, wall to wall', () => {
    expect(block('core').nj).toBe(16);
    expect(block('fan').nj).toBe(48);
    expect(block('bypass').nj).toBe(32);
    expect(block('afterbody').nj).toBe(32);
    expect(block('plume-bypass').nj).toBe(32);
    for (const duct of ['fan', 'bypass', 'core'] as const) {
      const b = block(duct);
      const [inner, outer] = DUCT_WALLS[duct].map((c) => new Polyline(geometry.curves[c])) as [
        Polyline,
        Polyline,
      ];
      for (let i = 0; i <= b.ni; i++) {
        expect(inner.distanceTo(nodeAt(b, i, 0)), `${duct} ${i}`).toBeLessThan(1e-9);
        expect(outer.distanceTo(nodeAt(b, i, b.nj)), `${duct} ${i}`).toBeLessThan(1e-9);
      }
    }
  });

  it('has at least 4 cells per chord in every blade row of the definition', () => {
    expect(mesh.rows.map((r) => r.id)).toEqual(ENGINE_DEFINITION.bladeRows.map((r) => r.id));
    for (const row of geometry.bladeRows) {
      // independent count: cell centres between the leading and trailing edge at mid-span
      const b = block(row.duct);
      const j = Math.floor(b.nj / 2);
      let n = 0;
      for (let i = 0; i < b.ni; i++) {
        const c = {
          x:
            0.25 *
            (nodeAt(b, i, j).x +
              nodeAt(b, i + 1, j).x +
              nodeAt(b, i, j + 1).x +
              nodeAt(b, i + 1, j + 1).x),
          r:
            0.25 *
            (nodeAt(b, i, j).r +
              nodeAt(b, i + 1, j).r +
              nodeAt(b, i, j + 1).r +
              nodeAt(b, i + 1, j + 1).r),
        };
        if (side(row.le, c) > 0 && side(row.te, c) < 0) n++;
      }
      expect(n, row.name).toBeGreaterThanOrEqual(4);
      const zone = mesh.rows.find((z) => z.id === row.name);
      expect(zone && zone.i1 - zone.i0, row.name).toBe(n);
    }
  });

  it('puts every blade edge on a grid line, so each body-force zone is whole cells', () => {
    for (const row of geometry.bladeRows) {
      const zone = mesh.rows.find((z) => z.id === row.name);
      if (zone === undefined) throw new Error(`no zone for ${row.name}`);
      expect(zone.block).toBe(row.duct);
      const b = block(zone.block);
      for (const [i, edge] of [
        [zone.i0, row.le],
        [zone.i1, row.te],
      ] as const) {
        expect(nodeAt(b, i, 0)).toEqual(edge.hub);
        expect(nodeAt(b, i, b.nj)).toEqual(edge.tip);
        for (let j = 0; j <= b.nj; j++) {
          expect(Math.abs(side(edge, nodeAt(b, i, j))), `${row.name} ${i},${j}`).toBeLessThan(
            1e-12,
          );
        }
      }
      // whole cells: every cell of the zone lies between the edges, its neighbours outside
      for (let j = 0; j < b.nj; j++) {
        const centre = (i: number): Pt => ({
          x:
            0.25 *
            (nodeAt(b, i, j).x +
              nodeAt(b, i + 1, j).x +
              nodeAt(b, i, j + 1).x +
              nodeAt(b, i + 1, j + 1).x),
          r:
            0.25 *
            (nodeAt(b, i, j).r +
              nodeAt(b, i + 1, j).r +
              nodeAt(b, i, j + 1).r +
              nodeAt(b, i + 1, j + 1).r),
        });
        for (let i = zone.i0; i < zone.i1; i++) {
          expect(side(row.le, centre(i))).toBeGreaterThan(0);
          expect(side(row.te, centre(i))).toBeLessThan(0);
        }
        if (zone.i0 > 0) expect(side(row.le, centre(zone.i0 - 1))).toBeLessThan(0);
        if (zone.i1 < b.ni) expect(side(row.te, centre(zone.i1))).toBeGreaterThan(0);
      }
    }
  });

  it('puts every reduction station on an exact radial grid line (station map)', () => {
    const want = [...SOLVER_REDUCTION_STATIONS, '49.5'];
    expect(mesh.stations.map((s) => s.id).sort()).toEqual([...want].sort());
    for (const s of mesh.stations) {
      const def = ENGINE_DEFINITION.stations.find((d) => d.id === s.id);
      expect(s.x, s.id).toBe(def?.x);
      const b = block(s.block);
      for (let j = 0; j <= b.nj; j++) expect(nodeAt(b, s.i, j).x, `${s.id} j=${j}`).toBe(s.x);
      const [inner, outer] = DUCT_WALLS[s.block].map((c) => new Polyline(geometry.curves[c])) as [
        Polyline,
        Polyline,
      ];
      expect(nodeAt(b, s.i, 0).r).toBe(inner.atX(s.x).r);
      expect(nodeAt(b, s.i, b.nj).r).toBe(outer.atX(s.x).r);
    }
    // the fan face, the bypass-nozzle exit and the core-nozzle exit are the duct block ends
    const at = (id: string) => mesh.stations.find((s) => s.id === id);
    expect(at('2')).toMatchObject({ block: 'fan', i: 0 });
    expect(at('18')).toMatchObject({ block: 'bypass', i: block('bypass').ni });
    expect(at('8')).toMatchObject({ block: 'core', i: block('core').ni });
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
    expect([xMin, xMax, rMax]).toEqual([mesh.domain.xIn, mesh.domain.xOut, mesh.domain.rOut]);
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
});
