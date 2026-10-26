// The CFM56-7B27/3-class engine: the single EngineDefinition the cycle model, mesh, body
// forces and 3D geometry derive from (plan: "one parametric engine definition").
//
// - Every published or assumed figure comes from ./facts (docs/ENGINE_FACTS.md); the
//   flowpath proportions are justified in ENGINE_FACTS "Representative flowpath".
// - Conventions (src/contracts/engine.ts): metres, x = 0 at the fan face (station 2), positive
//   downstream; both spools rotate clockwise seen from behind (NTSB AAR-19/03), i.e. -1 about
//   +x, co-rotating.
// - Blade rows are synthesized: rows are laid out along each component by their axial
//   chords; a mean-line march through the design-point estimate gives each row its free-vortex
//   velocity triangles (equal stage work, a chosen reaction), and ./bladeDesign turns those
//   into metal angles with Carter's rule. Counts come from a target solidity except the
//   published 24 fan blades.

import { ISA_SLS } from '../contracts/ambient';
import {
  casingRadiusAt,
  hubRadiusAt,
  type BladeRow,
  type BladeRowKind,
  type BleedPort,
  type ComponentId,
  type Confidence,
  type CurveId,
  type DesignPoint,
  type EngineDefinition,
  type FlowComponent,
  type Flowpath,
  type MeridionalPoint,
  type Polyline,
  type SpanValues,
  type Spool,
  type StationPlane,
  type VsvLink,
} from '../contracts/engine';
import { deepFreeze } from '../contracts/sim';
import { axialVelocity, designRow, type RowAerodynamics, type RowEdges } from './bladeDesign';
import {
  COLD_GAS,
  HOT_GAS,
  estimateDesignPoint,
  type DesignPointEstimate,
  type GasSection,
} from './designPoint';
import { factValue as v } from './facts';
import { rpmToRadPerS } from './units';

// ---------------------------------------------------------------------------------------
// Flowpath (m)

const FAN_TIP_R = v('fanDiameter') / 2;
const FAN_CASING_R = FAN_TIP_R + v('fanTipClearance');
const FAN_HUB_R = v('fanHubRadius');
const HIGHLIGHT_X = -0.775;
const SPINNER_NOSE_X = -0.42;
const SPLITTER_X = 0.26;
const NACELLE_TE_X = 1.55;
const NACELLE_TE_INNER_R = 0.757;
const CORE_LIP_X = 2.75;
const CORE_LIP_R = 0.39;
const PLUG_TIP_X = 3.4;

/** x of the fan-case forward flange and the turbine rear frame aft flange: engineLength apart. */
export const FAN_CASE_FLANGE_X = v('fanCaseFlangeX');
export const TRF_AFT_FLANGE_X = FAN_CASE_FLANGE_X + v('engineLength');

/** The nozzle exit areas size the core cowl at the fan nozzle and the plug at the core lip. */
const COWL_R_AT_FAN_NOZZLE = Math.sqrt(NACELLE_TE_INNER_R ** 2 - v('bypassNozzleArea') / Math.PI);
const PLUG_R_AT_CORE_LIP = Math.sqrt(CORE_LIP_R ** 2 - v('coreNozzleArea') / Math.PI);

const X = {
  boosterEnd: 0.64,
  hpcStart: 0.86,
  hpcEnd: 1.46,
  combustorEnd: 1.74,
  hptEnd: 1.88,
  lptStart: 1.97,
  lptEnd: 2.37,
} as const;

const line = (pts: readonly (readonly [number, number])[]): Polyline => ({
  points: pts.map(([x, r]): MeridionalPoint => ({ x, r })),
});

/** Spinner: a cone, slightly convex, from the nose on the axis to the fan hub. */
function spinner(): Polyline {
  const ts = [0, 0.05, 0.15, 0.3, 0.5, 0.7, 0.85];
  const pts: [number, number][] = ts.map((t) => [
    SPINNER_NOSE_X * (1 - t),
    FAN_HUB_R * (1.15 * t - 0.15 * t * t),
  ]);
  pts.push([0, FAN_HUB_R]);
  return line(pts);
}

