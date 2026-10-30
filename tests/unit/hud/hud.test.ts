// The overlay's pure view-model: map geometry on the model's own maps, the T-s path from the
// model's stations, callout layout, the ledger parser, formatting and the annunciators.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { mapGeometry, niceTicks, pushTrail, scaleOf } from '../../../src/hud/compressorMap';
import { tsDiagram } from '../../../src/hud/tsDiagram';
import { layoutCallouts, leaderEnd, overlaps } from '../../../src/hud/callouts';
import { ledgerKind, parseFidelityLedger, stripMarkdown } from '../../../src/hud/ledger';
import * as f from '../../../src/hud/format';
import {
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

describe('compressor map geometry', () => {
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

  it('keeps a bounded trail without repeating a still point', () => {
    let t = pushTrail([], { correctedFlowKgPerS: 1, pressureRatio: 2 }, 3);
    t = pushTrail(t, { correctedFlowKgPerS: 1, pressureRatio: 2 }, 3);
    expect(t).toHaveLength(1);
    for (let k = 2; k < 6; k++) t = pushTrail(t, { correctedFlowKgPerS: k, pressureRatio: 2 }, 3);
    expect(t.map((p) => p[0])).toEqual([3, 4, 5]);
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
});
