import { describe, expect, it } from 'vitest';
import {
  loftBlade,
  rowProfileFamily,
  spanValue,
  type BladeOptions,
} from '../../../src/geometry/blade';
import { computeNormals, meshTopology } from '../../../src/geometry/mesh';
import { componentWalls, engineWalls } from '../../../src/geometry/walls';
import { instanceAngles, instanceMatrices, rowPhase } from '../../../src/geometry/rows';
import { ENGINE_DEFINITION as def } from '../../../src/engine/definition';
import type { BladeRow } from '../../../src/contracts/engine';

const walls = engineWalls(def, 8);
const COARSE: BladeOptions = { sections: 5, pointsPerSide: 9 };

function component(row: BladeRow) {
  const c = def.flowpath.components.find((k) => k.id === row.component);
  if (c === undefined) throw new Error(`no component ${row.component}`);
  return c;
}
const loft = (row: BladeRow, o: BladeOptions = COARSE) =>
  loftBlade(row, componentWalls(walls, component(row)), o);

type V3 = readonly [number, number, number];
const vec3 = (a: Float32Array, i: number): V3 => [a[i] ?? 0, a[i + 1] ?? 0, a[i + 2] ?? 0];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

function row(id: string): BladeRow {
  const r = def.bladeRows.find((k) => k.id === id);
  if (r === undefined) throw new Error(`no row ${id}`);
  return r;
}

describe('spanValue', () => {
  const v = { hub: 1, mid: 4, tip: 2 };
  it('reproduces hub, mid and tip and interpolates quadratically', () => {
    expect(spanValue(v, 0)).toBe(1);
    expect(spanValue(v, 0.5)).toBe(4);
    expect(spanValue(v, 1)).toBe(2);
    // the parabola through (0, 1), (0.5, 4), (1, 2): 1 + 11 eta - 10 eta^2
    expect(spanValue(v, 0.25)).toBeCloseTo(1 + 11 * 0.25 - 10 * 0.0625, 12);
  });
});

describe('rowProfileFamily', () => {
  it('DCA for the transonic fan, NACA 65 for other compressor rows, turbine profiles in the turbines', () => {
    expect(rowProfileFamily(row('fan'))).toBe('dca');
    expect(rowProfileFamily(row('fan-ogv'))).toBe('naca65');
    expect(rowProfileFamily(row('booster-r2'))).toBe('naca65');
    expect(rowProfileFamily(row('hpc-s9'))).toBe('naca65');
    expect(rowProfileFamily(row('hpt-n1'))).toBe('turbine');
    expect(rowProfileFamily(row('lpt-r4'))).toBe('turbine');
  });
});

