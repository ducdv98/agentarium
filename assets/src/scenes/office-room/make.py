# Builds office-room.blend from scratch. Run by hand or by make.mjs:
#   blender -b --factory-startup -P make.py -- --out <office-room.blend> --settings <settings.json>
#
# Every part is our own geometry made here from boxes, cylinders and spheres; no third-party mesh is used.
# The saved file follows the .blend contract in assets/README.md: collection "asset" holds one child collection
# per part listed in asset.json render.parts. Each part sits on one 1 m tile centred on the origin, with its front
# (the side an Agent uses it from) towards -Y, screen south-west. Materials are named after palette entries in
# settings.json, so the pipeline renders them in the shared toon look. layout.json places the parts in the room.
# Exits 3 on any Blender build but the pinned one, 1 on any error.
import argparse
import json
import math
import random
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument("--out", required=True)
ap.add_argument("--settings", required=True)
ARGS, _ = ap.parse_known_args(argv)  # make.mjs also passes source paths this room does not use
with open(ARGS.settings, encoding="utf8") as f:
    S = json.load(f)

WALL_HEIGHT = 2.2
OVERLAP = 1.02  # floor and wall pieces overlap their neighbours by about a pixel, so no seam shows


def check_pin():
    as_str = lambda v: v.decode() if isinstance(v, bytes) else str(v)
    pin = S["blender"]
    if ".".join(map(str, bpy.app.version)) != pin["version"] or not as_str(bpy.app.build_hash).startswith(pin["buildHash"]):
        sys.stderr.write(f"Refusing Blender {bpy.app.version_string}; the asset pipeline is pinned to {pin['version']}.\n")
        sys.exit(3)


# ---------------------------------------------------------------- building blocks
ROOT = None
PART = None


def part(name):
    global PART
    PART = bpy.data.collections.new(name)
    ROOT.children.link(PART)


def material(name):
    if name == GLASS:
        return glass()
    if name not in S["palette"]:
        raise ValueError(f"{name} is not a palette colour")
    return bpy.data.materials.get(name) or bpy.data.materials.new(name)


GLASS = "see-through-glass"


def glass():
    """Not a palette name, so the pipeline renders it as authored: a flat tint that lets 70 % of what is behind
    show through, so an Agent behind or inside the meeting room stays visible."""
    m = bpy.data.materials.get(GLASS)
    if m:
        return m
    m = bpy.data.materials.new(GLASS)
    m.use_nodes = True
    nt, links = m.node_tree, m.node_tree.links
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    tint = nt.nodes.new("ShaderNodeEmission")
    h = S["palette"]["glass"].lstrip("#")
    srgb = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    tint.inputs[0].default_value = (*(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in srgb), 1)
    clear = nt.nodes.new("ShaderNodeBsdfTransparent")
    mix = nt.nodes.new("ShaderNodeMixShader")
    mix.inputs[0].default_value = 0.3
    links.new(clear.outputs[0], mix.inputs[1])
    links.new(tint.outputs[0], mix.inputs[2])
    links.new(mix.outputs[0], out.inputs[0])
    if hasattr(m, "surface_render_method"):
        m.surface_render_method = "BLENDED"
    elif hasattr(m, "blend_method"):
        m.blend_method = "BLEND"
    return m


def add(name, bm, mat, outline, smooth=False):
    for face in bm.faces:
        face.smooth = smooth
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    mesh.materials.append(material(mat))
    o = bpy.data.objects.new(f"{PART.name}.{name}", mesh)
    o["agentarium_outline"] = outline
    PART.objects.link(o)
    return o


