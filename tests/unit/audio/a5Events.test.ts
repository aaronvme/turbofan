// A5 (PHYSICS.md 3.6, D5-4): the events, gated exactly by the cycle state. The reference model
// runs a start from shutdown, a flameout with its auto relight, and an injected surge; its states
// become the frames the main thread would post (20 Hz) and the worklet's synth renders each event
// voice alone. Clicks and bangs are counted in the audio and by the synth.
import { beforeAll, describe, expect, it } from 'vitest';
import { ISA_SLS } from '../../../src/contracts/ambient';
import type { CycleState } from '../../../src/contracts/cycle';
import {
  NOISE_VOICES,
  maskFrame,
  toneVoices,
  type SoundFrame,
  type VoiceGroup,
} from '../../../src/audio/params';
import { QUANTUM_FRAMES, renderStream } from '../../../src/audio/render';
import {
  STARTER_SPEED_RATIO,
  createSoundModel,
  engineSoundFrame,
} from '../../../src/audio/sources';
import { createCycleModel } from '../../../src/cycle/model';
import { factValue } from '../../../src/engine/facts';
import { onsets, peakAbs, rms } from './lib/analysis';
import { AMBIENT, DEF, runInputs } from './lib/states';

/** The cycle-model runs behind the checks take seconds; more under a parallel run. */
const HOOK_TIMEOUT_MS = 120_000;

const FS = 48_000;
const DT = 0.05;
const POST = Math.round(DT * FS);
const model = createSoundModel(DEF);
const tones = toneVoices(DEF);
const rumbleIndex = NOISE_VOICES.findIndex((v) => v.group === 'rumble');

interface Run {
  readonly states: CycleState[];
  readonly surgeCycles: number[];
}

function frames(run: Run): SoundFrame[] {
  return run.states.map((cycle, k) =>
    engineSoundFrame(model, {
      cycle,
      ambient: AMBIENT,
      thetaRad: Math.PI / 2,
      surgeCycles: run.surgeCycles[k] ?? 0,
    }),
  );
}

/** Where the synth applies frame k: the first quantum boundary at or after its post. */
const applied = (k: number) => Math.ceil((k * POST) / QUANTUM_FRAMES) * QUANTUM_FRAMES;

function render(fs: readonly SoundFrame[], keep: readonly VoiceGroup[]) {
  return renderStream(
    fs.map((f, k) => ({
      atFrame: k * POST,
      frame: { ...maskFrame(f, tones, keep), master: 1 },
      rampFrames: POST,
    })),
    fs.length * POST,
    { sampleRate: FS, toneCount: tones.length, noiseCount: NOISE_VOICES.length, seed: 4 },
  );
}

/** [from, to) sample spans over which a predicate of the posted states holds. */
function spans(run: Run, on: (s: CycleState) => boolean): [number, number][] {
  const out: [number, number][] = [];
  let start: number | null = null;
  run.states.forEach((s, k) => {
    if (on(s) && start === null) start = applied(k);
    if (!on(s) && start !== null) {
      out.push([start, applied(k)]);
      start = null;
    }
  });
  if (start !== null) out.push([start, run.states.length * POST]);
  return out;
}

let start: Run;
let relight: Run;
let surge: Run;

beforeAll(() => {
  // a start from shutdown: starter on, fuel and ignition (auto) at the published 25 % N2
  const m = createCycleModel();
  m.reset('shutdown', ISA_SLS);
  let fuel = false;
  start = { states: [], surgeCycles: [] };
  for (let i = 0; i < 45 / DT; i++) {
    if (m.state().n2Percent >= factValue('startFuelOnN2')) fuel = true;
    const s = m.step(DT, { ...runInputs(0), starter: true, fuelLever: fuel ? 'run' : 'cutoff' });
    start.states.push(s);
    start.surgeCycles.push(m.surgeCycles());
  }
  // a flameout at ground idle, relit by the auto ignition
  const r = createCycleModel();
  r.reset('groundIdle', ISA_SLS);
  relight = { states: [], surgeCycles: [] };
  for (let i = 0; i < 15 / DT; i++) {
    if (i === 20) r.injectFault('flameout');
    relight.states.push(r.step(DT, runInputs(0)));
    relight.surgeCycles.push(r.surgeCycles());
  }
  // an injected surge at part power
  const g = createCycleModel();
  g.reset('groundIdle', ISA_SLS);
  for (let i = 0; i < 8 / DT; i++) g.step(DT, runInputs(0.6));
  surge = { states: [], surgeCycles: [] };
  for (let i = 0; i < 4 / DT; i++) {
    if (i === 10) g.injectFault('surge');
    surge.states.push(g.step(DT, runInputs(0.6)));
    surge.surgeCycles.push(g.surgeCycles());
  }
}, HOOK_TIMEOUT_MS);

