# Renders one asset into sprite frames for the packer. Run by build.mjs, not by hand:
#   blender -b --factory-startup -P render.py -- --asset <asset dir> --settings <settings.json> --out <dir>
#
# The camera, lights, world, colour management, toon look, palette and outline come from settings.json, so
# every asset looks the same. The asset's .blend only supplies one collection (meshes, at most one armature)
# and its actions. Writes:
#   <out>/frames/beauty/<anim>/<dir>/frame-NNN.png
#   <out>/frames/mask-<mask>/<anim>/<dir>/frame-NNN.png
#   <out>/render-log.json (build, host, GL, seconds per frame, peak memory, and the meta the packer reads)
# Exits 3 on any Blender build but the pinned one, 1 on any other error.
import argparse
import json
import math
import os
import platform
import sys
import time

import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument("--asset", required=True)
ap.add_argument("--settings", required=True)
ap.add_argument("--out", required=True)
ARGS = ap.parse_args(argv)
OUT = os.path.abspath(ARGS.out)
with open(ARGS.settings, encoding="utf8") as f:
    S = json.load(f)
with open(os.path.join(ARGS.asset, "asset.json"), encoding="utf8") as f:
    RENDER = json.load(f)["render"]
MASKS = RENDER.get("masks") or {}
LOG = {"asset": os.path.abspath(ARGS.asset), "errors": [], "frames": []}


class AssetError(Exception):
    pass


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
        import ctypes
        import ctypes.wintypes as wt

        class PMC(ctypes.Structure):
            _fields_ = [("cb", wt.DWORD), ("PageFaultCount", wt.DWORD), ("PeakWorkingSetSize", ctypes.c_size_t),
                        ("WorkingSetSize", ctypes.c_size_t), ("QuotaPeakPagedPoolUsage", ctypes.c_size_t),
                        ("QuotaPagedPoolUsage", ctypes.c_size_t), ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t),
                        ("QuotaNonPagedPoolUsage", ctypes.c_size_t), ("PagefileUsage", ctypes.c_size_t),
                        ("PeakPagefileUsage", ctypes.c_size_t)]
        pmc = PMC()
        pmc.cb = ctypes.sizeof(PMC)
        # Typed explicitly: with the default int types the 64-bit process handle is truncated and the call fails.
        kernel32 = ctypes.WinDLL("kernel32")
        kernel32.GetCurrentProcess.restype = wt.HANDLE
        kernel32.K32GetProcessMemoryInfo.argtypes = [wt.HANDLE, ctypes.POINTER(PMC), wt.DWORD]
        kernel32.K32GetProcessMemoryInfo(kernel32.GetCurrentProcess(), ctypes.byref(pmc), pmc.cb)
        return round(pmc.PeakWorkingSetSize / 2**20, 1)
    import resource
    return round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024, 1)  # Linux: KiB


def check_pin():
    as_str = lambda v: v.decode() if isinstance(v, bytes) else str(v)
    build_hash = as_str(bpy.app.build_hash)
    LOG["blender"] = dict(version=bpy.app.version_string, build_hash=build_hash,
                          build_date=as_str(bpy.app.build_date), python=sys.version.split()[0])
    LOG["host"] = dict(os=platform.platform(), machine=platform.machine(), cpu=cpu_name(), cpu_count=os.cpu_count())
    print("BUILD", json.dumps(LOG["blender"]), json.dumps(LOG["host"]), flush=True)
    # bpy.app.version, not version_string: the official build's version_string is "5.2.2 LTS"
    pin = S["blender"]
    if ".".join(map(str, bpy.app.version)) != pin["version"] or not build_hash.startswith(pin["buildHash"]):
        sys.stderr.write(f"Refusing Blender {bpy.app.version_string} ({build_hash}); "
                         f"the asset pipeline is pinned to {pin['version']} ({pin['buildHash']}).\n")
        sys.exit(3)


def gl_info():
    try:
        import gpu
        return dict(backend=gpu.platform.backend_type_get(), vendor=gpu.platform.vendor_get(),
                    renderer=gpu.platform.renderer_get(), version=gpu.platform.version_get())
    except Exception as e:  # noqa: BLE001 - informational only
        return dict(error=str(e))


# ---------------------------------------------------------------- scene
def lin(hex_colour):
    h = hex_colour.lstrip("#")
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)


def eevee_id():
    items = bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items.keys()
    return "BLENDER_EEVEE_NEXT" if "BLENDER_EEVEE_NEXT" in items else "BLENDER_EEVEE"


