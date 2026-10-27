// Lazy test fixtures (D2-15): nothing is sized or solved while vitest collects a file, so
// Stryker's per-test coverage maps the sizing and the solves to the tests that use them instead
// of marking them "static" (which reruns the whole suite for every such mutant).
import { expect } from 'vitest';
import type { CycleState } from '../../../src/contracts/cycle';
import { referenceEngine, type SizedEngine } from '../../../src/cycle/engine';

/** f() on first call, memoized. */
export function lazy<T>(f: () => T): () => T {
  let done = false;
  let value: T | undefined;
  return () => {
    if (!done) {
      value = f();
      done = true;
    }
    return value as T;
  };
}

/** The reference engine as a plain object reference, sized on the first property read. */
export const REF: SizedEngine = new Proxy({} as SizedEngine, {
  get: (_target, key) => Reflect.get(referenceEngine(), key) as unknown,
});

/**
 * D4-13: no matched gas-path solve was lost since the model's last reset. Every transient and
 * scenario test calls this on the state it ends with (the count is cumulative, so a solve lost and
 * regained inside one step still shows).
 */
export function expectNoLostSolves(s: CycleState | undefined): void {
  expect(s, 'a state').toBeDefined();
  expect(s?.gasPathSolve.lostSolves, 'lost gas-path solves (D4-13)').toBe(0);
}
