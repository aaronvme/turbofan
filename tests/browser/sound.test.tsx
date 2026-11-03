// The engine sound in the installed Chrome (D5-4, A6's browser rows): <App/> on the real worker
// and cycle model. No AudioContext exists before the viewer's click; the Sound switch starts the
// AudioWorklet; the output (an AnalyserNode after the volume) is finite, under the limiter's
// ceiling and not silent; the volume and the switch (mute) reach the output; the real worklet
// module renders the snapshot's frame in an OfflineAudioContext; and nothing logs an error. The
// volume is held low (10-30 %) so the run is quiet.
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { commands, page, userEvent } from 'vitest/browser';
import processorUrl from '../../src/audio/worklet/processor.ts?worker&url';
import { LIMITER_CEILING_DB, dbToGain } from '../../src/audio/dsp';
import {
  NOISE_VOICES,
  SYNTH_PROCESSOR_NAME,
  volumeGain,
  type SoundFrame,
  type SynthMessage,
  type SynthProcessorOptions,
} from '../../src/audio/params';
import { createSoundModel, engineSoundFrame, soundInputsOf } from '../../src/audio/sources';
import { THRESHOLDS } from '../../src/contracts/thresholds';
import { ENGINE_DEFINITION } from '../../src/engine/definition';
import { App } from '../../src/ui/App';
import { engineSound } from '../../src/ui/sound';
import { useApp } from '../../src/ui/store';
import '../../src/ui/global.css';

const A6 = THRESHOLDS.A6.values;
const CEILING = dbToGain(-A6.peakDbBelowFullScale.value);

// every AudioContext the page builds is counted (the controller builds it at the click)
const RealAudioContext = window.AudioContext;
let built = 0;
class CountingAudioContext extends RealAudioContext {
  constructor(o?: AudioContextOptions) {
    super(o);
    built++;
  }
}
window.AudioContext = CountingAudioContext;

const errors: string[] = [];
const consoleError = console.error.bind(console);
console.error = (...a: unknown[]) => {
  errors.push(a.map(String).join(' '));
  consoleError(...a);
};
window.addEventListener('error', (e) => errors.push(`error: ${e.message}`));
window.addEventListener('unhandledrejection', (e) => {
  errors.push(`unhandled rejection: ${String(e.reason)}`);
});

const sleep = (ms: number) =>
  new Promise<void>((r) => {
    setTimeout(r, ms);
  });

async function until(what: string, pred: () => boolean, timeoutMs = 60_000): Promise<void> {
  const t0 = performance.now();
  while (!pred()) {
    const c = useApp.getState().connection;
    if (c.state === 'failed' || c.state === 'lost' || c.state === 'unsupported')
      throw new Error(`${what}: the app stopped (${c.state}: ${c.message})`);
    if (performance.now() - t0 > timeoutMs) throw new Error(`${what}: not within ${timeoutMs} ms`);
    await sleep(50);
  }
}

/** The analyser's RMS and peak over a few reads 60 ms apart. */
async function listen(
  a: AnalyserNode,
  reads = 5,
): Promise<{ rms: number; peak: number; finite: boolean }> {
  const buf = new Float32Array(a.fftSize);
  let s = 0;
  let n = 0;
  let peak = 0;
  let finite = true;
  for (let r = 0; r < reads; r++) {
    a.getFloatTimeDomainData(buf);
    for (const x of buf) {
      if (!Number.isFinite(x)) finite = false;
      s += x * x;
      n++;
      peak = Math.max(peak, Math.abs(x));
    }
    await sleep(60);
  }
  return { rms: Math.sqrt(s / n), peak, finite };
}

const fresh = useApp.getState();
let frame: SoundFrame | null = null;

afterEach(() => {
  cleanup();
});

