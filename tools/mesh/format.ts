// Binary mesh + metrics format, version 1 (layout spec: docs/MESH.md, "Binary format").
//
// Little-endian. A 64-byte header, a section table (16 bytes per section), then the sections in
// id order, each starting on an 8-byte boundary so a loader can view them in place as typed
// arrays (structure of arrays: one GPU buffer per section). Nodes are always f64 (the geometry
// source of truth for the f64 reference solver); cell and face metrics are f64 or f32 (flag bit 0)
// so the browser asset can halve its size. All counts and offsets are u32.
import { buildGhostMap } from './ghost';
import { blockGeometry } from './metrics';
import { FACES, type MultiBlockMesh } from './types';

export type Real = Float64Array | Float32Array;

export interface MeshFileBlock {
  readonly name: string;
  readonly ni: number;
  readonly nj: number;
  /** First node / cell / i-face / j-face / ghost of this block in the global arrays. */
  readonly nodeOffset: number;
  readonly cellOffset: number;
  readonly iFaceOffset: number;
  readonly jFaceOffset: number;
  readonly ghostOffset: number;
}

export interface MeshFilePatch {
  readonly block: number;
  /** 0 imin, 1 imax, 2 jmin, 3 jmax. */
  readonly face: number;
  readonly bc: number;
  readonly floating: boolean;
  readonly start: number;
  readonly end: number;
  /** -1 for physical boundaries. */
  readonly nbrBlock: number;
  readonly nbrFace: number;
  readonly nbrStart: number;
  readonly nbrEnd: number;
  readonly label: string;
}

export interface MeshFile {
  readonly version: number;
  readonly precision: 'f64' | 'f32';
  readonly ghostLayers: number;
  readonly blocks: readonly MeshFileBlock[];
  readonly patches: readonly MeshFilePatch[];
  readonly nodeX: Float64Array;
  readonly nodeR: Float64Array;
  readonly cellX: Real;
  readonly cellR: Real;
  readonly cellArea: Real;
  readonly cellVolR: Real;
  readonly iFaceNx: Real;
  readonly iFaceNr: Real;
  readonly iFaceAreaR: Real;
  readonly jFaceNx: Real;
  readonly jFaceNr: Real;
  readonly jFaceAreaR: Real;
  readonly ghostSrc: Int32Array;
  readonly ghostBc: Uint8Array;
}

export const MAGIC = 'TFMESH\0\0';
export const VERSION = 1;
const HEADER_BYTES = 64;
const SECTION_ENTRY_BYTES = 16;
const RECORD_BYTES = 64;
const NAME_BYTES = 32;

/** Section ids, in file order. Part of the format: never renumber. */
export const SECTION = {
  BLOCKS: 1,
  PATCHES: 2,
  NODE_X: 3,
  NODE_R: 4,
  CELL_X: 5,
  CELL_R: 6,
  CELL_AREA: 7,
  CELL_VOLR: 8,
  IFACE_NX: 9,
  IFACE_NR: 10,
  IFACE_AREAR: 11,
  JFACE_NX: 12,
  JFACE_NR: 13,
  JFACE_AREAR: 14,
  GHOST_SRC: 15,
  GHOST_BC: 16,
} as const;

/** Element type codes in the section table. */
export const ELEMENT = { F64: 1, F32: 2, I32: 3, U8: 4, BLOCK_RECORD: 5, PATCH_RECORD: 6 } as const;

type ArrayKey = Exclude<
  keyof MeshFile,
  'version' | 'precision' | 'ghostLayers' | 'blocks' | 'patches'
>;

