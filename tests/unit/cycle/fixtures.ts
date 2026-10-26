// Lazy test fixtures (D2-15): nothing is sized or solved while vitest collects a file, so
// Stryker's per-test coverage maps the sizing and the solves to the tests that use them instead
// of marking them "static" (which reruns the whole suite for every such mutant).
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
