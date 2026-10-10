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
