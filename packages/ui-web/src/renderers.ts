import { createDotGridRenderer, createIsometricRenderer, dotGrid, office, type Renderer, type Theme } from "@agentarium/renderer";

export const RENDERERS = {
  "dot-grid": { label: "Dot grid", theme: dotGrid, create: () => createDotGridRenderer(dotGrid) },
  isometric: { label: "Isometric", theme: office, create: () => createIsometricRenderer(office) },
} satisfies Record<string, { label: string; theme: Theme; create: () => Renderer }>;
export type RendererId = keyof typeof RENDERERS;

/** The query choice wins over the remembered choice. */
export function initialRenderer(search: string, saved: string | null = null): RendererId {
  const isId = (v: string | null): v is RendererId => !!v && Object.hasOwn(RENDERERS, v);
  const param = new URLSearchParams(search).get("renderer");
  if (isId(param)) return param;
  return isId(saved) ? saved : "isometric";
}
