// The FADEC's surge detector (D3-17, PHYSICS.md C12): it sees only the sensed compressor delivery
// pressure P3, never the true surge margin. Pure.
//
// Published practice (ENGINE_FACTS "Surge detection and recovery (D3-17)"): a stall makes the
// compressor discharge pressure decay rapidly ([GE91]); the detector compares the rate of decrease
// of P3 with a reference and integrates the signal, so that a stall needs a minimum P3 drop and a
// fast deceleration or a brief transient does not trip it ([GE74]).

/** Relative P3 decay rate, -(dP3/dt) / P3, above which the drop is integrated, 1/s. */
export const SURGE_DETECT_DECAY_RATE_PER_S = 10;
/** Integrated relative P3 drop that confirms a surge. */
export const SURGE_DETECT_DROP = 0.1;

export interface P3DecayDetector {
  /** The previous sample of the sensed P3, Pa (null before the first). */
  readonly lastPa: number | null;
  /** Relative P3 drop integrated while the decay rate has stayed above the threshold. */
  readonly dropFraction: number;
}

export const P3_DETECTOR_START: P3DecayDetector = { lastPa: null, dropFraction: 0 };

/** Feeds one sample of the sensed P3, taken dtS after the previous one. */
export function feedP3(
  d: P3DecayDetector,
  p3Pa: number,
  dtS: number,
): { readonly detector: P3DecayDetector; readonly surge: boolean } {
  if (!(p3Pa > 0) || !(dtS > 0)) throw new Error(`P3 ${p3Pa} Pa and dt ${dtS} s must be > 0`);
  if (d.lastPa === null) return { detector: { lastPa: p3Pa, dropFraction: 0 }, surge: false };
  const drop = (d.lastPa - p3Pa) / d.lastPa;
  // integrate only while the decay is fast; a slower fall or a rise starts the integral again
  const dropFraction = drop / dtS > SURGE_DETECT_DECAY_RATE_PER_S ? d.dropFraction + drop : 0;
  return { detector: { lastPa: p3Pa, dropFraction }, surge: dropFraction >= SURGE_DETECT_DROP };
}
