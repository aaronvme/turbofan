// Camera and scene presets for look-dev and the committed screenshots (docs/look-dev/).
// Engine frame = world frame: x along the axis (downstream), y up, z toward the viewer's left
// when looking at the intake. Distances in metres. The studio floor is at y = -1.32
// (src/render/studio.ts).

export type LookMode = 'realistic' | 'cutaway' | 'exploded';

/** 1/1000 s at 60 fps: a stills camera's shutter, so the idle fan stays readable (pass-3 LD-1). */
export const SHUTTER_1000 = (360 * 60) / 1000;

export interface LookPreset {
  readonly camera: readonly [number, number, number];
  readonly target: readonly [number, number, number];
  readonly fovDeg: number;
  readonly mode: LookMode;
  /** Throttle lever 0..1 (MOCK cycle steady state). */
  readonly throttle: number;
  /** Shutter angle at 60 fps, degrees (180 = film; SHUTTER_1000 = a 1/1000 s still). */
  readonly shutterDeg: number;
  /** Depth of field (a cinematic shot); off everywhere else, where it is not even drawn. */
  readonly cinematic: boolean;
  /** Depth-of-field sharp range, m (larger = deeper focus). */
  readonly focalLength: number;
  readonly bokehScale: number;
}

export const LOOK_PRESETS = {
  threeQuarterFront: {
    camera: [-3.7, 0.75, 3.35],
    target: [0.7, -0.05, 0],
    fovDeg: 30,
    mode: 'realistic',
    throttle: 0,
    shutterDeg: SHUTTER_1000,
    cinematic: false,
    focalLength: 3.5,
    bokehScale: 1,
  },
  side: {
    camera: [1.3, 0.2, 7.2],
    target: [1.3, -0.25, 0],
    fovDeg: 30,
    mode: 'realistic',
    throttle: 0,
    shutterDeg: SHUTTER_1000,
    cinematic: false,
    focalLength: 6,
    bokehScale: 0.6,
  },
  cutaway: {
    camera: [0.2, 2.1, 5.0],
    target: [1.25, -0.05, 0],
    fovDeg: 30,
    mode: 'cutaway',
    throttle: 0,
    shutterDeg: 0,
    cinematic: false,
    focalLength: 4,
    bokehScale: 0.8,
  },
  exploded: {
    camera: [1.0, 2.6, 8.6],
    target: [2.05, -0.15, 0],
    fovDeg: 34,
    mode: 'exploded',
    throttle: 0,
    shutterDeg: 0,
    cinematic: false,
    focalLength: 6,
    bokehScale: 0.6,
  },
  fanIdle: {
    camera: [-3.1, 0.45, 1.35],
    target: [0, -0.02, 0],
    fovDeg: 30,
    mode: 'realistic',
    throttle: 0,
    shutterDeg: SHUTTER_1000,
    cinematic: false,
    focalLength: 2.5,
    bokehScale: 1,
  },
  fanTakeoff: {
    camera: [-3.1, 0.45, 1.35],
    target: [0, -0.02, 0],
    fovDeg: 30,
    mode: 'realistic',
    throttle: 1,
    shutterDeg: SHUTTER_1000,
    cinematic: false,
    focalLength: 2.5,
    bokehScale: 1,
  },
  hotSection: {
    camera: [1.25, 0.95, 1.35],
    target: [2.0, 0.22, 0.2],
    fovDeg: 30,
    mode: 'cutaway',
    throttle: 0,
    shutterDeg: 0,
    cinematic: false,
    focalLength: 1.2,
    bokehScale: 1.2,
  },
  hero: {
    camera: [-4.6, -0.55, 2.4],
    target: [0.9, 0.05, 0.2],
    fovDeg: 26,
    mode: 'realistic',
    throttle: 0,
    shutterDeg: 2 * SHUTTER_1000,
    cinematic: true,
    focalLength: 2.2,
    bokehScale: 0.7,
  },
} as const satisfies Readonly<Record<string, LookPreset>>;

export type LookPresetId = keyof typeof LOOK_PRESETS;
export const LOOK_PRESET_IDS = Object.keys(LOOK_PRESETS) as LookPresetId[];
