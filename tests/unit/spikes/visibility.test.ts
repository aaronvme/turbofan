import { describe, expect, it } from 'vitest';
import { hiddenMs } from '../../../spikes/lib/visibility';

// D0-1 wants Chrome in the foreground. When another window covers Chrome, Windows occlusion
// tracking hides the page and rAF stops, so a run with hidden time is not a valid timing.
describe('hiddenMs', () => {
  it('is 0 without events (the page stayed visible)', () => {
    expect(hiddenMs([], 1000, 3000)).toBe(0);
  });

  it('carries the state from before the window into it', () => {
    const events = [
      { at: 0, hidden: true },
      { at: 1500, hidden: false },
    ];
    expect(hiddenMs(events, 1000, 3000)).toBe(500);
  });

  it('adds up every hidden stretch, clipped to the window, in any input order', () => {
    const events = [
      { at: 2900, hidden: true },
      { at: 0, hidden: false },
      { at: 2500, hidden: false },
      { at: 2000, hidden: true },
    ];
    expect(hiddenMs(events, 1000, 3000)).toBe(600);
  });
});
