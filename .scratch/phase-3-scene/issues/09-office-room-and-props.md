# 09: Office room, Stations and props

**What to build:** The office room and one Station per action category plus the rest area, built by `bpy` scripts in the style from 01. Audited CC0 props such as Kenney's may be used. Each Station fixes where characters stand and which way they face, and has a capacity.

**Blocked by:** 01, 06

**Status:** ready-for-human. Built and rendered; the owner reviews the look and the layout.

- [x] Floor tiles at 128×64 and walls, rendered through 06
- [x] Nine Stations plus the rest area, with standing spots and the facing for each slot
- [x] Props are split into static layers (for `cacheAsTexture`) and props characters sort in front of or behind
- [x] Licence manifests for every prop that isn't ours

## Comments

- 2026-10-11: Built in `assets/src/scenes/office-room/`. `make.py` builds `office-room.blend` from primitives, and `pnpm assets:build --only office-room` renders it into one atlas, `assets/atlases/office-room.{json,png}`: 18 parts x 4 directions, 72 frames, 2.5 MB. Review renders are in `.scratch/phase-3-scene/renders/09-office-room/`: the bare room, the Station slots tinted per Station, and the 07 character standing on every slot.
  - **Pipeline:** a scene asset lists `render.parts` instead of `render.animations`. Each part is a child collection, rendered alone as a one-frame clip `<part>/<direction>`, so the whole room is one atlas (the comment from 03). `render.frame` replaces the frame size and anchor; the room uses `[160, 272]` anchored on the tile centre, so a 2.2 m wall fits. Prop colours are new palette entries in `settings.json`, so props get the same toon shading and ink outline as the character.
  - **Floor and walls (item 1):** `floor`, `floor-alt` (checker) and `carpet` tiles at 128x64, and `wall` and `wall-window` on the two back edges. Floor and wall pieces overlap by 2 cm so no seam shows, and have no outline.
  - **Stations (item 2):** `layout.json` is a 12x10 room. Each of the nine categories and `rest` has a label and slots (tile plus facing); capacity is the slot count: read Library 3, write Desks 8, exec Server racks 3, search Filing cabinets 2, network Comms desks 2, delegate Meeting table 6, think Whiteboards 4, wait Water cooler 2, error Printer (jammed) 2, rest Lounge 6. `assets:check` validates the layout: parts exist, one blocking prop per tile, chairs and sofas are seats that don't block, slots are free and unique, every slot can reach every other, and walls stay on the outer edge.
  - **Layers (item 3):** floor and walls are static layers. Props sort with Agents by depth (`column + row`); `front: true` props (chairs and sofas whose back faces the camera) draw over the Agent on their tile. For caching: two bands per depth row, rear then front, with that row's Agents between. `assets/pipeline/preview.mjs` composes the room in that order. Format and rules are in `assets/README.md`, "Scene assets and room layouts".
  - **Licences (item 4):** every part is our own geometry, made by `make.py`; no Kenney or other third-party props were needed. The manifest records that, and `NOTICE` lists it.
  - For 10/11: the layout fixes slots only. What happens when more Agents want a Station than it has slots is the Renderer's rule. `Theme.stations` can take its labels and capacities from `layout.json`. Seated poses (08) should match the seats: write and rest slots have chairs or sofas, the others are standing.

