// The engine's transport stand in the studio (W1V-N5, pass 6: the engine floated 0.37 m over
// the floor with its shadow detached). A cradle as engines are shipped and shown: a saddle
// under the fan cowl (over the fan case, where a stand takes the forward mounts) and one under
// the core cowl aft of the nacelle (near the turbine rear frame's mounts), each on two posts
// from a floor frame of two rails and two feet. A plausible studio cradle, not engine data.
// Round 5 (critic pass 8: it read as a toy for a 2.3 t engine): an engineering transport
// stand, as engines are moved in a shop: a heavy rectangular-tube frame wider than the engine's
// footprint on four swivel casters, cross members under each saddle, each pair of posts tied
// across, rubber pads between the saddles and the skins, and a tow bar ahead of the frame.
// Engine frame: x aft along the axis, y up, z to the side; the floor is at y = floorY.

/** Cradle dimensions, m (and the saddles' half angle, rad). */
export const STAND = {
  /** The rubber pad between a saddle and the skin it carries. */
  pad: 0.01,
  /** A saddle's radial depth. */
  saddleDepth: 0.06,
  /** A saddle's width along x. */
  saddleWidth: 0.2,
  /** Its half angle about the bottom (a third of a semicircle). */
  halfAngle: 0.52,
  /** The posts' z, either side of the axis (inside the saddle's arc). */
  postZ: 0.24,
  postSize: [0.12, 0.12] as const,
  /** The frame's rectangular tube (height, width) and the rails' z. */
  railHeight: 0.08,
  railWidth: 0.1,
  railZ: 0.62,
  /** The frame's underside above the floor: the swivel casters' height. */
  frameLift: 0.1,
  casterRadius: 0.045,
  casterWidth: 0.04,
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

export interface StandCaster {
  readonly x: number;
  /** The axle's height (the wheel touches the floor). */
  readonly y: number;
  readonly z: number;
  readonly radius: number;
  readonly width: number;
}

export interface StandLayout {
  readonly saddles: readonly StandSaddle[];
  /** The rubber pads, one inside each saddle (annular sectors like them). */
  readonly pads: readonly StandSaddle[];
  readonly posts: readonly StandBox[];
  /** The frame: two rails along x and a cross member under each saddle. */
  readonly rails: readonly StandBox[];
  /** A tie across each pair of posts, at mid height. */
  readonly braces: readonly StandBox[];
  readonly casters: readonly StandCaster[];
  readonly towBar: StandBox;
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
  const base = floorY + STAND.frameLift;
  const top = base + STAND.railHeight;
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
  const x0 = (saddles[0]?.x ?? 0) - 0.35;
  const x1 = (saddles[1]?.x ?? 0) + 0.35;
  const rw = STAND.railWidth;
  const zr = STAND.railZ;
  const rails: StandBox[] = [
    ...[-zr, zr].map((z): StandBox => ({
      min: [x0, base, z - rw / 2],
      max: [x1, top, z + rw / 2],
    })),
    // cross members under the saddles, the posts standing on them
    ...saddles.map((s): StandBox => ({
      min: [s.x - px / 2 - 0.01, base, -zr - rw / 2],
      max: [s.x + px / 2 + 0.01, top, zr + rw / 2],
    })),
  ];
  const braces = posts
    .filter((_, k) => k % 2 === 0)
    .map((p): StandBox => {
      const mid = (p.min[1] + p.max[1]) / 2;
      const cx = (p.min[0] + p.max[0]) / 2;
      return {
        min: [cx - 0.03, mid - 0.04, -STAND.postZ],
        max: [cx + 0.03, mid + 0.04, STAND.postZ],
      };
    });
  const pads = saddles.map((s): StandSaddle => ({
    x: s.x,
    width: s.width - 0.03,
    innerRadius: s.innerRadius - STAND.pad,
    outerRadius: s.innerRadius,
    halfAngle: s.halfAngle - 0.03,
  }));
  const r = STAND.casterRadius;
  const casters = [x0 + 0.12, x1 - 0.12].flatMap((x) =>
    [-zr, zr].map((z): StandCaster => ({
      x,
      y: floorY + r,
      z,
      radius: r,
      width: STAND.casterWidth,
    })),
  );
  const towBar: StandBox = {
    min: [x0 - 0.55, base + 0.02, -0.03],
    max: [x0, base + 0.08, 0.03],
  };
  return { saddles, pads, posts, rails, braces, casters, towBar };
}
