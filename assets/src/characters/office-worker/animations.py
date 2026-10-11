# The office character's animations (ticket 08), as keyframe scripts on the Rigify controls. make.py imports it.
#
# asset.json fixes each clip's frames [start, end] and its loop policy; author_all() reads them, so the manifest
# and the actions cannot drift apart:
#   cycle     the action is cyclic over [start, end + 1]; pose(rig, phase) gets phase 0..tau, and tau == 0.
#   pingpong  the action covers [start, end] and plays there and back; pose(rig, t) gets t 0..1.
#
# Every pose is set in armature space, which is world space here: the character stands on the tile centre, faces
# -Y and is 1.77 m tall. Seated clips put the hips over the seats of 09's office room: the chair seat is 0.52 m high,
# the sofa seat 0.43 m, and the desk or table in front of a chair is 1 m away, its top 0.75 m high.
import json
import math
from pathlib import Path

import bpy
from mathutils import Matrix, Quaternion, Vector

HERE = Path(__file__).resolve().parent
SIDES = ("L", "R")
ARM, LEG = "upper_arm_parent", "thigh_parent"


def update():
    bpy.context.view_layer.update()


def side_x(side):
    return 1.0 if side == "L" else -1.0


def smooth(t):
    return t * t * (3 - 2 * t)


def mix(a, b, t):
    return Vector(a).lerp(Vector(b), t)


def rot(x=0.0, y=0.0, z=0.0):
    """An armature-space rotation from degrees about X (bend forward), Y (lean sideways) and Z (turn)."""
    return (Quaternion((0, 0, 1), math.radians(z)) @ Quaternion((0, 1, 0), math.radians(y))
            @ Quaternion((1, 0, 0), math.radians(x)))


# ---------------------------------------------------------------- posing
class Pose:
    """Sets controls in armature space for one frame and remembers which ones it moved, for keying."""

    def __init__(self, rig):
        self.rig = rig
        self.moved = set()

    def bone(self, name):
        return self.rig.pose.bones[name]

    def put(self, name, at=None, turn=None):
        """Moves a control's head to `at` and turns it by `turn` from its rest orientation (both armature space).

        Leaving `at` out keeps where the bone's parents put it."""
        update()
        pb = self.bone(name)
        rest = pb.bone.matrix_local.to_quaternion()
        orientation = (turn or Quaternion()) @ rest
        head = Vector(at) if at is not None else pb.matrix.translation
        pb.matrix = Matrix.Translation(head) @ orientation.to_matrix().to_4x4()
        self.moved.add(name)
        update()

    def aim(self, name, direction):
        """Turns an FK control so it points along direction, keeping its twist as close as it can."""
        update()
        pb = self.bone(name)
        m = pb.matrix.copy()
        current = (m.to_3x3() @ Vector((0, 1, 0))).normalized()
        turn = current.rotation_difference(Vector(direction).normalized())
        pb.matrix = Matrix.Translation(m.translation) @ (turn.to_matrix() @ m.to_3x3()).to_4x4()
        self.moved.add(name)
        update()

    def follow(self, name, point):
        """Where a rest-pose point carried by bone `name` is now: for placing hands on the face or head."""
        update()
        pb = self.bone(name)
        return pb.matrix @ pb.bone.matrix_local.inverted() @ Vector(point)

    # -------------------------------------------------------- body
    def body(self, at=(0, 0, 0.917), lean=None, chest=None, head=None, neck=None):
        """The hips at `at`, the whole trunk turned by `lean` about them, then the chest and head on top.

        chest, neck and head are turns relative to the trunk (head relative to the chest)."""
        lean = lean or Quaternion()
        self.put("torso", (at[0], at[1] + 0.003, at[2] + 0.004), lean)
        chest_turn = lean @ (chest or Quaternion())
        self.put("chest", turn=chest_turn)
        self.put("neck", turn=chest_turn @ (neck or Quaternion()))
        self.put("head", turn=chest_turn @ (neck or Quaternion()) @ (head or Quaternion()))

    def feet(self, left, right, left_turn=None, right_turn=None):
        """Ankles at the given points (0.071 m is flat on the floor), each foot turned about its ankle."""
        for side, point, turn in (("L", left, left_turn), ("R", right, right_turn)):
            self.put(f"foot_ik.{side}", point, turn)

    def stand(self, width=0.15, at=(0, 0, 0.912), lean=None, chest=None, head=None, neck=None):
        self.body(at, lean, chest, head, neck)
        self.feet((width, -0.02, 0.071), (-width, -0.02, 0.071))

    # -------------------------------------------------------- arms
    def fk_arm(self, side, upper, fore, hand):
        """FK arm: each bone points along the given direction (x is mirrored for the right side)."""
        x = side_x(side)
        flip = lambda d: (d[0] * x, d[1], d[2])
        self.aim(f"upper_arm_fk.{side}", flip(upper))
        self.aim(f"forearm_fk.{side}", flip(fore))
        self.aim(f"hand_fk.{side}", flip(hand))

    def hang(self, side, sway=0.0):
        """A relaxed arm at the side."""
        self.fk_arm(side, (0.16, 0.03 + sway, -1), (0.06, -0.14 + sway, -1), (0.03, -0.08 + sway, -1))

    def ik_arm(self, side, wrist, fingers, palm, elbow):
        """IK arm: the wrist at a point, the fingers along a direction, the palm facing `palm`, the elbow towards
        the point `elbow`. Points and directions are for the left side; x is mirrored for the right."""
        x = side_x(side)
        flip = lambda v: Vector((v[0] * x, v[1], v[2]))
        self.bone(f"{ARM}.{side}")["IK_FK"] = 0.0
        self.put(f"upper_arm_ik_target.{side}", flip(elbow))
        self.put(f"hand_ik.{side}", flip(wrist), hand_turn(self.rig, side, flip(fingers), flip(palm)))

    def ik_arm_at(self, side, wrist, fingers, palm, elbow):
        """Like ik_arm, but the wrist is an armature-space point used as given, not mirrored (for points that
        follow the head). Directions are still for the left side."""
        x = side_x(side)
        self.ik_arm(side, (wrist[0] * x, wrist[1], wrist[2]), fingers, palm, elbow)


