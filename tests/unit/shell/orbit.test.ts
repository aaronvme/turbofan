// The worker's orbit camera state (the main thread is the D2-4 event proxy).
import { describe, expect, it } from 'vitest';
import {
  applyOrbit,
  ORBIT_LIMITS,
  orbitFromPose,
  orbitInputForKey,
  orbitPose,
} from '../../../src/shell/orbit';

describe('orbit', () => {
  it('round-trips a camera pose', () => {
    const s = orbitFromPose([4, 1.5, 6], [0.5, 0, 0]);
    const p = orbitPose(s);
    expect(p.position[0]).toBeCloseTo(4, 12);
    expect(p.position[1]).toBeCloseTo(1.5, 12);
    expect(p.position[2]).toBeCloseTo(6, 12);
    expect(p.target).toEqual([0.5, 0, 0]);
  });

  it('clamps elevation, distance and the target, and wraps the azimuth', () => {
    const s = orbitFromPose([0, 0, 5], [0, 0, 0]);
    expect(applyOrbit(s, { dElevation: 10 }).elevation).toBe(ORBIT_LIMITS.maxElevation);
    expect(applyOrbit(s, { zoom: 10 }).distance).toBe(ORBIT_LIMITS.maxDistance);
    expect(applyOrbit(s, { zoom: -10 }).distance).toBe(ORBIT_LIMITS.minDistance);
    expect(applyOrbit(s, { panX: -99 }).target[0]).toBe(ORBIT_LIMITS.minTargetX);
    const a = applyOrbit(s, { dAzimuth: 3 * Math.PI });
    expect(Math.abs(a.azimuth)).toBeCloseTo(Math.PI, 12);
    expect(applyOrbit(s, {})).toEqual(s);
  });

  it('maps the keyboard (arrows, +/-, [ ]) and ignores other keys', () => {
    expect(orbitInputForKey('ArrowLeft')?.dAzimuth).toBeLessThan(0);
    expect(orbitInputForKey('ArrowRight', true)?.dAzimuth).toBeCloseTo((15 * Math.PI) / 180, 12);
    expect(orbitInputForKey('ArrowUp')?.dElevation).toBeGreaterThan(0);
    expect(orbitInputForKey('ArrowDown')?.dElevation).toBeLessThan(0);
    expect(orbitInputForKey('+')?.zoom).toBeLessThan(0);
    expect(orbitInputForKey('=')?.zoom).toBeLessThan(0);
    expect(orbitInputForKey('-')?.zoom).toBeGreaterThan(0);
    expect(orbitInputForKey('_')?.zoom).toBeGreaterThan(0);
    expect(orbitInputForKey('[')?.panX).toBeLessThan(0);
    expect(orbitInputForKey(']')?.panX).toBeGreaterThan(0);
    expect(orbitInputForKey('a')).toBeNull();
  });
});
