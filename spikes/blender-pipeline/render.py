# Spike (phase-3-scene 02): headless Blender render of one rigged CC0 mannequin into
# sprite frames for a Pixi atlas. Run through pipeline.mjs, not by hand:
#   blender -b --factory-startup -P render.py -- --engine eevee --out <dir> [--quick] [--mannequin mpfb|basic]
# Without -b (GUI) and with --desktop it renders a few reference frames, then quits.
#
# Writes <out>/frames/<layer>/<anim>/<dir>/frame-NNN.png (layer: beauty | mask) and
# <out>/render-log.json (build, engine, CPU, GL, seconds per frame, peak memory).
import bpy, math, os, sys, json, time, platform, argparse
from mathutils import Matrix, Vector

PIN = {"version": "5.2.2", "build_hash": "d13f752e3b9c"}  # official 5.2.2 LTS build

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument("--engine", choices=["eevee", "cycles"], required=True)
ap.add_argument("--out", required=True)
ap.add_argument("--quick", action="store_true", help="sw direction only, every 4th frame")
ap.add_argument("--desktop", action="store_true", help="reference frames from a GUI session")
ap.add_argument("--mannequin", choices=["mpfb", "basic"], default="mpfb")
ap.add_argument("--assets", help="extracted MakeHuman system asset pack (data dir)")
ARGS = ap.parse_args(argv)
OUT = os.path.abspath(ARGS.out)
os.makedirs(OUT, exist_ok=True)
LOG = {"args": vars(ARGS), "errors": []}

# 1x frame 160x208, feet anchor at (80, 184); rendered at 2x. 128x64 tiles, 1 tile = 1 m.
W1, H1, AX1, AY1, SCALE = 160, 208, 80, 184, 2
DIRS = {"sw": 0, "se": 90, "ne": 180, "nw": 270}  # screen direction the character faces
ANIMS = {"walk": dict(start=1, frames=12, fps=12), "idle": dict(start=101, frames=16, fps=8)}
NEUTRAL_SHIRT = (0.8, 0.8, 0.8)


# ---------------------------------------------------------------- pin + build log
def cpu_name():
    try:
        if sys.platform == "win32":
            import winreg
            k = winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r"HARDWARE\DESCRIPTION\System\CentralProcessor\0")
            return winreg.QueryValueEx(k, "ProcessorNameString")[0].strip()
        for line in open("/proc/cpuinfo"):
            if line.lower().startswith(("model name", "cpu model")):
                return line.split(":", 1)[1].strip()
    except Exception as e:  # noqa: BLE001 - informational only
        return f"unknown ({e})"
    return platform.processor() or "unknown"


def peak_memory_mb():
    if sys.platform == "win32":
        import ctypes, ctypes.wintypes as wt

        class PMC(ctypes.Structure):
            _fields_ = [("cb", wt.DWORD), ("PageFaultCount", wt.DWORD), ("PeakWorkingSetSize", ctypes.c_size_t),
                        ("WorkingSetSize", ctypes.c_size_t), ("QuotaPeakPagedPoolUsage", ctypes.c_size_t),
                        ("QuotaPagedPoolUsage", ctypes.c_size_t), ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t),
                        ("QuotaNonPagedPoolUsage", ctypes.c_size_t), ("PagefileUsage", ctypes.c_size_t),
                        ("PeakPagefileUsage", ctypes.c_size_t)]
        pmc = PMC()
        pmc.cb = ctypes.sizeof(PMC)
        ctypes.windll.psapi.GetProcessMemoryInfo(ctypes.windll.kernel32.GetCurrentProcess(), ctypes.byref(pmc), pmc.cb)
        return round(pmc.PeakWorkingSetSize / 2**20, 1)
    import resource
    return round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024, 1)  # Linux: KiB


