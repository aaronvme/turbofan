// @vitest-environment happy-dom
// D4-91: a switch into a mode whose pipelines are still compiling shows a visible "preparing"
// state over the view (the previous view keeps running: never a freeze), and it goes once the
// worker shows the mode. W2A-N15: SIM STOPPED says what restarts it. W2A-N17: the slow-boot
// message is not carried into the next boot.
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { faultAnnunciations } from '../../../src/hud/annunciators';
import { BOOT_SLOW_MS, Overlay, Status } from '../../../src/ui/App';
import { useApp } from '../../../src/ui/store';
import { diagnosticsOf, mount, snapshotOf } from './fixtures';

const initial = useApp.getState();
beforeEach(() => {
  useApp.setState(initial, true);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

// each snapshot builds the real model at ground idle: a test runtime limit, not a threshold
const TIMEOUT_MS = 120_000;

describe('the preparing view (D4-91)', { timeout: TIMEOUT_MS }, () => {
  it('says which view is being prepared while its pipelines compile', () => {
    const base = diagnosticsOf();
    mount(
      snapshotOf(),
      diagnosticsOf({ view: { mode: 'cutaway', settledFrames: 0, preparing: 'cutaway' } }),
    );
    render(<Overlay />);
    expect(screen.getByRole('status', { name: /preparing the cutaway view/i })).toBeTruthy();
    act(() => {
      useApp.setState({ diagnostics: { ...base, view: { ...base.view, mode: 'cutaway' } } });
    });
    expect(screen.queryByRole('status', { name: /preparing/i })).toBeNull();
  });

  it('shows nothing when the asked view is shown', () => {
    mount(snapshotOf());
    render(<Overlay />);
    expect(screen.queryByRole('status', { name: /preparing/i })).toBeNull();
  });
});

describe('W2A-N22: the background warm-up on screen (Diagnostics)', { timeout: TIMEOUT_MS }, () => {
  it('says how many configurations are warm, what it waits for, and any given up on', () => {
    mount(
      snapshotOf(),
      diagnosticsOf({
        warm: {
          warm: ['realistic', 'realistic+tracers', 'cutaway+tracers'],
          queue: [
            'schlieren',
            'data:mach+tracers',
            'exploded',
            'data:p+tracers',
            'data:rho+tracers',
            'data:t+tracers',
          ],
          frames: 52,
          cpuMaxMs: 41,
          cpuMs: 900,
          slotCpuMaxMs: 210,
          slowest: '',
          gaveUp: ['exploded'],
          suspended: true,
        },
      }),
    );
    useApp.setState({ panels: { ...useApp.getState().panels, diagnostics: true } });
    render(<Overlay />);
    const d = screen.getByRole('region', { name: 'Diagnostics' });
    expect(d.textContent).toMatch(/Boot warm-up \(D4-91\)/);
    expect(d.textContent).not.toMatch(/D4-88/);
    expect(d.textContent).toMatch(/3 of 9 warm/);
    expect(d.textContent).toMatch(/next schlieren/);
    expect(d.textContent).toMatch(/paused \(input\)/);
    expect(d.textContent).toMatch(/given up: exploded/);
  });
});

describe('W2A-N23: the boot warm-up says what it did not finish', { timeout: TIMEOUT_MS }, () => {
  it('counts the boot configurations left to the background', () => {
    const step = (name: string, done: boolean) => ({ name, ms: 900, cpuMs: 300, done });
    mount(
      snapshotOf(),
      diagnosticsOf({
        warmUpSteps: [
          step('realistic (slowest fan 40 ms)', true),
          step('realistic+tracers', false),
        ],
      }),
    );
    useApp.setState({ panels: { ...useApp.getState().panels, diagnostics: true } });
    render(<Overlay />);
    const d = screen.getByRole('region', { name: 'Diagnostics' });
    expect(d.textContent).toMatch(/1 unfinished \(warming in the background\)/);
  });

  it('says nothing more when the boot finished them all', () => {
    mount(
      snapshotOf(),
      diagnosticsOf({ warmUpSteps: [{ name: 'realistic', ms: 900, cpuMs: 300, done: true }] }),
    );
    useApp.setState({ panels: { ...useApp.getState().panels, diagnostics: true } });
    render(<Overlay />);
    expect(screen.getByRole('region', { name: 'Diagnostics' }).textContent).not.toMatch(
      /unfinished/,
    );
  });
});

describe('W2A-N15 and N17', { timeout: TIMEOUT_MS }, () => {
  it('SIM STOPPED says a reload restarts it (a reset does not)', () => {
    const [a] = faultAnnunciations({
      simStopped: 'cycle step failed: x',
      gpuErrors: 0,
      raster: { onFrame: false, lastError: null },
      refused: 0,
    });
    expect(a?.detail).toMatch(/reload/i);
    expect(a?.detail).not.toMatch(/reset/i);
  });

  it('a new boot starts without the last boot’s slow message', () => {
    vi.useFakeTimers();
    render(<Status />);
    act(() => {
      vi.advanceTimersByTime(BOOT_SLOW_MS + 1);
    });
    expect(screen.getByRole('status').textContent).toMatch(/longer than usual/);
    act(() => {
      useApp.getState().receive({ type: 'ready', adapter: 'test' });
    });
    act(() => {
      useApp.setState({ connection: { state: 'booting' } });
    });
    expect(screen.getByRole('status').textContent).not.toMatch(/longer than usual/);
  });
});
