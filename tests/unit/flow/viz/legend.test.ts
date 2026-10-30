// The flow legend (w2/flowviz round 2): the colour bar of whatever a mode draws as colour, its
// ticks, its unit and where the data comes from (a MOCK field must never pass for the solver).
import { describe, expect, it } from 'vitest';
import { bakeLut } from '../../../../src/flow/viz/colormaps';
import { FIELD_QUANTITIES } from '../../../../src/flow/viz/fields';
import {
  dilationLabel,
  flowModeNote,
  legendFor,
  provenanceLabel,
} from '../../../../src/flow/viz/legend';
import { FLOW_VIZ_MODES } from '../../../../src/flow/viz/modes';

describe('legendFor', () => {
  it('is null for a mode without colour (Realistic)', () => {
    expect(legendFor('realistic', 'uncoupled')).toBeNull();
  });

  it("shows the Data mode's quantity with ticks inside its range, in order", () => {
    const l = legendFor('data', 'uncoupled');
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
    const l = legendFor('data', 'uncoupled');
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
    const l = legendFor('cutaway', 'uncoupled', 'p');
    if (l === null) throw new Error('no legend');
    expect(l.unit).toBe('p / p∞');
    const labels = l.ticks.map((t) => t.label);
    expect(labels).toContain('1');
    expect(labels).toContain('4');
    expect(labels).toContain('1/4');
  });

  it('gives the schlieren its grey deflection scale, in microradians', () => {
    const l = legendFor('schlieren', 'uncoupled');
    if (l === null) throw new Error('no legend');
    expect(l.unit).toBe('µrad');
    expect(l.stops[0]?.rgb).toEqual([0, 0, 0]);
    expect(l.stops.at(-1)?.rgb).toEqual([255, 255, 255]);
    const zero = l.ticks.find((t) => t.value === 0);
    expect(zero?.at).toBeCloseTo(0.5, 12);
  });

  it('carries the provenance: MOCK is labelled as such', () => {
    expect(legendFor('data', 'mock')?.coupling).toBe('mock');
    expect(provenanceLabel('mock')).toMatch(/MOCK/);
    expect(provenanceLabel('mock')).not.toMatch(/solver/i);
  });

  // W2V-I1, D4-82: the solver's field is not the engine's answer until W3 couples it
  it("says the solver's field is uncoupled until W3, and only a coupled one is the live answer", () => {
    expect(legendFor('data', 'uncoupled')?.coupling).toBe('uncoupled');
    expect(provenanceLabel('uncoupled')).toMatch(/solver \(uncoupled until W3\)/);
    expect(provenanceLabel('uncoupled')).toMatch(/no blade or combustor forces/);
    expect(provenanceLabel('coupled')).toMatch(/solver/i);
    expect(provenanceLabel('coupled')).not.toMatch(/uncoupled/);
    expect(provenanceLabel('coupled')).not.toEqual(provenanceLabel('uncoupled'));
  });

  // W2V-I6, D4-82: a runtime MOCK fallback is visible, with its reason, never silent
  it('labels a runtime MOCK fallback as MOCK, with the reason', () => {
    const l = provenanceLabel('mock', 'solver lost: device removed');
    expect(l).toMatch(/MOCK/);
    expect(l).toMatch(/fallback/i);
    expect(l).toContain('solver lost: device removed');
    expect(provenanceLabel('mock', null)).toEqual(provenanceLabel('mock'));
  });
});

describe('flowModeNote and dilationLabel', () => {
  it('names every derived part of a mode and says the visuals add nothing synthesized', () => {
    expect(dilationLabel(1 / 200)).toBe('x1/200');
    expect(dilationLabel(1)).toBe('x1 (real time)');
    // D4-83: Realistic has no tracers by default; W2V-N17: its haze is the mean flow's
    const r = flowModeNote('realistic', 1 / 200);
    expect(r).toMatch(
      /^Heat haze from its density gradient \(Gladstone-Dale; mean flow, no shimmer\)/,
    );
    expect(r).not.toMatch(/tracer/i);
    expect(r).toMatch(/The visuals add nothing synthesized\.$/);
    expect(r).not.toMatch(/Derived from the field; nothing synthesized/);
    // tracers as an option; W2V-N18: the exposure and its cap are stated
    const t = flowModeNote('realistic', 1 / 200, undefined, true);
    expect(t).toMatch(/^Tracer streaks advected by its velocity, time x1\/200/);
    expect(t).toMatch(/0\.25 s exposures, at most 45 cm/);
    expect(t).toMatch(/heat haze/);
    expect(flowModeNote('data', 1 / 100)).toMatch(
      /^Cut plane: mach number of the field; laser-sheet/,
    );
    expect(flowModeNote('data', 1 / 100, undefined, false)).not.toMatch(/laser-sheet/);
    expect(flowModeNote('cutaway', 1 / 100, 't')).toMatch(/static temperature/);
    // W2V-N10: a/f 1 mrad keeps the core jet's shear layers inside the grey scale
    expect(flowModeNote('schlieren', 1)).toMatch(/^Knife-edge schlieren .* a\/f 1000 µrad/);
  });
});
