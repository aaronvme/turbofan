// @vitest-environment happy-dom
// The overlay in React Testing Library (happy-dom), on a real snapshot of the real cycle model:
// the instruments are meters with values, the controls send the commands the contract names,
// a held gas path and a MOCK fallback are annunciated with their causes (D4-17, W2F-I1, D4-82),
// the field badge and the legend say what the drawn field is, the ledger is the document's,
// and every control has a name.
import { readFileSync } from 'node:fs';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { parseFidelityLedger } from '../../../src/hud/ledger';
import { kelvinToCelsius } from '../../../src/engine/units';
import { Overlay } from '../../../src/ui/App';
import { useApp } from '../../../src/ui/store';
import { diagnosticsOf, mount, RUNNING, sentCommands, snapshotOf } from './fixtures';

afterEach(() => {
  cleanup();
});

const meter = (name: string) => screen.getByRole('meter', { name });
// each snapshot builds the real model at ground idle: a test runtime limit, not a threshold
const TIMEOUT_MS = 120_000;

describe('the overlay (RTL)', { timeout: TIMEOUT_MS }, () => {
  it('the N1, EGT and N2 dials are meters with the snapshot values', () => {
    const s = snapshotOf();
    mount(s);
    render(<Overlay />);
    const n1 = meter('N1');
    expect(Number(n1.getAttribute('aria-valuenow'))).toBeCloseTo(s.cycle.n1Percent, 1);
    expect(n1.getAttribute('aria-valuetext')).toMatch(/^\d+\.\d %$/);
    const egt = meter('EGT');
    expect(Number(egt.getAttribute('aria-valuenow'))).toBeCloseTo(
      kelvinToCelsius(s.cycle.egtDisplayedK),
      0,
    );
    expect(egt.getAttribute('aria-valuetext')).toMatch(/°C$/);
    expect(Number(meter('N2').getAttribute('aria-valuenow'))).toBeCloseTo(s.cycle.n2Percent, 1);
    // ground idle on the real model: a running engine, not zeros
    expect(s.cycle.n2Percent).toBeGreaterThan(55);
  });

  it('the thrust lever sends setThrottle with its travel', () => {
    const post = mount(snapshotOf());
    render(<Overlay />);
    const lever = screen.getByRole('slider', { name: 'Thrust lever' });
    fireEvent.change(lever, { target: { value: '0.6' } });
    expect(sentCommands(post)).toContainEqual({ type: 'setThrottle', lever: 0.6 });
  });

  it('W2A-I5: the lever shows what it sent until the snapshot echoes its seq: quick presses add up', () => {
    const s = snapshotOf();
    const post = mount(s);
    render(<Overlay />);
    const lever = screen.getByRole('slider', { name: 'Thrust lever' }) as HTMLInputElement;
    // an ArrowUp: one step from the value the lever shows now
    const press = () => {
      fireEvent.change(lever, {
        target: { value: String((Math.round(Number(lever.value) * 100) + 1) / 100) },
      });
    };
    press();
    press();
    const levers = () =>
      sentCommands(post).flatMap((c) => (c.type === 'setThrottle' ? [c.lever] : []));
    expect(levers()).toEqual([0.01, 0.02]);
    press();
    press();
    press();
    expect(levers()).toEqual([0.01, 0.02, 0.03, 0.04, 0.05]);
    expect(lever.value).toBe('0.05');
    const seqs = post.mock.calls.flatMap(([m]) => (m.type === 'command' ? [m.message.seq] : []));
    const at = (seq: number, value: number) => {
      act(() => {
        useApp.setState({
          snapshot: { ...s, lastCommandSeq: seq, inputs: { ...s.inputs, throttleLever: value } },
        });
      });
    };
    // a snapshot that has applied only the second press does not pull the lever back
    at(seqs[1] ?? -1, 0.02);
    expect(lever.value).toBe('0.05');
    expect(screen.getByText('lever 5 %')).toBeTruthy();
    // once the echo reaches the last press, the lever shows the sim's own value again
    at(seqs[4] ?? -1, 0.05);
    expect(lever.value).toBe('0.05');
    at((seqs[4] ?? -1) + 1, 0);
    expect(lever.value).toBe('0');
  });

  it('a mode radio and the 1-5 keys send setViewMode', async () => {
    const post = mount(snapshotOf());
    render(<Overlay />);
    const radio = screen.getByRole('radio', { name: /Cutaway/ });
    expect(screen.getByRole('radio', { name: /Realistic/ })).toHaveProperty('checked', true);
    await userEvent.click(radio);
    expect(sentCommands(post)).toContainEqual({ type: 'setViewMode', mode: 'cutaway' });
    fireEvent.keyDown(window, { key: '5' });
    expect(sentCommands(post)).toContainEqual({ type: 'setViewMode', mode: 'data' });
  });

  it('a held gas path shows GAS PATH HELD with its W2F-I1 cause', () => {
    const s = snapshotOf();
    const held = { ...s, cycle: { ...s.cycle, gasPathSolve: { status: 'held', lostSolves: 2 } } };
    mount(held as typeof s, diagnosticsOf({ lostSolveCause: 'residual 3.2e-4 is not below 1e-6' }));
    render(<Overlay />);
    const ann = screen.getByRole('status', { name: 'Annunciators' });
    expect(within(ann).getByText('GAS PATH HELD')).toBeTruthy();
    expect(within(ann).getByText(/residual 3\.2e-4 is not below 1e-6/)).toBeTruthy();
    expect(within(ann).getByText(/2 lost since reset/)).toBeTruthy();
  });

  it("the What's simulated panel renders every row of PHYSICS.md's ledger and expands one", async () => {
    mount(snapshotOf());
    render(<Overlay />);
    await userEvent.click(screen.getByRole('button', { name: "What's simulated" }));
    const panel = screen.getByRole('region', { name: "What's simulated" });
    const rows = parseFidelityLedger(readFileSync('docs/PHYSICS.md', 'utf8'));
    expect(rows.length).toBeGreaterThan(10);
    const items = within(panel).getAllByRole('listitem');
    expect(items).toHaveLength(rows.length);
    const first = rows[0];
    if (first === undefined) throw new Error('no ledger rows');
    const row = within(items[0] as HTMLElement).getByRole('button');
    expect(row.getAttribute('aria-expanded')).toBe('false');
    expect(items[0]?.textContent).not.toContain(first.source);
    await userEvent.click(row);
    expect(row.getAttribute('aria-expanded')).toBe('true');
    // the row's status and source, as the document states them
    expect(items[0]?.textContent).toContain(first.status);
    expect(items[0]?.textContent).toContain(first.source);
  });

  it('every button, switch, radio, slider and select has an accessible name', async () => {
    mount(snapshotOf({ mode: 'data' }));
    render(<Overlay />);
    await userEvent.click(screen.getByRole('button', { name: 'Diagnostics' }));
    await userEvent.click(screen.getByRole('button', { name: "What's simulated" }));
    const unnamed = /^\s*$/;
    for (const role of ['button', 'switch', 'radio', 'slider', 'combobox'] as const)
      expect(screen.queryAllByRole(role, { name: unnamed }), role).toEqual([]);
    expect(screen.getAllByRole('button').length).toBeGreaterThan(20);
  });
});

