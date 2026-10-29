// The live T-s diagram: each station's total temperature against its specific entropy relative to
// the free stream, s - s0 = phi(Tt, f) - phi(Tt0, 0) - R(f) ln(Pt / Pt0), from the cycle model's
// station states and the same thermally perfect gas tables (src/thermo/gas.ts). Mixing the fuel
// in changes the reference state of phi; the diagram uses each station's own FAR, so the jump at
// the burner is the gas tables' (a standard convention for a T-s chart of a gas turbine).

import type { StationState } from '../contracts/cycle';
import { STREAM_ORDER, type PlaneStationId, type StationId } from '../contracts/stations';
import { entropyFunction, gasConstant, temperatureFromEntropy } from '../thermo/gas';

export interface TsPoint {
  readonly id: PlaneStationId;
  /** J/(kg K), relative to the free stream. */
  readonly sJPerKgK: number;
  readonly ttK: number;
}

export interface TsDiagram {
  readonly core: readonly TsPoint[];
  readonly bypass: readonly TsPoint[];
  /** Isobars at the free-stream and the compressor-delivery total pressure, for context. */
  readonly isobars: readonly { readonly label: string; readonly points: readonly TsPoint[] }[];
}

const entropy = (s: StationState, ref: StationState): number =>
  entropyFunction(s.ttK, s.fuelAirRatio) -
  entropyFunction(ref.ttK, 0) -
  gasConstant(s.fuelAirRatio) * Math.log(s.ptPa / ref.ptPa);

/** The core and bypass paths in stream order (the core skips the inlet plane 1 and exit 9). */
export function tsDiagram(stations: Readonly<Record<StationId, StationState>>): TsDiagram {
  const ref = stations['0'];
  const path = (ids: readonly PlaneStationId[]): TsPoint[] =>
    ids.map((id) => ({ id, sJPerKgK: entropy(stations[id], ref), ttK: stations[id].ttK }));
  const core = path(STREAM_ORDER.core.filter((id) => id !== '1'));
  const bypass = path(STREAM_ORDER.bypass.filter((id) => id !== '1'));
  const all = [...core, ...bypass];
  const s0 = Math.min(...all.map((p) => p.sJPerKgK));
  const s1 = Math.max(...all.map((p) => p.sJPerKgK));
  const isobar = (label: string, pPa: number): { label: string; points: TsPoint[] } => {
    const points: TsPoint[] = [];
    const span = s1 - s0 || 1;
    for (let k = 0; k <= 16; k++) {
      const s = s0 - 0.1 * span + (1.2 * span * k) / 16;
      // phi(T) = s + phi(T0) + R ln(p / p0); temperatureFromEntropy solves
      // phi(T) - R ln(p / 101325) = its first argument, so that is s + phi(T0) - R ln(p0 / 101325)
      try {
        const t = temperatureFromEntropy(
          s + entropyFunction(ref.ttK, 0) - gasConstant(0) * Math.log(ref.ptPa / 101325),
          pPa,
          0,
        );
        points.push({ id: '2', sJPerKgK: s, ttK: t });
      } catch {
        // outside the gas tables' 200-3500 K: that part of the isobar is off the chart
      }
    }
    return { label, points };
  };
  return {
    core,
    bypass,
    isobars: [isobar('Pt0', ref.ptPa), isobar('Pt3', stations['3'].ptPa)],
  };
}
