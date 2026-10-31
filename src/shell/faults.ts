// The worker's fault paths, pure (W2A-N14), so they are unit-tested apart from the worker:
// - a cycle step that throws is a bug: the worker stops the sim, keeps rendering and says why
//   (W2A-I1: the overlay annunciates SIM STOPPED with this message, never silently);
// - the errors travel in the snapshot, so a post that keeps failing (a DataCloneError) would
//   freeze the overlay with no message: the MAX-th failure in a row is fatal, said once (W2A-N2).

/** One guarded cycle step: null when it returns, else the message the sim stops with. */
export function stepFault(step: () => void): string | null {
  try {
    step();
    return null;
  } catch (e) {
    return `cycle step failed: ${e instanceof Error ? `${e.name}: ${e.message}` : String(e)}`;
  }
}

export interface PostFaults {
  /** A snapshot went through: the count starts again. */
  posted(): void;
  /** A post threw: its error message, and the fatal message on the max-th in a row (once). */
  failed(e: unknown): { readonly error: string; readonly fatal: string | null };
}

export function createPostFaults(max: number): PostFaults {
  let inRow = 0;
  return {
    posted() {
      inRow = 0;
    },
    failed(e) {
      const error = `snapshot: ${e instanceof Error ? e.message : String(e)}`;
      inRow++;
      return {
        error,
        fatal: inRow === max ? `${error} (${String(max)} posts in a row failed)` : null,
      };
    },
  };
}
