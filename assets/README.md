# Scene art assets

## Licence

Art in `assets/` is CC BY 4.0, unless its manifest says CC0. The full text is in `assets/LICENSE`.
The pipeline code is part of the MIT-licensed repository. `NOTICE` contains
generated attributions.

Allowed manifest licences are `CC0-1.0` and `CC-BY-4.0`. This applies to the
asset and every source. Do not commit Mixamo, Quaternius QAL, Sketchfab
downloads, CC BY-SA, non-commercial content, or content with an unclear
licence.

## Layout

`pipeline/` contains settings and the Blender and atlas tools.
`src/<kind>/<name>/` contains one asset directory and its `asset.json`.
`atlases/` contains committed generated Pixi atlases.
`test/` contains pipeline tests. Temporary files belong in `.cache/`.
Blend sources use Git LFS.

## Asset manifest

This is a complete example:

```json
{
  "name": "Office worker",
  "licence": "CC-BY-4.0",
  "sources": [
    {
      "what": "Base mesh",
      "source": "MakeHuman system assets via MPFB 2",
      "author": "MakeHuman team",
      "url": "https://example.com/source",
      "licence": "CC0-1.0",
      "changes": "Rigged and re-topologised"
    }
  ],
  "render": {
    "blend": "office-worker.blend",
    "collection": "asset",
    "atlas": "office-worker",
    "animations": {
      "walk": { "action": "walk", "fps": 12 },
      "idle": { "action": "idle", "fps": 8 }
    },
    "masks": { "shirt": ["shirt"] }
  }
}
```

`name` is the displayed asset name. `licence` is the asset licence.
`sources` is a non-empty list. `what` is optional. `source`, `author`, `url`,
`licence`, and `changes` are required. `render` is optional for source-only
assets. `blend` names an existing file. `collection` names the Blender
collection. `atlas` is a unique safe file stem. `animations` maps output names
to Blender action names and positive integer frame rates. An omitted or empty
map renders one-frame `still` clips. `masks` maps mask names to material names.

## The `.blend` contract

Everything after the `.blend` file is scripted. The pipeline sets the camera, the sun, the world, colour
management, the toon look and the outline from `pipeline/settings.json`, so every asset looks the same.

- The file has a collection named by `render.collection`. Only that collection is rendered.
- The collection has no lights and no cameras. The build fails if it finds any.
- An animated asset has exactly one armature in the collection. It has no bone constraints and no drivers:
  controls are baked before rendering (see Making a character), and the build fails otherwise.
- A material named after a `palette` entry in `settings.json` (`skin`, `trousers`, `hair`, `brows`, `shoes`, `eyes`)
  is replaced by the shared toon material in that colour. Other materials render as authored.
- The materials a mask lists (`render.masks`) render in the neutral `tint` colour, whatever they are named.
  The mask pass renders them white and everything else black. The packer turns each mask into a tint layer
  that Pixi colours per agent.
- An image texture in a replaced material keeps its alpha, for hair cards and brows.
- Each mesh gets the inverted-hull outline in the `ink` colour, unless the object has the custom
  property `agentarium_outline` set to false.
- Each animation names an action. Every integer frame of the action's frame range is rendered. When the
  action is marked cyclic (Manual Frame Range, Cyclic Animation), its last frame repeats the first and is
  skipped. Output frames are numbered from 0.
- The asset faces screen south-west (towards the camera, down the -Y axis) at rest. The pipeline turns it
  for the four directions.

## Scene assets and room layouts

A scene asset, such as `src/scenes/office-room/`, renders many still parts into one atlas. Its manifest
lists `render.parts` instead of `render.animations`. Each part is a child collection of `render.collection` with
the same name. The pipeline renders each part alone, one frame for each of the 4 directions, as
`<part>/<direction>`. A part sits on one 1 m tile centred on the origin. Its front faces -Y (screen south-west):
an Agent uses it from the neighbouring tile on that side. `render.frame` (`size` and `anchor`, in 1x pixels)
replaces the character frame from `settings.json`. The office room uses `[160, 272]` and anchors on the tile
centre at `[80, 232]`, so a 2.2 m wall fits. Palette entries in `settings.json` colour the props as they do the
characters. `make.py` builds `office-room.blend` from primitives:

```powershell
& $env:AGENTARIUM_BLENDER -b --factory-startup -P assets/src/scenes/office-room/make.py -- `
  --out assets/src/scenes/office-room/office-room.blend --settings assets/pipeline/settings.json
