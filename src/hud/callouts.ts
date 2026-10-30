// 3D-anchored callouts that never collide. The worker projects each anchor (a station plane or a
// component on the engine) to CSS pixels; this places each label at the first of a fixed set of
// offsets round its anchor that overlaps no label already placed, no reserved panel and stays on
// screen, in priority order; a label with no free place is hidden rather than drawn on top of
// another (deterministic: the same anchors give the same layout).

export interface Anchor {
  readonly id: string;
  /** CSS px from the top left of the canvas. */
  readonly x: number;
  readonly y: number;
  /** False when the anchor is behind the camera or hidden by the cutaway. */
  readonly visible: boolean;
  /** Higher places first. */
  readonly priority: number;
}

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface PlacedCallout {
  readonly id: string;
  readonly anchor: { readonly x: number; readonly y: number };
  readonly box: Rect;
}

/** Candidate label offsets from the anchor, CSS px (the leader line runs anchor to box edge). */
const OFFSETS: readonly (readonly [number, number])[] = [
  [18, -34],
  [18, 14],
  [-18, -34],
  [-18, 14],
  [40, -62],
  [-40, -62],
  [40, 42],
  [-40, 42],
  [70, -10],
  [-70, -10],
];
const GAP = 4;

export const overlaps = (a: Rect, b: Rect, gap = 0): boolean =>
  a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;

export function layoutCallouts(
  anchors: readonly Anchor[],
  size: (id: string) => { readonly w: number; readonly h: number },
  viewport: { readonly w: number; readonly h: number },
  reserved: readonly Rect[] = [],
): PlacedCallout[] {
  const placed: PlacedCallout[] = [];
  const taken: Rect[] = [...reserved];
  const order = anchors
    .filter((a) => a.visible && Number.isFinite(a.x) && Number.isFinite(a.y))
    .sort((a, b) => b.priority - a.priority || (a.id < b.id ? -1 : 1));
  for (const a of order) {
    const { w, h } = size(a.id);
    for (const [dx, dy] of OFFSETS) {
      const box: Rect = { x: dx >= 0 ? a.x + dx : a.x + dx - w, y: a.y + dy, w, h };
      const onScreen =
        box.x >= 0 && box.y >= 0 && box.x + w <= viewport.w && box.y + h <= viewport.h;
      // the label must not cover another anchor's dot either
      const coversAnchor = order.some(
        (o) => o !== a && overlaps(box, { x: o.x - 3, y: o.y - 3, w: 6, h: 6 }),
      );
      if (onScreen && !coversAnchor && !taken.some((t) => overlaps(box, t, GAP))) {
        placed.push({ id: a.id, anchor: { x: a.x, y: a.y }, box });
        taken.push(box);
        break;
      }
    }
  }
  return placed;
}

/** The point on a box's edge nearest the anchor (where the leader line ends). */
export function leaderEnd(anchor: { x: number; y: number }, box: Rect): { x: number; y: number } {
  return {
    x: Math.max(box.x, Math.min(anchor.x, box.x + box.w)),
    y: Math.max(box.y, Math.min(anchor.y, box.y + box.h)),
  };
}
