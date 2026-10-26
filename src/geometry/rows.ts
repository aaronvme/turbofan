// Instanced blade rows: one blade mesh, `count` rotations about +x.

/** Instance angles, rad: phase + 2 pi k / count. */
export function instanceAngles(count: number, phase = 0): Float64Array {
  if (!(Number.isInteger(count) && count > 0)) throw new Error('instanceAngles: count > 0');
  return Float64Array.from({ length: count }, (_, k) => phase + (2 * Math.PI * k) / count);
}

/** Column-major 4x4 rotations about +x, one per angle (three.js matrix layout). */
export function instanceMatrices(angles: Float64Array): Float32Array {
  const out = new Float32Array(16 * angles.length);
  angles.forEach((a, k) => {
    const c = Math.cos(a);
    const s = Math.sin(a);
    out.set([1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1], 16 * k);
  });
  return out;
}

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/**
 * A deterministic clocking offset per row index, so neighbouring rows do not line their
 * blades up (real engines clock them deliberately; this only avoids a visual pattern).
 */
export function rowPhase(index: number): number {
  return (index * GOLDEN_ANGLE) % (2 * Math.PI);
}
