import { describe, expect, it } from 'vitest';
import {
  P3_DETECTOR_START,
  SURGE_DETECT_DECAY_RATE_PER_S,
  SURGE_DETECT_DROP,
  feedP3,
  type P3DecayDetector,
} from '../../../src/cycle/surgeDetection';

// D3-17: the FADEC's surge detector sees only the sensed P3 (ENGINE_FACTS "Surge detection and
// recovery (D3-17)": the rate of decrease of P3, integrated to a minimum drop, [GE74]).

/** Feeds p3(t) sampled every dt from 0 to t1; returns the first time a surge is detected. */
function firstDetection(p3: (t: number) => number, dt: number, t1: number): number | null {
  let d: P3DecayDetector = P3_DETECTOR_START;
  const n = Math.round(t1 / dt);
  for (let i = 0; i <= n; i++) {
    const r = feedP3(d, p3(i * dt), dt);
    if (r.surge) return i * dt;
    d = r.detector;
  }
  return null;
}

const P_TAKEOFF = 2.94e6;
/** A deep-surge blow-down: P3 falls by half over 5 ms from t = 0.1 s, then stays down. */
const blowDown = (t: number) =>
  P_TAKEOFF * (t < 0.1 ? 1 : t < 0.105 ? 1 - (0.5 * (t - 0.1)) / 0.005 : 0.5);
/** The fastest normal P3 decay, a slam deceleration: relative rate 1/s (about 1.5/s at most). */
const slamDecel = (t: number) => P_TAKEOFF * Math.exp(-t);

describe('D3-17 surge detector: the sensed P3 decay', () => {
  it('the thresholds separate a surge blow-down from a deceleration', () => {
    // a slam deceleration decays P3 at about 1/s (ENGINE_FACTS / C12); a deep surge empties the
    // plenum within one cycle of about 15 ms, i.e. at tens per second
    expect(SURGE_DETECT_DECAY_RATE_PER_S).toBeGreaterThan(5);
    expect(SURGE_DETECT_DECAY_RATE_PER_S).toBeLessThan(0.5 / 0.015);
    expect(SURGE_DETECT_DROP).toBeGreaterThan(0.05);
    expect(SURGE_DETECT_DROP).toBeLessThan(0.5);
  });

  it.each([1e-4, 2.5e-4, 1e-3])(
    'detects a deep-surge blow-down within its 5 ms (dt %f s)',
    (dt) => {
      const t = firstDetection(blowDown, dt, 0.2);
      expect(t).not.toBeNull();
      expect(t ?? Infinity).toBeGreaterThan(0.1);
      expect(t ?? Infinity).toBeLessThanOrEqual(0.105 + dt);
    },
  );

  it.each([1e-3, 0.02])('never trips on a slam deceleration (dt %f s)', (dt) => {
    expect(firstDetection(slamDecel, dt, 5)).toBeNull();
  });

  it('a fast drop smaller than the confirming drop is not a surge (a transient)', () => {
    const glitch = (t: number) => P_TAKEOFF * (t >= 0.1 && t < 0.11 ? 0.95 : 1);
    expect(firstDetection(glitch, 1e-3, 0.3)).toBeNull();
  });

  it('the integrated drop restarts once the decay slows, so slow steps never add up', () => {
    // 4 % falls at the surge rate, each followed by a steady pause: 12 % in all, never 10 % at once
    const steps = (t: number) => {
      const k = Math.min(3, Math.floor(t / 0.05));
      const inStep = t - 0.05 * k < 0.002 && t < 0.15 ? (t - 0.05 * k) / 0.002 : 1;
      return P_TAKEOFF * (1 - 0.04 * (k + (t < 0.15 ? inStep : 0)));
    };
    expect(firstDetection(steps, 1e-4, 0.2)).toBeNull();
  });

  it('accumulates the relative drop while the decay is fast, and keeps the last sample', () => {
    const a = feedP3(P3_DETECTOR_START, 1e6, 1e-3);
    expect(a.surge).toBe(false);
    expect(a.detector).toEqual({ lastPa: 1e6, dropFraction: 0 });
    const b = feedP3(a.detector, 0.95e6, 1e-3);
    expect(b.surge).toBe(false);
    expect(b.detector.lastPa).toBe(0.95e6);
    expect(b.detector.dropFraction).toBeCloseTo(0.05, 12);
    const c = feedP3(b.detector, 0.95e6 * 0.94, 1e-3);
    expect(c.surge).toBe(true);
    expect(c.detector.dropFraction).toBeCloseTo(0.11, 12);
    // a rise (or a slow fall) clears the integral
    expect(feedP3(c.detector, 1e6, 1e-3).detector.dropFraction).toBe(0);
    expect(feedP3(c.detector, 0.95e6 * 0.94 * 0.9999, 1e-3).detector.dropFraction).toBe(0);
  });

  it('rejects a non-positive pressure or time step', () => {
    expect(() => feedP3(P3_DETECTOR_START, 0, 1e-3)).toThrow();
    expect(() => feedP3(P3_DETECTOR_START, 1e6, 0)).toThrow();
    expect(() => feedP3(P3_DETECTOR_START, Number.NaN, 1e-3)).toThrow();
  });
});
