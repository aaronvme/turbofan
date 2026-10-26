// Camera and scene presets for look-dev and the committed screenshots (docs/look-dev/).
// Engine frame = world frame: x along the axis (downstream), y up, z toward the viewer's left
// when looking at the intake. Distances in metres.

export type LookMode = 'realistic' | 'cutaway' | 'exploded';

export interface LookPreset {
  readonly camera: readonly [number, number, number];
  readonly target: readonly [number, number, number];
  readonly fovDeg: number;
  readonly mode: LookMode;
  /** Throttle lever 0..1 (MOCK cycle steady state). */
  readonly throttle: number;
  /** Depth-of-field sharp range, m (larger = deeper focus). */
  readonly focalLength: number;
  readonly bokehScale: number;
}

export const LOOK_PRESETS = {
  threeQuarterFront: {
    camera: [-3.55, 1.05, 3.25],
    target: [0.55, 0.05, 0],
    fovDeg: 30,
    mode: 'realistic',
    throttle: 0,
    focalLength: 3.5,
    bokehScale: 1,
  },
  side: {
    camera: [1.25, 0.35, 6.4],
    target: [1.25, 0, 0],
    fovDeg: 30,
    mode: 'realistic',
    throttle: 0,
    focalLength: 6,
    bokehScale: 0.6,
  },
  cutaway: {
    camera: [0.15, 2.2, 4.7],
    target: [1.15, 0.05, 0],
    fovDeg: 30,
    mode: 'cutaway',
    throttle: 0,
    focalLength: 4,
    bokehScale: 0.8,
  },
  exploded: {
    camera: [0.8, 2.1, 7.6],
    target: [1.75, 0, 0],
    fovDeg: 30,
    mode: 'exploded',
    throttle: 0,
    focalLength: 6,
    bokehScale: 0.6,
  },
  fanIdle: {
    camera: [-3.1, 0.55, 1.35],
    target: [0, 0, 0],
    fovDeg: 30,
    mode: 'realistic',
    throttle: 0,
    focalLength: 2.5,
    bokehScale: 1,
  },
  fanTakeoff: {
    camera: [-3.1, 0.55, 1.35],
    target: [0, 0, 0],
    fovDeg: 30,
    mode: 'realistic',
    throttle: 1,
    focalLength: 2.5,
    bokehScale: 1,
  },
  hotSection: {
    camera: [1.25, 0.95, 1.35],
    target: [2.0, 0.22, 0.2],
    fovDeg: 30,
    mode: 'cutaway',
    throttle: 0,
    focalLength: 1.2,
    bokehScale: 1.2,
  },
} as const satisfies Readonly<Record<string, LookPreset>>;

export type LookPresetId = keyof typeof LOOK_PRESETS;
export const LOOK_PRESET_IDS = Object.keys(LOOK_PRESETS) as LookPresetId[];
