import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
const t = new StdioClientTransport({ command: 'node', args: ['/tmp/litematica-mcp/index.js'] });
const c = new Client({ name: 'smoke', version: '1.0' });
await c.connect(t);
const call = async (name, args) => {
  const res = await c.callTool({ name, arguments: args });
  const text = res.content?.[0]?.text ?? JSON.stringify(res);
  return JSON.parse(text);
};
const SRC = '/home/dwg/Downloads/AyuGram Desktop/Farm Enderman.litematic';

console.log('--- tools ---');
console.log((await c.listTools()).tools.map((x) => x.name).join(', '));

console.log('--- list_schematics ---');
const ls = await call('list_schematics', { dir: '~/Downloads' });
console.log(ls.count, 'files; sample:', ls.schematics[0]?.file);

console.log('--- get_schematic_info ---');
const info = await call('get_schematic_info', { file: SRC });
console.log(info.name, 'v' + info.version, 'author:', info.author, '| regions:', info.regions.length);
console.log('region size:', JSON.stringify(info.regions[0].size), 'palette:', info.regions[0].palette_entries);

console.log('--- get_material_list ---');
const ml = await call('get_material_list', { file: SRC });
console.log('material kinds:', Object.keys(ml.materials).length);
console.log('top3:', Object.entries(ml.materials).slice(0, 3));

console.log('--- get_layer y=0 ---');
const layer = await call('get_layer', { file: SRC, y: 0 });
console.log('rows:', layer.rows_z0_to_zN.length, 'legend entries:', Object.keys(layer.legend).length);
console.log('row z=11:', JSON.stringify(layer.rows_z0_to_zN[11]));

console.log('--- get_block (9,0,11) ---');
console.log(await call('get_block', { file: SRC, x: 9, y: 0, z: 11 }));

console.log('--- find_blocks purpur_block limit 5 ---');
const fb = await call('find_blocks', { file: SRC, block: 'purpur_block', limit: 5 });
console.log('total:', fb.total, 'first:', fb.positions.slice(0, 3));

console.log('--- create + set + fill + reload ---');
const NEW = '/tmp/litematica-mcp/test-tower.litematic';
await call('create_schematic', { file: NEW, name: 'Test Tower', x: 5, y: 4, z: 5, author: 'nyx' });
await call('set_blocks', { file: NEW, blocks: [
  { x: 0, y: 0, z: 0, block: 'stone' },
  { x: 4, y: 0, z: 4, block: 'minecraft:purpur_pillar[axis=y]' },
]});
await call('fill_box', { file: NEW, block: 'glass', x1: 1, y1: 1, z1: 1, x2: 3, y2: 1, z2: 3 });
const check = await call('get_schematic_info', { file: NEW });
console.log('reloaded:', check.name, 'by', check.author, 'palette:', check.regions[0].palette_entries);
console.log('materials:', check.regions[0].counts);
const blk = await call('get_block', { file: NEW, x: 2, y: 1, z: 2 });
console.log('(2,1,2) =', blk.block);
const blk2 = await call('get_block', { file: NEW, x: 4, y: 0, z: 4 });
console.log('(4,0,4) =', JSON.stringify(blk2.block));
const layer2 = await call('get_layer', { file: NEW, y: 1 });
console.log('layer y=1:'); layer2.rows_z0_to_zN.forEach((r) => console.log(' |' + r + '|'));

console.log('--- error paths ---');
try { await call('get_block', { file: SRC, x: 99, y: 99, z: 99 }); console.log('MISSING ERROR'); }
catch (e) { console.log('oob ok:', e.message.slice(0, 60)); }
try { await call('get_schematic_info', { file: '/tmp/nope.litematic' }); console.log('MISSING ERROR'); }
catch (e) { console.log('nofile ok:', e.message.slice(0, 60)); }

await c.close();
console.log('SMOKE-PASS');
