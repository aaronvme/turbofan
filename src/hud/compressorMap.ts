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

export type MapPoint = readonly [correctedFlowKgPerS: number, pressureRatio: number];

export interface SpeedLine {
  /** % of the 100 % reference corrected speed. */
  readonly percent: number;
  readonly points: readonly MapPoint[];
}

export interface MapGeometry {
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
const SAMPLES = 24;

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
  return { speedLines, surgeLine, bounds: { wc: [w0, w1], pr: [1, p1] } };
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
