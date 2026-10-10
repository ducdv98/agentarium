import { ACTION_CATEGORIES } from "@agentarium/core";
import { DIRECTIONS, dotGrid, type Clip, type Theme } from "../../src";

const clips = ["walk", "idle", "waiting", "blocked", ...ACTION_CATEGORIES];
const clip = (name: string): Clip => Object.fromEntries(DIRECTIONS.map((d) => [d, `${name}/${d}`]));

/** dot-grid plus a complete `renderers.2d` section, backed by `completeAtlas`. */
export const completeTheme: Theme = {
  ...dotGrid,
  id: "complete",
  renderers: {
    "2d": {
      atlases: ["test/atlas.json"],
      walk: clip("walk"),
      states: { idle: clip("idle"), waiting: clip("waiting"), blocked: clip("blocked") },
      categories: Object.fromEntries(ACTION_CATEGORIES.map((c) => [c, clip(c)])),
    },
  },
};

const rect = { frame: { x: 0, y: 0, w: 1, h: 1 } };

/** A minimal Pixi v8 spritesheet with one frame per clip and direction. */
export const completeAtlas = {
  frames: Object.fromEntries(clips.flatMap((name) => DIRECTIONS.map((d) => [`${name}/${d}/frame-000`, rect]))),
  animations: Object.fromEntries(clips.flatMap((name) => DIRECTIONS.map((d) => [`${name}/${d}`, [`${name}/${d}/frame-000`]]))),
  meta: { image: "atlas.png", scale: 2 },
};
