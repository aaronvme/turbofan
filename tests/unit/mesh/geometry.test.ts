import { describe, expect, it } from 'vitest';
import {
  keyPoints,
  validateFlowpath,
  type FlowpathGeometry,
} from '../../../tools/mesh/geometry/flowpath';
import { flowpathFromDefinition } from '../../../tools/mesh/geometry/definition';
import { ENGINE_DEFINITION } from '../../../src/engine/definition';

describe('validateFlowpath', () => {
  const g = flowpathFromDefinition(ENGINE_DEFINITION);
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
    const row = g.bladeRows[2];
    if (row === undefined) throw new Error('no row');
    const bad = { ...g, bladeRows: [{ ...row, name: 'X', xLE: 1, xTE: 0.9, te: row.le }] };
    expect(validateFlowpath(bad)).toContain('blade row X: xTE must exceed xLE');
    expect(validateFlowpath(bad)).toContain(
      'blade row X: trailing edge must be downstream at both walls',
    );
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
    const fat = g.curves.hub.map((p) =>
      p.x >= 1.16 && p.x <= 1.46 ? { x: p.x, r: p.r + 0.2 } : p,
    );
    expect(validateFlowpath(withCurves({ hub: fat }))).toContain(
      'core duct must have positive height',
    );
  });

  it('rejects blade edges off their walls and stations outside their duct', () => {
    const row = g.bladeRows[0];
    if (row === undefined) throw new Error('no row');
    const off = {
      ...row,
      le: { hub: row.le.hub, tip: { x: row.le.tip.x, r: row.le.tip.r - 0.01 } },
    };
    expect(validateFlowpath({ ...g, bladeRows: [off] })).toContain(
      `blade row ${row.name}: leading edge must run from wall to wall`,
    );
    const late = {
      ...row,
      te: { hub: { x: row.te.hub.x, r: row.te.hub.r + 0.01 }, tip: row.te.tip },
    };
    expect(validateFlowpath({ ...g, bladeRows: [late] })).toContain(
      `blade row ${row.name}: trailing edge must run from wall to wall`,
    );
    const stray = { ...g, stations: [{ id: '13', x: 1.9, duct: 'bypass' as const }] };
    expect(validateFlowpath(stray)).toContain('station 13 lies outside the bypass duct');
  });

  it('refuses key points of an empty curve', () => {
    expect(() => keyPoints(withCurves({ hub: [] }))).toThrow(/empty curve/);
    expect(() => keyPoints(withCurves({ coreOuter: [] }))).toThrow(/empty curve/);
  });
});
