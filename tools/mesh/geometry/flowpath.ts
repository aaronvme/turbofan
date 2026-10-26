// The mesher's geometry input: a handful of named meridional curves, the blade rows with their
// wall-to-wall edges, the solver's station planes and the combustor zone. ./definition.ts builds it
// from the real EngineDefinition (src/contracts); the mesher itself knows nothing about engines.
//
// Conventions (shared with src/contracts): SI metres; x axial, x = 0 at the fan face (station 2),
// positive downstream; r >= 0. Curves are polylines with linear interpolation, as in the definition.
import { Polyline } from '../curve';
import type { Pt } from '../types';

export type Duct = 'fan' | 'bypass' | 'core';

/** A straight line across a duct, from a point on its inner wall to a point on its outer wall. */
export interface CutLine {
  readonly hub: Pt;
  readonly tip: Pt;
}

/** A blade row: its mid-span axial extent and its leading and trailing edges, wall to wall. */
export interface BladeRow {
  readonly name: string;
  readonly duct: Duct;
  /** Mid-span leading and trailing edge x: the axial chord the cells-per-chord rule counts. */
  readonly xLE: number;
  readonly xTE: number;
  /** The edges, extended to the duct walls. The mesh puts a grid line on each (body-force zones). */
  readonly le: CutLine;
  readonly te: CutLine;
}

/** A plane where the flow solver reduces its field (a radial line across one duct). */
export interface StationPlane {
  readonly id: string;
  readonly x: number;
  readonly duct: Duct;
}

export interface FlowpathCurves {
  /** Inner flowpath line: spinner nose (on the axis) -> fan hub -> core hub -> plug tip (on the axis). */
  readonly hub: readonly Pt[];
  /** Outer wall of the core duct: splitter leading edge -> core-nozzle lip. */
  readonly coreOuter: readonly Pt[];
  /** Core cowl: splitter leading edge -> core-nozzle lip (inner wall of the bypass duct, then the afterbody). */
  readonly coreCowl: readonly Pt[];
  /** Nacelle inner line: highlight -> bypass-nozzle lip (inlet, fan case, bypass outer wall). */
  readonly nacelleInner: readonly Pt[];
  /** Nacelle outer line: highlight -> bypass-nozzle lip. */
  readonly nacelleOuter: readonly Pt[];
}

export interface FlowpathGeometry {
  readonly name: string;
  /** Fan tip diameter D, the reference length for the domain extents. */
  readonly fanTipDiameter: number;
  readonly curves: FlowpathCurves;
  readonly bladeRows: readonly BladeRow[];
  /** Planes the solver reduces at; the mesh puts an exact radial grid line on each. */
  readonly stations: readonly StationPlane[];
  /** The combustor heat-release zone (no blades; sets the core spacing there). */
  readonly combustor: { readonly xStart: number; readonly xEnd: number };
}

export interface KeyPoints {
  readonly spinnerNose: Pt;
  readonly plugTip: Pt;
  readonly splitter: Pt;
  readonly coreLip: Pt;
  readonly highlight: Pt;
  readonly bypassLip: Pt;
}

function first(c: readonly Pt[]): Pt {
  const p = c[0];
  if (p === undefined) throw new Error('empty curve');
  return p;
}

function last(c: readonly Pt[]): Pt {
  const p = c[c.length - 1];
  if (p === undefined) throw new Error('empty curve');
  return p;
}

export function keyPoints(g: FlowpathGeometry): KeyPoints {
  const c = g.curves;
  return {
    spinnerNose: first(c.hub),
    plugTip: last(c.hub),
    splitter: first(c.coreOuter),
    coreLip: last(c.coreOuter),
    highlight: first(c.nacelleInner),
    bypassLip: last(c.nacelleInner),
  };
}

const same = (a: Pt, b: Pt): boolean => a.x === b.x && a.r === b.r;

