# Rendering

Research date: 2026-10-08. Terms follow [CONTEXT.md](../../CONTEXT.md). Scene
vocabulary and manifests are in [themes.md](themes.md).

## Decisions

| Decision | Choice | Status |
|---|---|---|
| First renderer | 2D sprites pre-rendered from Blender, isometric camera | Decided by the project owner (ADR 0007, replaces hand-drawn) |
| 3D | Later, as a separate renderer behind the same interface | Decided |
| 2D engine | PixiJS v8 (8.21.0), WebGL | Decided after the spike (phase-3-scene 03, [results](#spike-results-2026-10-10)) |
| UI shell | React with Vite (static SPA served by the daemon) | Proposed; Next.js static export is the alternative |
| Rendering API | WebGL by default; WebGPU opt-in later | Proposed (see below) |

## Renderer interface

The renderer lives in its own package with no React dependency:

```
mount(element)  applyState(snapshot | patch)  setTheme(theme)
resize()  dispose()
```

React renders panels, overlays and navigation. The canvas is imperative and
mounted through a ref. No per-frame state goes through React. A 3D renderer
later implements the same interface. The theme manifest declares assets per
renderer (`renderers.2d` now, `renderers.3d` later).

`@pixi/react` v8 exists (declarative components registered through `extend`,
plus a `createRoot` API), but the imperative class is preferred here so the
renderer stays framework-independent and swappable.

## Why Pixi, and what the evidence says

- Pixi's own v8 launch post reports large CPU-time gains over v7 in its
  Bunnymark (100k moving sprites, roughly 50 ms to 15 ms CPU frame time). The
  Agentarium scene will have tens of sprites, so raw sprite throughput is not
  the constraint.
- The real costs are batch breaks and idle behavior. Sources list these batch
  breakers: a change of object type, exceeding the per-batch texture limit
  (described as typically 16; check `maxTextures` for the target device), a
  blend-mode change, and topology changes. Filters and masks also break
  batches; a source recommends a few filters on large containers, not one per
  sprite.
- Frames from a single atlas share one GPU texture and batch together. No
  benchmark found for `AnimatedSprite` specifically.
- Tint appears in none of the batch-break lists found, so tinting sprites from
  one atlas should keep batching. The spike confirmed this: plain, tinted and
  colour-mask characters all draw in one call.
  See [Spike results](#spike-results-2026-10-10).
- **Counter-evidence worth noting:** Pixel Agents (see
  [prior-art.md](prior-art.md)) renders its office with plain Canvas 2D at
  about 9.6k stars. At this scale Canvas 2D is evidently enough. Pixi is chosen
  for headroom, tint and filter support, a WebGL path, and an eventual shared
  renderer abstraction, not because Canvas 2D would fail. The spike should
  compare both.
- Phaser 4 was considered. No direct benchmark of Phaser 4 against Pixi for
  isometric scenes or React embedding was found. Phaser is a full game
  framework; Pixi is a renderer, which suits a state-driven scene with little
  game logic.

## WebGL versus WebGPU

Pixi's docs list WebGL as the recommended renderer and WebGPU as more
performant but experimental; one source quotes the docs as saying the WebGPU
renderer is feature complete but that browser implementation inconsistencies
can cause unexpected behavior. A July 2026 write-up describes sprites rendering
blank in Windows Chrome under WebGPU, traced to a browser GPU-process bug.
Recommendation: default to WebGL, allow WebGPU behind a setting, and use
`preference` with automatic fallback only after cross-browser testing.
Not verified: current Pixi version and the live docs wording.

## Isometric specifics

- **Art cost.** Four facing directions are needed. Draw two (for example
  south-east and north-east) and mirror for the other two. Mirroring fails for
  asymmetric art (one-sided hairstyle, baked-in lighting).
- **Contain the cost.** Only walking needs several directions. Idle and working
  poses happen at stations, so each station fixes the character's facing.
  Directional work then applies mainly to walk cycles.
- **Depth sorting.** Back-to-front ordering by roughly `x + y` on the grid.
  Pixi supports sortable children with `zIndex`; sorting many children is
  documented as potentially expensive, so sort only when something moves.
- **Static layers.** Pixi v8's `cacheAsTexture` renders a container to a
  texture that is reused until `updateCacheTexture()` is called. A cached
  container freezes its internal draw order (confirmed by the spike), so it
  suits floors and static props that never interleave with characters. Cache
  static chunks as separate containers; keep characters in a sibling container
  with sortable children; if static objects overlap characters in depth, split
  the cache into depth bands. A community source notes max texture size
  (commonly 4096) and fragility with masks.
- **Grid and projection.** Grid-to-screen math, A* pathfinding on the grid and
  isometric picking are written in-house or via a small library.
- **Layered characters.** Body, hair, outfit and accessory layers on a shared
  rig with anchor points, drawn grayscale or as tint masks and colored by
  tint, so a few drawn parts produce many seeded characters. Avoid custom
  per-sprite palette-swap filters.

## Animation: frames versus skeletal

- **Frame-based sprite sheets** (default for v1): simple, batch-friendly. Keep
  loops to roughly 4 to 8 frames. Frame count multiplies by layers, states and
  drawn directions.
- **Skeletal 2D** cuts frame counts later:
  - **Spine:** official `spine-pixi-v8` runtime, now maintained by Esoteric
    Software. It is under the Spine Runtimes License: apps that use it
    generally require each user of the product (developer) to hold a Spine
    Editor license; a forum reply cites a cheaper tier for revenue under a
    threshold. The full license text and current pricing were not read; check
    before committing. Spine editor and runtime versions must match on
    major.minor.
  - **Rive:** a third-party `pixi-rive` plugin exists; its sample code uses the
    older `app.view` API and maintenance status was not checked.
  - **DragonBones:** MIT, but the tool is listed as discontinued and no
    maintained Pixi runtime was found. Avoid.
- Decide after v1 if sheet counts become unmanageable; do not take the Spine
  dependency up front.

## Performance posture

This is an always-open ambient window, so idle cost matters more than peak
throughput.

- Stop the ticker when nothing animates; render on demand.
- Cap around 30 fps while animating; pause when the tab is hidden; offer a
  low-power mode.
- Overview page: cached thumbnail images per room, refreshed at low frequency,
  not live scenes.
- Headroom if needed: one atlas per theme, compressed textures, culling.

The spike measured these targets with Pixi. The figures are from the low-end
proxy described in the spike results: iGPU, CPU throttled 4×.

| Metric | Target | Pixi, 200 characters with shirt mask |
|---|---|---|
| Idle CPU with nothing animating | Near zero (ticker stopped) | 0 % main thread, but only once `Ticker.system` is also stopped. With it running: 7.6 %. |
| Frame time while animating, 200 agents | Under 16 ms on a low-end laptop | 3.5 ms p50, 5.2 ms p95 |
| Draw calls for a room | Single digits to low tens | 2 |
| Cold load of the UI | A few seconds on localhost | Not measured |

## Definition of a stable v1 (2D)

- One theme (office), about 6 states, 5 to 6 character variants through
  layers, rooms per repo, Claude Code adapter, depth-1 sub-agents.
- The renderer is a pure function of reducer state plus time, with a fixed
  animation timestep; no hidden state in the scene.
- Resilience: error boundaries on panels, WebSocket reconnect with snapshot
  resync, lost-agent cleanup, graceful handling of unknown event types.
- Tests: recorded event fixtures replayed through the reducer, and through a
  headless browser with screenshot comparison; the synthetic 200-agent load.
- CI on Windows, macOS and Linux.

## Spike (done: see results below)

One day, throwaway code:

1. Isometric floor, about 5 placeholder layered characters, 4-direction walk
   cycle, depth sorting, tint coloring.
2. Compare Pixi against plain Canvas 2D on the same scene.
3. Scale to 200 animated sprites; measure CPU, GPU, frame time and draw calls
   on a low-end laptop; measure idle cost with the ticker stopped.
4. Test three cases for batching: plain animated sprites from one atlas, the
   same with tint, the same inside a filtered container.
5. Test `cacheAsTexture` with sorted characters in front of and behind cached
   props.

Pass criteria: the proposed targets above. If Canvas 2D meets them with less
code, record that and decide whether Pixi's headroom is worth the dependency.

## Spike results (2026-10-10)

The code and raw figures are in `spikes/renderer-spike/`, with one
`results/<label>/summary.md` per run (phase-3-scene 03).

### The scene

- The same scene is drawn by Pixi 8.21.0 (WebGL) and by plain Canvas 2D.
- The art is the EEVEE atlases from the Blender spike: one atlas per animation
  and direction, 2× art.
- A 20×20 floor of 128×64 tiles, with 28 desks.
- 200 seeded characters: about 70 % walk tile to tile in 4 directions, the
  rest idle.
- Depth is sorted on `gx + gy`.
- The scene is a pure function of seed and time.
- Both renderers produce the same paused frame. The only differences are
  anti-aliased edges, about 10 order-error pixels in 1280×720.

### Machine and runs

There is no low-end laptop at hand. The owner's laptop has an AMD Ryzen 7
8745H (16 threads), a Radeon 780M iGPU and an RTX 4050, and runs Windows 11
with Chrome 155. It was run in three ways:

- `default`: the RTX 4050 at full CPU speed.
- `low-power + cpu4x`: the low-end proxy. `--force_low_power_gpu` selects the
  Radeon 780M, and CDP throttles the renderer's main thread 4×.
- `swiftshader + cpu4x`: no GPU at all.

The proxy slows only the main thread. The GPU process and the iGPU run at full
speed, so a real low-end laptop with a weaker iGPU could do worse on the GPU
side. Running `node bench.mjs --gpu low-power` on such a machine is cheap if
one becomes available.

How to read the figures:

- CDP throttling keeps the renderer process at about 100 % of a core even when
  idle. Under throttling, compare main-thread busy time, not renderer-process
  CPU.
- GPU time comes from `EXT_disjoint_timer_query_webgl2`, which Chrome 155
  exposes. It covers Pixi only. Canvas 2D has no equivalent, so its GPU cost
  shows only as GPU-process CPU in `summary.md`.
- For Canvas 2D, "draws" are 2D context calls, not GPU draw calls.

### 200 characters, shirt mask, 60 fps cap

The mask case is the worst case: two sprites per character.

| Run | Renderer | fps | Frame ms p50 / p95 | GPU ms p50 | Draws per frame | Main thread % |
|---|---|---:|---|---:|---:|---:|
| RTX 4050 | Pixi | 60 | 0.7 / 1.0 | 0.19 | 2 | 8 |
| RTX 4050 | Canvas 2D | 60 | 1.9 / 2.7 | n/a | 415 | 15 |
| Low-end proxy | Pixi | 60 | 3.5 / 5.2 | 1.6 | 2 | 34 |
| Low-end proxy | Canvas 2D | 55.5 | 14.8 / 20.7 | n/a | 415 | 97 |
| Low-end proxy, 30 fps cap | Pixi | 30 | 2.9 / 4.3 | 0.6 | 2 | 20 |
| Low-end proxy, 30 fps cap | Canvas 2D | 30 | 14.9 / 18.3 | n/a | 415 | 56 |
| SwiftShader | Pixi | 33 | 5.0 / 22.9 | 26 | 1 | 38 |
| SwiftShader | Canvas 2D | 45 | 15.2 / 27.2 | n/a | 415 | 81 |

On the low-end proxy:

- Pixi meets the 16 ms target with about 3× headroom.
- Canvas 2D misses the target, both at 60 fps and at the 30 fps cap.
- Canvas 2D does meet it for plain untinted sprites: 3.4 ms p95.

Canvas 2D has three costs Pixi avoids:

- Tint. Canvas 2D needs a tinted copy of every frame for every colour. Six
  colours made 672 copies and 28 MB, which took 63 to 645 ms to build.
- The second `drawImage` per character for the shirt.
- Blitting the baked desk layers.

On SwiftShader (no GPU), Pixi drops to about 33 fps uncapped. The 30 fps cap
still holds (29.9 fps). Agentarium is unlikely to run without a GPU, but a VM or
remote desktop can.

### Batching

Draw calls per frame for Pixi with 200 characters and no desks:

| Case | iGPU / RTX (16 batchable textures) |
|---|---:|
| Plain sprites | 1 |
| Tinted sprites (`sprite.tint`) | 1 |
| Colour mask (untinted body plus tinted shirt sprite from the same atlas) | 1 |
| Plain sprites in one container with a `ColorMatrixFilter` | 3 |

- Tint and the colour-mask layer do not break batches.
- A filter costs two extra passes per filtered container, not per sprite.
- The full scene draws in 2 calls on hardware GPUs. It has 8 atlases, the
  cached floor and 13 cached desk bands, which exceeds the 16 batchable
  textures. SwiftShader allows 32 textures and needs 1 call.
- In this scene, the texture count set the draw calls; the sprite count did
  not. From 5 to 200 characters the calls stayed at 2, and they changed only
  when the textures went past the limit or a filter was added. No sweep of
  texture or sprite counts was run. The theme atlas should still pack many
  clips per texture: one atlas per animation and direction, as in the Blender
  spike, uses 8 textures before any prop. This is input for the sprite
  pipeline (ticket 06).

### `cacheAsTexture` and depth

Desks were drawn three ways in the same sortable container as the characters:

"Order-error pixels" are differing pixels inside a solid differing area, as
opposed to a 1–2 px resampled edge. It is a heuristic, and the diff images were
also checked by eye: the single-cache errors sit where characters overlap
desks.

| Layout | Order-error pixels at three times (Pixi / Canvas) |
|---|---|
| Plain `Graphics` per desk | The reference |
| All desks in one `cacheAsTexture` container | 1,109–1,606 / 1,234–1,796 |
| One cached container per desk depth row, `zIndex` = row depth | 0 / 12–16 |

- A single cached layer puts every character on one side of every desk.
- Depth bands are correct. The remaining differences are 1–2 px of resampled
  edge (`cache-diff-*.png`).
- Caching saves little at this size. On the RTX the GPU time drops from 1.2 ms
  to 0.19 ms, and CPU time is no lower. Use bands for big static rooms, not
  by default.

### Idle

Pixi's own `Application` ticker stopped with `autoStart: false`, and the spike's
frame loop stopped. Even then, Pixi kept `Ticker.system` running on its own
requestAnimationFrame. Two things use it: `EventsTicker`, for pointer-move hit
tests, and the scheduler that drives texture GC.

| Run | Pixi, loop stopped | Pixi, `Ticker.system` stopped too | Canvas 2D, loop stopped |
|---|---|---|---|
| RTX 4050: main thread / GPU process | 3.0 % / 4.0 % | 0.9 % / 1.3 % | 0 % / 0 % |
| Low-end proxy: main thread / GPU process | 7.6 % / 2.3 % | 0 % / 0 % | 0 % / 0.1 % |

The production renderer must stop `Ticker.system` when nothing animates, and
restart it before the next frame or on pointer input.

### Decision

Choose Pixi v8 with WebGL. It meets every measured target on the low-end proxy
with room to spare; cold load was not measured. Canvas 2D misses the frame-time
target once characters are tinted. Tint and colour
masks are free in batching, and `cacheAsTexture` works with depth bands. The
Canvas 2D version needed hand-written frame placement, a cache of tinted
copies, and a merge of sorted characters with desk layers. Pixi provides all
three.

Rules for the production renderer:

- Drive frames from the renderer's own loop, not `app.ticker`.
- Stop `Ticker.system` when idle.
- Cap at 30 fps while animating.
- Pack few, large atlases per theme.
- Cache static props only in depth bands.

## 3D later

- Separate renderer (Three.js is the likely engine) behind the same interface.
- The theme's `renderers.3d` assets are separate; a 2D theme is not required to
  work in 3D.
- The 3D renderer reuses the rigged Blender sources as glTF (ADR 0007).

## Open questions

- Whether to adopt skeletal animation, and which runtime and license.
- Atlas packer for the scripted Blender pipeline (ADR 0007).
- Camera angle and tile size for the isometric grid.
