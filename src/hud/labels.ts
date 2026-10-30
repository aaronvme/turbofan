// Labels for points on a chart, placed so that no two overlap and none covers another point: the
// T-s chart's station labels (at ground idle T45 and T5 sit a few px apart). Pure and in px, so
// the rule is unit-tested and the browser suite checks the drawn text.

export interface PointLabelInput {
  readonly id: string;
  readonly text: string;
  /** The point, px. */
  readonly x: number;
  readonly y: number;
}

export interface PointLabel {
  readonly id: string;
  readonly text: string;
  /** The text's anchor point (the SVG x, y) and its side. */
  readonly x: number;
  readonly y: number;
  readonly anchor: 'start' | 'end';
}

/** The text's size, px: 9.5 px tabular digits (at most 5.8 px wide each), 9 px from baseline up. */
export const POINT_LABEL = { digitW: 5.8, h: 9 } as const;

export function pointLabelBox(l: PointLabel): { x: number; y: number; w: number; h: number } {
  const w = l.text.length * POINT_LABEL.digitW;
  return { x: l.anchor === 'start' ? l.x : l.x - w, y: l.y - POINT_LABEL.h, w, h: POINT_LABEL.h };
}

/** Candidate offsets from the point, in order: above right first (the chart's old place). */
const CANDIDATES: readonly [dx: number, dy: number, anchor: 'start' | 'end'][] = [
  [4, -4, 'start'],
  [5, 12, 'start'],
  [-4, -4, 'end'],
  [-5, 12, 'end'],
  [7, 4, 'start'],
  [-7, 4, 'end'],
  [4, -14, 'start'],
  [-4, -14, 'end'],
];

/** A label clears a point by this much, px (the chart's dots are 2.2 px). */
const DOT_CLEARANCE = 3;

/**
 * Each label at its first candidate place that overlaps no placed label, covers no point and
 * stays inside `bounds` (when given); a label with no such place keeps its first candidate inside
 * the bounds, so a station is never silently unlabelled.
 */
export function placePointLabels(
  points: readonly PointLabelInput[],
  o: { readonly bounds?: { x: number; y: number; w: number; h: number } } = {},
): PointLabel[] {
  const placed: PointLabel[] = [];
  const inBounds = (l: PointLabel) => {
    const b = o.bounds;
    if (b === undefined) return true;
    const r = pointLabelBox(l);
    return r.x >= b.x && r.y >= b.y && r.x + r.w <= b.x + b.w && r.y + r.h <= b.y + b.h;
  };
  const clear = (l: PointLabel) => {
    const r = pointLabelBox(l);
    const hitsLabel = placed.some((q) => {
      const s = pointLabelBox(q);
      return r.x < s.x + s.w && s.x < r.x + r.w && r.y < s.y + s.h && s.y < r.y + r.h;
    });
    const hitsDot = points.some(
      (p) =>
        p.x >= r.x - DOT_CLEARANCE &&
        p.x <= r.x + r.w + DOT_CLEARANCE &&
        p.y >= r.y - DOT_CLEARANCE &&
        p.y <= r.y + r.h + DOT_CLEARANCE,
    );
    return !hitsLabel && !hitsDot;
  };
  for (const p of points) {
    const options = CANDIDATES.map(([dx, dy, anchor]): PointLabel => ({
      id: p.id,
      text: p.text,
      x: p.x + dx,
      y: p.y + dy,
      anchor,
    })).filter(inBounds);
    const fallback: PointLabel = options[0] ?? {
      id: p.id,
      text: p.text,
      x: p.x + 4,
      y: p.y - 4,
      anchor: 'start',
    };
    placed.push(options.find(clear) ?? fallback);
  }
  return placed;
}