/** Problems that would make the topology impossible to build (empty when usable). */
export function validateFlowpath(g: FlowpathGeometry): string[] {
  const errors: string[] = [];
  const c = g.curves;
  for (const [name, pts] of Object.entries(c) as [keyof FlowpathCurves, readonly Pt[]][]) {
    if (pts.length < 2) {
      errors.push(`${name}: fewer than two points`);
      continue;
    }
    for (let k = 1; k < pts.length; k++) {
      const a = pts[k - 1] as Pt;
      const b = pts[k] as Pt;
      if (!(b.x >= a.x)) {
        errors.push(`${name}: x must not decrease along the curve (point ${k})`);
        break;
      }
      if (a.r < 0 || b.r < 0) {
        errors.push(`${name}: negative radius (point ${k})`);
        break;
      }
    }
  }
  if (errors.length > 0) return errors;
  const kp = keyPoints(g);
  if (kp.spinnerNose.r !== 0) errors.push('hub must start on the axis (spinner nose)');
  if (kp.plugTip.r !== 0) errors.push('hub must end on the axis (plug tip)');
  if (!same(first(c.coreCowl), kp.splitter))
    errors.push('coreCowl must start at the splitter (coreOuter start)');
  if (!same(last(c.coreCowl), kp.coreLip))
    errors.push('coreCowl must end at the core lip (coreOuter end)');
  if (!same(first(c.nacelleOuter), kp.highlight))
    errors.push('nacelleOuter must start at the highlight');
  if (!same(last(c.nacelleOuter), kp.bypassLip))
    errors.push('nacelleOuter must end at the bypass lip');
  if (!(kp.highlight.x < 0 && kp.spinnerNose.x < 0))
    errors.push('highlight and spinner nose must be upstream of the fan face x = 0');
  if (!(kp.splitter.x > 0 && kp.bypassLip.x > kp.splitter.x && kp.coreLip.x > kp.bypassLip.x)) {
    errors.push('stations must be ordered: fan face < splitter < bypass lip < core lip');
  }
  if (!(kp.plugTip.x > kp.coreLip.x)) errors.push('plug tip must be downstream of the core lip');
  if (errors.length === 0) {
    const hub = new Polyline(c.hub);
    const outer = new Polyline(c.coreOuter);
    const cowl = new Polyline(c.coreCowl);
    const nacIn = new Polyline(c.nacelleInner);
    const nacOut = new Polyline(c.nacelleOuter);
    // Sample strictly inside each span: ducts need positive height, solid walls positive thickness.
    const inside = (a: number, b: number, test: (x: number) => boolean, message: string): void => {
      for (let k = 1; k < 200; k++) {
        if (!test(a + ((b - a) * k) / 200)) {
          errors.push(message);
          return;
        }
      }
    };
    inside(
      kp.splitter.x,
      kp.coreLip.x,
      (x) => outer.atX(x).r > hub.atX(x).r,
      'core duct must have positive height',
    );
    inside(
      kp.splitter.x,
      kp.coreLip.x,
      (x) => cowl.atX(x).r > outer.atX(x).r,
      'core cowl must lie outside the core duct wall',
    );
    inside(
      kp.splitter.x,
      kp.bypassLip.x,
      (x) => nacIn.atX(x).r > cowl.atX(x).r,
      'bypass duct must have positive height',
    );
    inside(
      kp.highlight.x,
      kp.bypassLip.x,
      (x) => nacOut.atX(x).r > nacIn.atX(x).r,
      'nacelle must have positive thickness',
    );
    inside(
      0,
      kp.splitter.x,
      (x) => nacIn.atX(x).r > hub.atX(x).r,
      'fan duct must have positive span',
    );
    // blade edges run wall to wall in their duct; stations lie inside theirs
    const walls: Readonly<Record<Duct, readonly [Polyline, Polyline]>> = {
      fan: [hub, nacIn],
      bypass: [cowl, nacIn],
      core: [hub, outer],
    };
    const span: Readonly<Record<Duct, readonly [number, number]>> = {
      fan: [0, kp.splitter.x],
      bypass: [kp.splitter.x, kp.bypassLip.x],
      core: [kp.splitter.x, kp.coreLip.x],
    };
    for (const row of g.bladeRows) {
      const [inner, outerWall] = walls[row.duct];
      for (const [which, e] of [
        ['leading', row.le],
        ['trailing', row.te],
      ] as const) {
        if (!(inner.distanceTo(e.hub) < 1e-9 && outerWall.distanceTo(e.tip) < 1e-9))
          errors.push(`blade row ${row.name}: ${which} edge must run from wall to wall`);
      }
    }
    for (const s of g.stations) {
      const [a, b] = span[s.duct];
      if (!(s.x >= a && s.x <= b)) errors.push(`station ${s.id} lies outside the ${s.duct} duct`);
    }
  }
  for (const row of g.bladeRows) {
    if (!(row.xTE > row.xLE)) errors.push(`blade row ${row.name}: xTE must exceed xLE`);
    if (!(row.te.hub.x > row.le.hub.x && row.te.tip.x > row.le.tip.x))
      errors.push(`blade row ${row.name}: trailing edge must be downstream at both walls`);
  }
  return errors;
}