def box(name, size, at, mat, outline=True, z_rot=0.0):
    """size (x, y, z) in metres; at (x, y, bottom z)."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    m = (Matrix.Translation((at[0], at[1], at[2] + size[2] / 2)) @ Matrix.Rotation(z_rot, 4, "Z")
         @ Matrix.Diagonal((*size, 1)))
    bmesh.ops.transform(bm, matrix=m, verts=bm.verts)
    return add(name, bm, mat, outline)


def cylinder(name, radius, height, at, mat, outline=True, top=None, segments=20):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=segments, radius1=radius,
                          radius2=radius if top is None else top, depth=height)
    bmesh.ops.translate(bm, vec=Vector((at[0], at[1], at[2] + height / 2)), verts=bm.verts)
    return add(name, bm, mat, outline, smooth=True)


def ball(name, radius, centre, mat, outline=True):
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=3, radius=radius)
    bmesh.ops.translate(bm, vec=Vector(centre), verts=bm.verts)
    return add(name, bm, mat, outline, smooth=True)


# ---------------------------------------------------------------- floors and walls
def floor(name, mat):
    part(name)
    box("tile", (OVERLAP, OVERLAP, 0.02), (0, 0, -0.02), mat, outline=False)


def wall_trim():
    box("skirting", (OVERLAP, 0.02, 0.1), (0, 0.39, 0), "trim", outline=False)
    box("cap", (OVERLAP, 0.12, 0.04), (0, 0.45, WALL_HEIGHT), "trim", outline=False)


def wall():
    """Stands on the tile's north-east edge (+Y) and faces south-west; layout facing turns it to other edges."""
    part("wall")
    box("wall", (OVERLAP, 0.1, WALL_HEIGHT), (0, 0.45, 0), "wall", outline=False)
    wall_trim()


def wall_window():
    part("wall-window")
    sill, lintel, half = 0.9, 1.7, 0.3
    box("below", (OVERLAP, 0.1, sill), (0, 0.45, 0), "wall", outline=False)
    box("above", (OVERLAP, 0.1, WALL_HEIGHT - lintel), (0, 0.45, lintel), "wall", outline=False)
    side = (OVERLAP / 2 - half)
    for x in (-1, 1):
        box(f"side{x}", (side, 0.1, lintel - sill), (x * (half + side / 2), 0.45, sill), "wall", outline=False)
    box("glass", (2 * half, 0.02, lintel - sill), (0, 0.46, sill), "glass", outline=False)
    box("mullion", (0.03, 0.03, lintel - sill), (0, 0.44, sill), "trim", outline=False)
    box("transom", (2 * half, 0.03, 0.03), (0, 0.44, 1.38), "trim", outline=False)
    box("sill", (2 * half + 0.1, 0.14, 0.04), (0, 0.39, sill - 0.02), "trim", outline=False)
    wall_trim()


def glass_partition():
    """A glass office partition on the tile's north-east edge (+Y), like a wall, 2 m tall on a low base."""
    part("glass-partition")
    box("base", (1.0, 0.08, 0.12), (0, 0.46, 0), "trim", outline=False)
    box("pane", (1.0, 0.02, 1.84), (0, 0.46, 0.12), GLASS, outline=False)
    box("rail", (1.0, 0.06, 0.04), (0, 0.46, 1.96), "metal", outline=False)
    box("handrail", (1.0, 0.03, 0.02), (0, 0.45, 0.95), "metal", outline=False)
    for x in (-0.49, 0.49):
        box(f"post{x}", (0.04, 0.07, 2.0), (x, 0.46, 0), "metal", outline=False)


# ---------------------------------------------------------------- furniture (front towards -Y)
def desk_frame(depth, y):
    box("top", (0.96, depth, 0.04), (0, y, 0.71), "wood")
    for x in (-0.44, 0.44):
        box(f"panel{x}", (0.04, depth - 0.06, 0.71), (x, y, 0), "dark")
    box("modesty", (0.84, 0.03, 0.4), (0, y + depth / 2 - 0.06, 0.3), "dark")