def setup_scene():
    sc = bpy.context.scene
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    w1, h1 = S["frame"]["size"]
    ax1, ay1 = S["frame"]["anchor"]
    scale = S["frame"]["scale"]
    cm = S["colourManagement"]

    r = sc.render
    r.engine = eevee_id()
    r.resolution_x, r.resolution_y, r.resolution_percentage = w1 * scale, h1 * scale, 100
    r.film_transparent = cm["filmTransparent"]
    r.filter_size = cm["filterSize"]
    r.image_settings.file_format = "PNG"
    r.image_settings.color_mode = "RGBA"
    r.image_settings.color_depth = "8"
    r.use_persistent_data = True
    sc.view_settings.view_transform = cm["viewTransform"]
    sc.view_settings.look = cm["look"]
    sc.view_settings.exposure = cm["exposure"]
    sc.view_settings.gamma = cm["gamma"]
    sc.display_settings.display_device = cm["displayDevice"]
    ee = sc.eevee
    ee.taa_render_samples = S["eevee"]["taaRenderSamples"]
    for attr, key in [("use_gtao", "useGtao"), ("use_soft_shadows", "useSoftShadows"), ("use_shadows", "useShadows")]:
        if hasattr(ee, attr):
            setattr(ee, attr, S["eevee"][key])

    world = bpy.data.worlds.new("world")
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    bg.inputs[0].default_value = (*S["world"]["color"], 1)
    bg.inputs[1].default_value = S["world"]["strength"]
    sc.world = world

    # Orthographic, so one tile is always tilePixels[0] wide; the shift puts the anchor on the world origin.
    cam_data = bpy.data.cameras.new("camera")
    cam_data.type = "ORTHO"
    cam_data.sensor_fit = "VERTICAL"
    cam_data.ortho_scale = h1 / (S["frame"]["tilePixels"][0] / S["frame"]["tileMeters"])
    cam_data.shift_y = (h1 / 2 - (h1 - ay1)) / h1
    cam_data.shift_x = (w1 / 2 - ax1) / h1
    cam_data.clip_end = S["camera"]["clipEnd"]
    cam = bpy.data.objects.new("camera", cam_data)
    cam.rotation_euler = [math.radians(a) for a in S["camera"]["rotation"]]
    cam.location = cam.rotation_euler.to_matrix() @ Vector((0, 0, 1)) * S["camera"]["distance"]
    sc.collection.objects.link(cam)
    sc.camera = cam

    sun_data = bpy.data.lights.new("sun", "SUN")
    sun_data.energy = S["sun"]["energy"]
    sun_data.angle = math.radians(S["sun"]["angle"])
    sun = bpy.data.objects.new("sun", sun_data)
    sun.rotation_euler = Vector(S["sun"]["direction"]).to_track_quat("Z", "Y").to_euler()
    sc.collection.objects.link(sun)


# ---------------------------------------------------------------- materials (toon look from phase-3-scene 01)
_MATS = {}


def toon(name, colour, alpha_image=None):
    """Diffuse through Shader to RGB into a two-step constant ramp, times the colour, as emission."""
    key = ("toon", name, colour, alpha_image)
    if key in _MATS:
        return _MATS[key]
    m = bpy.data.materials.new(f"toon-{name}")
    m.use_nodes = True
    nt, links = m.node_tree, m.node_tree.links
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    diffuse = nt.nodes.new("ShaderNodeBsdfDiffuse")
    s2r = nt.nodes.new("ShaderNodeShaderToRGB")
    bw = nt.nodes.new("ShaderNodeRGBToBW")
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.interpolation = "CONSTANT"
    stops = S["toonRamp"]
    while len(ramp.color_ramp.elements) < len(stops):
        ramp.color_ramp.elements.new(1.0)
    for element, stop in zip(ramp.color_ramp.elements, stops):
        element.position, element.color = stop["position"], (*stop["color"], 1)
    mul = nt.nodes.new("ShaderNodeMix")
    mul.data_type, mul.blend_type = "RGBA", "MULTIPLY"
    mul.inputs["Factor"].default_value = 1.0
    mul.inputs[7].default_value = (*colour, 1)
    em = nt.nodes.new("ShaderNodeEmission")
    links.new(diffuse.outputs[0], s2r.inputs[0])
    links.new(s2r.outputs[0], bw.inputs[0])
    links.new(bw.outputs[0], ramp.inputs[0])
    links.new(ramp.outputs[0], mul.inputs[6])
    links.new(mul.outputs[2], em.inputs[0])
    _MATS[key] = with_alpha(m, em.outputs[0], alpha_image)
    return _MATS[key]