describe(
  'the texts (W2A-N8) and the conservative defaults (W2A-N3)',
  { timeout: TIMEOUT_MS },
  () => {
    it('names the FADEC limiter in words and the burner state at steady idle', () => {
      mount(snapshotOf());
      render(<Overlay />);
      const engine = screen.getByRole('region', { name: 'Engine display' });
      expect(within(engine).getByText('RUN · idle floor')).toBeTruthy();
      expect(engine.textContent).not.toMatch(/idleFloor/);
      // no start in progress: the readout is the burner's, not "Start lit"
      expect(within(engine).getByText('Burner')).toBeTruthy();
      expect(within(engine).queryByText('Start')).toBeNull();
    });

    it('the diagnostics show a dash, not 0.00 ms, and SOLVER IDLE for a solver that is not drawn', async () => {
      mount(snapshotOf());
      render(<Overlay />);
      await userEvent.click(screen.getByRole('button', { name: 'Diagnostics' }));
      const d = screen.getByRole('region', { name: 'Diagnostics' });
      expect(within(d).getByText('SOLVER IDLE')).toBeTruthy();
      const solverRow = within(d).getByText('Solver', { selector: 'dt' }).parentElement;
      expect(solverRow?.querySelector('dd')?.textContent).toBe('– ms');
    });

    it('a solver field whose link is not known yet is labelled uncoupled in the legend (M8)', () => {
      mount(snapshotOf({ mode: 'data', flow: 'solver' }), diagnosticsOf({ field: null }));
      render(<Overlay />);
      const legend = screen.getByRole('region', { name: 'Flow legend' });
      expect(within(legend).getByText(/solver \(uncoupled until W3\)/)).toBeTruthy();
      expect(legend.textContent).not.toMatch(/coupled\)/);
      expect(
        within(screen.getByRole('group', { name: 'Data provenance' })).getByText(
          'FIELD: solver (uncoupled until W3)',
        ),
      ).toBeTruthy();
    });
  },
);