def check_pin():
    build_hash = bpy.app.build_hash.decode() if isinstance(bpy.app.build_hash, bytes) else bpy.app.build_hash
    LOG["blender"] = dict(version=bpy.app.version_string, build_hash=build_hash,
                          build_date=bpy.app.build_date.decode() if isinstance(bpy.app.build_date, bytes) else str(bpy.app.build_date), python=sys.version.split()[0])
    LOG["host"] = dict(os=platform.platform(), machine=platform.machine(), cpu=cpu_name(),
                       cpu_count=os.cpu_count(), background=bpy.app.background)
    # bpy.app.version, not version_string: the official build's version_string is "5.2.2 LTS"
    pinned = ".".join(map(str, bpy.app.version)) == PIN["version"] and build_hash.startswith(PIN["build_hash"])
    LOG["pinned"] = pinned
    print("BUILD", json.dumps(LOG["blender"]), json.dumps(LOG["host"]), flush=True)
    if not pinned:
        if os.environ.get("SPIKE_ALLOW_UNPINNED") != "1":
            sys.stderr.write(f"Refusing Blender {bpy.app.version_string} ({build_hash}); "
                             f"this pipeline is pinned to {PIN['version']} ({PIN['build_hash']}).\n")
            sys.exit(3)
        print("WARNING: UNPINNED Blender build, results are not comparable (SPIKE_ALLOW_UNPINNED=1)", flush=True)


def gl_info():
    try:
        import gpu
        return dict(backend=gpu.platform.backend_type_get(), vendor=gpu.platform.vendor_get(),
                    renderer=gpu.platform.renderer_get(), version=gpu.platform.version_get())
    except Exception as e:  # noqa: BLE001 - no GPU context (Cycles in -b)
        return dict(error=str(e))


# ---------------------------------------------------------------- scene
def lin(h):
    h = h.lstrip("#")
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)


def update():
    bpy.context.view_layer.update()


def engine_id():
    items = bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items.keys()
    if ARGS.engine == "cycles":
        return "CYCLES"
    return "BLENDER_EEVEE_NEXT" if "BLENDER_EEVEE_NEXT" in items else "BLENDER_EEVEE"


def setup_scene():
    sc = bpy.context.scene
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    r = sc.render
    r.engine = engine_id()
    r.resolution_x, r.resolution_y, r.resolution_percentage = W1 * SCALE, H1 * SCALE, 100
    r.film_transparent = True
    r.filter_size = 1.5
    r.image_settings.file_format = "PNG"
    r.image_settings.color_mode = "RGBA"
    r.image_settings.color_depth = "8"
    r.use_persistent_data = True
    sc.view_settings.view_transform = "Standard"
    sc.view_settings.look = "None"
    sc.view_settings.exposure = 0
    sc.view_settings.gamma = 1
    sc.display_settings.display_device = "sRGB"
    sc.render.fps = 12
    if ARGS.engine == "cycles":
        sc.cycles.device = "CPU"
        sc.cycles.samples = 64
        sc.cycles.use_adaptive_sampling = False
        sc.cycles.seed = 0
        sc.cycles.use_denoising = True
        try:
            sc.cycles.denoiser = "OPENIMAGEDENOISE"
        except TypeError as e:
            LOG["errors"].append(f"OIDN unavailable: {e}")
            sc.cycles.use_denoising = False
    else:
        ee = sc.eevee
        ee.taa_render_samples = 32
        for attr, val in [("use_gtao", False), ("use_soft_shadows", True), ("use_shadows", True)]:
            if hasattr(ee, attr):
                setattr(ee, attr, val)

    world = bpy.data.worlds.new("w")
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    bg.inputs[0].default_value = (0.42, 0.44, 0.48, 1)
    bg.inputs[1].default_value = 1.0
    sc.world = world

    cam_data = bpy.data.cameras.new("cam")
    cam_data.type = "ORTHO"
    cam_data.sensor_fit = "VERTICAL"
    cam_data.ortho_scale = H1 / (128 / math.sqrt(2))  # 128 px tile = sqrt(2) m wide
    cam_data.shift_y = (H1 / 2 - (H1 - AY1)) / H1
    cam_data.shift_x = (W1 / 2 - AX1) / H1
    cam_data.clip_end = 100
    cam = bpy.data.objects.new("cam", cam_data)
    cam.rotation_euler = (math.radians(60), 0, math.radians(45))
    cam.location = cam.rotation_euler.to_matrix() @ Vector((0, 0, 1)) * 30
    sc.collection.objects.link(cam)
    sc.camera = cam

    sun_data = bpy.data.lights.new("sun", "SUN")
    sun_data.energy = 3.2
    sun_data.angle = math.radians(8)
    sun = bpy.data.objects.new("sun", sun_data)
    sun.rotation_euler = Vector((0.2, -1.0, 1.6)).to_track_quat("Z", "Y").to_euler()
    sc.collection.objects.link(sun)


