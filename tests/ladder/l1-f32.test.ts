// L1, reported: uniform M 0.5 on the shipped f32-metric asset (docs/SOLVER.md 12.3).
import { describe } from 'vitest';
import { ladderCase } from './spawn';

describe('L1 reported', () => {
  ladderCase('l1f32', 'uniform M 0.5 on the f32-metric asset (reported)');
});
