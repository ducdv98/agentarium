# Phase 3: Isometric scene

Goal: replace the dot-grid stand-in with the first illustrated scene, an isometric office. In it, each Agent is a character pre-rendered from Blender, and an Agent waiting on the user stands out at a glance. Terms follow `CONTEXT.md`. Decisions are in `docs/adr/`, especially ADR 0004 (amended: the nine action categories are frozen) and ADR 0007 (scene art pre-rendered from scripted Blender sources). Research: `docs/research/rendering.md`, `docs/research/themes.md` and `docs/research/scene-art-pipeline.md`.

## Scope

- Two spikes before any production work: the Blender pipeline on the owner's Ubuntu VPS, then Pixi against Canvas 2D on that pipeline's atlas.
- A character look prototype the owner approves before any production art.
- A maintained sprite pipeline: `.blend` sources in Git LFS, a pinned Blender build, render scripts, an atlas packer, one rebuild command and per-asset licence manifests.
- The office Theme v1: a CC0 MPFB2/MakeHuman base on one Agentarium Rigify rig, animations we author ourselves, and a scripted room, Stations and props.
- A Theme manifest `renderers.2d` section with a strict completeness check for themes we ship.
- A needs-input marker drawn by the Renderer, independent of Theme art.
- An isometric Renderer behind the existing `Renderer` interface, on the engine the spike picks.
- Housekeeping: skip the `codex-live` tests where Unix sockets are unavailable, and trace npm's `0.0.0-stage` version.

Out of scope for this phase:
- The 3D Renderer. The `.blend` sources stay rigged for it (ADR 0007).
- The all-rooms home page, auto-start on login, multiple machines.
- Install-safety items P2-IS-05 through P2-IS-10, and the unreached Codex permission cases (custom profile, auto-review rejection). Both stay `needs-triage`.
- Any change to the AgentEvent schema or the nine action categories.
- Mixamo, Quaternius QAL, Sketchfab or any non-redistributable source in the repo.

## Decisions (from grilling, 2026-10-10)

- **The usage-log gate is waived for this phase.** Phases 1 and 2 needed usage-log evidence before scope grew. The log is still empty one day into Phase 1's planned two weeks of use. This phase only reads `WorldState` and changes neither the event model nor the adapters, so a wrong triage signal would show up as a log entry against core or the adapters, not against the scene. Logging continues in `.scratch/daily-use/usage-log.md` alongside this phase.
- **Isometric is a Renderer, not a Theme** (`CONTEXT.md`). Office is the first illustrated Theme. Dot-grid stays as the minimal Renderer and Theme.
- **No pixel art.** Characters are 3D-modelled in Blender and pre-rendered to sprites (ADR 0007). They don't copy Pixel Agents' look (ADR 0001).
- **Camera:** orthographic, X 60°, Z 45°, giving a 2:1 grid. Tiles 128×64 px, characters about 128 px tall at 1×, rendered at 2×. Pixi atlases set `meta.scale` to match.
- **Per character:** walk, idle, one working pose for each of the nine action categories, waiting, blocked and error, all in 4 directions. Lost and done characters fade out or leave and get no animation.
- **The needs-input marker belongs to the Renderer.** Themes may only style it (`palette.alert`). The waiting animation adds to the marker and never replaces it.
- **Theme gaps:** at runtime, missing animations fall back and never crash. In CI, a theme we ship must be complete or the build fails.
- **Animations are authored by us,** with AI-written keyframe scripts polished by hand in Blender. No redistributable animation library was found (`scene-art-pipeline.md`).
- **Blender 5.2.2 LTS**, pinned by version and tarball checksum. The pipeline runs on Ubuntu without a GPU: Cycles on the CPU, or EEVEE through Mesa llvmpipe under Xvfb. The spike chooses between them.
- **Atlases** use `free-tex-packer-core` plus our own script that writes Pixi v8 `animations` arrays. Its licence and output are checked in the spike.
- **Art is licensed CC BY 4.0** with a licence manifest per asset. Code stays MIT. Generated atlases are committed, so building the app never needs Blender.

## Order

01 and 02 start at once, and so do 05, 12 and 13. 03 follows 02. 04 and 06 follow 02. 07 and 09 follow 01 and 06. 08 follows 07. 10 follows 03, 04 and 05. 11 closes the phase.