def hand_turn(rig, side, fingers, palm):
    """The hand's turn from rest so its fingers point along `fingers` and its palm faces `palm`.

    The hand bone's Y axis runs along the fingers; at rest its X axis is the palm normal, facing the body."""
    rest = rig.pose.bones[f"hand_ik.{side}"].bone.matrix_local.to_3x3()
    sign = 1.0 if (rest.col[0].x * side_x(side)) < 0 else -1.0
    y = Vector(fingers).normalized()
    n = Vector(palm)
    x = (n - y * n.dot(y)).normalized() * sign
    z = x.cross(y)
    target = Matrix((x, y, z)).transposed()
    return (target @ rest.inverted()).to_quaternion()


def reset(rig):
    for pb in rig.pose.bones:
        pb.matrix_basis = Matrix()
    for side in SIDES:
        rig.pose.bones[f"{ARM}.{side}"]["IK_FK"] = 1.0
        rig.pose.bones[f"{LEG}.{side}"]["IK_FK"] = 0.0
    update()


def setup(rig):
    """Rig settings every clip shares: no limb stretches, and an IK arm's elbow follows its pole target."""
    for side in SIDES:
        for limb in (ARM, LEG):
            rig.pose.bones[f"{limb}.{side}"]["IK_Stretch"] = 0.0
        rig.pose.bones[f"{ARM}.{side}"]["pole_vector"] = True
    update()


# ---------------------------------------------------------------- seated bodies
CHAIR_HIPS = (0, -0.08, 0.6)
SOFA_HIPS = (0, 0.0, 0.51)


def sit(p, hips, lean=None, chest=None, head=None, neck=None, knees=0.13, feet_y=-0.55):
    p.body(hips, lean, chest, head, neck)
    p.feet((knees, feet_y, 0.071), (-knees, feet_y, 0.071))


# ---------------------------------------------------------------- clips
def walk(p, phase):
    """An in-place walk: the Renderer moves the sprite. Left foot forward on frame 0."""
    stride = 0.16
    bob = 0.895 - 0.015 * math.cos(2 * phase)
    p.body((0, 0, bob), rot(x=3, z=4 * math.cos(phase)), chest=rot(z=-7 * math.cos(phase)), head=rot(x=-3, z=3 * math.cos(phase)))
    for side, offset in (("L", 0.0), ("R", math.pi)):
        a = phase + offset
        lift = max(0.0, -math.sin(a))
        y = -stride * math.cos(a)
        heel = 18 * max(0.0, math.sin(a)) * (1 - abs(math.cos(a)))  # toe-off while the foot trails
        p.put(f"foot_ik.{side}", (side_x(side) * 0.12, y, 0.071 + 0.07 * lift), rot(x=-heel + 10 * lift))
    for side, offset in (("L", 0.0), ("R", math.pi)):
        swing = 0.35 * math.cos(phase + offset)
        p.fk_arm(side, (0.12, swing, -1), (0.06, swing - 0.25, -1), (0.03, swing - 0.15, -1))


def idle(p, t):
    """Sitting back on the lounge sofa, hands on the thighs, breathing slowly."""
    breath = smooth(t)
    sit(p, SOFA_HIPS, rot(x=-12), chest=rot(x=-2 - 2 * breath), head=rot(x=10 + 2 * breath), knees=0.14, feet_y=-0.5)
    for side in SIDES:
        p.ik_arm(side, (0.16, -0.27, 0.6 + 0.008 * breath), (0.0, -1, -0.25), (0, 0, -1), (0.35, 0.1, 0.8))


