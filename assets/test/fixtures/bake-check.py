# Checks pipeline/bake.py on a small rig, for the Blender integration test:
#   blender -b --factory-startup -P bake-check.py -- <pipeline dir>
# The controls have a root, a child with a roll and an offset, and an extra control bone; the skeleton in the
# "asset" collection has the root and the child. "wave.controls" turns both over frames 1-5, cyclic. After the
# bake, "wave" on the skeleton must reproduce the controls' pose on every frame, with no constraint left.
# Prints BAKE-OK, or exits 1 with what differs.
import math
import sys

import bpy

sys.path.insert(0, sys.argv[sys.argv.index("--") + 1])
sys.dont_write_bytecode = True
import bake  # noqa: E402

bpy.ops.wm.read_factory_settings(use_empty=True)
asset = bpy.data.collections.new("asset")
bpy.context.scene.collection.children.link(asset)


def armature(name, collection, bones):
    rig = bpy.data.objects.new(name, bpy.data.armatures.new(name))
    collection.objects.link(rig)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode="EDIT")
    for bone, head, tail, roll, parent in bones:
        eb = rig.data.edit_bones.new(bone)
        eb.head, eb.tail, eb.roll = head, tail, roll
        if parent:
            eb.parent = rig.data.edit_bones[parent]
    bpy.ops.object.mode_set(mode="OBJECT")
    return rig


shared = [("a", (0, 0, 0), (0, 0, 1), 0.0, None), ("b", (0, 0.2, 1.1), (0.5, 0.2, 1.6), 0.7, "a")]
controls = armature("controls", bpy.context.scene.collection, shared + [("ctrl", (1, 0, 0), (1, 0, 1), 0, None)])
skeleton = armature("skeleton", asset, shared)

action = bpy.data.actions.new("wave.controls")
bake.use_action(controls, action)
for frame in range(1, 6):
    for name, axis in (("a", (1, 0, 0)), ("b", (0, 1, 1))):
        pb = controls.pose.bones[name]
        pb.rotation_mode = "AXIS_ANGLE"
        pb.rotation_axis_angle = (math.radians(20) * math.sin(frame), *axis)
        pb.keyframe_insert("rotation_axis_angle", frame=frame)
    controls.pose.bones["b"].location = (0, 0.1 * frame, 0)
    controls.pose.bones["b"].keyframe_insert("location", frame=frame)
action.use_frame_range = True
action.frame_start, action.frame_end, action.use_cyclic = 1, 5, True

bake.bake(*bake.find_rigs())

problems = []
wave = bpy.data.actions.get("wave")
if not wave or tuple(wave.frame_range) != (1, 5) or not wave.use_cyclic:
    problems.append(f"wave: range {wave and tuple(wave.frame_range)}, cyclic {wave and wave.use_cyclic}")
if any(pb.constraints for pb in skeleton.pose.bones):
    problems.append("constraints left on the skeleton")
bake.use_action(controls, action)
bake.use_action(skeleton, wave)
for frame in range(1, 6):
    bpy.context.scene.frame_set(frame)
    graph = bpy.context.evaluated_depsgraph_get()
    want = controls.evaluated_get(graph).pose.bones
    got = skeleton.evaluated_get(graph).pose.bones
    for name in ("a", "b"):
        error = max(abs(x - y) for row_w, row_g in zip(want[name].matrix, got[name].matrix)
                    for x, y in zip(row_w, row_g))
        if error > 1e-4:
            problems.append(f"frame {frame} bone {name}: off by {error:.5f}")
if problems:
    print("BAKE-FAILED", "; ".join(problems), flush=True)
    sys.exit(1)
print("BAKE-OK", flush=True)
