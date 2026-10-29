// GPU particle support (w2/flowviz round 2): the hash the WGSL kernel draws its random numbers
// from (mirrored here so a Dawn test can compare the GPU's respawns exactly), the seed zones
// from the definition's flowpath, the life and the fades.
import { describe, expect, it } from 'vitest';
import { ENGINE_DEFINITION } from '../../../../src/engine/definition';
import { FIELD_EXTENTS } from '../../../../src/contracts/flow';
import {
  edgeFactor,
  flowSeedZones,
  hashRng,
  pcgHash,
  respawnSeed,
  speedFade,
  streakLengthM,
  visualDtS,
} from '../../../../src/flow/viz/seeding';
import { seedParticle } from '../../../../src/flow/viz/particles';

describe('pcgHash (PCG-RXS-M-XS 32, Jarzynski & Olano 2020), the kernel RNG', () => {
  it('matches the reference values of the 32-bit PCG hash', () => {
    // reference: the published pcg_hash, uint state = v * 747796405u + 2891336453u, ...
    const ref = (v: number): number => {
      const state = (Math.imul(v >>> 0, 747796405) + 2891336453) >>> 0;
      const word = Math.imul((state >>> ((state >>> 28) + 4)) ^ state, 277803737) >>> 0;
      return ((word >>> 22) ^ word) >>> 0;
    };
    for (const v of [0, 1, 2, 12345, 0xffffffff, 0x80000000]) expect(pcgHash(v)).toBe(ref(v));
    expect(pcgHash(0)).not.toBe(pcgHash(1));
  });

  it('hashRng gives floats in [0, 1) from the top 24 bits (exact in f32), deterministically', () => {
    const a = hashRng(42);
    const b = hashRng(42);
    let sum = 0;
    const n = 20000;
    for (let k = 0; k < n; k++) {
      const u = a();
      expect(u).toBe(b());
      expect(u).toBeGreaterThanOrEqual(0);
      expect(u).toBeLessThan(1);
      expect(u * 16777216).toBe(Math.floor(u * 16777216));
      sum += u;
    }
    // the mean of n uniforms has sd 1/sqrt(12 n) = 0.002; 5 sd
    expect(Math.abs(sum / n - 0.5)).toBeLessThan(0.01);
  });

  it('respawnSeed differs per particle and per frame', () => {
    const seen = new Set<number>();
    for (let i = 0; i < 64; i++) for (let f = 0; f < 64; f++) seen.add(respawnSeed(i, f));
    expect(seen.size).toBe(64 * 64);
  });
});

describe('flowSeedZones (from the flowpath: the intake, the bypass duct and the core entry)', () => {
  const zones = flowSeedZones(ENGINE_DEFINITION);
  const byId = Object.fromEntries(zones.map((z) => [z.id, z]));
  const fp = ENGINE_DEFINITION.flowpath;
  const highlight = fp.curves.nacelleInner.points[0];

  it('has the three zones, with positive weights that sum to 1', () => {
    expect(zones.map((z) => z.id)).toEqual(['intake', 'bypass', 'core']);
    for (const z of zones) expect(z.weight).toBeGreaterThan(0);
    expect(zones.reduce((s, z) => s + z.weight, 0)).toBeCloseTo(1, 12);
  });

  it('puts the intake zone upstream of the highlight, inside its radius', () => {
    const z = byId.intake;
    expect(z).toBeDefined();
    if (z === undefined || highlight === undefined) return;
    expect(z.x1).toBeLessThan(highlight.x);
    expect(z.r0).toBe(0);
    expect(z.r1).toBeLessThan(highlight.r);
    expect(z.r1).toBeGreaterThan(0.5 * highlight.r);
  });

  it('puts the duct zones inside their annulus, at the component entries', () => {
    for (const [id, comp] of [
      ['bypass', 'bypassDuct'],
      ['core', 'booster'],
    ] as const) {
      const z = byId[id];
      const c = fp.components.find((k) => k.id === comp);
      expect(z).toBeDefined();
      expect(c).toBeDefined();
      if (z === undefined || c === undefined) return;
      expect(z.x0).toBeCloseTo(c.xStart, 12);
      expect(z.x1).toBeGreaterThan(z.x0);
      expect(z.x1).toBeLessThan(c.xEnd);
      expect(z.r1).toBeGreaterThan(z.r0);
    }
    // the core annulus lies below the bypass one
    expect(byId.core?.r1 ?? 0).toBeLessThan(byId.bypass?.r0 ?? 0);
  });

  it('every zone lies inside the near field the particles live in', () => {
    const e = FIELD_EXTENTS.near;
    for (const z of zones) {
      expect(z.x0).toBeGreaterThan(e.xMin);
      expect(z.x1).toBeLessThan(e.xMax);
      expect(z.r1).toBeLessThan(e.rMax);
    }
  });

  it('seedParticle with the kernel RNG lands in a zone', () => {
    const rng = hashRng(7);
    for (let k = 0; k < 200; k++) {
      const s = seedParticle(rng, zones);
      const z = byId[s.zone];
      expect(z).toBeDefined();
      if (z === undefined) return;
      expect(s.x).toBeGreaterThanOrEqual(z.x0);
      expect(s.x).toBeLessThanOrEqual(z.x1);
      expect(s.r).toBeGreaterThanOrEqual(z.r0 - 1e-12);
      expect(s.r).toBeLessThanOrEqual(z.r1 + 1e-12);
    }
  });
});

describe('time dilation, streaks and fades', () => {
  it('advances the particles by dilation x the frame time, so 300 m/s at 1/200 reads as 1.5 m/s', () => {
    expect(visualDtS(1 / 60, 1 / 200)).toBeCloseTo(1 / 12000, 15);
    expect((300 * visualDtS(0.05, 1 / 200)) / 0.05).toBeCloseTo(1.5, 12);
    // a long frame (a tab switch) is capped: particles do not jump through walls
    expect(visualDtS(2, 1 / 200)).toBeCloseTo(0.1 / 200, 15);
  });

  it('draws a streak as the path over `streakS` of wall time at the dilated speed', () => {
    expect(streakLengthM(300, 1 / 200, 0.08)).toBeCloseTo(0.12, 12);
    expect(streakLengthM(0, 1 / 200, 0.08)).toBe(0);
  });

  it('fades particles in still air (nothing to show) and at the field end', () => {
    expect(speedFade(0)).toBe(0);
    expect(speedFade(5)).toBe(0);
    expect(speedFade(40)).toBe(1);
    expect(speedFade(15)).toBeGreaterThan(0);
    expect(speedFade(15)).toBeLessThan(1);
    const e = FIELD_EXTENTS.near;
    expect(edgeFactor(0, 0.5, e)).toBe(1);
    expect(edgeFactor(e.xMax, 0.5, e)).toBe(0);
    expect(edgeFactor(e.xMax - 0.15, 0.5, e)).toBeCloseTo(0.5, 12);
    expect(edgeFactor(0, e.rMax, e)).toBe(0);
  });
});
