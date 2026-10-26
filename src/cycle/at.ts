// Checked array access for the numeric kernels. Under noUncheckedIndexedAccess a[i] is
// `T | undefined`; a silent `?? 0` would turn an indexing bug into a plausible wrong number
// inside a Newton solve or a map lookup, so out-of-range reads throw instead.

/** a[i], throwing a RangeError when i is outside the array. */
export function at<T>(a: readonly T[], i: number): T {
  const v = a[i];
  if (v === undefined) throw new RangeError(`index ${i} outside [0, ${a.length})`);
  return v;
}
