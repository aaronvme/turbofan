// The offline side of the binary mesh format: assembling a MeshFile from a mesh. The format itself
// (types, encoder, checking decoder) is src/flow/mesh/meshFile.ts, shared with the browser loader.
import {
  VERSION,
  type MeshFile,
  type MeshFileBlock,
  type MeshFilePatch,
  type MeshFileRow,
  type MeshFileStation,
  type Real,
} from '../../src/flow/mesh/meshFile';
import { buildGhostMap } from './ghost';
import { blockGeometry } from './metrics';
import { FACES, type MultiBlockMesh } from './types';

export * from '../../src/flow/mesh/meshFile';

/** Assemble the file contents (metrics, 2-layer ghost map, station and row maps) from a mesh. */
export function meshFileFromMesh(
  mesh: MultiBlockMesh,
  precision: 'f64' | 'f32',
  maps: { readonly stations: readonly MeshFileStation[]; readonly rows: readonly MeshFileRow[] } = {
    stations: [],
    rows: [],
  },
): MeshFile {
  const ghosts = buildGhostMap(mesh, 2);
  let nodes = 0;
  let cells = 0;
  let iFaces = 0;
  let jFaces = 0;
  const blocks: MeshFileBlock[] = mesh.blocks.map((b, bi) => {
    const rec = {
      name: b.name,
      ni: b.ni,
      nj: b.nj,
      nodeOffset: nodes,
      cellOffset: cells,
      iFaceOffset: iFaces,
      jFaceOffset: jFaces,
      ghostOffset: ghosts.ghostOffset[bi] ?? 0,
    };
    nodes += (b.ni + 1) * (b.nj + 1);
    cells += b.ni * b.nj;
    iFaces += (b.ni + 1) * b.nj;
    jFaces += b.ni * (b.nj + 1);
    return rec;
  });
  const real = (n: number): Real =>
    precision === 'f64' ? new Float64Array(n) : new Float32Array(n);
  const out = {
    nodeX: new Float64Array(nodes),
    nodeR: new Float64Array(nodes),
    cellX: real(cells),
    cellR: real(cells),
    cellArea: real(cells),
    cellVolR: real(cells),
    iFaceNx: real(iFaces),
    iFaceNr: real(iFaces),
    iFaceAreaR: real(iFaces),
    jFaceNx: real(jFaces),
    jFaceNr: real(jFaces),
    jFaceAreaR: real(jFaces),
  };
  mesh.blocks.forEach((b, bi) => {
    const rec = blocks[bi] as MeshFileBlock;
    const g = blockGeometry(b);
    out.nodeX.set(b.x, rec.nodeOffset);
    out.nodeR.set(b.r, rec.nodeOffset);
    out.cellX.set(g.centreX, rec.cellOffset);
    out.cellR.set(g.centreR, rec.cellOffset);
    out.cellArea.set(g.area, rec.cellOffset);
    out.cellVolR.set(g.volR, rec.cellOffset);
    out.iFaceNx.set(g.iFaceNx, rec.iFaceOffset);
    out.iFaceNr.set(g.iFaceNr, rec.iFaceOffset);
    out.iFaceAreaR.set(g.iFaceAreaR, rec.iFaceOffset);
    out.jFaceNx.set(g.jFaceNx, rec.jFaceOffset);
    out.jFaceNr.set(g.jFaceNr, rec.jFaceOffset);
    out.jFaceAreaR.set(g.jFaceAreaR, rec.jFaceOffset);
  });
  const patches: MeshFilePatch[] = mesh.patches.map((p) => ({
    block: p.block,
    face: FACES.indexOf(p.face),
    bc: p.bc,
    floating: p.floating === true,
    start: p.start,
    end: p.end,
    nbrBlock: p.nbr?.block ?? -1,
    nbrFace: p.nbr === undefined ? 0 : FACES.indexOf(p.nbr.face),
    nbrStart: p.nbr?.start ?? 0,
    nbrEnd: p.nbr?.end ?? 0,
    label: p.label,
  }));
  return {
    version: VERSION,
    precision,
    ghostLayers: ghosts.layers,
    blocks,
    patches,
    ...out,
    ghostSrc: ghosts.src,
    ghostBc: ghosts.bc,
    stations: maps.stations.map((m) => ({ ...m })),
    rows: maps.rows.map((m) => ({ ...m })),
  };
}
