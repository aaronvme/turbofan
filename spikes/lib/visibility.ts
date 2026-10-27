// Page visibility during a benchmark run (D0-1 wants Chrome in the foreground). This catches a
// page that really is hidden (minimized, another tab). It does NOT catch an occluded or
// unfocused window under the harness: Playwright launches Chrome with
// --disable-backgrounding-occluded-windows, so such a page stays "visible" while its rAF drops
// to ~1 Hz (W0G-I1). spikes/lib/validity.ts judges that from the rAF rate.

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

/** A window focus change (D3-6: a blur during a run makes it INVALID). */
export interface FocusEvent {
  /** Absolute time (performance.timeOrigin + performance.now()), ms. */
  readonly at: number;
  readonly focused: boolean;
}

/** How many times the page lost focus (blur) in [from, to). */
export function blurCount(events: readonly FocusEvent[], from: number, to: number): number {
  return events.filter((e) => !e.focused && e.at >= from && e.at < to).length;
}
