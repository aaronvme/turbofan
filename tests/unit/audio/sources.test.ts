// The engine-sound source model (src/audio/sources.ts, src/audio/params.ts): the voice table from
// the definition, the frame the main thread posts for a cycle state, the listener angle, and the
// physics pieces the A-rows build on.
import { describe, expect, it } from 'vitest';
import {
  NOISE_VOICES,
  VOICE_GROUPS,
  maskFrame,
  silentFrame,
  toneFrequencyHz,
  toneVoices,
  validateFrame,
} from '../../../src/audio/params';
import {
  BUZZ_SAW_ONSET_MACH,
  IGNITER_SPARK_RATE_HZ,
  JET_PEAK_DEG,
  listenerReferenceX,
  STARTER_SPEED_RATIO,
  buzzSawLevelDb,
  buzzSawShape,
  createSoundModel,
  engineSoundFrame,
  fanDirectivity,
  fanFaceAnnulusM2,
  fanFaceAxialMach,
  fanTipRadiusM,
  jetLargeScaleDirectivity,
  jetStream,
  lighthillPower,
  listenerAngle,
  type SoundInputs,
} from '../../../src/audio/sources';
import { nozzle } from '../../../src/cycle/engine';
import { ENGINE_FACTS } from '../../../src/engine/facts';
import { AMBIENT, DEF, groundIdle, leverStates } from './lib/states';

const model = createSoundModel(DEF);
const idle = groundIdle();
const inputs = (over: Partial<SoundInputs> = {}): SoundInputs => ({
  cycle: idle,
  ambient: AMBIENT,
  thetaRad: Math.PI / 2,
  surgeCycles: 0,
  ...over,
});

describe('the voice table (from the definition)', () => {
  const tones = toneVoices(DEF);
  const fanRow = DEF.bladeRows.find((r) => r.id === 'fan');

  it('voices the fan blade-pass tone and three harmonics at the published 24 blades', () => {
    const fan = tones.filter((t) => t.group === 'fan');
    expect(fan.map((t) => t.order)).toEqual([24, 48, 72, 96]);
    expect(fan.every((t) => t.spool === 'lp' && t.row?.count === 24)).toBe(true);
    expect(fan[0]?.row?.confidence).toBe('published');
    expect(fanRow?.count).toBe(ENGINE_FACTS.fanBladeCount.si);
  });

  it('voices the buzz-saw engine orders 1 .. B_fan - 1 (A2)', () => {
    const eo = tones.filter((t) => t.group === 'buzzSaw');
    expect(eo.map((t) => t.order)).toEqual(Array.from({ length: 23 }, (_, k) => k + 1));
    expect(eo.every((t) => t.row === null && t.spool === 'lp')).toBe(true);
  });

  it("voices the booster's first rotor, the HPC's first three and the LPT's last, counts from the definition (estimates)", () => {
    const row = (id: string) => DEF.bladeRows.find((r) => r.id === id);
    const pick = (g: string) => tones.filter((t) => t.group === g);
    expect(pick('booster').map((t) => [t.row?.id, t.order])).toEqual([
      ['booster-r1', row('booster-r1')?.count],
    ]);
    expect(pick('hpc').map((t) => [t.row?.id, t.order, t.spool])).toEqual(
      ['hpc-r1', 'hpc-r2', 'hpc-r3'].map((id) => [id, row(id)?.count, 'hp']),
    );
    expect(pick('lpt').map((t) => [t.row?.id, t.order])).toEqual([
      ['lpt-r4', row('lpt-r4')?.count],
    ]);
    for (const t of [...pick('booster'), ...pick('hpc'), ...pick('lpt')])
      expect(t.row?.confidence).toBe('estimate');
  });

  it('voices the starter at harmonics of its turbine speed: N2 x the estimated speed ratio', () => {
    const st = tones.filter((t) => t.group === 'starter');
    expect(st.map((t) => t.harmonic)).toEqual([1, 2, 3, 4]);
    for (const t of st) {
      expect(t.spool).toBe('hp');
      expect(t.order).toBeCloseTo(t.harmonic * STARTER_SPEED_RATIO, 12);
    }
    expect(STARTER_SPEED_RATIO).toBe(ENGINE_FACTS.starterSpeedRatio.si);
    expect(ENGINE_FACTS.starterSpeedRatio.confidence).toBe('unknown');
  });

  it('every tone is order x its shaft frequency, N/60', () => {
    for (const t of tones) {
      const n = t.spool === 'lp' ? 4321 : 12_345;
      expect(toneFrequencyHz(t, 4321, 12_345)).toBeCloseTo((t.order * n) / 60, 9);
    }
    expect(new Set(tones.map((t) => t.id)).size).toBe(tones.length);
    for (const g of new Set([...tones.map((t) => t.group), ...NOISE_VOICES.map((v) => v.group)]))
      expect(VOICE_GROUPS).toContain(g);
  });
});