def desk():
    part("desk")
    desk_frame(0.7, -0.12)
    box("monitor", (0.56, 0.04, 0.34), (0, 0.08, 0.87), "dark")
    box("screen", (0.5, 0.01, 0.28), (0, 0.055, 0.9), "screen", outline=False)
    box("neck", (0.05, 0.04, 0.13), (0, 0.11, 0.75), "dark", outline=False)
    box("foot", (0.22, 0.14, 0.015), (0, 0.1, 0.75), "dark", outline=False)
    box("keyboard", (0.42, 0.14, 0.02), (0, -0.2, 0.75), "dark", outline=False)
    box("mouse", (0.05, 0.08, 0.02), (0.3, -0.2, 0.75), "dark", outline=False)
    cylinder("mug", 0.035, 0.09, (-0.34, -0.12, 0.75), "paper", outline=False)


def chair():
    """The sitter faces -Y; the backrest is on +Y."""
    part("chair")
    box("seat", (0.46, 0.46, 0.08), (0, 0, 0.44), "fabric")
    box("back", (0.44, 0.07, 0.46), (0, 0.21, 0.56), "fabric")
    box("spine", (0.05, 0.04, 0.14), (0, 0.22, 0.44), "metal", outline=False)
    cylinder("lift", 0.03, 0.32, (0, 0, 0.12), "metal")
    for i in range(5):
        a = i * 2 * math.pi / 5
        out = Vector((-math.sin(a), math.cos(a), 0))  # +Y turned by a
        box(f"leg{i}", (0.05, 0.26, 0.04), (*(out * 0.13).xy, 0.08), "metal", z_rot=a)
        cylinder(f"wheel{i}", 0.03, 0.06, (*(out * 0.24).xy, 0), "dark", outline=False, segments=10)


def bookshelf():
    part("bookshelf")
    y, depth, height = 0.31, 0.34, 1.8
    for x in (-0.435, 0.435):
        box(f"side{x}", (0.03, depth, height), (x, y, 0), "wood")
    box("back", (0.9, 0.02, height), (0, 0.47, 0), "wood")
    shelves = (0, 0.45, 0.9, 1.35, height - 0.03)
    for i, z in enumerate(shelves):
        box(f"shelf{i}", (0.84, depth - 0.02, 0.03), (0, y, z), "wood")
    rng = random.Random(9)
    colours = ("book-a", "book-b", "book-c", "paper", "fabric", "book-a", "dark")
    for level, z in enumerate(shelves[:-1]):
        x = -0.4
        while x < 0.36:
            width, tall = rng.uniform(0.035, 0.07), rng.uniform(0.22, 0.34)
            if rng.random() < 0.12:
                x += width  # a gap
                continue
            box(f"book{level}-{x:.2f}", (width, 0.24, tall), (x + width / 2, 0.32, z + 0.03), rng.choice(colours),
                outline=False)
            x += width + 0.004


def server_rack():
    part("server-rack")
    box("body", (0.62, 0.7, 1.9), (0, 0.12, 0), "dark")
    for i in range(11):
        z = 0.14 + i * 0.15
        box(f"unit{i}", (0.52, 0.02, 0.11), (0, -0.235, z), "metal" if i % 3 else "dark", outline=False)
        for j in range(1 + i % 3):
            box(f"led{i}-{j}", (0.025, 0.01, 0.02), (0.2 - j * 0.04, -0.25, z + 0.045), "led", outline=False)


def filing_cabinet():
    part("filing-cabinet")
    box("body", (0.5, 0.6, 1.32), (0, 0.18, 0), "dark")
    for i in range(4):
        z = 0.03 + i * 0.32
        box(f"drawer{i}", (0.46, 0.02, 0.29), (0, -0.13, z), "metal", outline=False)
        box(f"handle{i}", (0.14, 0.02, 0.025), (0, -0.145, z + 0.2), "dark", outline=False)
        box(f"label{i}", (0.08, 0.005, 0.04), (0, -0.142, z + 0.24), "paper", outline=False)


