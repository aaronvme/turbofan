// Point labels without overlap (src/hud/labels.ts): the T-s chart's station labels. At ground idle
// T45 and T5 sit a few px apart on the chart, and "45" was drawn over "5".
import { describe, expect, it } from 'vitest';
import { pointLabelBox, placePointLabels, type PointLabel } from '../../../src/hud/labels';

const intersects = (a: PointLabel, b: PointLabel) => {
  const p = pointLabelBox(a);
  const q = pointLabelBox(b);
  return p.x < q.x + q.w && q.x < p.x + p.w && p.y < q.y + q.h && q.y < p.y + p.h;
};

describe('point labels', () => {
  it('puts a lone label above and to the right of its point', () => {
    const [l] = placePointLabels([{ id: '3', text: '3', x: 100, y: 100 }]);
    expect(l).toMatchObject({ id: '3', anchor: 'start' });
    expect(l?.x).toBeGreaterThan(100);
    expect(l?.y).toBeLessThan(100);
  });

  it('moves a crowded label to a free side, so no two labels overlap and none covers a dot', () => {
    const pts = [
      { id: '45', text: '45', x: 200, y: 60 },
      { id: '5', text: '5', x: 203, y: 64 },
      { id: '4', text: '4', x: 196, y: 40 },
    ];
    const placed = placePointLabels(pts);
    expect(placed.map((l) => l.id)).toEqual(['45', '5', '4']);
    placed.forEach((a, i) => {
      for (const b of placed.slice(i + 1))
        expect(intersects(a, b), `${a.id} / ${b.id}`).toBe(false);
      for (const p of pts) {
        const box = pointLabelBox(a);
        const inside =
          p.x >= box.x - 2 &&
          p.x <= box.x + box.w + 2 &&
          p.y >= box.y - 2 &&
          p.y <= box.y + box.h + 2;
        expect(inside, `label ${a.id} over dot ${p.id}`).toBe(false);
      }
    });
  });

  it('keeps the labels inside the plot', () => {
    const placed = placePointLabels([{ id: '4', text: '4', x: 298, y: 3 }], {
      bounds: { x: 0, y: 0, w: 300, h: 168 },
    });
    const b = pointLabelBox(placed[0] as PointLabel);
    expect(b.x).toBeGreaterThanOrEqual(0);
    expect(b.y).toBeGreaterThanOrEqual(0);
    expect(b.x + b.w).toBeLessThanOrEqual(300);
  });
});
