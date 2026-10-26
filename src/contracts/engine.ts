// EngineDefinition: the single source of truth for flowpath, blade rows, design point and
// limits. The cycle model, mesh generator, body forces and 3D geometry all derive from it.
//
// Conventions (shared with the mesh builder; do not change):
// - SI units. Meridional coordinates: x axial, x = 0 at the station 2 plane (fan face),
//   positive downstream; r >= 0 from the engine axis; theta right-handed about +x.
// - Shaft rotation is data: rotation[spool] is the sign of the shaft angular velocity
//   about +x (+1 = counter-clockwise seen from behind, looking upstream along -x).
// - Blade and flow angles are geometric: measured from the meridional (+x) direction,
//   positive toward +theta. They do not depend on the rotation sign; a rotor that turns
//   in -theta simply has its angles mirrored.
// - Curves are polylines in (x, r) with linear interpolation and strictly increasing x.

import { validateAmbient, type AmbientConditions } from './ambient';
import { PLANE_STATION_IDS, STATIONS, STREAM_ORDER, type PlaneStationId } from './stations';

export type Confidence = 'official' | 'published' | 'estimate';
export type Spool = 'lp' | 'hp';
export type RotationSign = 1 | -1;

export interface MeridionalPoint {
  readonly x: number;
  readonly r: number;
}

/** A meridional curve: (x, r) points with strictly increasing x, linearly interpolated. */
export interface Polyline {
  readonly points: readonly MeridionalPoint[];
}

/**
 * spinner: nose on the axis to the fan hub. coreInner: core hub from the fan face to the LPT
 * exit. plug: centre body from the LPT exit to its tail on the axis. coreOuter: core casing
 * from the splitter lip to the core nozzle lip. coreCowl: bypass-side wall from the splitter
 * lip to the core nozzle lip (inner bypass wall, then the exposed core cowl). nacelleInner
 * and nacelleOuter: from the highlight to the fan nozzle trailing edge.
 */
export const CURVE_IDS = [
  'spinner',
  'coreInner',
  'plug',
  'coreOuter',
  'coreCowl',
  'nacelleInner',
  'nacelleOuter',
] as const;
export type CurveId = (typeof CURVE_IDS)[number];

export const COMPONENT_IDS = [
  'inlet',
  'fan',
  'bypassDuct',
  'booster',
  'transitionDuct',
  'hpc',
  'combustor',
  'hpt',
  'interTurbineDuct',
  'lpt',
  'exhaust',
] as const;
export type ComponentId = (typeof COMPONENT_IDS)[number];
export type ComponentStream = 'common' | 'core' | 'bypass';

/** One duct of the meridional flowpath, between its hub and casing curves over [xStart, xEnd]. */
export interface FlowComponent {
  readonly id: ComponentId;
  readonly name: string;
  readonly stream: ComponentStream;
  readonly upstream: ComponentId | null;
  readonly xStart: number;
  readonly xEnd: number;
  readonly hub: CurveId;
  readonly casing: CurveId;
  /** The shaft whose rotors sit in this component, if any. */
  readonly spool: Spool | null;
}

export interface Flowpath {
  readonly curves: Readonly<Record<CurveId, Polyline>>;
  readonly components: readonly FlowComponent[];
}

export interface StationPlane {
  readonly id: PlaneStationId;
  readonly x: number;
  readonly component: ComponentId;
}

export type BladeRowKind = 'rotor' | 'stator' | 'igv' | 'vsv';

export interface SpanValues {
  readonly hub: number;
  readonly mid: number;
  readonly tip: number;
}

export interface EdgeLine {
  readonly hub: MeridionalPoint;
  readonly tip: MeridionalPoint;
}

export interface VsvLink {
  readonly scheduleId: string;
  /** Multiplies the schedule closure for this row (rows on one actuation ring move differently). */
  readonly gain: number;
}