const ARRAY_SECTIONS: readonly {
  id: number;
  key: ArrayKey;
  kind: 'node' | 'real' | 'i32' | 'u8';
}[] = [
  { id: SECTION.NODE_X, key: 'nodeX', kind: 'node' },
  { id: SECTION.NODE_R, key: 'nodeR', kind: 'node' },
  { id: SECTION.CELL_X, key: 'cellX', kind: 'real' },
  { id: SECTION.CELL_R, key: 'cellR', kind: 'real' },
  { id: SECTION.CELL_AREA, key: 'cellArea', kind: 'real' },
  { id: SECTION.CELL_VOLR, key: 'cellVolR', kind: 'real' },
  { id: SECTION.IFACE_NX, key: 'iFaceNx', kind: 'real' },
  { id: SECTION.IFACE_NR, key: 'iFaceNr', kind: 'real' },
  { id: SECTION.IFACE_AREAR, key: 'iFaceAreaR', kind: 'real' },
  { id: SECTION.JFACE_NX, key: 'jFaceNx', kind: 'real' },
  { id: SECTION.JFACE_NR, key: 'jFaceNr', kind: 'real' },
  { id: SECTION.JFACE_AREAR, key: 'jFaceAreaR', kind: 'real' },
  { id: SECTION.GHOST_SRC, key: 'ghostSrc', kind: 'i32' },
  { id: SECTION.GHOST_BC, key: 'ghostBc', kind: 'u8' },
];

/** Assemble the file contents (metrics + 2-layer ghost map) from a mesh. */
export function meshFileFromMesh(mesh: MultiBlockMesh, precision: 'f64' | 'f32'): MeshFile {
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
  };
}

const align8 = (n: number): number => (n + 7) & ~7;

function writeName(bytes: Uint8Array, at: number, name: string): void {
  const enc = new TextEncoder().encode(name);
  if (enc.length > NAME_BYTES) throw new Error(`name "${name}" is longer than ${NAME_BYTES} bytes`);
  bytes.set(enc, at);
}

function readName(bytes: Uint8Array, at: number): string {
  const raw = bytes.subarray(at, at + NAME_BYTES);
  const end = raw.indexOf(0);
  return new TextDecoder().decode(end < 0 ? raw : raw.subarray(0, end));
}

function elementOf(kind: 'node' | 'real' | 'i32' | 'u8', precision: 'f64' | 'f32'): number {
  if (kind === 'node') return ELEMENT.F64;
  if (kind === 'real') return precision === 'f64' ? ELEMENT.F64 : ELEMENT.F32;
  return kind === 'i32' ? ELEMENT.I32 : ELEMENT.U8;
}

