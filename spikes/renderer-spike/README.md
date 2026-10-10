# Renderer spike: Pixi against Canvas 2D (phase-3-scene 03)

Throwaway comparison for `.scratch/phase-3-scene/issues/03-renderer-spike.md`, the spike described in
`docs/research/rendering.md`. One isometric scene is drawn by Pixi v8 (WebGL) and by plain Canvas 2D. It uses the
EEVEE atlases from spike 02 (`../blender-pipeline/results/windows-x64-desktop-hg8er1k/eevee-atlas/`, read only) and
contains:

- a 20×20 floor of 128×64 tiles;
- 28 desks;
- up to 200 seeded characters, about 70 % walking and 30 % idle;
- 4-direction walk, depth sorting, and shirt tinting.

The conclusions are in `docs/research/rendering.md`. The raw figures are in `results/<label>/summary.md`.

## Run it

You need Node 22.18 or newer, pnpm 10 and Chrome. The spike is not part of the pnpm workspace.

```powershell
cd spikes\renderer-spike
pnpm install --ignore-workspace
node serve.mjs                       # http://127.0.0.1:5174/?renderer=pixi  or  ?renderer=canvas
node bench.mjs                       # about 5 minutes; opens Chrome windows, don't cover them
node bench.mjs --gpu low-power --cpu-throttle 4
node bench.mjs --quick --cases "mask 200,cache"
```

Page parameters:

| Parameter | Values |
|---|---|
| `renderer` | `pixi` or `canvas` |
| `count` | 200 |
| `seed` | 1 |
| `mode` | `plain`, `tint`, `mask` (default) or `filter` (Pixi only) |
| `cache` | `none`, `single` or `bands` (default) |
| `props` | `0` hides the desks |
| `fps` | `60` (default), `30`, or `0` for every animation frame |
| `t` with `paused=1` | renders one frame at a fixed time |
| `view` | `fit` (default) or `1x` |
| `hud` | `0` hides the overlay |

Bench options:

| Option | Values |
|---|---|
| `--gpu` | `default`, `low-power`, `high-performance` or `swiftshader` |
| `--cpu-throttle` | N, through CDP `Emulation.setCPUThrottlingRate` |
| `--label` | the results folder name |
| `--quick` | short warm-up and measurement windows |
| `--cases` | substring filters; `cache` selects the cache check |
| `--executable` | a Chrome binary other than the installed channel |
| `--port` | the local server port, 5174 by default |

## Files

| File | What it does |
|---|---|
| `scene.js` | The model. `stateAt(t)` is a pure function of seed and time, with incremental walking. Also: desks, bands, view fit. |
| `pixi-renderer.js` | Characters are a `Sprite` body plus a shirt `Sprite` in a `Container`, sorted by `zIndex`. The floor is cached. Desks are plain `Graphics`, one `cacheAsTexture` container, or one cached container per depth row. |
| `canvas-renderer.js` | Frame placement written by hand from the trimmed frames and `meta.scale`. Tinted copies are made per frame and colour on an `OffscreenCanvas`. Baked desk layers, and a merge of sorted characters with the desk layers. |
| `bench-hooks.js` | The only frame loop (rAF with an fps cap). It counts calls per frame on the WebGL or 2D context, measures JS frame time and GPU time (`EXT_disjoint_timer_query_webgl2`), and exposes `window.__bench`. |
| `bench.mjs` | Playwright cases, CDP `Performance.getMetrics` (main-thread busy time) and `SystemInfo.getProcessInfo` (CPU per Chrome process), the cache pixel check, and `summary.md`. |

## What maps to the ticket

| Ticket item | Where |
|---|---|
| The same scene in Pixi v8 and Canvas 2D | `pixi-renderer.js` and `canvas-renderer.js` over `scene.js`. In `summary.md`, the `pixi vs canvas` row compares the same paused frame from both. |
| CPU, GPU, frame time and draw calls at 200 sprites, and idle with the ticker stopped, on a low-end machine | The `* 200`, `* 30fps` and `* idle` rows. The low-end proxy is the iGPU with the CPU throttled 4×; see `rendering.md` for what that does and does not cover. |
| Batching: plain, tinted, colour mask | The `pixi plain/tint/mask 200 no-desks` rows (draw calls per frame), plus `filter` for the filtered-container case in `rendering.md`. |
| `cacheAsTexture` with characters in front of and behind cached props | The cache check table, and `cache-*.png` and `cache-diff-*.png`. `single` is the wrong layout on purpose; `bands` is the proposed one. |
| The engine decision | `docs/research/rendering.md` |

Notes:
- Canvas "draws" count 2D context calls. They are not GPU draw calls, because Chrome batches Canvas 2D internally through Skia.
- `stop()` cancels the spike's own loop. Pixi also runs `Ticker.system` on its own rAF, for pointer-move checks and the
  texture-GC scheduler, even with `autoStart: false`. The `idle + Ticker.system stopped` case stops that too.
- CPU throttling slows the renderer's main thread only. The GPU process and the GPU are not throttled.
- Screenshots: every run keeps `scene-pixi.png` and `scene-canvas.png`. Only the default run keeps the diff images, and only for t = 9.7 (`cache-diff-*-t9.7.png`, `cross-diff-t9.7.png`), to keep the repo small. `node bench.mjs` writes all of them again.