export interface BladeRow {
  readonly id: string;
  readonly name: string;
  readonly component: ComponentId;
  readonly kind: BladeRowKind;
  readonly spool: Spool | 'none';
  readonly count: number;
  readonly countConfidence: Confidence;
  readonly leadingEdge: EdgeLine;
  readonly trailingEdge: EdgeLine;
  /** True chord length, m. */
  readonly chord: SpanValues;
  /** Camber-line angles at the leading and trailing edge, rad (geometric convention). */
  readonly inletMetalAngle: SpanValues;
  readonly exitMetalAngle: SpanValues;
  readonly stagger: SpanValues;
  /** Maximum thickness over chord. */
  readonly maxThicknessRatio: SpanValues;
  /** Leading-edge inclination in the meridional plane from radial, rad; positive = tip downstream. */
  readonly sweep: number;
  /** Tangential tilt of the stacking line, rad; positive = tip toward +theta. */
  readonly lean: number;
  /** Rotor tip gap to the casing, m (0 for stators). */
  readonly tipClearance: number;
  readonly vsv: VsvLink | null;
}

export interface VsvSchedulePoint {
  /** Corrected HP speed, percent of the 100 % reference. */
  readonly n2CorrectedPercent: number;
  /** Closure from the design (open) setting, rad; positive = closed (less flow). */
  readonly closure: number;
}

export interface VsvSchedule {
  readonly id: string;
  readonly points: readonly VsvSchedulePoint[];
}

export type BleedKind = 'customer' | 'handling' | 'cooling';

export interface BleedPort {
  readonly id: string;
  readonly name: string;
  readonly kind: BleedKind;
  readonly component: ComponentId;
  readonly x: number;
  /** Largest extraction as a fraction of the local stream flow. */
  readonly maxFraction: number;
}

export interface PressureRatios {
  readonly fanBypass: number;
  readonly fanCore: number;
  readonly booster: number;
  readonly hpc: number;
  /** P3 / P2; must equal fanCore x booster x hpc. */
  readonly overall: number;
}

export interface ComponentEfficiencies {
  /** Isentropic (adiabatic) efficiencies for the turbomachines, combustion efficiency for the combustor. */
  readonly fanBypass: number;
  readonly fanCore: number;
  readonly booster: number;
  readonly hpc: number;
  readonly hpt: number;
  readonly lpt: number;
  readonly combustor: number;
}

export interface DesignPoint {
  readonly ambient: AmbientConditions;
  readonly totalAirflowKgPerS: number;
  readonly bypassRatio: number;
  readonly pressureRatios: PressureRatios;
  readonly efficiencies: ComponentEfficiencies;
  /** Combustor total-pressure loss, fraction of P3. */
  readonly combustorPressureLossFraction: number;
  /** Core air that bypasses the combustor to cool the turbines, fraction of core flow. */
  readonly turbineCoolingFraction: number;
  /** Combustor exit total temperature, K. */
  readonly t4K: number;
  /** 100 % reference speeds, rpm. */
  readonly n1Rpm: number;
  readonly n2Rpm: number;
  readonly netThrustN: number;
  readonly fuelFlowKgPerS: number;
}

export interface Ratings {
  readonly takeoffThrustN: number;
  readonly maxContinuousThrustN: number;
  /** Takeoff thrust is held up to this ambient temperature, K. */
  readonly flatRatingTemperatureK: number;
}

export interface EgtShunt {
  /** Added to the measured T49.5 for display, K. */
  readonly offsetK: number;
  /** Below this N2 the shunt is zero; it ramps linearly to fullN2Rpm. */
  readonly rampStartN2Rpm: number;
  readonly fullN2Rpm: number;
}

export interface Limits {
  readonly n1MaxRpm: number;
  readonly n2MaxRpm: number;
  /** Displayed-EGT limits, K. */
  readonly egtTakeoffRedlineK: number;
  readonly egtMaxContinuousK: number;
  readonly egtStartLimitK: number;
  readonly egtTransientK: number;
  readonly egtTransientDurationS: number;
  readonly egtShunt: EgtShunt;
}

export interface StartSchedule {
  readonly minFuelOnN2Percent: number;
  readonly fuelOnN2Percent: number;
  readonly starterCutoutN2Percent: number;
}

export interface EngineDefinition {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly rotation: Readonly<Record<Spool, RotationSign>>;
  readonly flowpath: Flowpath;
  readonly stations: readonly StationPlane[];
  readonly bladeRows: readonly BladeRow[];
  readonly vsvSchedules: readonly VsvSchedule[];
  readonly bleeds: readonly BleedPort[];
  readonly designPoint: DesignPoint;
  readonly ratings: Ratings;
  readonly limits: Limits;
  readonly startSchedule: StartSchedule;
}

