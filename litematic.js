// .litematic codec — Litematica v7 (Minecraft 1.16+) format.
// Continuous bit-packing: palette indices span long boundaries.
// Order: index = (y*sizeZ + z)*sizeX + x; sizes may be negative (extends).
import {
  NbtFile, NbtCompound, NbtList, NbtInt, NbtString, NbtLongArray, NbtLong,
} from 'deepslate';

const int = (n) => new NbtInt(n);
const str = (s) => new NbtString(String(s));

function bigs2pairs(bigs) {
  return bigs.map((b) => NbtLong.bigintToPair(BigInt.asIntN(64, b)));
}

// --- pack: palette indices -> BigInt longs (continuous) ---
export function packIndices(indices, bits) {
  const mask = (1n << BigInt(bits)) - 1n;
  const out = new Array(Math.ceil((indices.length * bits) / 64)).fill(0n);
  let bitPos = 0;
  for (const idx of indices) {
    const v = BigInt(idx) & mask;
    const start = bitPos >> 6;
    const off = bitPos & 63;
    out[start] |= (v << BigInt(off)) & 0xFFFFFFFFFFFFFFFFn;
    const spill = off + bits - 64;
    if (spill > 0 && start + 1 < out.length) out[start + 1] |= v >> BigInt(64 - off);
    bitPos += bits;
  }
  return out;
}

// --- unpack: BigInt longs -> palette indices (continuous) ---
export function unpackIndices(longs, bits, count) {
  const indices = new Array(count);
  const mask = (1n << BigInt(bits)) - 1n;
  let bitPos = 0;
  for (let i = 0; i < count; i++) {
    const start = bitPos >> 6;
    const off = bitPos & 63;
    let v = (longs[start] ?? 0n) >> BigInt(off);
    const spill = off + bits - 64;
    if (spill > 0 && start + 1 < longs.length) v |= longs[start + 1] << BigInt(64 - off);
    indices[i] = Number(v & mask);
    bitPos += bits;
  }
  return indices;
}

// --- load -------------------------------------------------------------
export function loadLitematic(buf) {
  const file = NbtFile.read(new Uint8Array(buf));
  const root = file.root;
  const meta = root.getCompound('Metadata');
  const regionsRoot = root.getCompound('Regions');
  const regions = [...regionsRoot.keys()].map((rn) => {
    const r = regionsRoot.getCompound(rn);
    const sizeTag = r.getCompound('Size');
    const rawSize = { x: sizeTag.getNumber('x'), y: sizeTag.getNumber('y'), z: sizeTag.getNumber('z') };
    const size = { x: Math.abs(rawSize.x), y: Math.abs(rawSize.y), z: Math.abs(rawSize.z) };
    const palette = r.getList('BlockStatePalette', 10).getItems().map((p) => {
      const props = p.get('Properties');
      const Properties = props && props.size > 0
        ? Object.fromEntries([...props.keys()].map((k) => [k, props.getString(k)]))
        : undefined;
      return { Name: p.getString('Name'), Properties };
    });
    const longs = r.getLongArray('BlockStates').getItems().map((l) => l.toBigInt());
    const bits = Math.max(2, BigInt(Math.max(palette.length - 1, 1)).toString(2).length);
    const count = size.x * size.y * size.z;
    const indices = unpackIndices(longs.map((b) => BigInt.asUintN(64, b)), bits, count);
    const posTag = r.getCompound('Position');
    const position = { x: posTag.getNumber('x'), y: posTag.getNumber('y'), z: posTag.getNumber('z') };
    return { name: rn, size, rawSize, palette, indices, position };
  });
  return {
    version: root.getNumber('Version'),
    name: meta.getString('Name'),
    author: meta.getString('Author'),
    description: meta.getString('Description'),
    regions,
  };
}

