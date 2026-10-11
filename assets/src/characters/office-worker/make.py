# Builds office-worker.blend from scratch. Run by make.mjs, not by hand:
#   blender -b --factory-startup -P make.py -- --out <office-worker.blend> --makehuman <pack dir> --settings <settings.json>
#
# The body, its morph targets, the Rigify metarig and its weights come from MPFB 2.0.17; the eyes and brows come
# from the MakeHuman CC0 system asset pack. Everything else is made here: the 1.2x head (ticket 01), the clothing
# and hair, the materials, the canonical deformation skeleton and the actions, which animations.py authors from
# the clips asset.json lists. MPFB is used as a tool only.
#
# The saved file follows the .blend contract in assets/README.md:
#   collection "asset":    the deformation skeleton "office-worker" and every mesh, skinned to it
#   collection "controls": the generated Rigify rig "office-worker-controls", its widgets and the metarig
# Actions named "<name>.controls" are authored on the controls and baked into "<name>" on the skeleton.
# Writes licence-audit.json next to this script. Exits 3 on any Blender build but the pinned one, 1 on any error.
import argparse
import builtins
import gzip
import importlib
import io
import json
import os
import shutil
import sys
from pathlib import Path

import bmesh
import bpy
from mathutils import Vector

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[2] / "pipeline"))
sys.path.insert(0, str(HERE))
sys.dont_write_bytecode = True  # no __pycache__ next to the pipeline scripts
import bake  # noqa: E402
import animations  # noqa: E402

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument("--out", required=True)
ap.add_argument("--makehuman", required=True)
ap.add_argument("--settings", required=True)
ARGS = ap.parse_args(argv)
with open(ARGS.settings, encoding="utf8") as f:
    S = json.load(f)
MPFB_ROOT = Path(os.environ["BLENDER_USER_RESOURCES"]) / "extensions" / "user_default" / "mpfb"
PACK = Path(ARGS.makehuman)

MACROS = dict(gender=1.0, age=0.5, muscle=0.5, weight=0.5, height=0.5)
HEAD_SCALE = 1.2
class AssetError(Exception):
    pass


def check_pin():
    as_str = lambda v: v.decode() if isinstance(v, bytes) else str(v)
    build_hash = as_str(bpy.app.build_hash)
    pin = S["blender"]
    if ".".join(map(str, bpy.app.version)) != pin["version"] or not build_hash.startswith(pin["buildHash"]):
        sys.stderr.write(f"Refusing Blender {bpy.app.version_string} ({build_hash}); "
                         f"the asset pipeline is pinned to {pin['version']} ({pin['buildHash']}).\n")
        sys.exit(3)


def lin(hex_colour):
    h = hex_colour.lstrip("#")
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)


def move_to(obj, collection):
    for c in list(obj.users_collection):
        c.objects.unlink(obj)
    collection.objects.link(obj)


def update():
    bpy.context.view_layer.update()


# ---------------------------------------------------------------- MPFB
def mpfb(module, name):
    return getattr(importlib.import_module(f"bl_ext.user_default.mpfb.{module}"), name)


def load_mpfb():
    import addon_utils
    addon_utils.enable("rigify", default_set=True)
    addon_utils.enable("bl_ext.user_default.mpfb", default_set=True)
    # MPFB finds proxies under its user data dir; put only the files of the eyes and brows we use there.
    user_data = Path(mpfb("services.locationservice", "LocationService").get_user_data())
    for kind in ("eyes", "eyebrows"):
        shutil.rmtree(user_data / kind, ignore_errors=True)
    for pattern in ("eyes/low-poly/*", "eyes/materials/brown.*", "eyes/materials/brown_eye.png", "eyebrows/eyebrow001/*"):
        for src in PACK.glob(pattern):
            target = user_data / src.relative_to(PACK)
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(src, target)