// ---------------------------------------------------------------------------------------
// Curve helpers

/** r(x) on a polyline, linearly interpolated; null outside [x_first, x_last]. */
export function radiusAt(curve: Polyline, x: number): number | null {
  const pts = curve.points;
  const first = pts[0];
  const last = pts[pts.length - 1];
  if (first === undefined || last === undefined || x < first.x || x > last.x) return null;
  let lo = 0;
  let hi = pts.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    const p = pts[mid];
    if (p !== undefined && p.x <= x) lo = mid;
    else hi = mid;
  }
  const a = pts[lo];
  const b = pts[hi];
  if (a === undefined || b === undefined) return null;
  if (b.x === a.x) return a.r;
  const t = (x - a.x) / (b.x - a.x);
  return a.r + t * (b.r - a.r);
}

function inRange(c: FlowComponent, x: number): boolean {
  return x >= c.xStart - X_TOL && x <= c.xEnd + X_TOL;
}

/**
 * Hub radius of a component at x. A hub curve whose first point is on the axis (a nose,
 * like the spinner) counts as the axis upstream of that point.
 */
export function hubRadiusAt(
  flowpath: Flowpath,
  component: FlowComponent,
  x: number,
): number | null {
  if (!inRange(component, x)) return null;
  const curve = (flowpath.curves as Partial<Record<CurveId, Polyline>>)[component.hub];
  if (curve === undefined) return null;
  const r = radiusAt(curve, x);
  if (r !== null) return r;
  const first = curve.points[0];
  if (first !== undefined && first.r === 0 && x < first.x) return 0;
  return null;
}

export function casingRadiusAt(
  flowpath: Flowpath,
  component: FlowComponent,
  x: number,
): number | null {
  if (!inRange(component, x)) return null;
  const curve = (flowpath.curves as Partial<Record<CurveId, Polyline>>)[component.casing];
  return curve === undefined ? null : radiusAt(curve, x);
}

// ---------------------------------------------------------------------------------------
// Validation

/** Geometric tolerance, m: well below any real gap, above float noise. */
const X_TOL = 1e-9;
const R_TOL = 1e-9;
/** OPR consistency tolerance (relative). */
const OPR_TOL = 0.005;

const f3 = (v: number): string => v.toFixed(3);
const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const samePoint = (a: MeridionalPoint | undefined, b: MeridionalPoint | undefined): boolean =>
  a !== undefined &&
  b !== undefined &&
  Math.abs(a.x - b.x) <= X_TOL &&
  Math.abs(a.r - b.r) <= R_TOL;

