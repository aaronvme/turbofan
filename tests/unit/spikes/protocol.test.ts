import { describe, expect, it } from 'vitest';
import { OFFICIAL, QUICK, parseBenchArgs, protocolLabel } from '../../../spikes/lib/protocol';

describe('D0-1 protocol', () => {
  it('official: 10 s warm-up, then 3 runs of 60 s', () => {
    expect(OFFICIAL).toEqual({ name: 'official', warmupMs: 10_000, runMs: 60_000, runs: 3 });
  });

  it('quick: about 5 s per configuration, still 3 runs so the same statistics apply', () => {
    expect(QUICK.runs).toBe(3);
    expect(QUICK.warmupMs + QUICK.runs * QUICK.runMs).toBe(5_000);
  });

  it('labels quick results as indicative and contaminated', () => {
    expect(protocolLabel(QUICK)).toBe('indicative, contaminated (D0-1): --quick run');
    expect(protocolLabel(OFFICIAL)).toBe('official (D0-1): 10 s warm-up, median of 3 x 60 s');
  });
});

describe('parseBenchArgs', () => {
  it('defaults to the official protocol', () => {
    expect(parseBenchArgs([])).toEqual({ protocol: OFFICIAL, only: null, port: 5181 });
  });

  it('takes --quick, --only=a,b and --port=N', () => {
    expect(parseBenchArgs(['--quick', '--only=130k-16x8,80k-8x8', '--port=5199'])).toEqual({
      protocol: QUICK,
      only: ['130k-16x8', '80k-8x8'],
      port: 5199,
    });
  });

  it('rejects unknown flags rather than silently running the official protocol', () => {
    expect(() => parseBenchArgs(['--qiuck'])).toThrow(/--qiuck/);
    expect(() => parseBenchArgs(['--port=abc'])).toThrow(/port/);
  });
});
