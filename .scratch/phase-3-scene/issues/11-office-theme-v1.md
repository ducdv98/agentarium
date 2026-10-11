# 11: Office Theme v1

**What to build:** Put together the office Theme from 08 and 09 as a complete `renderers.2d` manifest and ship it as the default for the isometric Renderer.

**Blocked by:** 08, 09, 10

**Status:** ready-for-human. Built; the owner checks a real Codex session and a real waiting prompt in the office.

- [x] The strict theme check passes in CI
- [ ] A real session (Claude Code and Codex) shows working, waiting and idle agents correctly in the office, and a waiting agent is spotted at a glance
- [x] The npm tarball stays under the limit from 06
- [x] The README shows a screenshot and credits the art under CC BY 4.0

## Comments

- 2026-10-11: Built.
  - The office Theme is `office` in `packages/renderer/src/themes/office.ts`, in `shippedThemes`, and the isometric Renderer's default (`createIsometricRenderer()` and the UI). Its Stations take their labels and slot counts from the room's `layout.json`. Each renderer in the UI has its own Theme (`packages/ui-web/src/renderers.ts`): dot-grid keeps `dotGrid`. The UI now opens on Isometric unless `?renderer=` or a remembered choice says otherwise.
  - Strict check: `test/shipped-themes.test.ts` runs in CI under `pnpm test`. For a shipped Theme it also checks that each atlas image exists, that the room parses, and that every Station key is in the room.
  - Size: pack now writes 256-colour palette PNGs (`packing.colors` in `assets/pipeline/settings.json`, via `upng-js`). Both atlases were re-packed from the cached renders without Blender: worker 11.4 to 2.5 MiB, room 2.6 to 0.44 MiB, frames unchanged. Side-by-side crops look the same. UPNG truncates 1x1 pages, so pack decodes each palette page and falls back to lossless if it fails.
  - Shipping: a Vite plugin (`packages/ui-web/vite-plugin-theme-assets.ts`) serves the shipped Themes' files at `/assets/<path>` in dev and copies them into the build, with `assets/LICENSE` and `assets/NOTICE`. `smoke:pack` checks they are in the tarball and served by the installed daemon: 3.37 MiB packed (limit 10 MiB).
  - README: a screenshot at `docs/images/office.png` (load generator at 1/20 speed: working, idle and one waiting Agent), an Art credit and an updated Licence section.
  - Real sessions: a real Claude Code session showed working (exec) at the server racks in the office. Not checked: a real Codex session, because `~/.codex/hooks.json` on this machine has no Agentarium hooks (run `agentarium init`); and a real waiting prompt, which needs an interactive permission prompt. Under the load generator, waiting Agents carry the red marker and their roster rows turn red.
  - Seen while checking: the marker is small at 1x when many Agents crowd the back of the room (the Desks' working slots, Whiteboards and Library are all along the back wall). Worth a look for "spotted at a glance".