const CURVES: Readonly<Record<CurveId, Polyline>> = {
  spinner: spinner(),
  coreInner: line([
    [0, FAN_HUB_R],
    [0.05, 0.247],
    [0.1, 0.27],
    [0.15, 0.293],
    [0.2, 0.305],
    [SPLITTER_X, 0.316],
    [0.32, 0.325],
    [0.45, 0.336],
    [X.boosterEnd, 0.345],
    // transition (gooseneck) duct down to the HPC
    [0.7, 0.33],
    [0.76, 0.29],
    [0.82, 0.24],
    [X.hpcStart, 0.222],
    [1.16, 0.244],
    [X.hpcEnd, 0.262],
    // combustor inner wall
    [1.52, 0.262],
    [1.6, 0.258],
    [1.68, 0.272],
    [X.combustorEnd, 0.298],
    [X.hptEnd, 0.297],
    [X.lptStart, 0.33],
    [X.lptEnd, 0.335],
  ]),
  plug: line([
    [X.lptEnd, 0.335],
    [2.55, 0.33],
    [CORE_LIP_X, PLUG_R_AT_CORE_LIP],
    [2.95, 0.262],
    [3.15, 0.185],
    [3.3, 0.1],
    [PLUG_TIP_X, 0],
  ]),
  coreOuter: line([
    [SPLITTER_X, 0.43],
    [0.3, 0.428],
    [0.45, 0.42],
    [X.boosterEnd, 0.41],
    [0.7, 0.398],
    [0.76, 0.365],
    [0.82, 0.33],
    [X.hpcStart, 0.316],
    [1.16, 0.296],
    [X.hpcEnd, 0.281],
    // combustor outer wall
    [1.5, 0.3],
    [1.56, 0.345],
    [1.64, 0.365],
    [1.7, 0.358],
    [X.combustorEnd, 0.342],
    [X.hptEnd, 0.348],
    [X.lptStart, 0.388],
    [X.lptEnd, 0.452],
    [2.55, 0.43],
    [CORE_LIP_X, CORE_LIP_R],
  ]),
  coreCowl: line([
    [SPLITTER_X, 0.43],
    [0.3, 0.452],
    [0.4, 0.468],
    [0.6, 0.476],
    [0.9, 0.488],
    [1.2, 0.508],
    [1.4, 0.522],
    [NACELLE_TE_X, COWL_R_AT_FAN_NOZZLE],
    [1.8, 0.535],
    [2.1, 0.522],
    [2.4, 0.49],
    [2.6, 0.446],
    [CORE_LIP_X, 0.405],
  ]),
  nacelleInner: line([
    [HIGHLIGHT_X, v('inletHighlightRadius')],
    [-0.765, 0.772],
    [-0.745, 0.752],
    [-0.7, 0.739],
    [-0.6, 0.735],
    [-0.45, 0.741],
    [-0.3, 0.752],
    [-0.15, 0.766],
    [-0.03, FAN_CASING_R],
    [0.2, FAN_CASING_R],
    [0.3, 0.776],
    [0.6, 0.774],
    [0.9, 0.771],
    [1.2, 0.766],
    [1.4, 0.761],
    [NACELLE_TE_X, NACELLE_TE_INNER_R],
  ]),
  nacelleOuter: line([
    [HIGHLIGHT_X, v('inletHighlightRadius')],
    [-0.77, 0.835],
    [-0.755, 0.872],
    [-0.725, 0.91],
    [-0.67, 0.95],
    [-0.58, 0.99],
    [-0.45, 1.025],
    [-0.25, 1.05],
    [0, v('nacelleMaxDiameter') / 2],
    [0.25, 1.058],
    [0.55, 1.04],
    [0.85, 1.0],
    [1.1, 0.95],
    [1.3, 0.89],
    [1.45, 0.825],
    [NACELLE_TE_X, 0.775],
  ]),
};

const comp = (
  id: ComponentId,
  name: string,
  stream: FlowComponent['stream'],
  upstream: ComponentId | null,
  xStart: number,
  xEnd: number,
  hub: CurveId,
  casing: CurveId,
  spool: Spool | null = null,
): FlowComponent => ({ id, name, stream, upstream, xStart, xEnd, hub, casing, spool });

const COMPONENTS: readonly FlowComponent[] = [
  comp('inlet', 'Intake', 'common', null, HIGHLIGHT_X, 0, 'spinner', 'nacelleInner'),
  comp('fan', 'Fan', 'common', 'inlet', 0, SPLITTER_X, 'coreInner', 'nacelleInner', 'lp'),
  comp(
    'bypassDuct',
    'Bypass duct',
    'bypass',
    'fan',
    SPLITTER_X,
    NACELLE_TE_X,
    'coreCowl',
    'nacelleInner',
  ),
  comp(
    'booster',
    'Booster (LPC)',
    'core',
    'fan',
    SPLITTER_X,
    X.boosterEnd,
    'coreInner',
    'coreOuter',
    'lp',
  ),
  comp(
    'transitionDuct',
    'Transition duct',
    'core',
    'booster',
    X.boosterEnd,
    X.hpcStart,
    'coreInner',
    'coreOuter',
  ),
  comp(
    'hpc',
    'High-pressure compressor',
    'core',
    'transitionDuct',
    X.hpcStart,
    X.hpcEnd,
    'coreInner',
    'coreOuter',
    'hp',
  ),
  comp('combustor', 'Combustor', 'core', 'hpc', X.hpcEnd, X.combustorEnd, 'coreInner', 'coreOuter'),
  comp(
    'hpt',
    'High-pressure turbine',
    'core',
    'combustor',
    X.combustorEnd,
    X.hptEnd,
    'coreInner',
    'coreOuter',
    'hp',
  ),
  comp(
    'interTurbineDuct',
    'Inter-turbine duct',
    'core',
    'hpt',
    X.hptEnd,
    X.lptStart,
    'coreInner',
    'coreOuter',
  ),
  comp(
    'lpt',
    'Low-pressure turbine',
    'core',
    'interTurbineDuct',
    X.lptStart,
    X.lptEnd,
    'coreInner',
    'coreOuter',
    'lp',
  ),
  comp('exhaust', 'Core exhaust', 'core', 'lpt', X.lptEnd, CORE_LIP_X, 'plug', 'coreOuter'),
];

