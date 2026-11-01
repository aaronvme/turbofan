// The worker's snapshot cadence (D2-9: React's realistic load is 15 Hz). D4-100 (U4 on AC): a
// snapshot every PUBLISH_EVERY frames left the main thread three heavy frames between snapshots
// while the asked view warmed up to PREPARE_FRAME_CPU_MS a frame (612-868 ms in Chrome at 3d5f543,
// against the browser suite's 1 s freeze bar); a snapshot is also due once PUBLISH_MAX_GAP_MS has
// passed since the last, so a heavy frame posts its own.

/** A snapshot every this many frames (20 Hz at 60 fps). */
export const PUBLISH_EVERY = 3;
/** D4-100: a snapshot at the latest this long after the last one (3 frames at 60 fps), ms. */
export const PUBLISH_MAX_GAP_MS = 50;

/** Whether this frame posts a snapshot, `sinceLastMs` after the last one. */
export function snapshotDue(frame: number, sinceLastMs: number): boolean {
  return frame % PUBLISH_EVERY === 0 || sinceLastMs >= PUBLISH_MAX_GAP_MS;
}
