import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ENGINE_FACTS,
  FACT_CONFIDENCES,
  factValue,
  type EngineFactId,
} from '../../../src/engine/facts';
import {
  celsiusToKelvin,
  inToM,
  lbPerSToKgPerS,
  lbfToN,
  tsfcImperialToSi,
  LB_TO_KG,
} from '../../../src/engine/units';

interface DocRow {
  readonly id: string;
  readonly section: 'published' | 'unknown';
  readonly figure: string;
  readonly sourceValue: string;
  readonly si: string;
  readonly source: string;
  readonly confidence: string;
}

const DOC = readFileSync(
  fileURLToPath(new URL('../../../docs/ENGINE_FACTS.md', import.meta.url)),
  'utf8',
);

/**
 * The two fact tables of docs/ENGINE_FACTS.md: rows `| ID | Figure | Source value | SI |
 * Source | Confidence |` under "## Published figures" and "## Unknown figures ...".
 */
function readFactRows(): DocRow[] {
  const rows: DocRow[] = [];
  let section: DocRow['section'] | null = null;
  for (const line of DOC.split(/\r?\n/)) {
    if (line.startsWith('## ')) {
      section = line.startsWith('## Published figures')
        ? 'published'
        : line.startsWith('## Unknown figures')
          ? 'unknown'
          : null;
      continue;
    }
    if (section === null || !line.startsWith('|')) continue;
    const cells = line.split('|').map((c) => c.trim());
    if (cells.length !== 8) continue;
    const [, id = '', figure = '', sourceValue = '', si = '', source = '', confidence = ''] = cells;
    if (!/^[a-z][A-Za-z0-9]*$/.test(id)) continue;
    rows.push({ id, section, figure, sourceValue, si, source, confidence });
  }
  return rows;
}

/** Source keys defined in the "## Sources" list, e.g. `[TCDS]`. */
function readSourceKeys(): Set<string> {
  const keys = new Set<string>();
  for (const m of DOC.matchAll(/^- \[([A-Z0-9-]+)\] \S/gm)) if (m[1] !== undefined) keys.add(m[1]);
  return keys;
}

/** `121430 N` -> { value: 121430, unit: 'N' }; a bare number is dimensionless. */
function parseSi(text: string): { value: number; unit: string } {
  const m = /^(-?\d+(?:\.\d+)?(?:e-?\d+)?)(?: (.+))?$/.exec(text);
  if (m?.[1] === undefined) throw new Error(`SI cell "${text}" is not "<number> <unit>"`);
  return { value: Number(m[1]), unit: m[2] ?? '' };
}

/**
 * The SI value a source value converts to, or null when the source value is not a plain
 * "<number> <unit>" (text, ranges, "unknown"). A signed temperature ("+30 °C") is a
 * difference, so it converts without the 273.15 K offset.
 */
function convertSourceValue(text: string, siUnit: string): number | null {
  const m = /^([+-]?)(\d+(?:\.\d+)?)(?: (.+))?$/.exec(text);
  if (m?.[2] === undefined) return null;
  const signed = m[1] !== '';
  const v = Number(m[2]) * (m[1] === '-' ? -1 : 1);
  const unit = m[3] ?? '';
  switch (unit) {
    case '':
      return v;
    case 'daN':
      return v * 10;
    case 'kN':
      return v * 1000;
    case 'lbf':
      return lbfToN(v);
    case 'lb/s':
      return lbPerSToKgPerS(v);
    case 'in':
      return inToM(v);
    case 'mm':
      return v / 1000;
    case 'lb':
      return v * LB_TO_KG;
    case '°C':
      return signed ? v : celsiusToKelvin(v);
    case '°F':
      return celsiusToKelvin(((v - 32) * 5) / 9);
    case 'hPa':
      return v * 100;
    case '%':
      return siUnit === '%' ? v : v / 100;
    case '(lb/h)/lbf':
      return tsfcImperialToSi(v);
    case 'g/kg':
      return v / 1000;
    case 'kg/s':
    case 'kg':
    case 'rpm':
    case 's':
      return v;
    default:
      throw new Error(`no conversion for source unit "${unit}" in "${text}"`);
  }
}

/** Relative tolerance for source -> SI: SI cells keep about 5 significant digits. */
const CONVERSION_TOLERANCE = 5e-4;

const rows = readFactRows();
const ids = Object.keys(ENGINE_FACTS) as EngineFactId[];

