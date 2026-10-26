import { describe, expect, it } from 'vitest';
import { median, medianOfRuns, quantile, summarize } from '../../../spikes/lib/stats';

describe('quantile (linear interpolation between closest ranks, numpy default)', () => {
  it('interpolates between ranks', () => {
    const xs = [1, 2, 3, 4];
    expect(quantile(xs, 0)).toBe(1);
    expect(quantile(xs, 1)).toBe(4);
    expect(quantile(xs, 0.5)).toBe(2.5);
    expect(quantile(xs, 0.25)).toBeCloseTo(1.75, 12);
  });

  it('does not depend on input order and does not mutate the input', () => {
    const xs = [4, 1, 3, 2];
    expect(quantile(xs, 0.5)).toBe(2.5);
    expect(xs).toEqual([4, 1, 3, 2]);
  });

  it('rejects empty input, q outside [0, 1] and non-finite samples', () => {
    expect(() => quantile([], 0.5)).toThrow(/empty/);
    expect(() => quantile([1], 1.5)).toThrow(/q/);
    expect(() => quantile([1, Number.NaN], 0.5)).toThrow(/finite/);
  });
});

describe('median', () => {
  it('is the middle value, or the mean of the two middle values', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([5, 1, 3, 2])).toBe(2.5);
  });
});

describe('summarize', () => {
  it('reports n, mean, min, max and p50/p95/p99', () => {
    const xs = Array.from({ length: 101 }, (_, i) => i); // 0..100
    expect(summarize(xs)).toEqual({
      n: 101,
      mean: 50,
      min: 0,
      max: 100,
      p50: 50,
      p95: 95,
      p99: 99,
    });
  });
});

describe('medianOfRuns (D0-1: median of 3 runs)', () => {
  it('takes the median of the per-run values', () => {
    expect(medianOfRuns([310, 290, 305])).toBe(305);
  });

  it('insists on an odd number of runs so the median is a measured run', () => {
    expect(() => medianOfRuns([1, 2])).toThrow(/odd/);
  });
});
