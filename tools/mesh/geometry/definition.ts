// Adapter: the real EngineDefinition (src/contracts/engine.ts) -> the mesher's FlowpathGeometry
// (W0M-I1, decision D1-4).
//
// The solver geometry differs from the definition in one place only. The definition's nozzle lips
// have blunt bases (the core cowl is 15 mm thick at its trailing edge, the nacelle 18 mm), which
// the 12-block topology cannot wrap: it needs a knife edge at each lip. knifeEdge() closes each base
// onto the duct-side line with a C1 smoothstep ramp over KNIFE_EDGE_LENGTH_FACTOR base thicknesses.
// It moves only the external line, inwards, by at most the base thickness, and keeps the external
// line falling to the lip. The duct-side lines (coreOuter, nacelleInner) are untouched, so the
// nozzle exit areas A8/A18 the cycle is sized on (D1-2) are exactly the definition's. The
// definition itself keeps its true thickness; the 3D geometry renders that.
import type {
  ComponentId,
  EdgeLine,
  EngineDefinition,
  Polyline as DefPolyline,
} from '../../../src/contracts/engine';
import { SOLVER_REDUCTION_STATIONS } from '../../../src/contracts/stations';
import { smoothstep } from '../build';
import { Polyline } from '../curve';
import type { Pt } from '../types';
import type { BladeRow, CutLine, Duct, FlowpathGeometry, StationPlane } from './flowpath';

/** Closure length of a knife edge in base thicknesses (150 mm at the core lip, 180 mm at the fan lip). */
export const KNIFE_EDGE_LENGTH_FACTOR = 10;

/** Points per knife-edge ramp (the ramp is a cubic; 64 chords are far below the mesh spacing). */
const RAMP_SAMPLES = 64;

const last = (c: readonly Pt[]): Pt => {
  const p = c[c.length - 1];
  if (p === undefined) throw new Error('empty curve');
  return p;
};

/**
 * The line with its trailing edge pulled onto `end` (same x, inside the line): over the last
 * `length` metres the radius drops by base * smoothstep(u), u running 0 -> 1, where base is the
 * blunt base thickness. Upstream of the ramp the line is unchanged point for point. The original
 * vertices inside the ramp are kept, so between points the closed line is the true line minus a
 * linearly interpolated ramp: never outside the true line, never more than the base inside it.
 */
export function knifeEdge(line: readonly Pt[], end: Pt, length: number): Pt[] {
  const te = last(line);
  if (te.x !== end.x) throw new Error('knife edge: the end must sit at the trailing edge x');
  const base = te.r - end.r;
  if (!(base > 0)) throw new Error('knife edge: the end must lie inside the line');
  const x0 = te.x - length;
  if (!(length > 0 && x0 > (line[0] as Pt).x))
    throw new Error('knife edge: the closure length must be positive and shorter than the line');
  const src = new Polyline(line);
  const xs = new Set<number>();
  for (let k = 1; k < RAMP_SAMPLES; k++) xs.add(x0 + (length * k) / RAMP_SAMPLES);
  for (const p of line) if (p.x > x0 && p.x < te.x) xs.add(p.x);
  const out = line.filter((p) => p.x <= x0);
  if (last(out).x < x0) out.push(src.atX(x0));
  for (const x of [...xs].sort((a, b) => a - b)) {
    out.push({ x, r: src.atX(x).r - base * smoothstep((x - x0) / length) });
  }
  out.push(end);
  return out;
}

function points(c: DefPolyline): Pt[] {
  return c.points.map((p) => ({ x: p.x, r: p.r }));
}

/** Curves that meet end to start, bitwise, joined with the shared point kept once. */
function join(...parts: readonly Pt[][]): Pt[] {
  const out: Pt[] = [];
  for (const part of parts) {
    const head = part[0];
    if (head === undefined) throw new Error('empty curve');
    if (out.length > 0) {
      const tail = last(out);
      if (tail.x !== head.x || tail.r !== head.r)
        throw new Error(`hub curves do not meet at (${tail.x}, ${tail.r})`);
    }
    out.push(...(out.length === 0 ? part : part.slice(1)));
  }
  return out;
}