class Reads:
    """Records every file read while active: through open(), gzip.open() or MPFB's OBJ loader (Blender's C
    importer, which open() never sees), plus every image Blender loaded. MPFB reads all of its data that way, so
    the audit sees exactly what the character is built from."""

    def __enter__(self):
        self.paths = set()
        self.patched = [(builtins, "open"), (io, "open"), (gzip, "open")]
        self.saved = [getattr(module, name) for module, name in self.patched]
        for module, name in self.patched:
            setattr(module, name, self.recording(getattr(module, name)))
        return self

    def recording(self, opener, has_mode=True):
        def wrapper(file, *args, **kwargs):
            mode = (args[0] if args else kwargs.get("mode", "r")) if has_mode else "r"
            if isinstance(file, (str, os.PathLike)) and not any(c in str(mode) for c in "wax+"):
                self.paths.add(Path(file).resolve())
            return opener(file, *args, **kwargs)
        return wrapper

    def watch_obj_loader(self):
        """Call once MPFB is enabled."""
        ObjectService = mpfb("services.objectservice", "ObjectService")
        self.patched.append((ObjectService, "load_wavefront_file"))
        self.saved.append(ObjectService.load_wavefront_file)
        ObjectService.load_wavefront_file = staticmethod(self.recording(ObjectService.load_wavefront_file, False))

    def __exit__(self, *_):
        for (module, name), original in zip(self.patched, self.saved):
            setattr(module, name, staticmethod(original) if isinstance(module, type) else original)
        self.paths |= {Path(bpy.path.abspath(i.filepath)).resolve() for i in bpy.data.images if i.filepath}


def make_body():
    """The MPFB human with MACROS, its targets baked."""
    HumanService = mpfb("services.humanservice", "HumanService")
    Props = mpfb("entities.objectproperties", "HumanObjectProperties")
    TargetService = mpfb("services.targetservice", "TargetService")
    body = HumanService.create_human(feet_on_ground=True, scale=0.1)
    for key, value in MACROS.items():
        Props.set_value(key, value, entity_reference=body)
    TargetService.reapply_macro_details(body)
    update()
    TargetService.bake_targets(body)  # vertex.co is the shaped body from here on
    return body


def group_centre(obj, name):
    index = obj.vertex_groups[name].index
    points = [v.co for v in obj.data.vertices if any(g.group == index and g.weight > 0 for g in v.groups)]
    return sum(points, Vector()) / len(points)


def scale_head(body):
    """Scales the head HEAD_SCALE times about the head joint, blending over the neck so the join stays smooth.

    Runs before the rig is fitted, on every vertex including MPFB's joint cubes, so the rig fits the bigger head."""
    pivot = group_centre(body, "joint-head")
    neck = group_centre(body, "joint-neck")
    low, high = neck.z, neck.z + 0.6 * (pivot.z - neck.z)
    for v in body.data.vertices:
        t = min(1.0, max(0.0, (v.co.z - low) / (high - low)))
        w = t * t * (3 - 2 * t)
        v.co = pivot + (v.co - pivot) * (1 + (HEAD_SCALE - 1) * w)


def add_rig_and_proxies(body):
    HumanService = mpfb("services.humanservice", "HumanService")
    AssetService = mpfb("services.assetservice", "AssetService")
    metarig = HumanService.add_builtin_rig(body, "rigify.human", import_weights=True)
    proxies = {}
    for role, subdir, fname, typ in (("eyes", "eyes", "low-poly.mhclo", "Eyes"),
                                     ("brows", "eyebrows", "eyebrow001.mhclo", "Eyebrows")):
        path = AssetService.find_asset_absolute_path(fname, asset_subdir=subdir)
        if not path:
            raise AssetError(f"MPFB asset not found: {subdir}/{fname}")
        proxies[role] = HumanService.add_mhclo_asset(path, body, asset_type=typ, subdiv_levels=0,
                                                     material_type="MAKESKIN")
    return metarig, proxies


def generate_controls(metarig, controls_collection):
    RigService = mpfb("services.rigservice", "RigService")
    before = set(bpy.data.collections)
    rig = RigService.generate_rigify_rig(metarig, name="office-worker-controls", meta_rig_action="hide")
    if rig is None:
        raise AssetError("Rigify rejected the MPFB metarig")
    rig.name = rig.data.name = "office-worker-controls"
    metarig.name = metarig.data.name = "office-worker-metarig"
    move_to(rig, controls_collection)
    move_to(metarig, controls_collection)
    for c in set(bpy.data.collections) - before:  # Rigify's widget collection
        for parent in [p for p in bpy.data.collections if c.name in p.children] + [bpy.context.scene.collection]:
            if c.name in parent.children:
                parent.children.unlink(c)
        controls_collection.children.link(c)
    return rig


