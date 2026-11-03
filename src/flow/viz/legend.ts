// The flow legend (w2/flowviz round 2; the dataviz rules: a labelled continuous colour bar with
// round-number ticks, the unit, and the data's provenance on it). Pure: the look-dev page draws
// it as DOM, and the colour bar's stops come from the very LUT the cut plane samples, so the
// legend matches the pixels (D4-76: those colours composite after the tone map, unchanged).

import { ISA_SLS } from '../../contracts/ambient';
import type { FlowCoupling } from '../../contracts/flow';
import { bakeLut, niceTicks } from './colormaps';
import {
  AMBIENT_FLOOR_FRACTION,
  ambientFloor,
  ambientValue,
  FIELD_QUANTITIES,
  type FieldQuantityId,
} from './fields';
import { FLOW_VIZ_MODES, STREAK_EXPOSURE_S, STREAK_MAX_M, type FlowVizModeId } from './modes';

export interface LegendTick {
  readonly value: number;
  readonly label: string;
  /** Position along the bar, 0..1. */
  readonly at: number;
}

export interface LegendStop {
  readonly at: number;
  /** sRGB bytes (display-encoded, as drawn). */
  readonly rgb: readonly [number, number, number];
}

/**
 * W2V-I7 (D4-86): the band of the bar the cut plane does not draw (the ambient air, within
 * AMBIENT_FLOOR_FRACTION of the scale of its value), so the legend is honest about what the
 * floor hides: the bar marks it and the label says it.
 */
export interface LegendFloor {
  /** The band's ends along the bar, 0..1. */
  readonly from: number;
  readonly to: number;
  /**
   * "Not drawn in the dashed frame: 0 to 0.04 M (ambient ± 2.5 % of scale)" (W2V-N25: the crop's
   * dashed outline is the field's frame); one line in the legend.
   */
  readonly label: string;
}

export interface Legend {
  readonly title: string;
  readonly unit: string;
  readonly ticks: readonly LegendTick[];
  readonly stops: readonly LegendStop[];
  /** D4-82: how far the drawn field is the engine's answer (the badge under the bar). */
  readonly coupling: FlowCoupling;
  /** W2V-I7: what the cut plane leaves undrawn (null: the mode draws the whole scale). */
  readonly floor: LegendFloor | null;
}

const STOPS = 16;

/** niceTicks may step past the ends; a bar shows only the ticks on it. */
const inRange = (ticks: readonly number[], lo: number, hi: number): number[] => {
  const eps = 1e-9 * (hi - lo);
  return ticks.filter((v) => v >= lo - eps && v <= hi + eps);
};

/** A short number label: no trailing zeros, at most 3 significant digits. */
function numberLabel(v: number): string {
  if (v === 0) return '0';
  return String(Number(v.toPrecision(3)));
}

/** 2^k as a ratio: 4, 1, 1/4; non-integer k to 3 digits. */
function ratioLabel(k: number): string {
  if (!Number.isInteger(k)) return numberLabel(2 ** k);
  return k >= 0 ? String(2 ** k) : `1/${String(2 ** -k)}`;
}

const RATIO_UNIT: Partial<Record<FieldQuantityId, string>> = { p: 'p / p∞', rho: 'ρ / ρ∞' };

const FLOOR_PERCENT = `${String(100 * AMBIENT_FLOOR_FRACTION)} %`;

/**
 * The legend of a flow mode (null: the mode draws no colour), for `quantity` or the mode's own.
 * `tInfK` places the temperature's ambient floor (the static ISA day unless given).
 */