describe('docs/ENGINE_FACTS.md and src/engine/facts.ts', () => {
  it('finds both fact tables in the doc', () => {
    expect(rows.filter((r) => r.section === 'published').length).toBeGreaterThan(50);
    expect(rows.filter((r) => r.section === 'unknown').length).toBeGreaterThan(20);
  });

  it('has the same IDs in the doc and in facts.ts, each exactly once', () => {
    const docIds = rows.map((r) => r.id);
    expect(new Set(docIds).size).toBe(docIds.length);
    expect([...docIds].sort()).toEqual([...ids].sort());
  });

  it.each(rows)('$id: SI value, unit and confidence match facts.ts', (row) => {
    const fact = ENGINE_FACTS[row.id as EngineFactId];
    const si = parseSi(row.si);
    expect(fact.si).toBe(si.value);
    expect(fact.unit).toBe(si.unit);
    expect(fact.confidence).toBe(row.confidence);
    expect(factValue(row.id as EngineFactId)).toBe(si.value);
  });

  it.each(rows)('$id: the SI value follows from the source value', (row) => {
    const si = parseSi(row.si);
    const converted = convertSourceValue(row.sourceValue, si.unit);
    if (converted === null) return; // text source values (ranges, quotes, "unknown")
    if (si.value === 0) expect(converted).toBe(0);
    else expect(Math.abs(converted / si.value - 1)).toBeLessThan(CONVERSION_TOLERANCE);
  });

  it.each(rows)('$id: the source and confidence follow the doc rules', (row) => {
    expect(FACT_CONFIDENCES).toContain(row.confidence);
    expect(row.figure.length).toBeGreaterThan(3);
    if (row.section === 'unknown') {
      expect(row.confidence).toBe('unknown');
      expect(row.sourceValue).toBe('unknown');
      expect(row.source.length).toBeGreaterThan(3); // the reason for the assumption
      return;
    }
    expect(row.confidence).not.toBe('unknown');
    if (row.confidence === 'estimate') {
      expect(row.source).toMatch(/derived/); // an estimate shows its derivation
      return;
    }
    const cited = [...row.source.matchAll(/\[([A-Z0-9-]+)\]/g)].map((m) => m[1]);
    expect(cited.length, `${row.id} must cite a [SOURCE]`).toBeGreaterThan(0);
    const defined = readSourceKeys();
    for (const key of cited)
      expect(defined, `[${String(key)}] is not in ## Sources`).toContain(key);
  });
});

describe('derived and cross-checked figures', () => {
  const v = factValue;

  it('derives the C3 TSFC target from the EEDB fuel flow and the TCDS thrust (D0-5)', () => {
    expect(v('tsfcTakeoff')).toBeCloseTo(v('fuelFlowTakeoff') / v('takeoffThrust'), 9);
    // Aviation Week's figure is recorded beside it, 2.7 % higher
    expect(v('tsfcTakeoffAvWeek') / v('tsfcTakeoff') - 1).toBeCloseTo(0.027, 3);
  });

  it('derives the 100 % speeds from the TCDS maximum speeds and percentages', () => {
    expect(v('n1ReferenceRpm')).toBeCloseTo(v('n1MaxRpm') / 1.04, 6);
    expect(v('n2ReferenceRpm')).toBeCloseTo(v('n2MaxRpm') / 1.05, 6);
    // the TCDS icing limits (10022 rpm = 69.3 %, 8500 rpm = 58.8 %) agree within 0.1 %
    expect(Math.abs(10022 / 0.693 / v('n2ReferenceRpm') - 1)).toBeLessThan(1e-3);
    expect(Math.abs(8500 / 0.588 / v('n2ReferenceRpm') - 1)).toBeLessThan(1e-3);
  });

  it('keeps the cross-check sources within their recorded deltas', () => {
    expect(Math.abs(v('takeoffThrustFiche') / v('takeoffThrust') - 1)).toBeLessThan(1e-4);
    expect(v('totalAirflowCfmWeb') / v('totalAirflow') - 1).toBeCloseTo(-0.0126, 3);
    expect(v('engineLengthFiche') / v('engineLength') - 1).toBeCloseTo(0.048, 3);
  });

  it('orders the EGT limits and the idle ranges the way the validators expect', () => {
    expect(v('egtStartLimit')).toBeLessThan(v('egtMaxContinuousLimit'));
    expect(v('egtMaxContinuousLimit')).toBeLessThan(v('egtTakeoffLimit'));
    expect(v('egtTakeoffLimit')).toBeLessThan(v('egtTransientLimit'));
    for (const id of ['idleN1Low', 'idleN1High'] as const) {
      expect(v(id)).toBeGreaterThanOrEqual(v('idleN1Min'));
      expect(v(id)).toBeLessThanOrEqual(v('idleN1Max'));
    }
    for (const id of ['idleN2Low', 'idleN2High'] as const) {
      expect(v(id)).toBeGreaterThanOrEqual(v('idleN2Min'));
      expect(v(id)).toBeLessThanOrEqual(v('idleN2Max'));
    }
    expect(v('idleEgtHigh')).toBeLessThan(v('idleEgtMax'));
    expect(v('minFuelOnN2')).toBeLessThanOrEqual(v('startFuelOnN2'));
    expect(v('startFuelOnN2')).toBeLessThan(v('starterCutoutN2'));
  });

  it('records the rotation sense as -1 about +x and the nacelle enclosing the TCDS width', () => {
    expect(v('rotationSense')).toBe(-1);
    expect(v('nacelleMaxDiameter')).toBeGreaterThanOrEqual(v('engineWidth'));
    expect(v('fanHubRadius') / (v('fanDiameter') / 2)).toBeCloseTo(0.296, 3);
  });
});
