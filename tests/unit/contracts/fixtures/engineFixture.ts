// A deliberately simple, valid EngineDefinition for validator tests: straight ducts on a
// toy layout (metres). It is not an engine; the real one is src/engine/definition.ts.
import type { BladeRow, EngineDefinition, FlowComponent } from '../../../../src/contracts/engine';

const comp = (
  id: FlowComponent['id'],
  stream: FlowComponent['stream'],
  upstream: FlowComponent['upstream'],
  xStart: number,
  xEnd: number,
  hub: FlowComponent['hub'],
  casing: FlowComponent['casing'],
  spool: FlowComponent['spool'] = null,
): FlowComponent => ({ id, name: id, stream, upstream, xStart, xEnd, hub, casing, spool });

const span = (hub: number, mid: number, tip: number) => ({ hub, mid, tip });

const fanRotor: BladeRow = {
  id: 'fan',
  name: 'Fan rotor',
  component: 'fan',
  kind: 'rotor',
  spool: 'lp',
  count: 24,
  countConfidence: 'official',
  leadingEdge: { hub: { x: 0.2, r: 0.3 }, tip: { x: 0.2, r: 0.99 } },
  trailingEdge: { hub: { x: 0.5, r: 0.3 }, tip: { x: 0.5, r: 0.99 } },
  chord: span(0.4, 0.45, 0.5),
  inletMetalAngle: span(0.5, 0.8, 1.0),
  exitMetalAngle: span(0.0, 0.4, 0.8),
  stagger: span(0.25, 0.6, 0.9),
  maxThicknessRatio: span(0.1, 0.06, 0.03),
  sweep: 0,
  lean: 0,
  tipClearance: 0.01,
  vsv: null,
};

const boosterStator: BladeRow = {
  ...fanRotor,
  id: 'b-s1',
  name: 'Booster stator 1',
  component: 'booster',
  kind: 'stator',
  spool: 'none',
  count: 60,
  countConfidence: 'estimate',
  leadingEdge: { hub: { x: 1.2, r: 0.3 }, tip: { x: 1.2, r: 0.5 } },
  trailingEdge: { hub: { x: 1.4, r: 0.3 }, tip: { x: 1.4, r: 0.5 } },
  chord: span(0.22, 0.22, 0.22),
  inletMetalAngle: span(-0.6, -0.6, -0.6),
  exitMetalAngle: span(0, 0, 0),
  stagger: span(-0.3, -0.3, -0.3),
  tipClearance: 0,
};

const hpcVsv: BladeRow = {
  ...boosterStator,
  id: 'hpc-igv',
  name: 'HPC inlet guide vane',
  component: 'hpc',
  kind: 'vsv',
  leadingEdge: { hub: { x: 3.2, r: 0.3 }, tip: { x: 3.2, r: 0.5 } },
  trailingEdge: { hub: { x: 3.4, r: 0.3 }, tip: { x: 3.4, r: 0.5 } },
  vsv: { scheduleId: 'hpc-vsv', gain: 1 },
};

const hpcRotor: BladeRow = {
  ...fanRotor,
  id: 'hpc-r1',
  name: 'HPC rotor 1',
  component: 'hpc',
  spool: 'hp',
  count: 40,
  countConfidence: 'estimate',
  leadingEdge: { hub: { x: 3.5, r: 0.3 }, tip: { x: 3.5, r: 0.49 } },
  trailingEdge: { hub: { x: 3.7, r: 0.3 }, tip: { x: 3.7, r: 0.49 } },
  chord: span(0.25, 0.25, 0.25),
};

