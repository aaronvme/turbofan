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

/**
 * Candidate label offsets from the anchor, CSS px (the leader line runs anchor to box edge): close
 * above and below first, then further out with longer leaders (W2A-I3: outward places let the
 * leaders fan out instead of crossing).
 */
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
  [60, -96],
  [-60, -96],
  [60, 76],
  [-60, 76],
  [110, -40],
  [-110, -40],
  [110, 20],
  [-110, 20],
];
const GAP = 4;

/**
 * Round 5: an anchor is called out when it is in view and on the picture, not under a panel (the
 * open drawer, a side column): a label there would point at a part the panel covers.
 */
function callable(a: Anchor, reserved: readonly Rect[]): boolean {
  if (!a.visible || !Number.isFinite(a.x) || !Number.isFinite(a.y)) return false;
  return !reserved.some((r) => a.x >= r.x && a.x <= r.x + r.w && a.y >= r.y && a.y <= r.y + r.h);
}

export const overlaps = (a: Rect, b: Rect, gap = 0): boolean =>
  a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;

type Pt = { readonly x: number; readonly y: number };

/** Whether segments ab and cd cross properly (sharing an end or touching does not count). */
function segmentsCross(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const o = (p: Pt, q: Pt, r: Pt) =>
    Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
}

/** Whether segment ab crosses an edge of the box (runs through or into it). */
function segmentCrossesBox(a: Pt, b: Pt, r: Rect): boolean {
  const c = [
    { x: r.x, y: r.y },
    { x: r.x + r.w, y: r.y },
    { x: r.x + r.w, y: r.y + r.h },
    { x: r.x, y: r.y + r.h },
  ] as const;
  return c.some((p, i) => segmentsCross(a, b, p, c[(i + 1) % 4] ?? p));
}

/** Whether two placed callouts' leaders cross, or either's leader runs through the other's box. */
function tangled(p: PlacedCallout, q: PlacedCallout): boolean {
  const pe = leaderEnd(p.anchor, p.box);
  const qe = leaderEnd(q.anchor, q.box);
  return (
    segmentsCross(p.anchor, pe, q.anchor, qe) ||
    segmentCrossesBox(p.anchor, pe, q.box) ||
    segmentCrossesBox(q.anchor, qe, p.box)
  );
}

/**
 * W2A-I3: the pairs of placed callouts whose leaders cross, or whose leader runs through the
 * other's label.
 */
export function leaderCrossings(placed: readonly PlacedCallout[]): number {
  let n = 0;
  placed.forEach((p, i) => {
    for (const q of placed.slice(i + 1)) if (tangled(p, q)) n++;
  });
  return n;
}

/**
 * Places the labels in priority order, each at the first candidate offset that is on screen,
 * clear of the reserved panels, the placed labels and the other anchors' dots, and (W2A-I3) whose
 * leader crosses no placed leader or label; failing that, at a clear one with the fewest crossings
 * (a crossing is better than a hidden label; W2A-N21: any of them, not only the first); failing
 * that, hidden.
 */
