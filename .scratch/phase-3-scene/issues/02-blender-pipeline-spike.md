# 02: Spike: headless Blender pipeline on the Ubuntu VPS

**What to build:** Throwaway proof that one rigged CC0 mannequin can be rendered headlessly into a Pixi v8 atlas on the owner's Ubuntu VPS, with no GPU. Blender 5.2.2 LTS comes from the official tarball (`docs/research/scene-art-pipeline.md`).

**Blocked by:** None (can start immediately)

**Status:** ready-for-human. The spike is built (`spikes/blender-pipeline/`). The pinned 5.2.2 run happens on the owner's Windows x64 machine, because the VPS is aarch64 (see Comments). Follow `spikes/blender-pipeline/README.md`.

- [ ] A `bpy` script renders walk and idle in 4 directions with a transparent background, from the agreed camera, with fixed lights and colour management, to deterministic file names
- [ ] The script refuses any Blender build except the pinned version, and logs the build hash, engine, CPU and Mesa version
- [ ] On the VPS: Cycles on the CPU, and EEVEE through Xvfb with Mesa llvmpipe, are both tried. Record seconds per frame, peak memory, and whether each output matches a desktop render
- [ ] A colour-mask (ID) pass is rendered in the same frame layout, and tinting it in Pixi is tried
- [ ] `free-tex-packer-core`: its licence is checked, it packs the frames, and a script adds `animations` arrays and `meta.scale` for 2×. Pixi v8 loads the result and plays an `AnimatedSprite`
- [ ] Record which engine is chosen and why. The figures go into `docs/research/scene-art-pipeline.md`

## Comments

- 2026-10-10 (from 01): The VPS is `aarch64`. Blender publishes no Linux arm64 build; the 5.2.2 Linux tarball is x64 only, and the "official tarball" plan in ADR 0007 cannot run here as written. Options: build 5.2.2 from source for arm64, run the x64 build under emulation, or render on an x64 host. The prototype used Ubuntu's apt Blender 4.0.2 (arm64, built without OpenImageDenoise). EEVEE under Xvfb with llvmpipe rendered 448×448 frames in about 2–3 s on 4 cores.
- 2026-10-10 (owner): Run the pinned spike on the owner's Windows x64 machine instead of the VPS. Two runs are needed: native Windows, and WSL2. Native Windows has a GPU, so only the WSL2 run shows the Linux no-GPU path ADR 0007 relies on.
- 2026-10-10: Spike built in `spikes/blender-pipeline/`. `node pipeline.mjs all` does the following:
  - downloads and checks Blender 5.2.2 (win-x64 zip or linux-x64 tarball, official sha256), the MPFB 2.0.17 extension and the MakeHuman CC0 pack;
  - renders walk (12 frames) and idle (16 frames) in 4 directions, plus a shirt mask, with EEVEE and with Cycles (CPU, 64 spp, OIDN);
  - on Windows, renders a few reference frames from a GUI session for the desktop check;
  - packs one Pixi v8 atlas per animation and direction (about 700×920 each), with `animations`, per-frame `anchor` and `meta.scale: 2`;
  - compares headless and desktop beauty and mask frames, with a match verdict (mean ≤ 1 and p99 ≤ 8 out of 255);
  - writes `results/<label>/summary.md`.
  
  `render.py` exits with code 3 on any build other than 5.2.2 `d13f752e3b9c`, and logs the build hash, CPU and GL renderer/version. `free-tex-packer-core` 0.3.9 is MIT; its dependencies are MIT, plus `sharp` under Apache-2.0, and its output carries no licence terms. Cycles has no Shader to RGB, so it renders flat Principled materials instead of the toon look from 01.
  
  Checked on the aarch64 VPS with apt Blender 4.0.2 (`SPIKE_ALLOW_UNPINNED=1`, so not pinned figures):
  - EEVEE through Xvfb with llvmpipe (Mesa 25.2.8) renders 320×416 toon frames in about 2.1 s each with the basic mannequin, and about 5.4 s with the MPFB character. Cycles (no OIDN in that build) takes about 1.7 s.
  - The guard refuses 4.0.2 without the override.
  - Pixi 8.21.0 in headless Chromium loads all 8 atlases at resolution 2, applies the feet anchor, animates 16 of 16 sprites (`ok: true`), and tints the shirt layer.
  
  Still to do, owner: the pinned Windows and WSL2 runs (README steps 2 to 5). After that: record the engine choice and figures in `docs/research/scene-art-pipeline.md`, and amend ADR 0007's "runs headless on Linux" wording if the chosen render host changes.
- 2026-10-10: Pinned native Windows run done, in `spikes/blender-pipeline/results/windows-x64-desktop-hg8er1k/` (Ryzen 7 8745H, 16 threads, RTX 4050). All four runs used 5.2.2 LTS `d13f752e3b9c` and passed the pin check. Headless and desktop frames are identical (diff 0) for EEVEE and Cycles, on both the beauty and the mask layers. EEVEE (GPU) takes about 0.37 s per beauty frame and Cycles (CPU, 64 spp) about 1.6 s; the process tree peaks at about 640 to 800 MB. Pixi 8.21.0 in Chrome loads both atlases at resolution 2 and animates 16 of 16 sprites (`ok: true`), including Cycles at 2x zoom with the rose shirt tint; the screenshot is `pixi.jpg`. Two fixes were needed: the pin check reads `bpy.app.version`, because the official build's `version_string` is "5.2.2 LTS", and `pipeline.mjs` no longer calls `process.exit()` while a fetch socket is open, which tripped a libuv assertion on Windows. The Pixi page's "advanced" check runs once, 1.5 s after a build, so it reads 0 in a background tab; check it with the tab in front.
  
  Still to do, owner: the WSL2 run (README step 5). It is the only run that covers the GPU-less Linux path. After that: the engine choice and figures in `docs/research/scene-art-pipeline.md`, and the ADR 0007 wording.
