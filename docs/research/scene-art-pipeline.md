# Scene art pipeline

Research date: 2026-10-10. Terms follow [CONTEXT.md](../../CONTEXT.md).
This research is about the isometric 2D office renderer in [ADR 0007](../adr/0007-scene-art-is-pre-rendered-from-scripted-blender-sources.md).
This is technical research, not legal advice. A lawyer should review any
asset pack before publication.

## Decisions

| Decision | Choice | Status |
|---|---|---|
| Character source for office v1 | MakeHuman or MPFB2 CC0 output, with a small custom office mesh layer | Recommended |
| Mixamo | Use only for local prototyping or rendered output. Do not commit Mixamo raw files | Rejected for public sources |
| Blender pin | Blender 5.2.2 LTS, or the latest 5.2.x after a recorded validation render | Recommended |
| Render engine | EEVEE, rendered on the owner's Windows x64 machine. Cycles is not used: it has no Shader to RGB, so it cannot give the toon look | Decided (phase-3-scene 02, see section 5) |
| Render host | The owner's Windows x64 machine. The aarch64 VPS cannot run the pinned Blender: there is no Linux arm64 build | Decided (phase-3-scene 02) |
| Atlas tool | `free-tex-packer-core` with the Pixi exporter and a checked-in animation metadata step | Recommended |
| Public art licence | CC BY 4.0 for original and compatible derivatives, with per-source notices beside the assets | Recommended |

## 1. Sources, animation, and licences

### Mixamo

