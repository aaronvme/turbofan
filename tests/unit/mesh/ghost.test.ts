import { describe, expect, it } from 'vitest';
import { buildGhostMap, ghostIndex } from '../../../tools/mesh/ghost';
import { BC } from '../../../tools/mesh/types';
import { reversedPair, sideBySide } from './fixtures';

describe('buildGhostMap', () => {
  it('lays out two ghost layers around every block face', () => {
    const mesh = sideBySide();
    const map = buildGhostMap(mesh, 2);
    expect(map.layers).toBe(2);
    expect(Array.from(map.cellOffset)).toEqual([0, 6, 10]);
    // A: 2 layers x 2 (3 + 2) = 20 ghosts; B: 2 x 2 (2 + 2) = 16
    expect(Array.from(map.ghostOffset)).toEqual([0, 20, 36]);
    expect(map.src.length).toBe(36);
    expect(map.bc.length).toBe(36);
  });

  it('copies the neighbour block cells across a point-matched interface', () => {
    const mesh = sideBySide();
    const map = buildGhostMap(mesh, 2);
    // A (3 x 2) imax face, row j: layer 1 is B cell (0, j), layer 2 is B cell (1, j); B is 2 x 2 at offset 6
    for (let j = 0; j < 2; j++) {
      expect(map.src[ghostIndex(map, mesh, 0, 'imax', 1, j)]).toBe(6 + j * 2 + 0);
      expect(map.src[ghostIndex(map, mesh, 0, 'imax', 2, j)]).toBe(6 + j * 2 + 1);
      expect(map.bc[ghostIndex(map, mesh, 0, 'imax', 1, j)]).toBe(BC.INTERFACE);
      // and B's imin ghosts are A's last two columns
      expect(map.src[ghostIndex(map, mesh, 1, 'imin', 1, j)]).toBe(j * 3 + 2);
      expect(map.src[ghostIndex(map, mesh, 1, 'imin', 2, j)]).toBe(j * 3 + 1);
    }
  });

  it('points physical-boundary ghosts at the mirror cell and records the BC code', () => {
    const mesh = sideBySide();
    const map = buildGhostMap(mesh, 2);
    for (let i = 0; i < 3; i++) {
      expect(map.src[ghostIndex(map, mesh, 0, 'jmin', 1, i)]).toBe(i);
      expect(map.src[ghostIndex(map, mesh, 0, 'jmin', 2, i)]).toBe(3 + i);
      expect(map.bc[ghostIndex(map, mesh, 0, 'jmin', 1, i)]).toBe(BC.AXIS);
      expect(map.bc[ghostIndex(map, mesh, 0, 'jmax', 1, i)]).toBe(BC.SLIP_WALL);
    }
    expect(map.bc[ghostIndex(map, mesh, 0, 'imin', 1, 0)]).toBe(BC.INFLOW);
    expect(map.bc[ghostIndex(map, mesh, 1, 'imax', 2, 1)]).toBe(BC.OUTFLOW);
    expect(map.bc[ghostIndex(map, mesh, 1, 'jmax', 1, 1)]).toBe(BC.FARFIELD);
  });

  it('maps a reversed interface (fan block to C-block orientation)', () => {
    const mesh = reversedPair();
    const map = buildGhostMap(mesh, 2);
    // A is 4 x 2 (cells 0..7), B is 3 x 4 at offset 8. A's jmax cell i meets B's imin cell 3 - i.
    for (let i = 0; i < 4; i++) {
      const jb = 3 - i;
      expect(map.src[ghostIndex(map, mesh, 0, 'jmax', 1, i)]).toBe(8 + jb * 3 + 0);
      expect(map.src[ghostIndex(map, mesh, 0, 'jmax', 2, i)]).toBe(8 + jb * 3 + 1);
      expect(map.src[ghostIndex(map, mesh, 1, 'imin', 1, jb)]).toBe(1 * 4 + i);
      expect(map.src[ghostIndex(map, mesh, 1, 'imin', 2, jb)]).toBe(0 * 4 + i);
    }
  });

  it('rejects layer requests the blocks cannot satisfy and bad lookups', () => {
    const mesh = sideBySide();
    expect(() => buildGhostMap(mesh, 3)).toThrow();
    const map = buildGhostMap(mesh, 2);
    expect(() => ghostIndex(map, mesh, 0, 'imax', 3, 0)).toThrow();
    expect(() => ghostIndex(map, mesh, 0, 'imax', 1, 2)).toThrow();
  });
});
