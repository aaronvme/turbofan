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
import { MESH_SMOKE } from './fixtures';

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
  it('is 1 / (a_x / dx + a_r / dr) on the smallest cell, and says where', () => {
    const mesh = buildEngineMesh(flowpathFromDefinition(ENGINE_DEFINITION), MESH_SMOKE);
    // uniform speeds: the limit sits in the cell with the largest 1/dx + 1/dr
    const lim = explicitDtLimit(mesh, () => ({ ax: 700, ar: 500 }));
    expect(lim.dt).toBeGreaterThan(0);
    const b = mesh.blocks[mesh.index[lim.block as keyof typeof mesh.index]];
    expect(b).toBeDefined();
    // doubling every speed halves the limit, at the same cell
    const twice = explicitDtLimit(mesh, () => ({ ax: 1400, ar: 1000 }));
    expect(twice.dt).toBeCloseTo(lim.dt / 2, 15);
    expect(twice.at).toEqual(lim.at);
    // speeds that are zero everywhere except one block move the limit into that block
    const plug = explicitDtLimit(mesh, (_x, _r, name) =>
      name === 'plug' ? { ax: 700, ar: 500 } : { ax: 1e-6, ar: 1e-6 },
    );
    expect(plug.block).toBe('plug');
  });
});
