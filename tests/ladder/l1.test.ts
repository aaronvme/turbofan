// Ladder L1 (PHYSICS.md 3.3), CPU variant: free-stream preservation on the real 130k mesh.
import { describe } from 'vitest';
import { ladderCase } from './spawn';

describe('L1 (CPU variant)', () => {
  ladderCase('l1q', 'quiescent ambient on the shipped asset: bitwise exact');
  ladderCase('l1u', 'uniform M 0.5, f64 metrics: below 1e-4 m/s and not growing');
});