def flat(value, alpha_image=None):
    """Mask pass: flat emission, 1 for the mask's materials and 0 for everything else."""
    key = ("flat", value, alpha_image)
    if key in _MATS:
        return _MATS[key]
    m = bpy.data.materials.new(f"mask-{value}")
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    nt.nodes.new("ShaderNodeOutputMaterial")
    em = nt.nodes.new("ShaderNodeEmission")
    em.inputs[0].default_value = (value, value, value, 1)
    _MATS[key] = with_alpha(m, em.outputs[0], alpha_image)
    return _MATS[key]


def with_alpha(m, shader, image):
    """Keeps an authored alpha texture (hair cards, brows) when a material is replaced."""
    nt, links = m.node_tree, m.node_tree.links
    out = next(n for n in nt.nodes if n.type == "OUTPUT_MATERIAL")
    if image:
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.image = image
        transparent = nt.nodes.new("ShaderNodeBsdfTransparent")
        mix = nt.nodes.new("ShaderNodeMixShader")
        links.new(tex.outputs["Alpha"], mix.inputs[0])
        links.new(transparent.outputs[0], mix.inputs[1])
        links.new(shader, mix.inputs[2])
        shader = mix.outputs[0]
        if hasattr(m, "blend_method"):
            m.blend_method = "HASHED"
    links.new(shader, out.inputs[0])
    return m


def ink(mask_pass):
    """Inverted-hull outline: the shell's front faces show as ink, its back faces are transparent."""
    key = ("ink", mask_pass)
    if key in _MATS:
        return _MATS[key]
    m = bpy.data.materials.new("ink")
    m.use_nodes = True
    nt, links = m.node_tree, m.node_tree.links
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    em = nt.nodes.new("ShaderNodeEmission")
    em.inputs[0].default_value = (0, 0, 0, 1) if mask_pass else (*lin(S["palette"]["ink"]), 1)
    transparent = nt.nodes.new("ShaderNodeBsdfTransparent")
    geo = nt.nodes.new("ShaderNodeNewGeometry")
    mix = nt.nodes.new("ShaderNodeMixShader")
    links.new(geo.outputs["Backfacing"], mix.inputs[0])
    links.new(em.outputs[0], mix.inputs[1])
    links.new(transparent.outputs[0], mix.inputs[2])
    links.new(mix.outputs[0], out.inputs[0])
    if hasattr(m, "blend_method"):
        m.blend_method = "HASHED"
    _MATS[key] = m
    return m


def alpha_image(material):
    if not material or not material.use_nodes:
        return None
    return next((n.image for n in material.node_tree.nodes if n.type == "TEX_IMAGE" and n.image), None)


class Slots:
    """The authored materials of every mesh, swapped per layer by slot so polygon material indices survive."""

    def __init__(self, meshes):
        self.authored = {}
        self.outlined = []
        for o in meshes:
            self.authored[o] = [s.material for s in o.material_slots]
            if o.get("agentarium_outline", True):
                o.data.materials.append(ink(False))
                mod = o.modifiers.new("agentarium-outline", "SOLIDIFY")
                mod.thickness = S["outline"]["thickness"] / max(o.matrix_world.to_scale())
                mod.offset = 1.0
                mod.use_flip_normals = True
                mod.use_rim = False
                mod.material_offset = len(o.data.materials) - 1  # Blender clamps to the last slot, the ink
                self.outlined.append(o)

    def apply(self, mask=None):
        """mask None is the beauty layer; otherwise the mask's materials are 1 and everything else 0."""
        masked = set(MASKS[mask]) if mask else set().union(*MASKS.values())
        palette = S["palette"]
        for o, materials in self.authored.items():
            for slot, m in zip(o.material_slots, materials):
                name = m.name if m else ""
                if mask:
                    slot.material = flat(1.0 if name in masked else 0.0, alpha_image(m))
                elif name in masked:
                    # Tintable parts render in the neutral tint colour; the packer divides it back out.
                    slot.material = toon("tint", lin(palette["tint"]), alpha_image(m))
                elif name in palette:
                    slot.material = toon(name, lin(palette[name]), alpha_image(m))
                else:
                    slot.material = m
            if o in self.outlined:
                o.material_slots[len(materials)].material = ink(mask is not None)


