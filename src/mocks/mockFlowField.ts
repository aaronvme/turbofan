// MOCK flow field: a synthetic meridional field in the exact render-texture layout of the
// flow solver contract (src/contracts/flow.ts: near and far extents, rgba16float state =
// (p - p_inf)/p_inf, (rho - rho_inf)/rho_inf, T, FAR and velocity = u_x, u_r, u_theta,
// fluid fraction; decision D0-4). The particles, cut planes, schlieren and haze can be built
// on it before the W2 solver exists. It is not a solution of the flow equations; the UI must
// label it MOCK.
//
// Pieces, each driven by the (mock or real) CycleState and the engine definition:
// - Ducts: the station totals interpolated along x, the static state from continuity with
//   the local annulus area (subsonic branch), u_r following the walls.
// - Fan swirl: free vortex r u_theta = w_fan / omega between the fan and the OGV / booster
//   IGV, in the rotation direction (Euler work).
// - Intake: a point sink at the highlight drawing the engine flow over a hemisphere, capped
//   at the intake entry velocity.
// - Jets: bypass and core jets, fully expanded, with erf shear layers near the nozzles
//   (potential core about 6 D) blending into self-similar Gaussian jets with the round-jet
//   spreading rate dr_1/2/dx = 0.094 and momentum-conserving centreline decay; the two
//   excesses add in quadrature (momentum flux).
// CpuFlowField is what writeTexture uploads; the W2 flowviz code turns it into FlowField.

import { R_AIR, type AmbientConditions } from '../contracts/ambient';
import type { CycleState, StationState } from '../contracts/cycle';
import { radiusAt, type EngineDefinition, type Polyline } from '../contracts/engine';
import {
  FIELD_EXTENTS,
  fieldReferenceFromAmbient,
  rasterizeField,
  type CpuFieldTextures,
  type CpuFlowField,
  type FieldExtent,
  type FieldExtentId,
  type FieldSample,
} from '../contracts/flow';
import type { PlaneStationId } from '../contracts/stations';
import { axialVelocity } from '../engine/bladeDesign';
import { COLD_GAS, HOT_GAS, type GasSection } from '../engine/designPoint';
import { rpmToRadPerS } from '../engine/units';
import { MOCK_LABEL } from './mockCycle';

export interface MockCpuFlowField extends CpuFlowField {
  readonly label: typeof MOCK_LABEL;
  readonly extents: Readonly<Record<FieldExtentId, FieldExtent>>;
  readonly version: number;
}

export interface MockFlowModel {
  /** The field at (x, r); smoothingM > 0 blurs the fluid fraction over that width (a texel). */
  sample(x: number, r: number, smoothingM?: number): FieldSample;
}

export interface MockFlowOptions {
  readonly version?: number;
}

/** Round-jet spreading rate dr_1/2/dx (PHYSICS.md L11 range 0.086-0.096). */
const SPREADING_RATE = 0.094;
/** Gaussian sigma growth for that spreading rate: r_1/2 = sigma sqrt(2 ln 2). */
const FAR_SIGMA_RATE = SPREADING_RATE / Math.sqrt(2 * Math.LN2);
/** Shear-layer sigma growth that keeps a round jet's centreline above 0.95 U_j for 6 D. */
const NEAR_SIGMA_RATE = 0.0425;
const POTENTIAL_CORE_DIAMETERS = 6;
const SLOPE_STEP = 1e-3;

/** Abramowitz & Stegun 7.1.26, |error| < 1.5e-7. */
function erf(x: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-x * x);
  return x >= 0 ? y : -y;
}

const smoothstep = (t: number) => {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
};

function first(curve: Polyline): { x: number; r: number } {
  const p = curve.points[0];
  if (p === undefined) throw new Error('mockFlowField: empty curve');
  return p;
}

function last(curve: Polyline): { x: number; r: number } {
  const p = curve.points[curve.points.length - 1];
  if (p === undefined) throw new Error('mockFlowField: empty curve');
  return p;
}

