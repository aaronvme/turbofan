// @vitest-environment happy-dom
// The HUD's engine-sound controls (D5-4, A6's HUD rows): off by default, a labelled switch and a
// labelled volume slider, both keyboard-operable; the switch starts the sound controller only on
// the viewer's action (no AudioContext before it), stops it again, and the volume reaches it.
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SoundController } from '../../../src/audio/worklet/engineSound';
import { Overlay } from '../../../src/ui/App';
import { SoundControls } from '../../../src/ui/sound';
import { DEFAULT_SOUND, useApp } from '../../../src/ui/store';
import { mount, snapshotOf } from './fixtures';

const initial = useApp.getState();

function fakeController() {
  return {
    enable: vi.fn<(volume: number) => Promise<void>>(() => Promise.resolve()),
    disable: vi.fn<() => void>(),
    setVolume: vi.fn<(v: number) => void>(),
    analyser: null,
    context: null,
  } satisfies SoundController;
}

// any AudioContext built while the overlay renders would be a call of this
let audioContext = vi.fn();
beforeEach(() => {
  useApp.setState(initial, true);
  audioContext = vi.fn();
  vi.stubGlobal('AudioContext', audioContext);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('the sound controls', { timeout: 120_000 }, () => {
  it('are off by default, labelled, and the overlay builds no AudioContext', () => {
    expect(DEFAULT_SOUND.on).toBe(false);
    mount(snapshotOf());
    render(<Overlay />);
    const sw = screen.getByRole('switch', { name: 'Sound' });
    expect(sw.getAttribute('aria-checked')).toBe('false');
    expect(screen.getByRole('slider', { name: 'Volume' })).toBeTruthy();
    expect(audioContext).not.toHaveBeenCalled();
  });

  it('the switch starts and stops the controller; the state says so', async () => {
    const c = fakeController();
    render(<SoundControls controller={() => c} />);
    const sw = screen.getByRole('switch', { name: 'Sound' });
    await userEvent.click(sw);
    expect(c.enable).toHaveBeenCalledTimes(1);
    expect(c.enable).toHaveBeenCalledWith(DEFAULT_SOUND.volume);
    expect(useApp.getState().sound.on).toBe(true);
    expect(useApp.getState().sound.status).toBe('on');
    expect(sw.getAttribute('aria-checked')).toBe('true');
    await userEvent.click(sw);
    expect(c.disable).toHaveBeenCalledTimes(1);
    expect(useApp.getState().sound.on).toBe(false);
    expect(useApp.getState().sound.status).toBe('off');
  });

  it('is keyboard-operable: Space on the switch, arrows on the slider', async () => {
    const c = fakeController();
    render(<SoundControls controller={() => c} />);
    const sw = screen.getByRole('switch', { name: 'Sound' });
    sw.focus();
    await userEvent.keyboard(' ');
    expect(c.enable).toHaveBeenCalledTimes(1);
    const vol = screen.getByRole('slider', { name: 'Volume' });
    const before = useApp.getState().sound.volume;
    vol.focus();
    await userEvent.keyboard('{ArrowLeft}');
    const after = useApp.getState().sound.volume;
    expect(after).toBeLessThan(before);
    expect(c.setVolume).toHaveBeenLastCalledWith(after);
  });

  it('a controller that fails to start is reported, and the switch goes back off', async () => {
    const c = fakeController();
    c.enable.mockRejectedValueOnce(new Error('no AudioWorklet'));
    render(<SoundControls controller={() => c} />);
    await userEvent.click(screen.getByRole('switch', { name: 'Sound' }));
    await act(async () => {
      await Promise.resolve();
    });
    const s = useApp.getState().sound;
    expect(s.on).toBe(false);
    expect(s.status).toBe('failed');
    expect(s.error).toMatch(/no AudioWorklet/);
    expect(screen.getByRole('switch', { name: 'Sound' }).getAttribute('title')).toMatch(
      /no AudioWorklet/,
    );
  });

  it("the viewer's sound settings survive a new worker session", () => {
    act(() => {
      useApp.getState().setSound({ volume: 0.3 });
      useApp.getState().resetSession();
    });
    expect(useApp.getState().sound.volume).toBe(0.3);
  });
});
