import { describe, expect, it } from 'vitest';
import {
  OFFICIAL,
  QUICK,
  benchFileName,
  parseBenchArgs,
  protocolLabel,
} from '../../../spikes/lib/protocol';

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

describe('benchFileName', () => {
  it('uses the local date and minute, so two runs on one day (e.g. two power plans) both survive', () => {
    // Built from local components, so the expectation holds in any time zone.
    const started = new Date(2026, 9, 24, 21, 5, 59);
    expect(benchFileName('throughput', started, OFFICIAL)).toBe(
      'docs/bench/throughput-2026-10-24-2105-official.json',
    );
    expect(benchFileName('worker', new Date(2026, 0, 2, 3, 4), QUICK)).toBe(
      'docs/bench/worker-2026-01-02-0304-quick.json',
    );
  });
});
