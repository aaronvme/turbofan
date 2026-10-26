// Look-dev materials (TSL node materials), worker-safe (no textures, no DOM: every pattern
// is procedural and anti-aliased with fwidth). Colours are linear-sRGB reflectances; metal F0
// values follow published measured reflectances (titanium ~0.54/0.50/0.45, nickel
// ~0.66/0.61/0.53, aluminium ~0.91). The look-dev round (LD-2, LD-5, V2-V4) set them per part
// family instead of "everything polished metal":
//
// - Nacelle: white satin paint under a thin clear coat with a faint orange-peel normal,
//   panel joints and fastener rows; the inlet lip is polished (not mirror) aluminium with
//   circumferential brushing.
// - Fan: satin titanium, brushed along the span, a lighter eroded leading edge, a little
//   per-blade variation so the highlights break up.
// - Cases: matte painted/cast grey (metalness <= 0.3). Hot section: dull superalloy with a
//   low-chroma heat tint graded along x from the combustor exit.
// - Spinner: matte dark paint with the white spiral, in the spinner's own frame.
// - Caps: one distinct section colour (signal red-orange, darker for composites and paint),
//   with an anti-aliased 45-degree hatch.
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
  cross,
  dot,
  exp,
  float,
  floor,
  Fn,
  fract,
  fwidth,
  hash,
  instanceIndex,
  length,
  max,
  min,
  mix,
  mrt,
  mx_fractal_noise_float,
  mx_noise_float,
  normalize,
  normalView,
  positionLocal,
  positionView,
  positionWorld,
  select,
  sign,
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
}

function phys(p: PhysParams): MeshPhysicalNodeMaterial {
  const m = new MeshPhysicalNodeMaterial({
    color: p.color,
    metalness: p.metalness,
    roughness: p.roughness,
    clearcoat: p.clearcoat ?? 0,
    clearcoatRoughness: p.clearcoatRoughness ?? 0,
  });
  if (p.anisotropy !== undefined) m.anisotropy = p.anisotropy;
  return m;
}

/**
 * A view-space normal bumped by a procedural height field (metres), from screen-space
 * derivatives (Mikkelsen's surface-gradient bump).
 */
function bumpNormal(height: F, scale: number): Node<'vec3'> {
  return Fn(() => {
    const dpdx = positionView.dFdx();
    const dpdy = positionView.dFdy();
    const n = normalView;
    const r1 = cross(dpdy, n);
    const r2 = cross(n, dpdx);
    const det = dot(dpdx, r1);
    const dhdx = height.dFdx();
    const dhdy = height.dFdy();
    const grad = r1.mul(dhdx).add(r2.mul(dhdy)).mul(sign(det));
    return normalize(abs(det).mul(n).sub(grad.mul(scale)));
  })();
}

/** 1 where a pattern of period `period` is resolved, 0 where it is finer than a pixel. */
const fade = (footprint: F, period: number): F =>
  float(1).sub(smoothstep(0.25, 0.7, footprint.div(period)));
const resolved = (coord: Node<'vec2'>, period: number): F => fade(length(fwidth(coord)), period);
const resolved1 = (coord: F, period: number): F => fade(fwidth(coord), period);

/** An anti-aliased line of half-width w at distance d (fwidth of d sets the filter). */
const aaLine = (d: F, w: number): F => {
  const aa = fwidth(d).max(1e-5);
  return float(1).sub(smoothstep(float(w).sub(aa), float(w).add(aa), d));
};

/**
 * Heat tint of the hot section, graded along the engine (x, m): strongest just aft of the
 * combustor (HPT, x ~ 1.75-1.9), fading through the LPT. Low chroma: straw to a grey bronze
 * to a faint blue, over a broad noise, so it reads as oxidised metal, not wood grain.
 */
function heatTint(base: Node<'vec3'>, u: LookUniforms, amount: number): Node<'vec3'> {
  const x = positionLocal.x;
  const z = x.sub(1.82).div(0.32);
  const zone = exp(z.mul(z).negate());
  const n = mx_fractal_noise_float(positionLocal.mul(vec3(1.5, 3, 3)), 2, 2, 0.5)
    .mul(0.5)
    .add(0.5);
  const t = zone.mul(0.75).add(n.mul(0.35)).clamp(0, 1);
  const straw = vec3(1.04, 0.98, 0.86);
  const bronze = vec3(0.92, 0.82, 0.72);
  const blue = vec3(0.82, 0.85, 0.92);
  const ramp = mix(mix(straw, bronze, smoothstep(0.3, 0.6, t)), blue, smoothstep(0.65, 0.95, t));
  const k = u.heat.mul(amount).mul(zone.mul(0.7).add(0.3));
  return base.mul(mix(vec3(1, 1, 1), ramp, k));
}

