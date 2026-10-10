// Frame loop and measurement hooks shared by both renderers, exposed as window.__bench for bench.mjs.
// The loop is the only thing that schedules frames: stop() leaves no rAF, no timer and no ticker running, which is the
// "ticker stopped" idle posture from docs/research/rendering.md.

const RING = 900;

const summarise = (values) => {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b), at = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  const round = (v) => Math.round(v * 1000) / 1000;
  return { mean: round(s.reduce((a, b) => a + b, 0) / s.length), p50: round(at(0.5)), p95: round(at(0.95)), max: round(s.at(-1)) };
};

// Counts calls to the named methods on target (a WebGL context or a 2D context) while `counting` is on.
function countCalls(target, names) {
  const counter = { calls: 0, counting: false };
  for (const name of names) {
    const original = target[name];
    if (typeof original !== "function") continue;
    target[name] = function (...args) {
      if (counter.counting) counter.calls++;
      return original.apply(this, args);
    };
  }
  return counter;
}

/**
 * @param renderer { name, drawFrame(t), drawTarget, drawNames, gpuTimer?, info }
 * @param options parsed URL params (fps cap, paused time)
 */
export function installBench(renderer, options) {
  const counter = countCalls(renderer.drawTarget, renderer.drawNames);
  const frameMs = [], intervalMs = [], draws = [], gpuMs = [];
  const push = (ring, v) => { ring.push(v); if (ring.length > RING) ring.shift(); };
  let raf = 0, next = 0, lastPresented = 0, running = false, frames = 0;
  // fps cap on any display rate (this laptop runs at 144 Hz): render when the next deadline is reached, then move the
  // deadline by one interval, so the average rate is the cap even though each gap is a whole number of vsyncs.
  const interval = options.fps > 0 ? 1000 / options.fps : 0;

  function frame(t) {
    counter.calls = 0;
    counter.counting = true;
    const start = performance.now();
    renderer.drawFrame(t);
    push(frameMs, performance.now() - start);
    counter.counting = false;
    push(draws, counter.calls);
    frames++;
    const g = renderer.gpuTimer?.poll();
    if (g != null) for (const v of g) push(gpuMs, v);
  }

  function tick(ms) {
    if (!running) return;
    raf = requestAnimationFrame(tick);
    if (interval) {
      if (ms < next - 2) return; // 2 ms slack for vsync jitter
      next = ms - next > interval ? ms + interval : next + interval;
    }
    if (lastPresented) push(intervalMs, ms - lastPresented);
    lastPresented = ms;
    frame(ms / 1000);
  }

  const bench = {
    info: { ...renderer.info, gpuTimer: renderer.gpuTimer ? "EXT_disjoint_timer_query_webgl2" : "unavailable" },
    get running() { return running; },
    start() { if (running) return; running = true; lastPresented = 0; next = 0; renderer.resume?.(); raf = requestAnimationFrame(tick); },
    stop() { running = false; cancelAnimationFrame(raf); raf = 0; },
    // Also stop the engine's own background loop, if it has one (Pixi's Ticker.system).
    stopBackground() { renderer.pauseBackground?.(); },
    renderAt(t) { frame(t); }, // one frame at a fixed time, for screenshots
    resetStats() { frameMs.length = intervalMs.length = draws.length = gpuMs.length = 0; frames = 0; lastPresented = 0; },
    stats() {
      const interval = summarise(intervalMs);
      return {
        frames,
        fps: interval ? Math.round(10000 / interval.mean) / 10 : 0,
        intervalMs: interval,
        frameMs: summarise(frameMs),
        drawCalls: summarise(draws),
        gpuMs: summarise(gpuMs),
      };
    },
  };
  window.__bench = bench;
  return bench;
}

// GPU time per frame from EXT_disjoint_timer_query_webgl2, when the browser exposes it (Chrome usually does not).
export function createGpuTimer(gl) {
  const ext = gl?.getExtension?.("EXT_disjoint_timer_query_webgl2");
  if (!ext) return null;
  const pending = [];
  return {
    begin() { const q = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, q); pending.push(q); },
    end() { gl.endQuery(ext.TIME_ELAPSED_EXT); },
    poll() {
      const done = [];
      const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT);
      while (pending.length && gl.getQueryParameter(pending[0], gl.QUERY_RESULT_AVAILABLE)) {
        const q = pending.shift();
        if (!disjoint) done.push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6);
        gl.deleteQuery(q);
      }
      return done;
    },
  };
}
