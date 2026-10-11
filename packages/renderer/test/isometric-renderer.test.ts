import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Sprite, Texture } from "pixi.js";
import { DIRECTIONS, createIsoScene, createIsometricRenderer, dotGrid, needsInputMarkers, parseRoom, placeholderRoom } from "../src";
import { createIsoView, frameIndex, zIndexOf, type Art } from "../src/isometric/pixi-view";
import { completeTheme } from "./fixtures/theme";
import { agent, world } from "./fixtures/world";
import { describeRendererContract } from "./renderer-contract";

describeRendererContract("isometric", (theme) => createIsometricRenderer(theme));

/** Agents sit between a depth row's rear band (`% 4 === 0`) and front band (`% 4 === 2`). */
const isPawn = (c: { zIndex: number }): boolean => c.zIndex % 4 >= 1 && c.zIndex % 4 < 2;

/** Builds the scene graph for `w` the way the Renderer does on a frame, without WebGL. */
function draw(w: ReturnType<typeof world>, art: Art | null = null, theme = dotGrid) {
  const room = placeholderRoom(theme);
  const scene = createIsoScene(theme, room);
  scene.apply(w, 0);
  const view = createIsoView();
  view.setRoom(room, art);
  const markers = needsInputMarkers(theme, w);
  const result = view.sync(scene.frame(0), markers, 0);
  view.root.updateLocalTransform();
  return { view, result, markers };
}

describe("isometric renderer drawing", () => {
  it("draws the needs-input marker above every agent sprite, opaque, over the waiting agent", () => {
    const faded = { ...dotGrid, states: { ...dotGrid.states, waiting: { color: "#000000", animation: "fade" as const } } };
    const { view, result } = draw(
      world(agent("lead"), agent("leaf", { parent: "lead", status: "waiting", category: "wait" }), agent("z")),
      null,
      faded,
    );
    const { root, layers } = view;
    expect(root.children.indexOf(layers.markers)).toBe(root.children.length - 1);
    expect(root.children.indexOf(layers.markers)).toBeGreaterThan(root.children.indexOf(layers.world));
    expect(layers.markers.children).toHaveLength(2);
    expect(layers.markers.alpha).toBe(1);
    for (const marker of layers.markers.children) {
      expect(marker.alpha).toBe(1);
      expect(marker.visible).toBe(true);
    }
    expect(result.animated).toBe(true);
    expect(result.dirty).toBe(true);
  });

  it("places each marker over its agent's head", () => {
    const { view } = draw(world(agent("a", { status: "waiting", category: "wait" })));
    const pawn = view.layers.world.children.find(isPawn)!;
    const [marker] = view.layers.markers.children;
    expect(marker!.x).toBe(pawn.x);
    expect(marker!.y).toBeLessThan(pawn.y - 40);
  });

  it("draws no marker and stops animating when nobody needs the user and nothing moves", () => {
    const { view, result } = draw(world(agent("a"), agent("b", { status: "idle", category: null })));
    expect(view.layers.markers.children).toHaveLength(0);
    expect(result.animated).toBe(false);
  });

  it("plays the agent's clip from the atlas and tints the shirt layer", () => {
    const frames = (n: number) => Array.from({ length: n }, () => new Texture({ source: Texture.WHITE.source }));
    const clips = new Map<string, { frames: Texture[]; fps: number }>();
    for (const name of ["exec/sw", "exec/ne", "exec/nw", "exec/se"]) {
      clips.set(name, { frames: frames(4), fps: 8 });
      clips.set(`${name}-shirt`, { frames: frames(4), fps: 8 });
    }
    const art: Art = { clips, parts: new Map() };
    const { view, result } = draw(world(agent("a")), art, completeTheme);
    const pawn = view.layers.world.children.find(isPawn)!;
    const [body, shirt] = pawn.children as import("pixi.js").Sprite[];
    expect([...clips.values()].some((c) => c.frames.includes(body!.texture))).toBe(true);
    expect(body!.tint).toBe(0xffffff);
    expect(shirt!.visible).toBe(true);
    expect(shirt!.tint).not.toBe(0xffffff);
    expect(result.animated).toBe(true);
  });

  it("puts a depth row's agents between its rear and front prop bands, walkers by their position", () => {
    for (const position of [4, 4.5, 5]) {
      expect(zIndexOf.rear(5)).toBeLessThan(zIndexOf.agent(5, position));
      expect(zIndexOf.agent(5, position)).toBeLessThan(zIndexOf.front(5));
    }
    expect(zIndexOf.agent(5, 4.25)).toBeLessThan(zIndexOf.agent(5, 4.75));
    expect(zIndexOf.agent(5, 4.75)).toBeLessThan(zIndexOf.agent(5));
    expect(zIndexOf.front(5)).toBeLessThan(zIndexOf.rear(6));
  });

  it("takes any CSS colour a theme uses for the state, as the dot grid does", () => {
    const pawnTint = (color: string) => {
      const theme = { ...dotGrid, states: { working: { color, animation: "none" as const } } };
      const pawn = draw(world(agent("a")), null, theme).view.layers.world.children.find(isPawn)!;
      return (pawn.children[0] as Sprite).tint;
    };
    expect(pawnTint("#f00")).toBe(0xff0000);
    expect(pawnTint("red")).toBe(0xff0000);
    expect(pawnTint("#123456")).toBe(0x123456);
    expect(pawnTint("not a colour")).toBe(0x888888);
  });

  it("advances an agent's clip frame with time", () => {
    const textures = Array.from({ length: 4 }, () => new Texture({ source: Texture.WHITE.source }));
    const clip = { frames: textures, fps: 8 };
    expect([0, 125, 250, 375, 500].map((t) => frameIndex(clip, t))).toEqual([0, 1, 2, 3, 0]);
    expect(frameIndex({ frames: textures.slice(0, 1), fps: 8 }, 900)).toBe(0);
  });

  it("caches the office room's props in a rear and a front band per depth row, partitions first", () => {
    const layout = JSON.parse(readFileSync(join(__dirname, "../../../assets/src/scenes/office-room/layout.json"), "utf8"));
    const room = parseRoom(layout).room!;
    const parts = new Map<string, Texture>();
    const names = new Set([...(room.props ?? []), ...(room.partitions ?? []), ...(room.walls ?? [])].map((p) => p.part));
    for (const part of [...names, ...Object.values(room.floor.legend)]) {
      for (const d of DIRECTIONS) parts.set(`${part}/${d}`, new Texture({ source: Texture.WHITE.source, label: part }));
    }
    const view = createIsoView();
    view.setRoom(room, { clips: new Map(), parts });
    const bands = view.layers.world.children;
    const band = (zIndex: number) => bands.find((b) => b.zIndex === zIndex)!;
    const labels = (zIndex: number) => band(zIndex).children.map((c) => (c as Sprite).texture.label);

    // The front-facing chairs at row 6 (depth 10 to 13) draw over an Agent on their tile; the desks behind them don't.
    expect(labels(zIndexOf.front(10))).toEqual(["chair"]);
    expect(labels(zIndexOf.rear(9))).toContain("desk");
    // At depth 14 the meeting room's glass draws before the props of that row.
    const row14 = labels(zIndexOf.rear(14));
    expect(row14.indexOf("glass-partition")).toBe(0);
    expect(row14.lastIndexOf("glass-partition")).toBeLessThan(row14.findIndex((l) => l !== "glass-partition"));
    for (const b of bands) expect(b.isCachedAsTexture).toBe(true);
    expect(view.layers.walls.children).toHaveLength(room.walls!.length);
  });
});