def comms_desk():
    part("comms-desk")
    desk_frame(0.6, -0.1)
    box("router", (0.3, 0.18, 0.05), (-0.2, 0.06, 0.75), "dark")
    for x in (-0.32, -0.08):
        cylinder(f"antenna{x}", 0.008, 0.2, (x, 0.13, 0.8), "dark", outline=False, segments=8)
    for i in range(4):
        box(f"led{i}", (0.02, 0.01, 0.015), (-0.29 + i * 0.05, -0.035, 0.775), "led", outline=False)
    box("phone", (0.18, 0.2, 0.06), (0.18, -0.08, 0.75), "dark")
    box("handset", (0.2, 0.05, 0.04), (0.18, -0.04, 0.81), "dark", outline=False)
    cylinder("globe-stand", 0.02, 0.1, (0.3, 0.14, 0.75), "metal", outline=False)
    ball("globe", 0.1, (0.3, 0.14, 0.95), "water")


def table():
    part("table")
    box("top", (0.98, 0.98, 0.05), (0, 0, 0.71), "wood")
    cylinder("pedestal", 0.06, 0.71, (0, 0, 0), "dark")
    cylinder("foot", 0.26, 0.03, (0, 0, 0), "dark")


def whiteboard():
    part("whiteboard")
    y = 0.1
    box("board", (0.94, 0.03, 0.68), (0, y, 0.95), "paper")
    for z in (0.92, 1.63):
        box(f"rail{z}", (0.98, 0.04, 0.03), (0, y, z), "metal", outline=False)
    for x in (-0.47, 0.47):
        box(f"leg{x}", (0.03, 0.03, 1.66), (x, y, 0), "metal")
        box(f"foot{x}", (0.04, 0.5, 0.03), (x, y, 0), "metal")
    box("tray", (0.6, 0.06, 0.02), (0, y - 0.04, 0.93), "metal", outline=False)
    marks = [(-0.3, 1.5, 0.3, "book-b"), (-0.3, 1.45, 0.2, "book-b"), (0.15, 1.5, 0.25, "book-a"),
             (-0.32, 1.25, 0.1, "fabric"), (-0.12, 1.25, 0.1, "fabric"), (0.08, 1.25, 0.1, "fabric"),
             (-0.2, 1.08, 0.5, "book-c")]
    for i, (x, z, width, colour) in enumerate(marks):
        box(f"mark{i}", (width, 0.005, 0.018), (x + width / 2, y - 0.017, z), colour, outline=False)
    box("box-a", (0.12, 0.005, 0.08), (-0.26, y - 0.017, 1.21), "fabric", outline=False)


def water_cooler():
    part("water-cooler")
    box("cabinet", (0.32, 0.32, 0.95), (0, 0.15, 0), "paper")
    box("tray", (0.2, 0.08, 0.02), (0, -0.03, 0.6), "dark", outline=False)
    box("hot", (0.04, 0.04, 0.05), (-0.06, -0.02, 0.76), "error", outline=False)
    box("cold", (0.04, 0.04, 0.05), (0.06, -0.02, 0.76), "fabric", outline=False)
    cylinder("neck", 0.05, 0.05, (0, 0.15, 0.95), "water", outline=False)
    cylinder("bottle", 0.14, 0.42, (0, 0.15, 1.0), "water")
    cylinder("cups", 0.035, 0.14, (0.24, 0.15, 0), "paper", top=0.045)


def printer():
    part("printer")
    box("stand", (0.62, 0.55, 0.55), (0, 0.12, 0), "wood")
    box("body", (0.56, 0.46, 0.3), (0, 0.12, 0.55), "metal")
    box("lid", (0.5, 0.4, 0.05), (0, 0.14, 0.85), "wall")
    box("tray", (0.36, 0.14, 0.02), (0, -0.17, 0.7), "dark", outline=False)
    box("printout", (0.28, 0.2, 0.012), (0, -0.16, 0.72), "paper", outline=False)
    box("panel", (0.14, 0.02, 0.07), (0.18, -0.115, 0.76), "dark", outline=False)
    box("fault", (0.035, 0.01, 0.03), (0.2, -0.127, 0.78), "error", outline=False)
    # It is the error Station: the printer has jammed and dropped its pages.
    box("sheet-a", (0.21, 0.29, 0.004), (-0.24, -0.33, 0), "paper", outline=False, z_rot=0.4)
    box("sheet-b", (0.21, 0.29, 0.004), (0.22, -0.38, 0.004), "paper", outline=False, z_rot=-0.25)
    box("sheet-c", (0.21, 0.29, 0.004), (0.02, -0.4, 0), "paper", outline=False, z_rot=1.2)


