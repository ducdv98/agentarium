// Renderer-independent scene model (phase-3-scene 03). Both renderers draw exactly what stateAt(t) returns, so the
// scene is a pure function of seed + time: the same t gives the same picture in Pixi and in Canvas 2D.

export const GRID = 20; // tiles per side
export const TILE_W = 128, TILE_H = 64; // the agreed camera's tile, in screen px at 1x
export const WALK_SECONDS = 0.6; // time to cross one tile
export const PALETTE = [0x3b82f6, 0x14b8a6, 0x8b5cf6, 0xf43f5e, 0xf59e0b, 0x22c55e];

// Grid axes to atlas directions: +gx runs down-right on screen (se), +gy down-left (sw).
export const DIRS = ["sw", "se", "ne", "nw"];
const STEP = { sw: [0, 1], se: [1, 0], ne: [0, -1], nw: [-1, 0] };

export const gridToScreen = (gx, gy) => ({ x: (gx - gy) * (TILE_W / 2), y: (gx + gy) * (TILE_H / 2) });

// Integer hash -> [0, 1). Deterministic across browsers, unlike Math.random.
export function hash(...parts) {
  let n = 0x9e3779b9;
  for (const p of parts) {
    n = Math.imul(n ^ (p | 0), 0x85ebca6b);
    n = Math.imul(n ^ (n >>> 13), 0xc2b2ae35);
    n ^= n >>> 16;
  }
  return (n >>> 0) / 4294967296;
}

// Desks in four rows with gaps, so characters walk both in front of and behind them.
export const PROPS = [];
for (const gy of [4, 8, 12, 16]) for (let gx = 3; gx <= 16; gx += 2) PROPS.push({ id: PROPS.length, gx, gy, depth: gx + gy });
const blocked = new Set(PROPS.map((p) => `${p.gx},${p.gy}`));
export const isFree = (gx, gy) => gx >= 0 && gy >= 0 && gx < GRID && gy < GRID && !blocked.has(`${gx},${gy}`);

// Floating-point depth for one character. Ties with props cannot overlap visually (props block their tile), and the
// id term keeps the order between characters stable.
const depthOf = (gx, gy, id) => gx + gy + id * 1e-5;

export function createScene({ count = 200, seed = 1 } = {}) {
  const chars = [];
  for (let id = 0; id < count; id++) {
    let gx, gy, n = 0;
    do { gx = Math.floor(hash(seed, id, 1, n) * GRID); gy = Math.floor(hash(seed, id, 2, n) * GRID); n++; } while (!isFree(gx, gy));
    const walker = hash(seed, id, 3) < 0.7;
    const dir = DIRS[Math.floor(hash(seed, id, 4) * 4)];
    chars.push({
      id, walker, tint: PALETTE[Math.floor(hash(seed, id, 5) * PALETTE.length)], phase: hash(seed, id, 6) * 4,
      start: { gx, gy, dir }, // walkers replay from here when time goes backwards
      gx, gy, dir, step: 0, move: null, // move = the direction taken during `step`, or null when blocked
    });
  }

  // Direction for the move during step s: mostly keep going, sometimes turn, never into a desk or off the grid.
  function chooseMove(c, s) {
    const keep = hash(seed, c.id, 7, s) < 0.6;
    const first = keep ? DIRS.indexOf(c.dir) : Math.floor(hash(seed, c.id, 8, s) * 4);
    for (let k = 0; k < 4; k++) {
      const dir = DIRS[(first + k) % 4], [dx, dy] = STEP[dir];
      if (isFree(c.gx + dx, c.gy + dy)) return dir;
    }
    return null;
  }

  // Advance walkers to the step containing t. Incremental, so per-frame cost does not grow with time.
  function advanceTo(c, step) {
    if (step < c.step) Object.assign(c, { gx: c.start.gx, gy: c.start.gy, dir: c.start.dir, step: 0, move: null });
    if (c.step === 0 && c.move === null) c.move = chooseMove(c, 0);
    while (c.step < step) {
      if (c.move) { const [dx, dy] = STEP[c.move]; c.gx += dx; c.gy += dy; c.dir = c.move; }
      c.step++;
      c.move = chooseMove(c, c.step);
    }
  }

  const out = chars.map((c) => ({ id: c.id, tint: c.tint, x: 0, y: 0, depth: 0, anim: "idle", dir: c.dir, animTime: 0 }));

  // The scene at time t (seconds). Returns the same array every call, updated in place, to keep frames garbage-free.
  function stateAt(t) {
    const step = Math.floor(t / WALK_SECONDS), f = t / WALK_SECONDS - step;
    for (const c of chars) {
      const o = out[c.id];
      let gx = c.gx, gy = c.gy;
      if (c.walker) {
        advanceTo(c, step);
        gx = c.gx; gy = c.gy;
        if (c.move) { const [dx, dy] = STEP[c.move]; gx += dx * f; gy += dy * f; }
      }
      const p = gridToScreen(gx, gy);
      o.x = p.x; o.y = p.y;
      o.depth = depthOf(gx, gy, c.id);
      o.anim = c.walker && c.move ? "walk" : "idle";
      o.dir = c.walker && c.move ? c.move : c.dir;
      o.animTime = t + c.phase;
    }
    return out;
  }

  return { stateAt, props: PROPS };
}

// Frame index for an animation clip from the atlas index (fps, frame count).
export const frameAt = (animTime, fps, frames) => Math.floor(animTime * fps) % frames;

// World-to-canvas fit: the whole floor plus head room for characters on the back row.
export function viewTransform(width, height, view) {
  const worldW = GRID * TILE_W, worldH = GRID * TILE_H + 180;
  const scale = view === "1x" ? 1 : Math.min(width / worldW, height / worldH);
  return { scale, x: width / 2, y: 150 * scale + TILE_H / 2 * scale };
}

// Band key for cacheAsTexture: one band per prop depth row, so a character can always sort between two bands.
export function propBands(props) {
  const bands = new Map();
  for (const p of props) {
    if (!bands.has(p.depth)) bands.set(p.depth, []);
    bands.get(p.depth).push(p);
  }
  return [...bands].sort((a, b) => a[0] - b[0]);
}

// Desk geometry shared by both renderers: top, left face, right face, each as a flat [x, y, ...] polygon.
export function deskPolys(p) {
  // A box on a diamond slightly smaller than the tile (half-width w, half-height d), raised by h.
  const { x, y } = gridToScreen(p.gx, p.gy), w = 50, d = 25, h = 56;
  return [
    { color: 0x6b4f45, points: [x - w, y - h, x - w, y, x, y + d, x, y + d - h] }, // left face
    { color: 0x8f6a52, points: [x, y + d - h, x, y + d, x + w, y, x + w, y - h] }, // right face
    { color: 0xc59a6b, points: [x - w, y - h, x, y - d - h, x + w, y - h, x, y + d - h] }, // top
  ];
}
