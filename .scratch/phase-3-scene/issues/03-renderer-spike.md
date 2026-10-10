# 03: Spike: Pixi against Canvas 2D

**What to build:** The spike in `docs/research/rendering.md`, but using the atlas from 02 instead of hand-drawn placeholders: an isometric floor, depth sorting, 4-direction walk and tint, scaled up to 200 animated sprites.

**Blocked by:** 02

**Status:** ready-for-agent

- [ ] The same scene in Pixi v8 and in plain Canvas 2D
- [ ] CPU, GPU, frame time and draw calls at 200 sprites, plus idle cost with the ticker stopped, on a low-end machine
- [ ] Batching checked in three cases: plain sprites, tinted sprites, and the colour-mask approach from 02
- [ ] `cacheAsTexture` with characters sorted in front of and behind cached props
- [ ] The engine decision recorded in `rendering.md` (the 2D engine row is now settled)