def sofa():
    """The sitter faces -Y; the backrest is on +Y."""
    part("sofa")
    box("base", (0.96, 0.8, 0.26), (0, 0.02, 0.07), "fabric")
    box("back", (0.96, 0.2, 0.46), (0, 0.32, 0.33), "fabric")
    for x in (-0.42, 0.42):
        box(f"arm{x}", (0.12, 0.8, 0.22), (x, 0.02, 0.33), "fabric")
    box("seat", (0.72, 0.58, 0.1), (0, -0.07, 0.33), "cushion")
    box("cushion", (0.72, 0.1, 0.32), (0, 0.17, 0.43), "cushion")
    for x in (-0.42, 0.42):
        for y in (-0.33, 0.37):
            box(f"foot{x}{y}", (0.05, 0.05, 0.07), (x, y, 0), "dark", outline=False)


def coffee_table():
    part("coffee-table")
    box("top", (0.7, 0.7, 0.04), (0, 0, 0.38), "wood")
    for x in (-0.3, 0.3):
        for y in (-0.3, 0.3):
            box(f"leg{x}{y}", (0.04, 0.04, 0.38), (x, y, 0), "dark", outline=False)
    cylinder("mug", 0.04, 0.09, (0.14, -0.08, 0.42), "paper", outline=False)
    box("magazine", (0.2, 0.26, 0.01), (-0.12, 0.08, 0.42), "book-b", outline=False, z_rot=0.3)


def plant():
    part("plant")
    cylinder("pot", 0.13, 0.32, (0, 0, 0), "pot", top=0.17)
    for i, (x, y, z, r) in enumerate([(0, 0, 0.58, 0.2), (0.1, 0.08, 0.74, 0.16), (-0.09, -0.05, 0.82, 0.14),
                                      (0.05, -0.1, 0.92, 0.1)]):
        ball(f"leaves{i}", r, (x, y, z), "plant")


BUILDERS = {
    "floor": lambda: floor("floor", "floor"),
    "floor-alt": lambda: floor("floor-alt", "floor-alt"),
    "carpet": lambda: floor("carpet", "carpet"),
    "floor-wood": lambda: floor("floor-wood", "floor-wood"),
    "wall": wall,
    "wall-window": wall_window,
    "glass-partition": glass_partition,
    "desk": desk,
    "chair": chair,
    "bookshelf": bookshelf,
    "server-rack": server_rack,
    "filing-cabinet": filing_cabinet,
    "comms-desk": comms_desk,
    "table": table,
    "whiteboard": whiteboard,
    "water-cooler": water_cooler,
    "printer": printer,
    "sofa": sofa,
    "coffee-table": coffee_table,
    "plant": plant,
}


def main():
    global ROOT
    check_pin()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    ROOT = bpy.data.collections.new("asset")
    bpy.context.scene.collection.children.link(ROOT)
    with open(__file__.replace("make.py", "asset.json"), encoding="utf8") as f:
        parts = json.load(f)["render"]["parts"]
    missing = sorted(set(parts) - set(BUILDERS))
    if missing:
        raise ValueError(f"asset.json lists parts make.py cannot build: {', '.join(missing)}")
    for name in parts:
        BUILDERS[name]()
    bpy.ops.wm.save_as_mainfile(filepath=ARGS.out, compress=True)
    print("SAVED", ARGS.out, len(parts), "parts", flush=True)


try:
    main()
except Exception:
    import traceback
    traceback.print_exc()
    sys.exit(1)