# ---------------------------------------------------------------- materials (toon look, p3-01)
_MATS = {}


def mat(name, colour, alpha_tex=None, mask=None):
    """Toon in EEVEE (Shader to RGB cel ramp); Cycles has no Shader to RGB, so it gets flat Principled.
    mask: None (beauty) or 0/1 (flat emission for the mask pass)."""
    key = (name, tuple(colour), alpha_tex, mask, ARGS.engine)
    if key in _MATS:
        return _MATS[key]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt, L = m.node_tree, m.node_tree.links
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    if mask is not None:
        sh = nt.nodes.new("ShaderNodeEmission")
        sh.inputs[0].default_value = (mask, mask, mask, 1)
        shader = sh.outputs[0]
    elif ARGS.engine == "eevee":
        d = nt.nodes.new("ShaderNodeBsdfDiffuse")
        s2r = nt.nodes.new("ShaderNodeShaderToRGB")
        bw = nt.nodes.new("ShaderNodeRGBToBW")
        ramp = nt.nodes.new("ShaderNodeValToRGB")
        ramp.color_ramp.interpolation = "CONSTANT"
        e = ramp.color_ramp.elements
        e[0].position, e[0].color = 0.0, (0.5, 0.5, 0.6, 1)
        e[1].position, e[1].color = 0.45, (1, 1, 1, 1)
        mul = nt.nodes.new("ShaderNodeMix")
        mul.data_type, mul.blend_type = "RGBA", "MULTIPLY"
        mul.inputs["Factor"].default_value = 1.0
        mul.inputs[7].default_value = (*colour, 1)
        em = nt.nodes.new("ShaderNodeEmission")
        L.new(d.outputs[0], s2r.inputs[0])
        L.new(s2r.outputs[0], bw.inputs[0])
        L.new(bw.outputs[0], ramp.inputs[0])
        L.new(ramp.outputs[0], mul.inputs[6])
        L.new(mul.outputs[2], em.inputs[0])
        shader = em.outputs[0]
    else:
        b = nt.nodes.new("ShaderNodeBsdfPrincipled")
        b.inputs["Base Color"].default_value = (*colour, 1)
        b.inputs["Roughness"].default_value = 0.75
        shader = b.outputs[0]
    if alpha_tex:
        t = nt.nodes.new("ShaderNodeTexImage")
        t.image = bpy.data.images.load(alpha_tex, check_existing=True)
        tr = nt.nodes.new("ShaderNodeBsdfTransparent")
        mix = nt.nodes.new("ShaderNodeMixShader")
        L.new(t.outputs["Alpha"], mix.inputs[0])
        L.new(tr.outputs[0], mix.inputs[1])
        L.new(shader, mix.inputs[2])
        shader = mix.outputs[0]
        if hasattr(m, "blend_method"):
            m.blend_method = "HASHED"
    L.new(shader, out.inputs[0])
    _MATS[key] = m
    return m


def ink(mask):
    """Inverted-hull outline: the shell's front faces show as ink, its back faces are transparent.
    Works in Cycles too, which ignores material backface culling."""
    key = ("ink", mask, ARGS.engine)
    if key in _MATS:
        return _MATS[key]
    m = bpy.data.materials.new("ink")
    m.use_nodes = True
    nt, L = m.node_tree, m.node_tree.links
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    em = nt.nodes.new("ShaderNodeEmission")
    em.inputs[0].default_value = (0, 0, 0, 1) if mask is not None else (0.05, 0.05, 0.07, 1)
    tr = nt.nodes.new("ShaderNodeBsdfTransparent")
    geo = nt.nodes.new("ShaderNodeNewGeometry")
    mix = nt.nodes.new("ShaderNodeMixShader")
    L.new(geo.outputs["Backfacing"], mix.inputs[0])
    L.new(em.outputs[0], mix.inputs[1])
    L.new(tr.outputs[0], mix.inputs[2])
    L.new(mix.outputs[0], out.inputs[0])
    if hasattr(m, "blend_method"):
        m.blend_method = "HASHED"
    _MATS[key] = m
    return m


