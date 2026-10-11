# 10: Isometric Renderer

**What to build:** A Renderer behind the existing `Renderer` interface (`mount`, `applyState`, `setTheme`, `resize`, `dispose`) on the engine chosen in 03, with no React. It places agents at Stations from the Theme's `renderers.2d` section, walks them between Stations, depth-sorts them, tints each agent, fades out lost and done agents, and draws the needs-input marker from 05. The UI can switch between it and dot-grid.

**Blocked by:** 03, 04, 05

**Status:** resolved

- [x] Passes the Renderer contract test from 05
- [x] Runs with placeholder atlases before the office art exists
- [x] Snapshots and patches from the daemon drive it with no per-frame React work
- [x] Stays within the performance targets from 03 at 200 agents (load generator)

## Comments

- 2026-10-10 (from 03): Engine: Pixi v8, WebGL.
  - Drive frames from the renderer's own loop (`autoStart: false`).
  - When nothing animates, also stop `Ticker.system`. `EventsTicker` and the texture-GC scheduler keep it running on its own rAF otherwise; the low-end proxy measured 7.6 % main thread with it running, 0 % without.
  - Cap at 30 fps while animating.
  - Cache static props only in depth bands (one `cacheAsTexture` container per depth row).
  - See `docs/research/rendering.md`, section "Spike results (2026-10-10)".
- 2026-10-11 (from 05): The contract test is `describeRendererContract(name, create)` in `packages/renderer/test/renderer-contract.ts`. Call it with the isometric Renderer's factory. It checks `Renderer.markers()`, so build the markers from `needsInputMarkers(theme, world)` and draw them above the Theme art. The contract cannot check pixels across engines, so also add a Pixi-specific test that the marker draws above the agent sprites, as `test/dot-grid-renderer.test.ts` does for the canvas.
- 2026-10-11 (from 09): The office room is `assets/atlases/office-room.json` plus `assets/src/scenes/office-room/layout.json` (format in `assets/README.md`, "Scene assets and room layouts"). Draw the floor, then the walls, as static layers. Sort props and Agents by `column + row`; on one tile a prop draws behind the Agent unless it has `front: true`. To cache props per depth row, use two bands per row (rear, front) with that row's Agents between. Each Station has fixed slots (tile + facing); the overflow rule when a Station is full is yours to choose. `assets/pipeline/preview.mjs` is a reference for the draw order.
- 2026-10-11 (from 09): `layout.json` now also has `partitions` (the glass meeting room). Sort them with props and Agents by `column + row`; on one tile a partition draws before everything else. Their glass is semi-transparent in the atlas, so draw them with normal alpha blending. Agents cannot walk across a partition edge.
- 2026-10-11: Done.
  - `createIsometricRenderer(theme, { assetUrl })` in `packages/renderer/src/isometric-renderer.ts`. It loads Pixi only on `mount`, so the UI keeps Pixi in its own chunk.
  - The Pixi scene graph is `src/isometric/pixi-view.ts`. Static layers are the floor, then the walls, each cached. Props sit in two cached bands per depth row, rear (partitions first) and front, with that row's Agents between them. Markers are a layer above everything.
  - `src/isometric/scene.ts` is the pure model, with no Pixi and no clock. It covers places, overflow, walking, fades, looks and depth. `src/isometric/room.ts` has the layout parser, the placeholder room and the walk grid.
  - New Theme field: `renderers.2d.room`, the path of a `layout.json`. The strict check requires it.
  - Without a room, or when the art fails to load, the Renderer draws a placeholder room (one block of slots per Station) and placeholder pawns: a body in the state colour, a shirt in the Agent's tint.
  - Overflow rule: "spread, then share". The Agent takes the nearest free non-slot tile; when none is left, it shares the Station's least-used slot, a few pixels apart. Written up in `docs/research/themes.md`.
  - Walking Agents sort by the deeper tile of their step and, within that row, by their interpolated position. Done, lost and removed Agents fade out over 1 s. Agents that join after the first snapshot fade in.
  - Tests: the 05 contract (`test/isometric-renderer.test.ts`), plus a Pixi-specific check that markers draw above the Agents. Model tests are in `test/isometric-scene.test.ts` and `test/isometric-room.test.ts`, with the meeting-room glass checked on the real office layout.
  - The UI has a View select (Dot grid / Isometric), plus `?renderer=isometric`. Checked against a real daemon with the load generator: the roster and the markers agree.
  - Performance: `pnpm --filter @agentarium/ui-web bench:isometric [--gpu low-power --cpu-throttle 4]`. Figures are in `docs/research/rendering.md`, "Production renderer". On the low-end proxy with office art under load: 5.6 / 7.8 ms p50 / p95, 3 draws, 0 % with nothing animating.
  - The bench found two hot spots, both fixed: string-keyed path search, and the quadratic `needsInput` per Agent in `needsInputMarkers`.
  - For 11: the office Theme needs `room: "src/scenes/office-room/layout.json"` and both atlases (`atlases/office-worker.json`, `atlases/office-room.json`). The UI must serve `assets/` (default URL `/assets/<path>`, or pass `assetUrl`). `packages/ui-web/src/bench.ts` builds exactly that Theme for the bench.
  - With office art, resting Agents play their idle clip, so the loop runs at 30 fps whenever anyone is in the room. If that is too costly for an always-open window, a low-power mode (idle clip paused) is the lever.
  - Not done: atlases loaded through `Assets` stay in Pixi's cache after a Theme switch or dispose. This is bounded by the number of distinct Themes.

