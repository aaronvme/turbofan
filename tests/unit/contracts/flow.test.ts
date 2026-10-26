import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { toHalfBits } from '../../../src/contracts/half';
import {
  FIELD_EXTENTS,
  SOLVER_DOMAIN_MIN_D,
  fieldExtentDomainProblems,
  minimumSolverDomain,
  type SolverDomain,
  FIELD_TEXTURE_FORMAT,
  STATE_CHANNELS,
  VELOCITY_CHANNELS,
  decodeTexel,
  encodeTexel,
  fieldReferenceFromAmbient,
  flowTargetsFromCycleState,
  rasterizeField,
  sampleCpuField,
  texelCenter,
  texelIndexAt,
  type FieldExtent,
  type FieldReference,
  type FieldSample,
} from '../../../src/contracts/flow';
import { ISA_SLS } from '../../../src/contracts/ambient';
import { SOLVER_REDUCTION_STATIONS } from '../../../src/contracts/stations';
import { sampleCycleState } from './fixtures/cycleFixture';
import { ENGINE_DEFINITION } from '../../../src/engine/definition';

const REF: FieldReference = fieldReferenceFromAmbient(ISA_SLS);

function sample(overrides: Partial<FieldSample> = {}): FieldSample {
  return {
    pPa: REF.pInfPa,
    rhoKgPerM3: REF.rhoInfKgPerM3,
    tK: REF.tInfK,
    fuelAirRatio: 0,
    uxMPerS: 0,
    urMPerS: 0,
    uthetaMPerS: 0,
    fluidFraction: 1,
    ...overrides,
  };
}

describe('render texture layout', () => {
  it('uses rgba16float with the documented channel order', () => {
    expect(FIELD_TEXTURE_FORMAT).toBe('rgba16float');
    expect([...STATE_CHANNELS]).toEqual([
      'pGaugeRatio',
      'rhoGaugeRatio',
      'temperatureK',
      'fuelAirRatio',
    ]);
    expect([...VELOCITY_CHANNELS]).toEqual(['uxMPerS', 'urMPerS', 'uthetaMPerS', 'fluidFraction']);
  });

  it('has a near-engine and a far-field extent, both starting on the axis', () => {
    const { near, far } = FIELD_EXTENTS;
    for (const e of [near, far]) {
      expect(e.rMin).toBe(0);
      expect(e.width).toBeGreaterThan(0);
      expect(e.height).toBeGreaterThan(0);
      expect(Number.isInteger(e.width) && Number.isInteger(e.height)).toBe(true);
      // square texels keep particles and contours isotropic
      const dx = (e.xMax - e.xMin) / e.width;
      const dr = (e.rMax - e.rMin) / e.height;
      expect(dx).toBeCloseTo(dr, 9);
    }
    // the near extent covers the whole engine (inlet highlight at about -0.8 m, plug tip at about 3.3 m)
    expect(near.xMin).toBeLessThan(-1);
    expect(near.xMax).toBeGreaterThan(3.5);
    // the far extent covers >= 5 D upstream and ~20 D downstream of a 1.55 m fan
    expect(far.xMin).toBeLessThanOrEqual(-5 * 1.55);
    expect(far.xMax).toBeGreaterThanOrEqual(20 * 1.55);
    expect(far.xMin).toBeLessThan(near.xMin);
    expect(far.rMax).toBeGreaterThan(near.rMax);
  });

  it('maps texel indices to texel centres and back; row 0 is next to the axis', () => {
    const e = FIELD_EXTENTS.near;
    const c = texelCenter(e, 0, 0);
    expect(c.x).toBeCloseTo(e.xMin + 0.5 * ((e.xMax - e.xMin) / e.width), 12);
    expect(c.r).toBeCloseTo(0.5 * ((e.rMax - e.rMin) / e.height), 12);
    for (const [i, j] of [
      [0, 0],
      [17, 3],
      [e.width - 1, e.height - 1],
    ] as const) {
      const p = texelCenter(e, i, j);
      expect(texelIndexAt(e, p.x, p.r)).toEqual({ i, j });
    }
    expect(texelIndexAt(e, e.xMin - 1e-6, 0.1)).toBeNull();
    expect(texelIndexAt(e, 0, e.rMax + 1e-6)).toBeNull();
    expect(texelIndexAt(e, 0, -0.1)).toBeNull();
  });
});