def set_mats(o, mats, mask, split=None, outline=True):
    """Clearing the slots resets polygon material indices, so a split is reapplied each time."""
    o.data.materials.clear()
    for m_ in mats:
        o.data.materials.append(m_)
    if split:
        o.data.polygons.foreach_set("material_index", split)
    if outline:
        o.data.materials.append(ink(mask))
        mod = o.modifiers.get("outline") or o.modifiers.new("outline", "SOLIDIFY")
        mod.thickness = 0.018 / max(o.matrix_world.to_scale())
        mod.offset = 1.0
        mod.use_flip_normals = True
        mod.use_rim = False
        mod.material_offset = len(o.data.materials) - 1


# ---------------------------------------------------------------- mannequins
def load_mpfb():
    if bpy.app.version >= (4, 2, 0):
        import addon_utils
        addon_utils.enable("bl_ext.user_default.mpfb", default_set=True)
        pkg = "bl_ext.user_default.mpfb"
    else:  # dev only: an older apt Blender with a shimmed legacy MPFB (see README)
        exec(open(os.environ["SPIKE_MPFB_LEGACY_COMPAT"]).read(), {"__name__": "compat"})
        pkg = "mpfb"
    import importlib
    get = lambda mod, name: getattr(importlib.import_module(f"{pkg}.{mod}"), name)
    return (get("services.humanservice", "HumanService"), get("services.assetservice", "AssetService"),
            get("services.targetservice", "TargetService"), get("entities.objectproperties", "HumanObjectProperties"),
            get("services.locationservice", "LocationService"))


def build_mpfb():
    import shutil
    HumanService, AssetService, TargetService, Props, LocationService = load_mpfb()
    # MPFB looks for assets under its own user data dir; copy just what we use into it.
    user_data = LocationService.get_user_data()
    used = {"clothes": ["male_casualsuit02", "shoes06"], "hair": ["short02"], "eyes": [""], "eyebrows": ["eyebrow001"]}
    for sub, names in used.items():
        for n in names:
            src = os.path.join(ARGS.assets, sub, n)
            if os.path.isdir(src):
                shutil.copytree(src, os.path.join(user_data, sub, n), dirs_exist_ok=True)
    before = set(bpy.data.objects)
    h = HumanService.create_human()
    for k, v in dict(gender=1.0, age=0.5, muscle=0.5, weight=0.5, height=0.5).items():
        Props.set_value(k, v, entity_reference=h)
    TargetService.reapply_macro_details(h)
    rig = HumanService.add_builtin_rig(h, "default")
    for sub, fname, typ in [("eyes", "low-poly.mhclo", "Eyes"), ("eyebrows", "eyebrow001.mhclo", "Eyebrows"),
                            ("clothes", "male_casualsuit02.mhclo", "Clothes"), ("clothes", "shoes06.mhclo", "Clothes"),
                            ("hair", "short02.mhclo", "Hair")]:
        p = AssetService.find_asset_absolute_path(fname, asset_subdir=sub)
        assert p, f"MPFB asset not found: {sub}/{fname} (is --assets the pack's data dir?)"
        HumanService.add_mhclo_asset(p, h, asset_type=typ, subdiv_levels=0, material_type="MAKESKIN")
    parts = {}
    for o in set(bpy.data.objects) - before:
        if o.type != "MESH":
            continue
        n = o.name.lower()
        parts[o] = ("body" if o is h else "brows" if "brow" in n else "eyes" if "low-poly" in n
                    else "hair" if "short02" in n else "shoes" if "shoes" in n else "suit")
    update()
    body_z = [(h.matrix_world @ v.co).z for v in h.data.vertices]
    waist = min(body_z) + 0.575 * (max(body_z) - min(body_z))
    hair_dir = os.path.join(user_data, "hair", "short02")
    hair_tex = next((os.path.join(hair_dir, f) for f in sorted(os.listdir(hair_dir)) if f.endswith("_diffuse.png")), None)
    brow_dir = os.path.join(user_data, "eyebrows", "eyebrow001")
    brow_tex = next((os.path.join(brow_dir, f) for f in sorted(os.listdir(brow_dir)) if f.endswith(".png")), None)
    split = {}
    for o, role in parts.items():
        if role == "suit":
            zs = [(o.matrix_world @ v.co).z for v in o.data.vertices]
            split[o] = [0 if sum(zs[i] for i in p.vertices) / len(p.vertices) > waist else 1 for p in o.data.polygons]

    def materials(mask):
        k = None if mask is None else 0
        for o, role in parts.items():
            if role == "suit":
                top = mat("top", NEUTRAL_SHIRT, mask=None if mask is None else 1)
                set_mats(o, [top, mat("bottom", lin("#2E3440"), mask=k)], k, split[o])
            elif role == "body":
                set_mats(o, [mat("skin", lin("#C68863"), mask=k)], k)
            elif role == "hair":
                set_mats(o, [mat("hair", lin("#2B1D14"), alpha_tex=hair_tex, mask=k)], k)
            elif role == "brows":
                set_mats(o, [mat("brow", lin("#2B1D14"), alpha_tex=brow_tex, mask=k)], k, outline=False)
            elif role == "eyes":
                set_mats(o, [mat("eye", (0.02, 0.015, 0.012), mask=k)], k, outline=False)
            else:
                set_mats(o, [mat("shoes", (0.03, 0.03, 0.035), mask=k)], k)

    return rig, materials, dict(arm=("upperarm01", "lowerarm01", "wrist"), leg=("upperleg01", "lowerleg01", "foot"),
                                spine="spine05", head="head", root="root")


