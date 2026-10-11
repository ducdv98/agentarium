import { applyPatch, emptyWorld, type WorldState } from "@agentarium/core";
import type { Application, Texture } from "pixi.js";
import type { Art, IsoView } from "./isometric/pixi-view";
import { parseRoom, placeholderRoom } from "./isometric/room";
import { createIsoScene } from "./isometric/scene";
import type { RoomLayout } from "./isometric/types";
import { needsInputMarkers, type NeedsInputMarker, type RenderUpdate, type Renderer } from "./renderer";
import type { Theme } from "./theme";
import { dotGrid } from "./themes/dot-grid";

/** Frames are capped at 30 fps while something animates (phase-3-scene 03). */
const FRAME_MS = 1000 / 30;

export interface IsometricOptions {
  /** Turns a path relative to the assets directory into a URL. Default: `/assets/<path>`. */
  assetUrl?: (path: string) => string;
  /** The clock for walking and fading, in ms. Default: `performance.now`. */
  now?: () => number;
}

interface Loaded {
  room: RoomLayout;
  art: Art | null;
}

/** Loads a Theme's atlases and room. Missing or broken files leave the placeholders in place. */
async function loadTheme(theme: Theme, assetUrl: (path: string) => string): Promise<Loaded> {
  const placeholder: Loaded = { room: placeholderRoom(theme), art: null };
  const r2d = theme.renderers?.["2d"];
  if (!r2d?.room) return placeholder;
  try {
    const { Assets } = await import("pixi.js");
    const response = await fetch(assetUrl(r2d.room));
    const { room, problems } = parseRoom(await response.json());
    if (!room) throw new Error(`${r2d.room}: ${problems.join("; ")}`);
    const art: Art = { clips: new Map(), parts: new Map() };
    for (const path of r2d.atlases) {
      const sheet = await Assets.load(assetUrl(path));
      const fps: Record<string, number> = sheet.data?.meta?.fps ?? {};
      for (const [name, frames] of Object.entries<Texture[]>(sheet.animations ?? {})) {
        art.clips.set(name, { frames, fps: fps[name] ?? 8 });
      }
      for (const [name, texture] of Object.entries<Texture>(sheet.textures ?? {})) {
        const part = /^(.*)\/frame-000$/.exec(name)?.[1];
        if (part) art.parts.set(part, texture);
      }
    }
    return { room, art };
  } catch (error) {
    console.warn(`agentarium: ${theme.id} 2D art did not load; drawing placeholders.`, error);
    return placeholder;
  }
}

/**
 * The isometric 2D Renderer on Pixi v8 (WebGL). It draws a Theme's room and characters from `renderers.2d`, or
 * placeholders until (or unless) the art loads. Frames come from its own loop, capped at 30 fps, and only while
 * something animates; when nothing does, Pixi's system ticker is stopped too, so an idle scene costs nothing.
 */
export function createIsometricRenderer(initial: Theme = dotGrid, options: IsometricOptions = {}): Renderer {
  const assetUrl = options.assetUrl ?? ((path: string) => `/assets/${path}`);
  const now = options.now ?? (() => performance.now());
  let theme = initial;
  let world: WorldState = emptyWorld();
  let markers: NeedsInputMarker[] = [];
  let room = placeholderRoom(theme);
  let art: Art | null = null;
  const scene = createIsoScene(theme, room);

  let host: HTMLElement | null = null;
  let app: Application | null = null;
  let view: IsoView | null = null;
  let stopSystemTicker: (() => void) | null = null;
  let startSystemTicker: (() => void) | null = null;
  let frame = 0;
  let lastFrame = -Infinity;
  /** Bumped on every theme change and on dispose, so a late load is dropped. */
  let generation = 0;
  /** Bumped on dispose, so a late init is dropped. */
  let mounts = 0;

  function schedule(): void {
    if (!view || frame) return;
    startSystemTicker?.();
    frame = requestAnimationFrame(tick);
  }

  function tick(time: number): void {
    frame = 0;
    if (!app || !view) return;
    if (time - lastFrame < FRAME_MS - 1) {
      frame = requestAnimationFrame(tick);
      return;
    }
    lastFrame = time;
    const t = now();
    const current = scene.frame(t);
    const { dirty, animated } = view.sync(current, markers, t);
    if (dirty) app.render();
    if (current.changing || animated) frame = requestAnimationFrame(tick);
    else stopSystemTicker?.();
  }

  function useRoom(next: Loaded): void {
    room = next.room;
    art = next.art;
    scene.setRoom(room);
    if (view && host) {
      view.setRoom(room, art);
      view.fit(host.clientWidth, host.clientHeight);
    }
    schedule();
  }

  function load(): void {
    const mine = ++generation;
    useRoom({ room: placeholderRoom(theme), art: null });
    if (!theme.renderers?.["2d"]?.room || !host) return;
    void loadTheme(theme, assetUrl).then((loaded) => {
      if (mine === generation) useRoom(loaded);
    });
  }

  async function init(element: HTMLElement, mine: number): Promise<void> {
    const pixi = await import("pixi.js");
    const { createIsoView } = await import("./isometric/pixi-view");
    const next = new pixi.Application();
    await next.init({
      preference: "webgl",
      background: theme.palette.background,
      antialias: false,
      autoStart: false,
      sharedTicker: false,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
      width: Math.max(1, element.clientWidth),
      height: Math.max(1, element.clientHeight),
    });
    if (mine !== mounts) {
      next.destroy(true);
      return;
    }
    next.ticker.stop();
    next.renderer.background.color = theme.palette.background; // the Theme may have changed during init
    next.stage.eventMode = "none";
    // EventsTicker and the texture GC keep Ticker.system on its own requestAnimationFrame; stop it while idle.
    stopSystemTicker = () => pixi.Ticker.system.stop();
    startSystemTicker = () => pixi.Ticker.system.start();
    next.canvas.style.display = "block";
    element.appendChild(next.canvas);
    app = next;
    view = createIsoView({ labels: true });
    next.stage.addChild(view.root);
    load();
  }

  return {
    mount(element) {
      host = element;
      void init(element, mounts).catch((error) => console.error("agentarium: the isometric renderer failed to start", error));
    },
    applyState(update: RenderUpdate) {
      world = update.kind === "snapshot" ? update.world : applyPatch(world, update.patch);
      scene.apply(world, now());
      markers = needsInputMarkers(theme, world);
      schedule();
    },
    setTheme(next) {
      theme = next;
      scene.setTheme(theme);
      markers = needsInputMarkers(theme, world);
      if (app) app.renderer.background.color = theme.palette.background;
      load();
    },
    resize() {
      if (!app || !host || !view) return;
      app.renderer.resize(Math.max(1, host.clientWidth), Math.max(1, host.clientHeight));
      view.fit(host.clientWidth, host.clientHeight);
      lastFrame = -Infinity;
      view.sync(scene.frame(now()), markers, now());
      app.render();
      schedule();
    },
    markers() {
      return markers;
    },
    dispose() {
      generation++;
      mounts++;
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      view?.destroy();
      view = null;
      app?.destroy({ removeView: true }, { children: true });
      app = null;
      host = null;
      startSystemTicker?.(); // leave Pixi's shared ticker as other Pixi users expect it
      startSystemTicker = stopSystemTicker = null;
    },
  };
}