describe('the compressor maps at ground idle (W2A-I2, D4-87)', { timeout: TIMEOUT_MS }, () => {
  // the charts' plot rectangle in their 300 x 168 viewBox (charts.tsx's margins)
  const inPlot = (c: Element | undefined) => {
    const x = Number(c?.getAttribute('cx'));
    const y = Number(c?.getAttribute('cy'));
    return x >= 40 && x <= 300 - 8 && y >= 10 && y <= 168 - 30;
  };

  it("draws both operating points inside the plots; the fan's margin below its map is dimmed and tagged, not amber", () => {
    mount(snapshotOf());
    render(<Overlay />);
    const maps = screen.getByRole('region', { name: 'Compressor maps' });
    const [fan, hpc] = within(maps).getAllByRole('figure');
    if (fan === undefined || hpc === undefined) throw new Error('no map figures');
    expect(fan.textContent).toMatch(/^Fan/);
    expect(inPlot(fan.querySelector('circle.op') ?? undefined)).toBe(true);
    expect(inPlot(hpc.querySelector('circle.op') ?? undefined)).toBe(true);
    // D4-87: the fan's idle margin is an extrapolation below the map, not a caution
    const sm = within(fan).getByText(/^SM/);
    expect(sm.getAttribute('data-level')).toBe('belowMap');
    expect(sm.className).not.toMatch(/caution|warning/);
    expect(within(fan).getByText('below map')).toBeTruthy();
    expect(fan.querySelector('circle.op')?.getAttribute('data-below-map')).toBe('true');
    expect(within(hpc).getByText(/^SM/).getAttribute('data-level')).toBe('normal');
    expect(within(hpc).queryByText('below map')).toBeNull();
  });
});

describe('the drawn field in the overlay (D4-82)', { timeout: TIMEOUT_MS }, () => {
  it('the field badge and the legend say the solver is uncoupled until W3', () => {
    mount(
      snapshotOf({ mode: 'data', flow: 'solver' }),
      diagnosticsOf({ field: { asked: 'solver', coupling: 'uncoupled', fallback: null } }),
    );
    render(<Overlay />);
    const prov = screen.getByRole('group', { name: 'Data provenance' });
    expect(within(prov).getByText('FIELD: solver (uncoupled until W3)')).toBeTruthy();
    const legend = screen.getByRole('region', { name: 'Flow legend' });
    expect(within(legend).getByText('Mach number')).toBeTruthy();
    expect(within(legend).getByText(/solver \(uncoupled until W3\)/)).toBeTruthy();
  });

  it('a solver that fell back to the MOCK is visible: the badge, the annunciator and the legend say why', () => {
    const why = 'solver lost: GPU device lost: the test removed it';
    mount(
      snapshotOf({ mode: 'cutaway', flow: 'mock' }),
      diagnosticsOf({ field: { asked: 'solver', coupling: 'mock', fallback: why } }),
    );
    render(<Overlay />);
    const prov = screen.getByRole('group', { name: 'Data provenance' });
    expect(within(prov).getByText('FIELD: MOCK fallback')).toBeTruthy();
    const ann = screen.getByRole('status', { name: 'Annunciators' });
    expect(within(ann).getByText(`MOCK FALLBACK: ${why}`)).toBeTruthy();
    const legend = screen.getByRole('region', { name: 'Flow legend' });
    expect(within(legend).getByText(/^MOCK fallback/).textContent).toContain(why);
  });

  it('the asked-for MOCK is labelled MOCK, with no fallback annunciated', () => {
    mount(snapshotOf({ mode: 'cutaway' }));
    render(<Overlay />);
    expect(
      within(screen.getByRole('group', { name: 'Data provenance' })).getByText('FIELD: MOCK'),
    ).toBeTruthy();
    expect(screen.queryByText(/MOCK FALLBACK/)).toBeNull();
    const legend = screen.getByRole('region', { name: 'Flow legend' });
    expect(within(legend).getByText(/^MOCK field/)).toBeTruthy();
  });

  it('the drawn-field switch asks for the solver even when it is not running (the fallback says why)', async () => {
    const post = mount(
      snapshotOf({
        status: { ...RUNNING, status: 'unavailable', error: 'no WebGPU', stats: null },
      }),
    );
    render(<Overlay />);
    await userEvent.click(screen.getByRole('button', { name: 'Diagnostics' }));
    const group = screen.getByRole('group', { name: 'Drawn flow field' });
    const solver = within(group).getByRole('button', { name: 'Solver' });
    expect(solver).toHaveProperty('disabled', false);
    await userEvent.click(solver);
    expect(post).toHaveBeenCalledWith({ type: 'field', source: 'solver' });
    expect(useApp.getState().field).toBe('solver');
  });

  it('the diagnostics name the drawn field and the fallback reason', async () => {
    mount(
      snapshotOf(),
      diagnosticsOf({ field: { asked: 'solver', coupling: 'mock', fallback: 'solver diverged' } }),
    );
    render(<Overlay />);
    await userEvent.click(screen.getByRole('button', { name: 'Diagnostics' }));
    const d = screen.getByRole('region', { name: 'Diagnostics' });
    expect(within(d).getByText(/MOCK fallback .*solver diverged/)).toBeTruthy();
  });
});