```

`layout.json` places the parts on the tile grid and defines the Stations. A tile is `[column, row]` from the back
corner. Columns run screen south-east (world +X) and rows run screen south-west (world -Y). At 2x the centre of
tile `[c, r]` is `((c - r) * 128, (c + r) * 64)` from the back corner's centre. `facing` is one of `ne`, `nw`, `se`
and `sw`, and picks the part's direction clip.

- `size` is `[columns, rows]`. `floor.rows` has one string per row and one character per tile. A space means no
  floor. `floor.legend` maps each character to a part.
- `walls` stand on a tile's edge, opposite their facing: `sw` is the north-east edge, `se` the north-west edge.
  That edge must be the room's outer edge, with no floor tile beyond it.
- `props` are furniture, one per tile. Parts listed in `seats` (chairs, sofas) do not block their tile. An Agent
  may stand or sit there, at most one seat per tile.
- `stations` has one entry for each of the nine action categories and `rest`. Each entry has a `label` and
  its `slots`. A slot is a tile where one Agent stands, with the way it faces. Capacity is the number of slots.
  Every slot is on a free floor tile, belongs to one Station, and can be reached from every other slot over
  floor tiles without a blocking prop.

The Renderer draws a room in three layers. The floor and the walls are static, so each can be cached with
`cacheAsTexture`. Props and Agents are then sorted by depth, `column + row`. On the same tile a prop draws
behind the Agent, unless the prop has `front: true`, for example a chair whose back faces the camera. To cache
static props (`docs/research/rendering.md`), give each depth row two cached bands, rear props then `front` props,
and draw that row's Agents between them. The layout fixes only the slots. When more Agents want a Station than it
has slots, the Renderer decides where they go.
`assets:check` validates every `layout.json` against its manifest's parts. `node assets/pipeline/preview.mjs
<scene dir> [--characters <atlas>] [--slots]` composes the room from the committed atlas in that order and writes
a PNG to `assets/.cache/preview/`.

## Commands

```powershell
pnpm assets:build
pnpm assets:build --only office-worker
pnpm assets:build --only assets/src/characters/office-worker
pnpm assets:check
```

`assets:build` validates manifests, writes `NOTICE`, renders with Blender, and
packs atlases. `assets:check` validates manifests, `NOTICE`, and every atlas
without Blender.

## Installing the pinned Blender

Use a Windows x64 render machine. Download the MSI from the URL in
`pipeline/settings.json`:

```powershell
Get-FileHash blender-5.2.2-windows-x64.msi -Algorithm SHA256
```

The result must equal `installerSha256`. Install to the default path in the
settings file or set `AGENTARIUM_BLENDER` to `blender.exe`. The build also
checks the installed executable against `exeSha256` before it starts Blender.
Run `git lfs install` before adding a `.blend` file.

Never commit Blender backups, temporary renders, or caches. Never commit
Mixamo, Quaternius QAL, Sketchfab downloads, CC BY-SA, non-commercial content,
or assets with an unclear licence. The ignored cache is `assets/.cache/`.

Changing the Blender version means rebuilding all the art.

## Making a character

```powershell
pnpm assets:make office-worker
pnpm assets:bake assets/src/characters/office-worker
pnpm assets:bake assets/src/characters/office-worker --link
```

`assets:make` builds a character's `.blend` from scratch with its `make.py`. It downloads (or reuses) the MPFB
extension and the MakeHuman CC0 asset pack pinned in `settings.json` under `sources`, checks their sha256,
installs MPFB into `assets/.cache/blender-user`, and runs the pinned Blender. Only `make.py` uses MPFB; MPFB's
GPL code is a tool and is never committed.

A character `.blend` has two rigs:

- `asset` holds the deformation skeleton, the one armature that is rendered and later exported for 3D. It has
  only the `DEF-` bones of the Rigify rig, with the same names and rest pose, and every mesh is skinned to it.
- `controls` holds the generated Rigify rig, its widgets and the metarig. Animate here, in actions named
  `<name>.controls`. One Rigify rig serves every character variant.

`assets:bake` samples each `<name>.controls` action on every frame and keys the result into `<name>` on the
skeleton, keeping the frame range and the cyclic flag, then saves. The manifest names the baked actions. To see
the mesh follow the controls while you pose in Blender, run it with `--link`, which saves the skeleton linked to
the controls. Bake again before `assets:build`, which refuses a linked skeleton.

`make.py` writes `licence-audit.json`. It records every file MPFB reads while it builds the character, and the
evidence that each is CC0:

- the file's own CC0 statement;
- a CC0 statement in the `.mhclo` or `.mhmat` beside it that uses it;
- or an asset kind that MPFB's `LICENSE.md` (pinned to the release) releases as CC0 1.0: the base mesh and
  proxies, targets, textures, rigs, and JSON mesh data.

Data that does not reach the output, such as MPFB's material template, is listed under `notInOutput`. The make
fails on any file it cannot account for. `assets:check` fails on an entry without CC0 or known evidence.