def build_basic():
    """Fallback mannequin made here (no external assets): an armature with capsule limbs parented to bones."""
    arm = bpy.data.armatures.new("rig")
    rig = bpy.data.objects.new("rig", arm)
    bpy.context.scene.collection.objects.link(rig)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode="EDIT")
    bones = {
        "root": ((0, 0, 0.95), (0, 0, 1.05), None), "spine": ((0, 0, 1.05), (0, 0, 1.45), "root"),
        "head": ((0, 0, 1.5), (0, 0, 1.75), "spine"),
    }
    for s, x in (("L", 1), ("R", -1)):
        bones |= {f"upperarm.{s}": ((0.2 * x, 0, 1.42), (0.24 * x, 0, 1.13), "spine"),
                  f"lowerarm.{s}": ((0.24 * x, 0, 1.13), (0.26 * x, 0, 0.88), f"upperarm.{s}"),
                  f"wrist.{s}": ((0.26 * x, 0, 0.88), (0.27 * x, 0, 0.78), f"lowerarm.{s}"),
                  f"upperleg.{s}": ((0.1 * x, 0, 0.95), (0.1 * x, 0, 0.5), "root"),
                  f"lowerleg.{s}": ((0.1 * x, 0, 0.5), (0.1 * x, 0, 0.08), f"upperleg.{s}"),
                  f"foot.{s}": ((0.1 * x, 0, 0.08), (0.1 * x, -0.14, 0.02), f"lowerleg.{s}")}
    for n, (hd, tl, parent) in bones.items():
        b = arm.edit_bones.new(n)
        b.head, b.tail = hd, tl
        if parent:
            b.parent = arm.edit_bones[parent]
            b.use_connect = n.startswith(("lowerarm", "wrist", "lowerleg", "foot"))
    bpy.ops.object.mode_set(mode="OBJECT")
    radius = {"root": 0.15, "spine": 0.17, "head": 0.11, "upperarm": 0.055, "lowerarm": 0.045, "wrist": 0.04,
              "upperleg": 0.075, "lowerleg": 0.06, "foot": 0.05}
    role_of = {"spine": "top", "upperarm": "top", "root": "bottom", "upperleg": "bottom", "lowerleg": "bottom",
               "foot": "shoes", "head": "skin", "lowerarm": "skin", "wrist": "skin"}
    parts = []
    for n, (hd, tl, _) in bones.items():
        kind = n.split(".")[0]
        length = (Vector(tl) - Vector(hd)).length
        bpy.ops.mesh.primitive_uv_sphere_add(segments=16, ring_count=8, radius=1)
        o = bpy.context.object
        o.scale = (radius[kind], radius[kind], length / 2 + radius[kind] * 0.5)
        o.location = (Vector(hd) + Vector(tl)) / 2
        o.rotation_euler = (Vector(tl) - Vector(hd)).to_track_quat("Z", "Y").to_euler()
        bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
        o.parent, o.parent_type, o.parent_bone = rig, "BONE", n
        bone = rig.data.bones[n]  # bone parenting attaches at the tail, in the bone's own orientation
        o.matrix_parent_inverse = (rig.matrix_world @ bone.matrix_local @ Matrix.Translation((0, bone.length, 0))).inverted()
        parts.append((o, role_of[kind]))
    colours = {"top": NEUTRAL_SHIRT, "bottom": lin("#2E3440"), "shoes": (0.03, 0.03, 0.035), "skin": lin("#C68863")}

    def materials(mask):
        for o, role in parts:
            m_ = None if mask is None else (1 if role == "top" else 0)
            set_mats(o, [mat("part_" + role, colours[role], mask=m_)], None if mask is None else 0)

    return rig, materials, dict(arm=("upperarm", "lowerarm", "wrist"), leg=("upperleg", "lowerleg", "foot"),
                                spine="spine", head="head", root="root")