function validateCurves(def: EngineDefinition, problems: string[]): void {
  const curves = def.flowpath.curves as Partial<Record<CurveId, Polyline>>;
  for (const id of CURVE_IDS) {
    const curve = curves[id];
    if (curve === undefined) {
      problems.push(`curve ${id} is missing`);
      continue;
    }
    const pts = curve.points;
    if (pts.length < 2) problems.push(`curve ${id}: needs at least 2 points`);
    pts.forEach((p, i) => {
      if (!isFiniteNumber(p.x)) problems.push(`curve ${id}: point ${i} x must be finite`);
      if (!(isFiniteNumber(p.r) && p.r >= 0))
        problems.push(`curve ${id}: point ${i} r must be finite and >= 0`);
      const prev = pts[i - 1];
      if (prev !== undefined && !(p.x > prev.x)) {
        problems.push(
          `curve ${id}: x must increase strictly (point ${i} at x=${f3(p.x)} after x=${f3(prev.x)})`,
        );
      }
    });
  }
  const first = (id: CurveId) => curves[id]?.points[0];
  const last = (id: CurveId) => {
    const pts = curves[id]?.points;
    return pts?.[pts.length - 1];
  };
  if (first('spinner') !== undefined && first('spinner')?.r !== 0)
    problems.push('spinner must start on the axis (r = 0)');
  if (last('plug') !== undefined && last('plug')?.r !== 0)
    problems.push('plug must end on the axis (r = 0)');
  if (!samePoint(last('spinner'), first('coreInner')))
    problems.push('spinner must end where coreInner starts');
  if (!samePoint(last('coreInner'), first('plug')))
    problems.push('coreInner must end where plug starts');
  if (!samePoint(first('coreOuter'), first('coreCowl'))) {
    problems.push(
      'splitter: coreOuter and coreCowl must start at the same point (the splitter lip)',
    );
  }
  if (!samePoint(first('nacelleInner'), first('nacelleOuter'))) {
    problems.push('nacelle highlight: nacelleInner and nacelleOuter must start at the same point');
  }
  const nacTeIn = last('nacelleInner');
  const nacTeOut = last('nacelleOuter');
  if (
    nacTeIn !== undefined &&
    nacTeOut !== undefined &&
    (Math.abs(nacTeIn.x - nacTeOut.x) > X_TOL || nacTeOut.r < nacTeIn.r)
  ) {
    problems.push(
      'nacelle trailing edge: nacelleInner and nacelleOuter must end at the same x, outer at or above inner',
    );
  }
  const lipIn = last('coreOuter');
  const lipOut = last('coreCowl');
  if (
    lipIn !== undefined &&
    lipOut !== undefined &&
    (Math.abs(lipIn.x - lipOut.x) > X_TOL || lipOut.r < lipIn.r)
  ) {
    problems.push(
      'core nozzle lip: coreOuter and coreCowl must end at the same x, cowl at or above the casing',
    );
  }
  // solid walls must not have negative thickness anywhere they overlap
  for (const [outer, inner] of [
    ['nacelleOuter', 'nacelleInner'],
    ['coreCowl', 'coreOuter'],
  ] as const) {
    const o = curves[outer];
    const n = curves[inner];
    if (o === undefined || n === undefined) continue;
    for (const p of [...o.points, ...n.points]) {
      const ro = radiusAt(o, p.x);
      const ri = radiusAt(n, p.x);
      if (ro !== null && ri !== null && ro < ri - R_TOL) {
        problems.push(`${outer} is inside ${inner} at x=${f3(p.x)} (${f3(ro)} < ${f3(ri)} m)`);
        break;
      }
    }
  }
}

function validateComponents(
  def: EngineDefinition,
  problems: string[],
): Map<ComponentId, FlowComponent> {
  const { flowpath } = def;
  const byId = new Map<ComponentId, FlowComponent>();
  for (const c of flowpath.components) {
    if (byId.has(c.id)) problems.push(`component ${c.id} is defined more than once`);
    else byId.set(c.id, c);
  }
  for (const id of COMPONENT_IDS) if (!byId.has(id)) problems.push(`component ${id} is missing`);
  const roots = flowpath.components.filter((c) => c.upstream === null);
  if (roots.length !== 1)
    problems.push(`exactly one component must have no upstream (found ${roots.length})`);
  const curves = flowpath.curves as Partial<Record<CurveId, Polyline>>;
  for (const c of flowpath.components) {
    if (!(isFiniteNumber(c.xStart) && isFiniteNumber(c.xEnd) && c.xStart < c.xEnd)) {
      problems.push(`component ${c.id}: xStart must be < xEnd`);
      continue;
    }
    if (c.upstream !== null) {
      const up = byId.get(c.upstream);
      if (up === undefined) problems.push(`component ${c.id}: unknown upstream "${c.upstream}"`);
      else if (Math.abs(up.xEnd - c.xStart) > X_TOL) {
        problems.push(
          `component ${c.id}: starts at x=${f3(c.xStart)} but its upstream ${up.id} ends at x=${f3(up.xEnd)}`,
        );
      }
    }
    const hub = curves[c.hub];
    const casing = curves[c.casing];
    if (hub === undefined || casing === undefined) {
      problems.push(`component ${c.id}: unknown hub or casing curve`);
      continue;
    }
    if (radiusAt(casing, c.xStart) === null || radiusAt(casing, c.xEnd) === null) {
      problems.push(
        `component ${c.id}: casing ${c.casing} does not cover [${f3(c.xStart)}, ${f3(c.xEnd)}]`,
      );
      continue;
    }
    if (hubRadiusAt(flowpath, c, c.xStart) === null || hubRadiusAt(flowpath, c, c.xEnd) === null) {
      problems.push(
        `component ${c.id}: hub ${c.hub} does not cover [${f3(c.xStart)}, ${f3(c.xEnd)}]`,
      );
      continue;
    }
    const xs = [
      c.xStart,
      c.xEnd,
      ...hub.points.map((p) => p.x),
      ...casing.points.map((p) => p.x),
    ].filter((x) => x >= c.xStart && x <= c.xEnd);
    for (const x of xs) {
      const rh = hubRadiusAt(flowpath, c, x);
      const rc = casingRadiusAt(flowpath, c, x);
      if (rh !== null && rc !== null && !(rh < rc)) {
        problems.push(
          `component ${c.id}: hub radius ${f3(rh)} m is not below casing ${f3(rc)} m at x=${f3(x)} m`,
        );
        break;
      }
    }
  }
  return byId;
}

