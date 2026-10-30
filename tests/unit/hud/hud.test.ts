// The overlay's pure view-model: map geometry on the model's own maps, the T-s path from the
// model's stations, callout layout, the ledger parser, formatting and the annunciators.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  chartSpeedPercents,
  FAN_LINES,
  HPC_LINES,
  labelBox,
  lowestMapPercent,
  mapGeometry,
  niceTicks,
  placeSpeedLabels,
  plotPoint,
  pushTrail,
  scaleOf,
  SM_CAUTION_FRACTION,
  surgeMarginView,
} from '../../../src/hud/compressorMap';
import { tsDiagram } from '../../../src/hud/tsDiagram';
import { layoutCallouts, leaderCrossings, leaderEnd, overlaps } from '../../../src/hud/callouts';
import { ledgerKind, parseFidelityLedger, stripMarkdown } from '../../../src/hud/ledger';
import * as f from '../../../src/hud/format';
import {
  faultAnnunciations,
  flagAnnunciations,
  fieldFallbackAnnunciation,
  flowAnnunciation,
  gasPathAnnunciation,
  provenanceBadges,
} from '../../../src/hud/annunciators';
import { referenceEngine } from '../../../src/cycle/engine';
import { createCycleModel } from '../../../src/cycle/model';
import { DEFAULT_CYCLE_INPUTS } from '../../../src/contracts/cycle';
import { compressorPoint } from '../../../src/cycle/componentMaps';

const engine = referenceEngine();
const frame = (which: 'fan' | 'hpc') => ({
  map: engine.maps[which],
  designCorrectedRpm: engine.design.corrSpeed[which],
  referenceRpm:
    which === 'fan' ? engine.calibration.n1ReferenceRpm : engine.calibration.n2ReferenceRpm,
});

