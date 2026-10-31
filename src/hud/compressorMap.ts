// The live compressor maps' geometry (fan and HPC): speed lines and the surge (stall R-line) line
// in the cycle model's own map frame, so the operating point the state reports
// (MapOperatingPoint.correctedFlowKgPerS, pressureRatio) lands on them exactly. The model's maps
// are the scaled pyCycle maps of the sized engine (src/cycle/engine.ts), not a picture of them.
//
// Speed lines are labelled in % of the 100 % reference corrected speed, the same scale as
// MapOperatingPoint.correctedSpeedFraction: the map's speed fraction f (of its design corrected
// speed) is c * referenceRpm / designCorrectedRpm.

import { compressorPoint, type ScaledCompressorMap } from '../cycle/componentMaps';
import type { MapOperatingPoint } from '../contracts/cycle';
import { UI_LEVELS } from './uiLevels';

export type MapPoint = readonly [correctedFlowKgPerS: number, pressureRatio: number];

export interface SpeedLine {
  /** % of the 100 % reference corrected speed. */
  readonly percent: number;
  readonly points: readonly MapPoint[];
}

export interface MapGeometry {
  /**
   * The map's lowest speed line, % of the reference speed: below it the model's point (and its
   * surge margin) is a similarity extrapolation (src/cycle/componentMaps.ts), not the map (D4-87).
   */
  readonly lowestPercent: number;
  readonly speedLines: readonly SpeedLine[];
  /** The stall R-line across the speeds, low flow to high. */
  readonly surgeLine: readonly MapPoint[];
  readonly bounds: {
    readonly wc: readonly [number, number];
    readonly pr: readonly [number, number];
  };
}

export interface MapFrame {
  readonly map: ScaledCompressorMap;
  /** The map's design corrected speed, rpm (SizedEngine.design.corrSpeed). */
  readonly designCorrectedRpm: number;
  /** The 100 % reference speed, rpm. */
  readonly referenceRpm: number;
}

export const SPEED_LINE_PERCENTS = [50, 60, 70, 80, 85, 90, 95, 100, 105] as const;
/** The round speed lines each chart draws above its map's lowest line (chartSpeedPercents). */
export const FAN_LINES = [40, 50, 60, 70, 80, 90, 100, 105] as const;
export const HPC_LINES = SPEED_LINE_PERCENTS;
/** A round line this close above the map's lowest line, %, is left out (their labels crowd). */
const MIN_LINE_GAP_PERCENT = 5;
const SAMPLES = 24;

/** The map's lowest speed line (its first corrected-speed node), % of the reference speed. */
export function lowestMapPercent(f: MapFrame): number {
  const m = f.map.map;
  return (100 * (m.nc[0] ?? m.design.nc) * f.designCorrectedRpm) / (m.design.nc * f.referenceRpm);
}

/**
 * The speed lines a chart draws (W2A-I2): the map's own lowest line, so the chart's range runs
 * down to where the map ends (the fan's idle point sits just below it), then the round lines
 * above it.
 */
export function chartSpeedPercents(f: MapFrame, round: readonly number[]): number[] {
  const low = lowestMapPercent(f);
  return [low, ...round.filter((p) => p >= low + MIN_LINE_GAP_PERCENT)];
}

/** Speed lines from the stall R-line to the map's last R-line, and the surge line. */
export function mapGeometry(
  f: MapFrame,
  percents: readonly number[] = SPEED_LINE_PERCENTS,
): MapGeometry {
  const r = f.map.map.rline;
  const rMin = f.map.map.rlineStall;
  const rMax = r[r.length - 1] ?? rMin;
  const toMap = (pct: number) => ((pct / 100) * f.referenceRpm) / f.designCorrectedRpm;
  const at = (pct: number, rl: number): MapPoint => {
    const p = compressorPoint(f.map, toMap(pct), rl);
    return [p.correctedFlow, p.pressureRatio];
  };
  const speedLines = percents.map((percent) => ({
    percent,
    points: Array.from({ length: SAMPLES + 1 }, (_, k) =>
      at(percent, rMin + ((rMax - rMin) * k) / SAMPLES),
    ),
  }));
  const lo = Math.min(...percents);
  const hi = Math.max(...percents);
  const surgeLine = Array.from({ length: SAMPLES + 1 }, (_, k) =>
    at(lo + ((hi - lo) * k) / SAMPLES, rMin),
  );
  let w0 = Infinity;
  let w1 = -Infinity;
  let p1 = -Infinity;
  for (const pts of [...speedLines.map((s) => s.points), surgeLine])
    for (const [w, pr] of pts) {
      w0 = Math.min(w0, w);
      w1 = Math.max(w1, w);
      p1 = Math.max(p1, pr);
    }
  return {
    lowestPercent: lowestMapPercent(f),
    speedLines,
    surgeLine,
    bounds: { wc: [w0, w1], pr: [1, p1] },
  };
}

/** A surge margin under this fraction is a caution on the map (U1, docs/PHYSICS.md 3.5). */
export const SM_CAUTION_FRACTION = UI_LEVELS.surgeMarginCautionFraction;

export interface SurgeMarginView {
  /**
   * D4-87: `belowMap` when the point is below the map's lowest speed line (an extrapolation,
   * dimmed, never amber or red); on the map, red at or past the surge line, amber under
   * SM_CAUTION_FRACTION.
   */
  readonly level: 'normal' | 'caution' | 'warning' | 'belowMap';
  readonly tag: 'below map' | null;
}

