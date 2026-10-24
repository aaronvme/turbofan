// Conditions recorded with every benchmark (D0-1): power source and CPU load.

export type PowerSource = 'ac' | 'battery' | 'no-battery' | 'unknown';

/**
 * Win32_Battery.BatteryStatus codes: 1 discharging, 2 on AC, 3 fully charged, 4 low,
 * 5 critical, 6-9 charging, 10 undefined, 11 partially charged. Any discharging battery means
 * we are on battery.
 */
export function powerSourceFromBatteryStatus(codes: readonly number[]): PowerSource {
  if (codes.length === 0) return 'no-battery';
  if (codes.some((c) => c === 1 || c === 4 || c === 5)) return 'battery';
  if (codes.every((c) => c === 2 || c === 3 || (c >= 6 && c <= 9))) return 'ac';
  return 'unknown';
}

export interface CpuTimes {
  readonly times: {
    readonly user: number;
    readonly nice: number;
    readonly sys: number;
    readonly idle: number;
    readonly irq: number;
  };
}

/** Busy share of all CPU time between two `os.cpus()` samples. */
export function cpuBusyFraction(before: readonly CpuTimes[], after: readonly CpuTimes[]): number {
  if (before.length !== after.length) throw new Error('CPU count changed between samples');
  let busy = 0;
  let total = 0;
  before.forEach((b, i) => {
    const a = after[i];
    if (!a) return;
    const d = (k: keyof CpuTimes['times']) => a.times[k] - b.times[k];
    const idle = d('idle');
    const work = d('user') + d('nice') + d('sys') + d('irq');
    busy += work;
    total += work + idle;
  });
  return total > 0 ? busy / total : 0;
}
