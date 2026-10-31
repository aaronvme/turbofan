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

/**
 * D4-92 (zz): an orbit that brings a screen box (the content at this orbit) into the free area
 * between the panels: dollied out by the scale fitViewOffset would zoom out by, then panned at
 * the target's depth by what is left of the offset. Unchanged when the box fits and is centred.
 */
export function framedOrbit(
  s: OrbitState,
  box: { readonly x: number; readonly y: number; readonly w: number; readonly h: number },
  canvas: { readonly w: number; readonly h: number },
  free: { readonly x: number; readonly y: number; readonly w: number; readonly h: number },
  fovDeg: number,
  minScale: number,
): OrbitState {
  const k = Math.max(minScale, Math.min(1, free.w / box.w, free.h / box.h));
  // the target is at the canvas centre; dollying out by 1/k scales offsets from it by about k
  const tx = canvas.w / 2;
  const ty = canvas.h / 2;
  const dx = free.x + free.w / 2 - (tx + k * (box.x + box.w / 2 - tx));
  const dy = free.y + free.h / 2 - (ty + k * (box.y + box.h / 2 - ty));
  const distance = s.distance / k;
  const perPx = (2 * distance * Math.tan((fovDeg * Math.PI) / 360)) / canvas.h;
  const a = s.azimuth;
  const e = s.elevation;
  // the camera's right and up (orbitPose's camera looks at the target)
  const right = [Math.cos(a), 0, -Math.sin(a)] as const;
  const up = [-Math.sin(a) * Math.sin(e), Math.cos(e), -Math.cos(a) * Math.sin(e)] as const;
  // content moves right on screen when the camera moves left, and down when it moves up
  const target = [0, 1, 2].map(
    (i) => (s.target[i] ?? 0) - (right[i] ?? 0) * dx * perPx + (up[i] ?? 0) * dy * perPx,
  ) as [number, number, number];
  if (k === 1 && Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return s;
  return { ...s, target, distance };
}
