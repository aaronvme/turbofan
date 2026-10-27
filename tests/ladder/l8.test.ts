// Ladder L8 (PHYSICS.md 3.3): static point sink (volume sources).
import { describe } from 'vitest';
import { ladderCase } from './spawn';

describe('L8', () => {
  ladderCase('l8', 'velocity vs mdot / (4 pi r^2 rho)');
});
