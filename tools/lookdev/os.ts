// The OS side of a look-dev timing run's conditions (D0-1, D4-42): the power source as
// Windows reports it (Win32_Battery), not the page's Battery API, which only says "charging".
// W2L-I4: capture.ts and ab.ts read it before and after every run.

import { execFileSync } from 'node:child_process';
import { powerSourceFromBatteryStatus, type PowerSource } from '../../spikes/lib/system.ts';

/**
 * The OS power source now: 'ac', 'battery', 'no-battery' (a desktop) or 'unknown' (the query
 * failed; never counted as AC). A fixed query, no input reaches the shell.
 */
export function osPowerSource(): PowerSource {
  try {
    const out = execFileSync(
      'powershell',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        '(Get-CimInstance Win32_Battery).BatteryStatus',
      ],
      { encoding: 'utf8', timeout: 20_000 },
    ).trim();
    const codes = out
      .split(/\s+/)
      .filter((s) => s.length > 0)
      .map(Number);
    return codes.some((c) => !Number.isFinite(c)) ? 'unknown' : powerSourceFromBatteryStatus(codes);
  } catch {
    return 'unknown';
  }
}
