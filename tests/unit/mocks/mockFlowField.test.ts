import { beforeAll, describe, expect, it } from 'vitest';
import {
  createMockFlowField,
  createMockFlowModel,
  type MockCpuFlowField,
  type MockFlowModel,
} from '../../../src/mocks/mockFlowField';
import { createMockCycle, mockSteadyState } from '../../../src/mocks/mockCycle';
import { ENGINE_DEFINITION } from '../../../src/engine/definition';
import { ISA_SLS } from '../../../src/contracts/ambient';
import { STOICHIOMETRIC_FAR } from '../../../src/contracts/cycle';
import { radiusAt } from '../../../src/contracts/engine';
import {
  FIELD_EXTENTS,
  fieldReferenceFromAmbient,
  sampleCpuField,
  texelCenter,
  texelIndexAt,
  type CpuFieldTextures,
  type FieldExtentId,
} from '../../../src/contracts/flow';
import { fromHalfBits, toHalfBits } from '../../../src/contracts/half';

const def = ENGINE_DEFINITION;
const REF = fieldReferenceFromAmbient(ISA_SLS);
const curves = def.flowpath.curves;
const r = (id: keyof typeof curves, x: number): number => {
  const v = radiusAt(curves[id], x);
  if (v === null) throw new Error(`${id} does not cover x=${x}`);
  return v;
};

/**
 * A full-resolution raster is about 330k texels; under coverage instrumentation it takes
 * several seconds, so the tests that build one get this timeout (ms).
 */
const FULL_RASTER_TIMEOUT = 60_000;

let takeoff: MockCpuFlowField;
let model: MockFlowModel;

beforeAll(() => {
  const state = mockSteadyState(def, 1);
  takeoff = createMockFlowField(def, state, ISA_SLS, { version: 7 });
  model = createMockFlowModel(def, state, ISA_SLS);
}, FULL_RASTER_TIMEOUT);

/** Byte-for-byte equality of two texel arrays (a deep toEqual on 1M elements is slow). */
const sameBits = (a: Uint16Array, b: Uint16Array) =>
  a.length === b.length && Buffer.from(a.buffer).equals(Buffer.from(b.buffer));

/** Decoded texel nearest to (x, r) in an extent. */
function texel(field: CpuFieldTextures, x: number, rr: number) {
  const idx = texelIndexAt(field.extent, x, rr);
  if (idx === null) throw new Error('outside the extent');
  const k = 4 * (idx.j * field.extent.width + idx.i);
  const s = [0, 1, 2, 3].map((c) => fromHalfBits(field.state[k + c] ?? 0));
  const u = [0, 1, 2, 3].map((c) => fromHalfBits(field.velocity[k + c] ?? 0));
  return { k, s, u };
}