# ---------------------------------------------------------------- posing + actions
def rot_world(rig, bone, axis, angle):
    pb = rig.pose.bones[bone]
    update()
    a = (rig.matrix_world.to_3x3().inverted() @ Vector(axis)).normalized()
    pb.matrix = Matrix.Translation(pb.head) @ Matrix.Rotation(angle, 4, a) @ Matrix.Translation(-pb.head) @ pb.matrix
    update()


def aim(rig, bone, direction):
    pb = rig.pose.bones[bone]
    update()
    cur = (rig.matrix_world.to_3x3() @ (pb.tail - pb.head)).normalized()
    axis, ang = cur.rotation_difference(Vector(direction).normalized()).to_axis_angle()
    rot_world(rig, bone, axis, ang)


def pose_frame(rig, B, anim, t):
    """t in [0, 1). The character faces -Y; +X is its left; +Z up. Walk is in place."""
    for pb in rig.pose.bones:
        pb.rotation_mode = "QUATERNION"
        pb.matrix_basis = Matrix()
    rig.location = (0, 0, 0)
    up, lo, hand = B["arm"]
    th, sh, ft = B["leg"]
    ph = 2 * math.pi * t
    if anim == "walk":
        for s, sign, off in (("L", 1, 0.0), ("R", -1, math.pi)):
            swing = math.radians(24) * math.sin(ph + off)
            knee = math.radians(8 + 34 * max(0.0, math.sin(ph + off + math.pi / 2)))
            aim(rig, f"{th}.{s}", (sign * 0.03, -math.sin(swing), -math.cos(swing)))
            aim(rig, f"{sh}.{s}", (sign * 0.02, -math.sin(swing - knee), -math.cos(swing - knee)))
            aim(rig, f"{ft}.{s}", (0, -1, -0.15))
            arm_swing = -math.radians(18) * math.sin(ph + off)
            aim(rig, f"{up}.{s}", (sign * 0.14, -math.sin(arm_swing), -math.cos(arm_swing)))
            fa = arm_swing + math.radians(18)
            aim(rig, f"{lo}.{s}", (sign * 0.08, -math.sin(fa), -math.cos(fa)))
        rot_world(rig, B["spine"], (0, 0, 1), math.radians(4) * math.sin(ph))
    else:  # idle: breathing and a slow weight shift
        for s, sign in (("L", 1), ("R", -1)):
            aim(rig, f"{up}.{s}", (sign * (0.15 + 0.015 * math.sin(ph)), 0.0, -1))
            aim(rig, f"{lo}.{s}", (sign * 0.09, -0.12, -1))
        rot_world(rig, B["spine"], (1, 0, 0), math.radians(1.5) * math.sin(ph))
        rot_world(rig, B["spine"], (0, 1, 0), math.radians(2) * math.sin(ph))
        rot_world(rig, B["head"], (0, 0, 1), math.radians(-10 + 4 * math.sin(ph)))
    update()
    foot = min((rig.matrix_world @ rig.pose.bones[f"{ft}.{s}"].tail).z for s in "LR")
    heel = min((rig.matrix_world @ rig.pose.bones[f"{ft}.{s}"].head).z for s in "LR")
    rig.location.z -= min(foot, heel - 0.06)  # keep the lower foot on the floor
    update()


