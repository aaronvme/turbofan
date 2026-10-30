// Particle math of the flow visuals (w2/flowviz): the 2D (x, r, u_theta) field rotated into 3D
// about the engine axis, the advection step, seeding and the fade. Analytic fields only.
import { describe, expect, it } from 'vitest';
import {
  advectParticle,
  advectSubstepped,
  createRng,
  particleAlpha,
  seedParticle,
  toCartesian,
  toCylindrical,
  velocity3D,
  type MeridionalSampler,
  type SeedZone,
} from '../../../../src/flow/viz/particles';

const uniform =
  (ux: number, ur = 0, ut = 0): MeridionalSampler =>
  () => ({ ux, ur, ut, fluid: 1 });

describe('2D -> 3D rotation about the axis (PHYSICS.md 2.1: x axial, theta right-handed about +x)', () => {
  it('maps theta = 0 to +y and theta = pi/2 to +z, and round-trips', () => {
    expect(toCartesian(1, 2, 0)).toEqual([1, 2, 0]);
    const [x, y, z] = toCartesian(1, 2, Math.PI / 2);
    expect(x).toBe(1);
    expect(y).toBeCloseTo(0, 12);
    expect(z).toBeCloseTo(2, 12);
    const c = toCylindrical([0.3, -0.4, 0.3]);
    const back = toCartesian(c.x, c.r, c.theta);
    expect(back[0]).toBeCloseTo(0.3, 12);
    expect(back[1]).toBeCloseTo(-0.4, 12);
    expect(back[2]).toBeCloseTo(0.3, 12);
  });

  it('puts u_r along the radius and u_theta along e_theta = x-hat cross e_r', () => {
    // at theta = 0: e_r = +y, e_theta = +z
    expect(velocity3D(0, 10, 2, 3)).toEqual([10, 2, 3]);
    // at theta = pi/2: e_r = +z, e_theta = -y
    const v = velocity3D(Math.PI / 2, 10, 2, 3);
    expect(v[0]).toBe(10);
    expect(v[1]).toBeCloseTo(-3, 12);
    expect(v[2]).toBeCloseTo(2, 12);
  });
});

describe('advection (midpoint RK2 in x, r, theta)', () => {
  it('moves exactly with a uniform axial flow', () => {
    const p = advectParticle({ x: -1, r: 0.5, theta: 0.2 }, 1e-3, uniform(200));
    expect(p).not.toBeNull();
    expect(p?.x).toBeCloseTo(-0.8, 12);
    expect(p?.r).toBe(0.5);
    expect(p?.theta).toBeCloseTo(0.2, 12);
  });

  it('keeps r exactly and turns by Omega t in solid-body rotation u_theta = Omega r', () => {
    const omega = 120;
    const field: MeridionalSampler = (_x, r) => ({ ux: 0, ur: 0, ut: omega * r, fluid: 1 });
    let p = { x: 0, r: 0.7, theta: 0 };
    for (let k = 0; k < 1000; k++) p = advectParticle(p, 1e-5, field) ?? p;
    expect(p.r).toBe(0.7);
    expect(p.theta).toBeCloseTo(omega * 1e-2, 10);
  });

  it('turns by Gamma t / r^2 in a free vortex u_theta = Gamma / r', () => {
    const gamma = 75;
    const field: MeridionalSampler = (_x, r) => ({ ux: 0, ur: 0, ut: gamma / r, fluid: 1 });
    let p = { x: 0, r: 0.5, theta: 1 };
    for (let k = 0; k < 100; k++) p = advectParticle(p, 1e-4, field) ?? p;
    expect(p.theta).toBeCloseTo(1 + (gamma * 1e-2) / 0.25, 9);
  });

  it('is second order: u_r = k r gives r0 exp(k t) with an error that falls 4x per halving', () => {
    const k = 50;
    const field: MeridionalSampler = (_x, r) => ({ ux: 0, ur: k * r, ut: 0, fluid: 1 });
    const err = (n: number) => {
      let p = { x: 0, r: 0.2, theta: 0 };
      for (let s = 0; s < n; s++) p = advectParticle(p, 0.01 / n, field) ?? p;
      return Math.abs(p.r - 0.2 * Math.exp(k * 0.01));
    };
    const e1 = err(50);
    const e2 = err(100);
    expect(e1 / 0.2).toBeLessThan(1e-3);
    expect(e1 / e2).toBeGreaterThan(3.6);
    expect(e1 / e2).toBeLessThan(4.4);
  });

  it('traces the analytic helix of axial flow plus solid-body swirl, in 3D', () => {
    const field: MeridionalSampler = (_x, r) => ({ ux: 150, ur: 0, ut: 80 * r, fluid: 1 });
    let p = { x: 0, r: 0.6, theta: 0 };
    for (let s = 0; s < 200; s++) p = advectParticle(p, 5e-5, field) ?? p;
    const got = toCartesian(p.x, p.r, p.theta);
    const want = [150 * 0.01, 0.6 * Math.cos(0.8), 0.6 * Math.sin(0.8)];
    for (let c = 0; c < 3; c++) expect(got[c]).toBeCloseTo(want[c] ?? NaN, 9);
  });

  it('stays finite on the axis (u_theta / r with u_theta odd in r)', () => {
    const field: MeridionalSampler = (_x, r) => ({ ux: 100, ur: 0, ut: 50 * r, fluid: 1 });
    const p = advectParticle({ x: 0, r: 0, theta: 0 }, 1e-4, field);
    expect(p).not.toBeNull();
    expect(Number.isFinite(p?.theta)).toBe(true);
  });

  it('reflects a particle that would cross the axis back to r >= 0', () => {
    const p = advectParticle({ x: 0, r: 0.01, theta: 0 }, 1e-3, uniform(0, -20));
    expect(p?.r).toBeGreaterThanOrEqual(0);
    expect(p?.r).toBeCloseTo(0.01, 9);
    expect(p?.theta).toBeCloseTo(Math.PI, 9);
  });

  it('dies outside the field or in solid (fluid fraction below one half)', () => {
    expect(advectParticle({ x: 0, r: 0.5, theta: 0 }, 1e-3, () => null)).toBeNull();
    const solid: MeridionalSampler = () => ({ ux: 100, ur: 0, ut: 0, fluid: 0.4 });
    expect(advectParticle({ x: 0, r: 0.5, theta: 0 }, 1e-3, solid)).toBeNull();
  });
});

