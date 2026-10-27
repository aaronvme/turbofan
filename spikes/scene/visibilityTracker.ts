// Records the page's visibility changes from load, so each result can say how long the page
// was hidden inside its measured window (spikes/lib/visibility.ts). Main thread only.

import { blurCount, hiddenMs, type FocusEvent, type VisibilityEvent } from '../lib/visibility';
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

/**
 * Records the window's focus changes from load, so each result can say how often the page lost
 * focus inside its measured window (D3-6: a blur makes the run INVALID). Playwright keeps an
 * unfocused page "visible", so visibility alone does not show it.
 */
export function trackFocus(): (measured: ConfigResult['measured']) => number {
  const events: FocusEvent[] = [];
  const push = (focused: boolean) => () => {
    events.push({ at: performance.timeOrigin + performance.now(), focused });
  };
  window.addEventListener('blur', push(false));
  window.addEventListener('focus', push(true));
  return (m) => blurCount(events, m.timeOrigin + m.from, m.timeOrigin + m.to);
}