// the model's own steps: a test runtime limit, as the cycle tests carry (not a threshold)
describe('compressor map geometry', { timeout: 120_000 }, () => {
  it('draws the speed lines and the stall line of the model own scaled map', () => {
    const g = mapGeometry(frame('hpc'), [80, 100]);
    expect(g.speedLines.map((s) => s.percent)).toEqual([80, 100]);
    const fr = frame('hpc');
    const f100 = fr.referenceRpm / fr.designCorrectedRpm;
    const p = compressorPoint(fr.map, f100, fr.map.map.rlineStall);
    // the 100 % line starts on the stall R-line, the surge line ends there
    expect(g.speedLines[1]?.points[0]).toEqual([p.correctedFlow, p.pressureRatio]);
    expect(g.surgeLine[g.surgeLine.length - 1]).toEqual([p.correctedFlow, p.pressureRatio]);
    // pressure ratio falls along a speed line toward choke (R-line up)
    const pts = g.speedLines[1]?.points ?? [];
    expect(pts[pts.length - 1]?.[1]).toBeLessThan(pts[0]?.[1] ?? 0);
    expect(g.bounds.pr[1]).toBeGreaterThan(p.pressureRatio * 0.99);
  });

  it('puts the running engine inside its surge line (positive margin at idle and take-off)', () => {
    const model = createCycleModel();
    let s = model.reset('groundIdle');
    const g = mapGeometry(frame('hpc'));
    const check = () => {
      expect(s.hpc.surgeMarginFraction).toBeGreaterThan(0);
      expect(s.hpc.correctedFlowKgPerS).toBeGreaterThan(g.bounds.wc[0]);
      expect(s.hpc.correctedFlowKgPerS).toBeLessThan(g.bounds.wc[1]);
    };
    check();
    for (let k = 0; k < 10; k++)
      s = model.step(1, { ...DEFAULT_CYCLE_INPUTS, fuelLever: 'run', throttleLever: 1 });
    check();
  });

  it("D4-87: the map's lowest speed line is the map's own (the fan's 30.6 %, the HPC's 44 %)", () => {
    for (const which of ['fan', 'hpc'] as const) {
      const f = frame(which);
      const expected =
        (100 * (f.map.map.nc[0] ?? NaN) * f.designCorrectedRpm) /
        (f.map.map.design.nc * f.referenceRpm);
      expect(lowestMapPercent(f), which).toBeCloseTo(expected, 9);
      expect(mapGeometry(f).lowestPercent, which).toBeCloseTo(expected, 9);
      // the chart draws the map down to its lowest line, then the round lines above it
      const lines = chartSpeedPercents(f, [40, 50, 60, 100]);
      expect(lines[0], which).toBeCloseTo(expected, 9);
      expect(lines.slice(1).every((p) => p >= expected + 5)).toBe(true);
    }
    expect(lowestMapPercent(frame('fan'))).toBeCloseTo(30.6, 1);
    expect(lowestMapPercent(frame('hpc'))).toBeCloseTo(44.0, 1);
  });

  it('D4-87: a surge margin below the map is dimmed and tagged "below map", never amber or red; on the map amber and red apply', () => {
    const fan = mapGeometry(frame('fan'), chartSpeedPercents(frame('fan'), FAN_LINES));
    const hpc = mapGeometry(frame('hpc'), chartSpeedPercents(frame('hpc'), HPC_LINES));
    const idle = createCycleModel().reset('groundIdle');
    // ground idle: the fan's corrected speed (about 20 %) is below its map's lowest line, and its
    // 3.6 % margin is extrapolated there (amber before D4-87)
    expect(100 * idle.fan.correctedSpeedFraction).toBeLessThan(fan.lowestPercent);
    expect(idle.fan.surgeMarginFraction).toBeLessThan(SM_CAUTION_FRACTION);
    expect(surgeMarginView(fan, idle.fan)).toEqual({ level: 'belowMap', tag: 'below map' });
    // the HPC at idle is on its map, with a normal margin
    expect(surgeMarginView(hpc, idle.hpc)).toEqual({ level: 'normal', tag: null });
    const on = { ...idle.fan, correctedSpeedFraction: 0.8 };
    expect(surgeMarginView(fan, { ...on, surgeMarginFraction: 0.2 }).level).toBe('normal');
    expect(surgeMarginView(fan, { ...on, surgeMarginFraction: 0.03 }).level).toBe('caution');
    expect(surgeMarginView(fan, { ...on, surgeMarginFraction: 0 }).level).toBe('warning');
    expect(surgeMarginView(fan, { ...on, surgeMarginFraction: -0.02 }).level).toBe('warning');
    // below the map neither applies, whatever the extrapolated number says
    const below = { ...idle.fan, correctedSpeedFraction: 0.2 };
    expect(surgeMarginView(fan, { ...below, surgeMarginFraction: -0.02 })).toEqual({
      level: 'belowMap',
      tag: 'below map',
    });
  });

  it('W2A-I2: the idle and take-off operating points lie inside both charts, and a point off the chart is clamped to its edge', () => {
    const fan = mapGeometry(frame('fan'), chartSpeedPercents(frame('fan'), FAN_LINES));
    const hpc = mapGeometry(frame('hpc'), chartSpeedPercents(frame('hpc'), HPC_LINES));
    const model = createCycleModel();
    let s = model.reset('groundIdle');
    const inside = (g: typeof fan, p: typeof s.fan, what: string) => {
      expect(p.correctedFlowKgPerS, what).toBeGreaterThan(g.bounds.wc[0]);
      expect(p.correctedFlowKgPerS, what).toBeLessThan(g.bounds.wc[1]);
      expect(p.pressureRatio, what).toBeGreaterThanOrEqual(g.bounds.pr[0]);
      expect(p.pressureRatio, what).toBeLessThan(g.bounds.pr[1]);
    };
    inside(fan, s.fan, 'fan at idle');
    inside(hpc, s.hpc, 'hpc at idle');
    for (let k = 0; k < 10; k++)
      s = model.step(1, { ...DEFAULT_CYCLE_INPUTS, fuelLever: 'run', throttleLever: 1 });
    inside(fan, s.fan, 'fan at take-off');
    inside(hpc, s.hpc, 'hpc at take-off');
    // the plot's rectangle, px: inside it a point is drawn where it is, outside on its edge
    const plot = { x: 40, y: 10, w: 252, h: 128 };
    expect(plotPoint(100, 50, plot, 3)).toEqual({ x: 100, y: 50, off: null });
    expect(plotPoint(-20, 50, plot, 3)).toEqual({ x: 43, y: 50, off: { dx: -1, dy: 0 } });
    expect(plotPoint(400, 200, plot, 3)).toEqual({ x: 289, y: 135, off: { dx: 1, dy: 1 } });
    expect(plotPoint(100, Number.NaN, plot, 3).off).not.toBeNull();
  });

  it('keeps a bounded trail without repeating a still point', () => {
    let t = pushTrail([], { correctedFlowKgPerS: 1, pressureRatio: 2 }, 3);
    t = pushTrail(t, { correctedFlowKgPerS: 1, pressureRatio: 2 }, 3);
    expect(t).toHaveLength(1);
    for (let k = 2; k < 6; k++) t = pushTrail(t, { correctedFlowKgPerS: k, pressureRatio: 2 }, 3);
    expect(t.map((p) => p[0])).toEqual([3, 4, 5]);
  });

  it("labels the speed lines without overlap: the HPC map's 95/100/105 crowd keeps its round line", () => {
    // three line ends 4 px apart (the HPC map's top at the chart's size): only 100 is labelled
    const crowd = [95, 100, 105].map((percent, k) => ({ percent, x: 250 + 3 * k, y: 30 - 4 * k }));
    expect(placeSpeedLabels(crowd).map((l) => l.percent)).toEqual([100]);
    // apart, every line keeps its label, in the input order
    const apart = [60, 70, 80].map((percent, k) => ({ percent, x: 60 + 60 * k, y: 150 - 40 * k }));
    expect(placeSpeedLabels(apart).map((l) => l.percent)).toEqual([60, 70, 80]);
    const overlapping = (ls: ReturnType<typeof placeSpeedLabels>) =>
      ls.some((a, i) =>
        ls.slice(i + 1).some((b) => {
          const p = labelBox(a);
          const q = labelBox(b);
          return p.x < q.x + q.w && q.x < p.x + p.w && p.y < q.y + q.h && q.y < p.y + p.h;
        }),
      );
    // the real maps at a 300 x 170 plot: no two labels overlap, and 100 % is always labelled
    for (const which of ['fan', 'hpc'] as const) {
      // the lines the chart draws: from the map's own lowest line up (W2A-I2)
      const g = mapGeometry(
        frame(which),
        chartSpeedPercents(frame(which), which === 'fan' ? FAN_LINES : HPC_LINES),
      );
      const x0 = scaleOf(g.bounds.wc, 258, 0.04);
      const y0 = scaleOf(g.bounds.pr, 136, 0.04);
      const anchors = g.speedLines.map((l) => ({
        percent: Math.round(l.percent),
        x: 34 + x0(l.points[0]?.[0] ?? 0),
        y: 146 - y0(l.points[0]?.[1] ?? 0),
      }));
      const placed = placeSpeedLabels(anchors);
      expect(overlapping(placed), which).toBe(false);
      expect(
        placed.map((l) => l.percent),
        which,
      ).toContain(100);
    }
  });

  it('scales and ticks', () => {
    expect(scaleOf([0, 10], 100)(5)).toBe(50);
    expect(scaleOf([0, 10], 100, 0.5)(0)).toBe(25);
    expect(scaleOf([3, 3], 10)(3)).toBe(0);
    expect(niceTicks(0, 1, 5)).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1]);
    expect(niceTicks(1, 37, 4)).toEqual([10, 20, 30]);
    expect(niceTicks(2, 1)).toEqual([]);
  });
});

