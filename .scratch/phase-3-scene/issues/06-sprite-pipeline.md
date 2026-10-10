# 06: Sprite pipeline

**What to build:** Turn the 02 spike into maintained tooling, as ADR 0007 describes:
- an `assets/` directory with `.blend` sources under Git LFS
- shared settings for camera, lights, colour management and palette
- the render scripts on the engine chosen in 02, and the packer script
- one command (for example `pnpm assets:build`) that rebuilds every atlas and its frame data

**Blocked by:** 02

**Status:** resolved

- [x] `.gitattributes` sends `.blend` files to Git LFS. Caches and temporary renders are ignored
- [x] The build refuses any Blender except the pinned version and checksum, and documents installing it on the Windows x64 render machine (spike 02 chose that host)
- [x] Every asset directory needs a licence manifest (source, author, URL, licence, changes). The build fails without one, and a combined `NOTICE` is generated
- [x] CC BY 4.0 licence file for the art, and a README note separating it from the MIT code
- [x] Generated atlases are committed. A CI check (no Blender) verifies each manifest's animations exist in its atlas
- [x] `smoke:pack` reports the npm tarball size, with a limit we choose

## Comments

- 2026-10-10 (from 03): In the spike scene, the texture count, not the sprite count, set Pixi draw calls; the iGPU and the RTX batch 16 textures. One atlas per animation and direction, as in spike 02, already uses 8 textures before any prop, so pack many clips per atlas. See `docs/research/rendering.md`, section "Batching".
- 2026-10-11: Done in `assets/` (workspace package `@agentarium/assets`). See `assets/README.md`.
  - `pnpm assets:build [--only <atlas or path>]` validates every asset manifest, writes `assets/NOTICE`, checks `blender.exe` against the pinned sha256 (Windows x64 only), renders each asset headless with `pipeline/render.py`, and packs one Pixi v8 atlas per asset into `assets/atlases/`. `render.py` refuses any build but 5.2.2 `d13f752e3b9c` (exit 3).
  - Shared settings are in `pipeline/settings.json`: pin, frame geometry, directions, camera, sun, world, colour management, EEVEE, palette, toon ramp, outline and packing. Values are the spike's.
  - The `.blend` contract: one collection, no lights or cameras, at most one armature, palette-named materials replaced by the shared toon material, mask materials rendered in the neutral `tint` colour, actions named in the manifest.
  - Packing follows the comment from 03: all of an asset's clips go into one atlas. It spills to `<atlas>-0`, `<atlas>-1`, ... when a page would pass 4096 px, and never splits a clip. It uses `maxrects-packer` and `pngjs` instead of `free-tex-packer-core`, which would pull `sharp`, `jimp` and `tinify` into every workspace install.
  - CI runs `pnpm assets:check` (manifests, NOTICE, and every asset's animations x directions x masks in its committed atlas, no Blender) and the assets tests. The Theme-side check from 04 still runs in `packages/renderer`.
  - `AGENTARIUM_BLENDER_TESTS=1 pnpm --filter @agentarium/assets test` renders and packs a small test mannequin with the real Blender; it passed on the owner's machine.
  - `smoke:pack` prints the tarball size and fails above 10 MiB. It is 0.14 MiB packed (0.56 MiB unpacked) today.
  - No asset is committed yet; `src/` and `atlases/` start empty and the office character arrives in 07.

