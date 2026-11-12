#!/usr/bin/env node
// litematica-mcp: MCP stdio server for Litematica .litematic schematics.
// Read: metadata, palette, layers, slices, material list. Write: create,
// set blocks, save. Codec verified against Litematica v7 files.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import {
  loadLitematic, saveLitematic, blockAt, setBlock, stateToString, indexToXyz, xyzToIndex,
} from './litematic.js';

const server = new McpServer({ name: 'litematica', version: '1.0.0' });

const S = (obj) => JSON.stringify(obj, null, 1);

function resolvePath(p) {
  return p.startsWith('~/') ? path.join(process.env.HOME, p.slice(2)) : path.resolve(p);
}

function readSchematic(p) {
  const file = resolvePath(p);
  if (!fs.existsSync(file)) throw new Error(`file not found: ${file}`);
  return loadLitematic(fs.readFileSync(file));
}

function regionOf(s, regionIdx = 0) {
  const r = s.regions[regionIdx];
  if (!r) throw new Error(`region index ${regionIdx} out of range (0..${s.regions.length - 1})`);
  return r;
}

// ---- tools -----------------------------------------------------------

server.tool(
  'list_schematics',
  'List .litematic files in a directory (default: ~/Downloads)',
  { dir: z.string().optional() },
  async ({ dir }) => {
    const d = resolvePath(dir ?? '~/Downloads');
    const files = [];
    const walk = (dir, depth) => {
      if (depth > 3) return;
      for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, f.name);
        if (f.isDirectory()) walk(p, depth + 1);
        else if (f.name.endsWith('.litematic')) {
          const st = fs.statSync(p);
          files.push({ file: p, bytes: st.size, modified: st.mtime.toISOString() });
        }
      }
    };
    walk(d, 0);
    return { content: [{ type: 'text', text: S({ dir: d, count: files.length, schematics: files }) }] };
  },
);

server.tool(
  'get_schematic_info',
  'Get metadata, size, region list and palette of a .litematic',
  { file: z.string(), full_palette: z.boolean().optional() },
  async ({ file, full_palette }) => {
    const s = readSchematic(file);
    const regions = s.regions.map((r) => ({
      name: r.name,
      size: r.size,
      raw_size: r.rawSize,
      position: r.position,
      palette_entries: r.palette.length,
      counts: materialCounts(r),
    }));
    const out = {
      file: resolvePath(file), version: s.version, name: s.name, author: s.author,
      description: s.description, regions,
      palette: full_palette ? s.regions.map((r) => r.palette.map(stateToString)) : undefined,
    };
    return { content: [{ type: 'text', text: S(out) }] };
  },
);

server.tool(
  'get_layer',
  'Show one Y-layer as a top-down ASCII grid; one char per block, space = air. Legend maps each char to its block; chars beyond the alphabet get numeric suffixes. Rows are z, columns are x.',
  {
    file: z.string(), y: z.number().int(), region: z.number().int().optional(),
    chars: z.string().optional(),
  },
  async ({ file, y, region, chars }) => {
    const s = readSchematic(file);
    const r = regionOf(s, region);
    if (y < 0 || y >= r.size.y) throw new Error(`y=${y} out of range 0..${r.size.y - 1}`);
    // char per palette index, assigned in first-appearance order; no silent reuse
    const defaultChars = '.#@%&$XO*+=-~^:;abcdefghijklmnopqrstuvwxyz0123456789';
    const map = chars ?? defaultChars;
    const legend = {}; // char -> state string
    const charOf = {}; // palette index -> char
    const lines = [];
    for (let z = 0; z < r.size.z; z++) {
      let line = '';
      for (let x = 0; x < r.size.x; x++) {
        const idx = r.indices[xyzToIndex(x, y, z, r.size)];
        if (idx === 0) { line += ' '; continue; }
        if (charOf[idx] === undefined) {
          const n = Object.keys(charOf).length;
          const ch = map[n % map.length] + (n >= map.length ? Math.floor(n / map.length) : '');
          charOf[idx] = ch;
          legend[ch] = stateToString(r.palette[idx] ?? { Name: 'unknown' });
        }
        line += charOf[idx];
      }
      lines.push(line.replace(/\s+$/, ''));
    }
    return {
      content: [{
        type: 'text',
        text: S({
          y, size: r.size, legend, rows_z0_to_zN: lines,
          note: 'each row is z, each column is x; space = air',
        }),
      }],
    };
  },
);


function materialCounts(r) {
  const counts = {};
  for (const idx of r.indices) {
    if (idx === 0) continue;
    const e = r.palette[idx] ?? { Name: 'unknown' };
    const key = stateToString(e);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1]));
}

server.tool(
  'get_material_list',
  'Full material list (non-air block counts) of a region',
  { file: z.string(), region: z.number().int().optional() },
  async ({ file, region }) => {
    const s = readSchematic(file);
    const r = regionOf(s, region);
    return { content: [{ type: 'text', text: S({ region: r.name, materials: materialCounts(r) }) }] };
  },
);

server.tool(
  'get_block',
  'Get the block state at x,y,z in a region',
  { file: z.string(), x: z.number().int(), y: z.number().int(), z: z.number().int(), region: z.number().int().optional() },
  async ({ file, x, y, z: bz, region }) => {
    const s = readSchematic(file);
    const r = regionOf(s, region);
    const b = blockAt(r, x, y, bz);
    return { content: [{ type: 'text', text: S({ pos: [x, y, bz], block: b }) }] };
  },
);