function validateStations(
  def: EngineDefinition,
  components: Map<ComponentId, FlowComponent>,
  problems: string[],
): void {
  const byId = new Map<PlaneStationId, StationPlane>();
  for (const s of def.stations) {
    if (byId.has(s.id)) problems.push(`station ${s.id} is defined more than once`);
    else byId.set(s.id, s);
  }
  for (const id of PLANE_STATION_IDS) if (!byId.has(id)) problems.push(`station ${id} is missing`);
  for (const s of def.stations) {
    const c = components.get(s.component);
    if (c === undefined) {
      problems.push(`station ${s.id}: unknown component "${s.component}"`);
      continue;
    }
    if (!(isFiniteNumber(s.x) && inRange(c, s.x))) {
      problems.push(
        `station ${s.id}: x=${f3(s.x)} is outside component ${c.id} [${f3(c.xStart)}, ${f3(c.xEnd)}]`,
      );
    }
    const stream = STATIONS[s.id].stream;
    if (stream !== c.stream) {
      problems.push(`station ${s.id} is a ${stream} station but component ${c.id} is ${c.stream}`);
    }
  }
  const s2 = byId.get('2');
  if (s2 !== undefined && s2.x !== 0)
    problems.push('station 2 must be at x = 0 (the fan face defines the origin)');
  for (const order of [STREAM_ORDER.core, STREAM_ORDER.bypass]) {
    let prev: StationPlane | undefined;
    for (const id of order) {
      const s = byId.get(id);
      if (s === undefined) continue;
      if (prev !== undefined && s.x < prev.x - X_TOL) {
        problems.push(
          `station ${s.id} at x=${f3(s.x)} is upstream of station ${prev.id} at x=${f3(prev.x)}`,
        );
      }
      prev = s;
    }
  }
}

const ANGLE_LIMIT = Math.PI / 2;
const MAX_THICKNESS_RATIO = 0.4;
const LEAN_LIMIT = Math.PI / 4;
const SPANS = ['hub', 'mid', 'tip'] as const;