const FLOWPATH: Flowpath = { curves: CURVES, components: COMPONENTS };

function component(id: ComponentId): FlowComponent {
  const c = COMPONENTS.find((k) => k.id === id);
  if (c === undefined) throw new Error(`definition: no component ${id}`);
  return c;
}

function wallRadius(id: ComponentId, side: 'hub' | 'casing', x: number): number {
  const c = component(id);
  const r = side === 'hub' ? hubRadiusAt(FLOWPATH, c, x) : casingRadiusAt(FLOWPATH, c, x);
  if (r === null) throw new Error(`definition: no ${side} for ${id} at x=${x}`);
  return r;
}

// ---------------------------------------------------------------------------------------
// Blade-row layout

const span = (hub: number, mid: number, tip: number): SpanValues => ({ hub, mid, tip });

interface RowSpec {
  readonly id: string;
  readonly name: string;
  readonly kind: BladeRowKind;
  /** Axial chord at hub and tip, m. */
  readonly bx: readonly [number, number];
  /** Axial gap to the next row of the component, m. */
  readonly gapAfter: number;
  /** Tip leading edge downstream of the hub leading edge, m (backward sweep). */
  readonly leTipOffset?: number;
  readonly count?: number;
  readonly countConfidence?: Confidence;
  readonly targetSolidity?: number;
  readonly thickness: SpanValues;
  readonly tipClearance?: number;
  readonly vsv?: VsvLink;
}

interface PlacedRow {
  readonly spec: RowSpec;
  readonly component: ComponentId;
  readonly edges: RowEdges;
  readonly tipClearance: number;
}

/** Lays rows out one after another from xStart; throws if they overrun the component. */
function layout(id: ComponentId, xStart: number, specs: readonly RowSpec[]): PlacedRow[] {
  const c = component(id);
  let cursor = xStart;
  return specs.map((spec) => {
    const clearance = spec.kind === 'rotor' ? (spec.tipClearance ?? 0) : 0;
    const edge = (xHub: number, xTip: number) => ({
      hub: { x: xHub, r: wallRadius(id, 'hub', xHub) },
      tip: { x: xTip, r: wallRadius(id, 'casing', xTip) - clearance },
    });
    const leHub = cursor;
    const leTip = cursor + (spec.leTipOffset ?? 0);
    const edges: RowEdges = {
      leadingEdge: edge(leHub, leTip),
      trailingEdge: edge(leHub + spec.bx[0], leTip + spec.bx[1]),
    };
    const end = Math.max(edges.trailingEdge.hub.x, edges.trailingEdge.tip.x);
    if (end > c.xEnd) throw new Error(`definition: row ${spec.id} ends at x=${end}, past ${id}`);
    cursor = end + spec.gapAfter;
    return { spec, component: id, edges, tipClearance: clearance };
  });
}

const compressorRows = (
  prefix: string,
  label: string,
  stages: number,
  bx: (row: number) => readonly [number, number],
  gap: number,
  rotor: Pick<RowSpec, 'targetSolidity' | 'thickness' | 'tipClearance'>,
  stator: Pick<RowSpec, 'targetSolidity' | 'thickness'>,
  vsv: (stage: number) => VsvLink | undefined,
): RowSpec[] => {
  const out: RowSpec[] = [];
  for (let s = 1; s <= stages; s++) {
    out.push({
      id: `${prefix}-r${s}`,
      name: `${label} rotor ${s}`,
      kind: 'rotor',
      bx: bx(2 * s - 1),
      gapAfter: gap,
      ...rotor,
    });
    const link = vsv(s);
    out.push({
      id: `${prefix}-s${s}`,
      name: `${label} stator ${s}`,
      kind: link === undefined ? 'stator' : 'vsv',
      bx: bx(2 * s),
      gapAfter: gap,
      ...stator,
      ...(link === undefined ? {} : { vsv: link }),
    });
  }
  return out;
};

const VSV_SCHEDULE_ID = 'hpc-vsv';
/** Rows on one actuation ring move less the further aft they sit (assumed gains). */
const VSV_GAINS = [1, 0.75, 0.5, 0.25] as const;
const vsvLink = (i: number): VsvLink | undefined => {
  const gain = VSV_GAINS[i];
  return gain === undefined ? undefined : { scheduleId: VSV_SCHEDULE_ID, gain };
};

const FAN_ROWS: RowSpec[] = [
  {
    id: 'fan',
    name: 'Fan rotor',
    kind: 'rotor',
    bx: [0.15, 0.125],
    gapAfter: 0,
    leTipOffset: 0.015,
    count: v('fanBladeCount'),
    countConfidence: 'published',
    thickness: span(0.1, 0.055, 0.03),
    tipClearance: v('fanTipClearance'),
  },
];

