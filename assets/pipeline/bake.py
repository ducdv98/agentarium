# Links a character's Rigify controls to its deformation skeleton, or bakes the controls into it.
#   blender -b <file.blend> --factory-startup -P bake.py -- --link [--save]
#   blender -b <file.blend> --factory-startup -P bake.py -- --bake [--save]
# make.py also imports it. The skeleton is the one armature in the "asset" collection; the controls are the other
# armature that has every one of its bones (the generated Rigify rig; the metarig has no DEF bones).
#
# --link: each skeleton bone copies the same-named control bone, so the mesh follows the controls while posing.
# --bake: every action "<name>.controls" is sampled on each integer frame and keyed into "<name>" on the skeleton
#         (visual keying), keeping its frame range and cyclic flag. Then every link is removed: render.py refuses
#         a skeleton with constraints.
import argparse
import sys

import bpy
from mathutils import Matrix

LINK = "agentarium-link"


def find_rigs():
    asset = bpy.data.collections.get("asset")
    skeletons = [o for o in (asset.all_objects if asset else []) if o.type == "ARMATURE"]
    if len(skeletons) != 1:
        raise RuntimeError(f"expected one armature in the asset collection, found {len(skeletons)}")
    skeleton = skeletons[0]
    names = set(skeleton.data.bones.keys())
    controls = [o for o in bpy.data.objects
                if o.type == "ARMATURE" and o is not skeleton and names <= set(o.data.bones.keys())]
    if len(controls) != 1:
        raise RuntimeError(f"expected one control rig with every bone of {skeleton.name}, found {len(controls)}")
    return skeleton, controls[0]


def use_action(armature, action):
    ad = armature.animation_data or armature.animation_data_create()
    ad.action = action
    # Blender 5 layered actions: assigning picks a matching slot; fall back to the first one.
    if action is not None and getattr(action, "slots", None) and getattr(ad, "action_slot", None) is None:
        ad.action_slot = action.slots[0]


def link(skeleton, controls):
    for pb in skeleton.pose.bones:
        c = pb.constraints.get(LINK) or pb.constraints.new("COPY_TRANSFORMS")
        c.name, c.target, c.subtarget = LINK, controls, pb.name


def unlink(skeleton):
    for pb in skeleton.pose.bones:
        for c in list(pb.constraints):
            pb.constraints.remove(c)


def local_matrices(skeleton):
    """Each bone's matrix_basis that reproduces its evaluated (constrained) pose without constraints."""
    evaluated = skeleton.evaluated_get(bpy.context.evaluated_depsgraph_get()).pose.bones
    result = {}
    for bone in skeleton.data.bones:
        pose = evaluated[bone.name].matrix
        if bone.parent:
            parent = evaluated[bone.parent.name].matrix
            offset = bone.parent.matrix_local.inverted() @ bone.matrix_local
            result[bone.name] = offset.inverted() @ parent.inverted() @ pose
        else:
            result[bone.name] = bone.matrix_local.inverted() @ pose
    return result


def bake_action(skeleton, controls, source):
    start, end = (int(round(v)) for v in source.frame_range)
    use_action(skeleton, None)
    use_action(controls, source)
    link(skeleton, controls)
    samples = []
    for frame in range(start, end + 1):
        bpy.context.scene.frame_set(frame)
        samples.append((frame, local_matrices(skeleton)))
    unlink(skeleton)

    name = source.name.removesuffix(".controls")
    if name in bpy.data.actions:
        bpy.data.actions.remove(bpy.data.actions[name])
    target = bpy.data.actions.new(name)
    target.use_fake_user = True
    use_action(skeleton, target)
    for frame, matrices in samples:
        for pb in skeleton.pose.bones:
            pb.rotation_mode = "QUATERNION"
            pb.matrix_basis = matrices[pb.name]
            for path in ("location", "rotation_quaternion", "scale"):
                pb.keyframe_insert(path, frame=frame, group=pb.name)
    target.use_frame_range = True
    target.frame_start, target.frame_end = start, end
    target.use_cyclic = source.use_cyclic
    return target


def bake(skeleton, controls):
    sources = sorted((a for a in bpy.data.actions if a.name.endswith(".controls")), key=lambda a: a.name)
    if not sources:
        raise RuntimeError("no <name>.controls actions to bake")
    baked = [bake_action(skeleton, controls, source) for source in sources]
    for rig in (skeleton, controls):
        use_action(rig, None)
        for pb in rig.pose.bones:
            pb.matrix_basis = Matrix()
    print("BAKED", ", ".join(a.name for a in baked), flush=True)
    return baked


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    mode = ap.add_mutually_exclusive_group(required=True)
    mode.add_argument("--link", action="store_true")
    mode.add_argument("--bake", action="store_true")
    ap.add_argument("--save", action="store_true")
    args = ap.parse_args(argv)
    skeleton, controls = find_rigs()
    if args.link:
        link(skeleton, controls)
    else:
        bake(skeleton, controls)
    if args.save:
        bpy.ops.wm.save_mainfile(compress=True)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        import traceback
        traceback.print_exc()
        sys.exit(1)
