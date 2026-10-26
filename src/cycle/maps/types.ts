// Shapes of the ported pyCycle map tables (src/cycle/maps/{fan,lpc,hpc,hpt,lpt}.ts; Apache-2.0,
// see NOTICE). Tables are row-major: table[i][j] is at axis1[i], axis2[j].

/** A compressor map on (corrected speed, R-line). R-line 1 is the stall (surge) line. */
export interface CompressorMapData {
  readonly name: string;
  /** The map's own design point, where scaling pins the engine's design point. */
  readonly design: { readonly nc: number; readonly rline: number; readonly pr: number };
  readonly rlineStall: number;
  /** Map corrected speed (fraction of the map's 100 % speed). */
  readonly nc: readonly number[];
  readonly rline: readonly number[];
  /** Corrected flow, lbm/s (only ratios are used after scaling). */
  readonly wc: readonly (readonly number[])[];
  readonly eff: readonly (readonly number[])[];
  readonly pr: readonly (readonly number[])[];
}

/** A turbine map on (corrected speed in % of the map's design, pressure ratio). */
export interface TurbineMapData {
  readonly name: string;
  readonly design: { readonly np: number; readonly pr: number };
  readonly np: readonly number[];
  readonly pr: readonly number[];
  /** Flow parameter W sqrt(T)/P in the map's units (only ratios are used after scaling). */
  readonly wp: readonly (readonly number[])[];
  readonly eff: readonly (readonly number[])[];
}