describe('the engine sound (real Chrome)', () => {
  it('starts only on the switch; the output is finite and bounded; volume and mute work', async () => {
    useApp.setState(fresh, true);
    render(<App />);
    await until('ready and a snapshot', () => {
      const s = useApp.getState();
      return s.connection.state === 'running' && s.snapshot !== null && s.listener !== null;
    });
    await sleep(1000);
    expect(built, 'no AudioContext before the click').toBe(0);
    const sw = page.getByRole('switch', { name: 'Sound' });
    await expect.element(sw).toHaveAttribute('aria-checked', 'false');
    // quiet: the volume to 10 % with the keyboard, before the sound is on
    const vol = page.getByRole('slider', { name: 'Volume' });
    (vol.element() as HTMLInputElement).focus();
    await userEvent.keyboard('{Home}{ArrowRight}{ArrowRight}');
    expect(useApp.getState().sound.volume).toBeCloseTo(0.1, 9);
    expect(built).toBe(0);

    await sw.click();
    await until('the sound on', () => useApp.getState().sound.status === 'on', 15_000);
    await expect.element(sw).toHaveAttribute('aria-checked', 'true');
    expect(built).toBe(1);
    const c = engineSound();
    expect(c.context?.state).toBe('running');
    const a = c.analyser;
    if (a === null) throw new Error('no analyser');
    await sleep(1500);
    const quiet = await listen(a);
    expect(quiet.finite).toBe(true);
    expect(quiet.rms, 'the engine at ground idle is heard').toBeGreaterThan(0);
    expect(quiet.peak).toBeLessThanOrEqual(CEILING * volumeGain(0.1) * 1.001);

    // louder: 30 % is 9 x the gain of 10 % (square law), within the noise of a steady idle
    await userEvent.keyboard('{ArrowRight}{ArrowRight}{ArrowRight}{ArrowRight}');
    expect(useApp.getState().sound.volume).toBeCloseTo(0.3, 9);
    await sleep(400);
    const loud = await listen(a);
    expect(loud.finite).toBe(true);
    expect(loud.rms / quiet.rms).toBeGreaterThan(5);
    expect(loud.rms / quiet.rms).toBeLessThan(16);
    expect(loud.peak).toBeLessThanOrEqual(CEILING * volumeGain(0.3) * 1.001);

    // capture the state's frame for the offline render below
    const s = useApp.getState();
    const inputs = soundInputsOf(s.snapshot, s.diagnostics, s.listener, ENGINE_DEFINITION);
    if (inputs === null) throw new Error('no inputs');
    frame = engineSoundFrame(createSoundModel(ENGINE_DEFINITION), inputs);

    // a look at the dock with the sound on (reports/audio, ignored)
    const shot = await page.screenshot({ save: false });
    await commands.writeFile('reports/audio/hud-sound-on.png', shot, 'base64');

    // mute: the switch off fades the output to nothing, then suspends the context
    await sw.click();
    expect(useApp.getState().sound.status).toBe('off');
    await sleep(150);
    const muted = await listen(a, 2);
    expect(muted.rms).toBeLessThan(1e-3 * quiet.rms);
    await sleep(400);
    expect(c.context?.state).toBe('suspended');

    // on again: the same context, resumed
    await sw.click();
    await until('the sound on again', () => useApp.getState().sound.status === 'on', 15_000);
    expect(built).toBe(1);
    expect(c.context?.state).toBe('running');
    await sleep(600);
    const again = await listen(a);
    expect(again.rms).toBeGreaterThan(0.2 * loud.rms);
    await sw.click();
    await sleep(500);
    expect(errors).toEqual([]);
  });

  it("the real worklet renders the snapshot's frame offline: finite, under -1 dBFS, not silent", async () => {
    if (frame === null) throw new Error('the first test captured no frame');
    const fs = 48_000;
    const off = new OfflineAudioContext(2, fs, fs);
    await off.audioWorklet.addModule(processorUrl);
    const processorOptions: SynthProcessorOptions = {
      toneCount: frame.toneHz.length,
      noiseCount: NOISE_VOICES.length,
      seed: 1,
    };
    const node = new AudioWorkletNode(off, SYNTH_PROCESSOR_NAME, {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      processorOptions,
    });
    node.connect(off.destination);
    const msg: SynthMessage = { type: 'frame', frame, rampFrames: 0 };
    node.port.postMessage(msg);
    await sleep(200);
    const buf = await off.startRendering();
    for (let ch = 0; ch < 2; ch++) {
      const y = buf.getChannelData(ch);
      let peak = 0;
      let s = 0;
      let finite = true;
      for (const x of y) {
        if (!Number.isFinite(x)) finite = false;
        peak = Math.max(peak, Math.abs(x));
        s += x * x;
      }
      expect(finite).toBe(true);
      expect(20 * Math.log10(peak)).toBeLessThanOrEqual(LIMITER_CEILING_DB + 1e-6);
      expect(Math.sqrt(s / y.length)).toBeGreaterThan(0);
    }
    expect(errors).toEqual([]);
  });
});
