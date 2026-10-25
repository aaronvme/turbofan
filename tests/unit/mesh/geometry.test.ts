import { describe, expect, it } from 'vitest';
import { Polyline } from '../../../tools/mesh/curve';
import {
  keyPoints,
  validateFlowpath,
  type FlowpathGeometry,
} from '../../../tools/mesh/geometry/flowpath';
import { placeholderFlowpath } from '../../../tools/mesh/geometry/placeholder';

describe('placeholder flowpath', () => {
  const g = placeholderFlowpath();

  it('is a valid geometry input', () => {
    expect(validateFlowpath(g)).toEqual([]);
  });

  it('has CFM56-7B-class proportions: 1.55 m fan, fan face at x = 0', () => {
    expect(g.fanTipDiameter).toBeCloseTo(1.55, 6);
    const casing = new Polyline(g.curves.nacelleInner);
    expect(casing.atX(0).r).toBeCloseTo(0.775, 6);
    const kp = keyPoints(g);
    expect(kp.highlight.x).toBeLessThan(0);
    expect(kp.spinnerNose.r).toBe(0);
    expect(kp.plugTip.r).toBe(0);
  });

  it('has a 2-3 cm tall HPC rear annulus', () => {
    const hub = new Polyline(g.curves.hub);
    const outer = new Polyline(g.curves.coreOuter);
    const hpcRows = g.bladeRows.filter((row) => row.name.startsWith('HPC'));
    expect(hpcRows.length).toBe(19);
    const lastRow = hpcRows[hpcRows.length - 1];
    if (lastRow === undefined) throw new Error('no HPC rows');
    const x = 0.5 * (lastRow.xLE + lastRow.xTE);
    const h = outer.atX(x).r - hub.atX(x).r;
    expect(h).toBeGreaterThanOrEqual(0.02);
    expect(h).toBeLessThanOrEqual(0.03);
  });

  it('keeps every blade row inside its duct', () => {
    const kp = keyPoints(g);
    for (const row of g.bladeRows) {
      if (row.duct === 'fan') {
        expect(row.xLE).toBeGreaterThan(0);
        expect(row.xTE).toBeLessThan(kp.splitter.x);
      } else if (row.duct === 'bypass') {
        expect(row.xLE).toBeGreaterThan(kp.splitter.x);
        expect(row.xTE).toBeLessThan(kp.bypassLip.x);
      } else {
        expect(row.xLE).toBeGreaterThan(kp.splitter.x);
        expect(row.xTE).toBeLessThan(kp.coreLip.x);
      }
    }
  });
});

describe('validateFlowpath', () => {
  const g = placeholderFlowpath();
  const withCurves = (patch: Partial<FlowpathGeometry['curves']>): FlowpathGeometry => ({
    ...g,
    curves: { ...g.curves, ...patch },
  });

  it('rejects a core cowl that does not start at the splitter', () => {
    const cowl = g.curves.coreCowl.map((p, k) => (k === 0 ? { x: p.x, r: p.r + 0.01 } : p));
    expect(validateFlowpath(withCurves({ coreCowl: cowl }))).toContain(
      'coreCowl must start at the splitter (coreOuter start)',
    );
  });

  it('rejects curves that run backwards or below the axis', () => {
    const back = [...g.curves.nacelleOuter].reverse();
    expect(validateFlowpath(withCurves({ nacelleOuter: back })).join(' ')).toMatch(
      /must not decrease/,
    );
    const below = g.curves.hub.map((p, k) => (k === 3 ? { x: p.x, r: -0.01 } : p));
    expect(validateFlowpath(withCurves({ hub: below })).join(' ')).toMatch(/negative radius/);
    expect(validateFlowpath(withCurves({ hub: g.curves.hub.slice(0, 1) })).join(' ')).toMatch(
      /fewer than two/,
    );
  });

  it('rejects a hub that does not close on the axis and bad blade rows', () => {
    const lifted = g.curves.hub.map((p, k) => (k === 0 ? { x: p.x, r: 0.01 } : p));
    expect(validateFlowpath(withCurves({ hub: lifted }))).toContain(
      'hub must start on the axis (spinner nose)',
    );
    const bad = { ...g, bladeRows: [{ name: 'X', duct: 'core' as const, xLE: 1, xTE: 0.9 }] };
    expect(validateFlowpath(bad)).toContain('blade row X: xTE must exceed xLE');
    const open = g.curves.hub.map((p, k, a) => (k === a.length - 1 ? { x: p.x, r: 0.01 } : p));
    expect(validateFlowpath(withCurves({ hub: open }))).toContain(
      'hub must end on the axis (plug tip)',
    );
  });

  it('rejects curves that do not meet at the lips', () => {
    const lift = (c: readonly { x: number; r: number }[], first: boolean) =>
      c.map((p, k) => (k === (first ? 0 : c.length - 1) ? { x: p.x, r: p.r + 0.01 } : p));
    expect(validateFlowpath(withCurves({ coreCowl: lift(g.curves.coreCowl, false) }))).toContain(
      'coreCowl must end at the core lip (coreOuter end)',
    );
    expect(
      validateFlowpath(withCurves({ nacelleOuter: lift(g.curves.nacelleOuter, true) })),
    ).toContain('nacelleOuter must start at the highlight');
    expect(
      validateFlowpath(withCurves({ nacelleOuter: lift(g.curves.nacelleOuter, false) })),
    ).toContain('nacelleOuter must end at the bypass lip');
  });

  it('rejects stations in the wrong order and ducts or walls without thickness', () => {
    const shift = (c: readonly { x: number; r: number }[], dx: number) =>
      c.map((p) => ({ x: p.x + dx, r: p.r }));
    // everything moved 1 m downstream: highlight and spinner nose behind the fan face
    const c = g.curves;
    const moved: FlowpathGeometry['curves'] = {
      hub: shift(c.hub, 1),
      coreOuter: shift(c.coreOuter, 1),
      coreCowl: shift(c.coreCowl, 1),
      nacelleInner: shift(c.nacelleInner, 1),
      nacelleOuter: shift(c.nacelleOuter, 1),
    };
    expect(validateFlowpath({ ...g, curves: moved })).toContain(
      'highlight and spinner nose must be upstream of the fan face x = 0',
    );
    // the plug cut off before the core lip, so the plug tip and the station order are wrong
    const short = g.curves.hub
      .filter((p) => p.x < 2.9)
      .map((p, k, a) => (k === a.length - 1 ? { x: p.x, r: 0 } : p));
    const problems = validateFlowpath(withCurves({ hub: short })).join(' ');
    expect(problems).toMatch(/plug tip must be downstream of the core lip/);
    // a hub pushed through the core duct wall
    const fat = g.curves.hub.map((p) => (p.x > 1.2 && p.x < 1.4 ? { x: p.x, r: p.r + 0.2 } : p));
    expect(validateFlowpath(withCurves({ hub: fat }))).toContain(
      'core duct must have positive height',
    );
  });

  it('refuses key points of an empty curve', () => {
    expect(() => keyPoints(withCurves({ hub: [] }))).toThrow(/empty curve/);
    expect(() => keyPoints(withCurves({ coreOuter: [] }))).toThrow(/empty curve/);
  });
});
