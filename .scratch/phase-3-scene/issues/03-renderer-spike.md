# 03: Spike: Pixi against Canvas 2D

**What to build:** The spike in `docs/research/rendering.md`, but using the atlas from 02 instead of hand-drawn placeholders: an isometric floor, depth sorting, 4-direction walk and tint, scaled up to 200 animated sprites.

**Blocked by:** 02

**Status:** resolved. Pixi v8 (WebGL) is chosen; results and rules for the renderer are in `docs/research/rendering.md`, section "Spike results (2026-10-10)".

- [x] The same scene in Pixi v8 and in plain Canvas 2D
- [x] CPU, GPU, frame time and draw calls at 200 sprites, plus idle cost with the ticker stopped, on a low-end machine. Done on a proxy, not a real low-end machine: the owner's laptop on its iGPU with the CPU throttled 4×. GPU time is measured for Pixi only
- [x] Batching checked in three cases: plain sprites, tinted sprites, and the colour-mask approach from 02
- [x] `cacheAsTexture` with characters sorted in front of and behind cached props
- [x] The engine decision recorded in `rendering.md` (the 2D engine row is now settled)

## Comments

- 2026-10-10: Spike built in `spikes/renderer-spike/`: one deterministic scene (`scene.js`), a Pixi 8.21.0 renderer and a Canvas 2D renderer over the 02 EEVEE atlases, and a Playwright bench (`bench.mjs`) that records fps, JS frame time, GPU time (`EXT_disjoint_timer_query_webgl2`), draw calls, main-thread busy time and per-process CPU, plus a `cacheAsTexture` pixel check. Codex drafted a first version; Claude rewrote it because the draw-call counts, the fps cap and the Canvas frame timing were wrong.
  - No low-end laptop was available. The low-end proxy is the owner's laptop with Chrome forced onto the Radeon 780M iGPU and the renderer main thread throttled 4× (CDP). SwiftShader (no GPU) was run too. Results: `spikes/renderer-spike/results/*/summary.md`.
  - At 200 characters with shirt masks on the proxy, Pixi runs at 60 fps with a 5.2 ms p95 frame and 2 draw calls. Canvas 2D runs at 55 fps with a 20.7 ms p95 frame.
  - Plain, tinted and colour-mask sprites batch into 1 call. A filtered container adds 2.
  - `cacheAsTexture` is correct only in depth bands: 0 order-error pixels, against more than 1,100 with a single cached layer.
  - Idle reaches 0 % only after `Ticker.system` is stopped too.
  - Decision: Pixi v8.
- 2026-10-10: Follow-ups for 06 and 10:
  - Pack few, large atlases. In this scene the texture count, not the sprite count, set the draw calls; the iGPU and the RTX batch 16 textures.
  - The isometric renderer drives its own loop, stops `Ticker.system` when idle, caps at 30 fps, and caches static props only in depth bands.
  - A real low-end laptop run (`node bench.mjs --gpu low-power`) is still worth doing if one becomes available.