const ductOf = (id: ComponentId): Duct =>
  id === 'inlet' || id === 'fan' ? 'fan' : id === 'bypassDuct' ? 'bypass' : 'core';

/** The mesher's geometry for an engine definition (solver geometry: knife-edged nozzle lips). */
export function flowpathFromDefinition(def: EngineDefinition): FlowpathGeometry {
  const c = def.flowpath.curves;
  const hub = join(points(c.spinner), points(c.coreInner), points(c.plug));
  const coreOuter = points(c.coreOuter);
  const nacelleInner = points(c.nacelleInner);
  const closeOnto = (outer: Pt[], inner: Pt[]): Pt[] => {
    const end = last(inner);
    return knifeEdge(outer, end, KNIFE_EDGE_LENGTH_FACTOR * (last(outer).r - end.r));
  };
  const coreCowl = closeOnto(points(c.coreCowl), coreOuter);
  const nacelleOuter = closeOnto(points(c.nacelleOuter), nacelleInner);

  const walls: Readonly<Record<Duct, readonly [Polyline, Polyline]>> = {
    fan: [new Polyline(hub), new Polyline(nacelleInner)],
    bypass: [new Polyline(coreCowl), new Polyline(nacelleInner)],
    core: [new Polyline(hub), new Polyline(coreOuter)],
  };
  // A definition edge runs from the hub to the blade tip (inside the casing by the tip
  // clearance). The mesh edge is the same straight line extended to both walls of the duct.
  const edge = (e: EdgeLine, duct: Duct, id: string): CutLine => {
    const [inner, outer] = walls[duct];
    const dir = { x: e.tip.x - e.hub.x, r: e.tip.r - e.hub.r };
    const sHub = inner.rayHit(e.hub, dir);
    const sTip = outer.rayHit(e.hub, dir);
    if (sHub === null || sTip === null) throw new Error(`blade row ${id}: edge misses a wall`);
    return { hub: inner.at(sHub), tip: outer.at(sTip) };
  };
  const bladeRows: BladeRow[] = def.bladeRows.map((r) => {
    const duct = ductOf(r.component);
    return {
      name: r.id,
      duct,
      xLE: (r.leadingEdge.hub.x + r.leadingEdge.tip.x) / 2,
      xTE: (r.trailingEdge.hub.x + r.trailingEdge.tip.x) / 2,
      le: edge(r.leadingEdge, duct, r.id),
      te: edge(r.trailingEdge, duct, r.id),
    };
  });

  const wanted: readonly string[] = [...SOLVER_REDUCTION_STATIONS, '49.5'];
  const stations: StationPlane[] = def.stations
    .filter((s) => wanted.includes(s.id))
    .map((s) => ({ id: s.id, x: s.x, duct: ductOf(s.component) }));
  for (const id of SOLVER_REDUCTION_STATIONS) {
    if (!stations.some((s) => s.id === id)) throw new Error(`definition has no station ${id}`);
  }

  const combustor = def.flowpath.components.find((k) => k.id === 'combustor');
  const fan = def.bladeRows.find((r) => r.component === 'fan' && r.kind === 'rotor');
  if (combustor === undefined || fan === undefined)
    throw new Error('definition needs a combustor and a fan rotor');
  return {
    name: `${def.name} (solver geometry: knife-edged nozzle lips)`,
    // the fan rotor's tip radius is the casing radius less the tip clearance: D / 2
    fanTipDiameter: 2 * Math.max(fan.leadingEdge.tip.r, fan.trailingEdge.tip.r),
    curves: { hub, coreOuter, coreCowl, nacelleInner, nacelleOuter },
    bladeRows,
    stations,
    combustor: { xStart: combustor.xStart, xEnd: combustor.xEnd },
  };
}
