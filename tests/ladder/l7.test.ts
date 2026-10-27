// Ladder L7 (PHYSICS.md 3.3): inviscid sphere at M 0.01.
import { describe } from 'vitest';
import { ladderCase } from './spawn';

describe('L7', () => {
  ladderCase('l7', 'Cp symmetry, Cd, iterations vs M 0.3');
});
