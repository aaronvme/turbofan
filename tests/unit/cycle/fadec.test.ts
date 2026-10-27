// The FADEC's pure control laws (src/cycle/fadec.ts), factored out of model.ts so that they have
// fast tests (D3-13: model.ts's FADEC was reached only by the slow transient files). The values
// are worked by hand from the laws; the whole-engine behaviour stays in model.test.ts.
import { describe, expect, it } from 'vitest';
import {
  ACCEL_FACTOR,
  ACCEL_FACTOR_HIGH,
  K_LIMIT_FACTOR,
  K_LOOP,
  SURGE_ACCEL_RESET,
  SURGE_HOLD_S,
  SURGE_RESTORE_S,
  TD,
  accelFactor,
  accelLimit,
  clampToSchedules,
  egtAboveRedlineS,
  egtLimitK,
  leverToN1,
  loopRate,
  selectLoop,
  surgeCapOnDetection,
} from '../../../src/cycle/fadec';

describe('FADEC: the lever schedule and the loop law', () => {
  it('leverToN1: linear from the idle N1 to the takeoff N1; the idle stop asks for none', () => {
    expect(leverToN1(0, 20, 95)).toBe(0);
    expect(leverToN1(-0.1, 20, 95)).toBe(0);
    expect(leverToN1(1e-9, 20, 95)).toBeCloseTo(20, 6);
    expect(leverToN1(0.5, 20, 95)).toBe(57.5);
    expect(leverToN1(1, 20, 95)).toBe(95);
  });

  it('loopRate: K_LOOP times the fractional error less the rate feedback', () => {
    expect(K_LOOP).toBe(2);
    expect(TD).toBe(0.7);
    expect(loopRate(90, 80, 0)).toBeCloseTo(0.2, 15);
    // 2 (10 / 100 - 0.7 x 5 / 100)
    expect(loopRate(90, 80, 5)).toBeCloseTo(0.13, 15);
    // the EGT limiter's own scale and lead: 2 (-100 / 150 - 0.3 x 100 / 150)
    expect(loopRate(1000, 1100, 100, 150, 0.3)).toBeCloseTo(2 * (-100 / 150 - 30 / 150), 15);
    expect(loopRate(1000, 1100, 0, 150, 0.3)).toBeCloseTo(-4 / 3, 15);
  });

  it('accelFactor: ACCEL_FACTOR below 68 % N2c, opening by ACCEL_FACTOR_HIGH up to 80 %', () => {
    expect(ACCEL_FACTOR).toBe(1.8);
    expect(ACCEL_FACTOR_HIGH).toBe(0.3);
    expect(accelFactor(60)).toBe(1.8);
    expect(accelFactor(68)).toBe(1.8);
    expect(accelFactor(74)).toBeCloseTo(1.95, 15);
    expect(accelFactor(80)).toBeCloseTo(2.1, 15);
    expect(accelFactor(100)).toBeCloseTo(2.1, 15);
  });
});

describe('FADEC: the loop selector and the schedules', () => {
  it('the higher of the N1 and idle-floor demands; a tie goes to the N1 loop', () => {
    expect(selectLoop(0.2, 0.1, [])).toEqual({ rate: 0.2, which: 'n1Target' });
    expect(selectLoop(0.1, 0.2, [])).toEqual({ rate: 0.2, which: 'idleFloor' });
    expect(selectLoop(0.1, 0.1, [])).toEqual({ rate: 0.1, which: 'n1Target' });
  });

  it('then the lowest limiter, each at K_LIMIT_FACTOR times its loop rate, strictly below', () => {
    expect(K_LIMIT_FACTOR).toBe(4);
    expect(selectLoop(0.2, 0.1, [['n1Max', 0.04]])).toEqual({ rate: 0.16, which: 'n1Max' });
    expect(selectLoop(0.2, 0.1, [['n1Max', 0.06]])).toEqual({ rate: 0.2, which: 'n1Target' });
    // exactly equal is not below: the selected loop keeps the fuel
    expect(selectLoop(0.2, 0.1, [['n2Max', 0.05]])).toEqual({ rate: 0.2, which: 'n1Target' });
    const caps = [
      ['n1Max', 0.04],
      ['n2Max', 0.03],
      ['egtMax', -0.01],
    ] as const;
    expect(selectLoop(0.2, 0.1, caps)).toEqual({ rate: -0.04, which: 'egtMax' });
    expect(selectLoop(0.2, 0.1, caps.slice(0, 2))).toEqual({ rate: 0.12, which: 'n2Max' });
  });

  it('clampToSchedules: Wf/P3 between the decel schedule and the acceleration limit', () => {
    expect(clampToSchedules(5, 4, 1, 'n1Target')).toEqual({ ru: 4, which: 'accelSchedule' });
    expect(clampToSchedules(0.5, 4, 1, 'idleFloor')).toEqual({ ru: 1, which: 'decelSchedule' });
    expect(clampToSchedules(2, 4, 1, 'egtMax')).toEqual({ ru: 2, which: 'egtMax' });
    expect(clampToSchedules(4, 4, 1, 'n1Target')).toEqual({ ru: 4, which: 'n1Target' });
    expect(clampToSchedules(1, 4, 1, 'n1Target')).toEqual({ ru: 1, which: 'n1Target' });
    // during the recovery hold the limit is the decel schedule itself: the accel limit wins
    expect(clampToSchedules(5, 1, 1, 'n1Target')).toEqual({ ru: 1, which: 'accelSchedule' });
  });
});

