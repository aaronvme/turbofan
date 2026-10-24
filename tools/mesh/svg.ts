// SVG mesh plots (stub; implemented after the failing tests).
import type { MultiBlockMesh } from './types';

export interface SvgView {
  readonly title: string;
  readonly xMin: number;
  readonly xMax: number;
  readonly rMin: number;
  readonly rMax: number;
  readonly widthPx: number;
  readonly lineStride?: number;
}

export function renderSvg(_mesh: MultiBlockMesh, _view: SvgView): string {
  throw new Error('not implemented');
}
