// @vitest-environment happy-dom
// W2A-I1: the worker's faults outside the field switch reach the screen, not only the closed
// Diagnostics drawer. The store's message handling (ready, device-lost, fatal, gpu-error, the
// stopped sim, snapshots) and the fault surfaces (Status's boot and fault screens, the
// annunciators' SIM STOPPED warning and the GPU-error, MOCK-raster and refused-command chips) are
// pinned here, so device loss ignored (M13) or a Status that never shows a fault (M14) fail.
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Overlay, Status } from '../../../src/ui/App';
import { useApp } from '../../../src/ui/store';
import { diagnosticsOf, mount, snapshotOf } from './fixtures';

const initial = useApp.getState();
const receive = (m: Parameters<typeof initial.receive>[0]) => {
  act(() => {
    useApp.getState().receive(m);
  });
};

beforeEach(() => {
  useApp.setState(initial, true);
});
afterEach(() => {
  cleanup();
});

// each snapshot builds the real model at ground idle: a test runtime limit, not a threshold
const TIMEOUT_MS = 120_000;

describe('the worker messages in the store (W2A-I1)', { timeout: TIMEOUT_MS }, () => {
  it('ready runs the app on the adapter it names', () => {
    expect(useApp.getState().connection.state).toBe('booting');
    receive({ type: 'ready', adapter: 'intel arc' });
    expect(useApp.getState().connection).toEqual({ state: 'running', adapter: 'intel arc' });
  });

  it('device-lost stops the app with the message (M13)', () => {
    receive({ type: 'ready', adapter: 'intel arc' });
    receive({ type: 'device-lost', message: 'the GPU process crashed' });
    expect(useApp.getState().connection).toEqual({
      state: 'lost',
      message: 'the GPU process crashed',
    });
  });

  it('a fatal message stops the app, whatever it says', () => {
    receive({ type: 'ready', adapter: 'intel arc' });
    receive({ type: 'fatal', message: 'cycle step failed: but posted as a fatal' });
    expect(useApp.getState().connection).toEqual({
      state: 'failed',
      message: 'cycle step failed: but posted as a fatal',
    });
  });

  it('a thrown cycle step stops the sim: the app still renders, but not as a running sim', () => {
    receive({ type: 'ready', adapter: 'intel arc' });
    expect(useApp.getState().simStopped).toBeNull();
    receive({ type: 'sim-stopped', message: 'cycle step failed: TypeError: x is undefined' });
    const s = useApp.getState();
    expect(s.simStopped).toBe('cycle step failed: TypeError: x is undefined');
    // the worker keeps rendering the frozen state: the connection is still up
    expect(s.connection.state).toBe('running');
  });

  it('GPU errors are kept (the last 8) and counted (all of them)', () => {
    for (let k = 0; k < 10; k++) receive({ type: 'gpu-error', message: `validation: #${k}` });
    const s = useApp.getState();
    expect(s.gpuErrorCount).toBe(10);
    expect(s.gpuErrors).toHaveLength(8);
    expect(s.gpuErrors.at(-1)).toBe('validation: #9');
    // a GPU validation error is not a stopped app
    expect(s.connection.state).toBe('booting');
  });

  it('a snapshot replaces the snapshot and the diagnostics, extends the trails and keeps the refused', () => {
    const snapshot = snapshotOf();
    const diagnostics = diagnosticsOf();
    const msg = { type: 'snapshot', snapshot, diagnostics, anchors: [] } as const;
    receive({ ...msg, refused: ['seq 3 is not after the last applied seq 4'] });
    receive({ ...msg, refused: [] });
    const s = useApp.getState();
    expect(s.snapshot).toBe(snapshot);
    expect(s.diagnostics).toBe(diagnostics);
    expect(s.trails.fan).toHaveLength(1);
    expect(s.refused).toEqual(['seq 3 is not after the last applied seq 4']);
  });
});

