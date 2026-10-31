// D4-91 item 3: the app shell's display levels are pre-registered in docs/PHYSICS.md 3.5 (U1-U3)
// and mirrored in src/hud/uiLevels.ts; the map's annunciation and the browser bars import them.
// W2A-N19: the caution's boundary (exactly 5 % is normal, below it amber).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SM_CAUTION_FRACTION, surgeMarginView } from '../../../src/hud/compressorMap';
import { UI_LEVELS, UI_ROWS } from '../../../src/hud/uiLevels';

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

  it('has U1-U4, verbatim', () => {
    expect(rows.map((r) => r.id).slice(0, 4)).toEqual(['U1', 'U2', 'U3', 'U4']);
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
    expect(rows[3]?.check).toContain('60 frames');
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