function validateRow(
  def: EngineDefinition,
  row: BladeRow,
  components: Map<ComponentId, FlowComponent>,
  schedules: ReadonlySet<string>,
  problems: string[],
): void {
  const p = (msg: string): void => {
    problems.push(`row ${row.id}: ${msg}`);
  };
  if (!(Number.isInteger(row.count) && row.count > 0))
    p(`count must be a positive integer (got ${String(row.count)})`);
  const c = components.get(row.component);
  if (c === undefined) {
    p(`unknown component "${row.component}"`);
    return;
  }
  if (row.kind === 'rotor') {
    if (row.spool === 'none') p('a rotor needs a spool');
    else if (row.spool !== c.spool)
      p(`rotor spool ${row.spool} does not match component ${c.id} (${String(c.spool)})`);
  } else if (row.spool !== 'none') {
    p(`a ${row.kind} must have spool "none"`);
  }
  if (row.kind === 'vsv') {
    if (row.vsv === null) p('a VSV needs a schedule');
    else if (!schedules.has(row.vsv.scheduleId)) p(`unknown VSV schedule "${row.vsv.scheduleId}"`);
    else if (!(isFiniteNumber(row.vsv.gain) && row.vsv.gain >= 0))
      p('VSV gain must be finite and >= 0');
  } else if (row.vsv !== null) {
    p('only VSV rows may have a schedule');
  }
  if (!(isFiniteNumber(row.tipClearance) && row.tipClearance >= 0))
    p('tipClearance must be finite and >= 0');

  const edges = [
    ['leading edge', row.leadingEdge],
    ['trailing edge', row.trailingEdge],
  ] as const;
  for (const [name, edge] of edges) {
    for (const end of ['hub', 'tip'] as const) {
      const pt = edge[end];
      if (!(isFiniteNumber(pt.x) && isFiniteNumber(pt.r))) {
        p(`${name} ${end} must be finite`);
        continue;
      }
      if (!inRange(c, pt.x)) {
        p(
          `${name} ${end} x=${f3(pt.x)} is outside component ${c.id} [${f3(c.xStart)}, ${f3(c.xEnd)}]`,
        );
        continue;
      }
      const rh = hubRadiusAt(def.flowpath, c, pt.x);
      const rc = casingRadiusAt(def.flowpath, c, pt.x);
      if (rh === null || rc === null) continue;
      if (pt.r < rh - R_TOL || pt.r > rc + R_TOL) {
        p(
          `${name} ${end} r=${f3(pt.r)} is outside the annulus [${f3(rh)}, ${f3(rc)}] at x=${f3(pt.x)}`,
        );
      } else if (end === 'tip' && row.kind === 'rotor' && pt.r > rc - row.tipClearance + R_TOL) {
        p(
          `${name} tip r=${f3(pt.r)} leaves less than the tip clearance ${f3(row.tipClearance)} m to the casing`,
        );
      }
    }
    if (!(edge.hub.r < edge.tip.r)) p(`${name}: hub r must be below tip r`);
  }
  for (const end of ['hub', 'tip'] as const) {
    const le = row.leadingEdge[end];
    const te = row.trailingEdge[end];
    if (!(te.x > le.x)) p(`trailing edge must be downstream of the leading edge at the ${end}`);
    const meridional = Math.hypot(te.x - le.x, te.r - le.r);
    const chord = row.chord[end];
    if (!(isFiniteNumber(chord) && chord > 0)) p(`chord.${end} must be finite and > 0`);
    else if (chord < meridional - 1e-6) {
      p(`chord.${end} ${f3(chord)} m is shorter than the meridional length ${f3(meridional)} m`);
    }
  }
  if (!(isFiniteNumber(row.chord.mid) && row.chord.mid > 0)) p('chord.mid must be finite and > 0');
  for (const field of ['inletMetalAngle', 'exitMetalAngle', 'stagger'] as const) {
    for (const s of SPANS) {
      const a = row[field][s];
      if (!(isFiniteNumber(a) && Math.abs(a) < ANGLE_LIMIT))
        p(`${field}.${s} must be finite with |angle| < pi/2`);
    }
  }
  for (const s of SPANS) {
    const t = row.maxThicknessRatio[s];
    if (!(isFiniteNumber(t) && t > 0 && t <= MAX_THICKNESS_RATIO))
      p(`maxThicknessRatio.${s} must be in (0, ${MAX_THICKNESS_RATIO}]`);
  }
  const leSweep = Math.atan2(
    row.leadingEdge.tip.x - row.leadingEdge.hub.x,
    row.leadingEdge.tip.r - row.leadingEdge.hub.r,
  );
  if (!(isFiniteNumber(row.sweep) && Math.abs(row.sweep - leSweep) <= 1e-6)) {
    p(`sweep ${String(row.sweep)} rad does not match the leading edge (${leSweep.toFixed(6)} rad)`);
  }
  if (!(isFiniteNumber(row.lean) && Math.abs(row.lean) < LEAN_LIMIT))
    p('lean must be finite with |lean| < pi/4');
}

function validateRows(
  def: EngineDefinition,
  components: Map<ComponentId, FlowComponent>,
  problems: string[],
): void {
  const schedules = new Set(def.vsvSchedules.map((s) => s.id));
  const seen = new Set<string>();
  for (const row of def.bladeRows) {
    if (row.id.length === 0) problems.push('a blade row has an empty id');
    if (seen.has(row.id)) problems.push(`row id "${row.id}" is used more than once`);
    seen.add(row.id);
    validateRow(def, row, components, schedules, problems);
  }
  // rows sharing a component must not overlap axially
  for (const c of components.values()) {
    const rows = def.bladeRows
      .filter((r) => r.component === c.id)
      .map((r) => ({
        row: r,
        start: Math.min(r.leadingEdge.hub.x, r.leadingEdge.tip.x),
        end: Math.max(r.trailingEdge.hub.x, r.trailingEdge.tip.x),
      }))
      .sort((a, b) => a.start - b.start);
    for (let i = 1; i < rows.length; i++) {
      const a = rows[i - 1];
      const b = rows[i];
      if (a !== undefined && b !== undefined && b.start < a.end - X_TOL) {
        problems.push(`rows ${a.row.id} and ${b.row.id} overlap (x=${f3(b.start)} < ${f3(a.end)})`);
      }
    }
  }
}

