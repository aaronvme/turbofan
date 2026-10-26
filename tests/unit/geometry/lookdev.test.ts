// Look-dev round (w1/lookdev): every shipped quality preset is checked (W1G-I1), every part
// vertex is tested against every flow annulus (W1G-N1), the triangle budgets per preset, the
// closed-engine culling set (LD-6), the synthesized frames, struts and combustor liner (LD-4),
// and the exploded fan case clearing the fan (pass-3 LD-1 / exploded).

import { describe, expect, it } from 'vitest';
import {
  buildEngineGeometry,
  GEOMETRY_QUALITY,
  TRIANGLE_BUDGET,
  type EngineGeometry,
  type GeometryQuality,
} from '../../../src/geometry/engineGeometry';
import { meshTopology, type MeshData } from '../../../src/geometry/mesh';
import { loopAreaCentroid } from '../../../src/geometry/revolve';
import { isSimplePolygon } from '../../../src/geometry/airfoil';
import { explodeOffsets, INTAKE_LEAD } from '../../../src/geometry/explode';
import {
  closedViewLimits,
  closedViewVisibility,
  hiddenWhenClosed,
} from '../../../src/geometry/visibility';
import { ENGINE_DEFINITION as def } from '../../../src/engine/definition';

const PRESETS = Object.keys(GEOMETRY_QUALITY) as (keyof typeof GEOMETRY_QUALITY)[];
const built = new Map<string, EngineGeometry>();
const geoOf = (id: keyof typeof GEOMETRY_QUALITY): EngineGeometry => {
  let g = built.get(id);
  if (g === undefined) {
    g = buildEngineGeometry(def, GEOMETRY_QUALITY[id] as GeometryQuality);
    built.set(id, g);
  }
  return g;
};

function expectClosed(label: string, mesh: MeshData): void {
  const t = meshTopology(mesh);
  expect(
    {
      boundary: t.boundaryEdges,
      nonManifold: t.nonManifoldEdges,
      misoriented: t.misorientedEdges,
      degenerate: t.degenerateTriangles,
    },
    label,
  ).toEqual({ boundary: 0, nonManifold: 0, misoriented: 0, degenerate: 0 });
  expect(t.signedVolume, label).toBeGreaterThan(0);
}

const rowTriangles = (g: EngineGeometry['rows'][number]) =>
  (g.blade.mesh.indices.length / 3) * g.row.count;

describe.each(PRESETS)('quality preset %s (W1G-I1)', (id) => {
  it('every part, row and strut is watertight, manifold, outward and free of slivers', () => {
    const geo = geoOf(id);
    for (const p of geo.parts) expectClosed(`${id} part ${p.spec.id}`, p.mesh);
    for (const r of [...geo.rows, ...geo.struts])
      expectClosed(`${id} row ${r.row.id}`, r.blade.mesh);
  });

  it('every part loop is a simple counter-clockwise polygon', () => {
    for (const p of geoOf(id).parts) {
      expect(isSimplePolygon(p.spec.loop.map((q) => ({ m: q.x, t: q.r }))), p.spec.id).toBe(true);
      expect(loopAreaCentroid(p.spec.loop).area, p.spec.id).toBeGreaterThan(0);
    }
  });

  it('no structural part vertex lies inside a flow annulus (W1G-N1, every vertex)', () => {
    const geo = geoOf(id);
    const intrusions: string[] = [];
    for (const comp of def.flowpath.components) {
      const hub = geo.walls[comp.hub === 'coreCowl' ? 'coreCowl' : 'hub'];
      const cas = geo.walls[comp.casing === 'nacelleInner' ? 'nacelleInner' : 'coreOuter'];
      for (const p of geo.parts) {
        if (p.spec.decorative) continue;
        for (const v of p.spec.loop) {
          if (v.x <= comp.xStart || v.x >= comp.xEnd) continue;
          if (v.r > hub.radiusAt(v.x) + 1e-3 && v.r < cas.radiusAt(v.x) - 1e-3)
            intrusions.push(`${p.spec.id} (${v.x.toFixed(3)}, ${v.r.toFixed(3)}) in ${comp.id}`);
        }
      }
    }
    expect(intrusions).toEqual([]);
  });

  it('stays inside its triangle budget, in total and as the closed engine draws it', () => {
    const geo = geoOf(id);
    let total = 0;
    for (const p of geo.parts) total += p.mesh.indices.length / 3;
    for (const r of [...geo.rows, ...geo.struts]) total += rowTriangles(r);
    const vis = closedViewVisibility(def, geo);
    let closed = 0;
    for (const p of geo.parts) if (vis.parts.has(p.spec.id)) closed += p.mesh.indices.length / 3;
    for (const r of [...geo.rows, ...geo.struts])
      if (vis.rows.has(r.row.id)) closed += rowTriangles(r);
    expect(total).toBeLessThanOrEqual(TRIANGLE_BUDGET[id].total);
    expect(closed).toBeLessThanOrEqual(TRIANGLE_BUDGET[id].closed);
    // the culling is worth having: the closed engine draws well under half of the model
    expect(closed / total).toBeLessThan(0.45);
  });
});

