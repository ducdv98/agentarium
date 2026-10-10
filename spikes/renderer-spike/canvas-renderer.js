// Plain Canvas 2D renderer for the same scene. Everything Pixi gives for free (tint, cached layers, depth sorting,
// trimmed-frame placement) is written by hand here, which is part of what the spike compares.
import { GRID, gridToScreen, propBands, deskPolys, viewTransform, frameAt } from "./scene.js";

const css = (hex) => `#${hex.toString(16).padStart(6, "0")}`;

function drawFloor(ctx) {
  ctx.strokeStyle = "#42635d";
  for (let gx = 0; gx < GRID; gx++) for (let gy = 0; gy < GRID; gy++) {
    const { x, y } = gridToScreen(gx, gy);
    ctx.beginPath();
    ctx.moveTo(x, y - 32); ctx.lineTo(x + 64, y); ctx.lineTo(x, y + 32); ctx.lineTo(x - 64, y); ctx.closePath();
    ctx.fillStyle = (gx + gy) % 2 ? "#2b3f43" : "#31494a";
    ctx.fill();
    ctx.stroke();
  }
}

function drawDesk(ctx, p) {
  for (const face of deskPolys(p)) {
    const pts = face.points;
    ctx.beginPath();
    ctx.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
    ctx.closePath();
    ctx.fillStyle = css(face.color);
    ctx.fill();
  }
}

// Pre-renders world-space drawing into an offscreen canvas at the view scale; returns a blit for the world transform.
function bake(bounds, scale, draw) {
  const c = new OffscreenCanvas(Math.ceil(bounds.w * scale), Math.ceil(bounds.h * scale));
  const ctx = c.getContext("2d");
  ctx.scale(scale, scale);
  ctx.translate(-bounds.x, -bounds.y);
  draw(ctx);
  return (target) => target.drawImage(c, bounds.x, bounds.y, bounds.w, bounds.h);
}

const deskBounds = (props) => {
  const xs = [], ys = [];
  for (const p of props) for (const f of deskPolys(p)) f.points.forEach((v, i) => (i % 2 ? ys : xs).push(v));
  const x = Math.min(...xs) - 2, y = Math.min(...ys) - 2;
  return { x, y, w: Math.max(...xs) + 2 - x, h: Math.max(...ys) + 2 - y };
};