const OGV_ROWS: RowSpec[] = [
  {
    id: 'fan-ogv',
    name: 'Fan outlet guide vane',
    kind: 'stator',
    bx: [0.1, 0.1],
    gapAfter: 0,
    targetSolidity: 1.4,
    thickness: span(0.08, 0.07, 0.06),
  },
];

const BOOSTER_BX: readonly (readonly [number, number])[] = [
  [0.035, 0.035],
  [0.045, 0.045],
  [0.04, 0.04],
  [0.043, 0.043],
  [0.038, 0.038],
  [0.041, 0.041],
  [0.036, 0.036],
];
const BOOSTER_ROWS: RowSpec[] = [
  {
    id: 'booster-igv',
    name: 'Booster inlet guide vane',
    kind: 'igv',
    bx: BOOSTER_BX[0] ?? [0, 0],
    gapAfter: 0.01,
    targetSolidity: 1.0,
    thickness: span(0.08, 0.07, 0.06),
  },
  ...compressorRows(
    'booster',
    'Booster',
    v('boosterStages'),
    (i) => BOOSTER_BX[i] ?? [0, 0],
    0.01,
    { targetSolidity: 1.4, thickness: span(0.08, 0.06, 0.045), tipClearance: 0.0008 },
    { targetSolidity: 1.3, thickness: span(0.08, 0.07, 0.06) },
    () => undefined,
  ),
];

const HPC_BX: readonly number[] = [
  0.03, 0.04, 0.032, 0.036, 0.029, 0.033, 0.027, 0.03, 0.025, 0.027, 0.023, 0.025, 0.021, 0.023,
  0.02, 0.021, 0.019, 0.02, 0.019,
];
const hpcBx = (i: number): readonly [number, number] => {
  const b = HPC_BX[i] ?? 0;
  return [b, b];
};
const HPC_ROWS: RowSpec[] = [
  {
    id: 'hpc-igv',
    name: 'HPC variable inlet guide vane',
    kind: 'vsv',
    bx: hpcBx(0),
    gapAfter: 0.0045,
    targetSolidity: 1.0,
    thickness: span(0.08, 0.07, 0.06),
    vsv: vsvLink(0),
  },
  ...compressorRows(
    'hpc',
    'HPC',
    v('hpcStages'),
    hpcBx,
    0.0045,
    { targetSolidity: 1.3, thickness: span(0.07, 0.055, 0.045), tipClearance: 0.0004 },
    { targetSolidity: 1.2, thickness: span(0.07, 0.06, 0.05) },
    (stage) => vsvLink(stage),
  ),
];

const turbineRows = (
  prefix: string,
  label: string,
  stages: number,
  bx: (row: number) => readonly [number, number],
  gap: number,
  nozzle: Pick<RowSpec, 'targetSolidity' | 'thickness'>,
  rotor: Pick<RowSpec, 'targetSolidity' | 'thickness' | 'tipClearance'>,
): RowSpec[] => {
  const out: RowSpec[] = [];
  for (let s = 1; s <= stages; s++) {
    out.push({
      id: `${prefix}-n${s}`,
      name: `${label} nozzle ${s}`,
      kind: 'stator',
      bx: bx(2 * s - 2),
      gapAfter: gap,
      ...nozzle,
    });
    out.push({
      id: `${prefix}-r${s}`,
      name: `${label} rotor ${s}`,
      kind: 'rotor',
      bx: bx(2 * s - 1),
      gapAfter: gap,
      ...rotor,
    });
  }
  return out;
};

const HPT_ROWS = turbineRows(
  'hpt',
  'HPT',
  v('hptStages'),
  (i) => (i === 0 ? [0.04, 0.04] : [0.035, 0.035]),
  0.015,
  { targetSolidity: 1.2, thickness: span(0.22, 0.2, 0.18) },
  { targetSolidity: 1.3, thickness: span(0.25, 0.18, 0.12), tipClearance: 0.0004 },
);

const LPT_BX = [0.034, 0.032, 0.036, 0.034, 0.038, 0.036, 0.04, 0.038];
const LPT_ROWS = turbineRows(
  'lpt',
  'LPT',
  v('lptStages'),
  (i) => {
    const b = LPT_BX[i] ?? 0;
    return [b, b];
  },
  0.012,
  { targetSolidity: 1.1, thickness: span(0.15, 0.13, 0.11) },
  { targetSolidity: 1.1, thickness: span(0.15, 0.12, 0.09), tipClearance: 0.0008 },
);

const PLACED = {
  fan: layout('fan', 0.005, FAN_ROWS),
  bypassDuct: layout('bypassDuct', 0.42, OGV_ROWS),
  booster: layout('booster', 0.275, BOOSTER_ROWS),
  hpc: layout('hpc', X.hpcStart + 0.005, HPC_ROWS),
  hpt: layout('hpt', X.combustorEnd + 0.005, HPT_ROWS),
  lpt: layout('lpt', X.lptStart + 0.005, LPT_ROWS),
};

// ---------------------------------------------------------------------------------------
// Design point

