// The HUD's engine-sound controls (D5-4): a switch, off by default, and a volume slider. The
// switch's click is the user gesture the AudioContext needs, so nothing is built before it. The
// controller feeds the worklet from the store's snapshots (src/audio/worklet/engineSound.ts).

import type { KeyboardEvent } from 'react';
import { soundInputsOf } from '../audio/sources';
import { createEngineSound, type SoundController } from '../audio/worklet/engineSound';
import { ENGINE_DEFINITION } from '../engine/definition';
import { useApp } from './store';

let shared: SoundController | null = null;

/** The app's one controller, made on first use; it builds no AudioContext until enabled. */
export function engineSound(): SoundController {
  shared ??= createEngineSound(
    (onInputs) =>
      useApp.subscribe((s, prev) => {
        if (s.snapshot === prev.snapshot) return;
        const i = soundInputsOf(s.snapshot, s.diagnostics, s.listener, ENGINE_DEFINITION);
        if (i !== null) onInputs(i);
      }),
    {
      definition: ENGINE_DEFINITION,
      onError: (message) => {
        useApp.getState().setSound({ on: false, status: 'failed', error: message });
      },
    },
  );
  return shared;
}

const STEP = 0.05;

export function SoundControls({
  controller = engineSound,
}: {
  /** The controller (the app's by default; the unit tests pass a fake). */
  readonly controller?: () => SoundController;
}) {
  const sound = useApp((s) => s.sound);
  const setSound = useApp((s) => s.setSound);
  const toggle = () => {
    if (sound.on) {
      controller().disable();
      setSound({ on: false, status: 'off', error: null });
      return;
    }
    setSound({ on: true, status: 'starting', error: null });
    controller()
      .enable(sound.volume)
      .then(
        () => {
          if (useApp.getState().sound.on) setSound({ status: 'on' });
        },
        (e: unknown) => {
          setSound({
            on: false,
            status: 'failed',
            error: `the sound could not start: ${e instanceof Error ? e.message : String(e)}`,
          });
        },
      );
  };
  const volume = (v: number) => {
    const clamped = Math.round(Math.min(1, Math.max(0, v)) / STEP) * STEP;
    setSound({ volume: clamped });
    controller().setVolume(clamped);
  };
  // the keys a slider takes (WAI-ARIA), handled here so every browser and the tests agree
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    const keys: Readonly<Record<string, number>> = {
      ArrowLeft: sound.volume - STEP,
      ArrowDown: sound.volume - STEP,
      ArrowRight: sound.volume + STEP,
      ArrowUp: sound.volume + STEP,
      PageDown: sound.volume - 4 * STEP,
      PageUp: sound.volume + 4 * STEP,
      Home: 0,
      End: 1,
    };
    const next = keys[e.key];
    if (next === undefined) return;
    e.preventDefault();
    volume(next);
  };
  const pct = Math.round(sound.volume * 100);
  const title =
    sound.error ??
    (sound.on
      ? 'Engine sound: synthesized from the simulated sources (What’s simulated)'
      : 'Engine sound is off');
  return (
    <div className="sound" role="group" aria-label="Engine sound">
      <button
        type="button"
        role="switch"
        className="switch"
        aria-checked={sound.on}
        aria-busy={sound.status === 'starting'}
        aria-label="Sound"
        title={title}
        data-status={sound.status}
        onClick={toggle}
      >
        <span className="knob" aria-hidden="true" />
        Sound
      </button>
      <input
        type="range"
        className="volume"
        min={0}
        max={100}
        step={STEP * 100}
        value={pct}
        aria-label="Volume"
        aria-valuetext={`${pct} %`}
        title={`Volume ${pct} %`}
        onKeyDown={onKey}
        onChange={(e) => {
          volume(Number(e.currentTarget.value) / 100);
        }}
      />
    </div>
  );
}