describe('Status: the boot and the fault screens (M14)', () => {
  it('shows the spinner while booting and nothing once running', () => {
    const { container, rerender } = render(<Status />);
    expect(screen.getByRole('status').textContent).toMatch(/Starting the GPU/);
    act(() => {
      useApp.setState({ connection: { state: 'running', adapter: 'intel arc' } });
    });
    rerender(<Status />);
    expect(container.textContent).toBe('');
  });

  for (const [state, title] of [
    ['lost', 'The GPU device was lost'],
    ['failed', 'The simulation stopped'],
    ['unsupported', 'WebGPU is required'],
  ] as const)
    it(`shows a fault with its message when the connection is ${state}`, () => {
      useApp.setState({ connection: { state, message: `why it is ${state}` } });
      render(<Status />);
      const alert = screen.getByRole('alert');
      expect(within(alert).getByRole('heading', { name: title })).toBeTruthy();
      expect(alert.textContent).toContain(`why it is ${state}`);
      expect(within(alert).getByRole('button', { name: 'Reload' })).toBeTruthy();
    });
});

describe('the faults on screen, outside the drawer (W2A-I1)', { timeout: TIMEOUT_MS }, () => {
  it('a stopped sim is a warning with its message, and the clock no longer offers pause', () => {
    mount(snapshotOf());
    useApp.setState({ simStopped: 'cycle step failed: TypeError: x is undefined' });
    render(<Overlay />);
    const ann = screen.getByRole('status', { name: 'Annunciators' });
    expect(within(ann).getByText('SIM STOPPED')).toBeTruthy();
    expect(within(ann).getByText(/cycle step failed: TypeError: x is undefined/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Pause' })).toHaveProperty('disabled', true);
    expect(screen.getByLabelText('Simulated time').textContent).toMatch(/stopped/);
  });

  it('a running sim shows no stop and offers pause', () => {
    mount(snapshotOf());
    render(<Overlay />);
    expect(screen.queryByText('SIM STOPPED')).toBeNull();
    expect(screen.getByRole('button', { name: 'Pause' })).toHaveProperty('disabled', false);
  });

  it('GPU errors show a caution chip with the count, which opens the Diagnostics drawer', async () => {
    mount(snapshotOf());
    render(<Overlay />);
    expect(screen.queryByRole('button', { name: /GPU ERRORS/ })).toBeNull();
    receive({ type: 'gpu-error', message: 'validation: the bind group is invalid' });
    receive({ type: 'gpu-error', message: 'out-of-memory: the texture' });
    const ann = screen.getByRole('status', { name: 'Annunciators' });
    const chip = within(ann).getByRole('button', { name: 'GPU ERRORS (2)' });
    expect(chip.getAttribute('data-level')).toBe('caution');
    expect(screen.queryByRole('region', { name: 'Diagnostics' })).toBeNull();
    await userEvent.click(chip);
    const d = screen.getByRole('region', { name: 'Diagnostics' });
    expect(within(d).getByText('validation: the bind group is invalid')).toBeTruthy();
  });

  it('a MOCK raster on the frame (its worker failed) is a caution that says why', () => {
    const why = 'MOCK raster worker failed (script error): rasterizing on the frame';
    mount(snapshotOf(), diagnosticsOf({ raster: { onFrame: true, lastError: why } }));
    render(<Overlay />);
    const ann = screen.getByRole('status', { name: 'Annunciators' });
    const chip = within(ann).getByRole('button', { name: 'MOCK RASTER ON FRAME' });
    expect(chip.getAttribute('data-level')).toBe('caution');
    expect(chip.getAttribute('title')).toBe(why);
  });

  it('a failed MOCK raster request is a caution with the reason', () => {
    mount(
      snapshotOf(),
      diagnosticsOf({ raster: { onFrame: false, lastError: 'MOCK raster: NaN in the state' } }),
    );
    render(<Overlay />);
    const chip = screen.getByRole('button', { name: 'MOCK RASTER FAILED' });
    expect(chip.getAttribute('title')).toBe('MOCK raster: NaN in the state');
  });

  it('refused commands show an advisory chip with the count', () => {
    mount(snapshotOf());
    useApp.setState({ refused: ['scenario "c12": not available', 'seq 3 is not after 4'] });
    render(<Overlay />);
    const chip = screen.getByRole('button', { name: 'REFUSED (2)' });
    expect(chip.getAttribute('data-level')).toBe('advisory');
  });
});