export function legendFor(
  mode: FlowVizModeId,
  coupling: FlowCoupling,
  quantity?: FieldQuantityId,
  tInfK: number = ISA_SLS.temperatureK,
): Legend | null {
  const m = FLOW_VIZ_MODES[mode];
  if (!m.legend) return null;
  if (m.schlieren) {
    const range = m.schlierenRangeRad * 1e6;
    const ticks = inRange(niceTicks(-range, range, 5), -range, range).map((v) => ({
      value: v,
      label: numberLabel(v),
      at: (v + range) / (2 * range),
    }));
    const stops = Array.from({ length: STOPS + 1 }, (_, i) => {
      const g = Math.round((255 * i) / STOPS);
      return { at: i / STOPS, rgb: [g, g, g] as const };
    });
    return {
      title: 'Schlieren: vertical deflection (knife edge horizontal)',
      unit: 'µrad',
      ticks,
      stops,
      coupling,
      floor: null,
    };
  }
  const id = quantity ?? m.quantity;
  const spec = FIELD_QUANTITIES[id];
  const lut = bakeLut(spec.colormap);
  const ratio = RATIO_UNIT[id];
  const ticks = inRange(niceTicks(spec.min, spec.max, 5), spec.min, spec.max).map((v) => ({
    value: v,
    label: ratio === undefined ? numberLabel(v) : ratioLabel(v),
    at: (v - spec.min) / (spec.max - spec.min),
  }));
  const stops = Array.from({ length: STOPS + 1 }, (_, i) => {
    const k = 4 * Math.round((255 * i) / STOPS);
    return { at: i / STOPS, rgb: [lut[k] ?? 0, lut[k + 1] ?? 0, lut[k + 2] ?? 0] as const };
  });
  const amb = ambientValue(id, { pInfPa: 1, rhoInfKgPerM3: 1, tInfK });
  const lo = Math.max(spec.min, amb - ambientFloor(id));
  const hi = Math.min(spec.max, amb + ambientFloor(id));
  const shown = (v: number) => numberLabel(ratio === undefined ? v : 2 ** v);
  const floor: LegendFloor = {
    from: (lo - spec.min) / (spec.max - spec.min),
    to: (hi - spec.min) / (spec.max - spec.min),
    label: `Not drawn in the dashed frame: ${shown(lo)} to ${shown(hi)} ${ratio ?? spec.unit} (ambient ± ${FLOOR_PERCENT} of scale)`,
  };
  return { title: spec.label, unit: ratio ?? spec.unit, ticks, stops, coupling, floor };
}

/**
 * What the badge on the legend and the flow panel says about the data (D4-82). The solver's
 * field is "uncoupled until W3": it runs without blade or combustor forces, so it is not this
 * engine's flow, and only W3's coupled field may read as the live answer. `fallback` is why a
 * MOCK stands in for the solver that was asked for (W2V-I6: visible, never silent).
 */
export function provenanceLabel(coupling: FlowCoupling, fallback: string | null = null): string {
  switch (coupling) {
    case 'coupled':
      return 'Live flow solver (GPU, 2D axisymmetric + swirl), coupled to the cycle';
    case 'calibrating':
      return "Flow solver calibrating to the cycle (GPU, 2D axisymmetric + swirl): blade and combustor forces on, not yet within L12's tolerances";
    case 'uncoupled':
      return 'Flow solver (uncoupled until W3): GPU, 2D axisymmetric + swirl; no blade or combustor forces';
    case 'mock':
      return fallback === null
        ? 'MOCK field (a synthetic stand-in, not simulated)'
        : `MOCK fallback (a synthetic stand-in): ${fallback}`;
  }
}

/** "x1/200": the dilation as a slow-motion factor. */
export function dilationLabel(dilation: number): string {
  return dilation >= 1 ? 'x1 (real time)' : `x1/${String(Math.round(1 / dilation))}`;
}

/**
 * What a mode shows and where each part comes from (the "What's simulated" line of the flow
 * panel, PHYSICS.md 1): every part is derived from the field, and `synthesized` is named.
 * `tracers` overrides the mode's default (D4-83: Realistic has none unless asked for).
 */
export function flowModeNote(
  mode: FlowVizModeId,
  dilation: number,
  quantity?: FieldQuantityId,
  tracers?: boolean,
): string {
  const m = FLOW_VIZ_MODES[mode];
  const parts: string[] = [];
  if (m.cutPlane)
    parts.push(
      `Cut plane: ${FIELD_QUANTITIES[quantity ?? m.quantity].label.toLowerCase()} of the field (air within ${FLOOR_PERCENT} of the scale of the ambient is not drawn)`,
    );
  if (m.particleOpacity > 0 && (tracers ?? m.tracersByDefault))
    parts.push(
      `${m.cutPlane ? 'laser-sheet tracers on the cut faces' : 'tracer streaks'} advected by its velocity, time ${dilationLabel(dilation)} (${String(STREAK_EXPOSURE_S)} s exposures, at most ${String(Math.round(STREAK_MAX_M * 100))} cm)`,
    );
  if (m.haze > 0)
    parts.push('heat haze from its density gradient (Gladstone-Dale; mean flow, no shimmer)');
  if (m.schlieren)
    parts.push(
      `knife-edge schlieren of its density (Gladstone-Dale, a/f ${String(Math.round(m.schlierenRangeRad * 1e6))} µrad; mean flow, no turbulence)`,
    );
  const synth =
    m.synthesized.length === 0
      ? 'The visuals add nothing synthesized.'
      : `The visuals synthesize: ${m.synthesized.join(', ')}.`;
  const s = parts.join('; ');
  return `${s.charAt(0).toUpperCase()}${s.slice(1)}. ${synth}`;
}
