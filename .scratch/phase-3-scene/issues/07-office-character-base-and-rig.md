# 07: Office character base and rig

**What to build:** The production office character in the style approved in 01: a CC0 MPFB2/MakeHuman base, our own clothing, hair and materials, and one Agentarium Rigify rig to be used for every character variant. Only redistributable sources (ADR 0007).

**Blocked by:** 01, 06

**Status:** ready-for-human. Built and rendered; the owner polishes and approves it in Blender.

- [x] Confirm the MPFB2 export contains only CC0 core assets, recorded in the asset's licence manifest
- [x] One canonical deformation skeleton. Controls are baked before rendering
- [x] The colour-mask approach from 01 is built into the materials
- [x] A test render of a T-pose and an idle pose through the 06 pipeline

## Comments

- 2026-10-11: Built in `assets/src/characters/office-worker/`. `pnpm assets:make office-worker` makes `office-worker.blend` from scratch with `make.py`, then `pnpm assets:build --only office-worker` renders it. Review renders and a contact sheet (rows: T pose, idle frame 0, idle frame 8, shirt mask; columns: sw, se, ne, nw) are in `.scratch/phase-3-scene/renders/07-office-character/`.
  - **Base:** MPFB 2.0.17 human with male macros (gender 1, the rest 0.5), targets baked, and the head scaled 1.2x about the head joint, blended over the neck. The head is scaled before the rig is fitted. Eyes (`low-poly`) and brows (`eyebrow001`) come from the MakeHuman CC0 pack. Nothing else from the pack is used.
  - **Our clothing and hair:** shirt, trousers, shoes and a short hair cap are shells made from the body's own faces, chosen by the Rigify deform bone that weighs most on each vertex and pushed out 5 to 12 mm. Each piece keeps the body's weights. The shirt is its own object with material `shirt`, which is the mask, so the mask is exact.
  - **Licence (item 1):** `make.py` records every file MPFB reads (through `open`, `gzip.open`, its OBJ loader and loaded images) and writes `licence-audit.json`: 26 files, each with its evidence. The evidence is the file's own CC0 statement, the CC0 statement of the `.mhclo` or `.mhmat` that uses it, or the asset kind MPFB's `LICENSE.md` at v2.0.17 releases as CC0. MPFB's material template is listed as not in the output. The make fails on anything else, and `assets:check` validates the evidence. MPFB's GPL code is a tool only.
  - **Rig (item 2):** MPFB's `rigify.human` metarig is generated into the Rigify rig `office-worker-controls` (collection `controls`). The canonical deformation skeleton `office-worker` (collection `asset`) has only its 181 `DEF-` bones, the same rest pose and no constraints or drivers, and every mesh is skinned to it. Actions are authored on the controls as `<name>.controls`. `pnpm assets:bake` keys them into `<name>` on the skeleton, sampling the evaluated pose, and `--link` links the two for posing. `render.py` refuses an armature with bone or object constraints or drivers.
  - **Test render (item 4):** `tpose` (1 frame) and a draft cyclic `idle` (16 frames at 8 fps: breath in the chest, small arm sway) through the 06 pipeline, 136 frames in total. The atlas is `assets/atlases/office-worker.{json,png}`.
  - Blender tests (`AGENTARIUM_BLENDER_TESTS=1`): render and pack, refusal of bone and object constraints, and a bake check that the baked skeleton reproduces a parent and child control rig on every frame.
  - For the owner's polish: the shirt hem and the back of the collar follow mesh edge loops and look ragged at 2x, and hair is a simple cap.
  - For 08 and 11: the atlas PNG is 3.3 MB for 17 frames x 4 directions with the mask layer. All of 08's clips together will probably pass the 10 MiB `smoke:pack` limit once atlases ship in the package.
