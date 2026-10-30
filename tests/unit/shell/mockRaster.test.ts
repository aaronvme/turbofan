// When the worker asks for a new MOCK raster (src/shell/mockRaster.ts). The raster costs about
// 150-230 ms of CPU (measured in the worker, W2 app-ui round 2), so it runs on its own worker off
// the frame: one request in flight at a time, a new one only when N1 moved MOCK_FIELD_N1_STEP or
// the last is MOCK_FIELD_MAX_AGE_MS old.
import { describe, expect, it } from 'vitest';
import {
  MOCK_FIELD_MAX_AGE_MS,
  MOCK_FIELD_N1_STEP,
  MOCK_RASTER_TIMEOUT_MS,
  createRasterScheduler,
} from '../../../src/shell/mockRaster';

describe('the MOCK raster scheduler', () => {
  it('asks once, then waits for the raster in flight however stale the state gets', () => {
    const s = createRasterScheduler();
    expect(s.due(20, 0)).toBe(true);
    s.requested(20, 0);
    expect(s.inFlight).toBe(true);
    expect(s.due(60, 10 * MOCK_FIELD_MAX_AGE_MS)).toBe(false);
    s.settled();
    expect(s.inFlight).toBe(false);
  });

  it('asks again when N1 moved more than the step, or the raster is too old', () => {
    const s = createRasterScheduler();
    s.requested(20, 1000);
    s.settled();
    expect(s.due(20 + MOCK_FIELD_N1_STEP * 0.9, 1100)).toBe(false);
    expect(s.due(20 - MOCK_FIELD_N1_STEP * 1.1, 1100)).toBe(true);
    expect(s.due(20, 1000 + MOCK_FIELD_MAX_AGE_MS * 0.9)).toBe(false);
    expect(s.due(20, 1000 + MOCK_FIELD_MAX_AGE_MS * 1.1)).toBe(true);
  });

  it('W2A-N7: a raster in flight past the timeout has timed out (a worker that never answers)', () => {
    const s = createRasterScheduler();
    expect(s.timedOut(1e9)).toBe(false);
    s.requested(20, 1000);
    expect(s.timedOut(1000 + MOCK_RASTER_TIMEOUT_MS * 0.9)).toBe(false);
    expect(s.timedOut(1000 + MOCK_RASTER_TIMEOUT_MS * 1.1)).toBe(true);
    s.settled();
    expect(s.timedOut(1000 + MOCK_RASTER_TIMEOUT_MS * 2)).toBe(false);
    // the timeout is far above a raster's measured cost (150-515 ms of CPU)
    expect(MOCK_RASTER_TIMEOUT_MS).toBeGreaterThanOrEqual(10 * 515);
  });

  it('a failed raster settles too, so the next stale state asks again', () => {
    const s = createRasterScheduler();
    s.requested(20, 0);
    s.settled();
    expect(s.due(40, 1)).toBe(true);
  });
});