describe('closed-engine culling (LD-6)', () => {
  const geo = geoOf('test');
  const vis = closedViewVisibility(def, geo);

  it('keeps what can be seen with the cowls on: nacelle, fan, OGVs, the booster inlet, the last LPT stage, the TRF, plug', () => {
    for (const id of [
      'inlet-lip',
      'nacelle-skin',
      'inlet-barrel',
      'fan-case',
      'nacelle-te',
      'splitter',
      'core-cowl-skin',
      'core-lip',
      'spinner',
      'fan-hub',
      'plug',
      'case-exhaust',
      'case-lpt',
    ])
      expect(vis.parts.has(id), id).toBe(true);
    for (const id of ['fan', 'fan-ogv', 'booster-igv', 'booster-r1', 'lpt-n4', 'lpt-r4', 'trf-strut'])
      expect(vis.rows.has(id), id).toBe(true);
  });

  it('drops what the cowls and the inner body hide: the core rows, cases, liner, disks and shafts', () => {
    for (const id of [
      'case-hpc',
      'case-combustor',
      'case-hpt',
      'combustor-liner',
      'hpc-drum',
      'lp-shaft',
      'hp-shaft',
      'disk-hpc-r5',
      'disk-fan',
      'disk-lpt-r4',
    ])
      expect(vis.parts.has(id), id).toBe(false);
    for (const id of ['hpc-r1', 'hpc-s9', 'hpt-n1', 'hpt-r1', 'lpt-r1', 'lpt-r3', 'fan-frame-strut'])
      expect(vis.rows.has(id), id).toBe(false);
  });

  it('hides only what lies fully inside the inner body, or inside the core cowl between the sight limits', () => {
    const lim = closedViewLimits(def);
    expect(lim.xFront).toBeGreaterThan(def.flowpath.components.find((c) => c.id === 'booster')?.xStart ?? 0);
    expect(lim.xRear).toBeLessThan(def.flowpath.components.find((c) => c.id === 'lpt')?.xEnd ?? 0);
    const w = geo.walls;
    // a point inside the inner body anywhere along the engine is hidden
    expect(hiddenWhenClosed([{ x: 0.1, r: 0.05 }], w, lim)).toBe(true);
    // on the hub surface itself: seen through the annulus
    expect(hiddenWhenClosed([{ x: 1.2, r: w.hub.radiusAt(1.2) }], w, lim)).toBe(false);
    // inside the core cowl between the limits: hidden; the same radius ahead of xFront: seen
    expect(hiddenWhenClosed([{ x: 1.2, r: w.coreOuter.radiusAt(1.2) }], w, lim)).toBe(true);
    expect(hiddenWhenClosed([{ x: lim.xFront - 0.01, r: 0.3 }], w, lim)).toBe(false);
    // one point outside the envelope makes the whole object visible
    expect(
      hiddenWhenClosed(
        [
          { x: 1.2, r: 0.28 },
          { x: 1.2, r: w.coreCowl.radiusAt(1.2) + 0.01 },
        ],
        w,
        lim,
      ),
    ).toBe(false);
  });
});

