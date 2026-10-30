// The orbit camera, driven across the worker boundary. D2-4 found OrbitControls needs a DOM event
// proxy in a worker; here the main thread is that proxy: it turns pointer, wheel and key events
// into small OrbitInput messages, and the worker folds them into this pure state and poses the
// camera with EngineView.setCameraPose. Spherical coordinates about a target on the engine axis;
// y is up, the engine axis is x (src/contracts/engine.ts).

export interface OrbitState {
  readonly target: readonly [number, number, number];
  /** Azimuth about +y from +z toward +x, rad. */
  readonly azimuth: number;
  /** Elevation above the horizontal, rad. */
  readonly elevation: number;
  readonly distance: number;
}

export interface OrbitInput {
  /** Rotation, rad (pointer drag or arrow keys). */
  readonly dAzimuth?: number;
  readonly dElevation?: number;
  /** Zoom: the distance is multiplied by exp(zoom) (wheel or +/- keys). */
  readonly zoom?: number;
  /** Pan of the target along the engine axis, m. */
  readonly panX?: number;
}

export const ORBIT_LIMITS = {
  minElevation: (-80 * Math.PI) / 180,
  maxElevation: (80 * Math.PI) / 180,
  minDistance: 2.2,
  maxDistance: 18,
  /** The target stays between the spinner and the plug tip (with margin), m. */
  minTargetX: -1.5,
  maxTargetX: 4.5,
} as const;

/** Radians of rotation per CSS pixel of drag. */
export const DRAG_RAD_PER_PX = 0.006;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** The orbit that reproduces a camera pose (position, target). */
export function orbitFromPose(position: readonly number[], target: readonly number[]): OrbitState {
  const t: [number, number, number] = [target[0] ?? 0, target[1] ?? 0, target[2] ?? 0];
  const dx = (position[0] ?? 0) - t[0];
  const dy = (position[1] ?? 0) - t[1];
  const dz = (position[2] ?? 0) - t[2];
  const distance = Math.hypot(dx, dy, dz);
  return {
    target: t,
    azimuth: Math.atan2(dx, dz),
    elevation: Math.asin(clamp(dy / (distance || 1), -1, 1)),
    distance,
  };
}

export function applyOrbit(s: OrbitState, i: OrbitInput): OrbitState {
  const L = ORBIT_LIMITS;
  const az = s.azimuth + (i.dAzimuth ?? 0);
  return {
    target: [
      clamp(s.target[0] + (i.panX ?? 0), L.minTargetX, L.maxTargetX),
      s.target[1],
      s.target[2],
    ],
    // wrapped into (-pi, pi] so a long drag never loses precision
    azimuth: Math.atan2(Math.sin(az), Math.cos(az)),
    elevation: clamp(s.elevation + (i.dElevation ?? 0), L.minElevation, L.maxElevation),
    distance: clamp(s.distance * Math.exp(i.zoom ?? 0), L.minDistance, L.maxDistance),
  };
}

export function orbitPose(s: OrbitState): {
  position: [number, number, number];
  target: [number, number, number];
} {
  const c = Math.cos(s.elevation);
  return {
    position: [
      s.target[0] + s.distance * c * Math.sin(s.azimuth),
      s.target[1] + s.distance * Math.sin(s.elevation),
      s.target[2] + s.distance * c * Math.cos(s.azimuth),
    ],
    target: [s.target[0], s.target[1], s.target[2]],
  };
}

/** Keyboard orbit for the focused canvas (accessibility): arrows rotate, +/- zoom, [ ] pan. */
export function orbitInputForKey(key: string, shift = false): OrbitInput | null {
  const step = (shift ? 15 : 5) * (Math.PI / 180);
  switch (key) {
    case 'ArrowLeft':
      return { dAzimuth: -step };
    case 'ArrowRight':
      return { dAzimuth: step };
    case 'ArrowUp':
      return { dElevation: step };
    case 'ArrowDown':
      return { dElevation: -step };
    case '+':
    case '=':
      return { zoom: -0.1 };
    case '-':
    case '_':
      return { zoom: 0.1 };
    case '[':
      return { panX: -0.25 };
    case ']':
      return { panX: 0.25 };
    default:
      return null;
  }
}
