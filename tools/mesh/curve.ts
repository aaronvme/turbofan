// Arc-length parameterised polylines (stub; implemented after the failing tests).
import type { Pt } from './types';

export class Polyline {
  readonly points: readonly Pt[];
  constructor(points: readonly Pt[]) {
    this.points = points;
    throw new Error('not implemented');
  }
  get length(): number {
    throw new Error('not implemented');
  }
  at(_s: number): Pt {
    throw new Error('not implemented');
  }
  tangent(_s: number): Pt {
    throw new Error('not implemented');
  }
  sAtX(_x: number): number {
    throw new Error('not implemented');
  }
  atX(_x: number): Pt {
    throw new Error('not implemented');
  }
  rayHit(_origin: Pt, _dir: Pt): number | null {
    throw new Error('not implemented');
  }
  sub(_s0: number, _s1: number): Polyline {
    throw new Error('not implemented');
  }
  reversed(): Polyline {
    throw new Error('not implemented');
  }
  sample(_s: ArrayLike<number>): Pt[] {
    throw new Error('not implemented');
  }
  distanceTo(_p: Pt): number {
    throw new Error('not implemented');
  }
}

export function sampleFunction(_fn: (u: number) => Pt, _n: number): Polyline {
  throw new Error('not implemented');
}