describe('synthesized structure (LD-4)', () => {
  const geo = geoOf('test');

  it('has a combustor liner with a dome inside the combustor annulus, marked decorative', () => {
    const liner = geo.parts.find((p) => p.spec.id === 'combustor-liner');
    expect(liner).toBeDefined();
    if (liner === undefined) return;
    expect(liner.spec.decorative).toBe(true);
    expect(liner.spec.module).toBe('combustor');
    const c = def.flowpath.components.find((k) => k.id === 'combustor');
    if (c === undefined) throw new Error('no combustor');
    for (const v of liner.spec.loop) {
      expect(v.x).toBeGreaterThan(c.xStart);
      expect(v.x).toBeLessThan(c.xEnd);
      expect(v.r).toBeGreaterThan(geo.walls.hub.radiusAt(v.x) + 1e-3);
      expect(v.r).toBeLessThan(geo.walls.coreOuter.radiusAt(v.x) - 1e-3);
    }
    // a dome: the liner's most forward point sits between its inner and outer walls
    const fwd = liner.spec.loop.reduce((a, b) => (b.x < a.x ? b : a));
    const rs = liner.spec.loop.map((v) => v.r);
    expect(fwd.r).toBeGreaterThan(Math.min(...rs) + 0.005);
    expect(fwd.r).toBeLessThan(Math.max(...rs) - 0.005);
  });

  it('has fan-frame and turbine-rear-frame struts spanning their annulus, behind the rows they follow', () => {
    const ff = geo.struts.find((s) => s.row.id === 'fan-frame-strut');
    const trf = geo.struts.find((s) => s.row.id === 'trf-strut');
    expect(ff?.module).toBe('transitionDuct');
    expect(trf?.module).toBe('exhaust');
    const lastBooster = def.bladeRows.filter((r) => r.component === 'booster').at(-1);
    const lastLpt = def.bladeRows.filter((r) => r.component === 'lpt').at(-1);
    expect(ff?.blade.xMin).toBeGreaterThan(lastBooster?.trailingEdge.hub.x ?? Infinity);
    expect(trf?.blade.xMin).toBeGreaterThan(lastLpt?.trailingEdge.tip.x ?? Infinity);
    for (const s of geo.struts) {
      expect(s.spool).toBeNull();
      expect(s.material).toBe('strut');
      expect(s.row.count).toBeGreaterThanOrEqual(8);
      expect(s.angles.length).toBe(s.row.count);
    }
  });
});

describe('exploded view: the fan shows (pass-3 LD-1)', () => {
  it('the fan case slides forward with the intake, clear of the fan blades', () => {
    const geo = geoOf('test');
    const fanCase = geo.parts.find((p) => p.spec.id === 'fan-case');
    const fan = geo.rows.find((r) => r.row.id === 'fan');
    if (fanCase === undefined || fan === undefined) throw new Error('missing fan or fan case');
    expect(fanCase.spec.module).toBe('inlet');
    const off = explodeOffsets(def, 1, 0.22);
    const xMax = Math.max(...fanCase.spec.loop.map((v) => v.x)) + off.inlet;
    expect(xMax).toBeLessThan(fan.blade.xMin + off.fan - 0.05);
    expect(INTAKE_LEAD).toBeGreaterThan(0);
    // closed: nothing moves
    expect(explodeOffsets(def, 0, 0.22).inlet).toBe(0);
  });
});
