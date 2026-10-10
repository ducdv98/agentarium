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
