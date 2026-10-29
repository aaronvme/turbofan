// Look-dev round 5 (critic pass 8, W2L-N5): 06's take-off disc carried a dot screen with 6 fan
// time copies (before/06, at 8, did not). The copy count follows the exposure: 6 for a blur
// within half a blade pitch (the default view at idle, 6.4 degrees, keeps P4's cost), 8 for a
// wider one (the hero at 1/500 s, take-off at 1/1000 s).
import { describe, expect, it } from 'vitest';
import { fanTimeCopies } from '../../../src/geometry/motion';

const PITCH = (2 * Math.PI) / 24;
const deg = (d: number) => (d * Math.PI) / 180;

describe('fanTimeCopies: the fan time copies per frame follow the exposure (W2L-N5)', () => {
  it('6 within half a pitch, 8 beyond, 1 for a still', () => {
    expect(fanTimeCopies(deg(6.4), PITCH, 8)).toBe(6);
    expect(fanTimeCopies(deg(12.8), PITCH, 8)).toBe(8);
    expect(fanTimeCopies(deg(30), PITCH, 8)).toBe(8);
    expect(fanTimeCopies(0, PITCH, 8)).toBe(1);
  });

  it('never more than the copies built', () => {
    expect(fanTimeCopies(deg(30), PITCH, 4)).toBe(4);
    expect(fanTimeCopies(deg(6.4), PITCH, 4)).toBe(4);
  });
});
