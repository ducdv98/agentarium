# 10: Isometric Renderer

**What to build:** A Renderer behind the existing `Renderer` interface (`mount`, `applyState`, `setTheme`, `resize`, `dispose`) on the engine chosen in 03, with no React. It places agents at Stations from the Theme's `renderers.2d` section, walks them between Stations, depth-sorts them, tints each agent, fades out lost and done agents, and draws the needs-input marker from 05. The UI can switch between it and dot-grid.

**Blocked by:** 03, 04, 05

**Status:** ready-for-agent

- [ ] Passes the Renderer contract test from 05
- [ ] Runs with placeholder atlases before the office art exists
- [ ] Snapshots and patches from the daemon drive it with no per-frame React work
- [ ] Stays within the performance targets from 03 at 200 agents (load generator)

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
