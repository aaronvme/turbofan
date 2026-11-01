// D4-91 item 3: the app shell's display levels are pre-registered in docs/PHYSICS.md 3.5 (U1-U3)
// and mirrored in src/hud/uiLevels.ts; the map's annunciation and the browser bars import them.
// W2A-N19: the caution's boundary (exactly 5 % is normal, below it amber).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SM_CAUTION_FRACTION, surgeMarginView } from '../../../src/hud/compressorMap';
import { UI_LEVELS, UI_ROWS } from '../../../src/hud/uiLevels';
import { PREPARE_FRAME_CPU_MS } from '../../../src/shell/warmUp';

function physicsUiRows(): { id: string; check: string; pass: string }[] {
  const path = fileURLToPath(new URL('../../../docs/PHYSICS.md', import.meta.url));
  const rows: { id: string; check: string; pass: string }[] = [];
  let inUi = false;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    if (/^#{2,3} /.test(line)) inUi = line.startsWith('### 3.5 ');
    if (!inUi) continue;
    const cells = line.split('|').map((c) => c.trim());
    const [, id = '', check = '', pass = ''] = cells;
    if (cells.length === 5 && /^U\d+$/.test(id)) rows.push({ id, check, pass });
  }
  return rows;
}

describe('the UI levels mirror docs/PHYSICS.md 3.5 (D4-91)', () => {
  const rows = physicsUiRows();

  it('has U1-U5, verbatim (and any recorded rows after them)', () => {
    expect(rows.map((r) => r.id).slice(0, 5)).toEqual(['U1', 'U2', 'U3', 'U4', 'U5']);
    expect(rows.map((r) => r.id).sort()).toEqual(Object.keys(UI_ROWS).sort());
    for (const r of rows) {
      const m = UI_ROWS[r.id as keyof typeof UI_ROWS];
      expect(m.checkText).toBe(r.check);
      expect(m.passText).toBe(r.pass);
    }
  });

  it('takes each number from its own row', () => {
    expect(UI_LEVELS.surgeMarginCautionFraction).toBe(0.05);
    expect(rows[0]?.pass).toContain('below 5 %');
    expect(UI_LEVELS.surgeMarginWarningFraction).toBe(0);
    expect(rows[0]?.pass).toContain('at or below 0 %');
    expect(UI_LEVELS.firstSwitchMaxGapMs).toBe(250);
    expect(rows[1]?.pass).toContain('≤ 250 ms');
    expect(UI_LEVELS.bootToReadyMaxMs).toBe(5000);
    expect(rows[2]?.pass).toContain('≤ 5 s');
    // D4-97 item 1 (W2A-I7): an unwarmed switch is shown within 2 s at any steady frame CPU
    expect(UI_LEVELS.coldSwitchMaxMs).toBe(2000);
    expect(rows[3]?.pass).toContain('≤ 2 s');
    // D4-98 item 1: the mechanism, not the bar: 30 frames of preparing, then a slot every frame
    // D4-100: from the first frame of preparing (D4-98 waited 30 frames)
    expect(rows[3]?.check).toContain('From its first frame of preparing');
    expect(rows[3]?.check).toContain('a slot every frame');
    expect(rows[3]?.check).not.toContain('60 frames');
    // D4-100: each such slot several warm frames up to the scheduler's own cap (the mechanism)
    expect(rows[3]?.check).toContain(
      `several warm frames until their CPU reaches ${String(PREPARE_FRAME_CPU_MS)} ms (D4-100)`,
    );
    // D4-99 item 2: the condition is scoped to the frames the app is built for (the bar unchanged)
    expect(rows[3]?.check).toContain(
      'at any steady frame CPU up to 11.2 ms (tested; D4-99 item 2)',
    );
    // D4-97 item 2 (W2A-I8): the cut views' framing, its minimum engine scale and the row
    expect(UI_LEVELS.cutViewMinScale).toBe(0.6);
    expect(rows[4]?.check).toContain('0.6 of');
    expect(UI_LEVELS.calloutRowPx).toBe(52);
    expect(rows[4]?.check).toContain('52 px');
    expect(rows[4]?.check).toContain('fan, combustor, HPT, LPT, exhaust');
    // D4-97 item 4: Cutaway's own warm frames and the background warm-up, recorded, no bar
    expect(rows.slice(5).map((r) => r.id)).toEqual(['U6', 'U7']);
    for (const r of rows.slice(5))
      expect(r.pass).toMatch(/^recorded on every run, indicative, no bar/);
    expect(rows[5]?.pass).toContain('47 warm frames at ≤ 41 ms');
    expect(rows[6]?.pass).toContain('7.0 s after ready');
  });

  it('the map annunciates at U1: amber below 5 %, normal at exactly 5 % (W2A-N19), red at 0', () => {
    expect(SM_CAUTION_FRACTION).toBe(UI_LEVELS.surgeMarginCautionFraction);
    const g = { lowestPercent: 30 };
    const at = (m: number) =>
      surgeMarginView(g, { correctedSpeedFraction: 0.8, surgeMarginFraction: m }).level;
    expect(at(0.05)).toBe('normal');
    expect(at(0.0499)).toBe('caution');
    expect(at(0.0001)).toBe('caution');
    expect(at(0)).toBe('warning');
  });
});
