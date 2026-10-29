// The cut-plane quantities of the flow visuals (w2/flowviz): what the Data and Cutaway modes
// colour by, derived from the decoded solver field (D0-4 textures, src/contracts/flow.ts).
// Every value here is computed from the simulated field; nothing is synthesized.

import type { FieldReference, FieldSample } from '../../contracts/flow';
import { gamma, gasConstant } from '../../thermo/gas';
import type { ColormapId } from './colormaps';

export interface DerivedQuantities {
  readonly pPa: number;
  readonly rhoKgPerM3: number;
  readonly tK: number;
  /** |u| over the thermally perfect speed of sound sqrt(gamma(T, FAR) R(FAR) T). */
  readonly mach: number;
  /** |u| including the swirl, m/s. */
  readonly speed: number;
}

export function deriveQuantities(s: FieldSample): DerivedQuantities {
  const speed = Math.hypot(s.uxMPerS, s.urMPerS, s.uthetaMPerS);
  const far = Math.max(0, s.fuelAirRatio);
  const a = Math.sqrt(gamma(s.tK, far) * gasConstant(far) * s.tK);
  return { pPa: s.pPa, rhoKgPerM3: s.rhoKgPerM3, tK: s.tK, mach: speed / a, speed };
}

export type FieldQuantityId = 'p' | 'rho' | 't' | 'mach' | 'speed';

export interface FieldQuantitySpec {
  readonly label: string;
  /** What the value (and so the legend) is in. */
  readonly unit: string;
  readonly min: number;
  readonly max: number;
  readonly colormap: ColormapId;
  /** Contour spacing in the value's units. */
  readonly contourStep: number;
}

/**
 * p and rho span a factor of about 30 from the intake to the HPC exit, so they are shown as
 * log2 of the ratio to the ambient, on the diverging map centred on the ambient (0): below
 * ambient blue, above red, one contour per doubling or halving.
 */
export const FIELD_QUANTITIES: Readonly<Record<FieldQuantityId, FieldQuantitySpec>> = {
  p: {
    label: 'Static pressure',
    unit: 'log2(p/p∞)',
    min: -5,
    max: 5,
    colormap: 'diverging',
    contourStep: 0.5,
  },
  rho: {
    label: 'Density',
    unit: 'log2(ρ/ρ∞)',
    min: -4,
    max: 4,
    colormap: 'diverging',
    contourStep: 0.5,
  },
  t: {
    label: 'Static temperature',
    unit: 'K',
    min: 200,
    max: 2000,
    colormap: 'inferno',
    contourStep: 100,
  },
  mach: {
    label: 'Mach number',
    unit: 'M',
    min: 0,
    max: 1.6,
    colormap: 'viridis',
    contourStep: 0.1,
  },
  speed: {
    label: 'Velocity magnitude',
    unit: 'm/s',
    min: 0,
    max: 600,
    colormap: 'viridis',
    contourStep: 50,
  },
};

export const FIELD_QUANTITY_IDS = Object.keys(FIELD_QUANTITIES) as readonly FieldQuantityId[];

/** The value a quantity shows at a decoded sample. */
export function quantityValue(id: FieldQuantityId, s: FieldSample, ref: FieldReference): number {
  const q = deriveQuantities(s);
  switch (id) {
    case 'p':
      return Math.log2(q.pPa / ref.pInfPa);
    case 'rho':
      return Math.log2(q.rhoKgPerM3 / ref.rhoInfKgPerM3);
    case 't':
      return q.tK;
    case 'mach':
      return q.mach;
    case 'speed':
      return q.speed;
  }
}

/** The value mapped onto [0, 1] of the quantity's colour map (clamped). */
export function normalizeQuantity(id: FieldQuantityId, value: number): number {
  const s = FIELD_QUANTITIES[id];
  return Math.min(1, Math.max(0, (value - s.min) / (s.max - s.min)));
}
