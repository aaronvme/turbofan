import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  THRESHOLDS,
  THRESHOLD_IDS,
  isThresholdId,
  parseThresholdToken,
  thresholdNumbers,
} from '../../../src/contracts/thresholds';

interface PhysicsRow {
  readonly id: string;
  readonly section: string;
  readonly check: string;
  readonly pass: string;
}

/**
 * Reads the pre-registered threshold tables in docs/PHYSICS.md section 3. A table row is
 * `| ID | Check | Pass |`; the section is the enclosing `### 3.x` heading.
 */
function readPhysicsThresholds(): PhysicsRow[] {
  const path = fileURLToPath(new URL('../../../docs/PHYSICS.md', import.meta.url));
  const rows: PhysicsRow[] = [];
  let inSection3 = false;
  let section = '';
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const h2 = /^## (\d+)\./.exec(line);
    if (h2) {
      inSection3 = h2[1] === '3';
      continue;
    }
    const h3 = /^### (\d+\.\d+) /.exec(line);
    if (h3?.[1] !== undefined) {
      section = h3[1];
      continue;
    }
    if (!inSection3) continue;
    const cells = line.split('|').map((c) => c.trim());
    if (cells.length !== 5) continue;
    const [, id = '', check = '', pass = ''] = cells;
    // an ID is a letter, a number and an optional sub-row letter (P5b by D4-94)
    if (!/^[TCLP]\d+[a-z]?$/.test(id)) continue;
    rows.push({ id, section, check, pass });
  }
  return rows;
}

const physics = readPhysicsThresholds();

