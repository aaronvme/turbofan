// When the worker asks for a new MOCK raster (src/shell/mockRaster.ts). The raster costs about
// 150-230 ms of CPU (measured in the worker, W2 app-ui round 2), so it runs on its own worker off
// the frame: one request in flight at a time, a new one only when N1 moved MOCK_FIELD_N1_STEP or
// the last is MOCK_FIELD_MAX_AGE_MS old.
import { describe, expect, it } from 'vitest';
import {
  MOCK_FIELD_MAX_AGE_MS,
  MOCK_FIELD_N1_STEP,
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

  it('a failed raster settles too, so the next stale state asks again', () => {
    const s = createRasterScheduler();
    s.requested(20, 0);
    s.settled();
    expect(s.due(40, 1)).toBe(true);
  });
});
