// W0G-N6 (TDD stub, not implemented yet): a per-run timeout for page.evaluate.
import type { Validity } from './validity.ts';

export const STALL_GRACE_MS = 0;

export function runTimeoutMs(p: {
  readonly warmupMs: number;
  readonly runMs: number;
  readonly runs: number;
}): number {
  return p.warmupMs + p.runMs;
}

export type Timed<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly afterMs: number };

export async function withTimeout<T>(work: Promise<T>, ms: number): Promise<Timed<T>> {
  const value = await work;
  return ms < 0 ? { ok: false, afterMs: ms } : { ok: true, value };
}

export function stalledValidity(afterMs: number): Validity {
  return { valid: afterMs < 0, reasons: [], warnings: [] };
}