describe('frames', () => {
  const tones = toneVoices(DEF);

  it('a silent frame is valid and silent; a broken one is named', () => {
    const f = silentFrame(tones.length, NOISE_VOICES.length);
    expect(validateFrame(f, tones.length, NOISE_VOICES.length)).toEqual([]);
    expect(f.toneAmp.every((a) => a === 0) && f.noiseAmp.every((a) => a === 0)).toBe(true);
    const bad = { ...f, toneHz: [Number.NaN, ...f.toneHz.slice(1)], master: -1 };
    const problems = validateFrame(bad, tones.length, NOISE_VOICES.length);
    expect(problems.join(' ')).toMatch(/toneHz\[0\]/);
    expect(problems.join(' ')).toMatch(/master/);
    expect(validateFrame(f, tones.length + 1, NOISE_VOICES.length).join(' ')).toMatch(/tone/);
  });

  it('the frame of a cycle state is valid at every operating point and angle', () => {
    for (const s of [idle, ...leverStates([0.5, 1], 4)])
      for (const deg of [0, 45, 90, 150, 180]) {
        const f = engineSoundFrame(model, inputs({ cycle: s, thetaRad: (deg * Math.PI) / 180 }));
        expect(validateFrame(f, tones.length, NOISE_VOICES.length)).toEqual([]);
        expect(f.master).toBeGreaterThan(0);
      }
  });

  it('maskFrame keeps only the asked groups (tones, noise and events)', () => {
    const f = engineSoundFrame(model, inputs({ cycle: { ...idle, ignitersOn: true } }));
    const m = maskFrame(f, tones, ['fan']);
    tones.forEach((t, i) => {
      if (t.group === 'fan') expect(m.toneAmp[i]).toBe(f.toneAmp[i]);
      else expect(m.toneAmp[i]).toBe(0);
    });
    expect(m.noiseAmp.every((a) => a === 0)).toBe(true);
    expect(m.sparkAmp).toBe(0);
    expect(m.bangAmp).toBe(0);
    const j = maskFrame(f, tones, ['jet', 'igniter']);
    NOISE_VOICES.forEach((v, i) => {
      expect(j.noiseAmp[i]).toBe(v.group === 'jet' ? f.noiseAmp[i] : 0);
    });
    expect(j.sparkAmp).toBe(f.sparkAmp);
  });

  it('passes the event state through: igniters, their rate, the surge count', () => {
    const on = engineSoundFrame(
      model,
      inputs({ cycle: { ...idle, ignitersOn: true }, surgeCycles: 7 }),
    );
    expect(on.ignitersOn).toBe(true);
    expect(on.sparkRateHz).toBe(IGNITER_SPARK_RATE_HZ);
    expect(IGNITER_SPARK_RATE_HZ).toBe(ENGINE_FACTS.igniterSparkRate.si);
    expect(on.surgeCycles).toBe(7);
    const off = engineSoundFrame(model, inputs({ cycle: { ...idle, ignitersOn: false } }));
    expect(off.ignitersOn).toBe(false);
  });

  it('the starter voices sound only while the starter is engaged', () => {
    const st = tones.flatMap((t, i) => (t.group === 'starter' ? [i] : []));
    const on = engineSoundFrame(model, inputs({ cycle: { ...idle, starterEngaged: true } }));
    const off = engineSoundFrame(model, inputs({ cycle: { ...idle, starterEngaged: false } }));
    expect(st.every((i) => (on.toneAmp[i] ?? 0) > 0)).toBe(true);
    expect(st.every((i) => off.toneAmp[i] === 0)).toBe(true);
  });

  it('a stopped engine is silent but still a valid frame', () => {
    const stopped = createSoundModel(DEF);
    const s = {
      ...idle,
      n1Rpm: 0,
      n2Rpm: 0,
      n1Percent: 0,
      n2Percent: 0,
      fuelFlowKgPerS: 0,
      combustorLit: false,
      stations: Object.fromEntries(
        Object.entries(idle.stations).map(([k, v]) => [
          k,
          { ...v, ptPa: AMBIENT.pressurePa, ttK: AMBIENT.temperatureK, wKgPerS: 0 },
        ]),
      ) as typeof idle.stations,
    };
    const f = engineSoundFrame(stopped, inputs({ cycle: s }));
    expect(validateFrame(f, tones.length, NOISE_VOICES.length)).toEqual([]);
    expect(f.toneAmp.every((a) => a === 0)).toBe(true);
    expect(f.noiseAmp.every((a) => a === 0)).toBe(true);
  });
});

