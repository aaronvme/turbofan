// D4-100 (U4 on AC): the worker posted a snapshot every PUBLISH_EVERY (3) frames, so with the asked
// view's frames each taking up to PREPARE_FRAME_CPU_MS of warm CPU the main thread saw a snapshot
// gap of three such frames (612-868 ms in Chrome, the polish round's run at 3d5f543), near the
// test's 1 s freeze bar. A snapshot is also due once PUBLISH_MAX_GAP_MS has passed since the last,
// so a heavy frame posts its own and the gap is about one frame.
import { describe, expect, it } from 'vitest';
import { PUBLISH_EVERY, PUBLISH_MAX_GAP_MS, snapshotDue } from '../../../src/shell/publish';

describe('snapshotDue: every PUBLISH_EVERY frames, or once PUBLISH_MAX_GAP_MS has passed', () => {
  it('states its cadence: every 3 frames (20 Hz at 60 fps), and no gap of 50 ms or more', () => {
    expect(PUBLISH_EVERY).toBe(3);
    expect(PUBLISH_MAX_GAP_MS).toBe(50);
  });

  it('at 60 fps: every third frame', () => {
    const due = Array.from({ length: 9 }, (_, f) => snapshotDue(f, (f % 3) * 16.7));
    expect(due).toEqual([true, false, false, true, false, false, true, false, false]);
  });

  it('a heavy frame (250 ms of warm CPU) posts its own snapshot', () => {
    expect(snapshotDue(1, 250)).toBe(true);
    expect(snapshotDue(2, 50)).toBe(true);
    expect(snapshotDue(2, 49.9)).toBe(false);
  });

  it('three heavy frames in a row: a snapshot each, so the gap is one frame, not three', () => {
    let last = 0;
    let t = 0;
    let gap = 0;
    for (let f = 1; f <= 9; f++) {
      t += 280;
      if (snapshotDue(f, t - last)) {
        gap = Math.max(gap, t - last);
        last = t;
      }
    }
    expect(gap).toBe(280);
  });
});
