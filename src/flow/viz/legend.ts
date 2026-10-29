// The flow legend (w2/flowviz round 2; the dataviz rules: a labelled continuous colour bar with
// round-number ticks, the unit, and the data's provenance on it). Pure: the look-dev page draws
// it as DOM, and the colour bar's stops come from the very LUT the cut plane samples, so the
// legend matches the pixels (D4-76: those colours composite after the tone map, unchanged).

import type { FlowFieldSource } from '../../contracts/flow';
import { bakeLut, niceTicks } from './colormaps';
import { FIELD_QUANTITIES, type FieldQuantityId } from './fields';
import { FLOW_VIZ_MODES, type FlowVizModeId } from './modes';

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

export interface Legend {
  readonly title: string;
  readonly unit: string;
  readonly ticks: readonly LegendTick[];
  readonly stops: readonly LegendStop[];
  readonly source: FlowFieldSource;
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

/** The legend of a flow mode (null: the mode draws no colour), for `quantity` or the mode's own. */
export function legendFor(
  mode: FlowVizModeId,
  source: FlowFieldSource,
  quantity?: FieldQuantityId,
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
      source,
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
  return { title: spec.label, unit: ratio ?? spec.unit, ticks, stops, source };
}

/** What the badge on the legend and the flow panel says about the data. */
export function provenanceLabel(source: FlowFieldSource): string {
  return source === 'solver'
    ? 'Live flow solver (GPU, 2D axisymmetric + swirl)'
    : 'MOCK field (a synthetic stand-in, not simulated)';
}

/** "x1/200": the dilation as a slow-motion factor. */
export function dilationLabel(dilation: number): string {
  return dilation >= 1 ? 'x1 (real time)' : `x1/${String(Math.round(1 / dilation))}`;
}

/**
 * What a mode shows and where each part comes from (the "What's simulated" line of the flow
 * panel, PHYSICS.md 1): every part is derived from the field, and `synthesized` is named.
 */
export function flowModeNote(
  mode: FlowVizModeId,
  dilation: number,
  quantity?: FieldQuantityId,
): string {
  const m = FLOW_VIZ_MODES[mode];
  const parts: string[] = [];
  if (m.cutPlane)
    parts.push(
      `Cut plane: ${FIELD_QUANTITIES[quantity ?? m.quantity].label.toLowerCase()} of the field`,
    );
  if (m.particleOpacity > 0)
    parts.push(
      `${m.cutPlane ? 'laser-sheet tracers on the cut faces' : 'tracer streaks'} advected by its velocity, time ${dilationLabel(dilation)}`,
    );
  if (m.haze > 0) parts.push('heat haze from its density gradient (Gladstone-Dale)');
  if (m.schlieren)
    parts.push(
      `knife-edge schlieren of its density (Gladstone-Dale, a/f ${String(Math.round(m.schlierenRangeRad * 1e6))} µrad; mean flow, no turbulence)`,
    );
  const synth =
    m.synthesized.length === 0 ? 'nothing synthesized' : `synthesized: ${m.synthesized.join(', ')}`;
  const s = parts.join('; ');
  return `${s.charAt(0).toUpperCase()}${s.slice(1)}. Derived from the field; ${synth}.`;
}
