# 04: Theme manifest: `renderers.2d` and the strict check

**What to build:** A `renderers.2d` section in the Theme manifest that points at atlases and names the animation for each state, action category and direction, as sketched in `docs/research/themes.md`. `resolveAgent` keeps its runtime fallback. `validateTheme` gains a strict mode, run in CI for themes we ship, that fails when a shipped theme lacks any of the nine categories, any required state animation, or any of the 4 directions.

**Blocked by:** 02 (atlas and naming format)

**Status:** resolved

- [x] Manifest types extended. The dot-grid theme stays valid without a `renderers.2d` section
- [x] At runtime, a missing animation falls back and never throws
- [x] Strict validation lists every gap, and a test covers a complete theme and an incomplete one
- [x] A CI check that every animation a manifest names exists in its committed atlas JSON

## Comments

- 2026-10-11: Done in `packages/renderer`.
  - `Theme.renderers["2d"]` (`Renderer2d`) lists `atlases` (Pixi v8 JSON, relative to `assets/`). It names a clip for `walk`, for the states `idle`, `waiting` and `blocked`, and for each of the nine `categories`. Each clip maps `ne`, `nw`, `se` and `sw` to animation names.
  - `resolveAnimation(theme, agent, direction, moving)` never throws. A missing direction uses another direction of the clip, and a missing clip falls back to idle, then to null. Lost and done get null. `resolveAgent` is unchanged.
  - `validateTheme(theme, { strict: true })` lists every gap. `checkAtlases` checks that every name the manifest uses is a playable animation in exactly one atlas, and that each atlas sets `meta.scale: 2`.
  - `test/shipped-themes.test.ts` runs both checks in CI on every Theme in `shippedThemes` that has a 2D section. Today that list is only dot-grid, which has no 2D section, so the 2D checks start with the office Theme (11).
  - The settled format is in `docs/research/themes.md`.