def remove_helpers(body):
    """Deletes MPFB's helper geometry (tights, skirt, hair and joint helpers), which its mask modifier only hides."""
    keep = body.vertex_groups["body"].index
    bm = bmesh.new()
    bm.from_mesh(body.data)
    deform = bm.verts.layers.deform.verify()
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if v[deform].get(keep, 0) <= 0], context="VERTS")
    bm.to_mesh(body.data)
    bm.free()
    for m in [m for m in body.modifiers if m.type == "MASK"]:
        body.modifiers.remove(m)
    for g in [g for g in body.vertex_groups if not g.name.startswith("DEF-")]:
        body.vertex_groups.remove(g)


# ---------------------------------------------------------------- clothing and hair (ours)
# Body regions, by the Rigify deform bone that weighs most on a vertex. Hands and the head are skin.
REGIONS = {
    "torso": ("spine", "spine.001", "spine.002", "spine.003", "spine.004", "spine.005", "breast", "shoulder",
              "shoulder-helper", "pelvis", "pelvis-helper"),
    "arm": ("upper_arm", "forearm", "elbow-helper"),
    "leg": ("thigh", "shin", "knee-helper"),
    "foot": ("foot", "toe", "heel"),
    "head": ("spine.006", "forehead", "temple", "ear", "brow", "lid", "cheek", "nose", "jaw", "chin", "lip", "eye",
             "teeth", "tongue", "jaw_master"),
}


def bone_region(name):
    """The region of a deform bone. "upper_arm" covers upper_arm.L, upper_arm.L.001 and so on; a spine bone must
    match exactly, because each spine.00N is a different bone."""
    bare = name.removeprefix("DEF-")
    for region, bones in REGIONS.items():
        if any(bare == b or (not b.startswith("spine") and bare.startswith(b + ".")) for b in bones):
            return region
    return None


class Plane:
    """A cut: points with (co - point) . normal < 0 are inside."""

    def __init__(self, point, normal):
        self.point, self.normal = Vector(point), Vector(normal).normalized()

    def distance(self, co):
        return (co - self.point).dot(self.normal)

    def project(self, co):
        return co - self.normal * self.distance(co)


class Collar:
    """A crew neck: points within radius of the neck's axis, above its base, are outside."""

    def __init__(self, base, top, radius):
        self.base, self.axis, self.radius = Vector(base), (Vector(top) - Vector(base)).normalized(), radius

    def _radial(self, co):
        along = (co - self.base).dot(self.axis)
        return along, co - self.base - self.axis * along

    def distance(self, co):
        along, radial = self._radial(co)
        return self.radius - radial.length if along > 0 else -1.0

    def project(self, co):
        along, radial = self._radial(co)
        return self.base + self.axis * along + radial.normalized() * self.radius


def cuts(controls):
    """The cuts that bound each piece, placed from the rig's rest pose: a crew-neck shirt with long sleeves,
    trousers from the waist to just above the shoes."""
    bone = lambda name: controls.data.bones[name]
    at = lambda name, t: bone(name).head_local.lerp(bone(name).tail_local, t)
    # Pieces meet on one cut, never overlap: an outline shell under another piece would show through it.
    waist = bone("DEF-spine.001").head_local.z
    ankle = bone("DEF-foot.L").head_local.z + 0.04
    planes = dict(
        collar=Collar(at("DEF-spine.004", 0.8), bone("DEF-spine.005").tail_local, 0.068),
        hem=Plane((0, 0, waist), (0, 0, -1)),
        waistband=Plane((0, 0, waist), (0, 0, 1)),
        trouser_hem=Plane((0, 0, ankle), (0, 0, -1)),
        shoe_top=Plane((0, 0, ankle), (0, 0, 1)),
    )
    for side in ("L", "R"):  # long sleeves, cuffed just above the wrist
        forearm = bone(f"DEF-forearm.{side}.001")
        planes[f"sleeve.{side}"] = Plane(at(f"DEF-forearm.{side}.001", 0.75), forearm.tail_local - forearm.head_local)
    return planes


