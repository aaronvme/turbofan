import { describe, expect, it } from 'vitest';
import {
  DAWN_TIMESTAMP_QUANTUM_NS,
  MAX_PASS_MS,
  detectQuantumNs,
  pairDurationMs,
  pairDurationsMs,
} from '../../../src/gpu/timestamps';

describe('pairDurationsMs', () => {
  it('turns (begin, end) pairs in ns into milliseconds', () => {
    const raw = new BigUint64Array([1_000_000n, 3_500_000n, 10_000_000n, 10_250_000n]);
    expect(pairDurationsMs(raw)).toEqual([2.5, 0.25]);
  });

  it('drops pairs that ran backwards or were never written (both zero), instead of reporting nonsense', () => {
    const raw = new BigUint64Array([5_000_000n, 4_000_000n, 0n, 0n, 1_000_000n, 2_000_000n]);
    expect(pairDurationsMs(raw)).toEqual([1]);
  });

  it('keeps an exact zero duration (both ends inside one quantum)', () => {
    expect(pairDurationsMs(new BigUint64Array([65536n, 65536n]))).toEqual([0]);
  });

  it('rejects an odd number of timestamps', () => {
    expect(() => pairDurationsMs(new BigUint64Array([1n, 2n, 3n]))).toThrow(/pairs/);
  });
});

describe('pairDurationMs', () => {
  it('is NaN for a pair longer than the Windows TDR limit: the first timestamp on a fresh D3D12 device can be stale', () => {
    expect(MAX_PASS_MS).toBe(2000);
    // Measured on Dawn/D3D12: begin 1565863706624 ns, end 1782638767344 ns on the first frame.
    expect(pairDurationMs(1565863706624n, 1782638767344n)).toBeNaN();
    expect(pairDurationMs(1782640678894n, 1782640697592n)).toBeCloseTo(0.018698, 9);
  });

  it('is NaN for backwards or unwritten pairs and keeps exact zero', () => {
    expect(pairDurationMs(5n, 4n)).toBeNaN();
    expect(pairDurationMs(0n, 0n)).toBeNaN();
    expect(pairDurationMs(65536n, 65536n)).toBe(0);
  });
});

describe('detectQuantumNs', () => {
  it("finds Dawn's 2^16 ns quantum from quantized timestamps", () => {
    const q = DAWN_TIMESTAMP_QUANTUM_NS;
    expect(q).toBe(65536n);
    const raw = [50485783n * q, 50485784n * q, 50485787n * q, 50485789n * q];
    expect(detectQuantumNs(raw)).toBe(q);
  });

  it('reports 1 ns for unquantized timestamps', () => {
    expect(detectQuantumNs([3231622524264n, 3231622704315n, 3231630571141n])).toBe(1n);
  });

  it('returns null when there is nothing to compare', () => {
    expect(detectQuantumNs([])).toBeNull();
    expect(detectQuantumNs([0n, 0n])).toBeNull();
  });
});
