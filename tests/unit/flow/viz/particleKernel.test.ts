// The particle kernel's TS mirror (w2/flowviz round 2): the f64 oracle of tests/gpu/flowParticles,
// here on analytic fields; and the kernel's uniform block.
import { describe, expect, it } from 'vitest';
import {
  FIELD_EXTENTS,
  fieldReferenceFromAmbient,
  rasterizeField,
} from '../../../../src/contracts/flow';
import { ISA_SLS } from '../../../../src/contracts/ambient';
import {
  densityGradientRaster,
  initialParticles,
  MAX_SUBSTEPS,
  sampleGradientRaster,
  MAX_SEED_ZONES,
  packParticleParams,
  PARTICLE_FLOATS,
  PARTICLE_PARAMS_BYTES,
  particleKernelWgsl,
  gradientKernelWgsl,
  readParticle,
  stepParticle,
  type ParticleParams,
} from '../../../../src/flow/viz/particleKernel';
import type { MeridionalSampler, SeedZone } from '../../../../src/flow/viz/particles';

const E = FIELD_EXTENTS.near;
const zones: SeedZone[] = [{ id: 'a', weight: 1, x0: -1, x1: -0.5, r0: 0.1, r1: 0.5 }];
const params: ParticleParams = {
  extent: E,
  dtSimS: 1e-3,
  dtWallS: 0.1,
  lifeMinS: 2,
  lifeSpanS: 1,
  count: 4,
  frame: 3,
  zones,
};
const flow: MeridionalSampler = (x, r) =>
  x < E.xMin || x > E.xMax || r > E.rMax ? null : { ux: 100, ur: 0, ut: 50 * r, fluid: 1 };
const base = {
  x: 0,
  r: 0.5,
  theta: 0,
  age: 1,
  life: 3,
  alpha: 0,
  vel: [0, 0, 0] as const,
  speed: 0,
};

describe('stepParticle (the kernel in f64)', () => {
  it('advects a live particle and ages it, with the 3D velocity at its new azimuth', () => {
    const p = stepParticle(base, 0, params, flow);
    expect(p.x).toBeCloseTo(0.1, 12);
    expect(p.r).toBe(0.5);
    expect(p.theta).toBeCloseTo(0.05, 12);
    expect(p.age).toBeCloseTo(1.1, 12);
    expect(p.vel[0]).toBe(100);
    expect(p.speed).toBeCloseTo(Math.hypot(100, 25), 9);
    expect(p.alpha).toBeGreaterThan(0.9);
  });

  it('respawns at the end of life and outside the field, deterministically, in a zone', () => {
    const old = stepParticle({ ...base, age: 2.95 }, 5, params, flow);
    const out = stepParticle({ ...base, x: E.xMax - 0.01 }, 5, params, flow);
    for (const p of [old, out]) {
      expect(p.age).toBe(0);
      expect(p.alpha).toBe(0);
      expect(p.x).toBeGreaterThanOrEqual(-1);
      expect(p.x).toBeLessThanOrEqual(-0.5);
      expect(p.life).toBeGreaterThanOrEqual(2);
      expect(p.life).toBeLessThan(3);
    }
    expect(old).toEqual(out);
    expect(stepParticle({ ...base, age: 2.95 }, 6, params, flow)).not.toEqual(old);
  });

  it('waits while unborn, then is born', () => {
    expect(stepParticle({ ...base, age: -0.5 }, 0, params, flow)).toMatchObject({
      age: -0.4,
      alpha: 0,
    });
    expect(stepParticle({ ...base, age: -0.05 }, 0, params, flow).age).toBe(0);
  });

  // W2V-I4: the kernel's step is substepped against the texel size
  it('stops at a one-texel wall at x1/10 instead of tunnelling through it', () => {
    const cell = (E.xMax - E.xMin) / E.width;
    const wall: MeridionalSampler = (x, r) => {
      if (x < E.xMin || x > E.xMax || r > E.rMax) return null;
      return { ux: 450, ur: 0, ut: 0, fluid: Math.min(1, Math.abs(x - 0.5 - cell / 2) / cell) };
    };
    const fast = { ...params, dtSimS: 1 / 60 / 10 };
    const p = stepParticle({ ...base, x: 0.1 }, 0, fast, wall);
    // it hit the wall and was respawned in the zone
    expect(p.age).toBe(0);
    expect(p.x).toBeLessThanOrEqual(-0.5);
  });

  it('wraps theta into [-pi, pi)', () => {
    const p = stepParticle({ ...base, theta: 3.14 }, 0, params, flow);
    expect(p.theta).toBeCloseTo(3.19 - 2 * Math.PI, 9);
  });
});