# ---------------------------------------------------------------- asset
def append_asset():
    blend = os.path.join(ARGS.asset, RENDER["blend"])
    name = RENDER.get("collection", "asset")
    wanted = sorted({a["action"] for a in (RENDER.get("animations") or {}).values()})
    with bpy.data.libraries.load(blend, link=False) as (src, dst):
        if name not in src.collections:
            raise AssetError(f"{blend}: no collection named {name}")
        missing = [a for a in wanted if a not in src.actions]
        if missing:
            raise AssetError(f"{blend}: no action named {', '.join(missing)}")
        dst.collections = [name]
        dst.actions = list(wanted)  # load() swaps the names in this list for datablocks
    collection = dst.collections[0]
    bpy.context.scene.collection.children.link(collection)
    objects = list(collection.all_objects)
    staged = [o.name for o in objects if o.type in ("LIGHT", "CAMERA")]
    if staged:
        raise AssetError(f"{blend}: the pipeline sets camera and lights; remove {', '.join(staged)} from {name}")
    armatures = [o for o in objects if o.type == "ARMATURE"]
    if RENDER.get("animations") and len(armatures) != 1:
        raise AssetError(f"{blend}: an animated asset needs exactly one armature in {name}, found {len(armatures)}")
    pivot = bpy.data.objects.new("pivot", None)
    bpy.context.scene.collection.objects.link(pivot)
    for o in objects:
        if o.parent is None:
            o.parent = pivot
    actions = {a: bpy.data.actions[a] for a in wanted}
    return pivot, (armatures[0] if armatures else None), [o for o in objects if o.type == "MESH"], actions


def frames_of(action):
    """Every integer frame of the action; a cyclic action's last frame repeats its first, so it is dropped."""
    start, end = (int(round(v)) for v in action.frame_range)
    return list(range(start, end if action.use_cyclic else end + 1))


def use_action(armature, action):
    ad = armature.animation_data or armature.animation_data_create()
    ad.action = action
    # Blender 5 layered actions: assigning picks a matching slot; fall back to the first one.
    if getattr(action, "slots", None) and getattr(ad, "action_slot", None) is None:
        ad.action_slot = action.slots[0]


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
    pivot, armature, meshes, actions = append_asset()
    slots = Slots(meshes)

    animations = RENDER.get("animations") or {}
    plan = {name: (actions[a["action"]], frames_of(actions[a["action"]]), a["fps"]) for name, a in animations.items()}
    if not plan:
        plan = {"still": (None, [bpy.context.scene.frame_current], 1)}
    for name, (_, frames, _) in plan.items():
        if not frames:
            raise AssetError(f"animation {name} has no frames")

    dirs = S["directions"]
    for mask in [None, *MASKS]:
        layer = "beauty" if mask is None else f"mask-{mask}"
        slots.apply(mask)
        for anim, (action, frames, _) in plan.items():
            if action:
                use_action(armature, action)
            for d, degrees in dirs.items():
                pivot.rotation_euler = (0, 0, math.radians(degrees))
                for i, frame in enumerate(frames):
                    bpy.context.scene.frame_set(frame)
                    secs = render_to(os.path.join(OUT, "frames", layer, anim, d, f"frame-{i:03d}.png"))
                    LOG["frames"].append(dict(layer=layer, anim=anim, dir=d, frame=i, seconds=round(secs, 3)))
                    print(f"FRAME {layer}/{anim}/{d}/{i:03d} {secs:.2f}s", flush=True)
                    if "gl" not in LOG:
                        LOG["gl"] = gl_info()

    w1, h1 = S["frame"]["size"]
    LOG["engine"] = dict(id=bpy.context.scene.render.engine, samples=bpy.context.scene.eevee.taa_render_samples,
                         resolution=[w1 * S["frame"]["scale"], h1 * S["frame"]["scale"]])
    LOG["meta"] = dict(frame_1x=S["frame"]["size"], anchor_1x=S["frame"]["anchor"], scale=S["frame"]["scale"],
                       neutral_tint=list(lin(S["palette"]["tint"])),
                       animations={k: dict(frames=len(v[1]), fps=v[2]) for k, v in plan.items()},
                       dirs=list(dirs), masks=list(MASKS))
    LOG["peak_memory_mb"] = peak_memory_mb()
    with open(os.path.join(OUT, "render-log.json"), "w", encoding="utf8") as f:
        json.dump(LOG, f, indent=1)
    print("DONE", len(LOG["frames"]), "frames, peak", LOG["peak_memory_mb"], "MB", flush=True)


try:
    os.makedirs(OUT, exist_ok=True)
    main()
except AssetError as e:
    sys.stderr.write(f"Error: {e}\n")
    sys.exit(1)
except Exception:
    import traceback
    traceback.print_exc()
    sys.exit(1)
