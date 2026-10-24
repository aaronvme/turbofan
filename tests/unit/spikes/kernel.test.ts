import { describe, expect, it } from 'vitest';
import {
  PARAMS_BYTES,
  RK3_ALPHA,
  TILES,
  fluxProbeWgsl,
  packParams,
  stageKernelWgsl,
  workgroupBytes,
} from '../../../spikes/lib/kernel';

describe('stage kernel WGSL generation', () => {
  it('bakes the tile shape into the workgroup size and the shared-memory arrays', () => {
    const src = stageKernelWgsl({ x: 32, y: 4 });
    expect(src).toContain('const TX: u32 = 32u;');
    expect(src).toContain('const TY: u32 = 4u;');
    expect(src).toMatch(/@compute @workgroup_size\(TX, TY\)/);
    expect(src).toMatch(/var<workgroup> sq0: array<vec4f, NT>;/);
  });

  it('has the pieces that make it a real stage, not a stand-in', () => {
    const src = stageKernelWgsl({ x: 16, y: 8 });
    for (const piece of [
      'fn toPrim', // conserved -> primitive, Newton for T
      'fn applyBC', // ghost-cell boundary conditions
      'fn vanAlbada4', // MUSCL limiter
      'fn slau2', // SLAU2 flux
      'r0.z -= ', // axisymmetric source on radial momentum
      'if (P.stage == 0u)', // local dt in stage 1
      'qoutA[c] = ', // RK update
    ]) {
      expect(src).toContain(piece);
    }
  });

  it('uses at most 8 storage buffers (the default limit) and fits 16 KiB of workgroup memory', () => {
    for (const t of TILES) {
      const src = stageKernelWgsl(t);
      expect((src.match(/var<storage/g) ?? []).length).toBeLessThanOrEqual(8);
      expect(workgroupBytes(t)).toBeLessThanOrEqual(16384);
    }
    expect(workgroupBytes({ x: 16, y: 8 })).toBe(12480);
  });

  it('the flux probe reuses the same SLAU2 code', () => {
    const probe = fluxProbeWgsl();
    expect(probe).toContain('fn slau2');
    expect(probe).toContain('@compute');
  });

  it('rejects tiles too small for the 2-cell halo logic', () => {
    expect(() => stageKernelWgsl({ x: 1, y: 8 })).toThrow(/tile/);
  });
});

describe('packParams', () => {
  it('lays the uniform block out as 20 x 32-bit words, stage and offsets as u32', () => {
    expect(PARAMS_BYTES).toBe(80);
    const buf = packParams({
      rhoInf: 1.2,
      pInf: 101325,
      uInf: 100,
      vInf: 0,
      h0Inf: 3e5,
      gasR: 287.05,
      cfl: 1.5,
      alpha: RK3_ALPHA[1],
      tInf: 288.15,
      zMix: 15,
      gammaInf: 1.4,
      cInf: 340,
      eInf: 2e5,
      cvInf: 717,
      stage: 1,
      wgBase: 24,
      ghostBase: 48,
    });
    const f = new Float32Array(buf);
    const u = new Uint32Array(buf);
    expect(buf.byteLength).toBe(80);
    expect(f[1]).toBe(101325);
    expect(f[7]).toBeCloseTo(0.4929, 6);
    expect(u[14]).toBe(1);
    expect(u[15]).toBe(24);
    expect(u[16]).toBe(48);
  });

  it('the RK3 coefficients end at 1 (the last stage completes the step)', () => {
    expect(RK3_ALPHA).toHaveLength(3);
    expect(RK3_ALPHA[2]).toBe(1);
  });
});
