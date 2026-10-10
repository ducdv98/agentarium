# 01: Character look prototype

**What to build:** A throwaway prototype that settles what an office character looks like before any production art: proportions, clothing, materials and lighting. It also shows how State and Action category read on a character at about 128 px, and how the needs-input marker sits above it. Use a CC0 MPFB2/MakeHuman base, a quick pose or two and the agreed camera (orthographic, X 60°, Z 45°). Show still renders over a mock isometric floor.

**Blocked by:** None (can start immediately)

**Status:** resolved

- [x] 2 or 3 style variants rendered at 1× and 2× on the mock floor, with a waiting character and a needs-input marker beside working ones
- [x] Renders of idle, working and waiting poses, showing whether the difference reads at 1×
- [x] An answer on per-agent colour: a colour-mask pass plus tint, or a few pre-coloured variants
- [x] The owner picks a variant. The choice and the reference renders are recorded under `## Answer`

## Answer

**Owner's pick (2026-10-10): C, toon.** Two-tone cel shading with a thin ink outline (inverted hull, 18 mm: about 3 px at 2×, 1.5 px at 1×), with the head scaled 1.2× on the default MakeHuman proportions. Per-agent colour uses **a colour-mask pass plus tint**, not pre-coloured variants.

Prototype: branch `prototype/p3-01-character-look` (head `0db93dd`), `spikes/character-look-prototype/`. Reference renders are in `.scratch/phase-3-scene/renders/01-character-look/`.

What was tried. Each of three looks was built on the same two MPFB2 2.0.17 characters: one man and one woman, with CC0 system clothes, hair, shoes, eyes and eyebrows, and MPFB's `default` rig. They were rendered with EEVEE at 2× from the agreed camera (orthographic, X 60°, Z 45°; 1 tile = 1 m, so a standing character is about 135 px tall at 1×) and laid out on a mock 128×64 floor:
- A, natural: MakeHuman textures, real proportions. Colours go muddy at 1×, and the shirt print carries a MakeHuman logo.
- B, clay: flat matte colours with AO, head 1.1×. Calm, but arms blend into the shirt at 1×.
- C, toon: picked. It gives the clearest silhouettes against desks and the floor at 1×.

Findings:
- **Poses read at 1×.** Idle, write (seated, typing), read (seated, holding a page) and waiting (standing, hand raised) are distinct in all four directions (`toon-poses-1x.png`). Write and read are told apart by the arms and the prop. The raised arm marks waiting even without the marker.
- **The needs-input marker** is an amber badge with "!" about 26 px across at 1×, plus an amber ring on the tile. It is drawn by the Renderer 10 px above the sprite's alpha bounding box, and it stays legible at 1× (`*-zoom.png`). The sprite's top varies with the pose, so the Renderer should anchor the marker from per-frame bounds or a per-animation head offset in the atlas metadata, not from a fixed height.
- **Mask + tint.** Render the shirt neutral grey (0.8 linear) plus a one-channel mask, in which props that cover the shirt are black. Multiply the shirt by agent colour ÷ neutral in linear light. Against Blender's pre-coloured renders the mean error on shirt pixels is 2.1–4.1/255 for toon, 2.4–8.0 for clay and 5.3–11.2 for natural (`tint-stats.json`, `tint-vs-precoloured.png`). The worst 1 % of shirt pixels differ by up to 74/255 for toon. Every pixel off by more than 30/255 sits on the mask's anti-aliased edge or on a shading or outline step; none are inside the shirt. Side by side at 2× no difference shows, but only two poses facing SW were compared. Mask + tint also costs one atlas per character instead of one per colour, and allows any colour. Whether to do it with a Pixi filter or a separate tinted shirt layer is left to tickets 02/10.
- **Agent colours should avoid amber/orange,** because the needs-input marker uses `palette.alert`.

Notes for later tickets:
- **02: the VPS is aarch64.** Blender publishes no Linux arm64 build; the 5.2.2 Linux tarball is x64 only. The prototype ran on Ubuntu's apt Blender 4.0.2, which is arm64 and built without OpenImageDenoise, so Cycles' default denoiser fails. EEVEE under Xvfb with llvmpipe works: about 2–3 s per 448×448 frame on 4 cores. MPFB 2.0.17 needs Blender 4.2+ and was shimmed (`setup.sh` on the branch).
- **07:** MakeHuman's casual suits are one mesh for top and trousers. The prototype split them at 57.5 % of body height to give the shirt its own material. The production clothing should keep the shirt as its own object or material slot so the mask is exact.
