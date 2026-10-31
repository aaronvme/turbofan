// W2A-N14: the worker's fault paths, pure (src/shell/faults.ts), as src/app/simWorker.ts uses
// them: a throwing cycle step stops the sim with its message (W2A-I1: SIM STOPPED, never silent),
// and snapshot posts that keep failing become fatal on the MAX-th in a row (W2A-N2), not before,
// and only once.
import { describe, expect, it } from 'vitest';
import { createPostFaults, stepFault } from '../../../src/shell/faults';

describe('stepFault: one guarded cycle step', () => {
  it('is null when the step returns', () => {
    let ran = 0;
    expect(
      stepFault(() => {
        ran++;
      }),
    ).toBeNull();
    expect(ran).toBe(1);
  });

  it("says a thrown error's name and message", () => {
    expect(
      stepFault(() => {
        throw new RangeError('N1 is not finite');
      }),
    ).toBe('cycle step failed: RangeError: N1 is not finite');
  });

  it('says a thrown non-error as a string', () => {
    expect(
      stepFault(() => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error -- the case under test
        throw 'held';
      }),
    ).toBe('cycle step failed: held');
  });
});

describe('createPostFaults: snapshot posts that fail in a row', () => {
  it('is fatal on the MAX-th failure in a row, once', () => {
    const f = createPostFaults(3);
    const e = new Error('DataCloneError');
    expect(f.failed(e)).toEqual({ error: 'snapshot: DataCloneError', fatal: null });
    expect(f.failed(e).fatal).toBeNull();
    expect(f.failed(e)).toEqual({
      error: 'snapshot: DataCloneError',
      fatal: 'snapshot: DataCloneError (3 posts in a row failed)',
    });
    // said once: the overlay already stopped
    expect(f.failed(e).fatal).toBeNull();
  });

  it('a post that goes through starts the count again', () => {
    const f = createPostFaults(3);
    f.failed('x');
    f.failed('x');
    f.posted();
    expect(f.failed('x').fatal).toBeNull();
    expect(f.failed('x').fatal).toBeNull();
    expect(f.failed('x').fatal).toBe('snapshot: x (3 posts in a row failed)');
  });
});
