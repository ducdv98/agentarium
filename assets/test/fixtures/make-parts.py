# Saves a small scene asset for the Blender integration test:
#   blender -b --factory-startup -P make-parts.py -- <output .blend>
# Collection "asset" holds two part collections: "block" (a palette-coloured cube) and "slab" (a flat tile).
import sys

import bpy

out = sys.argv[sys.argv.index("--") + 1]
bpy.ops.wm.read_factory_settings(use_empty=True)
root = bpy.data.collections.new("asset")
bpy.context.scene.collection.children.link(root)
for name, scale in (("block", (0.4, 0.4, 0.8)), ("slab", (1.0, 1.0, 0.02))):
    part = bpy.data.collections.new(name)
    root.children.link(part)
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, scale[2] / 2), scale=scale)
    o = bpy.context.object
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    for c in list(o.users_collection):
        c.objects.unlink(o)
    part.objects.link(o)
    o.data.materials.append(bpy.data.materials.new("wood" if name == "block" else "floor"))
bpy.ops.wm.save_as_mainfile(filepath=out)