const DESIGN_POINT: DesignPoint = (() => {
  const fanCore = v('fanCorePressureRatio');
  const booster = v('boosterPressureRatio');
  const overall = v('overallPressureRatio');
  return {
    ambient: ISA_SLS,
    totalAirflowKgPerS: v('totalAirflow'),
    bypassRatio: v('bypassRatio'),
    pressureRatios: {
      fanBypass: v('fanBypassPressureRatio'),
      fanCore,
      booster,
      hpc: overall / (fanCore * booster),
      overall,
    },
    efficiencies: {
      fanBypass: v('etaFanBypass'),
      fanCore: v('etaFanCore'),
      booster: v('etaBooster'),
      hpc: v('etaHpc'),
      hpt: v('etaHpt'),
      lpt: v('etaLpt'),
      combustor: v('combustionEfficiency'),
    },
    combustorPressureLossFraction: v('combustorPressureLoss'),
    turbineCoolingFraction: v('turbineCoolingFraction'),
    t4K: v('t4Takeoff'),
    n1Rpm: v('n1ReferenceRpm'),
    n2Rpm: v('n2ReferenceRpm'),
    netThrustN: v('takeoffThrust'),
    fuelFlowKgPerS: v('fuelFlowTakeoff'),
  };
})();

// ---------------------------------------------------------------------------------------
// Mean line

/** Flow at one row edge on the mean line (mid span). */
export interface MeanlinePlane {
  readonly x: number;
  readonly rMid: number;
  readonly areaM2: number;
  readonly wKgPerS: number;
  readonly ttK: number;
  readonly ptPa: number;
  /** r c_theta of the absolute flow, m^2/s. */
  readonly rcTheta: number;
  readonly cxMPerS: number;
  readonly mach: number;
  readonly axialMach: number;
}

export interface MeanlineRow {
  readonly rowId: string;
  readonly component: ComponentId;
  readonly omegaRadPerS: number;
  readonly inlet: MeanlinePlane;
  readonly exit: MeanlinePlane;
  /** omega (r c_theta out - r c_theta in), J/kg: > 0 in compressors, < 0 in turbines, 0 in stators. */
  readonly eulerWorkJPerKg: number;
}

interface Totals {
  readonly wKgPerS: number;
  readonly ttK: number;
  readonly ptPa: number;
}

/** Design reactions (mean line): turbines leave a little counter-swirl except the LPT exit. */
const REACTION = { booster: 0.5, hpc: 0.6, hpt: 0.45, lpt: 0.5 } as const;

function plane(
  edge: RowEdges['leadingEdge'],
  comp: ComponentId,
  t: Totals,
  rcTheta: number,
  gas: GasSection,
): MeanlinePlane {
  const rh = edge.hub.r;
  const rc = wallRadius(comp, 'casing', edge.tip.x);
  const rMid = (edge.hub.r + edge.tip.r) / 2;
  const areaM2 = Math.PI * (rc * rc - rh * rh);
  const flow = axialVelocity({ ...t, areaM2, cThetaMPerS: rcTheta / rMid, gas });
  return {
    x: (edge.hub.x + edge.tip.x) / 2,
    rMid,
    areaM2,
    ...t,
    rcTheta,
    cxMPerS: flow.cxMPerS,
    mach: flow.mach,
    axialMach: flow.axialMach,
  };
}

/** Mean radius of a rotor: the average of its leading- and trailing-edge mid radii. */
const meanRadius = (p: PlacedRow) =>
  (p.edges.leadingEdge.hub.r +
    p.edges.leadingEdge.tip.r +
    p.edges.trailingEdge.hub.r +
    p.edges.trailingEdge.tip.r) /
  4;

interface RowFlow {
  readonly placed: PlacedRow;
  readonly omega: number;
  readonly inTotals: Totals;
  readonly outTotals: Totals;
  readonly rcIn: number;
  readonly rcOut: number;
  readonly gasIn: GasSection;
  readonly gasOut: GasSection;
}

const after = (t: Totals, dtK: number, ptRatio: number, w = t.wKgPerS): Totals => ({
  wKgPerS: w,
  ttK: t.ttK + dtK,
  ptPa: t.ptPa * ptRatio,
});

/**
 * Multistage axial compressor, equal stage work, reaction R on the mean line:
 * c_theta1 = U (1 - R) - dc/2, c_theta2 = c_theta1 + dc with dc = w / U (magnitudes in the
 * rotation direction). An optional leading IGV turns rcIn into the first rotor's prewhirl;
 * the last stator returns the flow to axial.
 */
