# 10: Isometric Renderer

**What to build:** A Renderer behind the existing `Renderer` interface (`mount`, `applyState`, `setTheme`, `resize`, `dispose`) on the engine chosen in 03, with no React. It places agents at Stations from the Theme's `renderers.2d` section, walks them between Stations, depth-sorts them, tints each agent, fades out lost and done agents, and draws the needs-input marker from 05. The UI can switch between it and dot-grid.

**Blocked by:** 03, 04, 05

**Status:** ready-for-agent

- [ ] Passes the Renderer contract test from 05
- [ ] Runs with placeholder atlases before the office art exists
- [ ] Snapshots and patches from the daemon drive it with no per-frame React work
- [ ] Stays within the performance targets from 03 at 200 agents (load generator)