export function encodeMeshFile(file: MeshFile): Uint8Array {
  const sections: { id: number; type: number; data: Uint8Array }[] = [];
  const blockBytes = new Uint8Array(file.blocks.length * RECORD_BYTES);
  const bv = new DataView(blockBytes.buffer);
  file.blocks.forEach((b, k) => {
    const o = k * RECORD_BYTES;
    writeName(blockBytes, o, b.name);
    [b.ni, b.nj, b.nodeOffset, b.cellOffset, b.iFaceOffset, b.jFaceOffset, b.ghostOffset].forEach(
      (v, m) => {
        bv.setUint32(o + NAME_BYTES + 4 * m, v, true);
      },
    );
  });
  sections.push({ id: SECTION.BLOCKS, type: ELEMENT.BLOCK_RECORD, data: blockBytes });
  const patchBytes = new Uint8Array(file.patches.length * RECORD_BYTES);
  const pv = new DataView(patchBytes.buffer);
  file.patches.forEach((p, k) => {
    const o = k * RECORD_BYTES;
    pv.setUint32(o, p.block, true);
    pv.setUint8(o + 4, p.face);
    pv.setUint8(o + 5, p.bc);
    pv.setUint8(o + 6, p.floating ? 1 : 0);
    pv.setUint32(o + 8, p.start, true);
    pv.setUint32(o + 12, p.end, true);
    pv.setInt32(o + 16, p.nbrBlock, true);
    pv.setUint8(o + 20, p.nbrFace);
    pv.setUint32(o + 24, p.nbrStart, true);
    pv.setUint32(o + 28, p.nbrEnd, true);
    writeName(patchBytes, o + 32, p.label);
  });
  sections.push({ id: SECTION.PATCHES, type: ELEMENT.PATCH_RECORD, data: patchBytes });
  for (const s of ARRAY_SECTIONS) {
    const a = file[s.key];
    const type = elementOf(s.kind, file.precision);
    const expected = {
      [ELEMENT.F64]: Float64Array,
      [ELEMENT.F32]: Float32Array,
      [ELEMENT.I32]: Int32Array,
      [ELEMENT.U8]: Uint8Array,
    }[type];
    if (!(a instanceof (expected as typeof Float64Array)))
      throw new Error(`${s.key} has the wrong element type for ${file.precision}`);
    sections.push({ id: s.id, type, data: new Uint8Array(a.buffer, a.byteOffset, a.byteLength) });
  }

  let offset = HEADER_BYTES + sections.length * SECTION_ENTRY_BYTES;
  const placed = sections.map((s) => {
    const at = align8(offset);
    offset = at + s.data.byteLength;
    return { ...s, at };
  });
  const total = align8(offset);
  const bytes = new Uint8Array(total);
  const view = new DataView(bytes.buffer);
  bytes.set(new TextEncoder().encode(MAGIC), 0);
  const header = [
    file.version,
    file.precision === 'f32' ? 1 : 0,
    file.blocks.length,
    file.patches.length,
    file.nodeX.length,
    file.cellX.length,
    file.iFaceNx.length,
    file.jFaceNx.length,
    file.ghostSrc.length,
    file.ghostLayers,
    sections.length,
    HEADER_BYTES,
    total,
  ];
  header.forEach((v, m) => {
    view.setUint32(8 + 4 * m, v, true);
  });
  placed.forEach((s, k) => {
    const o = HEADER_BYTES + k * SECTION_ENTRY_BYTES;
    view.setUint32(o, s.id, true);
    view.setUint32(o + 4, s.type, true);
    view.setUint32(o + 8, s.at, true);
    view.setUint32(o + 12, s.data.byteLength, true);
    bytes.set(s.data, s.at);
  });
  return bytes;
}

const ELEMENT_BYTES: Readonly<Record<number, number>> = {
  [ELEMENT.F64]: 8,
  [ELEMENT.F32]: 4,
  [ELEMENT.I32]: 4,
  [ELEMENT.U8]: 1,
  [ELEMENT.BLOCK_RECORD]: RECORD_BYTES,
  [ELEMENT.PATCH_RECORD]: RECORD_BYTES,
};