def write(p, phase):
    """Typing at a desk: both hands on the keyboard, tapping in turn, eyes on the monitor."""
    sit(p, CHAIR_HIPS, rot(x=14), chest=rot(x=4), head=rot(x=-10 + 2 * math.sin(phase)), knees=0.15, feet_y=-0.52)
    for side, offset in (("L", 0.0), ("R", math.pi)):
        tap = max(0.0, math.sin(phase + offset))
        p.ik_arm(side, (0.13, -0.66, 0.8 + 0.03 * tap), (-0.15, -1, -0.15 - 0.3 * tap), (0, 0, -1), (0.45, -0.1, 0.8))


def delegate(p, t):
    """At the meeting table: the left forearm on the table, the right hand offering a folder across it."""
    reach = smooth(t)
    sit(p, CHAIR_HIPS, rot(x=8 + 6 * reach), chest=rot(z=-6 * reach), head=rot(x=-6 + 8 * reach, z=-4 * reach), knees=0.15, feet_y=-0.52)
    p.ik_arm("L", (0.14, -0.5, 0.8), (-0.4, -1, 0), (0, 0, -1), (0.45, 0.0, 0.7))
    p.ik_arm("R", mix((0.22, -0.45, 0.86), (0.12, -0.7, 0.92), reach), (-0.1, -1, 0.05), (0, 0.2, 1), (0.5, 0.0, 0.7))


def read(p, phase):
    """Reading an open book held at the chest; the right hand turns a page."""
    turn = max(0.0, math.sin(phase))
    p.stand(head=rot(x=24, z=-6 * turn), chest=rot(x=6))
    p.ik_arm("L", (0.11, -0.33, 1.12), (-0.2, -1, 0.35), (0.3, 0.2, 1), (0.4, 0.1, 0.9))
    page = mix((-0.13, -0.33, 1.12), (0.04, -0.34, 1.18), turn)
    p.ik_arm("R", (-page.x, page.y, page.z), (-0.2, -1, 0.35 + 0.3 * turn), (0.3, 0.2, 1), (0.4, 0.1, 0.9))


def exec_(p, phase):
    """At a server rack: the right hand taps the rack's panel, the left hand on the hip."""
    tap = max(0.0, math.sin(phase))
    p.stand(head=rot(x=6 - 3 * tap), chest=rot(x=3, z=-4))
    p.ik_arm("L", (0.21, -0.03, 0.99), (0.1, -0.3, -1), (-1, 0, 0), (0.45, 0.25, 1.1))
    p.ik_arm("R", (0.1, -0.5 - 0.05 * tap, 1.25 + 0.02 * tap), (-0.2, -1, 0.1 - 0.3 * tap), (0, 0.2, -1), (0.4, 0.0, 1.0))


def search(p, t):
    """Bent over an open filing drawer, the right hand rummaging, the left hand on the cabinet."""
    rummage = smooth(t)
    p.stand(at=(0, 0.03, 0.905), lean=rot(x=24), chest=rot(x=8, z=6 * (rummage - 0.5)), head=rot(x=8))
    p.ik_arm("L", (0.2, -0.5, 1.0), (-0.1, -1, -0.4), (0, 0, -1), (0.5, 0.0, 1.2))
    p.ik_arm("R", (-0.08 + 0.16 * rummage, -0.52, 0.86), (0, -0.5, -1), (-1, 0, 0), (0.45, 0.1, 1.2))


def network(p, t):
    """On the phone at the comms desk: the left hand holds the handset to the ear, the right hand gestures."""
    talk = smooth(t)
    p.stand(head=rot(x=4, y=-8, z=6 * talk), chest=rot(z=-4 + 6 * talk))
    ear = p.follow("head", (0.11, -0.07, 1.64))
    p.ik_arm_at("L", (ear.x, ear.y - 0.03, ear.z - 0.06), (0, -0.3, 1), (-1, 0, 0), (0.35, -0.2, 1.1))
    p.ik_arm("R", mix((0.18, -0.32, 1.05), (0.14, -0.42, 1.18), talk), (-0.2, -1, 0.3), (0.3, 0, 1), (0.45, 0.1, 0.9))


def think(p, t):
    """At a whiteboard: the right hand on the chin, the left arm across the waist, weight shifting slowly."""
    shift = smooth(t)
    p.stand(at=(0.012 * (shift - 0.5), 0, 0.912), lean=rot(y=1.5 * (shift - 0.5)), head=rot(x=-8, y=4, z=3 * shift))
    chin = p.follow("head", (0.0, -0.15, 1.56))
    p.ik_arm("L", (-0.06, -0.21, 1.08), (-1, -0.2, 0.1), (0, 1, 0), (0.35, -0.1, 0.8))
    p.ik_arm_at("R", (chin.x - 0.01, chin.y - 0.02, chin.z - 0.07), (0, -0.2, 1), (0, 1, 0), (0.25, -0.4, 0.9))


