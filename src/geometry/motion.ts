// Spool kinematics for the renderer: shaft angles from N1/N2 and the definition's rotation
// sign, and the angle a rotor turns while a camera shutter is open (the analytic rotational
// motion blur: a 180 degree shutter at 60 fps is open 1/120 s, so a fan at 100 % N1,
// 86 rev/s, smears by 0.72 rev and reads as a disc, as on film, not as a strobed wheel).

import type { RotationSign } from '../contracts/engine';

const TWO_PI = 2 * Math.PI;

/** Signed shaft angular velocity about +x, rad/s. */
export function spoolOmega(rpm: number, sign: RotationSign): number {
  return (rpm * TWO_PI * sign) / 60;
}

/** The shaft angle after dt seconds at rpm, wrapped to [0, 2 pi). */
export function advanceAngle(theta: number, rpm: number, sign: RotationSign, dtS: number): number {
  const a = (theta + spoolOmega(rpm, sign) * dtS) % TWO_PI;
  return a < 0 ? a + TWO_PI : a;
}

/** Angle turned while the shutter is open, rad, at most one revolution. */
export function shutterBlurAngle(rpm: number, shutterAngleDeg: number, fps: number): number {
  if (!(shutterAngleDeg >= 0 && shutterAngleDeg <= 360))
    throw new Error('shutter angle in [0, 360]');
  if (!(fps > 0)) throw new Error('fps > 0');
  const open = shutterAngleDeg / 360 / fps;
  return Math.min(TWO_PI, (Math.abs(rpm) * TWO_PI * open) / 60);
}

/** Blade-pass frequency, Hz. */
export function bladePassFrequencyHz(rpm: number, bladeCount: number): number {
  return (rpm / 60) * bladeCount;
}