function compressorFlows(
  rows: readonly PlacedRow[],
  omega: number,
  inlet: Totals,
  rcIn: number,
  workPerKg: number,
  reaction: number,
  etaPoly: number,
): RowFlow[] {
  const g = COLD_GAS;
  const s = Math.sign(omega);
  const rotors = rows.filter((p) => p.spec.kind === 'rotor');
  const wStage = workPerKg / rotors.length;
  const swirl = rotors.map((p) => {
    const r = meanRadius(p);
    const u = Math.abs(omega) * r;
    const dc = wStage / u;
    const c1 = u * (1 - reaction) - dc / 2;
    return { rc1: s * r * c1, rc2: s * r * (c1 + dc) };
  });
  const out: RowFlow[] = [];
  let t = inlet;
  let rc = rcIn;
  let stage = 0;
  rows.forEach((p, i) => {
    if (p.spec.kind === 'rotor') {
      const sw = swirl[stage];
      if (sw === undefined) throw new Error('definition: rotor without a stage');
      const dt = wStage / g.cpJPerKgK;
      const next = after(t, dt, ((t.ttK + dt) / t.ttK) ** ((etaPoly * g.gamma) / (g.gamma - 1)));
      out.push({
        placed: p,
        omega,
        inTotals: t,
        outTotals: next,
        rcIn: sw.rc1,
        rcOut: sw.rc2,
        gasIn: g,
        gasOut: g,
      });
      t = next;
      rc = sw.rc2;
      stage += 1;
      return;
    }
    // a vane: turns the flow to the next rotor's prewhirl, or to axial after the last stage
    const nextRotor = rows.slice(i + 1).some((k) => k.spec.kind === 'rotor');
    const rcOut = nextRotor ? (swirl[stage]?.rc1 ?? 0) : 0;
    out.push({
      placed: p,
      omega: 0,
      inTotals: t,
      outTotals: t,
      rcIn: rc,
      rcOut,
      gasIn: g,
      gasOut: g,
    });
    rc = rcOut;
  });
  return out;
}

/**
 * Multistage axial turbine (nozzle then rotor), equal stage work, reaction R:
 * c_theta2 = U (1 - R) + dc/2, c_theta3 = c_theta2 - dc; a zero-exit-swirl last stage when
 * asked. The first nozzle's exit totals may differ from its inlet (cooling air mixed in).
 */
function turbineFlows(
  rows: readonly PlacedRow[],
  omega: number,
  inlet: Totals,
  nozzleExit: Totals,
  rcIn: number,
  workPerKg: number,
  reaction: number,
  etaPoly: number,
  axialExit: boolean,
): RowFlow[] {
  const g = HOT_GAS;
  const s = Math.sign(omega);
  const rotors = rows.filter((p) => p.spec.kind === 'rotor');
  const wStage = workPerKg / rotors.length;
  const out: RowFlow[] = [];
  let t = inlet;
  let rc = rcIn;
  let stage = 0;
  for (let i = 0; i < rows.length; i += 2) {
    const nozzle = rows[i];
    const rotor = rows[i + 1];
    if (nozzle === undefined || rotor === undefined)
      throw new Error('definition: turbine rows come in pairs');
    stage += 1;
    const r = meanRadius(rotor);
    const u = Math.abs(omega) * r;
    const dc = wStage / u;
    const last = stage === rotors.length;
    const c2 = last && axialExit ? dc : u * (1 - reaction) + dc / 2;
    const rc2 = s * r * c2;
    const rc3 = last && axialExit ? 0 : s * r * (c2 - dc);
    const tNozzleOut = stage === 1 ? nozzleExit : t;
    out.push({
      placed: nozzle,
      omega: 0,
      inTotals: t,
      outTotals: tNozzleOut,
      rcIn: rc,
      rcOut: rc2,
      gasIn: g,
      gasOut: g,
    });
    const dt = -wStage / g.cpJPerKgK;
    const tOut = after(
      tNozzleOut,
      dt,
      ((tNozzleOut.ttK + dt) / tNozzleOut.ttK) ** (g.gamma / ((g.gamma - 1) * etaPoly)),
    );
    out.push({
      placed: rotor,
      omega,
      inTotals: tNozzleOut,
      outTotals: tOut,
      rcIn: rc2,
      rcOut: rc3,
      gasIn: g,
      gasOut: g,
    });
    t = tOut;
    rc = rc3;
  }
  return out;
}

function meanlineRow(f: RowFlow): MeanlineRow {
  const { edges, component: c, spec } = f.placed;
  return {
    rowId: spec.id,
    component: c,
    omegaRadPerS: f.omega,
    inlet: plane(edges.leadingEdge, c, f.inTotals, f.rcIn, f.gasIn),
    exit: plane(edges.trailingEdge, c, f.outTotals, f.rcOut, f.gasOut),
    eulerWorkJPerKg: f.omega === 0 ? 0 : f.omega * (f.rcOut - f.rcIn),
  };
}

function bladeRow(f: RowFlow, m: MeanlineRow): BladeRow {
  const { spec, component: c, edges, tipClearance } = f.placed;
  const aero: RowAerodynamics = {
    omegaRadPerS: f.omega,
    inlet: { rcTheta: m.inlet.rcTheta, cxMPerS: m.inlet.cxMPerS },
    exit: { rcTheta: m.exit.rcTheta, cxMPerS: m.exit.cxMPerS },
    deviation: c === 'hpt' || c === 'lpt' ? 'none' : 'carter',
  };
  const shape =
    spec.count === undefined ? { targetSolidity: spec.targetSolidity ?? 1 } : { count: spec.count };
  const d = designRow(edges, aero, shape);
  const spool = component(c).spool;
  return {
    id: spec.id,
    name: spec.name,
    component: c,
    kind: spec.kind,
    spool: spec.kind === 'rotor' && spool !== null ? spool : 'none',
    count: d.count,
    countConfidence: spec.countConfidence ?? 'estimate',
    leadingEdge: edges.leadingEdge,
    trailingEdge: edges.trailingEdge,
    chord: d.chord,
    inletMetalAngle: d.inletMetalAngle,
    exitMetalAngle: d.exitMetalAngle,
    stagger: d.stagger,
    maxThicknessRatio: spec.thickness,
    sweep: Math.atan2(
      edges.leadingEdge.tip.x - edges.leadingEdge.hub.x,
      edges.leadingEdge.tip.r - edges.leadingEdge.hub.r,
    ),
    lean: 0,
    tipClearance,
    vsv: spec.vsv ?? null,
  };
}

