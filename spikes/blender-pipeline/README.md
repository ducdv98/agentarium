# Blender pipeline spike (phase-3-scene 02)

Throwaway proof for `.scratch/phase-3-scene/issues/02-blender-pipeline-spike.md`. One rigged CC0 MPFB2/MakeHuman
mannequin is rendered headless by the pinned Blender 5.2.2 LTS, in walk and idle, 4 directions, from the agreed
camera (orthographic, X 60°, Z 45°, 128×64 tiles, 2× art) with the toon look from ticket 01. A shirt mask is
rendered in the same frame layout. `free-tex-packer-core` packs the frames into Pixi v8 atlases with
`animations`, `anchor` and `meta.scale`, and a small page plays them as `AnimatedSprite`s with the shirt tinted.

Blender 5.2.2 ships for Windows x64 and Linux x64 only. The owner's VPS is aarch64, so the pinned runs happen on
the owner's Windows machine. There are two runs: native Windows (GPU EEVEE, plus the desktop-render check), and
WSL2 (the Linux no-GPU path ADR 0007 relies on, with EEVEE on Xvfb + llvmpipe). Both are needed.

## Run it on Windows

You need Windows 10 or 11 on x64, Git, Node 22.18 or newer, pnpm 10 (`corepack enable`), and about 3 GB free.
A GPU is optional. Native Windows EEVEE uses it, and Cycles runs on the CPU either way.

1. Get the code and install the spike's own dependencies (it is not part of the pnpm workspace):

   ```powershell
   git pull
   cd spikes\blender-pipeline
   pnpm install --ignore-workspace
   ```

2. Run everything:

   ```powershell
   node pipeline.mjs all
   ```

   - It downloads and checks by sha256: Blender 5.2.2 (about 400 MB), the MPFB 2.0.17 extension, and the MakeHuman CC0 asset pack (about 280 MB). Everything goes into `.cache\`. Your own Blender settings are not touched, because the spike uses its own Blender user folder.
   - It renders all frames with EEVEE, then again with Cycles on the CPU. Expect roughly 15 to 45 minutes, mostly Cycles.
   - It then opens Blender's window twice, for EEVEE and for Cycles. Each renders a few reference frames from a normal desktop session and closes itself. Don't click in them. These frames are the "matches a desktop render" check.
   - It packs both atlases and writes `results\<windows-x64-yourpc>\summary.md`, which is printed at the end.

3. Check Pixi:

   ```powershell
   node pipeline.mjs serve
   ```

   Open http://127.0.0.1:5173/. You should see walk and idle in four directions, standing on tiles, all moving. The feet should sit on the tile centres, and the shirt colour should change when you pick from **Shirt tint**. Try **Atlas: cycles** and **Zoom: 2x**. The status box at the bottom should show `"advanced": "16/16"` and `"ok": true`. Save a screenshot as `results\<label>\pixi.png`.

4. Send the results back. Either commit and push the `results\<label>\` folder (keep the atlases, they are small):

   ```powershell
   git add results
   git commit -m "feat(spikes): Add Windows results for the Blender pipeline spike (phase-3-scene 02)"
   git push
   ```

   or paste `summary.md` and the screenshot into the chat.

5. Run the Linux, no-GPU path under WSL2. This is the path ADR 0007 names: EEVEE through Xvfb and Mesa llvmpipe, and Cycles on the CPU, with the Linux x64 tarball. If WSL2 isn't installed yet, run `wsl --install -d Ubuntu-24.04` in an admin PowerShell and restart. Install Node 22.18 or newer and pnpm inside Ubuntu. Clone the repo inside WSL's own filesystem (`~/`), not under `/mnt/c`, then:

   ```bash
   sudo apt install -y xvfb libgl1-mesa-dri libegl1 libxi6 libxxf86vm1 libxfixes3 libxrender1 libxkbcommon0 libsm6 mesa-utils
   cd spikes/blender-pipeline && pnpm install --ignore-workspace && node pipeline.mjs all
   ```

   On Linux, EEVEE is forced onto llvmpipe even when WSLg provides a GPU, so the figures match a GPU-less server. There is no desktop step on Linux. Commit and push `results/linux-x64-<host>/` as in step 4. The same Xvfb + llvmpipe path also runs on any x64 Linux server or CI runner.

## If something goes wrong

- `Refusing Blender ...`: the build is not the pinned 5.2.2 (`d13f752e3b9c`). Delete `.cache\blender-5.2.2-*` and run again.
- An MPFB error such as `MPFB asset not found` or an import error from `bl_ext.user_default.mpfb`: run `node pipeline.mjs all --mannequin basic`, which uses a mannequin built in the script with no external assets, and paste the error from `out\eevee\blender.log`.
- Cycles is too slow: `node pipeline.mjs all --quick` renders one direction and every fourth frame.
- A single step: `node pipeline.mjs setup`, `render --engine eevee`, `desktop --engine cycles`, `pack out\eevee`, `compare out\eevee out\desktop-eevee`, `report`.

## What maps to the ticket

| Ticket item | Where |
|---|---|
| Walk and idle, 4 directions, transparent, agreed camera, fixed lights and colour management, deterministic names | `render.py`, written to `out/<engine>/frames/<beauty or mask>/<walk or idle>/<sw, se, ne or nw>/frame-NNN.png` |
| Refuses unpinned builds; logs build hash, engine, CPU and GL/Mesa | `check_pin()` and `render-log.json` in `render.py` |
| Cycles (CPU) and EEVEE (Xvfb + llvmpipe on Linux) tried: seconds per frame, peak memory, desktop match | `summary.md` from both runs: per-frame timings, the exact in-process peak and a sampled process-tree peak, and headless vs desktop diffs for beauty and mask with a match verdict |
| Colour-mask pass, tinting tried in Pixi | `frames/mask/...`, the derived `-shirt` frames, and `pixi/index.html` (shirt sprite with `tint`) |
| `free-tex-packer-core` licence, packing, `animations`, `meta.scale` | MIT (dependencies MIT, plus `sharp` under Apache-2.0); `pack()` in `pipeline.mjs` writes one atlas per animation and direction |

Notes:
- Cycles has no Shader to RGB, so it renders flat Principled materials, not the toon look. The EEVEE vs Cycles diff in the summary is informational, not a quality score.
- The MakeHuman shirt is split from the trousers at 57.5 % of body height, as in ticket 01.
- Dev runs on a host without a pinned build (such as the aarch64 VPS): `SPIKE_ALLOW_UNPINNED=1 node pipeline.mjs render --engine eevee --blender /usr/bin/blender --mannequin basic`. The logs mark these runs `pinned: false`.
