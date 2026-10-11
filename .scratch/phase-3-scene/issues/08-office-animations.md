# 08: Office character animations

**What to build:** Every animation for the office character, authored by us on the 07 rig: walk, idle, one working pose per action category (read, write, exec, search, network, delegate, think, wait, error), waiting, blocked and error. Each is a loop with fixed start, end and loop policy in the animation manifest. Draft them with AI-written keyframe scripts, then polish by hand in Blender.

**Blocked by:** 07

**Status:** resolved. Drafted and rendered; the owner polishes and approves the animations.

- [x] Every animation renders in 4 directions through the 06 pipeline
- [x] Waiting reads clearly differently from working at 1× (checked against the needs-input marker from 05)
- [x] The strict theme check (04) passes for the character's animations

## Comments

- 2026-10-11: Drafted in `assets/src/characters/office-worker/animations.py`, which `make.py` now calls in place of 07's test actions. Each clip is a keyframe script on the Rigify controls, baked to the skeleton as before. `pnpm assets:make office-worker` then `pnpm assets:build --only office-worker` rebuild everything. Review images are in `.scratch/phase-3-scene/renders/08-office-animations/`: `contact-sheet-sw.png` and `contact-sheet-ne.png` (one row per clip, every frame), `waiting-vs-working-1x.png`, and `room-stations.png` (each Station's slots playing that Station's clip).
  - **Clips:** walk (in place; the Renderer moves the sprite), idle (sitting back on a lounge sofa), waiting (right hand raised high and waving), blocked (hands on hips, foot tapping), read (open book, page turn), write (typing at a desk, seated), exec (tapping a rack panel, hand on hip), search (bent over a drawer, rummaging), network (handset at the ear, gesturing), delegate (seated at the meeting table, handing across), think (hand on chin), wait (sipping from a cup), error (head in hands). Error is the `error` category's clip; the Theme has no separate error state. `tpose` is no longer in the atlas.
  - **Loop policy (the manifest):** every `render.animations` entry now has `frames: [start, end]` and `loop`: `cycle` (the action is cyclic over `[start, end + 1]`) or `pingpong` (rendered once, played there and back). `animations.py` reads them from `asset.json` and authors each action to match. `render.py` refuses an action whose range or cyclic flag disagrees, the packer writes the return trip of a pingpong clip by reusing frame names, every atlas page gets `meta.fps` per animation, and `assets:check` checks each sequence and fps. 544 frames are rendered (13 clips x 4 directions x beauty and shirt mask).
  - **Seats:** write and delegate sit on 09's chairs (hips at 0.6 m), idle on the sofas (0.51 m), checked against the room atlas in all four directions. With the owner: every rest slot needs a seat, so `layout.json` gains sofas at `[4,9]` and `[7,9]`.
  - **Frame:** seated feet reach further towards the camera than the shared frame allows, so the character's manifest sets `render.frame` to `[160, 232]`, with the same anchor `[80, 184]` (48 px below the feet instead of 24).
  - **Item 2:** at 1x, waiting is the only clip with a hand above the head (`waiting-vs-working-1x.png`, the red ring stands in for the 05 marker). For 10: the raised hand reaches the marker's height in se and nw, so put the isometric marker above the frame's top, not just above the head.
  - **Item 3:** `packages/renderer/test/office-character.test.ts` builds the full `renderers.2d` section for these clips and runs `validateTheme(..., { strict: true })` and `checkAtlases` against the committed atlas. 11 can lift its section straight into the office Theme.
  - `preview.mjs --characters` now plays each Station's own clip (idle in the rest area) when the atlas has one.
  - For 11: `office-worker.png` is now 11.9 MB, one 3517x3585 page. It will break the 10 MiB `smoke:pack` limit once atlases ship in the package, so 11 needs palette quantisation or a lossy encode, or a higher limit.
  - For 10/11: a seated agent that turns waiting or blocked switches to a standing clip on a chair tile. The Renderer may want to stand it next to the seat.
  - Polish stays scripted, as in 07: change `animations.py` (poses, timing) or the frames and loop in `asset.json`, then make and build again. Hand edits to the `.blend` are lost on the next make.
