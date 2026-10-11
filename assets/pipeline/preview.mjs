// Composes a room from its committed atlas and layout.json into one PNG at 2x, for review:
//   node pipeline/preview.mjs <scene asset dir> [--characters <atlas>] [--slots] [--out <png>]
// It draws in the order the isometric Renderer must use (assets/README.md, "Room layouts"): the floor, then the
// walls, then props, partitions and characters sorted by depth (column + row), with partitions first on their tile
// and front props over a character on their tile.
// --characters puts a character on every Station slot, showing the first frame of the Station's own clip (idle in the
// rest area) when the atlas has it, else of the idle (or first) clip; --slots tints each slot's tile.
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { PNG } from "pngjs";

const root = resolve(import.meta.dirname, "..");
const TILE = [128, 64]; // 2x pixels per half tile step: x = (c - r) * 128, y = (c + r) * 64
const SLOT_COLOURS = [
  [226, 87, 76], [76, 160, 226], [96, 196, 112], [196, 112, 220], [70, 200, 200],
  [230, 150, 60], [150, 150, 240], [220, 200, 80], [240, 90, 160], [160, 160, 160],
];

/** Every page of a packed atlas (<name>.json, or <name>-0.json, <name>-1.json, ...), as frames with their image. */
function loadAtlas(name) {
  const dir = join(root, "atlases");
  const pages = readdirSync(dir).filter((file) => new RegExp(`^${name}(?:-\d+)?\.json$`).test(file));
  if (!pages.length) throw new Error(`no atlas ${name} in ${dir}`);
  const atlas = { frames: {}, animations: {} };
  for (const file of pages) {
    const sheet = JSON.parse(readFileSync(join(dir, file), "utf8"));
    const png = PNG.sync.read(readFileSync(join(dir, sheet.meta.image)));
    for (const [frameName, frame] of Object.entries(sheet.frames)) atlas.frames[frameName] = { ...frame, png };
    Object.assign(atlas.animations, sheet.animations);
  }
  return atlas;
}

/** Straight-alpha "over" of one atlas frame, with its anchor at (x, y). */
function drawFrame(target, atlas, frameName, x, y) {
  const f = atlas.frames[frameName];
  if (!f) throw new Error(`no frame ${frameName}`);
  const left = Math.round(x - f.anchor.x * f.sourceSize.w + f.spriteSourceSize.x);
  const top = Math.round(y - f.anchor.y * f.sourceSize.h + f.spriteSourceSize.y);
  for (let j = 0; j < f.frame.h; j += 1) {
    for (let i = 0; i < f.frame.w; i += 1) {
      const tx = left + i;
      const ty = top + j;
      if (tx < 0 || ty < 0 || tx >= target.width || ty >= target.height) continue;
      const s = ((f.frame.y + j) * f.png.width + f.frame.x + i) * 4;
      blend(target, (ty * target.width + tx) * 4, f.png.data, s, 1);
    }
  }
}

function blend(target, d, src, s, opacity) {
  const a = (src[s + 3] / 255) * opacity;
  if (a === 0) return;
  const b = target.data[d + 3] / 255;
  const out = a + b * (1 - a);
  for (let k = 0; k < 3; k += 1) {
    target.data[d + k] = Math.round((src[s + k] * a + target.data[d + k] * b * (1 - a)) / out);
  }
  target.data[d + 3] = Math.round(out * 255);
}

function fillDiamond(target, x, y, colour, opacity) {
  const [hw, hh] = TILE;
  const src = [...colour, 255];
  for (let j = -hh; j <= hh; j += 1) {
    const half = hw * (1 - Math.abs(j) / hh) - 6;
    for (let i = Math.ceil(-half); i <= half; i += 1) {
      const tx = Math.round(x + i);
      const ty = Math.round(y + j);
      if (tx >= 0 && ty >= 0 && tx < target.width && ty < target.height) blend(target, (ty * target.width + tx) * 4, src, 0, opacity);
    }
  }
}

/** The draw list for a room: floor, walls, then depth-sorted props and characters. */
export function drawOrder(layout, characters = []) {
  const items = [];
  layout.floor.rows.forEach((line, r) => [...line].forEach((char, c) => {
    if (char !== " ") items.push({ kind: "floor", part: layout.floor.legend[char], at: [c, r], facing: "sw", key: [0, c + r, 0] });
  }));
  for (const wall of layout.walls ?? []) items.push({ kind: "wall", ...wall, key: [1, wall.at[0] + wall.at[1], 0] });
  for (const prop of layout.props ?? []) items.push({ kind: "prop", ...prop, key: [2, prop.at[0] + prop.at[1], prop.front ? 2 : 0] });
  // A partition stands on its tile's back edge: behind everything on that tile, in front of the tiles behind.
  for (const partition of layout.partitions ?? []) {
    items.push({ kind: "partition", ...partition, key: [2, partition.at[0] + partition.at[1], -1] });
  }
  for (const character of characters) items.push({ kind: "character", ...character, key: [2, character.at[0] + character.at[1], 1] });
  const cmp = (a, b) => a.key[0] - b.key[0] || a.key[1] - b.key[1] || a.key[2] - b.key[2] || a.at[0] - b.at[0];
  return items.sort(cmp);
}

export function preview(assetPath, { characters, slots } = {}) {
  const manifest = JSON.parse(readFileSync(join(assetPath, "asset.json"), "utf8"));
  const layout = JSON.parse(readFileSync(join(assetPath, "layout.json"), "utf8"));
  const room = loadAtlas(manifest.render.atlas);
  const people = characters && loadAtlas(characters);
  const [cols, rows] = layout.size;
  const width = (cols + rows) * TILE[0] + 2 * 160;
  const height = (cols + rows) * TILE[1] + 560;
  const origin = [rows * TILE[0] + 160, 500];
  const at = ([c, r]) => [origin[0] + (c - r) * TILE[0], origin[1] + (c + r + 1) * TILE[1]];
  const target = new PNG({ width, height });
  for (let i = 0; i < target.data.length; i += 4) target.data.set([36, 41, 51, 255], i);

  const stations = Object.entries(layout.stations);
  const standing = [];
  for (const [name, station] of stations) {
    for (const slot of station.slots) standing.push({ ...slot, clip: name === "rest" ? "idle" : name });
  }
  const clip = people && (Object.keys(people.animations).find((a) => a.startsWith("idle/"))?.split("/")[0]
    ?? Object.keys(people.animations)[0].split("/")[0]);
  let tinted = !slots;
  for (const item of drawOrder(layout, people ? standing : [])) {
    if (!tinted && item.kind !== "floor") {
      // Slot tints go on top of the floor, under everything that stands.
      stations.forEach(([, station], index) => {
        for (const slot of station.slots) fillDiamond(target, ...at(slot.at), SLOT_COLOURS[index % SLOT_COLOURS.length], 0.45);
      });
      tinted = true;
    }
    if (item.kind === "character") {
      const frames = people.animations[`${item.clip}/${item.facing}`] ?? people.animations[`${clip}/${item.facing}`];
      drawFrame(target, people, frames[0], ...at(item.at));
      continue;
    }
    drawFrame(target, room, `${item.part}/${item.facing}/frame-000`, ...at(item.at));
  }
  return target;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
  const asset = resolve(process.env.INIT_CWD ?? process.cwd(), args[0] ?? "");
  const out = resolve(option("--out") ?? join(root, ".cache", "preview", `${asset.split(/[\\/]/).pop()}.png`));
  const image = preview(asset, { characters: option("--characters"), slots: args.includes("--slots") });
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, PNG.sync.write(image));
  console.log(out);
}
