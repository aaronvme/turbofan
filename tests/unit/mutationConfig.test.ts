import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SLOW_TRANSIENT_TESTS } from '../../vitest.mutation.config';

// D3-13: the mutation config leaves out exactly the slow transient files. A renamed or deleted
// file would silently put its tests back into every mutant's run (or drop a fast file).
describe('vitest.mutation.config.ts (D3-13)', () => {
  it.each(SLOW_TRANSIENT_TESTS)('%s exists and drives the whole-engine model', (file) => {
    expect(existsSync(file)).toBe(true);
    expect(readFileSync(file, 'utf8')).toMatch(/createCycleModel\(/);
  });
});
