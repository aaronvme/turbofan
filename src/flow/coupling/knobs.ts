// The calibration's grouped knobs (the plan's "~16 grouped knobs"; PHYSICS.md 3.3 CP3-CP4): each
// multiplies one family of body-force or blockage coefficients. 1 is the uncalibrated model; the
// feedforward K(N1c, N2c) and the log-space integral trim set them (calibrator, w3/coupling).
import type { BladeRow } from '../../contracts/engine';

export const KNOB_IDS = [
  /** Fan normal force, core part (below the splitter radius). */
  'fanHub',
  /** Fan normal force, bypass part. */
  'fanTip',
  'fanLoss',
  'fanOgv',
  /** Booster IGV, rotors and stators: normal force. */
  'boosterTurning',
  'boosterLoss',
  'hpcRotor',
  /** HPC stators, the variable ones included. */
  'hpcStator',
  'hpcLoss',
  /** HPT nozzle flow capacity: scales the metal blockage deficit 1 - b. */
  'hptNozzle',
  /** HPT rotor follow-camber rate. */
  'hptRotor',
  /** LPT nozzles' flow capacity: scales 1 - b. */
  'lptNozzle',
  'lptRotor',
  'turbineLoss',
  /** Core and bypass nozzle throats: a blockage on the last cells of each duct (1 = none). */
  'coreNozzle',
  'bypassNozzle',
] as const;

export type KnobId = (typeof KNOB_IDS)[number];
export type Knobs = Readonly<Record<KnobId, number>>;

export const UNIT_KNOBS: Knobs = Object.fromEntries(KNOB_IDS.map((k) => [k, 1])) as Record<
  KnobId,
  number
>;

/** The knobs one row cell answers to: its turning (normal force or rate), its loss, its flow. */
export interface RowKnobs {
  readonly turning: KnobId | null;
  readonly loss: KnobId;
  readonly flow: KnobId | null;
}

/**
 * The knob family of a row cell. The fan is split at the splitter radius rSplit (its core part
 * feeds the booster, its bypass part the OGVs), so the core and bypass pressure ratios trim apart.
 * The turbine nozzles keep their follow-camber rate (their exit angle sets the swallowing
 * capacity with the blockage, so the flow knob is the blockage).
 */
export function rowKnobs(row: BladeRow, r: number, rSplit: number): RowKnobs {
  switch (row.component) {
    case 'fan':
      return { turning: r < rSplit ? 'fanHub' : 'fanTip', loss: 'fanLoss', flow: null };
    case 'bypassDuct':
      return { turning: 'fanOgv', loss: 'fanLoss', flow: null };
    case 'booster':
      return { turning: 'boosterTurning', loss: 'boosterLoss', flow: null };
    case 'hpc':
      return {
        turning: row.kind === 'rotor' ? 'hpcRotor' : 'hpcStator',
        loss: 'hpcLoss',
        flow: null,
      };
    case 'hpt':
      return row.kind === 'rotor'
        ? { turning: 'hptRotor', loss: 'turbineLoss', flow: null }
        : { turning: null, loss: 'turbineLoss', flow: 'hptNozzle' };
    case 'lpt':
      return row.kind === 'rotor'
        ? { turning: 'lptRotor', loss: 'turbineLoss', flow: null }
        : { turning: null, loss: 'turbineLoss', flow: 'lptNozzle' };
    default:
      throw new Error(`rowKnobs: no knob family for a row in ${row.component} (${row.id})`);
  }
}