def wait(p, t):
    """At the water cooler: both hands round a cup, raising it to sip now and then."""
    sip = smooth(t)
    p.stand(head=rot(x=10 - 18 * sip))
    mouth = p.follow("head", (0.0, -0.2, 1.57))
    cup = mix((0.0, -0.3, 1.16), (0.0, mouth.y - 0.05, mouth.z - 0.06), sip)
    for side in SIDES:
        p.ik_arm(side, (0.055, cup.y, cup.z), (-0.6, -0.5, 0.6), (-1, 0, 0), (0.35, 0.0, 0.9))


def error(p, t):
    """At the jammed printer: head in hands, shoulders slumped, shaking the head slowly."""
    shake = 2 * smooth(t) - 1
    p.stand(lean=rot(x=10), chest=rot(x=14), head=rot(x=24, z=10 * shake))
    for side in SIDES:
        cheek = p.follow("head", (0.1 * side_x(side), -0.15, 1.6))
        p.ik_arm_at(side, (cheek.x + 0.01 * side_x(side), cheek.y + 0.02, cheek.z - 0.05), (0, -0.15, 1), (-1, -0.3, 0), (0.3, -0.45, 1.0))


def waiting(p, t):
    """Needs the user: the right hand raised high and waving, the head up. No working clip raises a hand."""
    wave = 2 * smooth(t) - 1
    p.stand(lean=rot(y=-2), head=rot(x=-10, y=4))
    p.hang("L")
    p.fk_arm("R", (0.45, -0.05, 1), (0.12 + 0.45 * wave, -0.08, 1), (0.1 + 0.6 * wave, -0.05, 1))


def blocked(p, phase):
    """Stuck: hands on the hips, the right foot tapping, the head shaking a little."""
    tap = max(0.0, math.sin(phase))
    p.body((0, 0, 0.912), head=rot(x=-4, z=5 * math.sin(phase)))
    p.feet((0.15, -0.02, 0.071), (-0.17, -0.06, 0.071), right_turn=rot(x=-18 * tap, z=-10))
    for side in SIDES:
        p.ik_arm(side, (0.2, 0.0, 0.99), (0.1, -0.2, -1), (-1, 0, 0), (0.5, 0.2, 1.2))


POSES = dict(walk=walk, idle=idle, waiting=waiting, blocked=blocked, read=read, write=write, exec=exec_,
             search=search, network=network, delegate=delegate, think=think, wait=wait, error=error)


# ---------------------------------------------------------------- authoring
def manifest_animations():
    with open(HERE / "asset.json", encoding="utf8") as f:
        return json.load(f)["render"]["animations"]


def author(rig, name, pose, frames, loop, use_action):
    """Keys pose on every frame of a `<name>.controls` action whose range and cyclic flag follow the manifest."""
    start, end = frames
    count = end - start + 1
    last = end + 1 if loop == "cycle" else end
    action = bpy.data.actions.new(f"{name}.controls")
    action.use_fake_user = True
    use_action(rig, action)
    keyed = set()
    for frame in range(start, last + 1):
        bpy.context.scene.frame_set(frame)
        reset(rig)
        i = frame - start
        if loop == "cycle":
            phase = (i % count) / count * math.tau
        else:
            phase = i / (count - 1) if count > 1 else 0.0
        p = Pose(rig)
        pose(p, phase)
        keyed |= p.moved
        for side in SIDES:
            for limb in (ARM, LEG):
                pb = rig.pose.bones[f"{limb}.{side}"]
                pb.keyframe_insert('["IK_FK"]', frame=frame, group=pb.name)
        for bone in sorted(keyed):
            pb = rig.pose.bones[bone]
            pb.keyframe_insert("location", frame=frame, group=bone)
            mode = "rotation_quaternion" if pb.rotation_mode == "QUATERNION" else "rotation_euler"
            pb.keyframe_insert(mode, frame=frame, group=bone)
    action.use_frame_range = True
    action.frame_start, action.frame_end = start, last
    action.use_cyclic = loop == "cycle"
    rig.animation_data.action = None
    reset(rig)
    return action


def author_all(rig, use_action, only=None):
    """Authors every animation the manifest lists, from POSES. Fails on a manifest clip without a pose."""
    setup(rig)
    animations = manifest_animations()
    missing = sorted(set(animations) - set(POSES))
    if missing:
        raise RuntimeError(f"asset.json lists animations with no pose in animations.py: {', '.join(missing)}")
    for name, spec in animations.items():
        if only and name not in only:
            continue
        author(rig, spec["action"], POSES[name], spec["frames"], spec["loop"], use_action)
