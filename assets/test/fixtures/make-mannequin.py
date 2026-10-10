# Saves a small test asset for the Blender integration test:
#   blender -b --factory-startup -P make-mannequin.py -- <output .blend>
# Collection "asset": one armature (root, spine), legs bone-parented to root and a torso to spine, with palette
# materials (trousers, skin) and a mask material (shirt). Actions "walk" and "idle" key the spine on frames 1-4.
import math
import sys

import bpy
from mathutils import Matrix

out = sys.argv[sys.argv.index("--") + 1]
bpy.ops.wm.read_factory_settings(use_empty=True)
collection = bpy.data.collections.new("asset")
bpy.context.scene.collection.children.link(collection)

armature = bpy.data.armatures.new("rig")
rig = bpy.data.objects.new("rig", armature)
collection.objects.link(rig)
bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode="EDIT")
root = armature.edit_bones.new("root")
root.head, root.tail = (0, 0, 0.9), (0, 0, 1.0)
spine = armature.edit_bones.new("spine")
spine.head, spine.tail = (0, 0, 1.0), (0, 0, 1.5)
spine.parent = root
bpy.ops.object.mode_set(mode="OBJECT")


def part(bone, location, scale, materials):
    bpy.ops.mesh.primitive_cube_add(size=1, location=location, scale=scale)
    o = bpy.context.object
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    for c in list(o.users_collection):
        c.objects.unlink(o)
    collection.objects.link(o)
    for name in materials:
        o.data.materials.append(bpy.data.materials.get(name) or bpy.data.materials.new(name))
    for i, polygon in enumerate(o.data.polygons):
        polygon.material_index = i % len(materials)
    # Bone parenting attaches at the bone's tail, in the bone's own orientation.
    o.parent, o.parent_type, o.parent_bone = rig, "BONE", bone
    b = rig.data.bones[bone]
    o.matrix_parent_inverse = (rig.matrix_world @ b.matrix_local @ Matrix.Translation((0, b.length, 0))).inverted()


part("root", (0, 0, 0.45), (0.3, 0.2, 0.9), ["trousers"])
part("spine", (0, 0, 1.25), (0.4, 0.25, 0.5), ["shirt", "skin"])

rig.animation_data_create()
for name, degrees in (("walk", 30), ("idle", 6)):
    action = bpy.data.actions.new(name)
    action.use_fake_user = True
    rig.animation_data.action = action
    bone = rig.pose.bones["spine"]
    bone.rotation_mode = "XYZ"
    for frame in range(1, 5):
        bone.rotation_euler = (0, 0, math.radians(degrees * math.sin(frame * math.pi / 2)))
        bone.keyframe_insert("rotation_euler", frame=frame)
rig.animation_data.action = None
bpy.ops.wm.save_as_mainfile(filepath=out)
