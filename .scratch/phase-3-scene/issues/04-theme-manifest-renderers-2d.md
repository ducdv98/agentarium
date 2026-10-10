# 04: Theme manifest: `renderers.2d` and the strict check

**What to build:** A `renderers.2d` section in the Theme manifest that points at atlases and names the animation for each state, action category and direction, as sketched in `docs/research/themes.md`. `resolveAgent` keeps its runtime fallback. `validateTheme` gains a strict mode, run in CI for themes we ship, that fails when a shipped theme lacks any of the nine categories, any required state animation, or any of the 4 directions.

**Blocked by:** 02 (atlas and naming format)

**Status:** ready-for-agent

- [ ] Manifest types extended. The dot-grid theme stays valid without a `renderers.2d` section
- [ ] At runtime, a missing animation falls back and never throws
- [ ] Strict validation lists every gap, and a test covers a complete theme and an incomplete one
- [ ] A CI check that every animation a manifest names exists in its committed atlas JSON