export function layoutCallouts(
  anchors: readonly Anchor[],
  size: (id: string) => { readonly w: number; readonly h: number },
  viewport: { readonly w: number; readonly h: number },
  reserved: readonly Rect[] = [],
  /** Places tried before the offsets (D4-92 zz: the cut views' row places). */
  preferred: (id: string) => readonly Rect[] = () => [],
  /** D4-97 item 2: only the preferred places (the cut views' rows), no offsets. */
  preferredOnly = false,
): PlacedCallout[] {
  const order = anchors
    .filter((a) => callable(a, reserved))
    .sort((a, b) => b.priority - a.priority || (a.id < b.id ? -1 : 1));
  // each anchor's places that are on screen, off the reserved panels and the other dots
  const candidates = order.map((a) => {
    const { w, h } = size(a.id);
    const out: PlacedCallout[] = [];
    const boxes: Rect[] = [
      ...preferred(a.id),
      ...(preferredOnly ? [] : OFFSETS).map(([dx, dy]) => ({
        x: dx >= 0 ? a.x + dx : a.x + dx - w,
        y: a.y + dy,
        w,
        h,
      })),
    ];
    for (const box of boxes) {
      const onScreen =
        box.x >= 0 && box.y >= 0 && box.x + w <= viewport.w && box.y + h <= viewport.h;
      // the label must not cover another anchor's dot either
      const coversAnchor = order.some(
        (o) => o !== a && overlaps(box, { x: o.x - 3, y: o.y - 3, w: 6, h: 6 }),
      );
      if (onScreen && !coversAnchor && !reserved.some((t) => overlaps(box, t, GAP)))
        out.push({ id: a.id, anchor: { x: a.x, y: a.y }, box });
    }
    return out;
  });
  // A bounded depth-first search in priority order (W2A-I3): each label at a place clear of the
  // labels placed before it, crossing-free places first, then the first that crosses, then
  // hidden. The best layout places the most labels (the higher priorities first), then has the
  // fewest crossings; the first such found wins (so the offsets' order is the preference).
  // The pairs are tested once, up front: whether two places collide, and whether they tangle.
  const flat = candidates.flat();
  const base: number[] = [];
  candidates.reduce((n, c) => (base.push(n), n + c.length), 0);
  const n = flat.length;
  const collide = new Uint8Array(n * n);
  const tangle = new Uint8Array(n * n);
  for (let g = 0; g < n; g++)
    for (let h = g + 1; h < n; h++) {
      const p = flat[g];
      const q = flat[h];
      if (p === undefined || q === undefined || p.id === q.id) continue;
      if (overlaps(p.box, q.box, GAP)) collide[g * n + h] = collide[h * n + g] = 1;
      else if (tangled(p, q)) tangle[g * n + h] = tangle[h * n + g] = 1;
    }
  let best: { chosen: number[]; crossings: number } | null = null;
  // shown labels by priority rank (a higher priority shown outranks any lower ones), then fewer
  // crossings
  const better = (chosen: readonly number[], crossings: number) => {
    if (best === null) return true;
    for (let k = 0; k < chosen.length; k++) {
      const s = (chosen[k] ?? -1) >= 0;
      const t = (best.chosen[k] ?? -1) >= 0;
      if (s !== t) return s;
    }
    return crossings < best.crossings;
  };
  // whether the best found already shows the same labels up to i and label i too (so hiding it,
  // or crossing where it was crossing-free, cannot do better)
  const bestShowsPrefix = (chosen: readonly number[], i: number) =>
    best !== null &&
    (best.chosen[i] ?? -1) >= 0 &&
    chosen.every((c, k) => c >= 0 === (best?.chosen[k] ?? -1) >= 0);
  let nodes = 0;
  const chosen: number[] = [];
  const search = (i: number, crossings: number): boolean => {
    if (++nodes > SEARCH_NODES) return true;
    // W2A-N13: a branch with as many crossings is cut only when the best also shows every label
    // from here on (otherwise this branch may still show a label the best hides)
    if (
      best !== null &&
      crossings >= best.crossings &&
      bestShowsPrefix(chosen, i - 1) &&
      best.chosen.slice(i).every((c) => c >= 0)
    )
      return false;
    if (i === order.length) {
      if (better(chosen, crossings)) best = { chosen: [...chosen], crossings };
      return crossings === 0 && chosen.every((c) => c >= 0);
    }
    const free: { g: number; t: number }[] = [];
    const count = candidates[i]?.length ?? 0;
    for (let k = 0; k < count; k++) {
      const g = (base[i] ?? 0) + k;
      let t = 0;
      let ok = true;
      for (const h of chosen) {
        if (h < 0) continue;
        if (collide[g * n + h] === 1) {
          ok = false;
          break;
        }
        t += tangle[g * n + h] ?? 0;
      }
      if (ok) free.push({ g, t });
    }
    // W2A-N21: every crossing place too, the fewest crossings first (the bound above prunes
    // them): the first one can block a later label that another would let through
    const crossing = free.filter((f) => f.t > 0).sort((p, q) => p.t - q.t);
    for (const f of [...free.filter((f) => f.t === 0), ...crossing]) {
      chosen.push(f.g);
      const done = search(i + 1, crossings + f.t);
      chosen.pop();
      if (done) return true;
    }
    if (free.length > 0 && bestShowsPrefix(chosen, i)) return false;
    chosen.push(-1);
    const done = search(i + 1, crossings);
    chosen.pop();
    return done;
  };
  search(0, 0);
  const picked = (best as { chosen: number[] } | null)?.chosen ?? [];
  return picked.flatMap((g) => {
    const p = g >= 0 ? flat[g] : undefined;
    return p === undefined ? [] : [p];
  });
}

/** The layout search's node budget: deterministic, about a millisecond at the app's 8 anchors. */
const SEARCH_NODES = 2000;

/** The point on a box's edge nearest the anchor (where the leader line ends). */
export function leaderEnd(anchor: { x: number; y: number }, box: Rect): { x: number; y: number } {
  return {
    x: Math.max(box.x, Math.min(anchor.x, box.x + box.w)),
    y: Math.max(box.y, Math.min(anchor.y, box.y + box.h)),
  };
}

