import { describe, expect, it } from 'vitest';
import type { FieldExtent } from '../../../../src/contracts/flow';
import { NO_CELL, buildResampleMap, locateCell } from '../../../../src/flow/gpu/resampleMap';
import { solverMeshFromFile } from '../../../../src/flow/reference/solverMesh';
import { meshFileFromMesh } from '../../../../tools/mesh/format';
import { BC, rectangle, singleBlock, threeBlockRow } from '../helpers';

// The texel -> (cells, weights, fluid fraction) map of the render resample: point location in the
// curvilinear multi-block mesh, cell-centred bilinear weights (planar near block corners), the
// fluid fraction from the texel's centre and corners, and "no cell" outside the fluid.
describe('resample map', () => {
  const box = singleBlock(rectangle('box', 0, 1, 0, 0.5, 10, 5), {
    imin: BC.SLIP_WALL,
    imax: BC.SLIP_WALL,
    jmin: BC.AXIS,
    jmax: BC.SLIP_WALL,
  });
  const file = meshFileFromMesh(box, 'f64');
  const mesh = solverMeshFromFile(file);
  const extent = (over: Partial<FieldExtent>): FieldExtent => ({
    id: 'near',
    width: 20,
    height: 10,
    xMin: 0,
    xMax: 1,
    rMin: 0,
    rMax: 0.5,
    ...over,
  });

  it('locates points in their cell with local coordinates', () => {
    const loc = locateCell(file, 0.25, 0.125);
    expect(loc).not.toBeNull();
    expect(loc?.cell).toBe(1 * 10 + 2);
    expect(loc?.xi).toBeCloseTo(0.5, 9);
    expect(loc?.eta).toBeCloseTo(0.25, 9);
    expect(locateCell(file, 1.5, 0.1)).toBeNull();
    expect(locateCell(file, 0.5, -0.1)).toBeNull();
  });

  it('weights sum to 1 and reproduce a linear field exactly away from the boundary', () => {
    const m = buildResampleMap(file, mesh, extent({}));
    expect(m.cells.length).toBe(4 * 20 * 10);
    const f = (c: number) => 3 * (mesh.cellX[c] ?? NaN) - 2 * (mesh.cellR[c] ?? NaN) + 1;
    for (let j = 0; j < 10; j++) {
      for (let i = 0; i < 20; i++) {
        const t = j * 20 + i;
        const w = [m.weights[4 * t], m.weights[4 * t + 1], m.weights[4 * t + 2]].map(Number);
        const w3 = 1 - (w[0] ?? 0) - (w[1] ?? 0) - (w[2] ?? 0);
        const ws = [...w, w3];
        expect(m.weights[4 * t + 3]).toBe(1); // fully fluid
        let v = 0;
        ws.forEach((wk, k) => {
          const c = m.cells[4 * t + k] ?? NO_CELL;
          if (wk !== 0) v += wk * f(c);
        });
        const x = (i + 0.5) / 20;
        const r = ((j + 0.5) / 10) * 0.5;
        // interior texels (between cell centres): exact; next to the boundary: constant extrapolation
        if (x > 0.05 && x < 0.95 && r > 0.025 && r < 0.475) {
          expect(v).toBeCloseTo(3 * x - 2 * r + 1, 5);
        }
        for (const wk of ws) expect(wk).toBeGreaterThanOrEqual(-1e-12);
      }
    }
  });

  it('gives texels outside the mesh no cell and fluid fraction 0, and partial texels a fraction', () => {
    const m = buildResampleMap(file, mesh, extent({ xMin: 0.95, xMax: 1.15, width: 4, height: 2 }));
    // texel 0 spans x 0.95-1.0 (fluid), texel 1 spans 1.0-1.05 (corners on x = 1 count), 2-3 outside
    expect(m.weights[3]).toBe(1);
    expect(m.weights[4 * 1 + 3]).toBeGreaterThan(0);
    expect(m.weights[4 * 1 + 3]).toBeLessThan(1);
    expect(m.cells[4 * 3]).toBe(NO_CELL);
    expect(m.weights[4 * 3 + 3]).toBe(0);
  });

  it('interpolates across a block interface through the neighbour block', () => {
    const row = threeBlockRow(
      1,
      1,
      8,
      6,
      {
        left: BC.SLIP_WALL,
        right: BC.SLIP_WALL,
        bottom: BC.AXIS,
        top: BC.SLIP_WALL,
      },
      0,
    );
    const rf = meshFileFromMesh(row, 'f64');
    const rm = solverMeshFromFile(rf);
    const m = buildResampleMap(
      rf,
      rm,
      extent({ xMin: 0, xMax: 3, rMin: 0, rMax: 1, width: 60, height: 20 }),
    );
    // a texel just left of x = 1 (block A's last column) draws on a block-B cell
    const i = Math.floor((1 - 0.01) * 20);
    const j = 10;
    const t = j * 60 + i;
    const cells = Array.from(m.cells.subarray(4 * t, 4 * t + 4));
    const blocks = cells
      .filter((c) => c !== NO_CELL)
      .map((c) => rm.blocks.findIndex((b) => c >= b.cellOffset && c < b.cellOffset + b.ni * b.nj));
    expect(new Set(blocks)).toEqual(new Set([0, 1]));
  });
});