describe('FADEC: the surge recovery sequence (D3-17)', () => {
  // an excess of the schedule over the steady line of 2, so that a cap times it differs from it over 2
  const ACC = 4;
  const DEC = 1;
  const SS = 2;

  it('the acceleration limit: the schedule, or after a surge the capped one (cap of the excess)', () => {
    expect(accelLimit(ACC, DEC, SS, null, null)).toEqual({ limit: 4, sequenceOver: false });
    expect(accelLimit(ACC, DEC, SS, 0.8, null).limit).toBeCloseTo(3.6, 15);
    expect(accelLimit(ACC, DEC, SS, 0.8, null)).toEqual({
      limit: SS + 0.8 * (ACC - SS),
      sequenceOver: false,
    });
  });

  it('holds the decel schedule for SURGE_HOLD_S, ramps over SURGE_RESTORE_S, then ends', () => {
    expect(SURGE_HOLD_S).toBe(0.5);
    expect(SURGE_RESTORE_S).toBe(1);
    const capped = SS + 0.8 * (ACC - SS);
    expect(accelLimit(ACC, DEC, SS, 0.8, 0)).toEqual({ limit: DEC, sequenceOver: false });
    expect(accelLimit(ACC, DEC, SS, 0.8, 0.49)).toEqual({ limit: DEC, sequenceOver: false });
    expect(accelLimit(ACC, DEC, SS, 0.8, 0.5).limit).toBeCloseTo(DEC, 15);
    expect(accelLimit(ACC, DEC, SS, 0.8, 1).limit).toBeCloseTo(DEC + 0.5 * (capped - DEC), 15);
    expect(accelLimit(ACC, DEC, SS, 0.8, 1.25).limit).toBeCloseTo(DEC + 0.75 * (capped - DEC), 15);
    expect(accelLimit(ACC, DEC, SS, 0.8, 1.499).sequenceOver).toBe(false);
    expect(accelLimit(ACC, DEC, SS, 0.8, 1.5)).toEqual({ limit: capped, sequenceOver: true });
    expect(accelLimit(ACC, DEC, SS, null, 2)).toEqual({ limit: ACC, sequenceOver: true });
  });

  it('the cap: SURGE_ACCEL_RESET at the first detection, again at each new surge after the hold', () => {
    expect(SURGE_ACCEL_RESET).toBe(0.8);
    expect(surgeCapOnDetection(null, null)).toBe(0.8);
    expect(surgeCapOnDetection(0.8, null)).toBeCloseTo(0.64, 15);
    // inside the hold the detections are the same surge still cycling
    expect(surgeCapOnDetection(0.8, 0.2)).toBe(0.8);
    expect(surgeCapOnDetection(0.8, 0.5)).toBeCloseTo(0.64, 15);
    expect(surgeCapOnDetection(null, 0.2)).toBeNull();
  });
});

describe('FADEC: the EGT limit in force (TCDS E.004 VI note 4)', () => {
  // round test limits (the engine's are in the definition, from the TCDS)
  const LIM = {
    egtTransientK: 1000,
    egtTakeoffRedlineK: 990,
    egtMaxContinuousK: 960,
    egtTransientDurationS: 20,
  };

  it('the transitory limit while the 20 s allowance lasts, then the redline', () => {
    expect(egtLimitK(LIM, 0)).toBe(1000);
    expect(egtLimitK(LIM, 19.99)).toBe(1000);
    expect(egtLimitK(LIM, 20)).toBe(990);
    // never above the transitory limit, whatever the redline says
    expect(egtLimitK({ ...LIM, egtTakeoffRedlineK: 1100 }, 25)).toBe(1000);
  });

  it('the time above the redline grows above it, holds in the band, renews at max continuous', () => {
    expect(egtAboveRedlineS(3, 995, LIM, 0.05)).toBeCloseTo(3.05, 15);
    expect(egtAboveRedlineS(3, 990, LIM, 0.05)).toBe(3);
    expect(egtAboveRedlineS(3, 970, LIM, 0.05)).toBe(3);
    expect(egtAboveRedlineS(3, 960, LIM, 0.05)).toBe(0);
    expect(egtAboveRedlineS(3, 900, LIM, 0.05)).toBe(0);
  });
});
