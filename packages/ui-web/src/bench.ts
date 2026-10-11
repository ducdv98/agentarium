// The isometric Renderer under the load generator's script, for scripts/bench-isometric.mjs (phase-3-scene 10).
// Not part of the app build. Parameters: ?agents=200&mode=load|idle&art=0|1&assets=<URL of the assets directory>.
import { ACTION_CATEGORIES, diffWorld, emptyWorld, reduce, type WorldState } from "@agentarium/core";
import { generateScript } from "@agentarium/loadgen";
import { ANIMATED_STATES, DIRECTIONS, createIsometricRenderer, dotGrid, type Clip, type Theme } from "@agentarium/renderer";

interface FrameSample {
  at: number;
  ms: number;
  draws: number;
}

const params = new URLSearchParams(location.search);
const agents = Number(params.get("agents") ?? 200);
const mode = params.get("mode") ?? "load";
const assets = params.get("assets") ?? "/assets/";
const clip = (name: string): Clip => Object.fromEntries(DIRECTIONS.map((d) => [d, `${name}/${d}`]));

/** dot-grid with the committed office art, standing in for the office Theme (11). */
const office: Theme = {
  ...dotGrid,
  id: "office-bench",
  renderers: {
    "2d": {
      atlases: ["atlases/office-worker.json", "atlases/office-room.json"],
      room: "src/scenes/office-room/layout.json",
      walk: clip("walk"),
      states: Object.fromEntries(ANIMATED_STATES.map((s) => [s, clip(s)])),
      categories: Object.fromEntries(ACTION_CATEGORIES.map((c) => [c, clip(c)])),
    },
  },
};

// The Renderer reports a failed start or art load on the console; the runner rejects such a run.
const failures: string[] = [];
for (const level of ["warn", "error"] as const) {
  const original = console[level].bind(console);
  console[level] = (...args: unknown[]) => {
    failures.push(args.map(String).join(" "));
    original(...args);
  };
}

// Count WebGL draw calls per frame and time every animation-frame callback (the Renderer's own loop).
const samples: FrameSample[] = [];
let draws = 0;
const getContext = HTMLCanvasElement.prototype.getContext as (this: HTMLCanvasElement, type: string, options?: unknown) => unknown;
const counted = new WeakSet<object>();
HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, options?: unknown) {
  const ctx = getContext.call(this, type, options) as Record<string, unknown> | null;
  if (ctx && type.startsWith("webgl") && !counted.has(ctx)) {
    counted.add(ctx);
    for (const name of ["drawElements", "drawArrays", "drawElementsInstanced", "drawArraysInstanced"]) {
      const method = ctx[name];
      if (typeof method !== "function") continue;
      const original = method.bind(ctx) as (...a: unknown[]) => void;
      ctx[name] = (...a: unknown[]) => {
        draws++;
        original(...a);
      };
    }
  }
  return ctx;
} as typeof HTMLCanvasElement.prototype.getContext;
const raf = window.requestAnimationFrame.bind(window);
window.requestAnimationFrame = (cb) =>
  raf((time) => {
    const start = performance.now();
    draws = 0;
    cb(time);
    samples.push({ at: start, ms: performance.now() - start, draws });
  });

const renderer = createIsometricRenderer(params.get("art") === "1" ? office : dotGrid, {
  assetUrl: (path) => `${assets}${path}`,
});
renderer.mount(document.getElementById("stage")!);
window.addEventListener("resize", () => renderer.resize());

let world: WorldState = emptyWorld();
/** Time spent in `applyState`, apart from the reducer and diff that stand in for the daemon. */
const applyMs: { at: number; ms: number }[] = [];
const apply = (next: WorldState): void => {
  const patch = diffWorld(world, next);
  world = next;
  if (!patch.upserts.length && !patch.removed.length) return;
  const start = performance.now();
  renderer.applyState({ kind: "patch", patch });
  applyMs.push({ at: start, ms: performance.now() - start });
};

if (mode === "idle") {
  // Everyone resting and nobody waiting: nothing moves, so the loop must stop.
  let w = emptyWorld();
  for (let i = 0; i < agents; i++) {
    w = reduce(w, { schema_version: 1, kind: "session_start", agent: { machine: "b", provider: "p", session: `s${i}`, agent: "root" }, ts: i });
  }
  world = w;
  renderer.applyState({ kind: "snapshot", world: w });
} else {
  // Root agents only, all started within 9 s and ending at 30 s, so every agent is live while the bench measures.
  const durationMs = 30_000;
  const script = generateScript({ agents, durationMs, seed: 1, subAgentRatio: 0 });
  const start = performance.now();
  let next = 0;
  renderer.applyState({ kind: "snapshot", world });
  setInterval(() => {
    const elapsed = performance.now() - start;
    let w = world;
    while (next < script.length && script[next]!.atMs <= elapsed) w = reduce(w, { ...script[next++]!.event, ts: Date.now() });
    apply(reduce(w, { schema_version: 1, kind: "tick", ts: Date.now() }));
  }, 100);
}

Object.assign(window, {
  __bench: {
    failures,
    samples,
    /**
     * Milliseconds from navigation to the first frame the Renderer drew, and to the last atlas JSON fetched. Pixi
     * decodes the atlas images in a worker, out of this page's resource timing; a failed image load logs a warning.
     */
    firstFrame: () => samples.find((s) => s.draws > 0)?.at ?? null,
    artLoaded: () => {
      const atlases = performance.getEntriesByType("resource").filter((e) => /\/atlases\/[^/]+\.json$/.test(e.name));
      return atlases.length ? Math.max(...atlases.map((e) => (e as PerformanceResourceTiming).responseEnd)) : null;
    },
    applyMs,
    agents: () => Object.values(world.agents).filter((a) => a.status !== "done" && a.status !== "lost").length,
    markers: () => renderer.markers().length,
  },
});