describe('T-s diagram', () => {
  it('follows the cycle: compression raises T, the burner raises s, the turbines lower T', () => {
    const s = createCycleModel().reset('groundIdle');
    const d = tsDiagram(s.stations);
    const at = (id: string) => d.core.find((p) => p.id === id);
    expect(d.core.map((p) => p.id)).toEqual([
      '2',
      '21',
      '24',
      '25',
      '3',
      '4',
      '41',
      '45',
      '49.5',
      '5',
      '8',
      '9',
    ]);
    expect(at('3')?.ttK).toBeGreaterThan(at('2')?.ttK ?? Infinity);
    expect(at('4')?.sJPerKgK).toBeGreaterThan((at('3')?.sJPerKgK ?? 0) + 500);
    expect(at('5')?.ttK).toBeLessThan(at('4')?.ttK ?? 0);
    // the inlet is near the free stream: little entropy
    expect(Math.abs(at('2')?.sJPerKgK ?? 1e9)).toBeLessThan(5);
    expect(d.bypass.map((p) => p.id)).toEqual(['2', '13', '18', '19']);
  });

  it('draws the Pt0 isobar through the free-stream state', () => {
    const s = createCycleModel().reset('groundIdle');
    const d = tsDiagram(s.stations);
    const iso = d.isobars[0]?.points ?? [];
    expect(iso.length).toBeGreaterThan(8);
    // at s = 0 the free-stream isobar is at Tt0 (interpolated between its samples)
    const k = iso.findIndex((p) => p.sJPerKgK > 0);
    const a = iso[k - 1];
    const b = iso[k];
    if (a === undefined || b === undefined) throw new Error('isobar does not cross s = 0');
    const t = a.ttK + ((b.ttK - a.ttK) * (0 - a.sJPerKgK)) / (b.sJPerKgK - a.sJPerKgK);
    expect(t).toBeCloseTo(s.stations['0'].ttK, 0);
  });
});

