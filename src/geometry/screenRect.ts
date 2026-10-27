// The screen rectangle an axis-aligned box can cover, in the composite's uv (0..1, y down).
// The composite runs the fan's 3 x 3 time-sample average (src/render/post.ts) only inside the
// fan's rectangle: outside it no pixel or neighbour can hold a fan fragment. Pure, so it is
// unit-tested (tests/unit/geometry/screenRect.test.ts).

export interface Box3Like {
  readonly min: readonly [number, number, number];
  readonly max: readonly [number, number, number];
}

export interface ScreenRect {
  /** True when the box cannot be bounded (a corner at or behind the camera plane). */
  readonly full: boolean;
  readonly min: readonly [number, number];
  readonly max: readonly [number, number];
}

const FULL: ScreenRect = { full: true, min: [0, 0], max: [1, 1] };
/** Clip w below which a corner counts as at the camera plane (m, ~ the near plane). */
const W_MIN = 1e-3;

/**
 * The uv rectangle of the box's eight corners under a column-major view-projection matrix
 * (three's Matrix4.elements), padded by `margin` (uv units) and clamped to the screen. A box
 * entirely off screen gives a zero-width rectangle on the screen's edge.
 */
export function screenRectOfBox(
  viewProj: readonly number[],
  box: Box3Like,
  margin: number,
): ScreenRect {
  const m = (i: number) => viewProj[i] ?? 0;
  let u0 = Infinity;
  let v0 = Infinity;
  let u1 = -Infinity;
  let v1 = -Infinity;
  for (let c = 0; c < 8; c++) {
    const x = c & 1 ? box.max[0] : box.min[0];
    const y = c & 2 ? box.max[1] : box.min[1];
    const z = c & 4 ? box.max[2] : box.min[2];
    const w = m(3) * x + m(7) * y + m(11) * z + m(15);
    if (!(w > W_MIN)) return FULL;
    const u = ((m(0) * x + m(4) * y + m(8) * z + m(12)) / w) * 0.5 + 0.5;
    const v = 0.5 - ((m(1) * x + m(5) * y + m(9) * z + m(13)) / w) * 0.5;
    u0 = Math.min(u0, u);
    u1 = Math.max(u1, u);
    v0 = Math.min(v0, v);
    v1 = Math.max(v1, v);
  }
  const clamp = (a: number) => Math.min(1, Math.max(0, a));
  return {
    full: false,
    min: [clamp(u0 - margin), clamp(v0 - margin)],
    max: [clamp(u1 + margin), clamp(v1 + margin)],
  };
}
