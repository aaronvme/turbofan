// A6 (PHYSICS.md 3.6, D5-4), its Node rows: 60 s of a scripted transient (a start from shutdown,
// then from ground idle a take-off, an injected surge, a flameout and the auto relight) on the
// reference cycle model, posted at 20 Hz with the camera swinging round the engine, rendered by the
// worklet's synth with every voice: finite, no denormals, peaks at or under -1 dBFS through the
// final limiter. Then the DSP's cost per 128-frame quantum (indicative: wall clock, shared machine).
import { beforeAll, describe, expect, it } from 'vitest';
import { ISA_SLS } from '../../../src/contracts/ambient';
import { THRESHOLDS } from '../../../src/contracts/thresholds';
import { NOISE_VOICES, toneVoices, type SoundFrame } from '../../../src/audio/params';
import { QUANTUM_FRAMES, renderStream, type TimedFrame } from '../../../src/audio/render';
import { createSoundModel, engineSoundFrame } from '../../../src/audio/sources';
import { EngineSynth } from '../../../src/audio/synth';
import { createCycleModel } from '../../../src/cycle/model';
import { factValue } from '../../../src/engine/facts';
import { peakAbs } from './lib/analysis';
import { AMBIENT, DEF, runInputs } from './lib/states';

const A6 = THRESHOLDS.A6.values;
const FS = 48_000;
const DT = 0.05;
const POST = Math.round(DT * FS);
const model = createSoundModel(DEF);
const tones = toneVoices(DEF);
const opts = { sampleRate: FS, toneCount: tones.length, noiseCount: NOISE_VOICES.length, seed: 6 };

let stream: TimedFrame[] = [];
let events = { lit: 0, unlit: 0, surge: 0, igniters: 0, starter: 0 };

beforeAll(() => {
  const frames: SoundFrame[] = [];
  const m = createCycleModel();
  const push = (k: number) => {
    const s = m.state();
    const t = k * DT;
    if (s.combustorLit) events.lit++;
    else events.unlit++;
    if (s.flags.surge) events.surge++;
    if (s.ignitersOn) events.igniters++;
    if (s.starterEngaged) events.starter++;
    frames.push(
      engineSoundFrame(model, {
        cycle: s,
        ambient: AMBIENT,
        thetaRad: Math.PI / 2 + 1.4 * Math.sin(t / 7),
        surgeCycles: m.surgeCycles(),
      }),
    );
  };
  // 25 s of a start from shutdown
  m.reset('shutdown', ISA_SLS);
  let fuel = false;
  let k = 0;
  for (; k < 25 / DT; k++) {
    if (m.state().n2Percent >= factValue('startFuelOnN2')) fuel = true;
    m.step(DT, { ...runInputs(0), starter: true, fuelLever: fuel ? 'run' : 'cutoff' });
    push(k);
  }
  // 35 s from ground idle: take-off at 3 s, a surge at 10 s, a flameout at 20 s (auto relight)
  m.reset('groundIdle', ISA_SLS);
  for (let i = 0; i < 35 / DT; i++, k++) {
    const t = i * DT;
    if (i === 10 / DT) m.injectFault('surge');
    if (i === 20 / DT) m.injectFault('flameout');
    m.step(DT, runInputs(t >= 3 ? 1 : 0));
    push(k);
  }
  stream = frames.map((frame, j) => ({ atFrame: j * POST, frame, rampFrames: POST }));
});

describe('A6: safety and cost (Node rows)', () => {
  it('the script is 60 s and holds each event', () => {
    expect(stream.length * DT).toBeCloseTo(A6.transientS.value, 9);
    expect(events.lit).toBeGreaterThan(0);
    expect(events.unlit).toBeGreaterThan(0);
    expect(events.surge).toBeGreaterThan(0);
    expect(events.igniters).toBeGreaterThan(0);
    expect(events.starter).toBeGreaterThan(0);
  });

  it('the output stays finite, has no denormals and peaks at or under -1 dBFS', () => {
    const r = renderStream(stream, stream.length * POST, opts);
    const y = r.samples;
    let finite = true;
    let denormals = 0;
    for (const x of y) {
      if (!Number.isFinite(x)) finite = false;
      if (x !== 0 && Math.abs(x) < 2 ** -126) denormals++;
    }
    expect(finite).toBe(true);
    expect(denormals).toBe(0);
    const peakDb = 20 * Math.log10(peakAbs(y));
    expect(peakDb).toBeLessThanOrEqual(-A6.peakDbBelowFullScale.value);
    // it is not silence: the take-off and the bang are loud
    expect(peakDb).toBeGreaterThan(-20);
    expect(r.synth.faults).toBe(0);
    expect(r.synth.events.bangs).toBeGreaterThanOrEqual(1);
  });

  it('the DSP costs <= 0.4 ms per 128-frame quantum (median; indicative)', () => {
    expect(A6.quantumFrames.value).toBe(QUANTUM_FRAMES);
    const s = new EngineSynth(opts);
    const out = new Float32Array(QUANTUM_FRAMES);
    const ms: number[] = [];
    let next = 0;
    for (let q = 0; q * QUANTUM_FRAMES < stream.length * POST; q++) {
      while (next < stream.length && (stream[next]?.atFrame ?? 0) <= q * QUANTUM_FRAMES) {
        const f = stream[next];
        if (f !== undefined) s.push(f.frame, f.rampFrames);
        next++;
      }
      const t0 = performance.now();
      s.process(out);
      ms.push(performance.now() - t0);
    }
    ms.sort((a, b) => a - b);
    const median = ms[Math.floor(ms.length / 2)] ?? Number.NaN;
    console.log(
      `A6 cost per quantum: median ${(1000 * median).toFixed(1)} us, p99 ${(1000 * (ms[Math.floor(0.99 * ms.length)] ?? 0)).toFixed(1)} us over ${ms.length} quanta`,
    );
    expect(median).toBeLessThanOrEqual(A6.maxQuantumMs.value);
  });
});
