# 02: Spike: headless Blender pipeline on the Ubuntu VPS

**What to build:** Throwaway proof that one rigged CC0 mannequin can be rendered headlessly into a Pixi v8 atlas on the owner's Ubuntu VPS, with no GPU. Blender 5.2.2 LTS comes from the official tarball (`docs/research/scene-art-pipeline.md`).

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent. The VPS runs need the owner, or SSH access the owner provides.

- [ ] A `bpy` script renders walk and idle in 4 directions with a transparent background, from the agreed camera, with fixed lights and colour management, to deterministic file names
- [ ] The script refuses any Blender build except the pinned version, and logs the build hash, engine, CPU and Mesa version
- [ ] On the VPS: Cycles on the CPU, and EEVEE through Xvfb with Mesa llvmpipe, are both tried. Record seconds per frame, peak memory, and whether each output matches a desktop render
- [ ] A colour-mask (ID) pass is rendered in the same frame layout, and tinting it in Pixi is tried
- [ ] `free-tex-packer-core`: its licence is checked, it packs the frames, and a script adds `animations` arrays and `meta.scale` for 2×. Pixi v8 loads the result and plays an `AnimatedSprite`
- [ ] Record which engine is chosen and why. The figures go into `docs/research/scene-art-pipeline.md`

## Comments

- 2026-10-10 (from 01): The VPS is `aarch64`. Blender publishes no Linux arm64 build; the 5.2.2 Linux tarball is x64 only, and the "official tarball" plan in ADR 0007 cannot run here as written. Options: build 5.2.2 from source for arm64, run the x64 build under emulation, or render on an x64 host. The prototype used Ubuntu's apt Blender 4.0.2 (arm64, built without OpenImageDenoise). EEVEE under Xvfb with llvmpipe rendered 448×448 frames in about 2–3 s on 4 cores.
