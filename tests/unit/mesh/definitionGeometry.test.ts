// The adapter from the real EngineDefinition to the mesher's named curves (W0M-I1, D1-4).
import { describe, expect, it } from 'vitest';
import { radiusAt, type Polyline as DefPolyline } from '../../../src/contracts/engine';
import { SOLVER_REDUCTION_STATIONS } from '../../../src/contracts/stations';
import { ENGINE_DEFINITION as def } from '../../../src/engine/definition';
import { Polyline } from '../../../tools/mesh/curve';
import {
  KNIFE_EDGE_LENGTH_FACTOR,
  flowpathFromDefinition,
  knifeEdge,
} from '../../../tools/mesh/geometry/definition';
import { keyPoints, validateFlowpath } from '../../../tools/mesh/geometry/flowpath';
import type { Pt } from '../../../tools/mesh/types';

const g = flowpathFromDefinition(def);
const curves = def.flowpath.curves;
const pts = (c: DefPolyline): Pt[] => c.points.map((p) => ({ x: p.x, r: p.r }));
const last = <T>(a: readonly T[]): T => a[a.length - 1] as T;

describe('flowpathFromDefinition', () => {
  it('is a valid mesher geometry', () => {
    expect(validateFlowpath(g)).toEqual([]);
  });

  it('runs the hub from the spinner nose through the core hub to the plug tip', () => {
    const hub = new Polyline(g.curves.hub);
    expect(g.curves.hub[0]).toEqual({ x: -0.42, r: 0 });
    expect(last(g.curves.hub)).toEqual(last(pts(curves.plug)));
    for (const id of ['spinner', 'coreInner', 'plug'] as const) {
      for (const p of curves[id].points) expect(hub.distanceTo(p), id).toBeLessThan(1e-12);
    }
  });

  it('keeps the duct-side lines that set the nozzle areas exactly as defined', () => {
    // A8 and A18 are sized on coreOuter and nacelleInner (D1-2): the closure must not move them
    expect(g.curves.coreOuter).toEqual(pts(curves.coreOuter));
    expect(g.curves.nacelleInner).toEqual(pts(curves.nacelleInner));
  });

  it('closes both blunt trailing edges into knife edges on the duct-side line', () => {
    const kp = keyPoints(g);
    expect(last(g.curves.coreCowl)).toEqual(kp.coreLip);
    expect(last(g.curves.nacelleOuter)).toEqual(kp.bypassLip);
    // the definition itself still has its true base thickness (rendering uses it)
    expect(last(curves.coreCowl.points).r - last(curves.coreOuter.points).r).toBeCloseTo(0.015, 12);
    expect(last(curves.nacelleOuter.points).r - last(curves.nacelleInner.points).r).toBeCloseTo(
      0.018,
      12,
    );
  });

  // Stated tolerance: the closure moves only the external line, only over the last
  // KNIFE_EDGE_LENGTH_FACTOR base thicknesses, inwards, by at most the base thickness.
  it.each([
    ['coreCowl', 'coreOuter'],
    ['nacelleOuter', 'nacelleInner'],
  ] as const)('closes %s within the stated tolerance of the true line', (outerId, innerId) => {
    const truth = curves[outerId];
    const closed = new Polyline(g.curves[outerId]);
    const xTE = last(truth.points).x;
    const base = last(truth.points).r - last(curves[innerId].points).r;
    const L = KNIFE_EDGE_LENGTH_FACTOR * base;
    const x0 = truth.points[0]?.x ?? 0;
    let maxDev = 0;
    for (let k = 0; k <= 4000; k++) {
      const x = x0 + ((xTE - x0) * k) / 4000;
      const dev = (radiusAt(truth, x) ?? NaN) - closed.atX(x).r;
      if (x <= xTE - L) expect(Math.abs(dev), `x = ${x}`).toBeLessThan(1e-12);
      else {
        expect(dev, `x = ${x}`).toBeGreaterThanOrEqual(-1e-12);
        expect(dev, `x = ${x}`).toBeLessThanOrEqual(base + 1e-12);
      }
      maxDev = Math.max(maxDev, dev);
    }
    expect(maxDev).toBeCloseTo(base, 9);
  });

  it('keeps every curve monotonic in x, the closed boattails falling and the edges thick', () => {
    for (const [name, c] of Object.entries(g.curves)) {
      for (let k = 1; k < c.length; k++) {
        expect((c[k] as Pt).x, `${name} point ${k}`).toBeGreaterThan((c[k - 1] as Pt).x);
      }
    }
    for (const [outerId, innerId] of [
      ['coreCowl', 'coreOuter'],
      ['nacelleOuter', 'nacelleInner'],
    ] as const) {
      const outer = g.curves[outerId];
      const inner = new Polyline(g.curves[innerId]);
      const xTE = last(outer).x;
      const L = KNIFE_EDGE_LENGTH_FACTOR * (last(curves[outerId].points).r - inner.atX(xTE).r);
      for (let k = 1; k < outer.length; k++) {
        const a = outer[k - 1] as Pt;
        const b = outer[k] as Pt;
        if (a.x < xTE - L) continue;
        // the definition's boattails fall all the way to the trailing edge; so must the closure
        expect(b.r, `${outerId} at x = ${b.x}`).toBeLessThan(a.r);
        if (b.x < xTE) expect(b.r - inner.atX(b.x).r).toBeGreaterThan(0);
      }
    }
  });

  it('carries every blade row with its duct, mid-span extent and wall-to-wall edges', () => {
    expect(g.bladeRows.map((r) => r.name)).toEqual(def.bladeRows.map((r) => r.id));
    const walls = {
      fan: [g.curves.hub, g.curves.nacelleInner],
      bypass: [g.curves.coreCowl, g.curves.nacelleInner],
      core: [g.curves.hub, g.curves.coreOuter],
    } as const;
    def.bladeRows.forEach((d, k) => {
      const row = g.bladeRows[k];
      if (row === undefined) throw new Error('missing row');
      const duct = d.component === 'fan' ? 'fan' : d.component === 'bypassDuct' ? 'bypass' : 'core';
      expect(row.duct, d.id).toBe(duct);
      expect(row.xLE).toBeCloseTo((d.leadingEdge.hub.x + d.leadingEdge.tip.x) / 2, 15);
      expect(row.xTE).toBeCloseTo((d.trailingEdge.hub.x + d.trailingEdge.tip.x) / 2, 15);
      const [inner, outer] = walls[duct].map((c) => new Polyline(c)) as [Polyline, Polyline];
      for (const [edge, truth] of [
        [row.le, d.leadingEdge],
        [row.te, d.trailingEdge],
      ] as const) {
        expect(inner.distanceTo(edge.hub), d.id).toBeLessThan(1e-12);
        expect(outer.distanceTo(edge.tip), d.id).toBeLessThan(1e-12);
        // the mesh edge is the definition's edge line, extended to the walls
        for (const p of [truth.hub, truth.tip]) {
          const cross =
            (edge.tip.x - edge.hub.x) * (p.r - edge.hub.r) -
            (edge.tip.r - edge.hub.r) * (p.x - edge.hub.x);
          expect(Math.abs(cross), d.id).toBeLessThan(1e-12);
        }
      }
    });
    // the fan rotor is swept: its edges lean downstream towards the tip
    const fan = g.bladeRows.find((r) => r.name === 'fan');
    expect((fan?.le.tip.x ?? 0) - (fan?.le.hub.x ?? 0)).toBeGreaterThan(0.01);
  });

  it('lists the solver reduction stations (and 49.5) at the defined planes', () => {
    const want = [...SOLVER_REDUCTION_STATIONS, '49.5'];
    expect(g.stations.map((s) => s.id).sort()).toEqual([...want].sort());
    for (const s of g.stations) {
      const d = def.stations.find((t) => t.id === s.id);
      expect(s.x, s.id).toBe(d?.x);
      const duct =
        d?.component === 'fan' ? 'fan' : d?.component === 'bypassDuct' ? 'bypass' : 'core';
      expect(s.duct, s.id).toBe(duct);
    }
  });

  it('takes the combustor extent and the fan tip diameter from the definition', () => {
    const comb = def.flowpath.components.find((c) => c.id === 'combustor');
    expect(g.combustor).toEqual({ xStart: comb?.xStart, xEnd: comb?.xEnd });
    // fan rotor tip radius = casing radius - tip clearance = fan diameter / 2 (ENGINE_FACTS)
    expect(g.fanTipDiameter).toBeCloseTo(1.5494, 12);
  });
});

