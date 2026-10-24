import { describe, expect, it } from 'vitest';
import { renderSvg } from '../../../tools/mesh/svg';
import { sideBySide } from './fixtures';

describe('renderSvg', () => {
  it('draws every block, its outline and the walls in a view box', () => {
    const mesh = sideBySide();
    const svg = renderSvg(mesh, {
      title: 'Two <blocks> & a wall',
      xMin: 0,
      xMax: 0.5,
      rMin: 0,
      rMax: 0.2,
      widthPx: 500,
    });
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg.trimEnd().endsWith('</svg>')).toBe(true);
    // 500 px wide, plot height from the aspect ratio (200 px) plus title and legend bands
    expect(svg).toMatch(/viewBox="0 0 500 (\d+)"/);
    expect(Number(/viewBox="0 0 500 (\d+)"/.exec(svg)?.[1])).toBeGreaterThan(200);
    expect(svg).toContain('Two &lt;blocks&gt; &amp; a wall');
    expect(svg).toContain('data-block="A"');
    expect(svg).toContain('data-block="B"');
    expect(svg).toContain('class="wall"');
    expect(svg).toContain('class="axis"');
    // a legend entry per block
    expect(svg.match(/class="legend-item"/g)?.length).toBe(2);
  });

  it('clips to the view: a zoom on block A leaves out block B', () => {
    const mesh = sideBySide();
    const full = renderSvg(mesh, {
      title: 'full',
      xMin: 0,
      xMax: 0.5,
      rMin: 0,
      rMax: 0.2,
      widthPx: 400,
    });
    const zoom = renderSvg(mesh, {
      title: 'zoom',
      xMin: 0,
      xMax: 0.12,
      rMin: 0,
      rMax: 0.2,
      widthPx: 400,
    });
    expect(zoom).not.toContain('data-block="B"');
    expect(zoom.length).toBeLessThan(full.length);
  });

  it('thins grid lines with a stride but keeps block outlines', () => {
    const mesh = sideBySide();
    const all = renderSvg(mesh, {
      title: 's1',
      xMin: 0,
      xMax: 0.5,
      rMin: 0,
      rMax: 0.2,
      widthPx: 400,
    });
    const thin = renderSvg(mesh, {
      title: 's2',
      xMin: 0,
      xMax: 0.5,
      rMin: 0,
      rMax: 0.2,
      widthPx: 400,
      lineStride: 2,
    });
    expect(thin.length).toBeLessThan(all.length);
    expect(thin).toContain('class="outline"');
  });
});