def bake_actions(rig, B):
    for name, a in ANIMS.items():
        for i in range(a["frames"]):
            f = a["start"] + i
            pose_frame(rig, B, name, i / a["frames"])
            for pb in rig.pose.bones:
                pb.keyframe_insert("rotation_quaternion", frame=f)
                pb.keyframe_insert("location", frame=f)
            rig.keyframe_insert("location", frame=f)


# ---------------------------------------------------------------- render
def render_to(path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.context.scene.render.filepath = path
    t = time.perf_counter()
    bpy.ops.render.render(write_still=True)
    return time.perf_counter() - t


def main():
    check_pin()
    setup_scene()
    t0 = time.perf_counter()
    if ARGS.mannequin == "mpfb":
        rig, materials, B = build_mpfb()
    else:
        rig, materials, B = build_basic()
    pivot = bpy.data.objects.new("pivot", None)
    bpy.context.scene.collection.objects.link(pivot)
    rig.parent = pivot
    bake_actions(rig, B)
    LOG["build_seconds"] = round(time.perf_counter() - t0, 2)

    dirs = ["sw"] if ARGS.quick or ARGS.desktop else list(DIRS)
    step = 4 if ARGS.quick or ARGS.desktop else 1
    jobs = [(anim, d, i) for anim, a in ANIMS.items() for d in dirs for i in range(0, a["frames"], step)]
    LOG["frames"] = []
    for layer in ("beauty", "mask"):
        materials(None if layer == "beauty" else 1)
        for anim, d, i in jobs:
            pivot.rotation_euler = (0, 0, math.radians(DIRS[d]))
            bpy.context.scene.frame_set(ANIMS[anim]["start"] + i)
            secs = render_to(os.path.join(OUT, "frames", layer, anim, d, f"frame-{i:03d}.png"))
            LOG["frames"].append(dict(layer=layer, anim=anim, dir=d, frame=i, seconds=round(secs, 3)))
            print(f"FRAME {layer}/{anim}/{d}/{i:03d} {secs:.2f}s", flush=True)
            if "gl" not in LOG and ARGS.engine == "eevee":
                LOG["gl"] = gl_info()
    LOG["gl"] = LOG.get("gl") or gl_info()
    LOG["engine"] = dict(id=bpy.context.scene.render.engine, samples=bpy.context.scene.cycles.samples
                         if ARGS.engine == "cycles" else bpy.context.scene.eevee.taa_render_samples,
                         resolution=[W1 * SCALE, H1 * SCALE])
    LOG["meta"] = dict(frame_1x=[W1, H1], anchor_1x=[AX1, AY1], scale=SCALE, neutral_shirt=NEUTRAL_SHIRT,
                       anims={k: dict(frames=v["frames"], fps=v["fps"]) for k, v in ANIMS.items()}, dirs=list(DIRS))
    LOG["peak_memory_mb"] = peak_memory_mb()
    with open(os.path.join(OUT, "render-log.json"), "w") as f:
        json.dump(LOG, f, indent=1)
    print("DONE", len(LOG["frames"]), "frames, peak", LOG["peak_memory_mb"], "MB", flush=True)


try:
    main()
except Exception:
    import traceback
    traceback.print_exc()
    if not ARGS.desktop:
        sys.exit(1)
finally:
    if ARGS.desktop:  # a GUI session must close itself so pipeline.mjs can carry on
        bpy.ops.wm.quit_blender()
