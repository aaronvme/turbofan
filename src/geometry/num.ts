// Indexed reads for hot loops whose bounds are known. With noUncheckedIndexedAccess every
// `a[i]` is `T | undefined`; a `?? 0` per read would add hundreds of never-taken branches.
// Callers guarantee 0 <= i < a.length.

export const ix = (a: ArrayLike<number>, i: number): number => a[i] as number;
