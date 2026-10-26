import { describe, expect, it } from 'vitest';
import { buildEngineGeometry, GEOMETRY_QUALITY } from '../../../src/geometry/engineGeometry';
import { meshTopology } from '../../../src/geometry/mesh';
import { loopAreaCentroid } from '../../../src/geometry/revolve';
import { isSimplePolygon } from '../../../src/geometry/airfoil';
import { ENGINE_DEFINITION as def } from '../../../src/engine/definition';
import { factValue } from '../../../src/engine/facts';

const geo = buildEngineGeometry(def, GEOMETRY_QUALITY.test);

describe('buildEngineGeometry', () => {
  it('one instanced row per definition row, at the definition counts (24 fan blades)', () => {
    expect(geo.rows.length).toBe(def.bladeRows.length);
    geo.rows.forEach((g, i) => {
      expect(g.row).toBe(def.bladeRows[i]);
      expect(g.angles.length).toBe(g.row.count);
    });
    const fan = geo.rows.find((g) => g.row.id === 'fan');
    expect(fan?.angles.length).toBe(factValue('fanBladeCount'));
    expect(fan?.spool).toBe('lp');
    expect(geo.rows.find((g) => g.row.id === 'hpc-r5')?.spool).toBe('hp');
    expect(geo.rows.find((g) => g.row.id === 'hpc-s5')?.spool).toBeNull();
  });

  it('every rotor turns with its spool and every row has a module and a material', () => {
    for (const g of geo.rows) {
      expect(g.module).toBe(g.row.component);
      expect(g.material.length).toBeGreaterThan(0);
      expect(g.spool).toBe(g.row.kind === 'rotor' ? g.row.spool : null);
    }
  });

  it.each(geo.parts.map((p) => [p.spec.id, p] as const))(
    '%s: a simple loop, revolved into a closed outward solid with a matching cap',
    (_id, p) => {
      const pts = p.spec.loop.map((q) => ({ m: q.x, t: q.r }));
      expect(isSimplePolygon(pts)).toBe(true);
      const { area } = loopAreaCentroid(p.spec.loop);
      expect(area).toBeGreaterThan(0); // counter-clockwise in (x, r)
      const t = meshTopology(p.mesh);
      expect(t.boundaryEdges).toBe(0);
      expect(t.nonManifoldEdges).toBe(0);
      expect(t.misorientedEdges).toBe(0);
      expect(t.signedVolume).toBeGreaterThan(0);
      for (const q of p.spec.loop) expect(q.r).toBeGreaterThanOrEqual(0);
      // the cap is the loop: its triangles cover exactly the loop area
      let capArea = 0;
      const c = p.cap;
      for (let k = 0; k < c.indices.length; k += 3) {
        const a = c.indices[k] ?? 0;
        const b = c.indices[k + 1] ?? 0;
        const d = c.indices[k + 2] ?? 0;
        const ax = c.positions[3 * a] ?? 0;
        const ar = c.positions[3 * a + 1] ?? 0;
        capArea +=
          (((c.positions[3 * b] ?? 0) - ax) * ((c.positions[3 * d + 1] ?? 0) - ar) -
            ((c.positions[3 * b + 1] ?? 0) - ar) * ((c.positions[3 * d] ?? 0) - ax)) /
          2;
      }
      expect(capArea / area).toBeCloseTo(1, 5);
    },
  );

  it('has the nacelle, the core cowl, the cases, the spinner, the plug, disks and shafts', () => {
    const ids = geo.parts.map((p) => p.spec.id);
    for (const id of [
      'inlet-lip',
      'nacelle-skin',
      'fan-case',
      'nacelle-te',
      'splitter',
      'core-cowl-skin',
      'case-hpc',
      'case-lpt',
      'spinner',
      'plug',
      'lp-shaft',
      'hp-shaft',
    ])
      expect(ids).toContain(id);
    expect(ids.filter((i) => i.startsWith('disk-')).length).toBe(
      def.bladeRows.filter((r) => r.kind === 'rotor').length,
    );
    expect(geo.parts.find((p) => p.spec.id === 'spinner')?.spec.spool).toBe('lp');
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('keeps every solid outside the flowpath annulus', () => {
    // sample each component's annulus mid-span: no part loop may contain that point
    const inside = (loop: readonly { x: number; r: number }[], x: number, r: number) => {
      let c = false;
      for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
        const a = loop[i];
        const b = loop[j];
        if (a === undefined || b === undefined) continue;
        if (a.r > r !== b.r > r && x < ((b.x - a.x) * (r - a.r)) / (b.r - a.r) + a.x) c = !c;
      }
      return c;
    };
    for (const comp of def.flowpath.components) {
      for (let k = 1; k < 10; k++) {
        const x = comp.xStart + ((comp.xEnd - comp.xStart) * k) / 10;
        const rh = geo.walls[comp.hub === 'coreCowl' ? 'coreCowl' : 'hub'].radiusAt(x);
        const casingId = comp.casing === 'nacelleInner' ? 'nacelleInner' : 'coreOuter';
        const rc = geo.walls[casingId].radiusAt(x);
        const rm = (rh + rc) / 2;
        for (const p of geo.parts)
          expect(inside(p.spec.loop, x, rm), `${p.spec.id} in ${comp.id}`).toBe(false);
      }
    }
  });

  it('is deterministic', () => {
    const again = buildEngineGeometry(def, GEOMETRY_QUALITY.test);
    expect(again.parts.map((p) => p.mesh.positions)).toEqual(
      geo.parts.map((p) => p.mesh.positions),
    );
    expect(again.rows.map((r) => r.blade.mesh.positions)).toEqual(
      geo.rows.map((r) => r.blade.mesh.positions),
    );
  });

  it('the high preset is finer than the test preset', () => {
    expect(GEOMETRY_QUALITY.high.fanBlade.sections).toBeGreaterThan(
      GEOMETRY_QUALITY.test.fanBlade.sections,
    );
    expect(GEOMETRY_QUALITY.high.segments).toBeGreaterThan(GEOMETRY_QUALITY.test.segments);
  });
});