server.tool(
  'find_blocks',
  'Find all positions of a block in a region. block: name like "purpur_block", optionally [prop=value,...]',
  { file: z.string(), block: z.string(), region: z.number().int().optional(), limit: z.number().int().optional() },
  async ({ file, block, region, limit }) => {
    const s = readSchematic(file);
    const r = regionOf(s, region);
    const target = block.trim();
    const hitIdx = [];
    r.palette.forEach((e, i) => {
      if (stateToString(e) === target || e.Name === target || e.Name === 'minecraft:' + target) hitIdx.push(i);
    });
    if (hitIdx.length === 0) return { content: [{ type: 'text', text: S({ block: target, found: 0 }) }] };
    const hits = [];
    const max = limit ?? 200;
    let total = 0;
    for (let i = 0; i < r.indices.length; i++) {
      if (hitIdx.includes(r.indices[i])) {
        total++;
        if (hits.length < max) hits.push(indexToXyz(i, r.size));
      }
    }
    return { content: [{ type: 'text', text: S({ block: target, total, showing: hits.length, positions: hits }) }] };
  },
);

server.tool(
  'create_schematic',
  'Create a new empty (air) schematic and save it',
  {
    file: z.string(), name: z.string(), x: z.number().int().positive(), y: z.number().int().positive(),
    z: z.number().int().positive(), author: z.string().optional(),
  },
  async ({ file, name, x, y, z, author }) => {
    const dest = resolvePath(file);
    const s = {
      version: 7, name, author: author ?? 'litematica-mcp', description: '',
      regions: [{
        name: 'Unnamed', size: { x, y, z }, rawSize: { x, y, z },
        palette: [{ Name: 'minecraft:air', Properties: undefined }],
        indices: new Array(x * y * z).fill(0),
        position: { x: 0, y: 0, z: 0 },
      }],
      timeCreated: Date.now(), timeModified: Date.now(),
    };
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, saveLitematic(s));
    return { content: [{ type: 'text', text: S({ created: dest, name, size: { x, y, z } }) }] };
  },
);

server.tool(
  'set_blocks',
  'Set blocks in a schematic and save. blocks: array of {x,y,z,block}. block is "name" or "name[prop=value,...]". Persist edits in-place.',
  {
    file: z.string(), blocks: z.array(z.object({
      x: z.number().int(), y: z.number().int(), z: z.number().int(), block: z.string(),
    })).min(1), region: z.number().int().optional(),
  },
  async ({ file, blocks, region }) => {
    const file_ = resolvePath(file);
    const s = readSchematic(file_);
    const r = regionOf(s, region);
    for (const b of blocks) setBlock(r, b.x, b.y, b.z, parseState(b.block));
    fs.writeFileSync(file_, saveLitematic(s));
    return { content: [{ type: 'text', text: S({ updated: blocks.length, file: file_, palette_now: r.palette.length }) }] };
  },
);

server.tool(
  'fill_box',
  'Fill an inclusive box [x1,y1,z1]..[x2,y2,z2] with a block, in-place',
  {
    file: z.string(), block: z.string(),
    x1: z.number().int(), y1: z.number().int(), z1: z.number().int(),
    x2: z.number().int(), y2: z.number().int(), z2: z.number().int(),
    hollow: z.boolean().optional(), region: z.number().int().optional(),
  },
  async (a) => {
    const file_ = resolvePath(a.file);
    const s = readSchematic(file_);
    const r = regionOf(s, a.region);
    const state = parseState(a.block);
    const [x1, x2] = [Math.min(a.x1, a.x2), Math.max(a.x1, a.x2)];
    const [y1, y2] = [Math.min(a.y1, a.y2), Math.max(a.y1, a.y2)];
    const [z1, z2] = [Math.min(a.z1, a.z2), Math.max(a.z1, a.z2)];
    let n = 0;
    for (let y = y1; y <= y2; y++) for (let z = z1; z <= z2; z++) for (let x = x1; x <= x2; x++) {
      const shell = x === x1 || x === x2 || y === y1 || y === y2 || z === z1 || z === z2;
      if (a.hollow && !shell) continue;
      setBlock(r, x, y, z, state);
      n++;
    }
    fs.writeFileSync(file_, saveLitematic(s));
    return { content: [{ type: 'text', text: S({ filled: n, box: { x1, y1, z1, x2, y2, z2 }, hollow: !!a.hollow, palette_now: r.palette.length }) }] };
  },
);

server.tool(
  'set_metadata',
  'Set name/author/description metadata of a schematic, in-place',
  { file: z.string(), name: z.string().optional(), author: z.string().optional(), description: z.string().optional() },
  async ({ file, name, author, description }) => {
    const file_ = resolvePath(file);
    const s = readSchematic(file_);
    if (name !== undefined) s.name = name;
    if (author !== undefined) s.author = author;
    if (description !== undefined) s.description = description;
    fs.writeFileSync(file_, saveLitematic(s));
    return { content: [{ type: 'text', text: S({ updated: { name, author, description } }) }] };
  },
);

function parseState(spec) {
  const m = spec.trim().match(/^([a-z0-9_:-]+)(?:\[([^\]]*)\])?$/i);
  if (!m) throw new Error(`bad block spec: ${spec}`);
  let name = m[1];
  if (!name.includes(':')) name = 'minecraft:' + name;
  let Properties;
  if (m[2]) {
    Properties = {};
    for (const part of m[2].split(',')) {
      if (!part) continue;
      const [k, v] = part.split('=');
      if (!k || v === undefined) throw new Error(`bad property in ${spec}: ${part}`);
      Properties[k.trim()] = v.trim();
    }
  }
  return { Name: name, Properties };
}

// ---- boot ------------------------------------------------------------
const transport = new StdioServerTransport();
await server.connect(transport);
