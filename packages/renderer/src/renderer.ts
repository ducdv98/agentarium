import type { WorldPatch, WorldState } from "@agentarium/core";
import type { Theme } from "./theme";

export type RenderUpdate =
  | { kind: "snapshot"; world: WorldState }
  | { kind: "patch"; patch: WorldPatch };

/** Implemented by every renderer (dot grid now; isometric 2D and 3D later). No React, no DOM framework. */
export interface Renderer {
  mount(element: HTMLElement): void;
  applyState(update: RenderUpdate): void;
  setTheme(theme: Theme): void;
  resize(): void;
  dispose(): void;
}