describe('knifeEdge', () => {
  it('pulls the end of a line onto a target over a C1 ramp and leaves the rest alone', () => {
    const line: Pt[] = [
      { x: 0, r: 1 },
      { x: 1, r: 0.9 },
      { x: 2, r: 0.5 },
    ];
    const end = { x: 2, r: 0.4 };
    const out = knifeEdge(line, end, 0.5);
    expect(last(out)).toEqual(end);
    const p = new Polyline(out);
    expect(p.atX(1.5).r).toBeCloseTo(0.7, 15);
    // smoothstep ramp: u = 0.5 -> 0.5 of the 0.1 m base; u = 0.25 -> 0.15625
    expect(p.atX(1.75).r).toBeCloseTo(0.6 - 0.05, 3);
    expect(p.atX(1.625).r).toBeCloseTo(0.65 - 0.015625, 3);
  });

  it('rejects an end that is not at the line end x or that lies outside it', () => {
    const line: Pt[] = [
      { x: 0, r: 1 },
      { x: 2, r: 0.5 },
    ];
    expect(() => knifeEdge(line, { x: 1.9, r: 0.4 }, 0.5)).toThrow(/trailing edge/);
    expect(() => knifeEdge(line, { x: 2, r: 0.6 }, 0.5)).toThrow(/inside/);
    expect(() => knifeEdge(line, { x: 2, r: 0.4 }, 3)).toThrow(/closure length/);
  });
});
