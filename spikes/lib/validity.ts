// Validity of a benchmark run (D0-1, W0G-I1; D2-11 as amended by D3-6). Frame deltas are judged
// against the display's refresh interval, never against the run's own median: a run that is
// entirely at 1 Hz has a median of ~1016 ms and would otherwise look steady.
//
// D3-6: a run is INVALID only on the occlusion signature (rAF intervals of 500 ms or more,
// sustained: Chrome's ~1 Hz background throttle) or when the page was hidden or lost focus. A
// genuinely slow load that cannot hold the display rate is a WARNING with its numbers kept (pass-3
// N5: below 30 fps every frame is over 2.5 intervals, which D2-11's rule called "occluded").
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
 * Consecutive throttled deltas spanning more than this get a "sustained missed vsyncs" WARNING
 * (D3-6; D2-11 made it INVALID). The official main-react60 run (heavy main-thread load) has single
 * 50-67 ms frames, far below it.
 */
export const MAX_THROTTLED_STRETCH_MS = 500;
/**
 * A run whose median delta exceeds 1.5 display intervals gets a "below display rate" WARNING,
 * not INVALID (D2-13): most frames missed vsync. A configuration that genuinely cannot hold the
 * display rate is a real result, and occlusion is caught by the sustained-throttle rule. A
 * 30 Hz throttle (e.g. Chrome's energy saver, 2-interval deltas) shows up only as this warning.
 */
export const BELOW_RATE_MEDIAN_FACTOR = 1.5;
/**
 * D3-6: an rAF interval of at least this is the occlusion signature. Chrome throttles an occluded
 * or background window to about 1 Hz (about 1016 ms, the official 80k-16x8 row); no load the
 * harness measures delivers frames this far apart one after another.
 */
export const OCCLUSION_DELTA_MS = 500;
/**
 * The signature must be sustained: consecutive such intervals spanning at least this, i.e. two of
 * them. One 500+ ms frame is a stall (a pipeline compile, a GC pause): a warning, not occlusion.
 */
export const OCCLUSION_MIN_STRETCH_MS = 1000;

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
  /** The longest span of consecutive deltas of OCCLUSION_DELTA_MS or more (D3-6). */
  readonly longestOcclusionMs: number;
}

export function frameHealth(deltas: readonly number[], displayIntervalMs: number): FrameHealth {
  if (!(displayIntervalMs > 0)) throw new Error(`bad display interval ${displayIntervalMs}`);
  const longAbove = LONG_FRAME_FACTOR * displayIntervalMs;
  const throttledAbove = THROTTLE_FACTOR * displayIntervalMs;
  let longFrames = 0;
  let throttledMs = 0;
  let stretch = 0;
  let longestThrottledMs = 0;
  let occluded = 0;
  let longestOcclusionMs = 0;
  for (const d of deltas) {
    if (d > longAbove) longFrames++;
    if (d > throttledAbove) {
      throttledMs += d;
      stretch += d;
      longestThrottledMs = Math.max(longestThrottledMs, stretch);
    } else {
      stretch = 0;
    }
    if (d >= OCCLUSION_DELTA_MS) {
      occluded += d;
      longestOcclusionMs = Math.max(longestOcclusionMs, occluded);
    } else {
      occluded = 0;
    }
  }
  return { longFrames, throttledMs, longestThrottledMs, longestOcclusionMs };
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
  /** Worth reading next to the numbers, but not a reason to withhold them. */
  readonly warnings: readonly string[];
}

/** What the gate reads from a RunResult (spikes/lib/benchRun.ts). */
export interface RunFrames {
  readonly frameTime: { readonly p50: number };
  readonly longestThrottledMs: number;
  readonly longestOcclusionMs: number;
  readonly displayIntervalMs: number;
}

/**
 * D3-6: INVALID on the occlusion signature, a hidden page or a blur (the page lost focus) during
 * the run; everything a slow load does is a warning next to its numbers.
 */
export function runValidity(run: RunFrames, pageHiddenMs: number, pageBlurs = 0): Validity {
  const reasons: string[] = [];
  const p = run.displayIntervalMs;
  const occluded = run.longestOcclusionMs >= OCCLUSION_MIN_STRETCH_MS;
  if (occluded) {
    reasons.push(
      `occlusion signature: rAF intervals of ${OCCLUSION_DELTA_MS} ms or more for ` +
        `${run.longestOcclusionMs.toFixed(0)} ms in a row (Chrome's ~1 Hz throttle of an occluded or background window)`,
    );
  }
  const warnings: string[] = [];
  if (!occluded && run.longestThrottledMs > MAX_THROTTLED_STRETCH_MS) {
    warnings.push(
      `sustained missed vsyncs: rAF intervals over ${THROTTLE_FACTOR} display intervals (${(THROTTLE_FACTOR * p).toFixed(1)} ms) ` +
        `for ${run.longestThrottledMs.toFixed(0)} ms in a row: a load that cannot hold the display rate, or a stall`,
    );
  }
  if (run.frameTime.p50 > BELOW_RATE_MEDIAN_FACTOR * p) {
    warnings.push(
      `below display rate: median frame ${run.frameTime.p50.toFixed(1)} ms over ` +
        `${BELOW_RATE_MEDIAN_FACTOR} display intervals (${p.toFixed(1)} ms): a load that cannot hold it, or a 30 Hz throttle`,
    );
  }
  if (pageHiddenMs > 0) reasons.push(`page hidden ${pageHiddenMs.toFixed(0)} ms`);
  if (pageBlurs > 0) reasons.push(`page lost focus ${pageBlurs} times (blur) during the run`);
  return { valid: reasons.length === 0, reasons, warnings };
}

export function combineValidity(parts: readonly Validity[]): Validity {
  return {
    valid: parts.every((v) => v.valid),
    reasons: parts.flatMap((v) => v.reasons),
    warnings: parts.flatMap((v) => v.warnings),
  };
}
