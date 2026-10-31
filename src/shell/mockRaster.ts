// When the sim worker asks for a new MOCK raster. Rasterizing the MOCK into both render extents
// (near 1024 x 256 + far 512 x 108 texels) costs about 150-230 ms of CPU in the worker (measured,
// W2 app-ui round 2), ten frames' worth: on the frame thread it stalled the render and the sim
// clock (MAX_WALL_STEP_S clamps the step) every 2 s at idle and every few frames in a slam. So it
// runs on its own worker (src/app/mockRasterWorker.ts), one request in flight at a time, and the
// frame never waits for it. Pure, so the decision is unit-tested.

/** A new raster when N1 moved this far, %, since the last request... */
export const MOCK_FIELD_N1_STEP = 1.5;
/** ...or the last request is this old, ms (the slower parts of the state, T4, the bleed). */
export const MOCK_FIELD_MAX_AGE_MS = 2000;
/**
 * A raster in flight this long, ms, has timed out (W2A-N7: a raster worker that never answers
 * would leave the MOCK stale with no message): ten times the slowest raster measured (515 ms).
 */
export const MOCK_RASTER_TIMEOUT_MS = 10_000;

export interface RasterScheduler {
  /** Whether to ask for a raster of this state now: none in flight, and the last one stale. */
  due(n1Percent: number, nowMs: number): boolean;
  /** A request went out for this state. */
  requested(n1Percent: number, nowMs: number): void;
  /** Its raster arrived, or it failed (either way the next stale state may ask again). */
  settled(): void;
  /** Whether the raster in flight has been out longer than MOCK_RASTER_TIMEOUT_MS. */
  timedOut(nowMs: number): boolean;
  readonly inFlight: boolean;
}

export function createRasterScheduler(): RasterScheduler {
  let last: { n1: number; t: number } | null = null;
  let inFlight = false;
  return {
    due(n1, now) {
      if (inFlight) return false;
      return (
        last === null ||
        Math.abs(n1 - last.n1) > MOCK_FIELD_N1_STEP ||
        now - last.t > MOCK_FIELD_MAX_AGE_MS
      );
    },
    requested(n1, now) {
      last = { n1, t: now };
      inFlight = true;
    },
    settled() {
      inFlight = false;
    },
    timedOut(now) {
      return inFlight && last !== null && now - last.t > MOCK_RASTER_TIMEOUT_MS;
    },
    get inFlight() {
      return inFlight;
    },
  };
}