describe('seeding', () => {
  it('is deterministic for a seed and stays in [0, 1)', () => {
    const a = createRng(7);
    const b = createRng(7);
    const xs = Array.from({ length: 1000 }, () => a());
    expect(xs).toEqual(Array.from({ length: 1000 }, () => b()));
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...xs)).toBeLessThan(1);
    expect(createRng(8)()).not.toBe(xs[0]);
  });

  const zones: SeedZone[] = [
    { id: 'upstream', weight: 3, x0: -1.6, x1: -1.4, r0: 0, r1: 1.1 },
    { id: 'bypass', weight: 1, x0: 0.3, x1: 0.35, r0: 0.62, r1: 0.9 },
  ];

  // 40000 seeds: a test runtime limit (the coverage run on the loaded machine took 5.1 s, past
  // vitest's 5 s default), not a threshold
  it('fills each zone uniformly by area and splits by weight', { timeout: 60_000 }, () => {
    const rng = createRng(1);
    const n = 40000;
    const byZone = new Map<string, number[]>();
    for (let k = 0; k < n; k++) {
      const s = seedParticle(rng, zones);
      const z = zones.find((q) => q.id === s.zone);
      expect(z).toBeDefined();
      if (z === undefined) continue;
      expect(s.x).toBeGreaterThanOrEqual(z.x0);
      expect(s.x).toBeLessThanOrEqual(z.x1);
      expect(s.r).toBeGreaterThanOrEqual(z.r0);
      expect(s.r).toBeLessThanOrEqual(z.r1);
      expect(s.theta).toBeGreaterThanOrEqual(0);
      expect(s.theta).toBeLessThan(2 * Math.PI);
      const list = byZone.get(s.zone) ?? [];
      list.push(s.r * s.r);
      byZone.set(s.zone, list);
    }
    const up = byZone.get('upstream') ?? [];
    expect(up.length / n).toBeCloseTo(0.75, 1);
    // uniform by area: the mean of r^2 is (r0^2 + r1^2) / 2
    for (const z of zones) {
      const r2 = byZone.get(z.id) ?? [];
      const mean = r2.reduce((s, v) => s + v, 0) / r2.length;
      expect(Math.abs(mean / ((z.r0 ** 2 + z.r1 ** 2) / 2) - 1)).toBeLessThan(0.02);
    }
  });
});

describe('fade', () => {
  it('fades in, holds and fades out over the life, and at the field edge', () => {
    expect(particleAlpha(0, 2, 1)).toBe(0);
    expect(particleAlpha(1, 2, 1)).toBe(1);
    expect(particleAlpha(2, 2, 1)).toBe(0);
    expect(particleAlpha(1, 2, 0)).toBe(0);
    expect(particleAlpha(1, 2, 0.5)).toBeGreaterThan(0);
    expect(particleAlpha(1, 2, 0.5)).toBeLessThan(1);
    // monotone fade-in
    expect(particleAlpha(0.05, 2, 1)).toBeLessThan(particleAlpha(0.1, 2, 1));
  });
});