describe('mock flow field: layout and encoding (D0-4)', () => {
  it('is labelled MOCK and fills the exact FlowField layout', () => {
    expect(takeoff.label).toBe('MOCK');
    // W0C-I3: the provenance travels with the data, so the GPU FlowField built from it keeps it
    expect(takeoff.source).toBe('mock');
    expect(takeoff.version).toBe(7);
    expect(takeoff.reference).toEqual(REF);
    expect(takeoff.extents).toEqual(FIELD_EXTENTS);
    for (const id of ['near', 'far'] as FieldExtentId[]) {
      const tex = takeoff[id];
      const e = FIELD_EXTENTS[id];
      expect(tex.extent).toEqual(e);
      expect(tex.state).toBeInstanceOf(Uint16Array);
      expect(tex.velocity).toBeInstanceOf(Uint16Array);
      expect(tex.state.length).toBe(4 * e.width * e.height);
      expect(tex.velocity.length).toBe(4 * e.width * e.height);
    }
  });

  it(
    'is deterministic: the same state gives the same bits',
    () => {
      const again = createMockFlowField(def, mockSteadyState(def, 1), ISA_SLS, { version: 7 });
      expect(sameBits(again.near.state, takeoff.near.state)).toBe(true);
      expect(sameBits(again.near.velocity, takeoff.near.velocity)).toBe(true);
      expect(sameBits(again.far.state, takeoff.far.state)).toBe(true);
      expect(sameBits(again.far.velocity, takeoff.far.velocity)).toBe(true);
    },
    FULL_RASTER_TIMEOUT,
  );

  it('stores pressure and density as gauge ratios against the ambient reference', () => {
    // inside the HPC at takeoff: the texel holds (p - p_inf) / p_inf, not p / p_inf
    const x = 1.2;
    const rr = (r('coreInner', x) + r('coreOuter', x)) / 2;
    const c = texelCenter(
      FIELD_EXTENTS.near,
      texelIndexAt(FIELD_EXTENTS.near, x, rr)?.i ?? 0,
      texelIndexAt(FIELD_EXTENTS.near, x, rr)?.j ?? 0,
    );
    const exact = model.sample(c.x, c.r);
    const t = texel(takeoff.near, x, rr);
    expect(t.s[0]).toBe(fromHalfBits(toHalfBits((exact.pPa - REF.pInfPa) / REF.pInfPa)));
    expect(t.s[1]).toBe(
      fromHalfBits(toHalfBits((exact.rhoKgPerM3 - REF.rhoInfKgPerM3) / REF.rhoInfKgPerM3)),
    );
    expect(exact.pPa / REF.pInfPa).toBeGreaterThan(5); // mid-HPC
    // far upstream the gauge values are tiny and the texel is ambient to f16 precision
    const far = texel(takeoff.far, -7.9, 9.9);
    expect(Math.abs(far.s[0] ?? 1)).toBeLessThan(1e-4);
    expect(Math.abs(far.s[1] ?? 1)).toBeLessThan(1e-4);
  });

  it(
    'decodes to physical values inside sensible ranges everywhere',
    () => {
      const t4 = mockSteadyState(def, 1).stations['4'].ttK;
      for (const id of ['near', 'far'] as FieldExtentId[]) {
        const tex = takeoff[id];
        for (let k = 0; k < tex.state.length; k += 4) {
          const p = REF.pInfPa * (1 + fromHalfBits(tex.state[k] ?? 0));
          const tK = fromHalfBits(tex.state[k + 2] ?? 0);
          const far = fromHalfBits(tex.state[k + 3] ?? 0);
          const ux = fromHalfBits(tex.velocity[k] ?? 0);
          const ur = fromHalfBits(tex.velocity[k + 1] ?? 0);
          const ut = fromHalfBits(tex.velocity[k + 2] ?? 0);
          const ff = fromHalfBits(tex.velocity[k + 3] ?? 0);
          if (!(
            p > 0 &&
            tK > REF.tInfK - 60 &&
            tK < t4 + 10 &&
            far >= 0 &&
            far <= STOICHIOMETRIC_FAR &&
            ff >= 0 &&
            ff <= 1 &&
            Math.hypot(ux, ur, ut) < 700
          )) {
            throw new Error(
              `${id} texel ${k / 4}: p=${p} T=${tK} FAR=${far} u=(${ux}, ${ur}, ${ut}) ff=${ff}`,
            );
          }
        }
      }
    },
    FULL_RASTER_TIMEOUT,
  );
});