describe('the physics pieces', () => {
  it("the fan face's annulus and tip radius are the definition's fan row", () => {
    const fan = DEF.bladeRows.find((r) => r.id === 'fan');
    const rt = fan?.leadingEdge.tip.r ?? 0;
    const rh = fan?.leadingEdge.hub.r ?? 0;
    expect(fanTipRadiusM(DEF)).toBe(rt);
    expect(fanTipRadiusM(DEF)).toBeCloseTo(ENGINE_FACTS.fanDiameter.si / 2, 3);
    expect(fanFaceAnnulusM2(DEF)).toBeCloseTo(Math.PI * (rt * rt - rh * rh), 12);
  });

  it('the fan-face axial Mach inverts the mass-flow function; no flow is Mach 0', () => {
    expect(fanFaceAxialMach(0, 101_325, 288.15, 1.7)).toBe(0);
    const m = fanFaceAxialMach(359, 101_325, 288.15, 1.718);
    expect(m).toBeGreaterThan(0.55);
    expect(m).toBeLessThan(0.7);
    // more flow than the annulus can pass is held at the choke (Mach 1)
    expect(fanFaceAxialMach(5000, 101_325, 288.15, 1.718)).toBe(1);
  });

  it("a jet stream is the cycle's own nozzle exit: velocity, density, area", () => {
    const [to] = leverStates([1], 6);
    if (to === undefined) throw new Error('no state');
    const st = to.stations['8'];
    const n = nozzle(st.ptPa, st.ttK, st.fuelAirRatio, AMBIENT.pressurePa);
    const j = jetStream(st, AMBIENT.pressurePa, ENGINE_FACTS.coreNozzleArea.si);
    expect(j.velocity).toBe(n.velocity);
    expect(j.density).toBeCloseTo(n.flux / n.velocity, 12);
    expect(j.areaM2).toBe(ENGINE_FACTS.coreNozzleArea.si);
    expect(j.diameterM).toBeCloseTo(Math.sqrt((4 * j.areaM2) / Math.PI), 12);
    const still = jetStream({ ...st, ptPa: AMBIENT.pressurePa }, AMBIENT.pressurePa, 0.2);
    expect(still.velocity).toBe(0);
    expect(still.density).toBeGreaterThan(0);
  });

  it("Lighthill's power: U^8 up to the ambient sound speed, then U^3, continuous; rho_j^2 and A", () => {
    const a = 340;
    const p = (u: number, r = 1.2, area = 1) => lighthillPower(u, r, 1.2, a, area);
    expect(p(200) / p(100)).toBeCloseTo(2 ** 8, 9);
    expect(p(680) / p(340)).toBeCloseTo(2 ** 3, 9);
    expect(p(340 * (1 + 1e-9)) / p(340)).toBeCloseTo(1, 6);
    expect(p(200, 0.6) / p(200, 1.2)).toBeCloseTo(0.25, 12);
    expect(p(200, 1.2, 2) / p(200)).toBeCloseTo(2, 12);
    expect(p(0)).toBe(0);
  });

  it('the buzz-saw starts at relative tip Mach 1 and its engine orders share a fixed spectrum', () => {
    expect(BUZZ_SAW_ONSET_MACH).toBe(1);
    expect(buzzSawLevelDb(0.99)).toBe(Number.NEGATIVE_INFINITY);
    expect(buzzSawLevelDb(1)).toBe(Number.NEGATIVE_INFINITY);
    expect(buzzSawLevelDb(1.02)).toBeLessThan(buzzSawLevelDb(1.05));
    expect(buzzSawLevelDb(1.05)).toBeLessThanOrEqual(buzzSawLevelDb(1.4));
    const shape = buzzSawShape(24);
    expect(shape.length).toBe(23);
    expect(shape.reduce((s, a) => s + a * a, 0)).toBeCloseTo(1, 12);
    expect(shape.every((a) => a > 0)).toBe(true);
    expect(buzzSawShape(24)).toEqual(shape);
  });

  it('directivity: the fan tones forward, the jet aft at its peak angle', () => {
    const deg = (d: number) => (d * Math.PI) / 180;
    expect(fanDirectivity(deg(45))).toBeGreaterThan(fanDirectivity(deg(150)));
    expect(JET_PEAK_DEG).toBe(150);
    expect(jetLargeScaleDirectivity(deg(150))).toBeCloseTo(1, 12);
    expect(jetLargeScaleDirectivity(deg(90))).toBeLessThan(0.1);
    for (let d = 0; d <= 180; d += 5) {
      expect(fanDirectivity(deg(d))).toBeGreaterThan(0);
      expect(jetLargeScaleDirectivity(deg(d))).toBeGreaterThan(0);
    }
  });

  it("the listener's angle is taken from the inlet axis about a point on the engine axis", () => {
    const x0 = listenerReferenceX(DEF);
    expect(listenerAngle([x0 - 5, 0, 0], DEF)).toBeCloseTo(0, 12);
    expect(listenerAngle([x0, 0, 5], DEF)).toBeCloseTo(Math.PI / 2, 12);
    expect(listenerAngle([x0, -3, 0], DEF)).toBeCloseTo(Math.PI / 2, 12);
    expect(listenerAngle([x0 + 4, 4, 0], DEF)).toBeCloseTo((3 * Math.PI) / 4, 12);
    expect(listenerAngle([x0 + 5, 0, 0], DEF)).toBeCloseTo(Math.PI, 12);
    expect(listenerAngle([x0, 0, 0], DEF)).toBeCloseTo(Math.PI / 2, 12);
    // the default three-quarter-front camera is in the forward arc
    expect(listenerAngle([-3.7, 0.75, 3.35], DEF)).toBeLessThan(Math.PI / 4);
  });

  it('the reference point is the middle of the flowpath, between the fan face and the core nozzle', () => {
    const x2 = DEF.stations.find((s) => s.id === '2')?.x ?? Number.NaN;
    const x8 = DEF.stations.find((s) => s.id === '8')?.x ?? Number.NaN;
    expect(listenerReferenceX(DEF)).toBeCloseTo((x2 + x8) / 2, 12);
  });
});