describe('thresholds.ts mirrors docs/PHYSICS.md section 3', () => {
  it('finds the full pre-registered set in PHYSICS.md', () => {
    // T1-T4, C1-C12 (C10 by D3-3, C11 by D3-11, C12 by D3-17), L1-L13, P1-P5 and P5b (P4 by D4-2,
    // P5 by D4-90, P5b by D4-94)
    expect(physics.length).toBe(4 + 12 + 13 + 6);
  });

  it('has exactly the same IDs, in the same order', () => {
    expect([...THRESHOLD_IDS]).toEqual(physics.map((r) => r.id));
    expect(Object.keys(THRESHOLDS)).toEqual(physics.map((r) => r.id));
  });

  it.each(physics)('$id: Pass, Check and section are verbatim', (row) => {
    expect(isThresholdId(row.id)).toBe(true);
    if (!isThresholdId(row.id)) return;
    const t = THRESHOLDS[row.id];
    expect(t.id).toBe(row.id);
    expect(t.passText).toBe(row.pass);
    expect(t.checkText).toBe(row.check);
    expect(t.section).toBe(row.section);
  });

  it.each(physics)('$id: every typed number comes from its own text', (row) => {
    if (!isThresholdId(row.id)) throw new Error(`unknown id ${row.id}`);
    for (const n of thresholdNumbers(row.id)) {
      const text = n.from === 'pass' ? row.pass : row.check;
      expect(text, `${row.id} token "${n.token}" must appear in its ${n.from} text`).toContain(
        n.token,
      );
      expect(parseThresholdToken(n.token)).toBeCloseTo(n.value, 12);
    }
  });

  it('types the numbers a test will import', () => {
    expect(THRESHOLDS.T1.values.maxRelativeError.value).toBe(0.005);
    expect(THRESHOLDS.T4.values.maxRelativeError.value).toBe(1e-6);
    expect(THRESHOLDS.C5.values.maxTimeS.value).toBe(5);
    expect(THRESHOLDS.C5.values.thrustFraction.value).toBe(0.95);
    expect(THRESHOLDS.C7.values.maxNewtonIterations.value).toBe(25);
    expect(THRESHOLDS.C10.values.maxEgtErrorK.value).toBe(30);
    expect(THRESHOLDS.C10.values.maxN2ErrorPoints.value).toBe(1.5);
    expect(THRESHOLDS.C11.values.maxRelativeError.value).toBe(0.05);
    expect(THRESHOLDS.C11.values.idleThrustPercent.value).toBe(7);
    expect(THRESHOLDS.C11.values.approachThrustPercent.value).toBe(30);
    expect(THRESHOLDS.C11.values.climbOutThrustPercent.value).toBe(85);
    expect(THRESHOLDS.C12.values.surgePressureRatioLoss.value).toBe(0.06);
    expect(THRESHOLDS.C12.values.maxDetectionDelayS.value).toBe(0.1);
    expect(THRESHOLDS.C12.values.maxSurges.value).toBe(2);
    expect(THRESHOLDS.C12.values.maxTimeToThrustS.value).toBe(10);
    expect(THRESHOLDS.L1.values.iterations.value).toBe(20_000);
    expect(THRESHOLDS.L12.values.t4ErrorK.value).toBe(10);
    expect(THRESHOLDS.P1.values.minIterationsPerS.value).toBe(150);
    expect(THRESHOLDS.P3.values.maxValidationErrors.value).toBe(0);
    expect(THRESHOLDS.P4.values.maxRenderGpuMs.value).toBe(8);
    expect(THRESHOLDS.P4.values.resolutionLines.value).toBe(1080);
    expect(THRESHOLDS.P4.values.reportedTargetMs.value).toBe(10);
    expect(THRESHOLDS.P5.values.maxHeldStepEvaluations.value).toBe(137);
    expect(THRESHOLDS.P5.values.maxStepEvaluations.value).toBe(217);
    expect(THRESHOLDS.P5.values.heldFrameMs.value).toBe(16.7);
    expect(THRESHOLDS.P5.values.stepRateHz.value).toBe(60);
    expect(THRESHOLDS.P5b.values.maxHeldEpisodeS.value).toBe(0.5);
    expect(THRESHOLDS.P5b.values.maxStepRateHz.value).toBe(120);
    expect(THRESHOLDS.P5b.values.minStepRateHz.value).toBe(30);
    expect(THRESHOLDS.P5b.values.takeoffAtS.value).toBe(3);
    expect(THRESHOLDS.P5b.values.surgeAtS.value).toBe(10);
    expect(THRESHOLDS.P5b.values.flameoutAtS.value).toBe(20);
    expect(THRESHOLDS.P5b.values.scenarioS.value).toBe(35);
    expect(THRESHOLDS.P5b.values.escalateAfterS.value).toBe(0.25);
  });

  it('marks the thresholds whose numbers live in ENGINE_FACTS.md instead', () => {
    expect(thresholdNumbers('C4')).toEqual([]);
    expect(thresholdNumbers('C6')).toEqual([]);
    expect(THRESHOLDS.C4.targetsFrom).toBe('ENGINE_FACTS');
    expect(THRESHOLDS.C6.targetsFrom).toBe('ENGINE_FACTS');
    expect(THRESHOLDS.C10.targetsFrom).toBe('ENGINE_FACTS');
    expect(THRESHOLDS.C11.targetsFrom).toBe('ENGINE_FACTS');
    expect(THRESHOLDS.T1.targetsFrom).toBe('PHYSICS');
  });
});

describe('parseThresholdToken', () => {
  it.each([
    ['0.5%', 0.005],
    ['1e-6', 1e-6],
    ['1e-4', 1e-4],
    ['20k', 20_000],
    ['~130k', 130_000],
    ['≈80k', 80_000],
    ['±15%', 0.15],
    ['≥ 150', 150],
    ['≤ 5.0', 5],
    ['3×', 3],
    ['6–7 D', 6],
    ['7 D', 7],
    ['10-minute', 10],
    ['p95', 95],
    ['zero', 0],
  ])('%s -> %f', (token, value) => {
    expect(parseThresholdToken(token)).toBeCloseTo(value, 12);
  });

  it('rejects a token without a number', () => {
    expect(() => parseThresholdToken('qualitative')).toThrow(/no number/);
  });
});