/** dr/dx of a curve at x (one-sided at its ends); 0 outside it. */
function slopeAt(curve: Polyline, x: number): number {
  const x0 = Math.max(first(curve).x, x - SLOPE_STEP);
  const x1 = Math.min(last(curve).x, x + SLOPE_STEP);
  const r0 = radiusAt(curve, x0);
  const r1 = radiusAt(curve, x1);
  return r0 === null || r1 === null || x1 <= x0 ? 0 : (r1 - r0) / (x1 - x0);
}

interface StationPoint {
  readonly x: number;
  readonly s: StationState;
}

interface DuctFlow {
  readonly cx: number;
  readonly ttK: number;
  readonly ptPa: number;
  readonly far: number;
  readonly gas: GasSection;
}

interface Jet {
  readonly xExit: number;
  readonly outerR: number;
  /** Inner boundary at x: a wall up to wallEndX, then a free shear layer at innerRAfter. */
  readonly innerR: (x: number) => number;
  readonly wallEndX: number;
  readonly eqRadius: number;
  readonly potentialCore: number;
  readonly farOrigin: number;
  readonly excessU: number;
  readonly excessT0: number;
  readonly far: number;
}

/** Fully expanded jet velocity from nozzle totals to the ambient static pressure. */
function jetVelocity(s: StationState, pInf: number, gas: GasSection): number {
  if (!(s.ptPa > pInf)) return 0;
  const k = (gas.gamma - 1) / gas.gamma;
  return Math.sqrt(2 * gas.cpJPerKgK * s.ttK * (1 - (pInf / s.ptPa) ** k));
}

/** Jet shape at (x, r) in [0, 1]: erf shear layers near the exit, a Gaussian far away. */
function jetShape(j: Jet, x: number, r: number): number {
  const s = x - j.xExit;
  if (s <= 0) return 0;
  const sigmaOuter = NEAR_SIGMA_RATE * s;
  const a = j.innerR(x);
  let near: number;
  if (a <= 0) {
    // round jet: mirror about the axis
    near =
      0.5 *
      (erf((r + j.outerR) / (Math.SQRT2 * sigmaOuter)) -
        erf((r - j.outerR) / (Math.SQRT2 * sigmaOuter)));
  } else {
    const outer = 0.5 * (1 - erf((r - j.outerR) / (Math.SQRT2 * sigmaOuter)));
    const si = NEAR_SIGMA_RATE * (x - j.wallEndX);
    const inner = si <= 0 ? (r >= a ? 1 : 0) : 0.5 * (1 + erf((r - a) / (Math.SQRT2 * si)));
    near = outer * inner;
  }
  const w = smoothstep((s - 0.5 * j.potentialCore) / j.potentialCore);
  if (w === 0) return near;
  const sigmaFar = FAR_SIGMA_RATE * (s + j.farOrigin);
  const far = Math.min(1, j.eqRadius / sigmaFar) * Math.exp(-(r * r) / (2 * sigmaFar * sigmaFar));
  return (1 - w) * near + w * far;
}

function makeJet(
  xExit: number,
  outerR: number,
  innerAtExit: number,
  innerR: (x: number) => number,
  wallEndX: number,
  excessU: number,
  excessT0: number,
  far: number,
): Jet {
  const eqRadius = Math.sqrt(Math.max(0, outerR * outerR - innerAtExit * innerAtExit));
  const potentialCore = POTENTIAL_CORE_DIAMETERS * 2 * eqRadius;
  return {
    xExit,
    outerR,
    innerR,
    wallEndX,
    eqRadius,
    potentialCore,
    // the far-field centreline reaches U_j exactly at the end of the potential core
    farOrigin: eqRadius / FAR_SIGMA_RATE - potentialCore,
    excessU,
    excessT0,
    far,
  };
}

