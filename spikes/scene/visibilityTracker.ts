// Records the page's visibility changes from load, so each result can say how long the page
// was hidden inside its measured window (spikes/lib/visibility.ts). Main thread only.

import { hiddenMs, type VisibilityEvent } from '../lib/visibility';
import type { ConfigResult } from './benchApp';

export function trackVisibility(): (measured: ConfigResult['measured']) => number {
  const events: VisibilityEvent[] = [
    { at: performance.timeOrigin, hidden: document.visibilityState === 'hidden' },
  ];
  document.addEventListener('visibilitychange', () => {
    events.push({
      at: performance.timeOrigin + performance.now(),
      hidden: document.visibilityState === 'hidden',
    });
  });
  return (m) => hiddenMs(events, m.timeOrigin + m.from, m.timeOrigin + m.to);
}
