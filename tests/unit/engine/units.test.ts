import { describe, expect, it } from 'vitest';
import {
  celsiusToKelvin,
  inToM,
  kelvinToCelsius,
  lbPerSToKgPerS,
  lbfToN,
  radPerSToRpm,
  rpmToRadPerS,
  tsfcImperialToSi,
} from '../../../src/engine/units';

describe('unit conversions', () => {
  it('converts pound-force to newtons', () => {
    expect(lbfToN(1)).toBeCloseTo(4.4482216152605, 12);
    expect(lbfToN(27_300)).toBeCloseTo(121_436.45, 1);
  });

  it('converts lb/s to kg/s and inches to metres', () => {
    expect(lbPerSToKgPerS(1)).toBeCloseTo(0.45359237, 12);
    expect(inToM(61)).toBeCloseTo(1.5494, 10);
  });

  it('round-trips celsius and kelvin', () => {
    expect(celsiusToKelvin(15)).toBeCloseTo(288.15, 12);
    expect(kelvinToCelsius(celsiusToKelvin(950))).toBeCloseTo(950, 12);
  });

  it('round-trips rpm and rad/s', () => {
    expect(rpmToRadPerS(60)).toBeCloseTo(2 * Math.PI, 12);
    expect(radPerSToRpm(rpmToRadPerS(5_380))).toBeCloseTo(5_380, 9);
  });

  it('converts TSFC from (lb/h)/lbf to kg/(N*s)', () => {
    // 1 (lb/h)/lbf = 0.45359237 / 3600 / 4.4482216152605 kg/(N*s) ~= 28.33 mg/(N*s)
    expect(tsfcImperialToSi(1)).toBeCloseTo(2.8325e-5, 8);
  });
});
