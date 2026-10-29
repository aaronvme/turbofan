// The particle kernel's TS mirror (w2/flowviz round 2): the f64 oracle of tests/gpu/flowParticles,
// here on analytic fields; and the kernel's uniform block.
import { describe, expect, it } from 'vitest';
import { FIELD_EXTENTS } from '../../../../src/contracts/flow';
import {
  initialParticles,
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