describe('kernel buffers', () => {
  it('packs the uniform block in the WGSL layout', () => {
    const b = packParticleParams(params);
    expect(b.byteLength).toBe(PARTICLE_PARAMS_BYTES);
    const f = new Float32Array(b);
    const u = new Uint32Array(b);
    expect([...f.slice(0, 4)]).toEqual([E.xMin, E.xMax, E.rMin, E.rMax]);
    expect(Math.fround(f[8] ?? 0)).toBe(Math.fround(1e-3));
    expect([...u.slice(16, 19)]).toEqual([4, 3, 1]);
    expect([...f.slice(20, 24)]).toEqual([-1, -0.5, Math.fround(0.1), 0.5]);
    expect(f[36]).toBe(1);
    // W2V-I4: the substep length (the texel, m) and the substep cap
    expect(f[7]).toBe(Math.fround(Math.min((E.xMax - E.xMin) / E.width, (E.rMax - E.rMin) / E.height)));
    expect(f[14]).toBe(MAX_SUBSTEPS);
    expect(() => packParticleParams({ ...params, zones: [] })).toThrow();
    expect(() =>
      packParticleParams({
        ...params,
        zones: Array.from({ length: MAX_SEED_ZONES + 1 }, () => zones[0] as SeedZone),
      }),
    ).toThrow();
  });

  it('starts every particle unborn, at spread start times', () => {
    const f = initialParticles(100, 2);
    expect(f.length).toBe(100 * PARTICLE_FLOATS);
    const ages = Array.from({ length: 100 }, (_, i) => readParticle(f, i).age);
    for (const a of ages) {
      expect(a).toBeLessThan(0);
      expect(a).toBeGreaterThanOrEqual(-2.000001);
    }
    expect(new Set(ages).size).toBe(100);
  });

  it('emits both kernels with their entry points', () => {
    expect(particleKernelWgsl()).toContain('fn particleMain');
    expect(gradientKernelWgsl()).toContain('fn gradientMain');
  });
});

// The gradient kernel's TS mirror: the oracle of the schlieren and haze march (W2V-I3)
describe('densityGradientRaster and sampleGradientRaster', () => {
  const ref = fieldReferenceFromAmbient(ISA_SLS);
  const e = { ...E, width: 64, height: 16, xMin: 0, xMax: 1, rMin: 0, rMax: 0.25 };
  const field = rasterizeField(e, ref, (x, r) => ({
    pPa: ref.pInfPa,
    rhoKgPerM3: ref.rhoInfKgPerM3 * (1 + 0.02 * x + 0.04 * r),
    tK: ref.tInfK,
    fuelAirRatio: 0,
    uxMPerS: 0,
    urMPerS: 0,
    uthetaMPerS: 0,
    fluidFraction: x > 0.5 && x < 0.55 ? 0 : 1,
  }));
  const g = densityGradientRaster(field);

  // f16 storage quantizes g to 2^-11 relative; a neighbour difference over the span amplifies it
  // to ~2.4 % at this raster's 64 columns (0.03 x 2^-10 / (2 / 64) against 0.02): within 5 %
  const near = (v: number, want: number) => {
    expect(Math.abs(v - want)).toBeLessThan(0.05 * Math.abs(want));
  };

  it('is the central differences of the density gauge, one-sided at the ends, zero at walls', () => {
    const at = (i: number, j: number, c: number) => g[4 * (j * e.width + i) + c] ?? NaN;
    near(at(10, 8, 0), 0.02);
    near(at(10, 8, 1), 0.04);
    near(at(0, 8, 0), 0.02);
    // the axis row: g is even in r, so row -1 is row 0 and the span is two rows
    near(at(10, 0, 1), 0.02);
    // next to the wall (x in 0.5..0.55): zero, as the kernel stores it
    expect(at(32, 8, 0)).toBe(0);
    expect(at(10, 8, 3)).toBe(1);
  });

  it('samples bilinearly with clamp-to-edge, as the linear sampler the march uses', () => {
    const s = sampleGradientRaster(g, e, 0.2, 0.1);
    near(s.gx, 0.02);
    near(s.gr, 0.04);
    expect(sampleGradientRaster(g, e, -1, 0.1)).toEqual(sampleGradientRaster(g, e, 0, 0.1));
  });
});