export function decodeMeshFile(input: Uint8Array): MeshFile {
  if (input.byteLength < HEADER_BYTES) throw new Error('mesh file is shorter than its header');
  // Copy so every section is 8-byte aligned regardless of where the caller's bytes live.
  const bytes = input.slice();
  const view = new DataView(bytes.buffer);
  if (new TextDecoder().decode(bytes.subarray(0, 8)) !== MAGIC)
    throw new Error('not a mesh file (bad magic)');
  const u32 = (o: number): number => view.getUint32(o, true);
  const version = u32(8);
  if (version !== VERSION) throw new Error(`unsupported mesh file version ${version}`);
  const flags = u32(12);
  const precision = (flags & 1) === 1 ? 'f32' : 'f64';
  const [nBlocks, nPatches, nNodes, nCells, nIFaces, nJFaces, nGhost, ghostLayers, nSections] = [
    u32(16),
    u32(20),
    u32(24),
    u32(28),
    u32(32),
    u32(36),
    u32(40),
    u32(44),
    u32(48),
  ];
  if (u32(56) !== bytes.byteLength)
    throw new Error(`mesh file is ${bytes.byteLength} bytes, header says ${u32(56)}`);
  const counts: Readonly<Record<number, number>> = {
    [SECTION.BLOCKS]: nBlocks,
    [SECTION.PATCHES]: nPatches,
    [SECTION.NODE_X]: nNodes,
    [SECTION.NODE_R]: nNodes,
    [SECTION.CELL_X]: nCells,
    [SECTION.CELL_R]: nCells,
    [SECTION.CELL_AREA]: nCells,
    [SECTION.CELL_VOLR]: nCells,
    [SECTION.IFACE_NX]: nIFaces,
    [SECTION.IFACE_NR]: nIFaces,
    [SECTION.IFACE_AREAR]: nIFaces,
    [SECTION.JFACE_NX]: nJFaces,
    [SECTION.JFACE_NR]: nJFaces,
    [SECTION.JFACE_AREAR]: nJFaces,
    [SECTION.GHOST_SRC]: nGhost,
    [SECTION.GHOST_BC]: nGhost,
  };
  const found = new Map<number, Uint8Array>();
  for (let k = 0; k < nSections; k++) {
    const o = HEADER_BYTES + k * SECTION_ENTRY_BYTES;
    const id = u32(o);
    const type = u32(o + 4);
    const at = u32(o + 8);
    const len = u32(o + 12);
    const size = ELEMENT_BYTES[type];
    const count = counts[id];
    if (size === undefined || count === undefined)
      throw new Error(`unknown section ${id} or element type ${type}`);
    if (len !== count * size || at % 8 !== 0 || at + len > bytes.byteLength)
      throw new Error(`section ${id} is malformed`);
    found.set(id, bytes.subarray(at, at + len));
  }
  const section = (id: number): Uint8Array => {
    const s = found.get(id);
    if (s === undefined) throw new Error(`mesh file is missing section ${id}`);
    return s;
  };
  const blockBytes = section(SECTION.BLOCKS);
  const bv = new DataView(blockBytes.buffer, blockBytes.byteOffset, blockBytes.byteLength);
  const blocks: MeshFileBlock[] = [];
  for (let k = 0; k < nBlocks; k++) {
    const o = k * RECORD_BYTES;
    const v = (m: number): number => bv.getUint32(o + NAME_BYTES + 4 * m, true);
    blocks.push({
      name: readName(blockBytes, o),
      ni: v(0),
      nj: v(1),
      nodeOffset: v(2),
      cellOffset: v(3),
      iFaceOffset: v(4),
      jFaceOffset: v(5),
      ghostOffset: v(6),
    });
  }
  const patchBytes = section(SECTION.PATCHES);
  const pv = new DataView(patchBytes.buffer, patchBytes.byteOffset, patchBytes.byteLength);
  const patches: MeshFilePatch[] = [];
  for (let k = 0; k < nPatches; k++) {
    const o = k * RECORD_BYTES;
    patches.push({
      block: pv.getUint32(o, true),
      face: pv.getUint8(o + 4),
      bc: pv.getUint8(o + 5),
      floating: pv.getUint8(o + 6) === 1,
      start: pv.getUint32(o + 8, true),
      end: pv.getUint32(o + 12, true),
      nbrBlock: pv.getInt32(o + 16, true),
      nbrFace: pv.getUint8(o + 20),
      nbrStart: pv.getUint32(o + 24, true),
      nbrEnd: pv.getUint32(o + 28, true),
      label: readName(patchBytes, o + 32),
    });
  }
  const typed = (
    id: number,
    kind: 'node' | 'real' | 'i32' | 'u8',
  ): Real | Int32Array | Uint8Array => {
    const s = section(id);
    const buf = s.buffer.slice(s.byteOffset, s.byteOffset + s.byteLength);
    const type = elementOf(kind, precision);
    if (type === ELEMENT.F64) return new Float64Array(buf);
    if (type === ELEMENT.F32) return new Float32Array(buf);
    if (type === ELEMENT.I32) return new Int32Array(buf);
    return new Uint8Array(buf);
  };
  const arrays = Object.fromEntries(
    ARRAY_SECTIONS.map((s) => [s.key, typed(s.id, s.kind)]),
  ) as Pick<MeshFile, ArrayKey>;
  return { version, precision, ghostLayers, blocks, patches, ...arrays };
}
