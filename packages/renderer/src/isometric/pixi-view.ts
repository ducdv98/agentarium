import { Color, Container, Graphics, Sprite, Text, Texture } from "pixi.js";
import { DEFAULT_ALERT, type NeedsInputMarker } from "../renderer";
import { tileToScreen } from "./room";
import type { RoomLayout, SceneAgent, SceneFrame } from "./types";

/** A playable animation from a Theme atlas. */
export interface Clip {
  frames: Texture[];
  fps: number;
}

/** A Theme's loaded 2D art. Parts are room frames by `<part>/<facing>`. */
export interface Art {
  clips: Map<string, Clip>;
  parts: Map<string, Texture>;
}

/** Placeholder characters, in 1x pixels: a body in the state's colour with a shirt in the Agent's tint. */
const PAWN = { width: 22, height: 46, shirt: 16 };
const MARKER_GAP = 14;
const PADDING = 24;
const MAX_SCALE = 2;
const SLOT_COLOURS = [0xe2574c, 0x4ca0e2, 0x60c470, 0xc470dc, 0x46c8c8, 0xe6963c, 0x9696f0, 0xdcc850, 0xf05aa0, 0xa0a0a0];

/**
 * Draw order inside the sorted world container: for each depth (`column + row`) the rear band (partitions, then
 * props), then that depth's Agents, then the front band (`front: true` props).
 */
export const zIndexOf = {
  rear: (depth: number) => depth * 4,
  /**
   * A walking Agent counts at the deeper tile of its step, so it never draws behind a prop it walks past; within
   * that row, its interpolated `column + row` orders it against the other Agents.
   */
  agent: (depth: number, position = depth) => depth * 4 + 1 + Math.min(1, Math.max(0, 1 - (depth - position))) / 2,
  front: (depth: number) => depth * 4 + 2,
};

interface Pawn {
  root: Container;
  body: Sprite;
  shirt: Sprite;
  /** Pixels from the feet up to the top of the head, for the marker. */
  height: number;
  /** Drawn as the placeholder pawn rather than from a clip. */
  placeholder: boolean;
}

export interface IsoView {
  /** Add this to the stage. Its children are the floor, walls, world (sorted) and markers layers, in that order. */
  readonly root: Container;
  readonly layers: { floor: Container; walls: Container; world: Container; markers: Container };
  /** Rebuilds the static layers. `art` null (or a missing part) draws the placeholder room. */
  setRoom(room: RoomLayout, art: Art | null): void;
  /**
   * Updates Agents and markers for one frame. Returns whether anything visible changed (a render is needed) and
   * whether something will change on its own (a clip with more than one frame, or a marker's pulse).
   */
  sync(frame: SceneFrame, markers: readonly NeedsInputMarker[], now: number): { dirty: boolean; animated: boolean };
  /** Scales and centres the room in a viewport of `width` × `height` CSS pixels. */
  fit(width: number, height: number): void;
  destroy(): void;
}

const colours = new Map<string, number>();

/** A Theme colour (any CSS colour, as the dot grid takes it) as 0xRRGGBB, else `fallback`. */
function colour(css: string, fallback: string): number {
  let value = colours.get(css);
  if (value === undefined) {
    try {
      value = new Color(css).toNumber();
    } catch {
      value = new Color(fallback).toNumber();
    }
    colours.set(css, value);
  }
  return value;
}

/** One frame index for a clip at `time` ms. */
export function frameIndex(clip: Clip, time: number): number {
  const n = clip.frames.length;
  return n <= 1 ? 0 : Math.floor((Math.max(0, time) * clip.fps) / 1000) % n;
}

/** Feet-to-head-top height of a trimmed, anchored frame at 1x. */
function headHeight(texture: Texture): number {
  const anchorY = texture.defaultAnchor?.y ?? 1;
  return anchorY * texture.orig.height - (texture.trim?.y ?? 0);
}

function placeSprite(texture: Texture, column: number, row: number): Sprite {
  const sprite = new Sprite(texture);
  const { x, y } = tileToScreen(column, row);
  sprite.position.set(x, y);
  return sprite;
}

function diamond(g: Graphics, column: number, row: number, inset = 0): Graphics {
  const { x, y } = tileToScreen(column, row);
  const hw = 64 - inset;
  const hh = 32 - inset / 2;
  return g.poly([x, y - hh, x + hw, y, x, y + hh, x - hw, y]);
}

