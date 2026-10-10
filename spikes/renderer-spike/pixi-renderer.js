// Pixi v8 (WebGL) renderer for the spike scene.
import { Application, Assets, ColorMatrixFilter, Container, Graphics, Sprite, Ticker, VERSION } from "/pixi.js/pixi.mjs";
import { GRID, gridToScreen, propBands, deskPolys, viewTransform, frameAt } from "./scene.js";
import { createGpuTimer } from "./bench-hooks.js";

export const drawFloor = (g) => {
  for (let gx = 0; gx < GRID; gx++) for (let gy = 0; gy < GRID; gy++) {
    const { x, y } = gridToScreen(gx, gy);
    g.poly([x, y - 32, x + 64, y, x, y + 32, x - 64, y]).fill((gx + gy) % 2 ? 0x2b3f43 : 0x31494a).stroke({ color: 0x42635d, width: 1 });
  }
};

const drawDesk = (g, p) => { for (const face of deskPolys(p)) g.poly(face.points).fill(face.color); };

export async function createPixiRenderer(host, o, scene, index) {
  const app = new Application();
  await app.init({ preference: "webgl", width: o.width, height: o.height, background: 0x10161b, antialias: false, resolution: 1, autoStart: false, sharedTicker: false });
  app.ticker.stop(); // autoStart: false already; belt and braces so nothing ticks behind the bench loop
  host.appendChild(app.canvas);

  // Clips: "walk/se" -> { fps, body: Texture[], shirt: Texture[] }, all frames of one clip in one atlas texture.
  const clips = {};
  for (const [key, info] of Object.entries(index.sheets)) {
    const sheet = await Assets.load(`/atlas/${info.json}`);
    clips[key] = { fps: info.fps, body: sheet.animations[key], shirt: sheet.animations[`${key}-shirt`] };
  }

  const view = viewTransform(o.width, o.height, o.view);
  const root = new Container();
  root.position.set(view.x, view.y);
  root.scale.set(view.scale);
  app.stage.addChild(root);

  // The floor never interleaves with anything, so it is always one cached texture.
  const floor = new Container();
  const floorG = new Graphics();
  drawFloor(floorG);
  floor.addChild(floorG);
  floor.cacheAsTexture(true);

  // Characters and props share one sortable container; zIndex is the depth key.
  const world = new Container();
  world.sortableChildren = true;
  root.addChild(floor, world);
  if (o.mode === "filter") world.filters = [new ColorMatrixFilter()];

  if (o.props) {
    if (o.cache === "none") {
      for (const p of scene.props) { const g = new Graphics(); drawDesk(g, p); g.zIndex = p.depth; world.addChild(g); }
    } else if (o.cache === "single") {
      // Deliberately wrong: one cached texture has one zIndex, so characters cannot sit between desks.
      const all = new Container();
      for (const p of scene.props) { const g = new Graphics(); drawDesk(g, p); all.addChild(g); }
      all.zIndex = scene.props[0].depth;
      all.cacheAsTexture(true);
      world.addChild(all);
    } else {
      // One cached container per depth row of desks; characters sort between the bands.
      for (const [depth, row] of propBands(scene.props)) {
        const band = new Container();
        for (const p of row) { const g = new Graphics(); drawDesk(g, p); band.addChild(g); }
        band.zIndex = depth;
        band.cacheAsTexture(true);
        world.addChild(band);
      }
    }
  }

  const chars = scene.stateAt(0).map((s) => {
    const c = new Container();
    const body = new Sprite(clips["idle/se"].body[0]), shirt = new Sprite(clips["idle/se"].shirt[0]);
    body.anchor.copyFrom(body.texture.defaultAnchor); // the packer writes one feet anchor for every frame
    shirt.anchor.copyFrom(shirt.texture.defaultAnchor);
    if (o.mode === "tint") body.tint = s.tint;
    shirt.tint = s.tint;
    shirt.visible = o.mode === "mask";
    c.addChild(body, shirt);
    world.addChild(c);
    return { c, body, shirt };
  });

  const gl = app.renderer.gl;
  const gpuTimer = createGpuTimer(gl);

  function drawFrame(t) {
    const state = scene.stateAt(t);
    for (let i = 0; i < state.length; i++) {
      const s = state[i], ch = chars[i], clip = clips[`${s.anim}/${s.dir}`];
      const f = frameAt(s.animTime, clip.fps, clip.body.length);
      ch.body.texture = clip.body[f];
      if (o.mode === "mask") ch.shirt.texture = clip.shirt[f];
      ch.c.position.set(s.x, s.y);
      ch.c.zIndex = s.depth; // Pixi only re-sorts when a zIndex actually changed
    }
    gpuTimer?.begin();
    app.render();
    gpuTimer?.end();
  }

  return {
    name: "pixi",
    drawFrame,
    drawTarget: gl,
    drawNames: ["drawElements", "drawArrays", "drawElementsInstanced", "drawArraysInstanced"],
    gpuTimer,
    canvas: app.canvas,
    // Pixi runs Ticker.system on its own rAF for pointer-move checks (EventsTicker) and the scheduler (texture GC),
    // even with autoStart: false. Stopping it is what makes the canvas fully idle.
    pauseBackground: () => Ticker.system.stop(),
    resume: () => Ticker.system.start(),
    info: {
      renderer: "pixi", pixi: VERSION, glVersion: gl.getParameter(gl.VERSION),
      gpu: gpuString(gl), maxBatchableTextures: app.renderer.limits?.maxBatchableTextures ?? null,
    },
  };
}

export function gpuString(gl) {
  const ext = gl?.getExtension("WEBGL_debug_renderer_info");
  return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl?.getParameter(gl.RENDERER) ?? null;
}