describe('callout layout', () => {
  const size = () => ({ w: 80, h: 20 });
  const vp = { w: 800, h: 600 };

  it('places labels without overlaps, highest priority first, hidden anchors skipped', () => {
    const anchors = [
      { id: 'a', x: 400, y: 300, visible: true, priority: 1 },
      { id: 'b', x: 405, y: 302, visible: true, priority: 2 },
      { id: 'c', x: 410, y: 298, visible: true, priority: 0 },
      { id: 'd', x: 100, y: 100, visible: false, priority: 5 },
    ];
    const placed = layoutCallouts(anchors, size, vp);
    expect(placed.map((p) => p.id)).not.toContain('d');
    expect(placed[0]?.id).toBe('b');
    for (const p of placed)
      for (const q of placed) if (p !== q) expect(overlaps(p.box, q.box)).toBe(false);
  });

  it('keeps labels on screen and off reserved panels, or hides them', () => {
    const reserved = [{ x: 0, y: 0, w: 800, h: 290 }];
    const placed = layoutCallouts(
      [{ id: 'edge', x: 795, y: 595, visible: true, priority: 0 }],
      size,
      vp,
      reserved,
    );
    for (const p of placed) {
      expect(p.box.x + p.box.w).toBeLessThanOrEqual(800);
      expect(p.box.y + p.box.h).toBeLessThanOrEqual(600);
      expect(overlaps(p.box, reserved[0] ?? p.box)).toBe(false);
    }
    const none = layoutCallouts(
      [{ id: 'x', x: 400, y: 300, visible: true, priority: 0 }],
      size,
      vp,
      [{ x: 0, y: 0, w: 800, h: 600 }],
    );
    expect(none).toEqual([]);
  });

  it('W2A-I3: counts a leader crossing another leader or running through another label', () => {
    const box = (x: number, y: number) => ({ x, y, w: 40, h: 10 });
    // two leaders that cross: (0,0)->(100,100)'s box corner and (100,0)->(0,100)'s
    const crossing = [
      { id: 'a', anchor: { x: 0, y: 0 }, box: box(100, 100) },
      { id: 'b', anchor: { x: 100, y: 0 }, box: box(-40, 100) },
    ];
    expect(leaderCrossings(crossing)).toBe(1);
    // a leader through another label's box
    const through = [
      { id: 'a', anchor: { x: 0, y: 50 }, box: box(200, 45) },
      { id: 'b', anchor: { x: 120, y: 0 }, box: box(80, 45) },
    ];
    expect(leaderCrossings(through)).toBe(1);
    const apart = [
      { id: 'a', anchor: { x: 0, y: 0 }, box: box(10, -20) },
      { id: 'b', anchor: { x: 300, y: 0 }, box: box(310, -20) },
    ];
    expect(leaderCrossings(apart)).toBe(0);
  });

  it('W2A-I3: places every label with no leader crossing where a crossing-free place exists', () => {
    // the components' anchors along the engine's axis, a few tens of px apart (as projected):
    // the first free offset of each made 1-3 crossings in these rows before W2A-I3
    const big = () => ({ w: 140, h: 36 });
    for (const dy of [-25, -20, -10, 0]) {
      const anchors = [9, 4, 7, 8, 6, 5].map((priority, k) => ({
        id: `c${String(k)}`,
        x: 300 + 20 * k,
        y: 350 + dy * k + (k % 2) * 8,
        visible: true,
        priority,
      }));
      const placed = layoutCallouts(anchors, big, { w: 1000, h: 700 });
      expect(placed, `dy ${String(dy)}`).toHaveLength(6);
      expect(leaderCrossings(placed), `dy ${String(dy)}`).toBe(0);
      for (const p of placed)
        for (const q of placed) if (p !== q) expect(overlaps(p.box, q.box)).toBe(false);
    }
  });

  it('is deterministic and ends leaders on the box edge', () => {
    const anchors = [
      { id: 'a', x: 300, y: 300, visible: true, priority: 0 },
      { id: 'b', x: 300, y: 300, visible: true, priority: 0 },
    ];
    expect(layoutCallouts(anchors, size, vp)).toEqual(
      layoutCallouts([...anchors].reverse(), size, vp),
    );
    expect(leaderEnd({ x: 0, y: 0 }, { x: 10, y: 10, w: 5, h: 5 })).toEqual({ x: 10, y: 10 });
  });
});

