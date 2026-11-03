// The pure parts of the worklet glue (src/audio/params.ts, src/audio/sources.ts): what the main
// thread posts for a snapshot, the glide length from the posting interval, the volume curve.
import { describe, expect, it } from 'vitest';
import {
  MAX_RAMP_S,
  MIN_RAMP_S,
  NOISE_VOICES,
  SYNTH_PROCESSOR_NAME,
  rampFramesFor,
  toneVoices,
  validateFrame,
  volumeGain,
} from '../../../src/audio/params';
import {
  createSoundModel,
  engineSoundFrame,
  listenerAngle,
  soundInputsOf,
} from '../../../src/audio/sources';
import { diagnosticsOf, snapshotOf } from '../ui/fixtures';
import { DEF } from './lib/states';

describe('the worklet glue (pure parts)', { timeout: 120_000 }, () => {
  it('the glide lasts the posting interval, clamped', () => {
    expect(rampFramesFor(50, 48_000)).toBe(2400);
    expect(rampFramesFor(0, 48_000)).toBe(Math.round(MIN_RAMP_S * 48_000));
    expect(rampFramesFor(5000, 48_000)).toBe(Math.round(MAX_RAMP_S * 48_000));
    expect(rampFramesFor(Number.NaN, 44_100)).toBe(Math.round(MIN_RAMP_S * 44_100));
    expect(SYNTH_PROCESSOR_NAME).toBe('engine-synth');
  });

  it('the volume curve is 0 to 1, square-law, clamped', () => {
    expect(volumeGain(0)).toBe(0);
    expect(volumeGain(1)).toBe(1);
    expect(volumeGain(0.5)).toBeCloseTo(0.25, 12);
    expect(volumeGain(-1)).toBe(0);
    expect(volumeGain(3)).toBe(1);
    expect(volumeGain(Number.NaN)).toBe(0);
  });

  it("a snapshot's sound inputs: its cycle and ambient, the listener's angle, the surge count", () => {
    const s = snapshotOf();
    const d = diagnosticsOf({ surgeCycles: 4 });
    const pos = [-3.7, 0.75, 3.35] as const;
    const i = soundInputsOf(s, d, pos, DEF);
    expect(i?.cycle).toBe(s.cycle);
    expect(i?.ambient).toBe(s.inputs.ambient);
    expect(i?.thetaRad).toBe(listenerAngle(pos, DEF));
    expect(i?.surgeCycles).toBe(4);
    // before the first camera pose the listener is to the side; before diagnostics, no surges
    expect(soundInputsOf(s, null, null, DEF)?.thetaRad).toBe(Math.PI / 2);
    expect(soundInputsOf(s, null, null, DEF)?.surgeCycles).toBe(0);
    expect(soundInputsOf(null, d, pos, DEF)).toBeNull();
    const model = createSoundModel(DEF);
    expect(model.tones).toEqual(toneVoices(DEF));
    if (i === null) throw new Error('no inputs');
    const tones = toneVoices(DEF).length;
    expect(validateFrame(engineSoundFrame(model, i), tones, NOISE_VOICES.length)).toEqual([]);
  });
});