function rowFlows(est: DesignPointEstimate): RowFlow[] {
  const s = est.stations;
  const omegaLp = rpmToRadPerS(DESIGN_POINT.n1Rpm) * v('rotationSense');
  const omegaHp = rpmToRadPerS(DESIGN_POINT.n2Rpm) * v('rotationSense');
  const totals = (id: keyof typeof s): Totals => ({
    wKgPerS: s[id].wKgPerS,
    ttK: s[id].ttK,
    ptPa: s[id].ptPa,
  });
  const w = est.specificWorkJPerKg;
  const eta = est.polytropicEfficiency;

  // fan: one rotor, no inlet swirl; its exit carries the mass-averaged work of both streams
  const fanRow = PLACED.fan[0];
  if (fanRow === undefined) throw new Error('definition: no fan row');
  const fanIn = totals('2');
  const pFanOut =
    (s['13'].wKgPerS * s['13'].ptPa + s['21'].wKgPerS * s['21'].ptPa) / s['2'].wKgPerS;
  const fanOut: Totals = {
    wKgPerS: fanIn.wKgPerS,
    ttK: fanIn.ttK + w.fan / COLD_GAS.cpJPerKgK,
    ptPa: pFanOut,
  };
  const rcFan = w.fan / omegaLp;
  const fan: RowFlow = {
    placed: fanRow,
    omega: omegaLp,
    inTotals: fanIn,
    outTotals: fanOut,
    rcIn: 0,
    rcOut: rcFan,
    gasIn: COLD_GAS,
    gasOut: COLD_GAS,
  };

  const ogvRow = PLACED.bypassDuct[0];
  if (ogvRow === undefined) throw new Error('definition: no OGV row');
  const ogv: RowFlow = {
    placed: ogvRow,
    omega: 0,
    inTotals: totals('13'),
    outTotals: totals('13'),
    rcIn: rcFan,
    rcOut: 0,
    gasIn: COLD_GAS,
    gasOut: COLD_GAS,
  };

  const hpt = turbineFlows(
    PLACED.hpt,
    omegaHp,
    totals('4'),
    totals('41'),
    0,
    w.hpt,
    REACTION.hpt,
    eta.hpt,
    false,
  );
  // r c_theta is conserved through the inter-turbine duct
  const rcHptExit = hpt[hpt.length - 1]?.rcOut ?? 0;
  const lpt = turbineFlows(
    PLACED.lpt,
    omegaLp,
    totals('45'),
    totals('45'),
    rcHptExit,
    w.lpt,
    REACTION.lpt,
    eta.lpt,
    true,
  );
  return [
    fan,
    ogv,
    ...compressorFlows(
      PLACED.booster,
      omegaLp,
      totals('21'),
      rcFan,
      w.booster,
      REACTION.booster,
      eta.booster,
    ),
    ...compressorFlows(PLACED.hpc, omegaHp, totals('25'), 0, w.hpc, REACTION.hpc, eta.hpc),
    ...hpt,
    ...lpt,
  ];
}

// ---------------------------------------------------------------------------------------
// Stations, schedules, bleeds

function placedRow(id: string): PlacedRow {
  for (const rows of Object.values(PLACED)) {
    const r = rows.find((p) => p.spec.id === id);
    if (r !== undefined) return r;
  }
  throw new Error(`definition: no row ${id}`);
}

const leX = (id: string) => placedRow(id).edges.leadingEdge.hub.x;
const teX = (id: string) => {
  const e = placedRow(id).edges.trailingEdge;
  return Math.max(e.hub.x, e.tip.x);
};

function stations(): StationPlane[] {
  const sp = (id: StationPlane['id'], x: number, c: ComponentId): StationPlane => ({
    id,
    x,
    component: c,
  });
  return [
    sp('1', HIGHLIGHT_X, 'inlet'),
    sp('2', 0, 'fan'),
    sp('13', 0.6, 'bypassDuct'),
    sp('18', NACELLE_TE_X, 'bypassDuct'),
    sp('19', NACELLE_TE_X, 'bypassDuct'),
    sp('21', SPLITTER_X + 0.005, 'booster'),
    sp('24', X.boosterEnd, 'booster'),
    sp('25', X.hpcStart, 'hpc'),
    sp('3', X.hpcEnd, 'hpc'),
    sp('4', X.combustorEnd, 'combustor'),
    sp('41', (teX('hpt-n1') + leX('hpt-r1')) / 2, 'hpt'),
    sp('45', X.lptStart, 'lpt'),
    // EGT probe plane: the LPT stage 2 nozzle (TCDS E.004 IV.1.1)
    sp('49.5', leX('lpt-n2'), 'lpt'),
    sp('5', X.lptEnd, 'lpt'),
    sp('8', CORE_LIP_X, 'exhaust'),
    sp('9', CORE_LIP_X, 'exhaust'),
  ];
}

