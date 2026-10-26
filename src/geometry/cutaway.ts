// The cutaway: a wedge theta in (center - halfWidth, center + halfWidth) is removed from every
// solid of revolution (the renderer discards fragments there and draws the caps of ./cap on
// its two faces). A blade is all or nothing: one whose angular extent touches the wedge is
// hidden whole, because a cut blade would show an uncapped, hollow section. The shader
// mirrors these functions.

export interface CutawayWedge {
  readonly center: number;
  readonly halfWidth: number;
}

/** Wraps an angle to (-pi, pi]. */
export function wrapAngle(a: number): number {
  const t = (a + Math.PI) % (2 * Math.PI);
  const w = (t <= 0 ? t + 2 * Math.PI : t) - Math.PI;
  return w;
}

/** The wedge at opening progress p in [0, 1] of the full width (rad). */
export function cutawayWedge(progress: number, center: number, fullWidth: number): CutawayWedge {
  const p = Math.max(0, Math.min(1, progress));
  return { center, halfWidth: (p * fullWidth) / 2 };
}

export function angleInWedge(theta: number, w: CutawayWedge): boolean {
  return Math.abs(wrapAngle(theta - w.center)) < w.halfWidth;
}

/** A blade at `angle` spanning [angle + thetaMin, angle + thetaMax] touches the wedge. */
export function bladeHidden(
  angle: number,
  thetaMin: number,
  thetaMax: number,
  w: CutawayWedge,
): boolean {
  if (w.halfWidth <= 0) return false;
  const mid = wrapAngle(angle + (thetaMin + thetaMax) / 2 - w.center);
  const half = (thetaMax - thetaMin) / 2;
  return Math.abs(mid) < w.halfWidth + half;
}
