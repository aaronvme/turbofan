// W0G-N6: a per-run timeout. page.evaluate has no timeout of its own, so a run whose rAF stops
// entirely (a hung renderer, a display that went to sleep) would hang the harness. Each run is
// raced against its warm-up + runs + STALL_GRACE_MS and, if it loses, recorded INVALID "stalled".

import type { Validity } from './validity.ts';

/** Slack beyond the protocol's own time: page navigation, pipeline creation, the result. */
export const STALL_GRACE_MS = 30_000;

/** The longest a page run may take before it counts as stalled, ms. */
export function runTimeoutMs(p: {
  readonly warmupMs: number;
  readonly runMs: number;
  readonly runs: number;
}): number {
  return p.warmupMs + p.runs * p.runMs + STALL_GRACE_MS;
}

export type Timed<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly afterMs: number };

/**
 * The work's value, or { ok: false } once `ms` pass first. A rejection after the timeout is
 * handled here (Playwright rejects the pending evaluate when the page navigates away), so it
 * never surfaces as an unhandled rejection; one before it propagates.
 */
export function withTimeout<T>(work: Promise<T>, ms: number): Promise<Timed<T>> {
  return new Promise<Timed<T>>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      resolve({ ok: false, afterMs: ms });
    }, ms);
    work.then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ ok: true, value });
      },
      (e: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

/** A run that produced no result in time: INVALID, and never a number. */
export function stalledValidity(afterMs: number): Validity {
  return {
    valid: false,
    reasons: [
      `stalled: no result within ${(afterMs / 1000).toFixed(0)} s (rAF stopped or the page hung)`,
    ],
    warnings: [],
  };
}