function bleeds(): BleedPort[] {
  const hpc5 = (teX('hpc-s5') + leX('hpc-r6')) / 2;
  const hpc9 = (teX('hpc-s9') + X.hpcEnd) / 2;
  return [
    {
      id: 'bypass',
      name: 'Bypass duct bleed',
      kind: 'customer',
      component: 'bypassDuct',
      x: 0.7,
      maxFraction: v('bleedBypassMax'),
    },
    {
      id: 'hpc5',
      name: 'HPC 5th-stage bleed',
      kind: 'customer',
      component: 'hpc',
      x: hpc5,
      maxFraction: v('bleedHpc5Max'),
    },
    {
      id: 'hpc9',
      name: 'HPC 9th-stage bleed',
      kind: 'customer',
      component: 'hpc',
      x: hpc9,
      maxFraction: v('bleedHpc9MaxLow'),
    },
    {
      id: 'vbv',
      name: 'Variable bleed valves',
      kind: 'handling',
      component: 'transitionDuct',
      x: 0.66,
      maxFraction: v('vbvMaxFraction'),
    },
    {
      id: 'tbv',
      name: 'Transient bleed valve',
      kind: 'handling',
      component: 'hpc',
      x: hpc9,
      maxFraction: v('tbvMaxFraction'),
    },
    {
      id: 'turbineCooling',
      name: 'Turbine cooling air',
      kind: 'cooling',
      component: 'combustor',
      x: 1.5,
      maxFraction: v('turbineCoolingFraction'),
    },
  ];
}

// ---------------------------------------------------------------------------------------

export interface BuiltEngine {
  readonly definition: EngineDefinition;
  readonly meanline: readonly MeanlineRow[];
  readonly estimate: DesignPointEstimate;
}

/** Builds the engine from the facts (pure and deterministic; the exports below are one build). */
export function buildEngine(): BuiltEngine {
  const estimate = estimateDesignPoint(DESIGN_POINT, v('fuelLhv'));
  const flows = rowFlows(estimate);
  const meanline = flows.map(meanlineRow);
  const bladeRows = flows.map((f, i) => {
    const m = meanline[i];
    if (m === undefined) throw new Error('definition: meanline row missing');
    return bladeRow(f, m);
  });
  const sign = v('rotationSense') === -1 ? -1 : 1;
  const definition: EngineDefinition = {
    id: 'cfm56-7b27-class',
    name: 'CFM56-7B27-class turbofan',
    description:
      'Generic two-spool high-bypass turbofan sized to public CFM56-7B27/3 data (EASA TCDS E.004, ICAO EEDB 8CM066); representative flowpath, synthesized blades.',
    rotation: { lp: sign, hp: sign },
    flowpath: FLOWPATH,
    stations: stations(),
    bladeRows,
    vsvSchedules: [
      {
        id: VSV_SCHEDULE_ID,
        points: [
          { n2CorrectedPercent: v('vsvClosedBelowN2c'), closure: v('vsvMaxClosure') },
          { n2CorrectedPercent: v('vsvOpenAboveN2c'), closure: 0 },
        ],
      },
    ],
    bleeds: bleeds(),
    designPoint: DESIGN_POINT,
    ratings: {
      takeoffThrustN: v('takeoffThrust'),
      maxContinuousThrustN: v('maxContinuousThrust'),
      flatRatingTemperatureK: v('flatRatingTemperature'),
    },
    limits: {
      n1MaxRpm: v('n1MaxRpm'),
      n2MaxRpm: v('n2MaxRpm'),
      egtTakeoffRedlineK: v('egtTakeoffLimit'),
      egtMaxContinuousK: v('egtMaxContinuousLimit'),
      egtStartLimitK: v('egtStartLimit'),
      egtTransientK: v('egtTransientLimit'),
      egtTransientDurationS: v('egtTransientDuration'),
      egtShunt: {
        offsetK: v('egtShuntOffset'),
        rampStartN2Rpm: v('egtShuntRampStartN2'),
        fullN2Rpm: v('egtShuntFullN2'),
      },
    },
    startSchedule: {
      minFuelOnN2Percent: v('minFuelOnN2'),
      fuelOnN2Percent: v('startFuelOnN2'),
      starterCutoutN2Percent: v('starterCutoutN2'),
    },
  };
  return deepFreeze({ definition: structuredClone(definition), meanline, estimate });
}

const BUILT = buildEngine();

export const ENGINE_DEFINITION: EngineDefinition = BUILT.definition;
export const ENGINE_MEANLINE: readonly MeanlineRow[] = BUILT.meanline;
export const ENGINE_DESIGN_ESTIMATE: DesignPointEstimate = BUILT.estimate;
