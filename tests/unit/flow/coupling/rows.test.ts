// Blade rows on the 130k mesh (CP1's row mapping and its blockage from the metal thickness).
import { describe, expect, it, vi } from 'vitest';
import { ENGINE_DEFINITION as DEF } from '../../../../src/engine/definition';
import {
  MIN_COS_KAMBER,
  camberAngle,
  chordFraction,
  meshRows,
  metalBlockage,
  rowBlockageField,
  spanFraction,
  spanValue,
  vsvCamberShift,
} from '../../../../src/flow/coupling/rows';
import { engineSolverMesh } from './engineMesh';

// the 130k mesh: each test walks every cell, a few seconds on a loaded laptop (vitest's default
// 5 s timed out under coverage)
vi.setConfig({ testTimeout: 120_000 });

const mesh = engineSolverMesh();
const rows = meshRows(mesh, DEF);

describe('the blade rows on the 130k mesh (CP1)', () => {
  it('maps every row of the definition onto its mesh zone', () => {
    expect(rows.map((r) => r.row.id)).toEqual(DEF.bladeRows.map((r) => r.id));
    for (const r of rows) expect(r.cells.length).toBeGreaterThan(0);
  });

  it("puts the zone's cells between the definition's edge lines and the neighbour columns outside", () => {
    for (const r of rows) {
      const zone = mesh.rows.find((z) => z.id === r.row.id);
      if (zone === undefined) throw new Error(r.row.id);
      const block = mesh.blocks[zone.block];
      if (block === undefined) throw new Error('block');
      for (let j = 0; j < block.nj; j++) {
        const at = (i: number) => {
          const c = block.cellOffset + j * block.ni + i;
          return chordFraction(r.row, mesh.cellX[c] ?? NaN, mesh.cellR[c] ?? NaN);
        };
        for (let i = zone.i0; i < zone.i1; i++) {
          expect(at(i)).toBeGreaterThan(0);
          expect(at(i)).toBeLessThan(1);
        }
        if (zone.i0 > 0) expect(at(zone.i0 - 1)).toBeLessThan(0);
        if (zone.i1 < block.ni) expect(at(zone.i1)).toBeGreaterThan(1);
      }
    }
  });

  it('interpolates the span values hub-mid-tip and the camber linearly along the chord', () => {
    const row = DEF.bladeRows[0];
    if (row === undefined) throw new Error('no row');
    const v = { hub: 1, mid: 3, tip: 4 };
    expect(spanValue(v, 0)).toBe(1);
    expect(spanValue(v, 0.25)).toBe(2);
    expect(spanValue(v, 0.5)).toBe(3);
    expect(spanValue(v, 1)).toBe(4);
    expect(spanValue(v, -1)).toBe(1);
    expect(spanValue(v, 2)).toBe(4);
    expect(camberAngle(row, 0, 0.5)).toBeCloseTo(row.inletMetalAngle.mid, 14);
    expect(camberAngle(row, 1, 0.5)).toBeCloseTo(row.exitMetalAngle.mid, 14);
    expect(camberAngle(row, 0.5, 0)).toBeCloseTo(
      0.5 * (row.inletMetalAngle.hub + row.exitMetalAngle.hub),
      14,
    );
    // the span fraction runs hub to tip at the leading edge
    expect(spanFraction(row, row.leadingEdge.hub.x, row.leadingEdge.hub.r)).toBeCloseTo(0, 12);
    expect(spanFraction(row, row.leadingEdge.tip.x, row.leadingEdge.tip.r)).toBeCloseTo(1, 12);
  });

  it("takes the blockage from the definition's metal thickness, 1 at both edges", () => {
    for (const r of rows) {
      const row = r.row;
      for (let k = 0; k < r.cells.length; k += 7) {
        const c = r.cells[k] ?? 0;
        const rc = mesh.cellR[c] ?? NaN;
        const xi = r.xi[k] ?? NaN;
        const eta = r.eta[k] ?? NaN;
        const kappa = camberAngle(row, xi, eta);
        // tangential metal thickness over the pitch: B t / (2 pi r |cos kappa|), t biconvex
        const t =
          4 * xi * (1 - xi) * spanValue(row.maxThicknessRatio, eta) * spanValue(row.chord, eta);
        const cos = Math.max(Math.abs(Math.cos(kappa)), MIN_COS_KAMBER);
        const expected = 1 - (row.count * t) / (2 * Math.PI * rc * cos);
        expect(r.blockage[k]).toBeCloseTo(expected, 12);
        expect(r.blockage[k]).toBeGreaterThan(0.5);
        expect(r.blockage[k]).toBeLessThanOrEqual(1);
      }
      expect(metalBlockage(row, 0, 0.5, 0.3, 0)).toBe(1);
      expect(metalBlockage(row, 1, 0.5, 0.3, 0)).toBe(1);
    }
    const b = rowBlockageField(mesh, rows);
    let inRows = 0;
    for (const r of rows) inRows += r.cells.length;
    let blocked = 0;
    for (let c = 0; c < mesh.nCells; c++) if ((b[c] ?? NaN) < 1) blocked++;
    expect(blocked).toBe(inRows);
    // the HPT nozzle guide vanes are the most blocked (thick, highly cambered)
    const ngv = rows.find((r) => r.row.id === 'hpt-n1');
    expect(Math.min(...(ngv?.blockage ?? []))).toBeLessThan(0.8);
  });

  it('shifts the variable stators by the rotation sign x the closure x the row gain, and nothing else', () => {
    for (const row of DEF.bladeRows) {
      const shift = vsvCamberShift(DEF, row, 0.3);
      if (row.vsv === null) expect(shift).toBe(0);
      else expect(shift).toBeCloseTo(DEF.rotation.hp * 0.3 * row.vsv.gain, 15);
    }
    expect(DEF.bladeRows.filter((r) => r.vsv !== null).length).toBe(4);
  });
});
