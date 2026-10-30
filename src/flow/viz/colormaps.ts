// Perceptually ordered colour maps for the cut-plane fields and their legend (w2/flowviz).
//
// viridis and inferno are matplotlib's (van der Walt and Smith, CC0), evaluated with the
// degree-6 polynomial fits by Matt Zucker (Shadertoy WlfXRN, CC0), within 0.02 of the listed
// maps (tests/unit/flow/viz/colormaps.test.ts). The diverging map is built here in CIELAB:
// straight lines from a blue and a red of equal L* to a near-white centre, so its lightness is
// symmetric about the ambient and rises monotonically toward it. Values are sRGB-encoded (like
// matplotlib's); the GPU samples a 256-texel LUT baked from these functions (bakeLut), so the
// shader and the tests read the same colours.

export type Rgb = readonly [number, number, number];

type Poly = readonly (readonly [number, number, number])[];

const VIRIDIS: Poly = [
  [0.2777273272234177, 0.005407344544966578, 0.3340998053353061],
  [0.1050930431085774, 1.404613529898575, 1.384590162594685],
  [-0.3308618287255563, 0.214847559468213, 0.09509516302823659],
  [-4.634230498983486, -5.799100973351585, -19.33244095627987],
  [6.228269936347081, 14.17993336680509, 56.69055260068105],
  [4.776384997670288, -13.74514537774601, -65.35303263337234],
  [-5.435455855934631, 4.645852612178535, 26.3124352495832],
];

const INFERNO: Poly = [
  [0.0002189403691192265, 0.001651004631001012, -0.01948089843709184],
  [0.1065134194856116, 0.5639564367884091, 3.932712388889277],
  [11.60249308247187, -3.972853965665698, -15.9423941062914],
  [-41.70399613139459, 17.43639888205313, 44.35414519872813],
  [77.162935699427, -33.40235894210092, -81.80730925738993],
  [-71.31942824499214, 32.62606426397723, 73.20951985803202],
  [25.13112622477341, -12.24266895238567, -23.07032500287172],
];

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

function evalPoly(c: Poly, t: number): Rgb {
  const out = [0, 0, 0];
  for (let ch = 0; ch < 3; ch++) {
    let v = 0;
    for (let k = c.length - 1; k >= 0; k--) v = v * t + (c[k]?.[ch] ?? 0);
    out[ch] = clamp01(v);
  }
  return [out[0] ?? 0, out[1] ?? 0, out[2] ?? 0];
}

export function srgbToLinear(v: number): number {
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

export function linearToSrgb(v: number): number {
  const c = clamp01(v);
  return c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
}

// D65 reference white (CIE 15:2004)
const XN = 0.95047;
const ZN = 1.08883;
const EPS = 216 / 24389;
const KAPPA = 24389 / 27;

/** CIE L* of an sRGB-encoded colour. */
export function lightnessL(c: Rgb): number {
  const y = 0.2126 * srgbToLinear(c[0]) + 0.7152 * srgbToLinear(c[1]) + 0.0722 * srgbToLinear(c[2]);
  return y > EPS ? 116 * Math.cbrt(y) - 16 : KAPPA * y;
}

function labToSrgb(l: number, a: number, b: number): Rgb {
  const fy = (l + 16) / 116;
  const fx = fy + a / 500;
  const fz = fy - b / 200;
  const inv = (f: number) => (f ** 3 > EPS ? f ** 3 : (116 * f - 16) / KAPPA);
  const x = XN * inv(fx);
  const y = l > KAPPA * EPS ? fy ** 3 : l / KAPPA;
  const z = ZN * inv(fz);
  return [
    linearToSrgb(3.2406 * x - 1.5372 * y - 0.4986 * z),
    linearToSrgb(-0.9689 * x + 1.8758 * y + 0.0415 * z),
    linearToSrgb(0.0557 * x - 0.204 * y + 1.057 * z),
  ];
}

// CIELAB anchors of the diverging map: in the sRGB gamut, equal L* at both ends
const DIV_LOW = [42, 14, -54] as const;
const DIV_MID = [94, 0, 0] as const;
const DIV_HIGH = [42, 58, 36] as const;

function diverging(t: number): Rgb {
  const [from, u] = t < 0.5 ? [DIV_LOW, t / 0.5] : [DIV_HIGH, (1 - t) / 0.5];
  const lab = [0, 1, 2].map((k) => (from[k] ?? 0) + u * ((DIV_MID[k] ?? 0) - (from[k] ?? 0)));
  return labToSrgb(lab[0] ?? 0, lab[1] ?? 0, lab[2] ?? 0);
}

export const COLORMAPS = {
  viridis: (t: number) => evalPoly(VIRIDIS, t),
  inferno: (t: number) => evalPoly(INFERNO, t),
  diverging,
} as const satisfies Readonly<Record<string, (t: number) => Rgb>>;

export type ColormapId = keyof typeof COLORMAPS;

/** The colour of t in [0, 1] (clamped), sRGB-encoded. */
export function colormap(id: ColormapId, t: number): Rgb {
  return COLORMAPS[id](clamp01(t));
}

/** A `size`-texel RGBA8 LUT of a map (sRGB-encoded bytes), for the GPU. */
export function bakeLut(id: ColormapId, size = 256): Uint8Array {
  const out = new Uint8Array(4 * size);
  for (let i = 0; i < size; i++) {
    const c = colormap(id, i / (size - 1));
    for (let ch = 0; ch < 3; ch++) out[4 * i + ch] = Math.round(255 * (c[ch] ?? 0));
    out[4 * i + 3] = 255;
  }
  return out;
}

/** Legend ticks: a 1-2-5 step giving about `count` intervals, covering [min, max]. */
export function niceTicks(min: number, max: number, count: number): number[] {
  if (!(max > min)) return [min];
  const rough = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(rough));
  const step = ([1, 2, 5, 10].find((c) => c * mag >= rough * (1 - 1e-9)) ?? 10) * mag;
  const decimals = Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
  const k0 = Math.floor(min / step + 1e-9);
  const k1 = Math.ceil(max / step - 1e-9);
  const out: number[] = [];
  for (let k = k0; k <= k1; k++) out.push(Number((k * step).toFixed(decimals)) + 0);
  return out;
}
