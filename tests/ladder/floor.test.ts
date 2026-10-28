// D4-58 (SOLVER.md 12.4): the oracle's f32-storage residual floors of L4 (a) and L5, which D4-38's
// GPU stopping rule uses.
import { describe } from 'vitest';
import { ladderCase } from './spawn';

describe('D4-58 floors', () => {
  ladderCase('floor', 'the stated GPU floors are the oracle f32-storage floors; f64 falls below');
});
