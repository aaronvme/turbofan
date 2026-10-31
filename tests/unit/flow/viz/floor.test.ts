// W2V-I7 (D4-86): at ground idle almost the whole Data plane was the colour map's ambient end
// (Mach ~ 0 outside the nacelle: a heavy purple board). The ambient air must read as quiet, not
// as a colour field: the plane does not draw air within a small fraction of the scale of the
// ambient state, and the legend says so.
//
// The bar, stated before the fix: at ground idle, on the MOCK field and on the uncoupled solver's
// field (no blade or combustor forces, so at ground idle its air is the ambient at rest), at most
// 10 % of the crop's fluid area is drawn in the ambient's own colour band (within 5 % of the
// scale of the ambient's position on the map) for each quantity the Data plane draws (p, rho, T,
// Mach). Without a floor it is 44 % (Mach), 84 % (T), 87 % (rho) and 98 % (p) on the MOCK, and
// 100 % on the air at rest. A band 2 % of the plane is an accent (the fringe of the drawn flow);
// a band over a third of it is the board the critic saw.
import { describe, expect, it } from 'vitest';
import { ISA_SLS } from '../../../../src/contracts/ambient';
import {
  decodeTexel,
  fieldReferenceFromAmbient,
  texelCenter,
  type CpuFlowField,
  type FieldSample,
} from '../../../../src/contracts/flow';
import { fromHalfBits } from '../../../../src/contracts/half';
import { ENGINE_DEFINITION } from '../../../../src/engine/definition';
import {
  AMBIENT_FLOOR_FRACTION,
  ambientFloor,
  ambientValue,
  drawnOnPlane,
  FIELD_QUANTITIES,
  FIELD_QUANTITY_IDS,
  normalizeQuantity,
  quantityValue,
  type FieldQuantityId,
} from '../../../../src/flow/viz/fields';
import { flowModeNote, legendFor } from '../../../../src/flow/viz/legend';
import { cropAlpha, nearFieldCrop } from '../../../../src/flow/viz/modes';
import { mockSteadyState } from '../../../../src/mocks/mockCycle';
import { createMockFlowField } from '../../../../src/mocks/mockFlowField';

const REF = fieldReferenceFromAmbient(ISA_SLS);
const DATA_QUANTITIES: readonly FieldQuantityId[] = ['p', 'rho', 't', 'mach'];
const CROP = nearFieldCrop(ENGINE_DEFINITION);

/** The crop's fluid texels of a field's near raster, decoded. */
function cropSamples(f: CpuFlowField): FieldSample[] {
  if (CROP === null) throw new Error('no crop');
  const e = f.near.extent;
  const out: FieldSample[] = [];
  const half = (a: Uint16Array, k: number) =>
    [0, 1, 2, 3].map((ch) => fromHalfBits(a[k + ch] ?? 0)) as [number, number, number, number];
  for (let j = 0; j < e.height; j++)
    for (let i = 0; i < e.width; i++) {
      const c = texelCenter(e, i, j);
      if (cropAlpha(CROP, c.x, c.r) < 1) continue;
      const k = 4 * (j * e.width + i);
      const v = half(f.near.velocity, k);
      if (v[3] < 0.5) continue;
      out.push(decodeTexel(half(f.near.state, k), v, f.reference));
    }
  return out;
}

/** The ambient at rest: the uncoupled solver's air at ground idle (nothing drives it). */
const AT_REST: FieldSample = {
  pPa: REF.pInfPa,
  rhoKgPerM3: REF.rhoInfKgPerM3,
  tK: REF.tInfK,
  fuelAirRatio: 0,
  uxMPerS: 0,
  urMPerS: 0,
  uthetaMPerS: 0,
  fluidFraction: 1,
};

/** The fraction of samples the plane draws in the ambient's colour band (5 % of the scale). */
function bandCoverage(id: FieldQuantityId, samples: readonly FieldSample[], floor: boolean) {
  const tAmb = normalizeQuantity(id, ambientValue(id, REF));
  let n = 0;
  for (const s of samples) {
    const v = quantityValue(id, s, REF);
    const drawn = !floor || drawnOnPlane(id, v, REF);
    if (drawn && Math.abs(normalizeQuantity(id, v) - tAmb) <= 0.05) n++;
  }
  return n / samples.length;
}