/** The scene graph of the isometric Renderer, without an Application, so it can be built and checked headless. */
export function createIsoView(options: { labels?: boolean } = {}): IsoView {
  const root = new Container();
  const floor = new Container();
  const walls = new Container();
  const world = new Container();
  const markersLayer = new Container();
  world.sortableChildren = true;
  root.addChild(floor, walls, world, markersLayer);

  let art: Art | null = null;
  let bands: Container[] = [];
  const pawns = new Map<string, Pawn>();
  const markerGraphics = new Map<string, Graphics>();

  function clear(container: Container): void {
    for (const child of container.removeChildren()) child.destroy({ children: true, context: true });
  }

  function buildFloor(room: RoomLayout): void {
    clear(floor);
    const placeholder = new Graphics();
    room.floor.rows.forEach((line, row) => {
      [...line].forEach((char, column) => {
        if (char === " ") return;
        const texture = art?.parts.get(`${room.floor.legend[char]}/sw`);
        if (texture) floor.addChild(placeSprite(texture, column, row));
        else diamond(placeholder, column, row).fill((column + row) % 2 ? 0x2b3f43 : 0x31494a).stroke({ color: 0x42635d, width: 1 });
      });
    });
    if (!art) {
      // No room art: show where each Station is, so the placeholder room still reads.
      Object.values(room.stations).forEach((station, index) => {
        for (const slot of station.slots) {
          diamond(placeholder, slot.at[0], slot.at[1], 10).fill({ color: SLOT_COLOURS[index % SLOT_COLOURS.length]!, alpha: 0.35 });
        }
      });
    }
    floor.addChild(placeholder);
    if (!art && options.labels) {
      for (const station of Object.values(room.stations)) {
        const first = station.slots[0];
        if (!first) continue;
        const label = new Text({ text: station.label, style: { fill: 0x9aa5b1, fontSize: 14, fontFamily: "system-ui, sans-serif" } });
        const { x, y } = tileToScreen(first.at[0], first.at[1]);
        label.anchor.set(0.5, 1);
        label.position.set(x, y - 34);
        floor.addChild(label);
      }
    }
    floor.cacheAsTexture(true);
  }

  function buildWalls(room: RoomLayout): void {
    clear(walls);
    for (const wall of room.walls ?? []) {
      const texture = art?.parts.get(`${wall.part}/${wall.facing}`);
      if (texture) walls.addChild(placeSprite(texture, wall.at[0], wall.at[1]));
    }
    walls.cacheAsTexture(true);
  }

  /** Two cached bands per depth row, so Agents of that row draw between them. */
  function buildBands(room: RoomLayout): void {
    for (const band of bands) band.destroy({ children: true });
    bands = [];
    const rear = new Map<number, Sprite[]>();
    const front = new Map<number, Sprite[]>();
    const add = (into: Map<number, Sprite[]>, part: string, facing: string, at: readonly [number, number]): void => {
      const texture = art?.parts.get(`${part}/${facing}`);
      if (!texture) return;
      const depth = at[0] + at[1];
      into.set(depth, [...(into.get(depth) ?? []), placeSprite(texture, at[0], at[1])]);
    };
    // Partitions first: on one tile a partition draws before everything else.
    for (const p of room.partitions ?? []) add(rear, p.part, p.facing, p.at);
    const props = [...(room.props ?? [])].sort((a, b) => a.at[0] - b.at[0]);
    for (const p of props) add(p.front ? front : rear, p.part, p.facing, p.at);
    const band = (sprites: Sprite[], zIndex: number): void => {
      const container = new Container();
      container.addChild(...sprites);
      container.zIndex = zIndex;
      container.cacheAsTexture(true);
      world.addChild(container);
      bands.push(container);
    };
    for (const [depth, sprites] of rear) band(sprites, zIndexOf.rear(depth));
    for (const [depth, sprites] of front) band(sprites, zIndexOf.front(depth));
  }

  function createPawn(): Pawn {
    const root = new Container();
    const body = new Sprite(Texture.WHITE);
    const shirt = new Sprite(Texture.WHITE);
    root.addChild(body, shirt);
    world.addChild(root);
    return { root, body, shirt, height: PAWN.height, placeholder: false };
  }

  function setTexture(sprite: Sprite, texture: Texture): boolean {
    if (sprite.texture === texture) return false;
    sprite.texture = texture;
    sprite.anchor.copyFrom(texture.defaultAnchor ?? { x: 0.5, y: 1 });
    sprite.scale.set(1);
    return true;
  }

  /**
   * Draws `agent` from its clip, or as a placeholder pawn. Returns whether the clip has more than one frame, and
   * sets `changed` when a texture or tint changed.
   */
  function drawPawn(pawn: Pawn, agent: SceneAgent): boolean {
    const clip = agent.animation ? art?.clips.get(agent.animation) : undefined;
    if (clip?.frames.length) {
      pawn.placeholder = false;
      const index = frameIndex(clip, agent.animationTime);
      const body = clip.frames[index]!;
      if (setTexture(pawn.body, body)) {
        changed = true;
        pawn.height = headHeight(body);
      }
      const shirt = art?.clips.get(`${agent.animation}-shirt`)?.frames[index];
      pawn.shirt.visible = !!shirt;
      pawn.shirt.position.set(0, 0); // the placeholder pawn moves its shirt up
      if (shirt) {
        if (setTexture(pawn.shirt, shirt)) changed = true;
        setTint(pawn.shirt, agent.tint);
        setTint(pawn.body, 0xffffff);
      } else {
        setTint(pawn.body, agent.tint);
      }
      return clip.frames.length > 1;
    }
    setTint(pawn.body, colour(agent.stateColor, "#888888"));
    setTint(pawn.shirt, agent.tint);
    if (pawn.placeholder) return false;
    pawn.placeholder = true;
    changed = true;
    pawn.body.texture = Texture.WHITE;
    pawn.shirt.texture = Texture.WHITE;
    pawn.body.anchor.set(0.5, 1);
    pawn.body.width = PAWN.width;
    pawn.body.height = PAWN.height;
    pawn.shirt.visible = true;
    pawn.shirt.anchor.set(0.5, 0);
    pawn.shirt.width = PAWN.width;
    pawn.shirt.height = PAWN.shirt;
    pawn.shirt.position.set(0, -PAWN.height + PAWN.shirt / 2);
    pawn.height = PAWN.height;
    return false;
  }

  function createMarker(color: string): Graphics {
    // A badge with an exclamation mark, opaque, in the alert colour: no Theme style can hide it.
    const g = new Graphics()
      .circle(0, 0, 11)
      .fill(colour(color, DEFAULT_ALERT))
      .stroke({ color: 0xffffff, width: 2 })
      .rect(-1.5, -6, 3, 7)
      .fill(0xffffff)
      .circle(0, 4, 1.8)
      .fill(0xffffff);
    markersLayer.addChild(g);
    return g;
  }

  /** Whether anything visible changed since the last render. */
  let changed = true;

  function setTint(sprite: Sprite, tint: number): void {
    if (sprite.tint === tint) return;
    sprite.tint = tint;
    changed = true;
  }

  return {
    root,
    layers: { floor, walls, world, markers: markersLayer },

    setRoom(room, nextArt) {
      art = nextArt;
      buildFloor(room);
      buildWalls(room);
      buildBands(room);
      // Pawns keep their sprites; the next sync redraws them from the new art.
      changed = true;
    },

    sync(frame, markers, now) {
      let animated = markers.length > 0;
      const seen = new Set<string>();
      for (const agent of frame.agents) {
        seen.add(agent.key);
        let pawn = pawns.get(agent.key);
        if (!pawn) {
          pawn = createPawn();
          pawns.set(agent.key, pawn);
          changed = true;
        }
        animated = drawPawn(pawn, agent) || animated;
        const { x, y } = tileToScreen(agent.column, agent.row);
        const px = x + agent.offset.x;
        const py = y + agent.offset.y;
        if (pawn.root.x !== px || pawn.root.y !== py || pawn.root.alpha !== agent.alpha) {
          pawn.root.position.set(px, py);
          pawn.root.alpha = agent.alpha;
          changed = true;
        }
        const zIndex = zIndexOf.agent(agent.depth, agent.column + agent.row);
        if (pawn.root.zIndex !== zIndex) pawn.root.zIndex = zIndex; // Pixi re-sorts only when a zIndex changed
      }
      for (const [key, pawn] of pawns) {
        if (seen.has(key)) continue;
        pawn.root.destroy({ children: true });
        pawns.delete(key);
        changed = true;
      }

      const pulse = 1 + 0.15 * Math.sin((now / 1000) * 5);
      const marked = new Set<string>();
      for (const m of markers) {
        const pawn = pawns.get(m.key);
        if (!pawn) continue;
        marked.add(m.key);
        let g = markerGraphics.get(m.key);
        if (g && g.label !== m.color) {
          g.destroy({ context: true });
          g = undefined;
        }
        if (!g) {
          g = createMarker(m.color);
          g.label = m.color;
          markerGraphics.set(m.key, g);
        }
        g.position.set(pawn.root.x, pawn.root.y - pawn.height - MARKER_GAP);
        g.scale.set(pulse);
        changed = true; // the marker pulses
      }
      for (const [key, g] of markerGraphics) {
        if (marked.has(key)) continue;
        g.destroy({ context: true });
        markerGraphics.delete(key);
        changed = true;
      }

      const dirty = changed;
      changed = false;
      return { dirty, animated };
    },

    fit(width, height) {
      root.scale.set(1);
      root.position.set(0, 0);
      const bounds = floor.getLocalBounds();
      const wallBounds = walls.children.length ? walls.getLocalBounds() : null;
      const minX = Math.min(bounds.minX, wallBounds?.minX ?? Infinity);
      const minY = Math.min(bounds.minY, wallBounds?.minY ?? Infinity);
      const maxX = Math.max(bounds.maxX, wallBounds?.maxX ?? -Infinity);
      const maxY = Math.max(bounds.maxY, wallBounds?.maxY ?? -Infinity);
      const roomWidth = maxX - minX + PADDING * 2;
      const roomHeight = maxY - minY + PADDING * 2;
      if (!(roomWidth > 0 && roomHeight > 0 && width > 0 && height > 0)) return;
      const scale = Math.min(MAX_SCALE, width / roomWidth, height / roomHeight);
      root.scale.set(scale);
      root.position.set(
        (width - (maxX + minX) * scale) / 2,
        (height - (maxY + minY) * scale) / 2,
      );
    },

    destroy() {
      root.destroy({ children: true, context: true });
      pawns.clear();
      markerGraphics.clear();
    },
  };
}