/** A cut view's anchor with its part's axial position (world x, m): the labels keep its order. */
export interface AxialAnchor extends Anchor {
  readonly axial: number;
}

/** The gap between the engine's screen box and a row of labels, CSS px. */
const ROW_GAP = 12;

/**
 * D4-92 (zz): the cut views' labels go outward, in a row above the engine's screen box and one
 * below it, the parts alternating between them in axial order (fan first), each label as near
 * above (or below) its anchor as the row allows, the row's order kept left to right, so the
 * leaders fan out from the parts instead of running along the shaft. D4-97 item 2: the camera is
 * framed for the rows (the worker's cut-view framing), and a label its row has no room for (a
 * panel, the screen's edge, the rows' own width) is hidden, by priority, never placed on the
 * section it names. Of the two ways to start the alternation, the one that places more labels
 * (by priority) with fewer leader crossings wins.
 */
export function layoutAxial(
  anchors: readonly AxialAnchor[],
  size: (id: string) => { readonly w: number; readonly h: number },
  viewport: { readonly w: number; readonly h: number },
  reserved: readonly Rect[],
  band: Rect,
): PlacedCallout[] {
  const vis = anchors
    .filter((a) => callable(a, reserved))
    .sort((a, b) => a.axial - b.axial || (a.id < b.id ? -1 : 1));
  // the rows' limits: under the full-width bar at the top, over the one at the bottom
  const wide = reserved.filter((r) => r.w > viewport.w / 2);
  const topLimit = Math.max(0, ...wide.filter((r) => r.y <= 1).map((r) => r.y + r.h + GAP));
  const bottomLimit = Math.min(
    viewport.h,
    ...wide.filter((r) => r.y + r.h >= viewport.h - 1).map((r) => r.y - GAP),
  );
  const rows = (parity: number): Map<string, Rect> => {
    const out = new Map<string, Rect>();
    for (const above of [true, false]) {
      const row = vis.filter((_, i) => (i % 2 === parity) === above);
      const boxes = row.map((a) => {
        const { w, h } = size(a.id);
        const y = above ? band.y - ROW_GAP - h : band.y + band.h + ROW_GAP;
        return { a, w, h, y: Math.max(topLimit, Math.min(bottomLimit - h, y)), x: a.x - w / 2 };
      });
      if (boxes.length === 0) continue;
      // the row's span: between the panels beside the engine at the row's height
      const rowY0 = Math.min(...boxes.map((b) => b.y));
      const rowY1 = Math.max(...boxes.map((b) => b.y + b.h));
      const mid = band.x + band.w / 2;
      let lo = 0;
      let hi = viewport.w;
      for (const r of reserved) {
        if (!(r.y < rowY1 && rowY0 < r.y + r.h) || r.w > viewport.w / 2) continue;
        if (r.x + r.w <= mid) lo = Math.max(lo, r.x + r.w + GAP);
        else if (r.x >= mid) hi = Math.min(hi, r.x - GAP);
      }
      // order kept: pushed right past the previous label, then back left from the span's end
      for (let k = 0; k < boxes.length; k++) {
        const b = boxes[k];
        const prev = boxes[k - 1];
        if (b === undefined) continue;
        b.x = Math.max(b.x, lo, prev === undefined ? -Infinity : prev.x + prev.w + GAP);
      }
      for (let k = boxes.length - 1; k >= 0; k--) {
        const b = boxes[k];
        const next = boxes[k + 1];
        if (b === undefined) continue;
        b.x = Math.min(b.x, hi - b.w, next === undefined ? Infinity : next.x - b.w - GAP);
      }
      for (const b of boxes) out.set(b.a.id, { x: b.x, y: b.y, w: b.w, h: b.h });
    }
    return out;
  };
  // the row places go first in the general search, which keeps its guarantees (no overlap, no
  // panel, the fewest leader crossings) and its offsets for a label its row has no room for
  const attempt = (parity: number) => {
    const r = rows(parity);
    return layoutCallouts(
      vis,
      size,
      viewport,
      reserved,
      (id) => {
        const box = r.get(id);
        return box === undefined ? [] : [box];
      },
      true,
    );
  };
  // the shown labels by priority rank, then their count, then fewer crossings
  const rank = (p: readonly PlacedCallout[]) =>
    [...vis]
      .sort((a, b) => b.priority - a.priority)
      .map((a) => (p.some((q) => q.id === a.id) ? '1' : '0'))
      .join('');
  const tries = [attempt(0), attempt(1)];
  tries.sort(
    (p, q) =>
      (rank(q) > rank(p) ? 1 : rank(q) < rank(p) ? -1 : 0) ||
      leaderCrossings(p) - leaderCrossings(q),
  );
  return tries[0] ?? [];
}