describe('fidelity ledger', () => {
  const md = readFileSync('docs/PHYSICS.md', 'utf8');

  it('reads every row of PHYSICS.md section 1 with its status', () => {
    const rows = parseFidelityLedger(md);
    expect(rows.length).toBeGreaterThan(10);
    expect(rows[0]?.thing).toMatch(/N1, N2, EGT/);
    expect(rows[0]?.kind).toBe('simulated');
    expect(rows.some((r) => r.kind === 'synthesized')).toBe(true);
    expect(rows.some((r) => r.caveat)).toBe(true);
    expect(rows.every((r) => !r.status.includes('**'))).toBe(true);
  });

  it('strips markdown and refuses a document without the ledger', () => {
    expect(stripMarkdown('**Simulated** (`src/cycle`) [x](y)')).toBe('Simulated (src/cycle) x');
    expect(ledgerKind('Representative')).toBe('representative');
    expect(ledgerKind('Derived, with')).toBe('derived');
    expect(ledgerKind('Mixed')).toBe('other');
    expect(() => parseFidelityLedger('# Other\n')).toThrow(/heading/);
    expect(() => parseFidelityLedger('## 1. Fidelity ledger\n\ntext\n')).toThrow(/no rows/);
  });
});

describe('format', () => {
  it('converts at the boundary with the cockpit conventions', () => {
    expect(f.egt(1073.15)).toEqual({ value: '800', unit: '°C' });
    expect(f.fuelFlow(0.5, 'si')).toEqual({ value: '1800', unit: 'kg/h' });
    expect(f.fuelFlow(0.5, 'imperial').value).toBe('3968');
    expect(f.thrust(121_400, 'si')).toEqual({ value: '121.4', unit: 'kN' });
    expect(f.thrust(121_400, 'imperial').value).toBe('27292');
    expect(f.pressure(101_325, 'si').value).toBe('101.3');
    expect(f.pressure(101_325, 'imperial').value).toBe('14.7');
    expect(f.temperature(288.15, 'imperial').value).toBe('519');
    expect(f.massFlow(1.5, 'imperial').unit).toBe('lb/s');
    expect(f.tsfc(null, 'si').value).toBe(f.MISSING);
    expect(f.tsfc(1e-5, 'si').value).toBe('10.00');
    expect(f.tsfc(1e-5, 'imperial').value).toBe('0.353');
  });

  it('shows missing values as a dash and never -0', () => {
    expect(f.fixed(Number.NaN, 1)).toBe(f.MISSING);
    expect(f.fixed(null, 1)).toBe(f.MISSING);
    expect(f.fixed(-0.01, 1)).toBe('0.0');
    expect(f.ms(1.234)).toBe('1.23');
    expect(f.ms(12.34)).toBe('12.3');
    expect(f.simTime(65.25)).toBe('1:05.3');
    expect(f.simTime(-1)).toBe(f.MISSING);
    expect(f.timeScale(1)).toBe('×1');
    expect(f.timeScale(1 / 200)).toBe('×1/200');
    expect(f.timeScale(0)).toBe(f.MISSING);
    expect(f.percent(50.04)).toEqual({ value: '50.0', unit: '%' });
  });
});