function validateSchedulesAndBleeds(
  def: EngineDefinition,
  components: Map<ComponentId, FlowComponent>,
  problems: string[],
): void {
  const ids = new Set<string>();
  for (const s of def.vsvSchedules) {
    if (ids.has(s.id)) problems.push(`VSV schedule id "${s.id}" is used more than once`);
    ids.add(s.id);
    if (s.points.length < 2) problems.push(`VSV schedule ${s.id}: needs at least 2 points`);
    s.points.forEach((pt, i) => {
      if (!(isFiniteNumber(pt.n2CorrectedPercent) && isFiniteNumber(pt.closure))) {
        problems.push(`VSV schedule ${s.id}: point ${i} must be finite`);
      } else if (!(pt.closure >= 0 && pt.closure < ANGLE_LIMIT)) {
        // closure is measured from the open design setting, positive = closed (W0C-N5)
        problems.push(
          `VSV schedule ${s.id}: point ${i} closure ${pt.closure} rad must be in [0, pi/2)`,
        );
      }
      const prev = s.points[i - 1];
      if (prev !== undefined && !(pt.n2CorrectedPercent > prev.n2CorrectedPercent)) {
        problems.push(`VSV schedule ${s.id}: n2CorrectedPercent must increase strictly`);
      }
    });
  }
  const bleedIds = new Set<string>();
  for (const b of def.bleeds) {
    if (bleedIds.has(b.id)) problems.push(`bleed id "${b.id}" is used more than once`);
    bleedIds.add(b.id);
    const c = components.get(b.component);
    if (c === undefined) problems.push(`bleed ${b.id}: unknown component "${b.component}"`);
    else if (!(isFiniteNumber(b.x) && inRange(c, b.x))) {
      problems.push(
        `bleed ${b.id}: x=${f3(b.x)} is outside component ${c.id} [${f3(c.xStart)}, ${f3(c.xEnd)}]`,
      );
    }
    if (!(isFiniteNumber(b.maxFraction) && b.maxFraction > 0 && b.maxFraction < 1)) {
      problems.push(`bleed ${b.id}: maxFraction must be in (0, 1)`);
    }
  }
}

