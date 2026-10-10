# 05: Needs-input marker drawn by the Renderer

**What to build:** The Renderer draws its own marker above every agent with the Needs-input flag, such as a badge or ring, whatever the Theme art is. Themes only set its colour (`palette.alert`). Build it in the dot-grid Renderer now, as a contract the isometric Renderer (10) must also meet.

**Blocked by:** None (can start immediately)

**Status:** resolved

- [x] The marker shows for an agent waiting on the user, and for a lead whose descendant is waiting
- [x] The marker stays visible however the Theme styles the agent, including when a theme's waiting style is missing
- [x] A Renderer contract test that 10 must also pass

## Comments

- 2026-10-11: Done in `packages/renderer`.
  - `Renderer.markers()` returns the needs-input markers the renderer draws for the current state and theme, mounted or not. `needsInputMarkers(theme, world)` gives one per visible agent with the Needs-input flag (waiting itself, or any live descendant waiting), in `palette.alert`, or `DEFAULT_ALERT` when a theme sets none.
  - The dot grid draws the markers in a last pass at full opacity, so no state style (fade, blink, a missing waiting style) can hide or cover them.
  - `validateTheme` now requires `palette.alert`.
  - The contract is `describeRendererContract(name, create)` in `packages/renderer/test/renderer-contract.ts`. `test/dot-grid-renderer.test.ts` runs it for the dot grid, and also checks with a recording canvas that the rings are stroked opaque, after every dot. The isometric Renderer (10) calls the same function.
