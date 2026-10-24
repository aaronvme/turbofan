// Transfinite interpolation (stub; implemented after the failing tests).
import type { Block, Pt } from './types';

export function tfi(
  _name: string,
  _south: readonly Pt[],
  _north: readonly Pt[],
  _west: readonly Pt[],
  _east: readonly Pt[],
): Block {
  throw new Error('not implemented');
}

export function twoBoundary(
  _name: string,
  _inner: readonly Pt[],
  _outer: readonly Pt[],
  _fractions: (i: number) => ArrayLike<number>,
): Block {
  throw new Error('not implemented');
}