// W2V-N12: the step uses the field's odd extension across the axis (sampleCpuField's ghost row:
// u_r and u_theta change sign), so a midpoint beyond the axis gives the end step the mirrored
// u_r, as a plain midpoint step in the full meridional plane would
describe('advection across the axis (the odd extension, W2V-N12)', () => {
  // a smooth odd field: u_r = -a r, crossing at the midpoint when a dt > 2
  const a = 3000;
  const field: MeridionalSampler = (_x, r) => ({ ux: 0, ur: -a * r, ut: 0, fluid: 1 });
  /** The midpoint step in the full plane (r of either sign), folded back at the end. */
  const fullPlane = (r: number, dt: number) => {
    const ext = (rr: number) => (rr >= 0 ? -a * rr : -(-a * -rr));
    const rm = r + 0.5 * dt * ext(r);
    const re = r + dt * ext(rm);
    return { r: Math.abs(re), flipped: re < 0 };
  };

  it('negates the sampled u_r when the midpoint lies beyond the axis', () => {
    const dt = 1e-3; // a dt = 3: the midpoint is at -r/2
    const want = fullPlane(0.01, dt);
    const p = advectParticle({ x: 0, r: 0.01, theta: 0.3 }, dt, field);
    expect(p?.r).toBeCloseTo(want.r, 12);
    expect(p?.theta).toBeCloseTo(want.flipped ? 0.3 + Math.PI : 0.3, 12);
  });

  it('is unchanged when the midpoint stays on its side', () => {
    const dt = 1e-4;
    const p = advectParticle({ x: 0, r: 0.01, theta: 0 }, dt, field);
    expect(p?.r).toBeCloseTo(fullPlane(0.01, dt).r, 12);
  });
});

// W2V-I4: at x1/10 a core-jet tracer moves ~0.75 m (110 texels) per frame, and one RK2 step's
// start/mid/end checks skip thin walls (the core cowl's trailing edge, the splitter lip). The
// substeps keep every step within one texel, so the fluid checks are half a texel apart
describe('substepped advection (a CFL-like limit, W2V-I4)', () => {
  const cell = 7 / 1024; // the near extent's texel, m
  /** A one-texel solid wall at x in [0.5, 0.5 + cell], bilinear-like: fluid falls to 0 over it. */
  const wall: MeridionalSampler = (x) => {
    const c = 0.5 + cell / 2;
    const fluid = Math.min(1, Math.abs(x - c) / cell);
    return { ux: 450, ur: 0, ut: 0, fluid };
  };
  const dt = 1 / 60 / 10; // one 60 Hz frame at x1/10

  it('a single RK2 step tunnels through a one-texel wall at x1/10 (the bug)', () => {
    expect(advectParticle({ x: 0.1, r: 0.5, theta: 0 }, dt, wall)).not.toBeNull();
  });

  it('the substeps stop at it', () => {
    expect(advectSubstepped({ x: 0.1, r: 0.5, theta: 0 }, dt, wall, cell, 128)).toBeNull();
  });

  it('keeps every substep within one texel and the checks within half of one', () => {
    const xs: number[] = [];
    const rec: MeridionalSampler = (x, r) => {
      xs.push(x);
      return { ux: 450, ur: 30, ut: 20 * r, fluid: 1 };
    };
    const p = advectSubstepped({ x: 0.1, r: 0.5, theta: 0 }, dt, rec, cell, 128);
    expect(p).not.toBeNull();
    const sorted = [...xs].sort((u, v) => u - v);
    for (let k = 1; k < sorted.length; k++)
      expect((sorted[k] ?? 0) - (sorted[k - 1] ?? 0)).toBeLessThanOrEqual(cell / 2 + 1e-12);
    // a uniform axial flow is integrated exactly whatever the substeps
    expect(p?.x).toBeCloseTo(0.1 + 450 * dt, 12);
  });

  it('takes one step when the motion is under a texel (the default x1/200 at low speed)', () => {
    const calls: number[] = [];
    const slow: MeridionalSampler = (x) => {
      calls.push(x);
      return { ux: 10, ur: 0, ut: 0, fluid: 1 };
    };
    const one = advectParticle({ x: 0, r: 0.5, theta: 0 }, 1e-4, slow);
    const n = calls.length;
    calls.length = 0;
    expect(advectSubstepped({ x: 0, r: 0.5, theta: 0 }, 1e-4, slow, cell, 128)).toEqual(one);
    expect(calls.length).toBe(n);
  });

  it('beyond the substep cap the particle falls behind; it never tunnels', () => {
    const p = advectSubstepped({ x: 0.1, r: 0.5, theta: 0 }, 0.01, uniform(450), cell, 8);
    expect(p).not.toBeNull();
    const moved = (p?.x ?? 0) - 0.1;
    expect(moved).toBeLessThanOrEqual(8 * cell + 1e-12);
    expect(moved).toBeGreaterThan(0.99 * 8 * cell);
  });
});
