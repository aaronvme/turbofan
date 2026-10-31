// The engine's own Greitzer compression system (decision D3-4), derived from the definition and
// the scaled HPC map instead of fixed parameters. Pure.
//
// - Compressor duct (Greitzer 1976): the HPC from station 25 to station 3. Its reference area A_c
//   is the HPC inlet annulus and its effective length L_c = A_c * integral dx / A(x), so that the
//   duct's inertance L_c / A_c is that of the real, converging annulus.
// - Plenum: the volume downstream of the compressor up to the HPT nozzle throat, i.e. the HPC exit
//   diffuser and the combustor (stations 3 to 4): V_p = integral A(x) dx.
// - Helmholtz frequency omega_H = a_3 sqrt(A_c / (V_p L_c)), a_3 the speed of sound at T3;
//   B = U / (2 omega_H L_c), U the HPC rotor-1 tip speed at the current N2.
// - Characteristic: the Moore-Greitzer cubic Psi_c = psi0 + H (1 + 1.5 x - 0.5 x^3), x = Phi/W - 1,
//   fitted to the HPC map's current speed line in the duct's own variables, Phi = W_25 / (rho_25
//   A_c U) and Psi = (P3 - P25) / (0.5 rho_25 U^2): its peak (Phi = 2W) is the map's stall-line
//   point, and H is the least-squares fit to the speed line's R-line points on the stable side,
//   with the shut-off head psi0 = Psi_c(0) bounded below (SHUTOFF_TO_PEAK_MIN). Beyond the stall
//   line (and into reverse flow) the cubic is the map's extension.

import type { EngineDefinition, FlowComponent } from '../contracts/engine';
import { casingRadiusAt, hubRadiusAt } from '../contracts/engine';
import { compressorPoint, type ScaledCompressorMap } from './componentMaps';
import type { GreitzerParams } from './greitzer';

const P_STD = 101325;
const T_STD = 288.15;
/**
 * Lowest shut-off head Psi_c(0) as a fraction of the peak: 0.3 / 0.66, the ratio of the standard
 * Moore-Greitzer example characteristic (psi_c0 0.3, H 0.18, W 0.25; J. T. Gravdahl and
 * O. Egeland, Compressor Surge and Rotating Stall, Springer 1999), the C9 test system.
 */
export const SHUTOFF_TO_PEAK_MIN = 0.3 / 0.66;
/** Integration panels per metre of duct (the flowpath polylines are piecewise linear). */
const PANELS_PER_M = 2000;

export interface CompressionSystem {
  /** HPC inlet annulus, m^2. */
  readonly ductAreaM2: number;
  /** Effective duct length A_c * integral dx / A, m. */
  readonly ductLengthM: number;
  /** HPC exit to HPT nozzle (stations 3 to 4), m^3. */
  readonly plenumVolumeM3: number;
  /** HPC rotor-1 leading-edge tip radius, m. */
  readonly tipRadiusM: number;
}

function coreAnnulusArea(def: EngineDefinition, x: number): number {
  const fp = def.flowpath;
  const inside = (c: FlowComponent) => c.stream !== 'bypass' && x >= c.xStart && x <= c.xEnd;
  const c = fp.components.find(inside);
  const rh = c === undefined ? null : hubRadiusAt(fp, c, x);
  const rc = c === undefined ? null : casingRadiusAt(fp, c, x);
  if (rh === null || rc === null || !(rc > rh)) {
    throw new Error(`no core annulus at x = ${x} m`);
  }
  return Math.PI * (rc * rc - rh * rh);
}

/** Midpoint rule on panels fine enough for the piecewise-linear walls. */
function integrate(f: (x: number) => number, a: number, b: number): number {
  const n = Math.max(16, Math.ceil((b - a) * PANELS_PER_M));
  const h = (b - a) / n;
  let s = 0;
  for (let i = 0; i < n; i++) s += f(a + (i + 0.5) * h);
  return s * h;
}

function stationX(def: EngineDefinition, id: string): number {
  const s = def.stations.find((p) => p.id === id);
  if (s === undefined) throw new Error(`definition has no station ${id}`);
  return s.x;
}

