import { describe, expect, it } from 'vitest';
import { uniform } from '../../../tools/mesh/distribution';
import { renderSvg } from '../../../tools/mesh/svg';
import { twoBoundary } from '../../../tools/mesh/tfi';
import { rectBlock, sideBySide } from './fixtures';

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

  it('drops nodes closer than a pixel to the last drawn point, keeping run ends', () => {
    // 1000 cells along a 100 px wide view: 0.1 px per cell along the rows
    const dense = { blocks: [rectBlock('D', 0, 1, 0, 0.1, 1000, 2)], patches: [] };
    const svg = renderSvg(dense, {
      title: 'dense',
      xMin: 0,
      xMax: 1,
      rMin: 0,
      rMax: 0.1,
      widthPx: 100,
    });
    // undecimated: 3 rows x 1000 segments + 1001 columns x 2 segments = 5002 line commands
    const lines = svg.match(/L/g)?.length ?? 0;
    expect(lines).toBeLessThan(3000);
    // every row still reaches the far edge of the view (x = 100 px)
    expect(svg.match(/L100 /g)?.length).toBeGreaterThanOrEqual(3);
  });

  it('puts a block label on one of its nodes, not in a hole of a C-shaped block', () => {
    // half annulus 1 < radius < 1.2 about (0, 0): the centroid of its nodes lies in the hole
    const arc = (rad: number): { x: number; r: number }[] =>
      Array.from(uniform(20), (u) => ({
        x: -rad * Math.cos(Math.PI * u),
        r: rad * Math.sin(Math.PI * u),
      }));
    const block = twoBoundary('C', arc(1), arc(1.2), () => uniform(2));
    const view = { title: 'C', xMin: -1.3, xMax: 1.3, rMin: 0, rMax: 1.3, widthPx: 260 };
    const svg = renderSvg({ blocks: [block], patches: [] }, view);
    const m = /class="block-label" x="([\d.]+)" y="([\d.]+)"/.exec(svg);
    expect(m).not.toBeNull();
    const lx = Number(m?.[1]);
    const ly = Number(m?.[2]);
    // pixel scale 100 px/m, plot top at the 44 px header
    let nearest = Infinity;
    for (let k = 0; k < block.x.length; k++) {
      const x = ((block.x[k] ?? 0) + 1.3) * 100;
      const y = 44 + (1.3 - (block.r[k] ?? 0)) * 100;
      nearest = Math.min(nearest, Math.hypot(x - lx, y - ly));
    }
    expect(nearest).toBeLessThan(0.1);
  });
});
