import { ACTION_CATEGORIES } from "@agentarium/core";
import { ANIMATED_STATES, type Clip, type Renderer2d } from "./theme";

/** Scene art is rendered at 2× (phase 3 spec), so every atlas declares `meta.scale: 2`. */
export const ATLAS_SCALE = 2;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

/** Every animation name the manifest refers to. */
function manifestNames(r2d: Renderer2d): Set<string> {
  const names = new Set<string>();
  const add = (clip: Clip | undefined): void => {
    if (!isRecord(clip)) return;
    for (const name of Object.values(clip)) if (typeof name === "string" && name) names.add(name);
  };
  add(r2d.walk);
  for (const s of ANIMATED_STATES) add(r2d.states?.[s]);
  for (const c of ACTION_CATEGORIES) add(r2d.categories?.[c]);
  return names;
}

/**
 * Checks a `renderers.2d` section against its atlases, given as parsed Pixi v8 spritesheet JSON by path
 * (`undefined` for a missing file). Every name the manifest uses must be a playable animation in exactly
 * one atlas. Returns a list of problems; empty means every animation resolves.
 */
export function checkAtlases(r2d: Renderer2d, atlases: Record<string, unknown>): string[] {
  const problems: string[] = [];
  const names = manifestNames(r2d);
  const found = new Map<string, string[]>();
  for (const path of r2d.atlases ?? []) {
    const atlas = atlases[path];
    if (atlas === undefined) {
      problems.push(`${path}: missing`);
      continue;
    }
    if (!isRecord(atlas) || !isRecord(atlas.frames) || !isRecord(atlas.animations) || !isRecord(atlas.meta)) {
      problems.push(`${path}: not a Pixi v8 spritesheet (needs frames, animations and meta)`);
      continue;
    }
    if (atlas.meta.scale !== ATLAS_SCALE) problems.push(`${path}: meta.scale must be ${ATLAS_SCALE}`);
    const frames = atlas.frames;
    for (const [name, frame] of Object.entries(frames)) {
      if (!isRecord(frame) || !isRecord(frame.frame)) problems.push(`${path}: frame ${name} has no frame rectangle`);
    }
    for (const [name, list] of Object.entries(atlas.animations)) {
      if (!Array.isArray(list) || !list.length) {
        problems.push(`${path}: animation ${name} needs a list of frames`);
        continue;
      }
      for (const frame of list) {
        if (typeof frame !== "string" || !(frame in frames)) problems.push(`${path}: animation ${name} names missing frame ${String(frame)}`);
      }
      if (names.has(name)) found.set(name, [...(found.get(name) ?? []), path]);
    }
  }
  for (const name of names) {
    const paths = found.get(name);
    if (!paths) problems.push(`${name}: in no atlas`);
    else if (paths.length > 1) problems.push(`${name}: in more than one atlas (${paths.join(", ")})`);
  }
  return problems;
}