describe(
  'the frame cost in the diagnostics (W2F-N5, the off-frame MOCK raster)',
  { timeout: TIMEOUT_MS },
  () => {
    it('shows the worst and the held cycle step and the MOCK raster', async () => {
      const d = diagnosticsOf();
      mount(
        snapshotOf(),
        diagnosticsOf({
          budget: { ...d.budget, cycleCpuMaxMs: 602.1, cycleCpuHeldMs: 551.2, mockRasterMs: 348.1 },
        }),
      );
      render(<Overlay />);
      await userEvent.click(screen.getByRole('button', { name: 'Diagnostics' }));
      const panel = screen.getByRole('region', { name: 'Diagnostics' });
      expect(within(panel).getByText('Held step (W2F-N5)')).toBeTruthy();
      expect(panel.textContent).toContain('551');
      expect(panel.textContent).toContain('worst 602');
      expect(within(panel).getByText('MOCK raster (off frame)')).toBeTruthy();
    });

    it('shows no held row while no frame in the window was held', async () => {
      mount(snapshotOf());
      render(<Overlay />);
      await userEvent.click(screen.getByRole('button', { name: 'Diagnostics' }));
      expect(screen.queryByText('Held step (W2F-N5)')).toBeNull();
    });
  },
);

describe(
  'the view dock (camera presets, tracers, the cut-plane field)',
  { timeout: TIMEOUT_MS },
  () => {
    it('a camera preset button sends the camera message', async () => {
      const post = mount(snapshotOf());
      render(<Overlay />);
      const cam = screen.getByRole('group', { name: 'Camera' });
      await userEvent.click(within(cam).getByRole('button', { name: 'Side' }));
      expect(post).toHaveBeenCalledWith({ type: 'camera', preset: 'side' });
      expect(within(cam).getAllByRole('button')).toHaveLength(4);
    });

    it("D4-83: the tracers switch shows the mode's state and toggles the particles overlay", async () => {
      const post = mount(snapshotOf({ mode: 'data' }));
      render(<Overlay />);
      const sw = screen.getByRole('switch', { name: 'Tracers' });
      expect(sw.getAttribute('aria-checked')).toBe('true');
      await userEvent.click(sw);
      expect(sentCommands(post)).toContainEqual({
        type: 'setRenderState',
        render: { overlays: { particles: false } },
      });
      cleanup();
      mount(snapshotOf());
      render(<Overlay />);
      expect(screen.getByRole('switch', { name: 'Tracers' }).getAttribute('aria-checked')).toBe(
        'false',
      );
      cleanup();
      mount(snapshotOf({ mode: 'schlieren' }));
      render(<Overlay />);
      expect(screen.getByRole('switch', { name: 'Tracers' })).toHaveProperty('disabled', true);
    });

    it('the Data view colours its plane by the chosen contract field (only the drawable ones)', async () => {
      const post = mount(snapshotOf({ mode: 'data' }));
      render(<Overlay />);
      const sel = screen.getByRole('combobox', { name: 'Cut plane field' });
      expect(
        within(sel)
          .getAllByRole('option')
          .map((o) => o.getAttribute('value')),
      ).toEqual(['pressure', 'density', 'temperature', 'mach']);
      expect((sel as HTMLSelectElement).value).toBe('mach');
      await userEvent.selectOptions(sel, 'temperature');
      expect(sentCommands(post)).toContainEqual({
        type: 'setRenderState',
        render: { cutPlaneField: 'temperature' },
      });
      cleanup();
      mount(snapshotOf({ mode: 'cutaway' }));
      render(<Overlay />);
      expect(screen.queryByRole('combobox', { name: 'Cut plane field' })).toBeNull();
    });

    it('the store follows a new snapshot (the overlay re-renders from the worker)', () => {
      mount(snapshotOf());
      render(<Overlay />);
      const next = snapshotOf({ mode: 'exploded' });
      act(() => {
        useApp.setState({ snapshot: next });
      });
      expect(screen.getByRole('radio', { name: /Exploded/ })).toHaveProperty('checked', true);
    });
  },
);
