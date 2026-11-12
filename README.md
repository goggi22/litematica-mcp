# litematica-mcp

An MCP (Model Context Protocol) server for Litematica `.litematic` schematics.
Lets an AI assistant (Claude Desktop, omp, or any MCP client) **read, analyze,
create and edit** Minecraft schematics directly — no renders, no round-trips
through other tools.

Built on [misode/deepslate](https://github.com/misode/deepslate) for NBT I/O,
with a from-scratch implementation of Litematica's packed `BlockStates` format
(continuous bit-packing across long boundaries, MC 1.16+ / format v7).
Roundtrip-verified against real-world schematics: 0 index mismatches on
57k-block files, negative region sizes and block-state properties preserved.

## Tools

| Tool | What it does |
|---|---|
| `list_schematics` | Recursively list `.litematic` files in a directory (default `~/Downloads`) |
| `get_schematic_info` | Metadata, region sizes, palette, per-region block counts |
| `get_layer` | One Y-layer as a top-down ASCII grid (`space` = air), with per-layer collision-free legend |
| `get_material_list` | Full shopping list: non-air block counts, sorted |
| `get_block` | Exact block state at x,y,z |
| `find_blocks` | All positions of a block (`purpur_block`, `purpur_pillar[axis=y]`, …) |
| `create_schematic` | New empty (air) schematic with given dimensions |
| `set_blocks` | Place a batch of blocks (`name` or `name[prop=value,...]`), saved in-place |
| `fill_box` | Fill an inclusive box, optional `hollow` mode |
| `set_metadata` | Rename / set author / description |

Blocks are specified as plain strings: `stone`, `minecraft:purpur_pillar[axis=y]`.
Paths accept `~/` shorthand. All edits persist to the file immediately.

## Install

```bash
git clone https://github.com/goggi22/litematica-mcp.git
cd litematica-mcp
npm install
```

## Configure

Add to your MCP client config (`.mcp.json`, `claude_desktop_config.json`, …):

```json
{
  "mcpServers": {
    "litematica": {
      "type": "stdio",
      "command": "node",
      "args": ["/absolute/path/to/litematica-mcp/index.js"]
    }
  }
}
```

## Verify

```bash
npm run smoke
```

Spins up the server over stdio and exercises every tool against a real
schematic: metadata, material list, layers, block lookup, find, create →
set → fill → reload roundtrip, plus error paths (out-of-bounds, missing file).

## Example session

> **user**: что за схематик у меня в Downloads и что нужно для постройки?
> **assistant**: `get_schematic_info` + `get_material_list` →
> «Farm Enderman» v7, 33×54×32, регион Unnamed, 75 палитра;
> понадобится 784 cobblestone, 572 deepslate_bricks, 385 end_stone_bricks, …»

> **user**: построй башню 5×4×5 из стекла и камня
> **assistant**: `create_schematic` → `fill_box` (glass) → `set_blocks`
> (purpur_pillar corners) → готово, файл сохранён

## Limitations

- Single-region schematics for edits; multi-region files read fine (pass
  `region` index)
- Entities, tile entities and pending ticks are not edited (preserved as empty
  lists on save)
- Format v7 (MC 1.16+) continuous packing; pre-1.13 per-long padding is not
  supported

## License

MIT