describe('W0M-I5: the render extents lie inside the solver domain (docs/MESH.md)', () => {
  it('states the MESH.md domain requirement in fan diameters', () => {
    expect(SOLVER_DOMAIN_MIN_D).toEqual({ upstream: 5, radial: 5, downstream: 20 });
  });

  it('derives the minimum domain from the definition: highlight, core lip, nacelle, fan tip', () => {
    const d = minimumSolverDomain(ENGINE_DEFINITION);
    const c = ENGINE_DEFINITION.flowpath.curves;
    const fan = ENGINE_DEFINITION.bladeRows.find(
      (r) => r.component === 'fan' && r.kind === 'rotor',
    );
    const D = 2 * (fan?.leadingEdge.tip.r ?? Number.NaN);
    expect(D).toBeCloseTo(1.5494, 4); // 61 in fan ([FICHE] in ENGINE_FACTS.md)
    expect(d.xIn).toBeCloseTo((c.nacelleInner.points[0]?.x ?? 0) - 5 * D, 12);
    expect(d.xOut).toBeCloseTo((c.coreOuter.points.at(-1)?.x ?? 0) + 20 * D, 12);
    expect(d.rOut).toBeCloseTo(Math.max(...c.nacelleOuter.points.map((p) => p.r)) + 5 * D, 12);
  });

  it('every texel of both extents is inside the minimum domain of the reference engine', () => {
    const domain = minimumSolverDomain(ENGINE_DEFINITION);
    expect(fieldExtentDomainProblems(FIELD_EXTENTS.near, domain)).toEqual([]);
    // the far texture used to reach r = 10 m, past r_out (8.75 m placeholder, 8.81 m minimum)
    expect(fieldExtentDomainProblems(FIELD_EXTENTS.far, domain)).toEqual([]);
  });

  it('every texel is inside the domain of the generated meshes (docs/mesh/metrics-*.json)', () => {
    for (const name of ['130k', '80k']) {
      const metrics = JSON.parse(
        readFileSync(new URL(`../../../docs/mesh/metrics-${name}.json`, import.meta.url), 'utf8'),
      ) as { report: { domain: SolverDomain } };
      for (const e of [FIELD_EXTENTS.near, FIELD_EXTENTS.far])
        expect(fieldExtentDomainProblems(e, metrics.report.domain)).toEqual([]);
    }
  });

  it('reports each side of an extent that leaves the domain', () => {
    const domain: SolverDomain = { xIn: -8, xOut: 32, rOut: 8 };
    const e: FieldExtent = { id: 'far', width: 4, height: 4, xMin: -8, xMax: 32, rMin: 0, rMax: 8 };
    expect(fieldExtentDomainProblems(e, domain)).toEqual([]);
    const text = (patch: Partial<FieldExtent>) =>
      fieldExtentDomainProblems({ ...e, ...patch }, domain).join('|');
    expect(text({ xMin: -8.1 })).toMatch(/far: xMin -8\.1 is upstream of the inflow xIn -8/);
    expect(text({ xMax: 32.1 })).toMatch(/far: xMax 32\.1 is downstream of the outflow xOut 32/);
    expect(text({ rMax: 8.1 })).toMatch(/far: rMax 8\.1 is beyond the far-field boundary rOut 8/);
    expect(text({ rMin: -0.1 })).toMatch(/far: rMin -0\.1 is below the axis/);
  });
});

describe('texel encoding', () => {
  it('encodes ambient as zero gauge values and the absolute temperature', () => {
    const { state, velocity } = encodeTexel(sample(), REF);
    expect(state).toEqual([0, 0, REF.tInfK, 0]);
    expect(velocity).toEqual([0, 0, 0, 1]);
  });

  it('stores p and rho as gauge ratios so f16 resolves small far-field perturbations', () => {
    // a 10 Pa acoustic perturbation is below one f16 ulp of p/p_inf (~1e-3) but survives as a gauge ratio
    const s = sample({ pPa: REF.pInfPa + 10 });
    const { state } = encodeTexel(s, REF);
    const roundTripped = decodeTexel(
      state.map((v) => halfRound(v)) as unknown as readonly [number, number, number, number],
      [0, 0, 0, 1],
      REF,
    );
    expect(roundTripped.pPa - REF.pInfPa).toBeCloseTo(10, 1);
    expect(halfRound(s.pPa / REF.pInfPa)).toBe(1); // what p/p_inf would have lost
  });

  it('round-trips a hot, swirling sample within f16 precision', () => {
    const s = sample({
      pPa: 2.9e6,
      rhoKgPerM3: 7.1,
      tK: 1745,
      fuelAirRatio: 0.0254,
      uxMPerS: 512.5,
      urMPerS: -31.25,
      uthetaMPerS: -170,
      fluidFraction: 1,
    });
    const { state, velocity } = encodeTexel(s, REF);
    const back = decodeTexel(state, velocity, REF);
    expect(back.pPa).toBeCloseTo(s.pPa, 6);
    expect(back.tK).toBe(1745);
    expect(back.uthetaMPerS).toBe(-170);
    const halfBack = decodeTexel(
      state.map(halfRound) as unknown as readonly [number, number, number, number],
      velocity.map(halfRound) as unknown as readonly [number, number, number, number],
      REF,
    );
    expect(Math.abs(halfBack.pPa / s.pPa - 1)).toBeLessThan(1e-3);
    expect(Math.abs(halfBack.tK - s.tK)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(halfBack.uxMPerS - s.uxMPerS)).toBeLessThanOrEqual(0.25);
    expect(Math.abs(halfBack.fuelAirRatio - s.fuelAirRatio)).toBeLessThan(2e-5);
  });

  it('derives the reference state from the ambient with the ideal-gas law', () => {
    expect(REF.pInfPa).toBe(101325);
    expect(REF.tInfK).toBe(288.15);
    expect(REF.rhoInfKgPerM3).toBeCloseTo(1.225, 3);
  });
});

