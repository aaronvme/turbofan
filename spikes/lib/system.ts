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

export interface PowerPlan {
  readonly guid: string;
  /** The plan's display name (localized), '' if powercfg printed none. */
  readonly name: string;
}

const GUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/**
 * `powercfg /getactivescheme` prints "Power Scheme GUID: <guid>  (<name>)". The label is
 * localized, so only the GUID and the parenthesized name are relied on. D0-3 records the plan
 * with every timing (the official runs start on "Balanced" as a lower bound).
 */
export function parseActiveScheme(output: string): PowerPlan | null {
  const m = GUID.exec(output);
  if (!m) return null;
  const name = /\(([^)]*)\)/.exec(output.slice(m.index + m[0].length));
  return { guid: m[0].toLowerCase(), name: name?.[1]?.trim() ?? '' };
}

export type PowerMode = 'best-power-efficiency' | 'balanced' | 'best-performance' | 'unknown';

/**
 * Windows 11 "Power mode" (Settings > System > Power) is an overlay on the plan, stored as
 * ActiveOverlayAcPowerScheme / ActiveOverlayDcPowerScheme under
 * HKLM\SYSTEM\CurrentControlSet\Control\Power\User\PowerSchemes. It changes CPU/GPU power
 * limits independently of the plan, so it is recorded next to it.
 */
export function powerModeFromOverlay(guid: string): PowerMode {
  switch (guid.toLowerCase()) {
    case '961cc777-2547-4f9d-8174-7d86181b8a7a':
      return 'best-power-efficiency';
    case '00000000-0000-0000-0000-000000000000':
      return 'balanced';
    case 'ded574b5-45a0-4f42-8737-46345c09c238':
      return 'best-performance';
    default:
      return 'unknown';
  }
}
