p='src/render/flowViz.ts'
s=open(p,encoding='utf-8').read()
def rep(old,new):
    global s
    assert old in s, old[:80]
    s=s.replace(old,new,1)
# revert debug
rep("If(behindEngine(vZ).and(float(0).greaterThan(1)), () => {","If(behindEngine(vZ), () => {")
rep("const SHEET_HALF_M = 3;","const SHEET_HALF_M = 0.03;")
rep("const MAX_STREAK_M = 0.16;","const MAX_STREAK_M = 0.45;")
rep("  planeMaterial.depthWrite = false;","  planeMaterial.depthWrite = true;")
rep("""    const vSpeedDbg = varying(vel.w);
""","")
rep("""      const rgb = select(vSpeedDbg.greaterThan(450), vec3(1, 0, 0), mix(vec3(0.82, 0.86, 0.92), vec3(0.95, 0.97, 1), display));""","""      const rgb = mix(vec3(0.82, 0.86, 0.92), vec3(0.97, 0.98, 1), display);""")
# halo + energy normalisation
rep("""/** Half the streak's width, px (of the flow pass's target). */
const HALF_WIDTH_PX = 1;""","""/** Half the streak's width, px (of the flow pass's target). */
const HALF_WIDTH_PX = 1;
/**
 * In the display modes a streak carries a dark halo out to this half width, px, so a light
 * tracer reads on every colour of the map (white on viridis yellow has no contrast), as map
 * labels do.
 */
const HALO_PX = 2.2;
/**
 * A tracer's exposure is spread along its streak: in the scene-linear mode the streak's
 * opacity falls as 1 / length beyond this length, m, so fast jets do not paint solid white.
 */
const EXPOSURE_LEN_M = 0.12;""")
rep("""    // along the streak in px from the tail, extended by the half width at both ends (round caps)
    const along = mix(float(-HALF_WIDTH_PX), lenPx.add(HALF_WIDTH_PX), s);
    const across = side.mul(HALF_WIDTH_PX + 0.5);""","""    // along the streak in px from the tail, extended by the half width at both ends (round
    // caps); the display modes' quads also hold the halo
    const outer = mix(float(HALF_WIDTH_PX + 0.5), float(HALO_PX + 0.5), display);
    const along = mix(outer.negate(), lenPx.add(outer), s);
    const across = side.mul(outer);""")
rep("""    const alphaLit = aux.y.mul(lit);""","""    // the long exposure's spread (scene-linear mode): opacity ~ 1 / length past EXPOSURE_LEN_M
    const spread = mix(min(float(1), float(EXPOSURE_LEN_M).div(max(len, 1e-4))), float(1), display);
    const alphaLit = aux.y.mul(lit).mul(spread);""")
rep("""      const cov = float(1).sub(smoothstep(HALF_WIDTH_PX - 0.75, HALF_WIDTH_PX + 0.5, dist));
      const toward = vAlong.div(max(vLen, 1)).clamp(0, 1);
      const a = cov.mul(vAlpha).mul(opacity).mul(mix(float(0.15), float(1), toward));
      If(a.lessThan(0.002), () => {
        Discard();
      });
      // scene-linear: a pale smoke under the studio light; display: near-white
      const rgb = mix(vec3(0.82, 0.86, 0.92), vec3(0.97, 0.98, 1), display);
      return vec4(rgb.mul(a), a);""","""      const core = float(1).sub(smoothstep(HALF_WIDTH_PX - 0.75, HALF_WIDTH_PX + 0.5, dist));
      const halo = float(1)
        .sub(smoothstep(HALO_PX - 0.75, HALO_PX + 0.5, dist))
        .mul(0.55)
        .mul(display);
      const toward = vAlong.div(max(vLen, 1)).clamp(0, 1);
      const k = vAlpha.mul(opacity).mul(mix(float(0.15), float(1), toward));
      // the light core over its dark halo (premultiplied): halo alpha where the core is not
      const aCore = core.mul(k);
      const a = aCore.add(halo.mul(k).mul(float(1).sub(core)));
      If(a.lessThan(0.002), () => {
        Discard();
      });
      // scene-linear: a pale smoke under the studio light; display: near-white on a dark halo
      const rgb = mix(vec3(0.82, 0.86, 0.92), vec3(0.97, 0.98, 1), display);
      return vec4(rgb.mul(aCore), a);""")
open(p,'w',encoding='utf-8',newline='\n').write(s)
p='src/lookdev/main.ts'
s=open(p,encoding='utf-8').read()
rep("""    viewProjection: () => { view.camera.updateMatrixWorld(); return [...view.camera.projectionMatrix.clone().multiply(view.camera.matrixWorldInverse).elements]; },""","""    viewProjection: () => {
      view.camera.updateMatrixWorld();
      const m = view.camera.projectionMatrix.clone().multiply(view.camera.matrixWorldInverse);
      return [...m.elements];
    },""")
rep("""  stats(): ReturnType<EngineView["stats"]>;
  viewProjection(): number[];""","""  stats(): ReturnType<EngineView['stats']>;
  /** The camera's (unjittered) view-projection, column-major: inspection of the particles. */
  viewProjection(): number[];""")
open(p,'w',encoding='utf-8',newline='\n').write(s)