export async function createCanvasRenderer(host, o, scene, index) {
  const canvas = document.createElement("canvas");
  canvas.width = o.width; canvas.height = o.height;
  host.appendChild(canvas);
  const ctx = canvas.getContext("2d");

  // Clips: frame rects from the TexturePacker JSON. Frames are trimmed and art is 2x (meta.scale), so each frame is
  // drawn at (anchor offset + trim offset) / scale, which is what Pixi does for a Sprite with the sheet's anchor.
  const clips = {};
  for (const [key, info] of Object.entries(index.sheets)) {
    const json = await (await fetch(`/atlas/${info.json}`)).json();
    const image = await createImageBitmap(await (await fetch(`/atlas/${json.meta.image}`)).blob());
    const res = json.meta.scale || 1;
    const frame = (name) => {
      const f = json.frames[name];
      return {
        image, sx: f.frame.x, sy: f.frame.y, sw: f.frame.w, sh: f.frame.h,
        dx: (f.spriteSourceSize.x - f.sourceSize.w * f.anchor.x) / res, dy: (f.spriteSourceSize.y - f.sourceSize.h * f.anchor.y) / res,
        dw: f.frame.w / res, dh: f.frame.h / res, tinted: new Map(),
      };
    };
    clips[key] = { fps: info.fps, body: json.animations[key].map(frame), shirt: json.animations[`${key}-shirt`].map(frame) };
  }

  // Canvas 2D has no per-draw tint. Tinted copies are made lazily, one per (frame, colour): multiply by the colour like
  // Pixi's tint, then restore the frame's alpha. Their memory is reported in info.
  const tintStats = { copies: 0, bytes: 0, ms: 0 };
  function tinted(fr, color) {
    let c = fr.tinted.get(color);
    if (c) return c;
    const start = performance.now();
    c = new OffscreenCanvas(fr.sw, fr.sh);
    const t = c.getContext("2d");
    t.drawImage(fr.image, fr.sx, fr.sy, fr.sw, fr.sh, 0, 0, fr.sw, fr.sh);
    t.globalCompositeOperation = "multiply";
    t.fillStyle = css(color);
    t.fillRect(0, 0, fr.sw, fr.sh);
    t.globalCompositeOperation = "destination-in";
    t.drawImage(fr.image, fr.sx, fr.sy, fr.sw, fr.sh, 0, 0, fr.sw, fr.sh);
    fr.tinted.set(color, c);
    tintStats.copies++; tintStats.bytes += fr.sw * fr.sh * 4; tintStats.ms += performance.now() - start;
    return c;
  }

  const draw = (fr, x, y, color) => {
    if (color == null) ctx.drawImage(fr.image, fr.sx, fr.sy, fr.sw, fr.sh, x + fr.dx, y + fr.dy, fr.dw, fr.dh);
    else ctx.drawImage(tinted(fr, color), 0, 0, fr.sw, fr.sh, x + fr.dx, y + fr.dy, fr.dw, fr.dh);
  };

  const view = viewTransform(o.width, o.height, o.view);
  const floorBounds = { x: -GRID * 64 - 2, y: -34, w: GRID * 128 + 4, h: GRID * 64 + 4 };
  const blitFloor = bake(floorBounds, view.scale, drawFloor);

  // Props as depth-sorted items: one per desk (none), one for all (single, deliberately wrong) or one per band.
  let propItems = [];
  if (o.props) {
    if (o.cache === "none") propItems = scene.props.map((p) => ({ depth: p.depth, draw: () => drawDesk(ctx, p) }));
    else if (o.cache === "single") {
      const blit = bake(deskBounds(scene.props), view.scale, (c) => scene.props.forEach((p) => drawDesk(c, p)));
      propItems = [{ depth: scene.props[0].depth, draw: () => blit(ctx) }];
    } else {
      propItems = propBands(scene.props).map(([depth, row]) => {
        const blit = bake(deskBounds(row), view.scale, (c) => row.forEach((p) => drawDesk(c, p)));
        return { depth, draw: () => blit(ctx) };
      });
    }
  }

  // Characters are drawn interleaved with the (already depth-sorted) prop items: sort characters, then merge.
  propItems.sort((a, b) => a.depth - b.depth);
  let order = [];

  function drawFrame(t) {
    const state = scene.stateAt(t);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#10161b";
    ctx.fillRect(0, 0, o.width, o.height);
    ctx.setTransform(view.scale, 0, 0, view.scale, view.x, view.y);
    blitFloor(ctx);
    if (order.length !== state.length) order = state.map((_, i) => i);
    order.sort((a, b) => state[a].depth - state[b].depth); // nearly sorted frame to frame, so this is cheap
    let p = 0;
    for (const i of order) {
      const s = state[i];
      while (p < propItems.length && propItems[p].depth <= s.depth) propItems[p++].draw();
      const clip = clips[`${s.anim}/${s.dir}`], f = frameAt(s.animTime, clip.fps, clip.body.length);
      draw(clip.body[f], s.x, s.y, o.mode === "tint" ? s.tint : null);
      if (o.mode === "mask") draw(clip.shirt[f], s.x, s.y, s.tint);
    }
    while (p < propItems.length) propItems[p++].draw();
  }

  return {
    name: "canvas",
    drawFrame,
    drawTarget: ctx,
    drawNames: ["drawImage", "fill", "stroke", "fillRect"],
    gpuTimer: null,
    canvas,
    info: { renderer: "canvas", tintCopies: tintStats },
  };
}
