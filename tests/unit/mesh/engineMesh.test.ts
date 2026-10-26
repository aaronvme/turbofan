// The 12-block topology on the real EngineDefinition at a coarse smoke resolution: structure,
// matching, walls, station grid lines and blade-row zones. The production resolutions and the
// quality requirements are checked by the full-size suite (tests/mesh, `npm run test:mesh`).
import { beforeAll, describe, expect, it } from 'vitest';
import { ENGINE_DEFINITION } from '../../../src/engine/definition';
import { Polyline } from '../../../tools/mesh/curve';
import {
  BLOCK_NAMES,
  MESH_130K,
  MESH_80K,
  buildEngineMesh,
  smoothingOptions,
  type EngineMesh,
} from '../../../tools/mesh/engineMesh';
import { flowpathFromDefinition } from '../../../tools/mesh/geometry/definition';
import type { FlowpathCurves, FlowpathGeometry } from '../../../tools/mesh/geometry/flowpath';
import { meshQuality } from '../../../tools/mesh/metrics';
import { faceNodeIJ, mapIndex, validateMesh } from '../../../tools/mesh/topology';
import { BC, nodeIndex, type Block, type Pt } from '../../../tools/mesh/types';
import { MESH_SMOKE } from './fixtures';

const geometry = flowpathFromDefinition(ENGINE_DEFINITION);

function nodeAt(b: Block, i: number, j: number): Pt {
  const k = nodeIndex(b, i, j);
  return { x: b.x[k] ?? NaN, r: b.r[k] ?? NaN };
}

describe('engine mesh on the EngineDefinition (smoke resolution)', () => {
  let mesh: EngineMesh;
  beforeAll(() => {
    mesh = buildEngineMesh(geometry, MESH_SMOKE);
  });

  it('has the 12 documented blocks, structurally valid, with positive Jacobians', () => {
    expect(mesh.blocks.map((b) => b.name)).toEqual([...BLOCK_NAMES]);
    expect(validateMesh(mesh)).toEqual([]);
    for (const q of meshQuality(mesh)) expect(q.minJacobian, q.name).toBeGreaterThan(0);
    expect(mesh.totalCells).toBe(mesh.blocks.reduce((s, b) => s + b.ni * b.nj, 0));
    expect(Math.abs(mesh.totalCells / MESH_SMOKE.targetCells - 1)).toBeLessThan(0.05);
  });

  it('matches interface nodes bitwise', () => {
    for (const p of mesh.patches) {
      if (p.bc !== BC.INTERFACE || p.nbr === undefined) continue;
      const a = mesh.blocks[p.block] as Block;
      const b = mesh.blocks[p.nbr.block] as Block;
      for (let k = p.start; k <= p.end; k++) {
        const [ia, ja] = faceNodeIJ(a, p.face, k);
        const [ib, jb] = faceNodeIJ(b, p.nbr.face, mapIndex(p, k));
        expect(nodeAt(a, ia, ja)).toEqual(nodeAt(b, ib, jb));
      }
    }
  });

  it('keeps every wall node on its curve', () => {
    const curves: Readonly<Record<string, keyof FlowpathCurves>> = {
      hub: 'hub',
      'core-outer': 'coreOuter',
      'core-cowl': 'coreCowl',
      'nacelle-inner': 'nacelleInner',
      'nacelle-outer': 'nacelleOuter',
    };
    for (const p of mesh.patches) {
      if (p.bc !== BC.SLIP_WALL) continue;
      const key = curves[p.label];
      if (key === undefined) throw new Error(`unknown wall ${p.label}`);
      const curve = new Polyline(geometry.curves[key]);
      const b = mesh.blocks[p.block] as Block;
      for (let k = p.start; k <= p.end; k++) {
        const [i, j] = faceNodeIJ(b, p.face, k);
        expect(curve.distanceTo(nodeAt(b, i, j))).toBeLessThan(1e-9);
      }
    }
  });

  it('maps every station to an exact radial grid line and every row to whole cells', () => {
    expect(mesh.stations.map((s) => s.id)).toEqual(geometry.stations.map((s) => s.id));
    for (const s of mesh.stations) {
      const b = mesh.blocks[mesh.index[s.block]] as Block;
      for (let j = 0; j <= b.nj; j++) expect(nodeAt(b, s.i, j).x).toBe(s.x);
    }
    expect(mesh.rows.map((r) => r.id)).toEqual(geometry.bladeRows.map((r) => r.name));
    for (const z of mesh.rows) {
      const row = geometry.bladeRows.find((r) => r.name === z.id);
      const b = mesh.blocks[mesh.index[z.block]] as Block;
      expect(nodeAt(b, z.i0, 0)).toEqual(row?.le.hub);
      expect(nodeAt(b, z.i0, b.nj)).toEqual(row?.le.tip);
      expect(nodeAt(b, z.i1, 0)).toEqual(row?.te.hub);
      expect(nodeAt(b, z.i1, b.nj)).toEqual(row?.te.tip);
      expect(z.i1 - z.i0).toBeGreaterThanOrEqual(4);
    }
  });
});

describe('buildEngineMesh input checks and settings', () => {
  it('rejects an invalid flowpath and a C-block that leaves too few inlet cells', () => {
    const broken: FlowpathGeometry = {
      ...geometry,
      curves: { ...geometry.curves, hub: geometry.curves.hub.slice(1) },
    };
    expect(() => buildEngineMesh(broken, MESH_SMOKE)).toThrow(/invalid flowpath/);
    expect(() => buildEngineMesh(geometry, { ...MESH_SMOKE, nLip: 46 })).toThrow(/too few inlet/);
  });

  it('runs no smoothing in production (decision D0-6)', () => {
    expect(MESH_130K.sweeps).toBe(0);
    expect(MESH_80K.sweeps).toBe(0);
    expect(smoothingOptions(MESH_130K)).toMatchObject({ sweeps: 0, floatInterfaces: false });
  });
});