// --- save -------------------------------------------------------------
export function saveLitematic(s) {
  const m = NbtCompound.create();
  const now = Date.now();
  m.set('Name', str(s.name));
  m.set('Author', str(s.author ?? ''));
  m.set('Description', str(s.description ?? ''));
  m.set('RegionCount', int(s.regions.length));
  const totalVolume = s.regions.reduce((a, r) => a + r.size.x * r.size.y * r.size.z, 0);
  const totalBlocks = s.regions.reduce((a, r) => a + r.indices.reduce((b, i) => b + (i === 0 ? 0 : 1), 0), 0);
  m.set('TotalVolume', int(totalVolume));
  m.set('TotalBlocks', int(totalBlocks));
  const es = NbtCompound.create();
  const e = s.enclosingSize ?? enclosingSize(s);
  es.set('x', int(e.x)); es.set('y', int(e.y)); es.set('z', int(e.z));
  m.set('EnclosingSize', es);
  m.set('TimeCreated', new NbtLong(BigInt(s.timeCreated ?? now)));
  m.set('TimeModified', new NbtLong(BigInt(s.timeModified ?? now)));

  const regionsRoot = NbtCompound.create();
  for (const r of s.regions) {
    const rc = NbtCompound.create();
    const sz = NbtCompound.create();
    sz.set('x', int(r.rawSize?.x ?? r.size.x));
    sz.set('y', int(r.rawSize?.y ?? r.size.y));
    sz.set('z', int(r.rawSize?.z ?? r.size.z));
    rc.set('Size', sz);
    const pos = NbtCompound.create();
    pos.set('x', int(r.position?.x ?? 0));
    pos.set('y', int(r.position?.y ?? 0));
    pos.set('z', int(r.position?.z ?? 0));
    rc.set('Position', pos);

    const pal = NbtList.create();
    for (const entry of r.palette) {
      const p = NbtCompound.create();
      p.set('Name', str(entry.Name));
      if (entry.Properties && Object.keys(entry.Properties).length > 0) {
        const props = NbtCompound.create();
        for (const [k, v] of Object.entries(entry.Properties)) props.set(k, str(v));
        p.set('Properties', props);
      }
      pal.add(p);
    }
    rc.set('BlockStatePalette', pal);

    const bits = Math.max(2, BigInt(Math.max(r.palette.length - 1, 1)).toString(2).length);
    const bigs = packIndices(r.indices, bits);
    rc.set('BlockStates', new NbtLongArray(bigs2pairs(bigs)));

    rc.set('Entities', NbtList.create());
    rc.set('TileEntities', NbtList.create());
    rc.set('PendingBlockTicks', NbtList.create());
    rc.set('PendingFluidTicks', NbtList.create());
    regionsRoot.set(r.name, rc);
  }

  const root = NbtCompound.create();
  root.set('Version', int(s.version ?? 7));
  if (s.version === 6) root.set('SubVersion', int(3));
  root.set('Regions', regionsRoot);
  root.set('Metadata', m);
  const file = NbtFile.create({ name: 'Schematic', compression: 'gzip', littleEndian: false });
  file.root.set('Version', root.get('Version'));
  file.root.set('Regions', regionsRoot);
  file.root.set('Metadata', m);
  return Buffer.from(file.write());
}

function enclosingSize(s) {
  // union of region extents (positions are relative to enclosing box, min at 0)
  let maxX = 0, maxY = 0, maxZ = 0;
  for (const r of s.regions) {
    maxX = Math.max(maxX, (r.position?.x ?? 0) + r.size.x);
    maxY = Math.max(maxY, (r.position?.y ?? 0) + r.size.y);
    maxZ = Math.max(maxZ, (r.position?.z ?? 0) + r.size.z);
  }
  return { x: maxX, y: maxY, z: maxZ };
}

// --- coordinate helpers -----------------------------------------------
export function indexToXyz(index, size) {
  const x = index % size.x;
  const z = Math.floor(index / size.x) % size.z;
  const y = Math.floor(index / (size.x * size.z));
  return { x, y, z };
}
export function xyzToIndex(x, y, z, size) {
  return (y * size.z + z) * size.x + x;
}
export function blockAt(r, x, y, z) {
  if (x < 0 || y < 0 || z < 0 || x >= r.size.x || y >= r.size.y || z >= r.size.z) {
    throw new Error(`out of bounds: ${x},${y},${z} in ${r.size.x}x${r.size.y}x${r.size.z}`);
  }
  return r.palette[r.indices[xyzToIndex(x, y, z, r.size)]] ?? { Name: 'minecraft:air' };
}
export function setBlock(r, x, y, z, state) {
  if (x < 0 || y < 0 || z < 0 || x >= r.size.x || y >= r.size.y || z >= r.size.z) {
    throw new Error(`out of bounds: ${x},${y},${z} in ${r.size.x}x${r.size.y}x${r.size.z}`);
  }
  let pi = r.palette.findIndex((e) => e.Name === state.Name
    && JSON.stringify(e.Properties ?? null) === JSON.stringify(state.Properties ?? null));
  if (pi === -1) {
    r.palette.push({ ...state });
    pi = r.palette.length - 1;
  }
  r.indices[xyzToIndex(x, y, z, r.size)] = pi;
}
export function stateToString(e) {
  if (!e || e.Name === 'minecraft:air') return 'air';
  const n = e.Name.replace('minecraft:', '');
  if (!e.Properties) return n;
  const props = Object.entries(e.Properties).map(([k, v]) => `${k}=${v}`).join(',');
  return `${n}[${props}]`;
}
