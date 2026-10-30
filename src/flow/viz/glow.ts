// Hot-part glow of the flow visuals (w2/flowviz round 2): the thermal emission of the hot
// section as the studio camera would record it. PHYSICS.md 1: derived, with an assumption.
//
// - Metal temperature from the cycle's gas (total) temperatures. The uncooled LPT airfoils, the
//   core nozzle and the plug sit at their gas temperature. The HPT airfoils are cooled by
//   compressor-delivery air: T_metal = T_gas - phi (T_gas - T3), phi the overall cooling
//   effectiveness (ASSUMED 0.6, the middle of the 0.5-0.7 range quoted for film- and
//   internally-cooled HPT airfoils, e.g. Han, Dutta & Ekkad, Gas Turbine Heat Transfer and
//   Cooling Technology, 2nd ed., 2012, ch. 1).
// - Radiance: a grey body, emissivity x Planck, its colour and luminance from the CIE 1931
//   functions (src/flow/viz/optics.ts). Emissivities are ASSUMED (oxidised superalloy 0.85,
//   the HPT's ceramic thermal-barrier coat 0.4).
// - Scene units: the studio's key light has intensity 2.6 (src/render/studio.ts), which three
//   treats as illuminance, so a white Lambert wall under it has radiance 2.6 / pi. The studio is
//   ASSUMED to be lit at 1000 lux (a bright product-photography key), so one scene unit is
//   1000 / 2.6 cd/m^2 and a glowing part's luminance L (cd/m^2) is L x 2.6 / 1000 in the scene.
// Physically this is dim: steel shows nothing below the Draper point (~800 K) and only a dull red
// at 1100 K, far below a lit studio. Restrained by physics, not by a gain.

import type { StationState } from '../../contracts/cycle';
import type { StationId } from '../../contracts/stations';
import { blackbodyLinearSrgb, blackbodyLuminance } from './optics';

export const GLOW_ASSUMPTIONS = {
  /** HPT airfoils' overall cooling effectiveness phi (assumed). */
  coolingEffectiveness: 0.6,
  /** Grey emissivities (assumed). */
  emissivity: { metal: 0.85, tbc: 0.4 },
  /** The studio's key illuminance the scene stands for, lux (assumed). */
  studioKeyLux: 1000,
  /** The key light's intensity in the scene (src/render/studio.ts). */
  sceneKeyIntensity: 2.6,
} as const;

export const GLOW_PARTS = [
  'hptVane',
  'hptBlade',
  'lptVane',
  'lptBlade',
  'exhaust',
  'plug',
] as const;
export type GlowPart = (typeof GLOW_PARTS)[number];

/** Each glowing part's emissivity: the HPT's coated airfoils, the rest oxidised metal. */
export const GLOW_EMISSIVITY: Readonly<Record<GlowPart, number>> = {
  hptVane: GLOW_ASSUMPTIONS.emissivity.tbc,
  hptBlade: GLOW_ASSUMPTIONS.emissivity.tbc,
  lptVane: GLOW_ASSUMPTIONS.emissivity.metal,
  lptBlade: GLOW_ASSUMPTIONS.emissivity.metal,
  exhaust: GLOW_ASSUMPTIONS.emissivity.metal,
  plug: GLOW_ASSUMPTIONS.emissivity.metal,
};

/** Metal temperature of each glowing part, K, from the cycle's station total temperatures. */
export function hotPartTemperatures(
  stations: Readonly<Record<StationId, StationState>>,
  phi: number = GLOW_ASSUMPTIONS.coolingEffectiveness,
): Record<GlowPart, number> {
  const t3 = stations['3'].ttK;
  const cooled = (tGas: number) => tGas - phi * (tGas - t3);
  const t45 = stations['45'].ttK;
  const t5 = stations['5'].ttK;
  return {
    // the nozzle guide vanes see the combustor exit, the rotor its (relative) inlet T41
    hptVane: cooled(stations['4'].ttK),
    hptBlade: cooled(stations['41'].ttK),
    lptVane: t45,
    lptBlade: (t45 + t5) / 2,
    exhaust: t5,
    plug: t5,
  };
}

/** Relative luminance of linear sRGB (Rec. 709 / sRGB primaries, D65). */
export function sceneLuminance(rgb: readonly [number, number, number]): number {
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
}

/** Below this the emission is under 1e-12 cd/m^2: exactly black (and no blackbody fit needed). */
const MIN_GLOW_K = 500;

/** A grey body at T (K) with this emissivity, as linear sRGB radiance in scene units. */
export function glowSceneRadiance(
  tK: number,
  emissivity: number,
  a: typeof GLOW_ASSUMPTIONS = GLOW_ASSUMPTIONS,
): [number, number, number] {
  if (!(tK > MIN_GLOW_K)) return [0, 0, 0];
  const c = blackbodyLinearSrgb(tK);
  const y = sceneLuminance(c);
  const lum = emissivity * blackbodyLuminance(tK) * (a.sceneKeyIntensity / a.studioKeyLux);
  return [(c[0] * lum) / y, (c[1] * lum) / y, (c[2] * lum) / y];
}

/**
 * W2V-N14: the glow uniforms are set every frame, and one radiance is a blackbody integral (471
 * steps x 2). This keeps each part's last radiance and recomputes it only when its temperature
 * or emissivity changes (a steady state costs nothing; a spool-up still updates every frame).
 */
export function createGlowRadianceCache(
  compute: (tK: number, emissivity: number) => [number, number, number] = glowSceneRadiance,
): (part: string, tK: number, emissivity: number) => [number, number, number] {
  const last = new Map<string, { tK: number; emissivity: number; rgb: [number, number, number] }>();
  return (part, tK, emissivity) => {
    const hit = last.get(part);
    if (hit !== undefined && hit.tK === tK && hit.emissivity === emissivity) return hit.rgb;
    const rgb = compute(tK, emissivity);
    last.set(part, { tK, emissivity, rgb });
    return rgb;
  };
}
