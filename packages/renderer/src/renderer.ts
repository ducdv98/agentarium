import { needsInput, visibleAgents, type WorldPatch, type WorldState } from "@agentarium/core";
import type { Theme } from "./theme";

export type RenderUpdate =
  | { kind: "snapshot"; world: WorldState }
  | { kind: "patch"; patch: WorldPatch };

/** A marker the renderer draws itself over an agent with the Needs-input flag, on top of the theme's art. */
export interface NeedsInputMarker {
  key: string;
  color: string;
}

/** Used when a theme sets no `palette.alert`, so the marker never disappears. */
export const DEFAULT_ALERT = "#ff5d5d";

/** One marker per visible agent with the Needs-input flag, in the theme's alert colour. */
export function needsInputMarkers(theme: Theme, world: WorldState): NeedsInputMarker[] {
  const color = theme.palette?.alert || DEFAULT_ALERT;
  return visibleAgents(world)
    .filter((a) => needsInput(world, a.key))
    .map((a) => ({ key: a.key, color }));
}

/** Implemented by every renderer (dot grid now; isometric 2D and 3D later). No React, no DOM framework. */
export interface Renderer {
  mount(element: HTMLElement): void;
  applyState(update: RenderUpdate): void;
  setTheme(theme: Theme): void;
  resize(): void;
  dispose(): void;
  /**
   * The needs-input markers the renderer draws for the current state and theme, mounted or not. Every
   * renderer must pass the contract in `test/renderer-contract.ts`.
   */
  markers(): readonly NeedsInputMarker[];
}