export function validEngine(): EngineDefinition {
  return {
    id: 'toy',
    name: 'Toy engine',
    description: 'validator fixture',
    rotation: { lp: -1, hp: -1 },
    flowpath: {
      curves: {
        spinner: {
          points: [
            { x: -1, r: 0 },
            { x: 0, r: 0.3 },
          ],
        },
        coreInner: {
          points: [
            { x: 0, r: 0.3 },
            { x: 10, r: 0.3 },
          ],
        },
        plug: {
          points: [
            { x: 10, r: 0.3 },
            { x: 12, r: 0 },
          ],
        },
        coreOuter: {
          points: [
            { x: 1, r: 0.5 },
            { x: 11, r: 0.5 },
          ],
        },
        coreCowl: {
          points: [
            { x: 1, r: 0.5 },
            { x: 1.2, r: 0.6 },
            { x: 11, r: 0.6 },
          ],
        },
        nacelleInner: {
          points: [
            { x: -2, r: 1 },
            { x: 5, r: 1 },
          ],
        },
        nacelleOuter: {
          points: [
            { x: -2, r: 1 },
            { x: -1.5, r: 1.2 },
            { x: 5, r: 1.1 },
          ],
        },
      },
      components: [
        comp('inlet', 'common', null, -2, 0, 'spinner', 'nacelleInner'),
        comp('fan', 'common', 'inlet', 0, 1, 'coreInner', 'nacelleInner', 'lp'),
        comp('bypassDuct', 'bypass', 'fan', 1, 5, 'coreCowl', 'nacelleInner'),
        comp('booster', 'core', 'fan', 1, 2, 'coreInner', 'coreOuter', 'lp'),
        comp('transitionDuct', 'core', 'booster', 2, 3, 'coreInner', 'coreOuter'),
        comp('hpc', 'core', 'transitionDuct', 3, 4, 'coreInner', 'coreOuter', 'hp'),
        comp('combustor', 'core', 'hpc', 4, 5, 'coreInner', 'coreOuter'),
        comp('hpt', 'core', 'combustor', 5, 6, 'coreInner', 'coreOuter', 'hp'),
        comp('interTurbineDuct', 'core', 'hpt', 6, 7, 'coreInner', 'coreOuter'),
        comp('lpt', 'core', 'interTurbineDuct', 7, 10, 'coreInner', 'coreOuter', 'lp'),
        comp('exhaust', 'core', 'lpt', 10, 11, 'plug', 'coreOuter'),
      ],
    },
    stations: [
      { id: '1', x: -2, component: 'inlet' },
      { id: '2', x: 0, component: 'fan' },
      { id: '13', x: 2, component: 'bypassDuct' },
      { id: '18', x: 4.9, component: 'bypassDuct' },
      { id: '19', x: 5, component: 'bypassDuct' },
      { id: '21', x: 1.1, component: 'booster' },
      { id: '24', x: 2, component: 'booster' },
      { id: '25', x: 3, component: 'hpc' },
      { id: '3', x: 4, component: 'hpc' },
      { id: '4', x: 5, component: 'hpt' },
      { id: '41', x: 5.5, component: 'hpt' },
      { id: '45', x: 7, component: 'lpt' },
      { id: '49.5', x: 8, component: 'lpt' },
      { id: '5', x: 10, component: 'lpt' },
      { id: '8', x: 11, component: 'exhaust' },
      { id: '9', x: 11, component: 'exhaust' },
    ],
    bladeRows: [fanRotor, boosterStator, hpcVsv, hpcRotor],
    vsvSchedules: [
      {
        id: 'hpc-vsv',
        points: [
          { n2CorrectedPercent: 50, closure: 0.6 },
          { n2CorrectedPercent: 100, closure: 0 },
        ],
      },
    ],
    bleeds: [
      {
        id: 'hpc9',
        name: 'HPC 9th stage',
        kind: 'customer',
        component: 'hpc',
        x: 3.9,
        maxFraction: 0.07,
      },
    ],
    designPoint: {
      ambient: { pressurePa: 101325, temperatureK: 288.15, machNumber: 0 },
      totalAirflowKgPerS: 300,
      bypassRatio: 5,
      pressureRatios: { fanBypass: 1.6, fanCore: 1.5, booster: 2, hpc: 10, overall: 30 },
      efficiencies: {
        fanBypass: 0.9,
        fanCore: 0.89,
        booster: 0.89,
        hpc: 0.87,
        hpt: 0.9,
        lpt: 0.91,
        combustor: 0.995,
      },
      combustorPressureLossFraction: 0.05,
      turbineCoolingFraction: 0.12,
      t4K: 1700,
      n1Rpm: 5000,
      n2Rpm: 15000,
      netThrustN: 100_000,
      fuelFlowKgPerS: 1,
    },
    ratings: {
      takeoffThrustN: 100_000,
      maxContinuousThrustN: 95_000,
      flatRatingTemperatureK: 303.15,
    },
    limits: {
      n1MaxRpm: 5200,
      n2MaxRpm: 15750,
      egtTakeoffRedlineK: 1223.15,
      egtMaxContinuousK: 1198.15,
      egtStartLimitK: 998.15,
      egtTransientK: 1233.15,
      egtTransientDurationS: 20,
      egtShunt: { offsetK: 30, rampStartN2Rpm: 8300, fullN2Rpm: 8500 },
    },
    startSchedule: { minFuelOnN2Percent: 20, fuelOnN2Percent: 25, starterCutoutN2Percent: 56 },
  };
}