def regions(body):
    names = {g.index: g.name for g in body.vertex_groups}
    region = {}
    for v in body.data.vertices:
        best = max(v.groups, key=lambda g: g.weight, default=None)
        region[v.index] = bone_region(names[best.group]) if best else None
    return region


def head_box(body, region):
    head = [body.data.vertices[i].co for i, r in region.items() if r == "head"]
    lo = Vector((min(c.x for c in head), min(c.y for c in head), min(c.z for c in head)))
    hi = Vector((max(c.x for c in head), max(c.y for c in head), max(c.z for c in head)))
    return lo, hi


def hair_planes(lo, hi):
    """A short cut: the top of the head, and the back down to the ears. A union of the crown and the back."""
    size = hi - lo
    return dict(crown=[Plane((0, 0, lo.z + 0.70 * size.z), (0, 0, -1))],
                back=[Plane((0, 0, lo.z + 0.42 * size.z), (0, 0, -1)), Plane((0, lo.y + 0.55 * size.y, 0), (0, -1, 0))])


def pieces_of(body, controls):
    """Body faces for each piece, by the region most of a face's corners are in and where its centre lies."""
    region = regions(body)
    planes = cuts(controls)
    lo, hi = head_box(body, region)
    hair = hair_planes(lo, hi)
    inside = lambda co, *names: all(planes[n].distance(co) < 0 for n in names)
    faces = {name: [] for name in ("shirt", "trousers", "shoes", "hair")}
    for p in body.data.polygons:
        votes = [region[i] for i in p.vertices]
        where = max(set(votes), key=votes.count)
        c = p.center
        side = "L" if c.x > 0 else "R"
        if (where == "torso" and inside(c, "collar", "hem")) or (where == "arm" and inside(c, f"sleeve.{side}")):
            faces["shirt"].append(p.index)
        if (where == "torso" and inside(c, "waistband")) or (where == "leg" and inside(c, "trouser_hem")):
            faces["trousers"].append(p.index)
        if where == "foot" or (where == "leg" and inside(c, "shoe_top")):
            faces["shoes"].append(p.index)
        if where == "head" and any(all(q.distance(c) < 0 for q in group) for group in hair.values()):
            faces["hair"].append(p.index)
    edges = dict(shirt=[planes["collar"], planes["hem"], planes["sleeve.L"], planes["sleeve.R"]],
                 trousers=[planes["waistband"], planes["trouser_hem"]], shoes=[planes["shoe_top"]],
                 hair=[q for group in hair.values() for q in group])
    # More volume on the crown than at the hairline.
    crown = lambda co: min(1.0, max(0.0, ((co.z - lo.z) / (hi.z - lo.z) - 0.45) / 0.55))
    push = dict(shirt=lambda co: 0.006, trousers=lambda co: 0.005, shoes=lambda co: 0.008,
                hair=lambda co: 0.005 + 0.012 * crown(co))
    return faces, edges, push


def shell(body, name, faces, push, edges):
    """A new mesh from some of the body's faces, pushed out along the vertex normals, with the body's weights.

    Each vertex on the open edge is moved onto the nearest cut, so hems, cuffs and the collar are clean lines
    instead of following the body's edge loops."""
    used = sorted({i for f in faces for i in body.data.polygons[f].vertices})
    index = {old: new for new, old in enumerate(used)}
    verts = [body.data.vertices[i].co + body.data.vertices[i].normal * push(body.data.vertices[i].co) for i in used]
    polys = [[index[i] for i in body.data.polygons[f].vertices] for f in faces]
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], polys)
    mesh.update()
    bm = bmesh.new()
    bm.from_mesh(mesh)
    for v in bm.verts:
        if any(e.is_boundary for e in v.link_edges):
            cut = min(edges, key=lambda q: abs(q.distance(v.co)))
            if abs(cut.distance(v.co)) < 0.03:
                v.co = cut.project(v.co)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    groups = {g.index: obj.vertex_groups.new(name=g.name) for g in body.vertex_groups}
    for new, old in enumerate(used):
        for g in body.data.vertices[old].groups:
            groups[g.group].add([new], g.weight, "REPLACE")
    for polygon in mesh.polygons:
        polygon.use_smooth = True
    return obj


