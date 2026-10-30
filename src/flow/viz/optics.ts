// Optics of the flow visuals (w2/flowviz), pure and unit-tested; the WGSL/TSL shaders mirror it.
//
// Refraction (schlieren, heat haze): the Gladstone-Dale relation n - 1 = K rho, with K for air
// from Edlen's dispersion formula for standard air (Metrologia 2 (1966) 71, eq. 1: 15 C,
// 101325 Pa, dry, 0.03 % CO2) divided by that air's density. Combustion products differ from
// air by under 1 % in K at the core FAR, which the haze ignores (PHYSICS.md 1).
//
// Blackbody colour: Planck's law (CODATA 2018 exact h, c, k) weighted by the CIE 1931 2 deg
// colour-matching functions in the multi-lobe fit of Wyman, Sloan and Shirley, "Simple
// Analytic Approximations to the CIE XYZ Color Matching Functions", JCGT 2(2) (2013), then
// XYZ -> linear sRGB (IEC 61966-2-1, D65).

const H = 6.62607015e-34;
const C = 299792458;
const KB = 1.380649e-23;
/** Luminous efficacy of 555 nm radiation, lm/W (SI definition of the candela). */
const KM = 683;

/** Density of Edlen's standard air (15 C, 101325 Pa, dry) = the ISA sea-level density, kg/m^3. */
export const STD_AIR_DENSITY = 1.225;

/** (n - 1) of standard air at a vacuum wavelength in nm (Edlen 1966, eq. 1). */
export function edlenRefractivity(lambdaNm: number): number {
  const s2 = (1000 / lambdaNm) ** 2; // sigma^2, um^-2
  return (8342.13 + 2406030 / (130 - s2) + 15997 / (38.9 - s2)) * 1e-8;
}

/** The Gladstone-Dale constant of air, m^3/kg, at a wavelength in nm. */
export function gladstoneDaleK(lambdaNm: number): number {
  return edlenRefractivity(lambdaNm) / STD_AIR_DENSITY;
}

export function refractiveIndex(rhoKgPerM3: number, k: number): number {
  return 1 + k * rhoKgPerM3;
}

/**
 * Small-angle deflection of a ray crossing `pathM` of gas with a mean transverse density
 * gradient `gradRho` (kg/m^4): eps = (1/n) dn/dy L, with n = 1 to first order in K rho.
 */
export function hazeDeflectionRad(gradRho: number, pathM: number, k: number): number {
  return k * gradRho * pathM;
}

/** Planck spectral radiance B(lambda, T), W sr^-1 m^-3 (lambda in m). */
export function planckRadiance(lambdaM: number, tK: number): number {
  return (2 * H * C * C) / lambdaM ** 5 / Math.expm1((H * C) / (lambdaM * KB * tK));
}

const lobe = (l: number, mu: number, s1: number, s2: number): number => {
  const t = (l - mu) / (l < mu ? s1 : s2);
  return Math.exp(-0.5 * t * t);
};

/** CIE 1931 2 deg xbar, ybar, zbar at lambda nm (Wyman, Sloan, Shirley 2013, the multi-lobe fit). */
export function cieXyzBar(l: number): [number, number, number] {
  return [
    1.056 * lobe(l, 599.8, 37.9, 31.0) +
      0.362 * lobe(l, 442.0, 16.0, 26.7) -
      0.065 * lobe(l, 501.1, 20.4, 26.2),
    0.821 * lobe(l, 568.8, 46.9, 40.5) + 0.286 * lobe(l, 530.9, 16.3, 31.1),
    1.217 * lobe(l, 437.0, 11.8, 36.0) + 0.681 * lobe(l, 459.0, 26.0, 13.8),
  ];
}

/** XYZ of a blackbody, W sr^-1 m^-2 per unit CMF (1 nm steps over 360-830 nm). */
function blackbodyXyz(tK: number): [number, number, number] {
  let x = 0;
  let y = 0;
  let z = 0;
  for (let l = 360; l <= 830; l++) {
    const b = planckRadiance(l * 1e-9, tK) * 1e-9;
    const [xb, yb, zb] = cieXyzBar(l);
    x += b * xb;
    y += b * yb;
    z += b * zb;
  }
  return [x, y, z];
}

/** CIE 1931 (x, y) chromaticity of a blackbody at T. */
export function blackbodyChromaticity(tK: number): { x: number; y: number } {
  const [x, y, z] = blackbodyXyz(tK);
  const s = x + y + z;
  return { x: x / s, y: y / s };
}

/** Luminance of a blackbody surface, cd/m^2. */
export function blackbodyLuminance(tK: number): number {
  return KM * blackbodyXyz(tK)[1];
}

/**
 * The blackbody's colour in linear sRGB, scaled to a max channel of 1. Below about 1900 K the
 * locus lies outside the sRGB gamut; it is brought in by adding white (lifting the most
 * negative channel to 0), which keeps the hue and loses some saturation.
 */
export function blackbodyLinearSrgb(tK: number): [number, number, number] {
  const [x, y, z] = blackbodyXyz(tK);
  const rgb = [
    3.2406 * x - 1.5372 * y - 0.4986 * z,
    -0.9689 * x + 1.8758 * y + 0.0415 * z,
    0.0557 * x - 0.204 * y + 1.057 * z,
  ];
  const lift = Math.max(0, -Math.min(...rgb));
  const lifted = rgb.map((v) => v + lift);
  const m = Math.max(...lifted);
  return [(lifted[0] ?? 0) / m, (lifted[1] ?? 0) / m, (lifted[2] ?? 0) / m];
}
