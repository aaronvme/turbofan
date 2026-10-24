import { describe, expect, it } from 'vitest';
import {
  PLANE_STATION_IDS,
  SOLVER_REDUCTION_STATIONS,
  STATIONS,
  STATION_IDS,
  STREAM_ORDER,
  isStationId,
} from '../../../src/contracts/stations';

describe('ARP755 station list', () => {
  it('contains every station the cycle and the solver need', () => {
    for (const id of ['0', '1', '2', '13', '18', '19', '21', '25', '3', '4', '45', '5', '8', '9']) {
      expect(STATION_IDS).toContain(id);
    }
    // EGT is measured at T49.5 (EASA TCDS E.004, IV.1.1)
    expect(STATION_IDS).toContain('49.5');
  });

  it('reduces the solver at exactly 2, 13, 18, 25, 3, 4, 45, 5, 8', () => {
    expect([...SOLVER_REDUCTION_STATIONS]).toEqual([
      '2',
      '13',
      '18',
      '25',
      '3',
      '4',
      '45',
      '5',
      '8',
    ]);
  });

  it('has metadata for every id, keyed consistently', () => {
    for (const id of STATION_IDS) {
      const info = STATIONS[id];
      expect(info.id).toBe(id);
      expect(info.name.length).toBeGreaterThan(0);
      expect(info.description.length).toBeGreaterThan(0);
    }
    expect(Object.keys(STATIONS).sort()).toEqual([...STATION_IDS].sort());
  });

  it('treats only the free stream as a non-plane station', () => {
    expect(STATIONS['0'].plane).toBe(false);
    expect(PLANE_STATION_IDS).not.toContain('0');
    expect(PLANE_STATION_IDS.length).toBe(STATION_IDS.length - 1);
    for (const id of PLANE_STATION_IDS) expect(STATIONS[id].plane).toBe(true);
  });

  it('orders every plane station along at least one stream, upstream to downstream', () => {
    const covered = new Set([...STREAM_ORDER.core, ...STREAM_ORDER.bypass]);
    for (const id of PLANE_STATION_IDS) expect(covered.has(id)).toBe(true);
    expect(STREAM_ORDER.core[0]).toBe('1');
    expect(STREAM_ORDER.core.at(-1)).toBe('9');
    expect(STREAM_ORDER.bypass.at(-1)).toBe('19');
    for (const id of STREAM_ORDER.bypass) expect(STATIONS[id].stream).not.toBe('core');
    for (const id of STREAM_ORDER.core) expect(STATIONS[id].stream).not.toBe('bypass');
  });

  it('recognises station ids at runtime', () => {
    expect(isStationId('49.5')).toBe(true);
    expect(isStationId('2')).toBe(true);
    expect(isStationId('7')).toBe(false);
    expect(isStationId(2)).toBe(false);
    expect(isStationId(null)).toBe(false);
  });
});
