// Look-dev materials (TSL node materials), worker-safe (no textures, no DOM: every pattern
// is procedural). Colours are linear-sRGB reflectances; metal F0 values follow published
// measured reflectances (titanium ~0.54/0.50/0.45, nickel ~0.66/0.61/0.53, aluminium ~0.91).
//
// - Fan: polished titanium, anisotropic along the span (the derivative tangent frame of the
//   blade uv: u chordwise, v spanwise).
// - Nacelle: white paint under a clearcoat, with panel lines and fastener rows; the inlet lip
//   is polished aluminium. The fan case is a dark carbon composite with a twill weave.
// - Hot section: HPT blades and vanes in a cream thermal-barrier coating that darkens and
//   browns toward the trailing edge and tip; LPT parts, cases, nozzle and plug in nickel alloy
//   with a thin-film (iridescence) oxide, i.e. heat tint (straw, bronze, blue).
// - Spinner: dark paint with the white spiral, in the spinner's own frame so it turns with it.
// - Caps: hatched section faces, one tint per part family (technical-drawing convention).
// Every solid of revolution discards the cutaway wedge (maskNode); blades hide whole
// (positionNode), see src/geometry/cutaway.ts, whose logic the TSL here mirrors.

import {
  Color,
  InstancedMesh,
  MeshPhysicalNodeMaterial,
  MeshStandardNodeMaterial,
  type Node,
  type NodeMaterial,
  type UniformNode,
} from 'three/webgpu';
import {
  abs,
  atan,
  attribute,
  float,
  floor,
  Fn,
  fract,
  fwidth,
  length,
  max,
  min,
  mix,
  mrt,
  mx_fractal_noise_float,
  mx_noise_float,
  positionLocal,
  positionWorld,
  select,
  smoothstep,
  sqrt,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import type { PartMaterial } from '../geometry/parts';
import type { RowMaterial } from '../geometry/engineGeometry';

export interface LookUniforms {
  readonly cutCenter: UniformNode<'float', number>;
  readonly cutHalf: UniformNode<'float', number>;
  readonly lpBlur: UniformNode<'float', number>;
  readonly hpBlur: UniformNode<'float', number>;
  /** 0..1: how hot the hot section is drawn (heat tint only, not emission). */
  readonly heat: UniformNode<'float', number>;
}

export function createLookUniforms(): LookUniforms {
  return {
    cutCenter: uniform(0),
    cutHalf: uniform(0),
    lpBlur: uniform(0),
    hpBlur: uniform(0),
    heat: uniform(1),
  };
}

type F = Node<'float'>;
const TWO_PI = 2 * Math.PI;
const wrapPi = (a: F): F => a.sub(floor(a.add(Math.PI).div(TWO_PI)).mul(TWO_PI));

/** False inside the cutaway wedge (the engine axis is world +x). */
function outsideWedge(u: LookUniforms): Node<'bool'> {
  const th = atan(positionWorld.z, positionWorld.y);
  const d = abs(wrapPi(th.sub(u.cutCenter)));
  return d.greaterThanEqual(u.cutHalf);
}

const c3 = (r: number, g: number, b: number) => new Color(r, g, b);

interface PhysParams {
  color: Color;
  metalness: number;
  roughness: number;
  clearcoat?: number;
  clearcoatRoughness?: number;
  anisotropy?: number;
  iridescence?: number;
}

function phys(p: PhysParams): MeshPhysicalNodeMaterial {
  const m = new MeshPhysicalNodeMaterial({
    color: p.color,
    metalness: p.metalness,
    roughness: p.roughness,
    clearcoat: p.clearcoat ?? 0,
    clearcoatRoughness: p.clearcoatRoughness ?? 0,
    iridescence: p.iridescence ?? 0,
    iridescenceIOR: 2.2,
  });
  if (p.anisotropy !== undefined) m.anisotropy = p.anisotropy;
  return m;
}

/**
 * Heat tint: the straw-bronze-blue oxide colours of nickel alloy that ran hot, as a colour
 * ramp over a low-frequency noise (an interference film reads as rainbow camouflage at this
 * scale), plus a weak first-order iridescence for the angle-dependent sheen.
 */
function heatTint(base: Node<'vec3'>, u: LookUniforms, amount: number): Node<'vec3'> {
  const n = mx_fractal_noise_float(positionLocal.mul(vec3(2.5, 6, 6)), 3, 2, 0.5)
    .mul(0.5)
    .add(0.5);
  const straw = vec3(0.62, 0.5, 0.32);
  const bronze = vec3(0.45, 0.3, 0.2);
  const blue = vec3(0.26, 0.3, 0.42);
  const ramp = mix(mix(straw, bronze, smoothstep(0.25, 0.55, n)), blue, smoothstep(0.6, 0.9, n));
  return mix(base, base.mul(ramp).mul(1.6), u.heat.mul(amount));
}

function heatFilm(): Node<'float'> {
  return float(320).add(mx_noise_float(positionLocal.mul(4)).mul(40));
}

function partMaterial(kind: PartMaterial, u: LookUniforms): NodeMaterial {
  let m: MeshPhysicalNodeMaterial;
  switch (kind) {
    case 'nacellePaint': {
      m = phys({
        color: c3(0.82, 0.83, 0.84),
        metalness: 0,
        roughness: 0.32,
        clearcoat: 1,
        clearcoatRoughness: 0.05,
      });
      const x = positionLocal.x;
      const th = atan(positionLocal.z, positionLocal.y);
      const r = length(positionLocal.yz);
      const band = (d: F, w: number) => float(1).sub(smoothstep(w * 0.5, w + 1e-4, d).max(0));
      const lineAt = (x0: number) => band(abs(x.sub(x0)), 0.0016);
      const joints = max(max(lineAt(-0.55), lineAt(0.35)), lineAt(1.05));
      // hinge lines either side of the top, latch line at the bottom (fan cowl and reverser)
      const aft = smoothstep(0.34, 0.36, x);
      const arcTo = (t0: number) => abs(wrapPi(th.sub(t0))).mul(r);
      const longi = max(
        max(band(arcTo(0.16), 0.0016), band(arcTo(-0.16), 0.0016)),
        band(arcTo(Math.PI), 0.0016),
      ).mul(aft);
      // fastener rows 12 mm aft of each circumferential joint, every 45 mm
      const rowX = min(min(abs(x.sub(-0.538)), abs(x.sub(0.362))), abs(x.sub(1.062)));
      const along = fract(th.mul(r).div(0.045)).sub(0.5).abs().mul(0.045);
      const dot = float(1).sub(smoothstep(0.0011, 0.0019, length(vec2(rowX, along))));
      const mask = max(max(joints, longi), dot.mul(0.6));
      const speck = mx_noise_float(positionLocal.mul(180)).mul(0.04);
      m.colorNode = vec3(0.82, 0.83, 0.84).mul(float(1).sub(mask.mul(0.55)));
      m.roughnessNode = float(0.32).add(mask.mul(0.35)).add(speck);
      break;
    }
    case 'inletLip':
      m = phys({ color: c3(0.9, 0.9, 0.9), metalness: 1, roughness: 0.14, anisotropy: 0.5 });
      m.anisotropyNode = vec2(0.5, 0);
      break;
    case 'acousticLiner': {
      m = phys({ color: c3(0.16, 0.165, 0.17), metalness: 0.2, roughness: 0.7 });
      // perforated face sheet: 1.5 mm holes on a 5 mm grid
      const th = atan(positionLocal.z, positionLocal.y);
      const g = vec2(positionLocal.x, th.mul(length(positionLocal.yz))).div(0.005);
      const hole = float(1).sub(smoothstep(0.12, 0.2, length(fract(g).sub(0.5))));
      m.colorNode = vec3(0.16, 0.165, 0.17).mul(float(1).sub(hole.mul(0.7)));
      break;
    }
    case 'fanCase': {
      m = phys({
        color: c3(0.035, 0.037, 0.04),
        metalness: 0,
        roughness: 0.38,
        clearcoat: 0.7,
        clearcoatRoughness: 0.12,
      });
      const th = atan(positionLocal.z, positionLocal.y);
      const g = vec2(positionLocal.x, th.mul(length(positionLocal.yz))).div(0.006);
      // 2x2 twill: tows alternate over two, under two, stepping one per row
      const cell = floor(g);
      const twill = fract(cell.x.add(cell.y).div(4)).lessThan(0.5);
      const f = fract(g);
      const tow = select(twill, f.x, f.y);
      const shade = float(0.75).add(sqrt(tow.mul(float(1).sub(tow))).mul(0.5));
      m.colorNode = vec3(0.035, 0.037, 0.04).mul(shade);
      m.roughnessNode = mix(float(0.42), float(0.3), shade.sub(0.75).mul(4));
      break;
    }
    case 'splitter':
      m = phys({ color: c3(0.6, 0.57, 0.53), metalness: 1, roughness: 0.28 });
      break;
    case 'cowlPaint':
      m = phys({
        color: c3(0.45, 0.47, 0.5),
        metalness: 0,
        roughness: 0.42,
        clearcoat: 0.6,
        clearcoatRoughness: 0.15,
      });
      break;
    case 'compressorCase':
      m = phys({ color: c3(0.62, 0.61, 0.6), metalness: 1, roughness: 0.3, anisotropy: 0.6 });
      m.anisotropyNode = vec2(0.6, 0);
      break;
    case 'combustorCase':
      m = phys({ color: c3(0.55, 0.51, 0.45), metalness: 1, roughness: 0.36, iridescence: 0.15 });
      m.iridescenceThicknessNode = heatFilm();
      m.colorNode = heatTint(vec3(0.55, 0.51, 0.45), u, 0.5);
      break;
    case 'turbineCase':
      m = phys({ color: c3(0.52, 0.47, 0.4), metalness: 1, roughness: 0.4, iridescence: 0.2 });
      m.iridescenceThicknessNode = heatFilm();
      m.colorNode = heatTint(vec3(0.52, 0.47, 0.4), u, 0.8);
      break;
    case 'exhaust':
    case 'plug': {
      const base = kind === 'plug' ? vec3(0.42, 0.39, 0.35) : vec3(0.47, 0.43, 0.38);
      m = phys({ color: c3(0.45, 0.41, 0.37), metalness: 1, roughness: 0.46, iridescence: 0.2 });
      m.iridescenceThicknessNode = heatFilm();
      m.colorNode = heatTint(base, u, 1);
      const soot = mx_fractal_noise_float(positionLocal.mul(vec3(3, 14, 14)), 4, 2, 0.5)
        .mul(0.5)
        .add(0.5);
      m.roughnessNode = mix(float(0.38), float(0.62), soot);
      break;
    }
    case 'spinner': {
      m = phys({
        color: c3(0.03, 0.032, 0.035),
        metalness: 0,
        roughness: 0.25,
        clearcoat: 1,
        clearcoatRoughness: 0.04,
      });
      m.colorNode = spinnerSpiral();
      // the spinner turns with the fan and is drawn (and blurred) in the rotor pass
      m.mrtNode = mrt({ blur: vec4(u.lpBlur, TWO_PI, 0, 1) });
      break;
    }
    case 'drum':
    case 'disk':
      m = phys({ color: c3(0.6, 0.58, 0.55), metalness: 1, roughness: 0.34, anisotropy: 0.4 });
      m.anisotropyNode = vec2(0.4, 0);
      break;
    case 'innerCase':
      m = phys({ color: c3(0.5, 0.49, 0.47), metalness: 1, roughness: 0.42 });
      break;
    case 'shaft':
      m = phys({ color: c3(0.68, 0.67, 0.65), metalness: 1, roughness: 0.22, anisotropy: 0.7 });
      m.anisotropyNode = vec2(0.7, 0);
      break;
    case 'combustorLiner':
      m = phys({ color: c3(0.55, 0.51, 0.45), metalness: 1, roughness: 0.45 });
      break;
  }
  m.maskNode = outsideWedge(u);
  return m;
}

/** The painted spiral, in the spinner's frame: a stripe winding 0.9 turn from nose to base. */
function spinnerSpiral(): Node<'vec3'> {
  const SPINNER_NOSE_X = -0.42;
  const s = positionLocal.x.sub(SPINNER_NOSE_X).div(-SPINNER_NOSE_X).clamp(0, 1);
  const th = atan(positionLocal.z, positionLocal.y);
  const centre = sqrt(s).mul(0.9 * TWO_PI);
  const d = abs(wrapPi(th.sub(centre)));
  const half = float(0.1).add(s.mul(0.28));
  const aa = fwidth(d).add(1e-4);
  const stripe = float(1).sub(smoothstep(half.sub(aa), half.add(aa), d));
  const tip = float(1).sub(smoothstep(0.035, 0.05, s));
  const white = max(stripe, tip);
  return mix(vec3(0.03, 0.032, 0.035), vec3(0.85, 0.85, 0.84), white);
}

/** Hatch tints per part family. */
const CAP_TINT: Readonly<Record<PartMaterial, readonly [number, number, number]>> = {
  inletLip: [0.75, 0.76, 0.77],
  nacellePaint: [0.8, 0.8, 0.8],
  acousticLiner: [0.32, 0.33, 0.35],
  fanCase: [0.12, 0.13, 0.14],
  splitter: [0.62, 0.6, 0.56],
  cowlPaint: [0.55, 0.56, 0.58],
  compressorCase: [0.58, 0.6, 0.64],
  combustorCase: [0.72, 0.42, 0.22],
  turbineCase: [0.7, 0.36, 0.2],
  exhaust: [0.55, 0.42, 0.32],
  plug: [0.5, 0.4, 0.32],
  spinner: [0.2, 0.2, 0.22],
  drum: [0.5, 0.55, 0.62],
  disk: [0.45, 0.5, 0.6],
  innerCase: [0.52, 0.53, 0.55],
  shaft: [0.6, 0.6, 0.62],
  combustorLiner: [0.72, 0.42, 0.22],
};

function capMaterial(kind: PartMaterial): NodeMaterial {
  const [r, g, b] = CAP_TINT[kind];
  const m = new MeshStandardNodeMaterial({ metalness: 0, roughness: 0.75 });
  // 45-degree hatching every 7 mm in the section plane (cap uv is (x, r) in metres)
  const s = uv().x.add(uv().y).div(0.007);
  const d = abs(fract(s).sub(0.5));
  const aa = fwidth(s).add(1e-4);
  const line = smoothstep(float(0.38).sub(aa), float(0.38).add(aa), d);
  const base = vec3(r, g, b);
  m.colorNode = mix(base.mul(0.82), base.mul(0.38), line);
  return m;
}

/** Hides a whole instanced blade whose angular extent touches the cutaway wedge. */
function bladeHide(
  u: LookUniforms,
  rowAngle: UniformNode<'float', number>,
  tMin: UniformNode<'float', number>,
  tMax: UniformNode<'float', number>,
): Node<'vec3'> {
  return Fn(() => {
    const ang = attribute('instanceAngle', 'float').add(rowAngle);
    const mid = abs(wrapPi(ang.add(tMin.add(tMax).mul(0.5)).sub(u.cutCenter)));
    const half = tMax.sub(tMin).mul(0.5);
    const hidden = u.cutHalf.greaterThan(0).and(mid.lessThan(u.cutHalf.add(half)));
    return select(hidden, vec3(0, 0, 0), positionLocal);
  })();
}

function rowSurface(kind: RowMaterial, u: LookUniforms): MeshPhysicalNodeMaterial {
  const span = uv().y;
  const chord = uv().x;
  switch (kind) {
    case 'fanBlade': {
      const m = phys({
        color: c3(0.56, 0.53, 0.49),
        metalness: 1,
        roughness: 0.17,
        anisotropy: 0.75,
      });
      m.anisotropyNode = vec2(0, 0.75);
      // leading-edge erosion: a slightly duller, brighter band along the first few % of chord
      const le = float(1).sub(smoothstep(0.0, 0.06, chord));
      const grain = mx_noise_float(positionLocal.mul(vec3(40, 400, 400))).mul(0.03);
      m.roughnessNode = float(0.17).add(le.mul(0.12)).add(grain);
      return m;
    }
    case 'compressorBlade':
      return phys({ color: c3(0.6, 0.58, 0.55), metalness: 1, roughness: 0.26, anisotropy: 0.4 });
    case 'compressorVane':
      return phys({ color: c3(0.55, 0.54, 0.52), metalness: 1, roughness: 0.34 });
    case 'hptBlade':
    case 'hptVane': {
      const vane = kind === 'hptVane';
      const m = phys({ color: c3(0.74, 0.67, 0.55), metalness: 0, roughness: 0.62 });
      const burn = smoothstep(0.35, 1, chord.mul(0.6).add(span.mul(vane ? 0.2 : 0.55)))
        .mul(u.heat)
        .add(mx_fractal_noise_float(positionLocal.mul(220), 3, 2, 0.5).mul(0.12));
      const tbc = vec3(0.74, 0.67, 0.55);
      const scorched = vec3(0.3, 0.2, 0.14);
      m.colorNode = mix(tbc, scorched, burn.clamp(0, 1));
      return m;
    }
    case 'strut':
      return phys({ color: c3(0.5, 0.5, 0.5), metalness: 0.3, roughness: 0.55 });
    case 'lptBlade':
    case 'lptVane': {
      const m = phys({
        color: c3(0.58, 0.52, 0.43),
        metalness: 1,
        roughness: 0.38,
        iridescence: 0.3,
      });
      m.iridescenceThicknessNode = mix(float(260), float(380), span);
      m.colorNode = heatTint(vec3(0.58, 0.52, 0.43), u, kind === 'lptVane' ? 0.7 : 0.5);
      return m;
    }
  }
}

export interface MaterialSet {
  part(kind: PartMaterial): NodeMaterial;
  cap(kind: PartMaterial): NodeMaterial;
  /**
   * A blade-row material. Per-row values (the row's rotation and angular extent) are object
   * uniforms read from the mesh's userData, so one material serves every row of its kind.
   */
  row(kind: RowMaterial, spool: 'lp' | 'hp' | null): NodeMaterial;
  dispose(): void;
}

export function createMaterials(u: LookUniforms): MaterialSet {
  const cache = new Map<string, NodeMaterial>();
  const get = (key: string, make: () => NodeMaterial) => {
    let m = cache.get(key);
    if (m === undefined) {
      m = make();
      cache.set(key, m);
    }
    return m;
  };
  return {
    part: (kind) => get(`part:${kind}`, () => partMaterial(kind, u)),
    cap: (kind) => get(`cap:${kind}`, () => capMaterial(kind)),
    row: (kind, spool) =>
      get(`row:${kind}:${String(spool)}`, () => {
        const m = rowSurface(kind, u);
        const rowAngle = uniform(0).onObjectUpdate(({ object }) => object?.parent?.rotation.x ?? 0);
        const tMin = uniform(0).onObjectUpdate(({ object }) =>
          Number(object?.userData.thetaMin ?? 0),
        );
        const tMax = uniform(0).onObjectUpdate(({ object }) =>
          Number(object?.userData.thetaMax ?? 0),
        );
        m.positionNode = bladeHide(u, rowAngle, tMin, tMax);
        if (spool !== null) {
          // the rotor pass records the angle this spool turns while the shutter is open and
          // the row's blade pitch (the image is periodic in it: see src/render/post.ts)
          const pitch = uniform(0).onObjectUpdate(({ object }) =>
            object instanceof InstancedMesh ? TWO_PI / object.count : TWO_PI,
          );
          m.mrtNode = mrt({ blur: vec4(spool === 'lp' ? u.lpBlur : u.hpBlur, pitch, 0, 1) });
        }
        return m;
      }),
    dispose: () => {
      for (const m of cache.values()) m.dispose();
      cache.clear();
    },
  };
}