function validatePerformance(def: EngineDefinition, problems: string[]): void {
  const positive = (name: string, v: number): void => {
    if (!(isFiniteNumber(v) && v > 0))
      problems.push(`${name} must be finite and > 0 (got ${String(v)})`);
  };
  const dp = def.designPoint;
  for (const msg of validateAmbient(dp.ambient)) problems.push(`designPoint.ambient: ${msg}`);
  positive('designPoint.totalAirflowKgPerS', dp.totalAirflowKgPerS);
  positive('designPoint.bypassRatio', dp.bypassRatio);
  positive('designPoint.t4K', dp.t4K);
  positive('designPoint.n1Rpm', dp.n1Rpm);
  positive('designPoint.n2Rpm', dp.n2Rpm);
  positive('designPoint.netThrustN', dp.netThrustN);
  positive('designPoint.fuelFlowKgPerS', dp.fuelFlowKgPerS);
  for (const [k, v] of Object.entries(dp.pressureRatios)) {
    if (!(isFiniteNumber(v) && v >= 1))
      problems.push(`designPoint.pressureRatios.${k} must be finite and >= 1`);
  }
  const pr = dp.pressureRatios;
  const product = pr.fanCore * pr.booster * pr.hpc;
  if (Math.abs(pr.overall / product - 1) > OPR_TOL) {
    problems.push(
      `designPoint: overall pressure ratio ${pr.overall.toFixed(2)} is not fanCore x booster x hpc = ${product.toFixed(2)}`,
    );
  }
  for (const [k, v] of Object.entries(dp.efficiencies)) {
    if (!(isFiniteNumber(v) && v > 0 && v <= 1))
      problems.push(`designPoint.efficiencies.${k} must be in (0, 1]`);
  }
  if (!(
    isFiniteNumber(dp.combustorPressureLossFraction) &&
    dp.combustorPressureLossFraction >= 0 &&
    dp.combustorPressureLossFraction < 0.2
  )) {
    problems.push('designPoint.combustorPressureLossFraction must be in [0, 0.2)');
  }
  if (!(
    isFiniteNumber(dp.turbineCoolingFraction) &&
    dp.turbineCoolingFraction >= 0 &&
    dp.turbineCoolingFraction < 0.5
  )) {
    problems.push('designPoint.turbineCoolingFraction must be in [0, 0.5)');
  }

  const rt = def.ratings;
  positive('ratings.takeoffThrustN', rt.takeoffThrustN);
  positive('ratings.maxContinuousThrustN', rt.maxContinuousThrustN);
  positive('ratings.flatRatingTemperatureK', rt.flatRatingTemperatureK);
  if (rt.maxContinuousThrustN > rt.takeoffThrustN)
    problems.push('ratings: maxContinuousThrustN must not exceed takeoffThrustN');

  const lim = def.limits;
  if (!(isFiniteNumber(lim.n1MaxRpm) && lim.n1MaxRpm > dp.n1Rpm)) {
    problems.push(
      `limits.n1MaxRpm (${String(lim.n1MaxRpm)}) must exceed the 100 % speed designPoint.n1Rpm (${String(dp.n1Rpm)})`,
    );
  }
  if (!(isFiniteNumber(lim.n2MaxRpm) && lim.n2MaxRpm > dp.n2Rpm)) {
    problems.push(
      `limits.n2MaxRpm (${String(lim.n2MaxRpm)}) must exceed the 100 % speed designPoint.n2Rpm (${String(dp.n2Rpm)})`,
    );
  }
  const egts = [
    lim.egtStartLimitK,
    lim.egtMaxContinuousK,
    lim.egtTakeoffRedlineK,
    lim.egtTransientK,
  ];
  if (!(
    egts.every((v) => isFiniteNumber(v) && v > 0) &&
    egts.every((v, i) => i === 0 || v > (egts[i - 1] ?? Infinity))
  )) {
    problems.push(
      'limits: EGT limits must satisfy start < max continuous < takeoff redline < transient',
    );
  }
  positive('limits.egtTransientDurationS', lim.egtTransientDurationS);
  const sh = lim.egtShunt;
  if (!(
    isFiniteNumber(sh.offsetK) &&
    sh.offsetK >= 0 &&
    isFiniteNumber(sh.rampStartN2Rpm) &&
    isFiniteNumber(sh.fullN2Rpm) &&
    sh.rampStartN2Rpm <= sh.fullN2Rpm
  )) {
    problems.push('limits.egtShunt: need offsetK >= 0 and rampStartN2Rpm <= fullN2Rpm');
  }

  const st = def.startSchedule;
  if (!(
    [st.minFuelOnN2Percent, st.fuelOnN2Percent, st.starterCutoutN2Percent].every(isFiniteNumber) &&
    st.minFuelOnN2Percent > 0 &&
    st.minFuelOnN2Percent <= st.fuelOnN2Percent &&
    st.fuelOnN2Percent < st.starterCutoutN2Percent &&
    st.starterCutoutN2Percent < 100
  )) {
    problems.push(
      'startSchedule: need 0 < minFuelOnN2Percent <= fuelOnN2Percent < starterCutoutN2Percent < 100',
    );
  }
}

/**
 * Checks an engine definition for geometric and physical consistency and returns every
 * problem found as a human-readable sentence (an empty list means valid).
 */
export function validateEngineDefinition(def: EngineDefinition): string[] {
  const problems: string[] = [];
  if (def.id.length === 0) problems.push('id must not be empty');
  if (def.name.length === 0) problems.push('name must not be empty');
  for (const spool of ['lp', 'hp'] as const) {
    const sign: number = def.rotation[spool];
    if (sign !== 1 && sign !== -1)
      problems.push(`rotation.${spool} must be +1 or -1 (got ${String(sign)})`);
  }
  validateCurves(def, problems);
  const components = validateComponents(def, problems);
  validateStations(def, components, problems);
  validateRows(def, components, problems);
  validateSchedulesAndBleeds(def, components, problems);
  validatePerformance(def, problems);
  return problems;
}