export function surgeMarginView(
  g: Pick<MapGeometry, 'lowestPercent'>,
  p: Pick<MapOperatingPoint, 'correctedSpeedFraction' | 'surgeMarginFraction'>,
): SurgeMarginView {
  if (!(100 * p.correctedSpeedFraction >= g.lowestPercent))
    return { level: 'belowMap', tag: 'below map' };
  const m = p.surgeMarginFraction;
  return {
    level: !(m > UI_LEVELS.surgeMarginWarningFraction)
      ? 'warning'
      : m < SM_CAUTION_FRACTION
        ? 'caution'
        : 'normal',
    tag: null,
  };
}

/**
 * Where a chart draws a point, px: where it is inside the plot, else on the plot's edge (inset
 * by `inset`) with the side it left by, so the chart can mark it off the map (W2A-I2). A
 * non-finite coordinate is off the plot too.
 */
export function plotPoint(
  x: number,
  y: number,
  plot: { readonly x: number; readonly y: number; readonly w: number; readonly h: number },
  inset: number,
): { x: number; y: number; off: { dx: -1 | 0 | 1; dy: -1 | 0 | 1 } | null } {
  const x0 = plot.x + inset;
  const x1 = plot.x + plot.w - inset;
  const y0 = plot.y + inset;
  const y1 = plot.y + plot.h - inset;
  const side = (v: number, lo: number, hi: number): -1 | 0 | 1 =>
    Number.isNaN(v) || v < lo ? -1 : v > hi ? 1 : 0;
  const dx = side(x, x0, x1);
  const dy = side(y, y0, y1);
  const clamp = (v: number, lo: number, hi: number) =>
    Number.isNaN(v) ? lo : Math.max(lo, Math.min(hi, v));
  return {
    x: clamp(x, x0, x1),
    y: clamp(y, y0, y1),
    off: dx === 0 && dy === 0 ? null : { dx, dy },
  };
}

/** A trail of recent operating points, newest last, at most `max` long (a new array). */
export function pushTrail(
  trail: readonly MapPoint[],
  p: Pick<MapOperatingPoint, 'correctedFlowKgPerS' | 'pressureRatio'>,
  max: number,
): MapPoint[] {
  const point: MapPoint = [p.correctedFlowKgPerS, p.pressureRatio];
  const last = trail[trail.length - 1];
  // a stopped engine sits still: do not fill the trail with copies of one point
  if (last !== undefined && last[0] === point[0] && last[1] === point[1]) return [...trail];
  const next = [...trail, point];
  return next.length > max ? next.slice(next.length - max) : next;
}

/** Linear scale of a value onto [0, size]; the range is padded by `pad` of its span on each side. */
export function scaleOf(
  domain: readonly [number, number],
  size: number,
  pad = 0,
): (v: number) => number {
  // a degenerate domain (one value) maps to the start instead of dividing by zero
  const span = domain[1] - domain[0] || 1;
  const d0 = domain[0] - pad * span;
  const d1 = domain[0] + (1 + pad) * span;
  return (v) => ((v - d0) / (d1 - d0)) * size;
}

/** Round axis ticks inside [lo, hi] (1, 2 or 5 times a power of ten apart), about `count` of them. */
export function niceTicks(lo: number, hi: number, count = 5): number[] {
  if (!(hi > lo) || !Number.isFinite(lo) || !Number.isFinite(hi)) return [];
  const raw = (hi - lo) / Math.max(1, count);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((k) => k * mag).find((s) => s >= raw) ?? 10 * mag;
  const ticks: number[] = [];
  for (let t = Math.ceil(lo / step) * step; t <= hi + 1e-9 * step; t += step)
    ticks.push(Number(t.toPrecision(12)));
  return ticks;
}

/** A speed line's label: its percent, drawn at the line's low-flow (stall) end, x and y in px. */
export interface SpeedLabel {
  readonly percent: number;
  readonly x: number;
  readonly y: number;
}

/**
 * Where the chart draws a label relative to its line end, and the text's size, px: right-aligned
 * 2 px to the left, baseline 3 px above, 8.5 px tabular digits (at most 5.2 px wide each).
 */
export const SPEED_LABEL = { dx: -2, dy: -3, digitW: 5.2, h: 8.5 } as const;

/** The box a label's text occupies, px. */
export function labelBox(l: SpeedLabel): { x: number; y: number; w: number; h: number } {
  const w = String(l.percent).length * SPEED_LABEL.digitW;
  return {
    x: l.x + SPEED_LABEL.dx - w,
    y: l.y + SPEED_LABEL.dy - SPEED_LABEL.h,
    w,
    h: SPEED_LABEL.h,
  };
}

/**
 * The speed-line labels that fit without overlapping, in the input order. Near design speed the
 * lines' stall ends crowd together (the HPC map's 95, 100 and 105 sit a few px apart), so the
 * round tens are placed first, high to low (100 before 90), then the others; a label whose box
 * comes within `gapPx` of a placed one is left out (its line is still drawn).
 */
export function placeSpeedLabels(anchors: readonly SpeedLabel[], gapPx = 2): SpeedLabel[] {
  const rank = (p: number) => (p % 10 === 0 ? 0 : 1);
  const order = [...anchors].sort(
    (a, b) => rank(a.percent) - rank(b.percent) || b.percent - a.percent,
  );
  const boxes: ReturnType<typeof labelBox>[] = [];
  const kept = new Set<SpeedLabel>();
  for (const a of order) {
    const p = labelBox(a);
    const clear = boxes.every(
      (q) =>
        p.x >= q.x + q.w + gapPx ||
        q.x >= p.x + p.w + gapPx ||
        p.y >= q.y + q.h + gapPx ||
        q.y >= p.y + p.h + gapPx,
    );
    if (!clear) continue;
    boxes.push(p);
    kept.add(a);
  }
  return anchors.filter((a) => kept.has(a));
}