/** The HPC compression system of a definition (stations 25, 3 and 4; the first HPC rotor). */
export function compressionSystem(def: EngineDefinition): CompressionSystem {
  const x25 = stationX(def, '25');
  const x3 = stationX(def, '3');
  const x4 = stationX(def, '4');
  const area = (x: number) => coreAnnulusArea(def, x);
  const ductAreaM2 = area(x25);
  const rotor = def.bladeRows.find((r) => r.component === 'hpc' && r.kind === 'rotor');
  if (rotor === undefined) throw new Error('definition has no HPC rotor');
  return {
    ductAreaM2,
    ductLengthM: ductAreaM2 * integrate((x) => 1 / area(x), x25, x3),
    plenumVolumeM3: integrate(area, x3, x4),
    tipRadiusM: rotor.leadingEdge.tip.r,
  };
}

/** Helmholtz frequency omega_H = a sqrt(A_c / (V_p L_c)), rad/s. */
export function systemHelmholtzFrequency(sys: CompressionSystem, soundSpeed: number): number {
  return soundSpeed * Math.sqrt(sys.ductAreaM2 / (sys.plenumVolumeM3 * sys.ductLengthM));
}

/** Greitzer B = U / (2 omega_H L_c) at a spool speed (rpm) and HPC exit sound speed. */
export function greitzerB(sys: CompressionSystem, n2Rpm: number, soundSpeed: number): number {
  const u = (n2Rpm * 2 * Math.PI * sys.tipRadiusM) / 60;
  return u / (2 * systemHelmholtzFrequency(sys, soundSpeed) * sys.ductLengthM);
}

/** HPC inlet state and speed the duct variables are formed with. */
export interface DuctInlet {
  readonly pt25Pa: number;
  readonly tt25K: number;
  readonly n2Rpm: number;
  /** Gas constant of the inlet air, J/(kg K). */
  readonly rJPerKgK: number;
}

export interface CubicFit {
  readonly psi0: number;
  readonly h: number;
  readonly w: number;
  /** RMS misfit of Psi over the fitted R-line points (same units as Psi). */
  readonly rms: number;
}

/** Phi and Psi of a map point (corrected flow, PR) in the duct's variables. */
export function ductVariables(
  sys: CompressionSystem,
  inlet: DuctInlet,
  correctedFlow: number,
  pressureRatio: number,
): { readonly phi: number; readonly psi: number } {
  const rho = inlet.pt25Pa / (inlet.rJPerKgK * inlet.tt25K);
  const u = (inlet.n2Rpm * 2 * Math.PI * sys.tipRadiusM) / 60;
  const w = (correctedFlow * (inlet.pt25Pa / P_STD)) / Math.sqrt(inlet.tt25K / T_STD);
  return {
    phi: w / (rho * sys.ductAreaM2 * u),
    psi: (inlet.pt25Pa * (pressureRatio - 1)) / (0.5 * rho * u * u),
  };
}

/**
 * The Moore-Greitzer cubic of the HPC map's speed line at speedFraction (of design corrected
 * speed): peak on the map's stall point, H by least squares over the R-lines above stall.
 */
