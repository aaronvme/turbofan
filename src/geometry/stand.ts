// The engine's transport stand in the studio (W1V-N5, pass 6: the engine floated 0.37 m over
// the floor with its shadow detached). A cradle as engines are shipped and shown: a saddle
// under the fan cowl (over the fan case, where a stand takes the forward mounts) and one under
// the core cowl aft of the nacelle (near the turbine rear frame's mounts), each on two posts
// from a floor frame of two rails and two feet. A plausible studio cradle, not engine data.
// Engine frame: x aft along the axis, y up, z to the side; the floor is at y = floorY.

/** Cradle dimensions, m (and the saddles' half angle, rad). */
export const STAND = {
  /** The rubber pad between a saddle and the skin it carries. */
  pad: 0.004,
  /** A saddle's radial depth. */
  saddleDepth: 0.05,
  /** A saddle's width along x. */
  saddleWidth: 0.16,
  /** Its half angle about the bottom (a third of a semicircle). */
  halfAngle: 0.52,
  /** The posts' z, either side of the axis (inside the saddle's arc). */
  postZ: 0.22,
  postSize: [0.09, 0.09] as const,
  railHeight: 0.07,
  railWidth: 0.1,
  /** The feet across under each saddle, half length along z. */
  footHalfZ: 0.5,
  /** Station of the front saddle (over the fan case) and the rear one (aft of the nacelle). */
  frontX: 0.15,
  rearGapX: 0.45,
} as const;

export interface StandSaddle {
  readonly x: number;
  readonly width: number;
  readonly innerRadius: number;
  readonly outerRadius: number;
  /** Half angle about the bottom (-y), rad. */
  readonly halfAngle: number;
}

/** An axis-aligned box in the engine frame. */
export interface StandBox {
  readonly min: readonly [number, number, number];
  readonly max: readonly [number, number, number];
}

export interface StandLayout {
  readonly saddles: readonly StandSaddle[];
  readonly posts: readonly StandBox[];
  readonly rails: readonly StandBox[];
}

export function standLayout(
  radiusAt: { readonly nacelle: (x: number) => number; readonly cowl: (x: number) => number },
  floorY: number,
  nacelleTeX: number,
): StandLayout {
  const saddle = (x: number, r: (x: number) => number): StandSaddle => {
    const w = STAND.saddleWidth;
    const rMax = Math.max(r(x - w / 2), r(x), r(x + w / 2));
    const inner = rMax + STAND.pad;
    return {
      x,
      width: w,
      innerRadius: inner,
      outerRadius: inner + STAND.saddleDepth,
      halfAngle: STAND.halfAngle,
    };
  };
  const saddles = [
    saddle(STAND.frontX, radiusAt.nacelle),
    saddle(nacelleTeX + STAND.rearGapX, radiusAt.cowl),
  ];
  const top = floorY + STAND.railHeight;
  for (const s of saddles)
    if (!(top < -s.outerRadius))
      throw new Error(`standLayout: the floor ${floorY} is not under the engine`);
  const [px, pz] = STAND.postSize;
  const posts = saddles.flatMap((s) =>
    [-STAND.postZ, STAND.postZ].map((z): StandBox => ({
      min: [s.x - px / 2, top, z - pz / 2],
      max: [s.x + px / 2, -Math.sqrt(s.outerRadius ** 2 - z ** 2), z + pz / 2],
    })),
  );
  const x0 = (saddles[0]?.x ?? 0) - 0.25;
  const x1 = (saddles[1]?.x ?? 0) + 0.25;
  const rw = STAND.railWidth;
  const rails: StandBox[] = [
    ...[-STAND.postZ, STAND.postZ].map((z): StandBox => ({
      min: [x0, floorY, z - rw / 2],
      max: [x1, top, z + rw / 2],
    })),
    ...saddles.map((s): StandBox => ({
      min: [s.x - 0.07, floorY, -STAND.footHalfZ],
      max: [s.x + 0.07, floorY + STAND.railHeight * 0.8, STAND.footHalfZ],
    })),
  ];
  return { saddles, posts, rails };
}
