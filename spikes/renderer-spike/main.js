// Page entry: parse params, build the scene and one renderer, install the bench hooks, start the loop.
import { createScene } from "./scene.js";
import { installBench } from "./bench-hooks.js";

const q = new URLSearchParams(location.search);
const num = (k, d) => (q.has(k) ? Number(q.get(k)) : d);
const o = {
  renderer: q.get("renderer") ?? "pixi",
  count: num("count", 200),
  seed: num("seed", 1),
  mode: q.get("mode") ?? "mask", // plain | tint | mask | filter (filter is Pixi only; Canvas draws it as plain)
  cache: q.get("cache") ?? "bands", // none | single | bands
  props: q.get("props") !== "0",
  fps: num("fps", 60), // 0 = every animation frame
  width: num("width", 1280),
  height: num("height", 720),
  view: q.get("view") ?? "fit",
  paused: q.get("paused") === "1",
  t: num("t", 0),
};

const index = await (await fetch("/atlas/index.json")).json();
const scene = createScene(o);
const { createRenderer } = o.renderer === "canvas"
  ? { createRenderer: (await import("./canvas-renderer.js")).createCanvasRenderer }
  : { createRenderer: (await import("./pixi-renderer.js")).createPixiRenderer };
const renderer = await createRenderer(document.getElementById("app"), o, scene, index);
const bench = installBench(renderer, o);
bench.info.params = o;

if (o.paused) bench.renderAt(o.t);
else bench.start();

if (q.get("hud") !== "0") {
  const hud = document.getElementById("hud");
  setInterval(() => {
    const s = bench.stats();
    hud.textContent = `${o.renderer} ${o.mode} ${o.count}  ${s.fps} fps  frame p95 ${s.frameMs?.p95 ?? "-"} ms  draws ${s.drawCalls?.mean ?? "-"}`;
  }, 500);
}
window.__ready = true;
