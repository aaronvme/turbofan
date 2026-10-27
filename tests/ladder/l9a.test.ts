// Ladder L9 (a) (PHYSICS.md 3.3): Euler work of a ducted rotor disk (volume sources).
import { describe } from 'vitest';
import { ladderCase } from './spawn';

describe('L9 (a)', () => {
  ladderCase('l9a', 'Delta T0 = Omega Delta(r u_theta) / cp');
});
