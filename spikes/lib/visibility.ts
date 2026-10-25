// Page visibility during a benchmark run. D0-1 wants Chrome in the foreground: when another
// window covers it, Windows native occlusion tracking marks the page hidden and Chrome stops
// rAF, which shows up as second-long frames and a collapsed iteration rate, not as slow GPU.

export interface VisibilityEvent {
  /** Absolute time (performance.timeOrigin + performance.now()), ms. */
  readonly at: number;
  readonly hidden: boolean;
}

/** Milliseconds of [from, to) during which the page was hidden. Visible before any event. */
export function hiddenMs(events: readonly VisibilityEvent[], from: number, to: number): number {
  const sorted = [...events].sort((a, b) => a.at - b.at);
  let hidden = false;
  let since = from;
  let total = 0;
  for (const e of sorted) {
    if (e.at <= from) {
      hidden = e.hidden;
      continue;
    }
    if (e.at >= to) break;
    if (hidden) total += e.at - since;
    hidden = e.hidden;
    since = e.at;
  }
  if (hidden) total += to - since;
  return total;
}