describe('mock flow field: geometry and flow features', () => {
  it('marks the walls solid and the ducts and free stream fluid', () => {
    const solid = (x: number, rr: number) => model.sample(x, rr).fluidFraction;
    expect(solid(0.5, (r('nacelleInner', 0.5) + r('nacelleOuter', 0.5)) / 2)).toBe(0); // nacelle
    expect(solid(1.0, 0.1)).toBe(0); // centre body
    expect(solid(1.0, (r('coreOuter', 1.0) + r('coreCowl', 1.0)) / 2)).toBe(0); // core casing
    expect(solid(1.0, (r('coreCowl', 1.0) + r('nacelleInner', 1.0)) / 2)).toBe(1); // bypass duct
    expect(solid(1.0, (r('coreInner', 1.0) + r('coreOuter', 1.0)) / 2)).toBe(1); // core duct
    expect(solid(-3, 2)).toBe(1); // free stream
    expect(solid(4, 0.1)).toBe(1); // core jet, behind the plug
  });

  it('swirls the flow in the rotation direction behind the fan and removes it at the OGV', () => {
    const mid = (x: number) => (r('coreCowl', x) + r('nacelleInner', x)) / 2;
    const ogv = def.bladeRows.find((row) => row.id === 'fan-ogv');
    const x = (ogv?.leadingEdge.hub.x ?? 0) - 0.05; // between the splitter and the OGV
    expect(x).toBeGreaterThan(0.26);
    expect(model.sample(x, mid(x)).uthetaMPerS).toBeLessThan(-30);
    expect(model.sample(-0.3, 0.5).uthetaMPerS).toBe(0);
    expect(model.sample(1.0, mid(1.0)).uthetaMPerS).toBe(0);
    // the sign follows the rotation: rotation -1 about +x means -theta
    expect(def.rotation.lp).toBe(-1);
  });

  it('draws air into the intake and accelerates it toward the highlight', () => {
    const far = model.sample(-3, 0);
    const near = model.sample(-1.2, 0);
    expect(far.uxMPerS).toBeGreaterThan(0);
    expect(near.uxMPerS).toBeGreaterThan(far.uxMPerS);
    expect(near.pPa).toBeLessThan(REF.pInfPa);
    expect(model.sample(0, 0.5).uxMPerS).toBeGreaterThan(150); // fan face, Mach about 0.6
  });

  it('puts a hot, fuelled core jet inside a cold bypass jet, decaying downstream', () => {
    const core = model.sample(3.6, 0);
    const bypass = model.sample(1.7, 0.65);
    expect(core.uxMPerS).toBeGreaterThan(bypass.uxMPerS);
    expect(bypass.uxMPerS).toBeGreaterThan(200);
    expect(core.tK).toBeGreaterThan(REF.tInfK + 300);
    expect(core.fuelAirRatio).toBeGreaterThan(0);
    expect(bypass.fuelAirRatio).toBe(0);
    const u10 = model.sample(10, 0).uxMPerS;
    const u25 = model.sample(25, 0).uxMPerS;
    expect(u10).toBeLessThan(core.uxMPerS);
    expect(u25).toBeLessThan(u10);
    expect(u25).toBeGreaterThan(0);
    expect(model.sample(10, 6).uxMPerS).toBeLessThan(5); // outside the plume
  });

  it('reads back through the contract sampler (sampleCpuField) close to the model', () => {
    for (const [x, rr] of [
      [3.6, 0.05],
      [-1.5, 0.3],
      [1.2, (r('coreCowl', 1.2) + r('nacelleInner', 1.2)) / 2],
    ] as const) {
      const exact = model.sample(x, rr);
      const back = sampleCpuField(takeoff.near, REF, x, rr);
      expect(back).not.toBeNull();
      expect(Math.abs((back?.uxMPerS ?? 0) - exact.uxMPerS)).toBeLessThan(
        0.05 * Math.abs(exact.uxMPerS) + 2,
      );
      expect(Math.abs((back?.tK ?? 0) - exact.tK)).toBeLessThan(0.02 * exact.tK);
    }
  });
});

describe('mock flow field: an engine at rest', () => {
  it(
    'is the ambient everywhere: zero gauge bits, zero velocity, ambient temperature',
    () => {
      const rest = createMockCycle(def).reset('shutdown');
      const field = createMockFlowField(def, rest, ISA_SLS);
      expect(field.version).toBe(0);
      const zero = toHalfBits(0);
      const tInf = toHalfBits(REF.tInfK);
      for (const tex of [field.near, field.far]) {
        for (let k = 0; k < tex.state.length; k += 4) {
          const fluid = fromHalfBits(tex.velocity[k + 3] ?? 0) > 0;
          if (!fluid) continue;
          if (
            tex.state[k] !== zero ||
            tex.state[k + 1] !== zero ||
            tex.state[k + 2] !== tInf ||
            tex.state[k + 3] !== zero ||
            tex.velocity[k] !== zero ||
            tex.velocity[k + 1] !== zero ||
            tex.velocity[k + 2] !== zero
          ) {
            throw new Error(`texel ${k / 4} of ${tex.extent.id} is not ambient`);
          }
        }
      }
    },
    FULL_RASTER_TIMEOUT,
  );
});
