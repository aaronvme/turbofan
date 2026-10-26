// three.js objects for the procedural engine (src/geometry), worker-safe.
//
// Two scenes share one camera:
// - `main`: everything static (cases, nacelle, stators, caps) plus the HDRI environment and
//   the backdrop;
// - `rotors`: every rotating part (rotor rows and the spinner), no background, drawn by a
//   second pass so the post chain can blur it along its rotation (src/render/post.ts).
// Each scene has one group per module (exploded view: group.position.x) and one group per
// rotor row (rotation.x = the spool angle; the instance angles are fixed in the row).

import {
  BufferAttribute,
  BufferGeometry,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  Scene,
  type Object3D,
} from 'three/webgpu';
import { COMPONENT_IDS, type ComponentId } from '../contracts/engine';
import type { EngineGeometry } from '../geometry/engineGeometry';
import type { MeshData } from '../geometry/mesh';
import { instanceMatrices } from '../geometry/rows';
import type { ClosedViewSet } from '../geometry/visibility';
import type { MaterialSet } from './materials';

export interface EngineScene {
  readonly main: Scene;
  readonly rotors: Scene;
  /** Rotor row groups per spool (rotation.x is set each frame). */
  readonly spoolGroups: Readonly<Record<'lp' | 'hp', readonly Group[]>>;
  /** Module groups in both scenes. */
  readonly modules: readonly {
    readonly id: ComponentId | null;
    readonly groups: readonly Group[];
  }[];
  /** Nacelle and cowl skins (hidden in the exploded view). */
  readonly skins: readonly Object3D[];
  /** Cap meshes: [start face, end face] per part. */
  readonly caps: readonly (readonly [Mesh, Mesh])[];
  /** Objects the closed engine never shows (src/geometry/visibility.ts): culled in realistic mode. */
  readonly closedHidden: readonly Object3D[];
  readonly triangles: number;
  dispose(): void;
}

function toGeometry(m: MeshData, withTangents = false): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(m.positions, 3));
  g.setAttribute('normal', new BufferAttribute(m.normals, 3));
  g.setAttribute('uv', new BufferAttribute(m.uvs, 2));
  if (withTangents) g.setAttribute('tangent', new BufferAttribute(m.tangents, 4));
  g.setIndex(new BufferAttribute(m.indices, 1));
  g.computeBoundingSphere();
  return g;
}

export function buildEngineScene(
  geo: EngineGeometry,
  materials: MaterialSet,
  closed: ClosedViewSet,
): EngineScene {
  const main = new Scene();
  const rotors = new Scene();
  const moduleIds: (ComponentId | null)[] = [...COMPONENT_IDS, null];
  const modules = moduleIds.map((id) => {
    const a = new Group();
    const b = new Group();
    a.name = b.name = `module:${String(id)}`;
    main.add(a);
    rotors.add(b);
    return { id, groups: [a, b] as const };
  });
  const groupOf = (id: ComponentId | null, rotating: boolean): Group => {
    const m = modules.find((k) => k.id === id);
    if (m === undefined) throw new Error(`engineScene: no module ${String(id)}`);
    return m.groups[rotating ? 1 : 0];
  };
  const spoolGroups: Record<'lp' | 'hp', Group[]> = { lp: [], hp: [] };
  const skins: Object3D[] = [];
  const caps: [Mesh, Mesh][] = [];
  const closedHidden: Object3D[] = [];
  const disposables: BufferGeometry[] = [];
  let triangles = 0;

  for (const p of geo.parts) {
    // exact circumferential tangents (lathe-turned surfaces): a uv-derivative frame is
    // constant per triangle and facets the anisotropic highlights of the lip and drums
    const g = toGeometry(p.mesh, true);
    disposables.push(g);
    triangles += p.mesh.indices.length / 3;
    const mesh = new Mesh(g, materials.part(p.spec.material));
    mesh.name = p.spec.id;
    mesh.castShadow = true;
    mesh.receiveShadow = p.spec.material !== 'spinner';
    // outer skins first: they fill the depth buffer, so the cases and internals behind them
    // fail the early depth test instead of being shaded and overdrawn (the opaque pass is
    // fill-bound, not triangle-bound)
    mesh.renderOrder = p.spec.skin ? 0 : 1;
    if (!closed.parts.has(p.spec.id)) closedHidden.push(mesh);
    // only the spinner shows that it turns (its paint); drums and disks are axisymmetric
    if (p.spec.material === 'spinner') {
      const spin = new Group();
      spin.add(mesh);
      groupOf(p.spec.module, true).add(spin);
      spoolGroups.lp.push(spin);
    } else {
      groupOf(p.spec.module, false).add(mesh);
    }
    if (p.spec.skin) skins.push(mesh);
    const cg = toGeometry(p.cap);
    disposables.push(cg);
    const capMat = materials.cap(p.spec.material);
    const a = new Mesh(cg, capMat);
    const b = new Mesh(cg, capMat);
    b.scale.z = -1; // the mirrored face of the wedge
    a.name = `cap:${p.spec.id}:a`;
    b.name = `cap:${p.spec.id}:b`;
    a.visible = b.visible = false;
    groupOf(p.spec.module, false).add(a, b);
    caps.push([a, b]);
    if (p.spec.skin) skins.push(a, b);
  }

  for (const r of [...geo.rows, ...geo.struts]) {
    const g = toGeometry(r.blade.mesh);
    g.setAttribute('instanceAngle', new InstancedBufferAttribute(Float32Array.from(r.angles), 1));
    disposables.push(g);
    const mesh = new InstancedMesh(g, materials.row(r.material, r.spool), r.row.count);
    const mats = instanceMatrices(r.angles);
    const tmp = new Matrix4();
    for (let k = 0; k < r.row.count; k++) {
      tmp.fromArray(mats, 16 * k);
      mesh.setMatrixAt(k, tmp);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.userData.thetaMin = r.blade.thetaMin;
    mesh.userData.thetaMax = r.blade.thetaMax;
    mesh.name = `row:${r.row.id}`;
    mesh.renderOrder = 1;
    mesh.castShadow = r.spool === null;
    mesh.receiveShadow = r.spool === null;
    if (!closed.rows.has(r.row.id)) closedHidden.push(mesh);
    triangles += (r.blade.mesh.indices.length / 3) * r.row.count;
    const rowGroup = new Group();
    rowGroup.name = `rowGroup:${r.row.id}`;
    rowGroup.add(mesh);
    groupOf(r.module, r.spool !== null).add(rowGroup);
    if (r.spool !== null) spoolGroups[r.spool].push(rowGroup);
  }

  return {
    main,
    rotors,
    spoolGroups,
    modules,
    skins,
    caps,
    closedHidden,
    triangles,
    dispose: () => {
      for (const g of disposables) g.dispose();
      materials.dispose();
    },
  };
}