function halfRound(v: number): number {
  // via the contract's own encoder, so the test checks the same rounding the textures use
  const bits = toHalfBits(v);
  const sign = bits & 0x8000 ? -1 : 1;
  const exp = (bits >> 10) & 0x1f;
  const mant = bits & 0x3ff;
  if (exp === 0) return sign * mant * 2 ** -24;
  return sign * (1 + mant / 1024) * 2 ** (exp - 15);
}

describe('rasterizeField and sampleCpuField', () => {
  const tiny: FieldExtent = { id: 'near', width: 4, height: 2, xMin: 0, xMax: 4, rMin: 0, rMax: 2 };
  const linear = (x: number, r: number): FieldSample =>
    sample({ tK: 300 + 10 * x + r, uxMPerS: 2 * x, urMPerS: r, uthetaMPerS: 4 * r });

  it('fills both textures in the documented order (texel (i, j) at index 4 * (j * width + i))', () => {
    const tex = rasterizeField(tiny, REF, linear);
    expect(tex.state.length).toBe(4 * 4 * 2);
    expect(tex.velocity.length).toBe(4 * 4 * 2);
    const c = texelCenter(tiny, 2, 1); // x = 2.5, r = 1.5
    const k = 4 * (1 * 4 + 2);
    expect(tex.state[k + 2]).toBe(toHalfBits(300 + 25 + 1.5));
    expect(tex.velocity[k]).toBe(toHalfBits(2 * c.x));
    expect(tex.velocity[k + 3]).toBe(toHalfBits(1));
  });

  it('samples exactly at texel centres and bilinearly between them', () => {
    const tex = rasterizeField(tiny, REF, linear);
    const atCentre = sampleCpuField(tex, REF, 1.5, 0.5);
    expect(atCentre?.tK).toBeCloseTo(300 + 15 + 0.5, 1);
    const between = sampleCpuField(tex, REF, 2.0, 1.0);
    expect(between?.tK).toBeCloseTo(300 + 20 + 1.0, 1);
    expect(between?.uxMPerS).toBeCloseTo(4, 2);
  });

  it('mirrors across the axis: scalars even, u_r and u_theta odd', () => {
    const tex = rasterizeField(tiny, REF, linear);
    const onAxis = sampleCpuField(tex, REF, 1.5, 0);
    expect(onAxis?.urMPerS).toBeCloseTo(0, 6);
    expect(onAxis?.uthetaMPerS).toBeCloseTo(0, 6);
    expect(onAxis?.tK).toBeCloseTo(300 + 15 + 0.5, 1);
  });

  it('clamps at the outer edges inside the extent and returns null outside it', () => {
    const tex = rasterizeField(tiny, REF, linear);
    expect(sampleCpuField(tex, REF, 0.01, 1.99)?.tK).toBeCloseTo(300 + 5 + 1.5, 1);
    expect(sampleCpuField(tex, REF, -0.01, 1)).toBeNull();
    expect(sampleCpuField(tex, REF, 1, 2.01)).toBeNull();
  });

  it('rejects a sample function that returns non-finite values', () => {
    expect(() => rasterizeField(tiny, REF, () => sample({ tK: Number.NaN }))).toThrow(/non-finite/);
  });
});

describe('flowTargetsFromCycleState', () => {
  it('copies the reduction stations and converts shaft speeds to rad/s', () => {
    const state = sampleCycleState();
    const t = flowTargetsFromCycleState(state, ISA_SLS);
    expect(t.timeS).toBe(state.timeS);
    expect(t.n1RadPerS).toBeCloseTo((state.n1Rpm * 2 * Math.PI) / 60, 9);
    expect(t.n2RadPerS).toBeCloseTo((state.n2Rpm * 2 * Math.PI) / 60, 9);
    expect(t.fuelFlowKgPerS).toBe(state.fuelFlowKgPerS);
    expect(t.vsvClosureRad).toBe(state.vsvClosureRad);
    // integer-like keys enumerate in numeric order, so compare as sets
    expect(Object.keys(t.stations).sort()).toEqual([...SOLVER_REDUCTION_STATIONS].sort());
    expect(t.stations['4']).toEqual({
      ptPa: state.stations['4'].ptPa,
      ttK: state.stations['4'].ttK,
      wKgPerS: state.stations['4'].wKgPerS,
      fuelAirRatio: state.stations['4'].fuelAirRatio,
    });
    expect(t.ambient).toEqual(ISA_SLS);
  });
});
