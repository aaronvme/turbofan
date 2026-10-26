// Validity of a benchmark run (D0-1, W0G-I1). Frame deltas are judged against the display's
// refresh interval, never against the run's own median: a run that is entirely at 1 Hz has a
// median of ~1016 ms and would otherwise look steady.
//
// Why rAF rate and not page visibility: Playwright launches Chrome with
// --disable-backgrounding-occluded-windows and --disable-renderer-backgrounding, so an occluded
// or unfocused window stays visibilityState === 'visible' while Chrome throttles its rAF to
// about 1 Hz (the official 80k-16x8 row, 2026-10-25 22:18). The rAF rate is what we can see.

import { median } from './stats.ts';

/** A delta over 1.5 display intervals: at least one missed vsync. */
export const LONG_FRAME_FACTOR = 1.5;
/**
 * A delta over 2.5 display intervals counts as throttled: more than two intervals, with half
 * an interval of margin so a single missed vsync under load (about 2 intervals, with jitter)
 * never counts. A load can still miss 2-3 vsyncs in a frame; it does not do so for long.
 */
export const THROTTLE_FACTOR = 2.5;
/**
 * A run is invalid once consecutive throttled deltas span more than this. The official
 * main-react60 run (heavy main-thread load) has single 50-67 ms frames, far below it; a 1 Hz
 * throttle exceeds it with one frame.
 */
export const MAX_THROTTLED_STRETCH_MS = 500;
/**
 * A run is invalid when its median delta exceeds 1.5 display intervals: most frames missed
 * vsync, as under a 30 Hz throttle (e.g. Chrome's energy saver), whose 2-interval deltas stay
 * below THROTTLE_FACTOR.
 */
export const MAX_MEDIAN_FACTOR = 1.5;

/** Plausible display refresh rates; outside them the probe did not see the display's rate. */
const MIN_HZ = 24;
const MAX_HZ = 500;
const MIN_PROBE_DELTAS = 10;

export interface FrameHealth {
  /** Deltas over LONG_FRAME_FACTOR display intervals. */
  readonly longFrames: number;
  /** Total time in deltas over THROTTLE_FACTOR display intervals. */
  readonly throttledMs: number;
  /** The longest span of consecutive throttled deltas. */
  readonly longestThrottledMs: number;
}

export function frameHealth(deltas: readonly number[], displayIntervalMs: number): FrameHealth {
  if (!(displayIntervalMs > 0)) throw new Error(`bad display interval ${displayIntervalMs}`);
  const longAbove = LONG_FRAME_FACTOR * displayIntervalMs;
  const throttledAbove = THROTTLE_FACTOR * displayIntervalMs;
  let longFrames = 0;
  let throttledMs = 0;
  let stretch = 0;
  let longestThrottledMs = 0;
  for (const d of deltas) {
    if (d > longAbove) longFrames++;
    if (d > throttledAbove) {
      throttledMs += d;
      stretch += d;
      longestThrottledMs = Math.max(longestThrottledMs, stretch);
    } else {
      stretch = 0;
    }
  }
  return { longFrames, throttledMs, longestThrottledMs };
}

/**
 * The display's refresh interval from an idle rAF probe (median delta). Refuses a probe that
 * ran throttled: the official sweep must not start with Chrome in the background.
 */
export function displayIntervalMs(probeDeltas: readonly number[]): number {
  if (probeDeltas.length < MIN_PROBE_DELTAS) {
    throw new Error(
      `display probe saw ${probeDeltas.length} frames (need ${MIN_PROBE_DELTAS}): is Chrome in the foreground?`,
    );
  }
  const p = median(probeDeltas);
  if (p < 1000 / MAX_HZ || p > 1000 / MIN_HZ) {
    throw new Error(
      `display probe: rAF every ${p.toFixed(1)} ms (${(1000 / p).toFixed(1)} Hz), outside ` +
        `${MIN_HZ}-${MAX_HZ} Hz: Chrome is not in the foreground, or the display is off`,
    );
  }
  return p;
}

export interface Validity {
  readonly valid: boolean;
  readonly reasons: readonly string[];
}

/** What the gate reads from a RunResult (spikes/lib/benchRun.ts). */
export interface RunFrames {
  readonly frameTime: { readonly p50: number };
  readonly longestThrottledMs: number;
  readonly displayIntervalMs: number;
}

export function runValidity(run: RunFrames, pageHiddenMs: number): Validity {
  const reasons: string[] = [];
  const p = run.displayIntervalMs;
  if (run.longestThrottledMs > MAX_THROTTLED_STRETCH_MS) {
    reasons.push(
      `rAF interval over ${THROTTLE_FACTOR} display intervals (${(THROTTLE_FACTOR * p).toFixed(1)} ms) ` +
        `for ${run.longestThrottledMs.toFixed(0)} ms in a row: window occluded or unfocused, or a stall`,
    );
  }
  if (run.frameTime.p50 > MAX_MEDIAN_FACTOR * p) {
    reasons.push(
      `median frame ${run.frameTime.p50.toFixed(1)} ms over ${MAX_MEDIAN_FACTOR} display intervals ` +
        `(${p.toFixed(1)} ms): rAF below the display rate (a throttle, or a load that cannot hold it)`,
    );
  }
  if (pageHiddenMs > 0) reasons.push(`page hidden ${pageHiddenMs.toFixed(0)} ms`);
  return { valid: reasons.length === 0, reasons };
}

export function combineValidity(parts: readonly Validity[]): Validity {
  const reasons = parts.flatMap((v) => v.reasons);
  return { valid: parts.every((v) => v.valid), reasons };
}
