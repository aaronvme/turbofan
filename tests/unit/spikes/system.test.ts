import { describe, expect, it } from 'vitest';
import {
  cpuBusyFraction,
  parseActiveScheme,
  powerModeFromOverlay,
  powerSourceFromBatteryStatus,
} from '../../../spikes/lib/system';

describe('powerSourceFromBatteryStatus (Win32_Battery.BatteryStatus)', () => {
  it('maps the AC codes (2 = on AC, 3 = fully charged, 6-9 = charging) to ac', () => {
    for (const code of [2, 3, 6, 7, 8, 9]) expect(powerSourceFromBatteryStatus([code])).toBe('ac');
  });

  it('maps the discharging codes (1, 4, 5) to battery', () => {
    for (const code of [1, 4, 5]) expect(powerSourceFromBatteryStatus([code])).toBe('battery');
  });

  it('is battery if any battery discharges, desktop if there is none, unknown otherwise', () => {
    expect(powerSourceFromBatteryStatus([2, 1])).toBe('battery');
    expect(powerSourceFromBatteryStatus([])).toBe('no-battery');
    expect(powerSourceFromBatteryStatus([10])).toBe('unknown');
  });
});

describe('cpuBusyFraction', () => {
  const cpu = (user: number, sys: number, idle: number) => ({
    times: { user, nice: 0, sys, idle, irq: 0 },
  });

  it('is the busy share of all CPU time between two samples', () => {
    const before = [cpu(100, 50, 850), cpu(0, 0, 1000)];
    const after = [cpu(400, 150, 1450), cpu(100, 0, 1900)];
    // busy: (300+100) + 100 = 500; total: 1000 + 1000 = 2000
    expect(cpuBusyFraction(before, after)).toBeCloseTo(0.25, 12);
  });

  it('rejects samples from different CPU counts', () => {
    expect(() => cpuBusyFraction([cpu(0, 0, 1)], [])).toThrow(/CPU count/);
  });
});

describe('parseActiveScheme (powercfg /getactivescheme, D0-3)', () => {
  it('reads the GUID and name of the active plan', () => {
    const out = 'Power Scheme GUID: 381b4222-f694-41f0-9685-ff5bb260df2e  (Balanced)\r\n';
    expect(parseActiveScheme(out)).toEqual({
      guid: '381b4222-f694-41f0-9685-ff5bb260df2e',
      name: 'Balanced',
    });
  });

  it('does not depend on the English label (localized Windows)', () => {
    const out = 'GUID des Energieschemas: 8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c  (Höchstleistung)';
    expect(parseActiveScheme(out)).toEqual({
      guid: '8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c',
      name: 'Höchstleistung',
    });
  });

  it('keeps a plan without a name and rejects output without a GUID', () => {
    expect(parseActiveScheme('Power Scheme GUID: 381b4222-f694-41f0-9685-ff5bb260df2e')).toEqual({
      guid: '381b4222-f694-41f0-9685-ff5bb260df2e',
      name: '',
    });
    expect(parseActiveScheme('Invalid Parameters -- try "/?" for help')).toBeNull();
  });
});

describe('powerModeFromOverlay (Windows 11 Settings > Power mode)', () => {
  it('maps the three overlay GUIDs and anything else to unknown', () => {
    expect(powerModeFromOverlay('961cc777-2547-4f9d-8174-7d86181b8a7a')).toBe(
      'best-power-efficiency',
    );
    expect(powerModeFromOverlay('00000000-0000-0000-0000-000000000000')).toBe('balanced');
    expect(powerModeFromOverlay('DED574B5-45A0-4F42-8737-46345C09C238')).toBe('best-performance');
    expect(powerModeFromOverlay('')).toBe('unknown');
  });
});