def make_clothing(body, controls):
    faces, edges, push = pieces_of(body, controls)
    # The body stays under the clothes: through the open collar and waist it hides the inside of the outline hull.
    return {name: shell(body, name, faces[name], push[name], edges[name]) for name in faces}


# ---------------------------------------------------------------- materials
def material(name, image=None):
    # One material per palette name: render.py finds the toon colour by material name.
    """A plain material named after a palette entry (or the shirt mask); render.py swaps in the toon look."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes["Principled BSDF"]
    colour = lin(S["palette"]["tint" if name == "shirt" else name])
    bsdf.inputs["Base Color"].default_value = (*colour, 1)
    if image:
        tex = m.node_tree.nodes.new("ShaderNodeTexImage")
        tex.image = image
        m.node_tree.links.new(tex.outputs["Alpha"], bsdf.inputs["Alpha"])
    return m


def set_material(obj, mat):
    obj.data.materials.clear()
    obj.data.materials.append(mat)
    for p in obj.data.polygons:
        p.material_index = 0


# ---------------------------------------------------------------- canonical deformation skeleton
def deform_skeleton(controls, collection):
    """A plain armature with only the controls' DEF bones: same names and rest matrices, no constraints, no drivers.

    Each bone is parented to its nearest deforming ancestor (an ORG-x parent stands for DEF-x)."""
    data = bpy.data.armatures.new("office-worker")
    skeleton = bpy.data.objects.new("office-worker", data)
    collection.objects.link(skeleton)
    skeleton.matrix_world = controls.matrix_world
    bones = [b for b in controls.data.bones if b.name.startswith("DEF-")]
    names = {b.name for b in bones}

    def deform_parent(bone):
        p = bone.parent
        while p:
            for candidate in (p.name, "DEF-" + p.name.split("-", 1)[-1]):
                if candidate in names:
                    return candidate
            p = p.parent
        return None

    bpy.context.view_layer.objects.active = skeleton
    bpy.ops.object.mode_set(mode="EDIT")
    for b in bones:
        eb = data.edit_bones.new(b.name)
        eb.head, eb.tail = (0, 0, 0), (0, b.length, 0)
        eb.matrix = b.matrix_local
        eb.use_deform = True
    for b in bones:
        parent = deform_parent(b)
        if parent:
            data.edit_bones[b.name].parent = data.edit_bones[parent]
    bpy.ops.object.mode_set(mode="OBJECT")
    for pb in skeleton.pose.bones:
        pb.rotation_mode = "QUATERNION"
    return skeleton


def bind(obj, skeleton):
    for m in [m for m in obj.modifiers if m.type == "ARMATURE"]:
        obj.modifiers.remove(m)
    world = obj.matrix_world.copy()
    obj.parent = skeleton
    obj.matrix_world = world
    obj.modifiers.new("armature", "ARMATURE").object = skeleton


# ---------------------------------------------------------------- licence audit (ticket 07, item 1)
MPFB_LICENCE = "https://github.com/makehumancommunity/mpfb2/blob/v2.0.17/LICENSE.md"
# The asset kinds MPFB's LICENSE.md releases as CC0 1.0, by data directory.
MPFB_CC0 = {"3dobjs": "the base mesh and proxies", "mesh_metadata": "JSON data with mesh information",
            "targets": "targets and modifiers", "rigs": "rigs, poses and expressions", "textures": "textures"}
# Data MPFB reads that is not in the output: LICENSE.md counts configuration as GPL source.
MPFB_NOT_IN_OUTPUT = {"node_trees": "material node template; make.py replaces every material"}


def states_cc0(path):
    """Whether a MakeHuman/MPFB file states CC0 itself: the OBJ/MHCLO/MHMAT header or a JSON "license" field."""
    if path.suffix == ".json":
        return json.loads(path.read_text(encoding="utf8")).get("license") == "CC0"
    if path.suffix in (".png", ".thumb", ".gz"):
        return False
    return "explicitly released as CC0" in path.read_text(encoding="utf8", errors="ignore")


def licence_audit(reads):
    """Writes licence-audit.json: every MakeHuman/MPFB data file the build read, with the evidence it is CC0.

    Evidence is the file's own CC0 statement, a CC0 statement in an .mhclo or .mhmat beside it (for its meshes
    and textures), or the asset kind MPFB's LICENSE.md releases as CC0. Fails on any other data file."""
    mpfb_data = MPFB_ROOT / "data"
    user_data = Path(mpfb("services.locationservice", "LocationService").get_user_data()).resolve()
    files, not_in_output = {}, {}
    for path in sorted(reads):
        if mpfb_data in path.parents:
            name, kind = f"mpfb/{path.relative_to(MPFB_ROOT).as_posix()}", path.relative_to(mpfb_data).parts[0]
            if states_cc0(path):
                files[name] = "stated in the file"
            elif kind in MPFB_CC0:
                files[name] = f"MPFB LICENSE.md: {MPFB_CC0[kind]}"
            elif kind in MPFB_NOT_IN_OUTPUT:
                not_in_output[name] = MPFB_NOT_IN_OUTPUT[kind]
            else:
                raise AssetError(f"licence audit: no CC0 evidence for {path}")
        elif user_data in path.parents or PACK.resolve() in path.parents:
            # MPFB reads its copy of the pack under its user data dir; record the pack path.
            rel = path.relative_to(user_data if user_data in path.parents else PACK.resolve())
            name, source = f"makehuman/{rel.as_posix()}", PACK / rel
            # Prefer the .mhclo or .mhmat that names the file (a mesh or texture it uses), then one with its stem.
            stating = sorted((p for p in source.parent.iterdir() if p.suffix in (".mhclo", ".mhmat") and states_cc0(p)),
                             key=lambda p: (source.name not in p.read_text(encoding="utf8", errors="ignore"),
                                            p.stem != source.stem))
            if states_cc0(source):
                files[name] = "stated in the file"
            elif stating:
                files[name] = f"CC0 statement in {stating[0].name}"
            else:
                raise AssetError(f"licence audit: no CC0 evidence for {source}")
    audit = dict(
        mpfb=dict(version="2.0.17", sha256=S["sources"]["mpfb"]["sha256"], licence=MPFB_LICENCE),
        makehuman=dict(pack=S["sources"]["makehuman"]["file"], sha256=S["sources"]["makehuman"]["sha256"]),
        files=[dict(path=k, licence="CC0-1.0", evidence=v) for k, v in files.items()],
        notInOutput=[dict(path=k, reason=v) for k, v in not_in_output.items()],
    )
    (HERE / "licence-audit.json").write_text(json.dumps(audit, indent=2) + "\n", encoding="utf8")