/**
 * Satin paint: a faint orange peel on the normal (LD-2). A single lobe: a separate clear coat
 * doubled the cost of the largest surfaces on screen for little visible difference.
 */
function satinPaint(m: MeshPhysicalNodeMaterial, peel: number): void {
  const p = positionLocal;
  const h = mx_noise_float(p.mul(260)).mul(resolved(p.xy, 1 / 260));
  m.normalNode = bumpNormal(h, peel);
}

function partMaterial(kind: PartMaterial, u: LookUniforms): NodeMaterial {
  let m: MeshPhysicalNodeMaterial;
  const x = positionLocal.x;
  const th = atan(positionLocal.z, positionLocal.y);
  const r = length(positionLocal.yz);
  switch (kind) {
    case 'nacellePaint': {
      const white = vec3(0.78, 0.785, 0.79);
      m = phys({ color: c3(0.78, 0.785, 0.79), metalness: 0, roughness: 0.34 });
      satinPaint(m, 4e-6);
      // circumferential joints (inlet / fan cowl / reverser), hinge lines either side of the
      // top and the latch line at the bottom, fastener rows 12 mm aft of each joint
      const lineAt = (x0: number) => aaLine(abs(x.sub(x0)), 0.0011);
      const joints = max(max(lineAt(-0.55), lineAt(0.35)), lineAt(1.05));
      const aft = smoothstep(0.34, 0.36, x);
      const arcTo = (t0: number) => abs(wrapPi(th.sub(t0))).mul(r);
      const longi = max(
        max(aaLine(arcTo(0.16), 0.0011), aaLine(arcTo(-0.16), 0.0011)),
        aaLine(arcTo(Math.PI), 0.0011),
      ).mul(aft);
      const rowX = min(min(abs(x.sub(-0.538)), abs(x.sub(0.362))), abs(x.sub(1.062)));
      const along = fract(th.mul(r).div(0.045)).sub(0.5).abs().mul(0.045);
      const rivet = aaLine(length(vec2(rowX, along)), 0.0016).mul(
        resolved(vec2(x, th.mul(r)), 0.045),
      );
      const seam = max(max(joints, longi), rivet.mul(0.7));
      // a subtle large-scale paint variation, so the white is not a flat CG white
      const mottle = mx_fractal_noise_float(positionLocal.mul(1.7), 2, 2, 0.5).mul(0.015);
      m.colorNode = white.mul(float(1).sub(seam.mul(0.45))).add(mottle);
      m.roughnessNode = float(0.34).add(seam.mul(0.3));
      break;
    }
    case 'inletLip':
      m = phys({ color: c3(0.86, 0.87, 0.875), metalness: 1, roughness: 0.24, anisotropy: 0.55 });
      m.anisotropyNode = vec2(0.55, 0);
      m.roughnessNode = float(0.24).add(
        mx_noise_float(positionLocal.mul(vec3(30, 4, 4))).mul(0.03),
      );
      break;
    case 'acousticLiner': {
      m = phys({ color: c3(0.2, 0.205, 0.21), metalness: 0.15, roughness: 0.72 });
      // perforated face sheet: 1.5 mm holes on a 5 mm grid, faded where sub-pixel (V3)
      const g = vec2(x, th.mul(r)).div(0.005);
      const hole = float(1).sub(smoothstep(0.12, 0.2, length(fract(g).sub(0.5))));
      const k = resolved(g, 1);
      m.colorNode = vec3(0.2, 0.205, 0.21).mul(
        float(1).sub(hole.mul(0.6).mul(k)).sub(float(1).sub(k).mul(0.1)),
      );
      break;
    }
    case 'fanCase':
      // painted aluminium containment case: a dark grey satin
      m = phys({ color: c3(0.11, 0.115, 0.11), metalness: 0.2, roughness: 0.55 });
      m.colorNode = vec3(0.11, 0.115, 0.11).add(
        mx_fractal_noise_float(positionLocal.mul(3), 2, 2, 0.5).mul(0.012),
      );
      break;
    case 'splitter':
      m = phys({ color: c3(0.7, 0.7, 0.7), metalness: 1, roughness: 0.3, anisotropy: 0.4 });
      m.anisotropyNode = vec2(0.4, 0);
      break;
    case 'cowlPaint':
      m = phys({ color: c3(0.34, 0.35, 0.36), metalness: 0, roughness: 0.45 });
      break;
    case 'compressorCase':
      m = phys({ color: c3(0.3, 0.3, 0.29), metalness: 0.3, roughness: 0.6 });
      m.roughnessNode = float(0.6).add(mx_noise_float(positionLocal.mul(12)).mul(0.05));
      break;
    case 'combustorCase':
    case 'turbineCase': {
      const base = kind === 'combustorCase' ? vec3(0.46, 0.44, 0.41) : vec3(0.44, 0.42, 0.39);
      m = phys({ color: c3(0.45, 0.43, 0.4), metalness: 0.8, roughness: 0.52 });
      m.colorNode = heatTint(base, u, 0.9);
      m.roughnessNode = float(0.52).add(mx_noise_float(positionLocal.mul(9)).mul(0.06));
      break;
    }
    case 'combustorLiner': {
      // thermal-barrier-coated liner: a pale ceramic, scorched toward the exit
      m = phys({ color: c3(0.62, 0.58, 0.52), metalness: 0, roughness: 0.7 });
      const burn = smoothstep(1.55, 1.74, x).mul(u.heat);
      m.colorNode = mix(vec3(0.62, 0.58, 0.52), vec3(0.36, 0.3, 0.26), burn.mul(0.7));
      break;
    }
    case 'exhaust':
    case 'plug': {
      const base = kind === 'plug' ? vec3(0.4, 0.39, 0.37) : vec3(0.44, 0.43, 0.41);
      m = phys({ color: c3(0.42, 0.41, 0.39), metalness: 0.75, roughness: 0.5 });
      const soot = mx_fractal_noise_float(positionLocal.mul(vec3(2.5, 9, 9)), 3, 2, 0.5)
        .mul(0.5)
        .add(0.5);
      m.colorNode = heatTint(base, u, 0.5).mul(float(1).sub(soot.mul(0.12)));
      m.roughnessNode = mix(float(0.42), float(0.62), soot);
      break;
    }
    case 'spinner': {
      m = phys({ color: c3(0.035, 0.036, 0.038), metalness: 0, roughness: 0.42 });
      m.colorNode = spinnerSpiral();
      // the spinner turns with the fan and is drawn (and blurred) in the rotor pass
      m.mrtNode = mrt({ blur: vec4(u.lpBlur, TWO_PI, 0, 1) });
      break;
    }
    case 'drum':
    case 'disk':
      m = phys({ color: c3(0.62, 0.6, 0.57), metalness: 1, roughness: 0.36, anisotropy: 0.4 });
      m.anisotropyNode = vec2(0.4, 0);
      break;
    case 'innerCase':
      m = phys({ color: c3(0.32, 0.32, 0.31), metalness: 0.3, roughness: 0.6 });
      break;
    case 'shaft':
      m = phys({ color: c3(0.62, 0.62, 0.6), metalness: 1, roughness: 0.3, anisotropy: 0.6 });
      m.anisotropyNode = vec2(0.6, 0);
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
  return mix(vec3(0.035, 0.036, 0.038), vec3(0.8, 0.8, 0.79), white);
}

/** Section colours (LD-4): one red-orange family, darker for paint and composites. */
const CAP_TINT: Readonly<Record<PartMaterial, readonly [number, number, number]>> = {
  inletLip: [0.62, 0.14, 0.06],
  nacellePaint: [0.42, 0.1, 0.05],
  acousticLiner: [0.32, 0.09, 0.05],
  fanCase: [0.5, 0.12, 0.05],
  splitter: [0.62, 0.14, 0.06],
  cowlPaint: [0.42, 0.1, 0.05],
  compressorCase: [0.62, 0.14, 0.06],
  combustorCase: [0.7, 0.22, 0.05],
  turbineCase: [0.7, 0.22, 0.05],
  exhaust: [0.66, 0.2, 0.06],
  plug: [0.66, 0.2, 0.06],
  spinner: [0.42, 0.1, 0.05],
  drum: [0.62, 0.14, 0.06],
  disk: [0.62, 0.14, 0.06],
  innerCase: [0.62, 0.14, 0.06],
  shaft: [0.55, 0.12, 0.05],
  combustorLiner: [0.7, 0.3, 0.08],
};

function capMaterial(kind: PartMaterial): NodeMaterial {
  const [r, g, b] = CAP_TINT[kind];
  const m = new MeshStandardNodeMaterial({ metalness: 0, roughness: 0.6 });
  // 45-degree hatching every 6 mm in the section plane (cap uv is (x, r) in metres),
  // anti-aliased, fading to the mean tone where the lines are finer than a pixel
  const s = uv().x.add(uv().y).div(0.006);
  const d = abs(fract(s).sub(0.5));
  const line = aaLine(float(0.5).sub(d), 0.09);
  const k = resolved1(s, 1);
  const base = vec3(r, g, b);
  m.colorNode = mix(base, base.mul(0.45), line.mul(k).add(float(1).sub(k).mul(0.18)));
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

/** Per-blade variation in [-1, 1] (V2: identical blades give one identical highlight each). */
const bladeJitter = (): F => hash(instanceIndex).mul(2).sub(1);

function rowSurface(kind: RowMaterial, u: LookUniforms): MeshPhysicalNodeMaterial {
  const span = uv().y;
  const chord = uv().x;
  const jit = bladeJitter();
  switch (kind) {
    case 'fanBlade': {
      const ti = vec3(0.54, 0.51, 0.47);
      const m = phys({
        color: c3(0.54, 0.51, 0.47),
        metalness: 1,
        roughness: 0.3,
        anisotropy: 0.6,
      });
      m.anisotropyNode = vec2(0, 0.6);
      // leading-edge erosion: a slightly brighter, rougher band along the first few % of chord
      const le = float(1).sub(smoothstep(0.0, 0.05, chord));
      const grain = mx_noise_float(positionLocal.mul(vec3(30, 260, 260))).mul(0.03);
      m.colorNode = ti.mul(float(1).add(le.mul(0.08)).add(jit.mul(0.02)));
      m.roughnessNode = float(0.3).add(le.mul(0.1)).add(grain).add(jit.mul(0.025));
      return m;
    }
    case 'compressorBlade': {
      const m = phys({
        color: c3(0.58, 0.56, 0.53),
        metalness: 1,
        roughness: 0.4,
        anisotropy: 0.3,
      });
      m.roughnessNode = float(0.4).add(jit.mul(0.07));
      m.colorNode = vec3(0.58, 0.56, 0.53).mul(float(1).add(jit.mul(0.03)));
      return m;
    }
    case 'compressorVane': {
      const m = phys({ color: c3(0.5, 0.49, 0.47), metalness: 1, roughness: 0.46 });
      m.roughnessNode = float(0.46).add(jit.mul(0.07));
      return m;
    }
    case 'strut':
      return phys({ color: c3(0.34, 0.34, 0.33), metalness: 0.3, roughness: 0.58 });
    case 'hptBlade':
    case 'hptVane': {
      const vane = kind === 'hptVane';
      const m = phys({ color: c3(0.7, 0.64, 0.54), metalness: 0, roughness: 0.62 });
      const burn = smoothstep(0.35, 1, chord.mul(0.6).add(span.mul(vane ? 0.2 : 0.55)))
        .mul(u.heat)
        .add(mx_fractal_noise_float(positionLocal.mul(160), 2, 2, 0.5).mul(0.08));
      const tbc = vec3(0.7, 0.64, 0.54);
      const scorched = vec3(0.34, 0.27, 0.21);
      m.colorNode = mix(tbc, scorched, burn.clamp(0, 1).mul(0.8)).mul(float(1).add(jit.mul(0.04)));
      m.roughnessNode = float(0.62).add(jit.mul(0.05));
      return m;
    }
    case 'lptBlade':
    case 'lptVane': {
      const m = phys({ color: c3(0.5, 0.48, 0.45), metalness: 0.85, roughness: 0.48 });
      m.colorNode = heatTint(vec3(0.5, 0.48, 0.45), u, kind === 'lptVane' ? 0.8 : 0.6).mul(
        float(1).add(jit.mul(0.04)),
      );
      m.roughnessNode = float(0.48).add(jit.mul(0.07));
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
          // b = 1 marks fan blades: the fan blur march hits only them (src/render/post.ts)
          const fanFlag = kind === 'fanBlade' ? 1 : 0;
          m.mrtNode = mrt({
            blur: vec4(spool === 'lp' ? u.lpBlur : u.hpBlur, pitch, fanFlag, 1),
          });
        }
        return m;
      }),
    dispose: () => {
      for (const m of cache.values()) m.dispose();
      cache.clear();
    },
  };
}