describe('A5: events', { timeout: 60_000 }, () => {
  it('the scripted runs contain each event (a check of the script)', () => {
    expect(start.states.some((s) => s.starterEngaged)).toBe(true);
    expect(start.states.some((s) => !s.starterEngaged)).toBe(true);
    expect(start.states.some((s) => s.ignitersOn)).toBe(true);
    expect(start.states.some((s) => !s.combustorLit)).toBe(true);
    expect(start.states[start.states.length - 1]?.combustorLit).toBe(true);
    expect(relight.states.some((s) => !s.combustorLit)).toBe(true);
    expect(surge.states.some((s) => s.flags.surge)).toBe(true);
    expect(surge.surgeCycles[surge.surgeCycles.length - 1]).toBeGreaterThanOrEqual(1);
  });

  it('the starter whine is N2 x the estimated starter speed ratio, and only while engaged', () => {
    const st = tones.flatMap((t, i) => (t.group === 'starter' ? [[t, i] as const] : []));
    frames(start).forEach((f, k) => {
      const s = start.states[k];
      if (s === undefined) return;
      for (const [t, i] of st) {
        expect(f.toneHz[i]).toBeCloseTo((t.harmonic * STARTER_SPEED_RATIO * s.n2Rpm) / 60, 9);
        if (s.starterEngaged) expect(f.toneAmp[i]).toBeGreaterThan(0);
        else expect(f.toneAmp[i]).toBe(0);
      }
    });
  });

  it('no igniter click while the igniters are off, and none missing while they are on', () => {
    for (const run of [start, relight, surge]) {
      const fs = frames(run);
      const r = render(fs, ['igniter']);
      const on = spans(run, (s) => s.ignitersOn);
      const period = FS / (fs[0]?.sparkRateHz ?? 1);
      const expected = on.reduce((n, [a, b]) => n + Math.ceil((b - a) / period), 0);
      const amp = fs.find((f) => f.sparkAmp > 0)?.sparkAmp ?? 1;
      const hits = onsets(r.samples, 0.3 * amp, 0.03 * amp);
      console.log(
        `A5 sparks: ${hits.length} heard, ${expected} expected over ${on.length} on-spans`,
      );
      expect(r.synth.events.sparks).toBe(expected);
      expect(hits.length).toBe(expected);
      for (const h of hits) expect(on.some(([a, b]) => h >= a - 48 && h < b)).toBe(true);
    }
  });

  it('no rumble while unlit; while lit its amplitude is proportional to the fuel flow', () => {
    for (const run of [start, relight]) {
      const fs = frames(run);
      const y = render(fs, ['rumble']).samples;
      const unlit = spans(run, (s) => !s.combustorLit);
      expect(unlit.length).toBeGreaterThan(0);
      for (const [a, b] of unlit) {
        // the rumble's last lit value fades out over one posting interval (de-click), then nothing
        const from = a === 0 ? 0 : a + POST;
        if (b > from) expect(peakAbs(y, from, b)).toBe(0);
      }
      const lit = spans(run, (s) => s.combustorLit);
      const [la, lb] = lit[lit.length - 1] ?? [0, 0];
      expect(rms(y, la + POST, lb)).toBeGreaterThan(0);
      const ratios = fs.flatMap((f, k) => {
        const s = run.states[k];
        return s?.combustorLit === true && s.fuelFlowKgPerS > 0
          ? [(f.noiseAmp[rumbleIndex] ?? 0) / s.fuelFlowKgPerS]
          : [];
      });
      expect(ratios.length).toBeGreaterThan(10);
      for (const q of ratios) expect(q / (ratios[0] ?? 1)).toBeCloseTo(1, 12);
    }
  });

  it("one bang per modelled surge cycle (the Greitzer model's count)", () => {
    const fs = frames(surge);
    const r = render(fs, ['surge']);
    const cycles = surge.surgeCycles[surge.surgeCycles.length - 1] ?? 0;
    const amp = fs[0]?.bangAmp ?? 1;
    console.log(`A5 surge: ${cycles} Greitzer cycles, ${r.synth.events.bangs} bangs`);
    expect(r.synth.events.bangs).toBe(cycles);
    expect(onsets(r.samples, 0.4 * amp, 0.05 * amp).length).toBe(cycles);
    // and none in the runs without a surge
    for (const run of [start, relight])
      expect(render(frames(run), ['surge']).synth.events.bangs).toBe(0);
  });
});
