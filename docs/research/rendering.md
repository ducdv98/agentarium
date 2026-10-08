# Rendering

Research date: 2026-10-08. Terms follow [glossary.md](glossary.md). Scene
vocabulary and manifests are in [themes.md](themes.md).

## Decisions

| Decision | Choice | Status |
|---|---|---|
| First renderer | Hand-drawn 2D sprites, isometric camera | Decided by the project owner |
| 3D | Later, as a separate renderer behind the same interface | Decided |
| 2D engine | PixiJS v8 | Proposed; confirm with the spike below |
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
  one atlas should keep batching. This is an inference, not a documented
  guarantee; verify in the spike.
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
  texture that is reused until `updateCacheTexture()` is called. Inference
  from the docs: a cached container freezes its internal draw order, so it
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

Targets below are proposals to be confirmed by the spike, not measured values.

| Metric | Proposed target |
|---|---|
| Idle CPU with nothing animating | Near zero (ticker stopped) |
| Frame time while animating, 200 agents | Under 16 ms on a low-end laptop |
| Draw calls for a room | Single digits to low tens |
| Cold load of the UI | A few seconds on localhost |

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

## Spike (do this before locking the engine)

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

## 3D later

- Separate renderer (Three.js is the likely engine) behind the same interface.
- The theme's `renderers.3d` assets are separate; a 2D theme is not required to
  work in 3D.
- Reusing the 2D art in 3D is not expected; plan separate asset work.

## Open questions

- Pixi versus plain Canvas 2D after the spike.
- Whether to adopt skeletal animation, and which runtime and license.
- Art tooling and the sprite-atlas pipeline (Aseprite or similar; atlas
  packer).
- Camera angle and tile size for the isometric grid.
