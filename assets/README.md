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
- An animated asset has exactly one armature in the collection.
- A material named after a `palette` entry in `settings.json` (`skin`, `trousers`, `hair`, `shoes`, `eyes`)
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
