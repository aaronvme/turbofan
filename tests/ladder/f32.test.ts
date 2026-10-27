// docs/SOLVER.md 12.2: the f32-storage experiment that sizes the GPU tolerance table.
import { describe } from 'vitest';
import { ladderCase } from './spawn';

describe('SOLVER 12.2 f32 storage', () => {
  ladderCase('f32', 'storage-only f32 error is at least 10x below the kernel tolerances');
});
