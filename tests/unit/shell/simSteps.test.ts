// D4-98 item 2 (W2H-I5): the browser suite steps the sim on a fixed dt, so its held-frame case on
// the part-power fit is the same every run (the real frame times made the fit's enthalpy throw
// intermittent). The app keeps the real frame time; the fixed steps are a test control (the
// `debug` message), counted, and the sim holds between the batches the test asks for.
import { describe, expect, it } from 'vitest';
import { MAX_WALL_STEP_S } from '../../../src/contracts/sim';
import { createSimStepper } from '../../../src/shell/simSteps';

describe('the sim stepper: the real frame time, or the browser suite fixed steps', () => {
  it('steps the frame time by default (the app)', () => {
    const s = createSimStepper();
    expect(s.state()).toBeNull();
    expect(s.next(0.0167)).toBe(0.0167);
    expect(s.next(0.034)).toBe(0.034);
  });

  it('holds the sim with no fixed frames left, and steps exactly the frames asked for', () => {
    const s = createSimStepper();
    expect(s.add(1 / 60, 0)).toBe(true);
    expect(s.next(0.02)).toBe(0);
    expect(s.state()).toEqual({ frames: 0, left: 0 });
    s.add(1 / 60, 3);
    expect(s.state()).toEqual({ frames: 0, left: 3 });
    // whatever the frames' own times
    expect([0.016, 0.1, 0.004, 0.05].map((dt) => s.next(dt))).toEqual([1 / 60, 1 / 60, 1 / 60, 0]);
    expect(s.state()).toEqual({ frames: 3, left: 0 });
  });

  it('adds a batch to the frames left (a batch asked for before the last is stepped is not lost)', () => {
    const s = createSimStepper();
    s.add(0.02, 2);
    s.add(0.02, 2);
    const steps = Array.from({ length: 6 }, () => s.next(0.016));
    expect(steps).toEqual([0.02, 0.02, 0.02, 0.02, 0, 0]);
    expect(s.state()).toEqual({ frames: 4, left: 0 });
  });

  it('goes back to the real frame time', () => {
    const s = createSimStepper();
    s.add(1 / 60, 5);
    s.next(0.016);
    s.realTime();
    expect(s.state()).toBeNull();
    expect(s.next(0.025)).toBe(0.025);
  });

  it('ignores a request it cannot step (a bad dt, a bad count)', () => {
    const s = createSimStepper();
    for (const [dt, n] of [
      [0, 1],
      [-1 / 60, 1],
      [Number.NaN, 1],
      [MAX_WALL_STEP_S * 1.01, 1],
      [1 / 60, -1],
      [1 / 60, 1.5],
      [1 / 60, Number.POSITIVE_INFINITY],
    ] as const) {
      expect(s.add(dt, n), `${String(dt)} x ${String(n)}`).toBe(false);
      expect(s.state()).toBeNull();
    }
    expect(s.add(MAX_WALL_STEP_S, 1)).toBe(true);
    expect(s.next(0.016)).toBe(MAX_WALL_STEP_S);
  });
});
