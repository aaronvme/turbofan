// The mesh report: the numbers docs/MESH.md quotes, computed from a built engine mesh.
import { beforeAll, describe, expect, it } from 'vitest';
import { ENGINE_DEFINITION } from '../../../src/engine/definition';
import { buildEngineMesh, type EngineMesh } from '../../../tools/mesh/engineMesh';
import { flowpathFromDefinition } from '../../../tools/mesh/geometry/definition';
import { meshQuality } from '../../../tools/mesh/metrics';
import {
  engineMeshReport,
  explicitDtLimit,
  type EngineMeshReport,
} from '../../../tools/mesh/report';
import { MESH_SMOKE, rectBlock } from './fixtures';

describe('engineMeshReport', () => {
  let mesh: EngineMesh;
  let report: EngineMeshReport;
  beforeAll(() => {
    mesh = buildEngineMesh(flowpathFromDefinition(ENGINE_DEFINITION), MESH_SMOKE);
    report = engineMeshReport(mesh);
  });

  it('reports the total, the target and the per-block counts', () => {
    expect(report.spec).toBe('smoke');
    expect(report.totalCells).toBe(mesh.totalCells);
    expect(report.targetCells).toBe(MESH_SMOKE.targetCells);
    expect(report.deviation).toBeCloseTo(mesh.totalCells / MESH_SMOKE.targetCells - 1, 12);
    expect(report.blocks.map((b) => b.name)).toEqual(mesh.blocks.map((b) => b.name));
    expect(report.blocks.reduce((s, b) => s + b.cells, 0)).toBe(mesh.totalCells);
  });

  it('carries the per-block quality numbers of meshQuality', () => {
    const q = meshQuality(mesh);
    report.blocks.forEach((b, k) => {
      expect(b.maxStretch).toBe(q[k]?.maxStretch);
      expect(b.minJacobian).toBe(q[k]?.minJacobian);
      expect(b.maxSkewDeg).toBe(q[k]?.maxSkewDeg);
    });
  });

  it('picks the worst value of each metric over all blocks, with its block', () => {
    const q = meshQuality(mesh);
    const maxStretch = Math.max(...q.map((b) => b.maxStretch));
    expect(report.worst.maxStretch.value).toBe(maxStretch);
    expect(q.find((b) => b.name === report.worst.maxStretch.block)?.maxStretch).toBe(maxStretch);
    expect(report.worst.minJacobian.value).toBe(Math.min(...q.map((b) => b.minJacobian)));
    expect(report.worst.minEdge.value).toBe(Math.min(...q.map((b) => b.minEdge)));
    expect(report.worst.maxSkewDeg.value).toBe(Math.max(...q.map((b) => b.maxSkewDeg)));
    expect(report.worst.maxAspect.value).toBe(Math.max(...q.map((b) => b.aspectMax)));
  });

  it('counts the cells across each annulus', () => {
    expect(report.cellsAcross.fan).toBe(48);
    expect(report.cellsAcross.core).toBe(16);
    expect(report.cellsAcross.bypass).toBe(32);
    expect(report.cellsAcross.lip).toBe(MESH_SMOKE.nLip);
  });

  it('counts the cells of every blade row zone', () => {
    const rows = mesh.geometry.bladeRows;
    expect(report.cellsPerChord.map((r) => r.name)).toEqual(rows.map((r) => r.name));
    for (const r of report.cellsPerChord) {
      expect(r.cells, r.name).toBeGreaterThanOrEqual(4);
      expect(r.chord).toBeGreaterThan(0);
    }
    report.cellsPerChord.forEach((r) => {
      const z = mesh.rows.find((q) => q.id === r.name);
      expect(r.cells).toBe((z?.i1 ?? 0) - (z?.i0 ?? 0));
    });
  });

  it('reports the radial spacing at both nozzle lips, inside and outside', () => {
    for (const h of Object.values(report.lipSpacing)) {
      expect(h).toBeGreaterThanOrEqual(0.008);
      expect(h).toBeLessThanOrEqual(0.01);
    }
    expect(Object.keys(report.lipSpacing).sort()).toEqual([
      'bypassInside',
      'bypassOutside',
      'coreInside',
      'coreOutside',
    ]);
  });

  it('reports the domain extents in fan diameters', () => {
    expect(report.domain.upstreamD).toBeGreaterThanOrEqual(5);
    expect(report.domain.radialD).toBeGreaterThanOrEqual(5);
    expect(report.domain.downstreamD).toBeGreaterThanOrEqual(20);
    expect(report.domain.downstreamD).toBeLessThan(21);
  });
});

describe('explicitDtLimit', () => {
  it('is 1 / (a_x / dx + a_r / dr) on the limiting cell, and says where', () => {
    // 0.1 m x 0.05 m cells in A, 0.05 m x 0.05 m in B
    const A = rectBlock('A', 0, 1, 0, 0.5, 10, 10);
    const B = rectBlock('B', 1, 1.5, 0, 0.5, 10, 10);
    const uniform = explicitDtLimit({ blocks: [A, B] }, () => ({ ax: 700, ar: 500 }));
    expect(uniform.dt).toBeCloseTo(1 / (700 / 0.05 + 500 / 0.05), 15);
    expect(uniform.block).toBe('B');
    // every cell of B ties up to rounding: the location is somewhere in B
    expect(uniform.at.x).toBeGreaterThan(1);
    // speeds that vanish in B move the limit into A
    const onlyA = explicitDtLimit({ blocks: [A, B] }, (_x, _r, name) =>
      name === 'A' ? { ax: 700, ar: 500 } : { ax: 1e-9, ar: 1e-9 },
    );
    expect(onlyA.block).toBe('A');
    expect(onlyA.dt).toBeCloseTo(1 / (700 / 0.1 + 500 / 0.05), 15);
    // the speed field is sampled at the cell centre
    const seen: number[] = [];
    explicitDtLimit({ blocks: [A] }, (x) => {
      seen.push(x);
      return { ax: 1, ar: 1 };
    });
    expect(seen[0]).toBeCloseTo(0.05, 15);
  });
});
