import { describe, expect, it } from 'vitest';
import { cpuBusyFraction, powerSourceFromBatteryStatus } from '../../../spikes/lib/system';

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
