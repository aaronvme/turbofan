// The flow legend (w2/flowviz round 2): the colour bar of whatever a mode draws as colour, its
// ticks, its unit and where the data comes from (a MOCK field must never pass for the solver).
import { describe, expect, it } from 'vitest';
import { bakeLut } from '../../../../src/flow/viz/colormaps';
import { FIELD_QUANTITIES } from '../../../../src/flow/viz/fields';
import { legendFor, provenanceLabel } from '../../../../src/flow/viz/legend';
import { FLOW_VIZ_MODES } from '../../../../src/flow/viz/modes';

describe('legendFor', () => {
  it('is null for a mode without colour (Realistic)', () => {
    expect(legendFor('realistic', 'solver')).toBeNull();
  });

  it("shows the Data mode's quantity with ticks inside its range, in order", () => {
    const l = legendFor('data', 'solver');
    expect(l).not.toBeNull();
    if (l === null) return;
    const spec = FIELD_QUANTITIES[FLOW_VIZ_MODES.data.quantity];
    expect(l.title).toBe(spec.label);
    expect(l.unit).toBe(spec.unit);
    expect(l.ticks.length).toBeGreaterThanOrEqual(3);
    for (const t of l.ticks) {
      expect(t.value).toBeGreaterThanOrEqual(spec.min);
      expect(t.value).toBeLessThanOrEqual(spec.max);
      expect(t.at).toBeCloseTo((t.value - spec.min) / (spec.max - spec.min), 12);
    }
    const at = l.ticks.map((t) => t.at);
    expect([...at].sort((p, q) => p - q)).toEqual(at);
  });

  it('draws its bar from the same LUT the cut plane samples (the legend matches the pixels)', () => {
    const l = legendFor('data', 'solver');
    if (l === null) throw new Error('no legend');
    const lut = bakeLut(FIELD_QUANTITIES.mach.colormap);
    expect(l.stops.length).toBeGreaterThanOrEqual(16);
    for (const s of l.stops) {
      const i = Math.round(s.at * 255);
      expect(s.rgb).toEqual([lut[4 * i], lut[4 * i + 1], lut[4 * i + 2]]);
    }
    expect(l.stops[0]?.at).toBe(0);
    expect(l.stops.at(-1)?.at).toBe(1);
  });

  it('labels the log2 ratio quantities as ratios to the ambient', () => {
    const l = legendFor('cutaway', 'solver', 'p');
    if (l === null) throw new Error('no legend');
    expect(l.unit).toBe('p / p∞');
    const labels = l.ticks.map((t) => t.label);
    expect(labels).toContain('1');
    expect(labels).toContain('4');
    expect(labels).toContain('1/4');
  });

  it('gives the schlieren its grey deflection scale, in microradians', () => {
    const l = legendFor('schlieren', 'solver');
    if (l === null) throw new Error('no legend');
    expect(l.unit).toBe('µrad');
    expect(l.stops[0]?.rgb).toEqual([0, 0, 0]);
    expect(l.stops.at(-1)?.rgb).toEqual([255, 255, 255]);
    const zero = l.ticks.find((t) => t.value === 0);
    expect(zero?.at).toBeCloseTo(0.5, 12);
  });

  it('carries the provenance: MOCK is labelled as such', () => {
    expect(legendFor('data', 'mock')?.source).toBe('mock');
    expect(provenanceLabel('mock')).toMatch(/MOCK/);
    expect(provenanceLabel('solver')).toMatch(/solver/i);
    expect(provenanceLabel('mock')).not.toMatch(/solver/i);
  });
});