/** Builds the mock field model for one cycle state. */
export function createMockFlowModel(
  def: EngineDefinition,
  state: CycleState,
  ambient: AmbientConditions,
): MockFlowModel {
  const c = def.flowpath.curves;
  const cold = COLD_GAS;
  const ref = fieldReferenceFromAmbient(ambient);
  const kCold = cold.gamma / (cold.gamma - 1);
  const ram = 1 + ((cold.gamma - 1) / 2) * ambient.machNumber ** 2;
  const t0Inf = ambient.temperatureK * ram;
  const p0Inf = ambient.pressurePa * ram ** kCold;
  const uInf = ambient.machNumber * Math.sqrt(cold.gamma * R_AIR * ambient.temperatureK);
  const st = state.stations;

  const stationX = new Map(def.stations.map((s) => [s.id, s.x]));
  const points = (ids: readonly PlaneStationId[]): StationPoint[] =>
    ids.map((id) => ({ x: stationX.get(id) ?? 0, s: st[id] }));
  const coreLine = points(['1', '2', '21', '24', '25', '3', '4', '41', '45', '49.5', '5', '8']);
  const bypassLine = points(['1', '2', '13', '18']);

  const highlight = first(c.nacelleInner);
  const nacelleTe = last(c.nacelleInner);
  const splitter = first(c.coreOuter);
  const coreLip = last(c.coreOuter);
  const spinnerNose = first(c.spinner);
  const plugTip = last(c.plug);
  const cowlEnd = last(c.coreCowl);

  const body = (x: number): number | null =>
    x < spinnerNose.x || x > plugTip.x
      ? null
      : (radiusAt(c.spinner, x) ?? radiusAt(c.coreInner, x) ?? radiusAt(c.plug, x));
  const coreHub = (x: number) => radiusAt(c.coreInner, x) ?? radiusAt(c.plug, x);

  /** Station totals interpolated linearly along x. */
  function totalsAt(line: StationPoint[], x: number): StationState {
    let a = line[0];
    let b = line[1];
    for (let i = 1; i < line.length; i++) {
      const p = line[i];
      const q = line[i - 1];
      if (p === undefined || q === undefined) continue;
      a = q;
      b = p;
      if (x <= p.x) break;
    }
    if (a === undefined || b === undefined) throw new Error('mockFlowField: empty station line');
    const t = b.x > a.x ? Math.min(1, Math.max(0, (x - a.x) / (b.x - a.x))) : 1;
    const lerp = (u: number, v: number) => u + t * (v - u);
    return {
      ptPa: lerp(a.s.ptPa, b.s.ptPa),
      ttK: lerp(a.s.ttK, b.s.ttK),
      wKgPerS: lerp(a.s.wKgPerS, b.s.wKgPerS),
      fuelAirRatio: lerp(a.s.fuelAirRatio, b.s.fuelAirRatio),
    };
  }

  /** Interpolated totals, then continuity through the area (subsonic branch). */
  function duct(line: StationPoint[], x: number, area: number, wOverride?: number): DuctFlow {
    const tot = totalsAt(line, x);
    const gas = tot.fuelAirRatio > 0 ? HOT_GAS : cold;
    const v = axialVelocity({
      wKgPerS: wOverride ?? tot.wKgPerS,
      ttK: tot.ttK,
      ptPa: tot.ptPa,
      areaM2: area,
      cThetaMPerS: 0,
      gas,
    });
    return { cx: v.cxMPerS, ttK: tot.ttK, ptPa: tot.ptPa, far: tot.fuelAirRatio, gas };
  }

  // fan swirl: r u_theta from the Euler work of the fan, ramped across the rows
  const omegaLp = def.rotation.lp * rpmToRadPerS(state.n1Rpm);
  const w2 = st['2'].wKgPerS;
  const fanWork =
    w2 > 0
      ? (cold.cpJPerKgK *
          (st['13'].wKgPerS * (st['13'].ttK - st['2'].ttK) +
            st['21'].wKgPerS * (st['21'].ttK - st['2'].ttK))) /
        w2
      : 0;
  const rcThetaFan = Math.abs(omegaLp) > 1e-9 ? fanWork / omegaLp : 0;
  const rowSpan = (component: string) => {
    const rows = def.bladeRows
      .filter((row) => row.component === component)
      .sort((p, q) => p.leadingEdge.hub.x - q.leadingEdge.hub.x);
    const row = rows[0];
    if (row === undefined) return null;
    return {
      le: Math.min(row.leadingEdge.hub.x, row.leadingEdge.tip.x),
      te: Math.max(row.trailingEdge.hub.x, row.trailingEdge.tip.x),
    };
  };
  const fanRow = rowSpan('fan');
  const ogvRow = rowSpan('bypassDuct');
  const igvRow = rowSpan('booster');
  const swirlWeight = (x: number, downstream: { le: number; te: number } | null): number => {
    if (fanRow === null || x <= fanRow.le) return 0;
    if (x < fanRow.te) return (x - fanRow.le) / (fanRow.te - fanRow.le);
    if (downstream === null || x <= downstream.le) return 1;
    if (x < downstream.te) return (downstream.te - x) / (downstream.te - downstream.le);
    return 0;
  };

  // intake sink and jets
  const sinkQ = w2 / ref.rhoInfKgPerM3;
  const intakeArea = Math.PI * highlight.r * highlight.r;
  const intakeU = duct(coreLine, highlight.x, intakeArea).cx;
  const bypassU = jetVelocity(st['18'], ambient.pressurePa, cold);
  const coreU = jetVelocity(st['8'], ambient.pressurePa, HOT_GAS);
  const cowlAt = (x: number) =>
    x <= cowlEnd.x ? (radiusAt(c.coreCowl, x) ?? cowlEnd.r) : cowlEnd.r;
  const plugAt = (x: number) => (x <= plugTip.x ? (radiusAt(c.plug, x) ?? 0) : 0);
  const jets: readonly Jet[] = [
    makeJet(
      nacelleTe.x,
      nacelleTe.r,
      cowlAt(nacelleTe.x),
      cowlAt,
      cowlEnd.x,
      bypassU - uInf,
      st['18'].ttK - t0Inf,
      0,
    ),
    makeJet(
      coreLip.x,
      coreLip.r,
      plugAt(coreLip.x),
      plugAt,
      plugTip.x,
      coreU - uInf,
      st['8'].ttK - t0Inf,
      st['8'].fuelAirRatio,
    ),
  ];

  // per-x cache: rasterizeField walks x in the outer loop
  interface Column {
    readonly x: number;
    readonly body: number | null;
    readonly nacIn: number | null;
    readonly nacOut: number | null;
    readonly casingIn: number | null;
    readonly casingOut: number | null;
    readonly core: (DuctFlow & { rh: number; rc: number; sh: number; sc: number }) | null;
    readonly bypass: (DuctFlow & { rh: number; rc: number; sh: number; sc: number }) | null;
    readonly common:
      | (DuctFlow & {
          rh: number;
          rc: number;
          sh: number;
          sc: number;
          split: number;
          coreSide: StationState;
          bypassSide: StationState;
        })
      | null;
    readonly swirlCore: number;
    readonly swirlBypass: number;
  }
  let column: Column | null = null;

  function columnAt(x: number): Column {
    if (column?.x === x) return column;
    const inNacelle = x >= highlight.x && x <= nacelleTe.x;
    const inCasing = x >= splitter.x && x <= coreLip.x;
    const nacIn = inNacelle ? radiusAt(c.nacelleInner, x) : null;
    const nacOut = inNacelle ? radiusAt(c.nacelleOuter, x) : null;
    const casingIn = inCasing ? radiusAt(c.coreOuter, x) : null;
    const casingOut = inCasing ? radiusAt(c.coreCowl, x) : null;
    const b = body(x);
    let core: Column['core'] = null;
    let bypass: Column['bypass'] = null;
    let common: Column['common'] = null;
    if (inCasing && casingIn !== null) {
      const rh = coreHub(x) ?? 0;
      const hubCurve = x <= last(c.coreInner).x ? c.coreInner : c.plug;
      core = {
        ...duct(coreLine, x, Math.PI * (casingIn * casingIn - rh * rh)),
        rh,
        rc: casingIn,
        sh: slopeAt(hubCurve, x),
        sc: slopeAt(c.coreOuter, x),
      };
    }
    if (x >= splitter.x && x <= nacelleTe.x && casingOut !== null && nacIn !== null) {
      bypass = {
        ...duct(bypassLine, x, Math.PI * (nacIn * nacIn - casingOut * casingOut)),
        rh: casingOut,
        rc: nacIn,
        sh: slopeAt(c.coreCowl, x),
        sc: slopeAt(c.nacelleInner, x),
      };
    }
    if (x >= highlight.x && x < splitter.x && nacIn !== null) {
      // intake and fan: one stream ahead of the fan, split by the dividing streamline behind
      const rh = b ?? 0;
      const area = Math.PI * (nacIn * nacIn - rh * rh);
      const hubAtFace = radiusAt(c.coreInner, 0) ?? 0;
      const tipAtFace = radiusAt(c.nacelleInner, 0) ?? nacIn;
      const coreShare = st['2'].wKgPerS > 0 ? st['21'].wKgPerS / st['2'].wKgPerS : 0;
      const splitAtFace = Math.sqrt(hubAtFace ** 2 + coreShare * (tipAtFace ** 2 - hubAtFace ** 2));
      const t = Math.max(0, x / splitter.x);
      const hubCurve = x < 0 ? c.spinner : c.coreInner;
      common = {
        ...duct(coreLine, x, area, w2),
        rh,
        rc: nacIn,
        sh: x < spinnerNose.x ? 0 : slopeAt(hubCurve, x),
        sc: slopeAt(c.nacelleInner, x),
        split: splitAtFace + t * (splitter.r - splitAtFace),
        // behind the fan face each side of the dividing streamline heads for its own station
        coreSide: x > 0 ? totalsAt(coreLine, x) : st['2'],
        bypassSide: x > 0 ? totalsAt(bypassLine, x) : st['2'],
      };
    }
    column = {
      x,
      body: b,
      nacIn,
      nacOut,
      casingIn,
      casingOut,
      core,
      bypass,
      common,
      swirlCore: rcThetaFan * swirlWeight(x, igvRow),
      swirlBypass: rcThetaFan * swirlWeight(x, ogvRow),
    };
    return column;
  }

  /** Signed radial distance to the nearest solid, positive in the fluid. */
  function wallDistance(col: Column, r: number): number {
    const band = (inner: number | null, outer: number | null) => {
      if (inner === null || outer === null) return Number.POSITIVE_INFINITY;
      if (r < inner) return inner - r;
      if (r > outer) return r - outer;
      return -Math.min(r - inner, outer - r);
    };
    const dBody = col.body === null ? Number.POSITIVE_INFINITY : r - col.body;
    return Math.min(dBody, band(col.nacIn, col.nacOut), band(col.casingIn, col.casingOut));
  }

  function ductSample(
    d: DuctFlow & { rh: number; rc: number; sh: number; sc: number },
    r: number,
    rcTheta: number,
    tt: number,
    pt: number,
  ): Omit<FieldSample, 'fluidFraction'> {
    const eta = d.rc > d.rh ? Math.min(1, Math.max(0, (r - d.rh) / (d.rc - d.rh))) : 0;
    const ux = d.cx;
    const ur = ux * ((1 - eta) * d.sh + eta * d.sc);
    const ut = rcTheta === 0 ? 0 : rcTheta / Math.max(r, 1e-3);
    const tK = tt - (ux * ux + ut * ut) / (2 * d.gas.cpJPerKgK);
    const pPa = pt * (tK / tt) ** (d.gas.gamma / (d.gas.gamma - 1));
    return {
      pPa,
      rhoKgPerM3: pPa / (R_AIR * tK),
      tK,
      fuelAirRatio: d.far,
      uxMPerS: ux,
      urMPerS: ur,
      uthetaMPerS: ut,
    };
  }

  function externalSample(x: number, r: number): Omit<FieldSample, 'fluidFraction'> {
    // intake sink over a hemisphere, capped at the intake entry velocity
    const dx = highlight.x - x;
    const d = Math.hypot(dx, r);
    let sx = 0;
    let sr = 0;
    if (sinkQ > 0) {
      const speed = Math.min(sinkQ / (2 * Math.PI * d * d), intakeU);
      sx = d > 0 ? (speed * dx) / d : speed;
      sr = d > 0 ? (-speed * r) / d : 0;
    }
    let du2 = 0;
    let dT0 = 0;
    let far = 0;
    for (const j of jets) {
      const f = jetShape(j, x, r);
      if (f === 0) continue;
      du2 += (j.excessU * f) ** 2;
      dT0 += j.excessT0 * f;
      far += j.far * f;
    }
    const potential2 = (uInf + sx) ** 2 + sr * sr;
    const ux = uInf + sx + Math.sqrt(du2);
    const tK = t0Inf + dT0 - (ux * ux + sr * sr) / (2 * cold.cpJPerKgK);
    const pPa = p0Inf * Math.max(1e-6, 1 - potential2 / (2 * cold.cpJPerKgK * t0Inf)) ** kCold;
    return {
      pPa,
      rhoKgPerM3: pPa / (R_AIR * tK),
      tK,
      fuelAirRatio: far,
      uxMPerS: ux,
      urMPerS: sr,
      uthetaMPerS: 0,
    };
  }

  return {
    sample(x: number, r: number, smoothingM = 0): FieldSample {
      const col = columnAt(x);
      const dWall = wallDistance(col, r);
      const fluidFraction =
        smoothingM > 0
          ? Math.min(1, Math.max(0, 0.5 + dWall / smoothingM))
          : dWall > 0
            ? 1
            : dWall < 0
              ? 0
              : 0.5;
      let s: Omit<FieldSample, 'fluidFraction'>;
      if (col.core !== null && r >= col.core.rh && r <= col.core.rc) {
        s = ductSample(col.core, r, col.swirlCore, col.core.ttK, col.core.ptPa);
      } else if (col.bypass !== null && r >= col.bypass.rh && r <= col.bypass.rc) {
        s = ductSample(col.bypass, r, col.swirlBypass, col.bypass.ttK, col.bypass.ptPa);
      } else if (col.common !== null && r >= col.common.rh && r <= col.common.rc) {
        const coreSide = r < col.common.split;
        const side = x <= 0 ? null : coreSide ? col.common.coreSide : col.common.bypassSide;
        const swirl = coreSide ? col.swirlCore : col.swirlBypass;
        s = ductSample(
          col.common,
          r,
          swirl,
          side?.ttK ?? col.common.ttK,
          side?.ptPa ?? col.common.ptPa,
        );
      } else {
        s = externalSample(x, r);
      }
      // + 0 turns -0 into +0, so an ambient texel encodes as all-zero bits
      return {
        pPa: s.pPa + 0,
        rhoKgPerM3: s.rhoKgPerM3 + 0,
        tK: s.tK + 0,
        fuelAirRatio: s.fuelAirRatio + 0,
        uxMPerS: s.uxMPerS + 0,
        urMPerS: s.urMPerS + 0,
        uthetaMPerS: s.uthetaMPerS + 0,
        fluidFraction,
      };
    },
  };
}

/** The MOCK field rasterized into both render extents (raw f16 texel data). */
export function createMockFlowField(
  def: EngineDefinition,
  state: CycleState,
  ambient: AmbientConditions,
  options: MockFlowOptions = {},
): MockCpuFlowField {
  const model = createMockFlowModel(def, state, ambient);
  const reference = fieldReferenceFromAmbient(ambient);
  const raster = (e: FieldExtent): CpuFieldTextures => {
    const texel = (e.rMax - e.rMin) / e.height;
    return rasterizeField(e, reference, (x, r) => model.sample(x, r, texel));
  };
  return {
    label: MOCK_LABEL,
    source: 'mock',
    reference,
    extents: FIELD_EXTENTS,
    near: raster(FIELD_EXTENTS.near),
    far: raster(FIELD_EXTENTS.far),
    version: options.version ?? 0,
  };
}