describe('annunciators', () => {
  it('D4-17: a held solve is a warning with its count and W2F-I1 cause', () => {
    const a = gasPathAnnunciation(
      { gasPathSolve: { status: 'held', lostSolves: 3 } },
      'Newton stalled',
    );
    expect(a.level).toBe('warning');
    expect(a.detail).toMatch(/3 lost/);
    expect(a.detail).toMatch(/Newton stalled/);
    expect(
      gasPathAnnunciation({ gasPathSolve: { status: 'matched', lostSolves: 0 } }, null).level,
    ).toBe('normal');
    expect(
      gasPathAnnunciation({ gasPathSolve: { status: 'matched', lostSolves: 2 } }, 'x').level,
    ).toBe('caution');
    expect(
      gasPathAnnunciation({ gasPathSolve: { status: 'subIdle', lostSolves: 0 } }, null).level,
    ).toBe('advisory');
  });

  it('names the set flags, the solver status and every mock part', () => {
    const flags = {
      surge: true,
      flameout: false,
      hungStart: false,
      hotStart: false,
      noLightOff: false,
      n1Overspeed: false,
      n2Overspeed: false,
      egtExceedance: true,
    };
    expect(flagAnnunciations({ flags }).map((a) => a.text)).toEqual(['SURGE', 'EGT EXCEEDANCE']);
    const base = { mode: 'tracking' as const, stats: null, reduction: null };
    expect(flowAnnunciation({ ...base, status: 'lost', error: 'device lost' }).level).toBe(
      'warning',
    );
    expect(flowAnnunciation({ ...base, status: 'diverged', error: 'nan' }).text).toBe(
      'SOLVER DIVERGED',
    );
    expect(flowAnnunciation({ ...base, status: 'running', error: null }).level).toBe('normal');
    expect(flowAnnunciation({ ...base, status: 'initialising', error: null }).text).toBe(
      'SOLVER INIT',
    );
    expect(flowAnnunciation({ ...base, status: 'unavailable', error: null }).level).toBe(
      'advisory',
    );
    expect(provenanceBadges({ cycle: 'model', flow: 'mock' }).map((b) => b.text)).toEqual([
      'CYCLE: MODEL',
      'FIELD: MOCK',
    ]);
    expect(provenanceBadges({ cycle: 'mock', flow: 'solver' }).map((b) => b.level)).toEqual([
      'caution',
      'normal',
    ]);
    expect(provenanceBadges({ cycle: 'model', flow: 'none' })[1]?.text).toBe('FIELD: NONE');
  });

  it('D4-82: the field badge says the solver is uncoupled until W3, and a MOCK fallback says why', () => {
    const uncoupled = { asked: 'solver', coupling: 'uncoupled', fallback: null } as const;
    const solver = provenanceBadges({ cycle: 'model', flow: 'solver' }, uncoupled)[1];
    expect(solver?.text).toBe('FIELD: solver (uncoupled until W3)');
    expect(solver?.level).toBe('advisory');
    expect(solver?.detail).toMatch(/no blade or combustor forces/);
    const coupled = provenanceBadges(
      { cycle: 'model', flow: 'solver' },
      { asked: 'solver', coupling: 'coupled', fallback: null },
    )[1];
    expect(coupled?.text).toBe('FIELD: SOLVER (coupled)');
    expect(coupled?.level).toBe('normal');
    const fellBack = {
      asked: 'solver',
      coupling: 'mock',
      fallback: 'solver lost: GPU device lost',
    } as const;
    const fb = provenanceBadges({ cycle: 'model', flow: 'mock' }, fellBack)[1];
    expect(fb?.text).toBe('FIELD: MOCK fallback');
    expect(fb?.level).toBe('caution');
    expect(fb?.detail).toMatch(/^MOCK fallback .*solver lost: GPU device lost/);
    // the asked-for MOCK is the plain MOCK badge, and no link state reads as before
    expect(
      provenanceBadges(
        { cycle: 'model', flow: 'mock' },
        { asked: 'mock', coupling: 'mock', fallback: null },
      )[1]?.text,
    ).toBe('FIELD: MOCK');
    expect(provenanceBadges({ cycle: 'model', flow: 'solver' }, null)[1]?.text).toBe(
      'FIELD: SOLVER',
    );
    // the fallback is also annunciated (visible, never silent), with the reason in the text
    expect(fieldFallbackAnnunciation(uncoupled)).toBeNull();
    expect(fieldFallbackAnnunciation(null)).toBeNull();
    const a = fieldFallbackAnnunciation(fellBack);
    expect(a?.level).toBe('caution');
    expect(a?.text).toBe('MOCK FALLBACK: solver lost: GPU device lost');
    expect(a?.detail).toMatch(/^MOCK fallback/);
  });

  it('W2A-I1: the worker faults are annunciated: a stopped sim, GPU errors, the MOCK raster, refused commands', () => {
    const none = { simStopped: null, gpuErrors: 0, raster: null, refused: 0 };
    expect(faultAnnunciations(none)).toEqual([]);
    expect(faultAnnunciations({ ...none, raster: { onFrame: false, lastError: null } })).toEqual(
      [],
    );
    const all = faultAnnunciations({
      simStopped: 'cycle step failed: TypeError: boom',
      gpuErrors: 3,
      raster: { onFrame: true, lastError: 'MOCK raster worker failed: rasterizing on the frame' },
      refused: 2,
    });
    expect(all.map((f) => [f.id, f.level, f.text])).toEqual([
      ['simStopped', 'warning', 'SIM STOPPED'],
      ['gpuErrors', 'caution', 'GPU ERRORS (3)'],
      ['raster', 'caution', 'MOCK RASTER ON FRAME'],
      ['refused', 'advisory', 'REFUSED (2)'],
    ]);
    expect(all[0]?.detail).toMatch(/^cycle step failed: TypeError: boom/);
    expect(all[2]?.detail).toBe('MOCK raster worker failed: rasterizing on the frame');
    const failed = faultAnnunciations({
      ...none,
      raster: { onFrame: false, lastError: 'MOCK raster: NaN' },
    });
    expect(failed.map((f) => [f.text, f.detail])).toEqual([
      ['MOCK RASTER FAILED', 'MOCK raster: NaN'],
    ]);
  });
});