export function hpcCubic(
  map: ScaledCompressorMap,
  speedFraction: number,
  sys: CompressionSystem,
  inlet: DuctInlet,
): CubicFit {
  const point = (r: number) => {
    const p = compressorPoint(map, speedFraction, r);
    return ductVariables(sys, inlet, p.correctedFlow, p.pressureRatio);
  };
  const stall = point(map.map.rlineStall);
  const w = stall.phi / 2;
  const line = map.map.rline.filter((r) => r > map.map.rlineStall).map(point);
  // Psi_i - Psi_s = H g_i with g = 1.5 x - 0.5 x^3 - 1 (zero at the peak, x = 1)
  const g = (phi: number) => {
    const x = phi / w - 1;
    return 1.5 * x - 0.5 * x * x * x - 1;
  };
  let num = 0;
  let den = 0;
  for (const q of line) {
    num += g(q.phi) * (q.psi - stall.psi);
    den += g(q.phi) * g(q.phi);
  }
  // A rotor at zero through-flow still raises the pressure. The near-vertical high-speed lines of
  // a 9-stage HPC fit a cubic whose shut-off head is negative, so psi0 is bounded below at the
  // shut-off-to-peak ratio of the standard Moore-Greitzer example characteristic, and H follows
  // from the peak.
  const psi0 = Math.max(SHUTOFF_TO_PEAK_MIN * stall.psi, stall.psi - (2 * num) / den);
  const h = (stall.psi - psi0) / 2;
  // D4-94 (W2H-I3): above the map's top speed line (about 1.2) the extrapolated line's pressure
  // rises with flow, the shut-off head lands above the peak and H < 0: no surge characteristic, and
  // a Greitzer episode on it integrates to a NaN P3. Refused here, at its source, by name.
  if (!(h > 0)) {
    throw new RangeError(
      `HPC cubic at corrected speed ${speedFraction}: H ${Number(h.toPrecision(3))} must be > 0 (shut-off head ${Number(psi0.toPrecision(3))}, stall point ${Number(stall.psi.toPrecision(3))}): no surge characteristic on this speed line`,
    );
  }
  let sq = 0;
  for (const q of line) sq += (psi0 + h * (2 + g(q.phi)) - q.psi) ** 2;
  return { psi0, h, w, rms: Math.sqrt(sq / Math.max(1, line.length)) };
}

/**
 * The stall R-line of a compressor whose surge pressure ratio is lowered by Delta PRS = 1 -
 * PRS_reduced / PRS (SAE ARP1420's measure of the stability margin that inlet distortion, and in a
 * stability audit deterioration, uses up), on the speed line at speedFraction: the R-line whose
 * pressure ratio is (1 - Delta PRS) times the clean stall point's (bisection, 1e-10 in R). The
 * stall point moves down the speed line to a higher flow, as a worn or distorted compressor
 * stalls earlier. Throws if the lowered stall point leaves the map's last R-line.
 */
export function stallRlineForLoss(
  map: ScaledCompressorMap,
  speedFraction: number,
  surgePressureRatioLoss: number,
): number {
  const r0 = map.map.rlineStall;
  if (surgePressureRatioLoss === 0) return r0;
  const target =
    compressorPoint(map, speedFraction, r0).pressureRatio * (1 - surgePressureRatioLoss);
  let lo = r0;
  let hi = map.map.rline[map.map.rline.length - 1] ?? r0;
  if (!(compressorPoint(map, speedFraction, hi).pressureRatio <= target)) {
    throw new Error(`a ${surgePressureRatioLoss} surge pressure ratio loss leaves the map`);
  }
  while (hi - lo > 1e-10) {
    const mid = 0.5 * (lo + hi);
    if (compressorPoint(map, speedFraction, mid).pressureRatio > target) lo = mid;
    else hi = mid;
  }
  return 0.5 * (lo + hi);
}

/** The map with its stall line on another R-line (the post-surge cubic peaks there). */
export function withStallRline(map: ScaledCompressorMap, rlineStall: number): ScaledCompressorMap {
  return rlineStall === map.map.rlineStall ? map : { ...map, map: { ...map.map, rlineStall } };
}

/** Throttle coefficient whose line Phi_T = gammaT sqrt(Psi) passes through (phi, psi). */
export function throttleThrough(phi: number, psi: number): number {
  if (!(psi > 0)) throw new Error(`plenum pressure coefficient ${psi} must be > 0`);
  return phi / Math.sqrt(psi);
}

/** The engine's Greitzer parameters with the throttle through a given equilibrium flow. */
export function engineGreitzerParams(
  fit: CubicFit,
  b: number,
  phiEquilibrium: number,
): GreitzerParams {
  const x = phiEquilibrium / fit.w - 1;
  const psi = fit.psi0 + fit.h * (1 + 1.5 * x - 0.5 * x * x * x);
  return { b, psi0: fit.psi0, h: fit.h, w: fit.w, gammaT: throttleThrough(phiEquilibrium, psi) };
}