describe('loftBlade on every row of the engine', () => {
  const lofts = def.bladeRows.map((r) => ({ row: r, blade: loft(r) }));

  it.each(lofts.map((l) => [l.row.id, l] as const))(
    '%s: watertight, outward, no degenerate triangles',
    (_id, l) => {
      const t = meshTopology(l.blade.mesh);
      expect(t.boundaryEdges).toBe(0);
      expect(t.nonManifoldEdges).toBe(0);
      expect(t.misorientedEdges).toBe(0);
      expect(t.degenerateTriangles).toBe(0);
      expect(t.signedVolume).toBeGreaterThan(0);
    },
  );

  it.each(lofts.map((l) => [l.row.id, l] as const))(
    '%s: inside its annulus, the tip clearance kept, hub section on the hub wall',
    (_id, { row: r, blade }) => {
      const { hub, casing } = componentWalls(walls, component(r));
      const p = blade.mesh.positions;
      const clearance = r.kind === 'rotor' ? r.tipClearance : 0;
      for (let v = 0; v < p.length / 3; v++) {
        const x = p[3 * v] ?? 0;
        const rr = Math.hypot(p[3 * v + 1] ?? 0, p[3 * v + 2] ?? 0);
        // float32 positions: 1e-6 m tolerance
        expect(rr).toBeGreaterThanOrEqual(hub.radiusAt(x) - 1e-6);
        expect(rr).toBeLessThanOrEqual(casing.radiusAt(x) - clearance + 1e-6);
      }
      for (const v of blade.hubRing) {
        const x = p[3 * v] ?? 0;
        expect(Math.hypot(p[3 * v + 1] ?? 0, p[3 * v + 2] ?? 0)).toBeCloseTo(hub.radiusAt(x), 5);
      }
      for (const v of blade.tipRing) {
        const x = p[3 * v] ?? 0;
        const gap = casing.radiusAt(x) - Math.hypot(p[3 * v + 1] ?? 0, p[3 * v + 2] ?? 0);
        expect(gap).toBeCloseTo(clearance, 5);
      }
    },
  );

  it('puts each section leading edge on the definition leading-edge line', () => {
    for (const { row: r, blade } of lofts) {
      const le = blade.leadingEdge;
      expect(le[0]?.x).toBeCloseTo(r.leadingEdge.hub.x, 6);
      expect(le[le.length - 1]?.x).toBeCloseTo(r.leadingEdge.tip.x, 6);
    }
  });

  it('vertex normals agree with the faces; tangents are unit and tangent to the surface', () => {
    for (const { blade } of lofts) {
      const m = blade.mesh;
      const face = computeNormals(m.positions, m.indices);
      for (let v = 0; v < m.positions.length / 3; v++) {
        const n = vec3(m.normals, 3 * v);
        const f = vec3(face, 3 * v);
        expect(dot(n, f)).toBeGreaterThan(0);
        const t = vec3(m.tangents, 4 * v);
        expect(Math.sqrt(dot(t, t))).toBeCloseTo(1, 4);
        expect(Math.abs(dot(t, n))).toBeLessThan(1e-3);
      }
      for (const u of m.uvs) {
        expect(u).toBeGreaterThanOrEqual(0);
        expect(u).toBeLessThanOrEqual(1);
      }
    }
  });

  it('reports an angular extent that bounds the vertices', () => {
    for (const { blade } of lofts) {
      const p = blade.mesh.positions;
      for (let v = 0; v < p.length / 3; v++) {
        const th = Math.atan2(p[3 * v + 2] ?? 0, p[3 * v + 1] ?? 0);
        expect(th).toBeGreaterThanOrEqual(blade.thetaMin - 1e-9);
        expect(th).toBeLessThanOrEqual(blade.thetaMax + 1e-9);
      }
      expect(blade.thetaMax - blade.thetaMin).toBeLessThan(Math.PI / 2);
    }
  });

  it('the fan blade is twisted: tip stagger well above the hub stagger', () => {
    const fan = lofts.find((l) => l.row.id === 'fan')?.blade;
    if (fan === undefined) throw new Error('no fan');
    const st = fan.sectionStagger;
    expect((st[st.length - 1] ?? 0) - (st[0] ?? 0)).toBeGreaterThan(0.3);
  });

  it('is deterministic, and finer options give more vertices', () => {
    const a = loft(row('fan'));
    const b = loft(row('fan'));
    expect(a.mesh.positions).toEqual(b.mesh.positions);
    expect(a.mesh.indices).toEqual(b.mesh.indices);
    const fine = loft(row('fan'), { sections: 9, pointsPerSide: 17 });
    expect(fine.mesh.positions.length).toBeGreaterThan(a.mesh.positions.length);
  });

  it('rejects too few sections or points', () => {
    expect(() => loft(row('fan'), { sections: 1, pointsPerSide: 9 })).toThrow();
    expect(() => loft(row('fan'), { sections: 3, pointsPerSide: 2 })).toThrow();
  });
});

describe('rows', () => {
  it('one instance per blade of the definition, evenly spaced from the phase', () => {
    for (const r of def.bladeRows) {
      const a = instanceAngles(r.count, 0.1);
      expect(a.length).toBe(r.count);
      expect(a[0]).toBeCloseTo(0.1, 12);
      for (let k = 1; k < a.length; k++) {
        expect((a[k] ?? 0) - (a[k - 1] ?? 0)).toBeCloseTo((2 * Math.PI) / r.count, 12);
      }
    }
    expect(def.bladeRows.find((r) => r.id === 'fan')?.count).toBe(24);
    expect(() => instanceAngles(0)).toThrow();
  });

  it('instance matrices are rotations about +x', () => {
    const angles = instanceAngles(4, 0);
    const m = instanceMatrices(angles);
    expect(m.length).toBe(64);
    // column-major: rotating +y by 90 degrees gives +z
    const k = 1;
    const y = [m[16 * k + 4], m[16 * k + 5], m[16 * k + 6]];
    expect(y[0]).toBeCloseTo(0, 6);
    expect(y[1]).toBeCloseTo(0, 6);
    expect(y[2]).toBeCloseTo(1, 6);
    expect(m[16 * k + 0]).toBe(1);
    expect(m[16 * k + 15]).toBe(1);
  });

  it('row phases are deterministic and distinct', () => {
    expect(rowPhase(3)).toBe(rowPhase(3));
    expect(rowPhase(3)).not.toBe(rowPhase(4));
    expect(rowPhase(0)).toBe(0);
  });
});
