// The mesher's geometry input: a handful of named meridional curves plus blade-row extents. W1
// replaces the placeholder (./placeholder.ts) with an adapter from the real EngineDefinition
// (src/contracts) that produces this same shape, so the mesher itself does not change.
//
// Conventions (shared with src/contracts): SI metres; x axial, x = 0 at the fan face (station 2),
// positive downstream; r >= 0. Curves are dense polylines (spacing well below the mesh spacing).
import { Polyline } from '../curve';
import type { Pt } from '../types';

export type Duct = 'fan' | 'bypass' | 'core';

/** A blade row's axial extent at mid-span (leading and trailing edge x). */
export interface BladeRow {
  readonly name: string;
  readonly duct: Duct;
  readonly xLE: number;
  readonly xTE: number;
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
  const hub = new Polyline(c.hub);
  if (errors.length === 0) {
    if (
      !(new Polyline(c.coreOuter).atX(kp.splitter.x + 1e-3).r > hub.atX(kp.splitter.x + 1e-3).r)
    ) {
      errors.push('core duct must have positive height after the splitter');
    }
    if (!(new Polyline(c.nacelleInner).atX(0).r > hub.atX(0).r))
      errors.push('fan face must have positive span');
  }
  for (const row of g.bladeRows) {
    if (!(row.xTE > row.xLE)) errors.push(`blade row ${row.name}: xTE must exceed xLE`);
  }
  return errors;
}