# ---------------------------------------------------------------- main
def main():
    check_pin()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    asset = bpy.data.collections.new("asset")
    controls_collection = bpy.data.collections.new("controls")
    bpy.context.scene.collection.children.link(asset)
    bpy.context.scene.collection.children.link(controls_collection)

    with Reads() as reads:
        load_mpfb()
        reads.watch_obj_loader()
        body = make_body()
        scale_head(body)
        metarig, proxies = add_rig_and_proxies(body)
        controls = generate_controls(metarig, controls_collection)
        brow_image = bpy.data.images.load(str(PACK / "eyebrows" / "eyebrow001" / "eyebrow001.png"))
    remove_helpers(body)
    pieces = make_clothing(body, controls)

    skeleton = deform_skeleton(controls, asset)
    brow_image.pack()
    meshes = dict(body=body, eyes=proxies["eyes"], brows=proxies["brows"], **pieces)
    materials = dict(body=material("skin"), eyes=material("eyes"), brows=material("brows", brow_image),
                     shirt=material("shirt"), trousers=material("trousers"), shoes=material("shoes"),
                     hair=material("hair"))
    for name, obj in meshes.items():
        obj.name = name
        move_to(obj, asset)
        set_material(obj, materials[name])
        bind(obj, skeleton)
    for name in ("eyes", "brows"):
        meshes[name]["agentarium_outline"] = False

    animations.author_all(controls, bake.use_action)
    bake.bake(skeleton, controls)
    bpy.context.scene.frame_set(1)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(ARGS.out), compress=True)
    licence_audit(reads.paths)
    print("MADE", ARGS.out, flush=True)


try:
    main()
except AssetError as e:
    sys.stderr.write(f"Error: {e}\n")
    sys.exit(1)
except Exception:
    import traceback
    traceback.print_exc()
    sys.exit(1)