Adobe's current FAQ says that Mixamo characters and animations are royalty free
for personal, commercial and non-profit projects, including films and games.
It does not grant a general right to publish the downloaded files. The FAQ
also says that the prohibited examples include “blueprints, templates, or
asset packages for video game engines which redistribute character or
animation raw files” and “any type of free distribution of character or
animation raw files” ([Adobe FAQ](https://helpx.adobe.com/creative-cloud/faq/mixamo-faq.html);
the same wording is reproduced in the [Adobe community FAQ](https://community.adobe.com/questions-696/mixamo-faq-licensing-royalties-ownership-eula-and-tos-589400)).

The Additional Terms also prohibit using Mixamo content or output to “directly
or indirectly create, train, test, or otherwise improve” an AI or machine
learning system ([PDF](https://wwwimages2.adobe.com/content/dam/cc/en/legal/servicetou/Mixamo-Addl-Terms-en_US-20210623.pdf)).
The FAQ is not a substitute for the complete Adobe terms. It is enough to
answer this repository's question: a public repository containing a
Mixamo-derived FBX or `.blend` is raw-file redistribution, even if the file
also contains Agentarium's own script, mesh edits, or materials.

Therefore, committing Mixamo-derived `.blend` files to a public CC BY 4.0 art
pack is not allowed on the published terms. It also cannot be re-licensed as
CC BY 4.0. A private team may share the files as part of its project, but the
public source repository must contain neither the raw Mixamo asset nor a
reconstructable modified copy. Rendered PNGs may be usable as embedded output,
but that does not make the `.blend` source distributable. Record the exact
download date and terms for any local prototype. Do not use Mixamo data for AI
training or testing.

### Candidate sources

| Source | Licence and source-file redistribution | Rig and animation fit | Office/style and retargeting |
|---|---|---|---|
| **MakeHuman** | Core graphical assets are CC0. The application is AGPL, but that does not make generated character files AGPL. The project explicitly says exports, saved models, scripts and renderings are the user's data ([licence](https://github.com/makehumancommunity/makehuman/blob/master/LICENSE.md)). CC0 output can be redistributed and relicensed as CC BY 4.0, although the original CC0 notice should remain in provenance. | Human meshes, poses and clothes. It does not ship a large polished animation library. | Good neutral base; needs stylized clothing, materials and animation authoring. Use one controlled skeleton for all variants. |
| **MPFB2** | Core assets are CC0. MPFB2 code is GPL, while its graphical assets are CC0 ([project licence](https://static.makehumancommunity.org/about/license.html)). Generated character files can be redistributed and relicensed as CC BY 4.0 if they contain only compatible assets. | Blender integration and MakeHuman characters. Animation coverage is not a complete office library. | Strongest open-source character generator here. Rig output still needs a standardization pass. |
| **Rigify** | The bundled add-on is GPL ([Blender manual](https://docs.blender.org/manual/en/latest/addons/rigify/index.html)). It is a tool, not a licence for the mesh. A rig generated for the project's own character can be distributed with the character under the character's asset licence. | Automatic humanoid rigs. No stock walk, idle, sit or typing library. | Good technical base. Use a deliberately small deformation skeleton and bake controls before export. |
| **Kenney** | Game assets are CC0 and attribution is not required ([support](https://kenney.nl/support)). Redistribution and modification are allowed. | Kenney has many animated 2D/3D packs, but exact character walk, idle, sit and typing coverage for the selected pack is **Not verified**. | Clean, readable and game-like. Individual packs may not match a modern office without a common material pass. Rigs across packs are not assumed compatible. |
| **Quaternius** | Older pages describe CC0, but the current [QAL v1.0](https://quaternius.com/license.html) says assets include source files and “can't be resell[ed] or redistribute[d] ... as assets.” That is not compatible with a public source `.blend` pack or CC BY relicensing. | Many low-poly humanoid packs include rigs and walk/idle-style animations; exact typing and sitting coverage is **Not verified**. | Good low-poly fit, but do not use packs under QAL for committed raw sources unless the author grants written permission. |
| **Poly Pizza** | Each model can have a different licence. CC0 and CC BY models may be usable; the site-wide status and source-file terms for every download are **Not verified**. | Some models are rigged, many are static. Pack-to-pack animation coverage and common skeleton are **Not verified**. | Useful for props, not a dependable character pipeline. Review each model's licence and rig. |
| **OpenGameArt** | Licences are per asset. CC0 permits redistribution; CC BY permits it with attribution and change notices; CC BY-SA and GPL-like terms need separate compatibility review. The [OGA FAQ](https://opengameart.org/node/5571) warns that community submissions vary. | Mixed. Walk cycles are common; idle, sit, typing and gestures are inconsistent. | Useful for references and props. Do not assume quality, authorship or rig compatibility from the site name. |
| **Sketchfab CC0/CC BY** | Per-model terms apply. Sketchfab's licence prohibits making licensed material available as a stand-alone file or in a way that lets others extract it ([licence](https://sketchfab.com/licenses)). That conflicts with committed raw `.blend` sources even when a model page says CC BY. CC0/CC BY source use is therefore **Not verified** without checking the exact model and download licence. | Highly variable; most downloaded models are static or use unrelated rigs. | Good search breadth, poor provenance and consistency. Use only with a saved licence page and a source audit. |
| **Blender Studio / Cloud** | Content is generally CC BY, but each asset states its own licence ([remixing](https://studio.blender.org/remixing/)). Some demo files are CC BY-SA 4.0 ([demo files](https://www.blender.org/download/demo-files/)). CC BY source can be redistributed with attribution and changes; CC BY-SA cannot simply be relicensed as CC BY. | Production rigs and animation files exist, but an office-ready human library with all required clips is **Not verified**. | High quality but often film-styled. Use for technique and reference unless a specific asset passes the licence and style review. |
| **Rigged commercial packs** | Usually non-redistributable. The licence of any chosen pack is **Not verified** until purchased and reviewed. | Often the best animation coverage, but not suitable for this public source repository by default. | Could fit visually, but conflicts with the public-source requirement. |

CC0 is the simplest base. CC BY is also workable. Keep the source asset in a
separate directory with its original licence, author, URL, version or download
date, and changes. A rendered derivative does not repair an incompatible source
licence.

Animations do not become portable merely because two rigs are humanoid.
Different rest poses, bone names, orientations, scales, twist bones and root
motion require retargeting and cleanup. Rigify provides a generated rig, not a
universal animation interchange format. A retargeting template can be shared
and reused ([example documentation](https://epicgames.github.io/BlenderTools/ue2rigify/)),
but the result must be checked per character. Use one canonical Agentarium
rig, retarget once, bake actions, and render from the baked action. Exact
cross-pack compatibility is **Not verified** for all candidates above.

### Attribution and combined packs

CC BY 4.0 requires appropriate credit, a link to the licence, an indication of
changes, and no additional restrictions. CC0 requires no credit, but retaining
the notice is good provenance. A combined art pack may be labelled CC BY 4.0
only for the material Agentarium owns or may license that way. It does not
erase upstream rights. Include a `NOTICE` or per-asset manifest with:

- asset name, author and source URL;
- original licence and licence URL;
- copyright notice if supplied;
- changes made, such as retopology, retargeting, materials and renders;
- the applicable licence for the committed `.blend`, textures, masks and PNGs.

Do not put CC BY-SA, CC BY-NC, GPL-bound media, Mixamo files, or uncertain
Sketchfab files into a blanket CC BY directory. If a combined `.blend` is an
adaptation of CC BY material, mark the adaptation and preserve the upstream
attribution. The code remains MIT, separately from the art.

### Recommendation for office v1

Use MPFB2/MakeHuman CC0 output for the human base, Rigify for the canonical
rig, and custom Blender meshes and materials for hair, clothing, desks and
props. Author or commission a small set of actions on that rig: walk, idle,
sit, type, read, write, point/delegate, think, wait, blocked and error. Use
Kenney CC0 props only after checking the individual pack and style. Use
OpenGameArt only for individually audited CC0 or CC BY items. Do not use
Mixamo, current Quaternius QAL assets, or unverified Sketchfab downloads in
the public source tree.

ADR 0007's assumption is valid only after this narrowing: rigged bases and
animations can be used if their licence permits raw-source redistribution.
That assumption is false for Mixamo and is not established for a generic
commercial, Quaternius-QAL, or Sketchfab download.

## 2. Headless Blender on Ubuntu

### Version and installation

As of the research date, the maintained LTS releases are Blender 5.2 LTS and
4.5 LTS. The [official LTS page](https://www.blender.org/download/LTS/) lists
5.2.2 and 4.5.14 on 2026-09-15. Blender 5.2 is supported until July 2028;
4.5 is supported until July 2027. Blender's LTS policy is two years with bug
fixes and no feature/API churn.

Pin the exact official 5.2.x tarball checksum in the build image. Pinning
5.2.2 is the reproducible starting point; move to a later 5.2.x only after a
golden-image comparison. The official Linux installation documentation says
to decompress the tarball into a chosen directory. It also documents
`snap install blender --classic`, and warns that distribution packages may be
older or omit features ([manual](https://docs.blender.org/manual/en/latest/getting_started/installing/linux.html)).

For a render VPS, prefer the official tarball. Apt is convenient but its
version follows the Ubuntu release and is not an exact project pin. Snap is
convenient for updates but can change the effective Blender revision and adds
confinement details. A minimal installation check is:

```sh
BLENDER=/opt/blender-5.2.2-linux-x64/blender
test "$($BLENDER --background --factory-startup --python-expr \
  'import bpy; print(bpy.app.version_string)')" = "5.2.2"
```

The build script should also print `bpy.app.build_hash`, render engine, Python
version, OS, CPU model and Mesa version into the build log.

### EEVEE, Workbench and Cycles

`-b` removes the UI. It does not make EEVEE a CPU renderer. EEVEE is an
OpenGL/Vulkan raster renderer and still needs a graphics implementation. The
current manual states that EEVEE has no CPU-rendering plan; Blender's release
notes record that headless Linux rendering became supported in 3.4
([3.4 notes](https://archive.blender.org/wiki/2024/wiki/Reference/Release_Notes/3.4/EEVEE.html),
[5.2 limitations](https://docs.staging.blender.org/manual/en/latest/render/eevee/limitations/limitations.html)).

On a VPS with no physical GPU, use the normal Blender build with Mesa software
OpenGL (`llvmpipe`) and a virtual X server. A typical smoke-test environment
is `mesa-utils`, `libgl1-mesa-dri`, `libegl1-mesa`, `xvfb`, and `xvfb-run`; set
`LIBGL_ALWAYS_SOFTWARE=1`, then run `xvfb-run -s '-screen 0 1024x768x24' blender
-b -P script.py`. Check `glxinfo -B` for `OpenGL renderer string: llvmpipe`.
Blender's bundled `blender-softwaregl` has been recommended when system Mesa
is too old ([developer discussion](https://devtalk.blender.org/t/blender2-82-xvfb-virtual-screen-rendering-with-strange-texture-results-eevee/12750)).

EGL is a useful headless OpenGL technology, but Blender's historical Linux
path has required X/GLX in cases where EGL alone did not work. Do not assume
`EGL_PLATFORM=surfaceless` works; test the exact 5.2 build. Vulkan is available
in 4.5 and later, but the no-GPU path would require Mesa's `lavapipe`, the
Vulkan ICD, and a tested Blender Vulkan backend. This is **Not verified** for
the pinned render command. Keep Xvfb plus llvmpipe as the first CI path.

Workbench uses the same display/graphics plumbing and is useful for flat
diagnostic renders. It is not a guaranteed escape from OpenGL setup. A
software-rendered EEVEE frame may be slow, and shader, transparency, shadow,
color-management and driver differences can appear. Make the smoke test a
required build step before relying on it.

Cycles can render on CPU with no display or GPU. OpenImageDenoise runs on CPU
when no supported GPU device is present and requires a reasonably modern CPU
with SSE4.1 ([Blender documentation](https://docs.blender.org/manual/en/4.4/render/cycles/render_settings/sampling.html)).
For 256x256 low-poly frames, 32--128 samples plus denoising should be practical
on a modern VPS, but an exact time-per-frame and memory number is **Not
verified**. Benchmark the actual office scene on the target CPU. Budget roughly
1--8 seconds per frame and 0.5--2 GiB of process memory as an initial planning
range, not a performance guarantee. Use `time`, `/usr/bin/time -v`, and a
representative four-direction animation before choosing Cycles. EEVEE/Workbench
is preferable for the planned flat, repeatable office look.

### Render workflow

The established approach is a small `bpy` script, not manual viewport export:

1. Load the pinned `.blend` or build a scene from an empty file.
2. Set an orthographic camera. Keep the project convention explicit: X 60°,
   Z 45°, a 2:1 diamond grid, 128x64 tiles, characters about 128 source pixels
   tall, and a 2x render scale.
3. Use a fixed world, area lights, color management, transparent film and
   explicit resolution. Do not use time, random seeds, object iteration order,
   or machine-dependent defaults.
4. Set the camera to each of four azimuths. Write names such as
   `character/action/east/frame-000.png`, with the frame number and direction
   in the filename. Set the scene frame and render one image at a time.
5. Set every action's start, end, loop policy and hold frame in a manifest.
   Render the same frame range for every character and validate missing files.
6. Write PNG color frames and a separate mask or ID pass. Pack only after a
   checksum and dimension check.

Use object indices, material indices, or a dedicated emission material for an
ID pass. The most robust tint pass is a second view layer with the character
materials replaced by flat, opaque IDs and the same camera, lights and frame.
For per-agent tinting, render grayscale or white clothing parts into a mask,
then apply a Pixi tint or a shader to the mask. Keep the mask in the same atlas
coordinates as the color frame. Do not depend on a custom per-sprite filter
for every agent until the Pixi spike measures the batching cost.

Open-source helpers can provide ideas, but no maintained Blender add-on was
verified as a complete match for this exact four-direction, scripted, Pixi
pipeline. A custom `bpy` script is therefore the controlled source of truth.
The script should fail on a wrong Blender major/minor version and should save
the camera transform, render settings and source licence manifest alongside
the output.

## 3. Atlas packing for PixiJS v8

Pixi v8's `Spritesheet` format has `frames`, `meta.image`, `meta.scale` and an
`animations` map whose values are arrays of frame names ([Pixi reference](https://github.com/pixijs/pixijs/blob/dev/skills/pixijs-assets/references/spritesheet.md)).
At 2x output, `meta.scale` must describe that source resolution or the sprite
will render at the wrong size.

| Tool | Linux use and output | Licence / concern |
|---|---|---|
| `free-tex-packer-core` | Node module. Its exporter list includes `Pixi`; MaxRects and padding are available ([repo](https://github.com/odrick/free-tex-packer-core)). Add `animations` from deterministic filename groups and validate against Pixi's schema. | Open-source package; exact current licence is **Not verified** in this research. Check `LICENSE` before vendoring. |
| `free-tex-packer` | CLI/UI around the core. Useful locally, but the core is easier to pin in a Node build script. Animation grouping in the exact installed version is **Not verified**. | Check the package licence before shipping the CLI. |
| `maxrects-packer` | Small Node library. It returns bins and rectangles, so a short project script can write Pixi JSON ([repo](https://github.com/soimy/maxrects-packer)). It does not itself supply Pixi animation arrays. | Open-source; exact current licence is **Not verified**. |
| `spritesheet-js` | Node CLI and module. It supports a Pixi JSON format and trimming ([repo](https://github.com/krzysztof-o/spritesheet.js/)). Add animation arrays after packing. | Open-source; exact current licence is **Not verified**. |
| TexturePacker | Mature CLI and Pixi exporter. It can run on Linux and in CI. The Essential mode is free for non-commercial projects only; advanced or commercial use needs a paid licence ([licensing](https://www.codeandweb.com/texturepacker/documentation/installation-and-licensing)). | Good technical fit, but a paid/server licence and CI activation are extra project dependencies. Do not use Essential for a commercial distribution without checking the EULA. |
| `sharp` plus a small packer | Node image processing and a project-owned JSON writer. | Strong control and reproducibility, but more code to maintain. |

Recommend `free-tex-packer-core` plus a tiny checked-in Node script. Sort
inputs lexicographically, disable rotation, use fixed padding and dimensions,
emit one Pixi JSON file, and derive animation arrays from the exact names
`character.action.direction.frame-000`. Add a schema test that loads the JSON
with Pixi v8 and checks one `AnimatedSprite` per action. This avoids a paid
packer and makes the animation naming policy explicit. The package's exact
licence and whether its current exporter emits animation arrays are **Not
verified**; the build must verify both before adoption.

## 4. Practical risks

Renders are not guaranteed bit-for-bit across Blender versions, CPUs, Mesa
versions, shader compilers, denoisers, colour-management settings, or render
engines. Pin Blender and the container image. Prefer EEVEE with explicit
settings and no temporal effects. Compare a golden PNG by hash or a documented
pixel tolerance. Do not update Blender merely to receive a feature; a version
change is an art rebuild.

Git LFS stores pointers in Git and counts every new full `.blend` version
toward storage. GitHub's current free allowance is 10 GiB storage and 10 GiB
bandwidth per account; Team and Enterprise include 250 GiB. Above quota,
downloads or pushes can be blocked unless a budget is set. GitHub recommends
LFS for binaries, enforces a 100 MB normal Git object limit, and allows up to
2 GB per LFS file on Free/Pro ([limits](https://docs.github.com/en/repositories/creating-and-managing-repositories/repository-limits),
[LFS billing](https://docs.github.com/en/billing/concepts/product-billing/git-lfs),
[LFS file limits](https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-git-large-file-storage)).
Public visibility does not make large repeated downloads free. Keep `.blend`
files compact, avoid committing caches, prune old source revisions only with
care, and consider object storage if the art history grows beyond the free
quota.

If atlases ship inside `@agentarium/cli`, every atlas is installed with the
package and downloaded by every user. npm package size limits are not a good
design target: large packages slow install, cache and update operations. The
exact npm registry limit is **Not verified** here. Keep source `.blend` files
out of the runtime package, compress PNGs, split themes into optional assets if
needed, and measure the packed tarball with `npm pack --dry-run` in CI.

## 5. Spike results (phase-3-scene 02)

The spike is `spikes/blender-pipeline/`. The pinned run is in
`spikes/blender-pipeline/results/windows-x64-desktop-hg8er1k/`: Blender 5.2.2 LTS
`d13f752e3b9c` on Windows 11, AMD Ryzen 7 8745H (16 threads), 31 GB RAM,
NVIDIA RTX 4050 Laptop GPU. It rendered the MPFB2 mannequin in walk (12 frames)
and idle (16 frames), four directions, at 320×416, plus a shirt mask.

| Run | Beauty s/frame (mean, max) | Mask s/frame | Wall s | Peak MB (process tree, sampled) |
|---|---|---|---|---|
| EEVEE, headless (`-b`, GPU) | 0.37, 2.15 | 0.34 | 99 | 779 |
| EEVEE, desktop session | 0.45, 0.93 | 0.34 | 264 | 780 |
| Cycles CPU 64 spp + OIDN, headless | 1.61, 2.06 | 1.17 | 333 | 636 |
| Cycles CPU, desktop session | 1.60, 1.81 | 1.23 | 38 | 802 |

The in-process peak was not reported on Windows. The desktop wall times cover
only a few reference frames.

- **Headless matches desktop.** Headless and desktop frames are identical
  (mean and p99 diff 0 out of 255) for EEVEE and for Cycles, on the beauty and
  mask layers.
- **The pin guard works.** It refuses any build other than 5.2.2
  `d13f752e3b9c`. It must compare `bpy.app.version`, because the official
  build's `version_string` is "5.2.2 LTS".
- **Pixi v8 plays the atlases.** `free-tex-packer-core` 0.3.9 is MIT; its
  dependencies are MIT, plus `sharp` under Apache-2.0. It does not emit
  animation arrays, so the spike's own step adds `animations`, a per-frame
  feet `anchor` and `meta.scale: 2`. Pixi 8.21.0 in Chrome loads both atlases
  at resolution 2, animates 16 of 16 `AnimatedSprite`s, and tints the shirt
  layer built from the mask pass.
- **EEVEE and Cycles differ by design.** Cycles has no Shader to RGB, so it
  renders flat Principled materials, not the toon look from phase-3-scene 01.
  EEVEE vs Cycles diffs (mean 74.8 /255) are expected, not a defect.

**Choice: EEVEE, on the owner's Windows x64 machine.** Only EEVEE gives the
toon look, and it is about 4 times faster than Cycles here. Blender 5.2.2 ships
for Windows x64 and Linux x64 only, so the aarch64 VPS cannot run the pinned
build; the owner chose not to build it from source or emulate it. Because the
atlases are committed, nothing else needs Blender.

**Not measured at the pin: the GPU-less Linux path** (EEVEE through Xvfb and
Mesa llvmpipe, Cycles on the CPU). The only evidence is unpinned: apt Blender
4.0.2 on the aarch64 VPS rendered 320×416 toon frames through Xvfb and
llvmpipe (Mesa 25.2.8) in about 2.1 s each with a basic mannequin, and about
5.4 s with the MPFB2 character. The spike still supports a Linux x64 run
(`spikes/blender-pipeline/README.md`, step 5) if a CI or Linux render host is
wanted later.

## Open questions

- Does the chosen MPFB2 export include only CC0 core assets, or any third-party
  clothing or texture with a different licence?
- Which canonical Rigify deformation skeleton and retargeting method gives the
  cleanest walk, sit and typing actions?
- Does Blender 5.2.2 run EEVEE reliably under Ubuntu x64, Xvfb and Mesa
  llvmpipe? Not measured at the pin; it only matters if a Linux render host is
  added (section 5).
- Is Vulkan with Mesa lavapipe materially faster or more deterministic than
  Xvfb/llvmpipe? Not verified.
- Should color masks be separate atlases, or should the first office pack use
  a small number of pre-colored variants?
- What atlas size and theme split keep the npm package acceptably small?

## Impact on ADR 0007 and the phase 3 tickets

- ADR 0007's general licence assumption needs a qualification: Mixamo raw
  files cannot be committed or relicensed as CC BY 4.0.
- “Rigged bases and animations” is not enough. The source licence, raw-file
  redistribution right, and exact attribution must be recorded per asset.
- “Runs headless on Linux without a GPU” is true for Cycles CPU and can be
  true for EEVEE/Workbench with software graphics, but `blender -b` alone is
  not sufficient. The phase-3-scene 02 spike moved rendering to the owner's
  Windows x64 machine instead (section 5).
- Pinning “one exact Blender version” must include the exact patch build and
  binary checksum. Blender 5.2 LTS is the recommended starting pin.
- The atlas ticket needs a Pixi v8 JSON animation-array check and an explicit
  `meta.scale` rule for 2x renders.
- The phase 3 asset ticket must add licence manifests and must not assume
  Sketchfab, Quaternius QAL, or arbitrary commercial packs are redistributable.
