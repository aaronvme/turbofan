// The mesh report: the numbers docs/MESH.md quotes, computed from a built engine mesh.
import { beforeAll, describe, expect, it } from 'vitest';
import { MESH_80K, buildEngineMesh, type EngineMesh } from '../../../tools/mesh/engineMesh';
import { placeholderFlowpath } from '../../../tools/mesh/geometry/placeholder';
import { meshQuality } from '../../../tools/mesh/metrics';
import { engineMeshReport, type EngineMeshReport } from '../../../tools/mesh/report';

describe('engineMeshReport', () => {
  let mesh: EngineMesh;
  let report: EngineMeshReport;
  beforeAll(() => {
    mesh = buildEngineMesh(placeholderFlowpath(), MESH_80K);
    report = engineMeshReport(mesh);
  });

  it('reports the total, the target and the per-block counts', () => {
    expect(report.spec).toBe('80k');
    expect(report.totalCells).toBe(mesh.totalCells);
    expect(report.targetCells).toBe(80_000);
    expect(report.deviation).toBeCloseTo(mesh.totalCells / 80_000 - 1, 12);
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
    expect(report.cellsAcross.lip).toBe(MESH_80K.nLip);
  });

  it('counts at least 4 cells per chord in every blade row, at mid-span', () => {
    const rows = placeholderFlowpath().bladeRows;
    expect(report.cellsPerChord.map((r) => r.name)).toEqual(rows.map((r) => r.name));
    for (const r of report.cellsPerChord) {
      expect(r.cells, r.name).toBeGreaterThanOrEqual(4);
      expect(r.chord).toBeGreaterThan(0);
    }
    // the HPC's last rotor and stator have the shortest chords (15 mm), so the fewest cells
    const hpc = report.cellsPerChord.filter((r) => r.name.startsWith('HPC'));
    const fan = report.cellsPerChord.find((r) => r.name === 'Fan rotor');
    expect(Math.min(...hpc.map((r) => r.cells))).toBeLessThan(fan?.cells ?? 0);
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