describe('W2V-I7 (D4-86): the ambient floor', () => {
  it('is 2.5 % of each quantity’s scale about its ambient value', () => {
    expect(AMBIENT_FLOOR_FRACTION).toBe(0.025);
    for (const id of FIELD_QUANTITY_IDS) {
      const s = FIELD_QUANTITIES[id];
      expect(ambientFloor(id)).toBeCloseTo(0.025 * (s.max - s.min), 12);
    }
    expect(ambientValue('p', REF)).toBe(0);
    expect(ambientValue('rho', REF)).toBe(0);
    expect(ambientValue('t', REF)).toBe(REF.tInfK);
    expect(ambientValue('mach', REF)).toBe(0);
    expect(ambientValue('speed', REF)).toBe(0);
  });

  it('hides only the band about the ambient: everything at or beyond the floor is drawn', () => {
    for (const id of FIELD_QUANTITY_IDS) {
      const a = ambientValue(id, REF);
      const f = ambientFloor(id);
      expect(drawnOnPlane(id, a, REF)).toBe(false);
      expect(drawnOnPlane(id, a + 0.99 * f, REF)).toBe(false);
      expect(drawnOnPlane(id, a - 0.99 * f, REF)).toBe(false);
      expect(drawnOnPlane(id, a + f, REF)).toBe(true);
      expect(drawnOnPlane(id, a - 1.01 * f, REF)).toBe(true);
      expect(drawnOnPlane(id, a + 10 * f, REF)).toBe(true);
    }
    // a non-finite value is never drawn (the shader discards it, W2V-I6)
    expect(drawnOnPlane('mach', Number.NaN, REF)).toBe(false);
  });

  it('the bar: at ground idle, the MOCK and the air at rest draw at most 10 % in the ambient band', () => {
    const idle = cropSamples(
      createMockFlowField(ENGINE_DEFINITION, mockSteadyState(ENGINE_DEFINITION, 0), ISA_SLS),
    );
    expect(idle.length).toBeGreaterThan(50_000);
    for (const id of DATA_QUANTITIES) {
      // the negative control: without the floor the ambient band is the board
      expect(bandCoverage(id, idle, false)).toBeGreaterThan(0.3);
      expect(bandCoverage(id, idle, true)).toBeLessThanOrEqual(0.1);
      expect(bandCoverage(id, [AT_REST], false)).toBe(1);
      expect(bandCoverage(id, [AT_REST], true)).toBe(0);
    }
  });

  it('keeps the take-off flow: the jets, ducts and core are drawn', () => {
    const to = cropSamples(
      createMockFlowField(ENGINE_DEFINITION, mockSteadyState(ENGINE_DEFINITION, 1), ISA_SLS),
    );
    for (const id of DATA_QUANTITIES) {
      // every sample beyond twice the floor is drawn (not a vacuous check: at take-off they are
      // 3.6 % of the plane for p, whose jets are fully expanded to p∞, and 71 % for Mach)
      let far = 0;
      for (const s of to) {
        const v = quantityValue(id, s, REF);
        if (Math.abs(v - ambientValue(id, REF)) >= 2 * ambientFloor(id)) {
          far++;
          expect(drawnOnPlane(id, v, REF)).toBe(true);
        }
      }
      expect(far / to.length).toBeGreaterThan(0.02);
    }
  });
});

describe('W2V-I7: the legend says what the floor hides', () => {
  it('marks the floored band on the bar and states it in words, for every quantity', () => {
    for (const id of FIELD_QUANTITY_IDS) {
      const l = legendFor('data', 'mock', id);
      if (l === null) throw new Error('no legend');
      const f = l.floor;
      if (f === null) throw new Error(`no floor on ${id}`);
      const s = FIELD_QUANTITIES[id];
      const a = ambientValue(id, REF);
      const lo = Math.max(s.min, a - ambientFloor(id));
      const hi = Math.min(s.max, a + ambientFloor(id));
      expect(f.from).toBeCloseTo((lo - s.min) / (s.max - s.min), 9);
      expect(f.to).toBeCloseTo((hi - s.min) / (s.max - s.min), 9);
      expect(f.label).toMatch(/^Not drawn: /);
      expect(f.label).toContain('2.5 %');
    }
    expect(legendFor('data', 'mock', 'mach')?.floor?.label).toBe(
      'Not drawn: 0 to 0.04 M (the ambient ± 2.5 % of the scale)',
    );
    expect(legendFor('data', 'mock', 'speed')?.floor?.label).toBe(
      'Not drawn: 0 to 17.5 m/s (the ambient ± 2.5 % of the scale)',
    );
    expect(legendFor('data', 'mock', 'p')?.floor?.label).toBe(
      'Not drawn: 0.841 to 1.19 p / p∞ (the ambient ± 2.5 % of the scale)',
    );
    expect(legendFor('data', 'mock', 't')?.floor?.label).toBe(
      'Not drawn: 243 to 333 K (the ambient ± 2.5 % of the scale)',
    );
    // the schlieren is an image of the whole field: no floor
    expect(legendFor('schlieren', 'mock')?.floor).toBeNull();
  });

  it('the panel note says the ambient air is not drawn', () => {
    expect(flowModeNote('data', 1 / 200)).toContain(
      'air within 2.5 % of the scale of the ambient is not drawn',
    );
    expect(flowModeNote('realistic', 1 / 200)).not.toContain('not drawn');
  });
});
