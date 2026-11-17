"""Atlas Command Center, Floor 4: the agent office floor, built in Blender (Khaneil, 2026-11-17).

Reproducible: this script is the source. It rebuilds the editable .blend and the GLB the app
loads from nothing, so a design change is made here and both files are rebuilt together:

    npm run model:command-center-floor

(Blender from /Applications, or set BLENDER to its binary; Blender's Python module `bpy` also
runs it: `python assets/command-center-office/build_office_floor.py`.) Hand edits in the .blend
are overwritten by the next build. build.json records a fingerprint of the three files, and
src/views/office/commandCenterFloorPlan.test.ts fails when they drift apart.

What is in the model, and what is not:
- Static architecture and furniture only: the service core with its service lift, the glass
  meeting room, the lounge, storage, planting and the carpet under the desks.
- One workstation kit (desk with privacy screen, ergonomic chair, monitor housing) that Atlas
  places at every desk it plans. Desk places stay Atlas's (planOffice), never the model's.
- No agents, labels, screens' content, status lights or anything live: Atlas draws those.

Units are metres in Atlas's office axes: x across, y up, z toward the open front (+z is the
glass door to the lift landing). They are converted to Blender's z-up on the way in, and the glTF
exporter turns them back. The plan matches the Command Center floor plate on main
(src/views/office/atlasHqInteriorPlan.ts: shellAxes of the office plan, roundness 4.2): the test
reads the GLB's numbers and checks them against the app.
"""

import hashlib
import json
import math
import os
import sys

import bpy  # first: Blender's Python module provides bmesh once bpy is loaded
import bmesh

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, "..", ".."))
BLEND = os.path.join(HERE, "command-center-floor4.blend")
GLB = os.path.join(ROOT, "public", "models", "office", "command-center-floor4.glb")
STAMP = os.path.join(HERE, "build.json")
# Optional: OUT_DIR=/some/folder writes the .blend and GLB there instead (used to show the model
# in a running Blender without touching the repository), and skips the stamp.
OUT_DIR = os.environ.get("OUT_DIR")
if OUT_DIR:
    BLEND, GLB, STAMP = os.path.join(OUT_DIR, os.path.basename(BLEND)), os.path.join(OUT_DIR, os.path.basename(GLB)), None
# RENDER=path.png also renders the preview camera there (Cycles, CPU).
RENDER = os.environ.get("RENDER")

# ---------------------------------------------------------------------------------------- plan

# The office plan Atlas lays out for the Command Center (planOffice: 3 desks a row, four rows)
# and the floor plate's curtain wall around it (shellAxes: half widths A x B, roundness N).
PLAN_W, PLAN_D = 10.65, 14.2
SHELL_A, SHELL_B, SHELL_N = 6.4625, 7.7, 4.2
STOREY = 2.7
FLOOR = 4

# Where Atlas's desks may stand (desk and chair of every planned workstation): the carpet.
DESK_ZONE = dict(x0=-3.75, x1=3.75, z0=-4.35, z1=5.4)
# Rooms and furniture, as Atlas x/z boxes. Desks are kept out of all of them (the test checks).
CORE = dict(x0=-4.9, x1=-2.0, z0=-6.9, z1=-4.6)
MEETING = dict(x0=1.9, x1=4.9, z0=-6.85, z1=-4.6)
LOUNGE = dict(x0=4.05, x1=5.95, z0=-2.3, z1=2.7)
STORAGE = dict(x0=-5.95, x1=-5.4, z0=-3.2, z1=2.6)
PLANTERS = [dict(x0=-4.7, x1=-1.7, z0=6.05, z1=6.55), dict(x0=1.7, x1=4.7, z0=6.05, z1=6.55)]
POTS = [(-5.35, -4.05, 0.95), (5.55, 3.55, 1.05), (-5.15, 4.55, 0.85), (5.45, -3.15, 0.9), (1.45, -5.35, 0.7), (5.4, -4.35, 0.8), (-5.5, 3.25, 0.7)]

# Preview only (never exported): the desks Atlas plans on Floor 4 today, so the Blender preview
# shows the floor furnished. Atlas places the kit from its own plan, not from this list.
PREVIEW_DESKS = [(-2.35, -3.45), (0, -3.45), (2.35, -3.45), (0, -0.95), (-1.175, 1.55), (1.175, 1.55), (-2.35, 4.05), (0, 4.05)]

# The kit's anchors, in the desk's own frame (desk centre on the floor, facing -z, chair at +z).
# They are where Atlas draws its live parts; OfficeScene's AgentWorkstation uses the same numbers.
ANCHORS = {
    "anchor_screen": (0, 1.18, -0.198),
    "anchor_label": (0, 1.6, -0.22),
    "anchor_lamp": (0.6, 0.79, -0.24),
    "anchor_seat": (0, 0.46, 0.66),
    "anchor_select": (0, 0.02, 0.3),
}

PALETTE = {
    # name: (colour, roughness, metallic, alpha)
    "cc4_cream": ("#ece4d2", 0.8, 0.0, 1.0),
    "cc4_stone": ("#e2d9c6", 0.7, 0.0, 1.0),
    "cc4_wood": ("#b4875a", 0.55, 0.0, 1.0),
    "cc4_green": ("#3f6852", 0.85, 0.0, 1.0),
    "cc4_velvet": ("#4d8061", 0.9, 0.0, 1.0),
    "cc4_brass": ("#b8955a", 0.35, 0.7, 1.0),
    "cc4_carpet": ("#9b998f", 1.0, 0.0, 1.0),
    "cc4_dark": ("#262c29", 0.45, 0.25, 1.0),
    "cc4_frame": ("#2b3a33", 0.5, 0.3, 1.0),
    "cc4_leaf": ("#4f7f4a", 0.9, 0.0, 1.0),
    "cc4_glass": ("#d9ebe6", 0.08, 0.0, 0.22),
}
# Preview-only materials (context the app draws itself: curtain wall, slab, wall display).
PREVIEW_PALETTE = {
    "pv_slab": ("#e4e0d6", 0.7, 0.0, 1.0),
    "pv_curtain": ("#7fa6c4", 0.15, 0.1, 0.35),
    "pv_mullion": ("#eef1f2", 0.35, 0.35, 1.0),
    "pv_screen": ("#1e2a24", 0.4, 0.0, 1.0),
    "pv_skin": ("#d9a27a", 0.8, 0.0, 1.0),
    "pv_shirt": ("#5b8a72", 0.85, 0.0, 1.0),
}


def hex_rgb(h):
    h = h.lstrip("#")
    srgb = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return [c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in srgb]


# ---------------------------------------------------------------------------------------- scene

def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


MATS = {}


def material(name):
    if name in MATS:
        return MATS[name]
    colour, rough, metal, alpha = {**PALETTE, **PREVIEW_PALETTE}[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    p = m.node_tree.nodes.get("Principled BSDF")
    p.inputs["Base Color"].default_value = (*hex_rgb(colour), 1)
    p.inputs["Roughness"].default_value = rough
    p.inputs["Metallic"].default_value = metal
    if alpha < 1:
        p.inputs["Alpha"].default_value = alpha
        if hasattr(m, "surface_render_method"):
            m.surface_render_method = "BLENDED"
    MATS[name] = m
    return m


COLLS = {}


def coll(name, parent=None):
    if name not in COLLS:
        c = bpy.data.collections.new(name)
        (parent or bpy.context.scene.collection).children.link(c)
        COLLS[name] = c
    return COLLS[name]


def to_blender(x, y, z):
    """Atlas (x, y up, z front) to Blender (x, y back, z up)."""
    return (x, -z, y)


def mesh_object(name, bm, mat, collection):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(material(mat))
    ob = bpy.data.objects.new(name, me)
    coll(collection).objects.link(ob)
    return ob


def box(name, mat, collection, x0, x1, y0, y1, z0, z1, bevel=0.0, rot=0.0, pivot=None):
    """An axis box in Atlas coordinates (optionally turned about y through pivot), soft edges with bevel."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    sx, sy, sz = x1 - x0, y1 - y0, z1 - z0
    for v in bm.verts:
        x, y, z = v.co.x * sx + (x0 + x1) / 2, v.co.z * sy + (y0 + y1) / 2, -v.co.y * sz + (z0 + z1) / 2
        if rot:
            px, pz = pivot if pivot else ((x0 + x1) / 2, (z0 + z1) / 2)
            dx, dz = x - px, z - pz
            c, s = math.cos(rot), math.sin(rot)
            x, z = px + dx * c + dz * s, pz - dx * s + dz * c
        v.co = to_blender(x, y, z)
    if bevel:
        bmesh.ops.bevel(bm, geom=bm.edges[:] + bm.verts[:], offset=bevel, segments=2, affect="EDGES", profile=0.5)
    return mesh_object(name, bm, mat, collection)


def cylinder(name, mat, collection, cx, cz, rx, y0, y1, rz=None, segments=20):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=segments, radius1=1, radius2=1, depth=1)
    for v in bm.verts:
        x, z, y = v.co.x * rx + cx, -v.co.y * (rz or rx) + cz, (v.co.z + 0.5) * (y1 - y0) + y0
        v.co = to_blender(x, y, z)
    return mesh_object(name, bm, mat, collection)


def blob(name, mat, collection, cx, cy, cz, rx, ry, rz, seed=0):
    """A low-poly foliage clump."""
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=1, radius=1)
    for i, v in enumerate(bm.verts):
        k = 1 + 0.12 * math.sin(i * 2.3 + seed)
        v.co = to_blender(cx + v.co.x * rx * k, cy + v.co.z * ry * k, cz - v.co.y * rz * k)
    return mesh_object(name, bm, mat, collection)


def empty(name, collection, x=0.0, y=0.0, z=0.0, props=None, parent=None):
    ob = bpy.data.objects.new(name, None)
    ob.empty_display_size = 0.15
    ob.location = to_blender(x, y, z)
    for k, v in (props or {}).items():
        ob[k] = v
    coll(collection).objects.link(ob)
    if parent:
        ob.parent = parent
    return ob


# ---------------------------------------------------------------------------------------- pieces

def plant(prefix, collection, x, z, h):
    """A potted plant: green-glazed planter with a brass rim, a stem and three leaf clumps."""
    cylinder(f"{prefix}.Pot", "cc4_green", collection, x, z, 0.2 * h, 0, 0.38 * h, segments=14)
    cylinder(f"{prefix}.Rim", "cc4_brass", collection, x, z, 0.21 * h, 0.36 * h, 0.39 * h, segments=14)
    cylinder(f"{prefix}.Stem", "cc4_wood", collection, x, z, 0.025, 0.38 * h, 0.9 * h, segments=6)
    blob(f"{prefix}.Leaves1", "cc4_leaf", collection, x, 0.95 * h, z, 0.3 * h, 0.32 * h, 0.3 * h, seed=x)
    blob(f"{prefix}.Leaves2", "cc4_leaf", collection, x + 0.12 * h, 1.2 * h, z - 0.05 * h, 0.2 * h, 0.22 * h, 0.2 * h, seed=z)
    blob(f"{prefix}.Leaves3", "cc4_leaf", collection, x - 0.1 * h, 0.75 * h, z + 0.08 * h, 0.22 * h, 0.2 * h, 0.22 * h, seed=x + z)


def planter_box(prefix, collection, b):
    x0, x1, z0, z1 = b["x0"], b["x1"], b["z0"], b["z1"]
    box(f"{prefix}.Box", "cc4_green", collection, x0, x1, 0, 0.5, z0, z1, bevel=0.01)
    box(f"{prefix}.Cap", "cc4_brass", collection, x0 - 0.01, x1 + 0.01, 0.5, 0.52, z0 - 0.01, z1 + 0.01)
    n = max(2, round((x1 - x0) / 0.55))
    for i in range(n):
        x = x0 + (i + 0.5) * (x1 - x0) / n
        blob(f"{prefix}.Shrub{i}", "cc4_leaf", collection, x, 0.68, (z0 + z1) / 2, 0.3, 0.22, 0.22, seed=i)


def glass_walls(prefix, collection, b, height, door_x=None):
    """A glass room: framed glass on four sides, a door gap in the front where door_x says."""
    x0, x1, z0, z1 = b["x0"], b["x1"], b["z0"], b["z1"]
    t = 0.04
    sides = [("Front", (x0, x1), z1, "x"), ("Back", (x0, x1), z0, "x"), ("West", (z0, z1), x0, "z"), ("East", (z0, z1), x1, "z")]
    for label, (a0, a1), at, axis in sides:
        spans = [(a0, a1)]
        if label == "Front" and door_x is not None:
            spans = [(a0, door_x - 0.45), (door_x + 0.45, a1)]
        for i, (s0, s1) in enumerate(spans):
            if axis == "x":
                box(f"{prefix}.Glass{label}{i}", "cc4_glass", collection, s0, s1, 0.03, height - 0.03, at - 0.008, at + 0.008)
            else:
                box(f"{prefix}.Glass{label}{i}", "cc4_glass", collection, at - 0.008, at + 0.008, 0.03, height - 0.03, s0, s1)
        # Frame: head, sill and a mullion about every metre.
        if axis == "x":
            box(f"{prefix}.Head{label}", "cc4_frame", collection, a0, a1, height - 0.05, height, at - t / 2, at + t / 2)
            for s0, s1 in spans:
                box(f"{prefix}.Sill{label}{s0:.2f}", "cc4_frame", collection, s0, s1, 0, 0.05, at - t / 2, at + t / 2)
            n = max(1, round((a1 - a0) / 1.0))
            for i in range(n + 1):
                x = a0 + i * (a1 - a0) / n
                if door_x is not None and label == "Front" and abs(x - door_x) < 0.45:
                    continue
                box(f"{prefix}.Mullion{label}{i}", "cc4_frame", collection, x - t / 2, x + t / 2, 0, height, at - t / 2, at + t / 2)
        else:
            box(f"{prefix}.Head{label}", "cc4_frame", collection, at - t / 2, at + t / 2, height - 0.05, height, a0, a1)
            box(f"{prefix}.Sill{label}", "cc4_frame", collection, at - t / 2, at + t / 2, 0, 0.05, a0, a1)
            n = max(1, round((a1 - a0) / 1.0))
            for i in range(n + 1):
                z = a0 + i * (a1 - a0) / n
                box(f"{prefix}.Mullion{label}{i}", "cc4_frame", collection, at - t / 2, at + t / 2, 0, height, z - t / 2, z + t / 2)
    if door_x is not None:
        for side in (-1, 1):
            box(f"{prefix}.DoorJamb{side}", "cc4_brass", collection, door_x + side * 0.45 - 0.025, door_x + side * 0.45 + 0.025, 0, 2.1, z1 - 0.03, z1 + 0.03)
        box(f"{prefix}.DoorHead", "cc4_brass", collection, door_x - 0.47, door_x + 0.47, 2.1, 2.14, z1 - 0.03, z1 + 0.03)


def armchair(prefix, collection, x, z, face):
    """A green velvet club chair with a brass plinth, turned to `face` (radians, 0 = facing -z)."""
    k = dict(rot=face, pivot=(x, z))
    box(f"{prefix}.Plinth", "cc4_brass", collection, x - 0.36, x + 0.36, 0, 0.06, z - 0.36, z + 0.36, **k)
    box(f"{prefix}.Seat", "cc4_velvet", collection, x - 0.36, x + 0.36, 0.06, 0.42, z - 0.36, z + 0.36, bevel=0.05, **k)
    box(f"{prefix}.Back", "cc4_velvet", collection, x - 0.38, x + 0.38, 0.06, 0.8, z + 0.22, z + 0.4, bevel=0.06, **k)
    for side in (-1, 1):
        box(f"{prefix}.Arm{side}", "cc4_velvet", collection, x + side * 0.38 - 0.08, x + side * 0.38 + 0.08, 0.06, 0.6, z - 0.34, z + 0.4, bevel=0.05, **k)


def meeting_chair(prefix, collection, x, z, face):
    k = dict(rot=face, pivot=(x, z))
    cylinder(f"{prefix}.Base", "cc4_brass", collection, x, z, 0.22, 0, 0.02, segments=12)
    cylinder(f"{prefix}.Post", "cc4_brass", collection, x, z, 0.03, 0.02, 0.42, segments=8)
    box(f"{prefix}.Seat", "cc4_velvet", collection, x - 0.23, x + 0.23, 0.42, 0.5, z - 0.22, z + 0.22, bevel=0.03, **k)
    box(f"{prefix}.Back", "cc4_velvet", collection, x - 0.22, x + 0.22, 0.5, 0.9, z + 0.18, z + 0.25, bevel=0.03, **k)


def workstation_kit(collection, ox=0.0, oz=0.0, prefix="Kit"):
    """One desk, ready for an agent: wood top on cream panel legs, a green privacy screen with a
    brass cap, a monitor housing (Atlas fills the screen) and an ergonomic chair. Desk faces -z."""
    def b(n, m, x0, x1, y0, y1, z0, z1, **k):
        return box(f"{prefix}.{n}", m, collection, x0 + ox, x1 + ox, y0, y1, z0 + oz, z1 + oz, **k)

    b("Top", "cc4_wood", -0.75, 0.75, 0.715, 0.76, -0.38, 0.38, bevel=0.008)
    for side in (-1, 1):
        b(f"Leg{side}", "cc4_cream", side * 0.71 - 0.025, side * 0.71 + 0.025, 0, 0.715, -0.35, 0.35)
    b("Modesty", "cc4_cream", -0.68, 0.68, 0.3, 0.68, -0.34, -0.32)
    b("Screen", "cc4_green", -0.75, 0.75, 0.76, 1.08, -0.39, -0.36, bevel=0.006)
    b("ScreenCap", "cc4_brass", -0.755, 0.755, 1.08, 1.095, -0.395, -0.355)
    b("Drawers", "cc4_cream", 0.42, 0.68, 0.06, 0.68, -0.3, 0.2, bevel=0.006)
    b("Pull", "cc4_brass", 0.53, 0.57, 0.5, 0.515, 0.2, 0.215)
    # Monitor housing: its face sits just behind Atlas's screen (anchor_screen).
    b("MonitorBase", "cc4_dark", -0.12, 0.12, 0.76, 0.775, -0.3, -0.12, bevel=0.004)
    b("MonitorArm", "cc4_dark", -0.025, 0.025, 0.775, 1.0, -0.27, -0.24)
    b("Monitor", "cc4_dark", -0.42, 0.42, 0.93, 1.43, -0.25, -0.22, bevel=0.006)
    # Ergonomic chair, behind the desk at the seat anchor.
    cz = 0.66
    for i in range(5):
        a = i * 2 * math.pi / 5
        box(f"{prefix}.ChairSpoke{i}", "cc4_dark", collection, ox - 0.02, ox + 0.02, 0.04, 0.07, oz + cz, oz + cz + 0.3, rot=a, pivot=(ox, oz + cz))
    cylinder(f"{prefix}.ChairLift", "cc4_dark", collection, ox, oz + cz, 0.03, 0.07, 0.4, segments=8)
    b("ChairSeat", "cc4_dark", -0.25, 0.25, 0.4, 0.48, cz - 0.24, cz + 0.22, bevel=0.03)
    b("ChairSeatPad", "cc4_green", -0.22, 0.22, 0.48, 0.5, cz - 0.21, cz + 0.18, bevel=0.008)
    b("ChairBack", "cc4_dark", -0.23, 0.23, 0.56, 1.05, cz + 0.22, cz + 0.27, bevel=0.03, rot=0.0)
    b("ChairLumbar", "cc4_green", -0.19, 0.19, 0.62, 0.78, cz + 0.2, cz + 0.22)
    for side in (-1, 1):
        b(f"ChairArm{side}", "cc4_dark", side * 0.27 - 0.02, side * 0.27 + 0.02, 0.48, 0.66, cz - 0.02, cz + 0.02)
        b(f"ChairArmPad{side}", "cc4_dark", side * 0.27 - 0.035, side * 0.27 + 0.035, 0.66, 0.69, cz - 0.16, cz + 0.08, bevel=0.01)


# ---------------------------------------------------------------------------------------- build

def build_floor():
    S, C = "Floor 4 · Static", "Floor 4 · Service core"

    # Carpet under the desks, with a slim brass inlay round it: the work area.
    z = DESK_ZONE
    box("Carpet", "cc4_carpet", S, z["x0"], z["x1"], 0, 0.012, z["z0"], z["z1"])
    for n, (x0, x1, z0, z1) in {
        "N": (z["x0"], z["x1"], z["z0"] - 0.03, z["z0"]), "S": (z["x0"], z["x1"], z["z1"], z["z1"] + 0.03),
        "W": (z["x0"] - 0.03, z["x0"], z["z0"] - 0.03, z["z1"] + 0.03), "E": (z["x1"], z["x1"] + 0.03, z["z0"] - 0.03, z["z1"] + 0.03),
    }.items():
        box(f"Carpet.Inlay{n}", "cc4_brass", S, x0, x1, 0, 0.014, z0, z1)
    # The walk from the glass door to the desks: a cream stone runner, kept clear.
    box("Runner", "cc4_stone", S, -0.7, 0.7, 0, 0.01, z["z1"] + 0.03, SHELL_B - 0.15)

    # Service core, back left: service lift (closed shaft), stair-and-storage room, print room.
    c, t, h = CORE, 0.12, STOREY
    box("Core.WallFront.A", "cc4_cream", C, c["x0"], -4.45, 0, h, c["z1"] - t, c["z1"])
    box("Core.WallFront.B", "cc4_cream", C, -3.75, -3.3, 0, h, c["z1"] - t, c["z1"])
    box("Core.WallFront.Head", "cc4_cream", C, -4.45, -3.75, 2.15, h, c["z1"] - t, c["z1"])
    box("Core.WallBack", "cc4_cream", C, c["x0"], c["x1"], 0, h, c["z0"], c["z0"] + t)
    box("Core.WallWest", "cc4_cream", C, c["x0"], c["x0"] + t, 0, h, c["z0"], c["z1"])
    box("Core.Partition", "cc4_cream", C, c["x0"] + t, -3.3, 0, h, -5.82, -5.7)
    box("Core.PartitionDoorHead", "cc4_cream", C, -4.2, -3.6, 2.15, h, -5.83, -5.69)
    # Service lift shaft: closed, cream, a brass door to the floor.
    box("Core.LiftShaft", "cc4_cream", C, -3.3, c["x1"], 0, h, c["z0"], c["z1"])
    box("Core.LiftFrame", "cc4_brass", C, -3.07, -2.23, 0, 2.2, c["z1"], c["z1"] + 0.04)
    box("Core.LiftDoorL", "cc4_brass", C, -3.0, -2.655, 0.0, 2.12, c["z1"] + 0.04, c["z1"] + 0.055)
    box("Core.LiftDoorR", "cc4_brass", C, -2.645, -2.3, 0.0, 2.12, c["z1"] + 0.04, c["z1"] + 0.055)
    box("Core.LiftCall", "cc4_brass", C, -2.12, -2.06, 1.05, 1.17, c["z1"], c["z1"] + 0.03)
    # Room door (storage) in green with a brass pull; trim: green skirting, brass coping on top.
    box("Core.Door", "cc4_green", C, -4.43, -3.77, 0, 2.12, c["z1"] - 0.08, c["z1"] - 0.04)
    box("Core.DoorPull", "cc4_brass", C, -3.88, -3.84, 0.9, 1.25, c["z1"] - 0.04, c["z1"] - 0.02)
    box("Core.Skirting", "cc4_green", C, c["x0"], -2.0, 0, 0.12, c["z1"], c["z1"] + 0.015)
    for n, (x0, x1, z0, z1) in {
        "Front": (c["x0"], c["x1"], c["z1"] - t, c["z1"]), "Back": (c["x0"], c["x1"], c["z0"], c["z0"] + t),
        "West": (c["x0"], c["x0"] + t, c["z0"], c["z1"]), "Partition": (c["x0"] + t, -3.3, -5.82, -5.7),
        "Lift": (-3.3, c["x1"], c["z0"], c["z1"]),
    }.items():
        box(f"Core.Coping{n}", "cc4_brass", C, x0 - 0.01, x1 + 0.01, h, h + 0.03, z0 - 0.01, z1 + 0.01)
    # Inside, seen from above: storage shelving in the front room, a print counter at the back.
    box("Core.ShelvesWest", "cc4_wood", C, c["x0"] + t, c["x0"] + t + 0.42, 0, 1.9, -5.65, -4.75)
    for i, y in enumerate((0.45, 0.9, 1.35, 1.8)):
        box(f"Core.ShelfBoxes{i}", "cc4_cream", C, c["x0"] + t + 0.05, c["x0"] + t + 0.38, y, y + 0.28, -5.55, -4.85)
    box("Core.PrintCounter", "cc4_wood", C, c["x0"] + t, -3.35, 0, 0.9, c["z0"] + t, c["z0"] + t + 0.55)
    box("Core.Printer", "cc4_dark", C, -4.2, -3.7, 0.9, 1.2, c["z0"] + t + 0.05, c["z0"] + t + 0.5, bevel=0.02)

    # Glass meeting room, back right: oval wood table with a brass edge, six green chairs, a wall screen.
    m = MEETING
    M = "Floor 4 · Meeting room"
    glass_walls("Meeting", M, m, 2.5, door_x=2.45)
    mx, mz = (m["x0"] + m["x1"]) / 2, (m["z0"] + m["z1"]) / 2
    cylinder("Meeting.TableTop", "cc4_wood", M, mx, mz, 1.0, 0.72, 0.76, rz=0.48, segments=32)
    cylinder("Meeting.TableEdge", "cc4_brass", M, mx, mz, 1.01, 0.7, 0.72, rz=0.49, segments=32)
    cylinder("Meeting.TablePedestal", "cc4_brass", M, mx, mz, 0.08, 0, 0.7, segments=10)
    cylinder("Meeting.TableFoot", "cc4_brass", M, mx, mz, 0.4, 0, 0.03, rz=0.22, segments=20)
    for i, (dx, dz, face) in enumerate([(-0.55, -0.72, math.pi), (0.0, -0.75, math.pi), (0.55, -0.72, math.pi), (-0.55, 0.72, 0), (0.0, 0.75, 0), (0.55, 0.72, 0)]):
        meeting_chair(f"Meeting.Chair{i}", M, mx + dx, mz + dz, face)
    box("Meeting.WallScreen", "cc4_dark", M, m["x1"] - 0.08, m["x1"] - 0.04, 1.0, 1.75, mz - 0.6, mz + 0.6)
    box("Meeting.Credenza", "cc4_wood", M, m["x0"] + 0.05, m["x0"] + 0.45, 0, 0.7, mz - 0.6, mz + 0.6)
    plant("Meeting.Plant", M, m["x0"] + 0.25, m["z0"] + 0.3, 0.6)

    # Lounge, east: low green partition with planting, three velvet chairs round a brass-based table.
    L, l = "Floor 4 · Lounge", LOUNGE
    box("Lounge.Rug", "cc4_stone", L, l["x0"] + 0.15, l["x1"] - 0.1, 0, 0.014, l["z0"] + 0.2, l["z1"] - 0.2)
    box("Lounge.Partition", "cc4_green", L, l["x0"] - 0.1, l["x0"] + 0.1, 0, 0.9, l["z0"], l["z0"] + 2.4, bevel=0.01)
    box("Lounge.PartitionCap", "cc4_brass", L, l["x0"] - 0.11, l["x0"] + 0.11, 0.9, 0.92, l["z0"] - 0.01, l["z0"] + 2.41)
    for i in range(4):
        blob(f"Lounge.PartitionLeaves{i}", "cc4_leaf", L, l["x0"], 1.05, l["z0"] + 0.3 + i * 0.6, 0.18, 0.16, 0.26, seed=i * 3)
    lx, lz = 5.05, 0.75
    cylinder("Lounge.Table", "cc4_wood", L, lx, lz, 0.38, 0.4, 0.44, segments=24)
    cylinder("Lounge.TableRim", "cc4_brass", L, lx, lz, 0.385, 0.38, 0.4, segments=24)
    cylinder("Lounge.TableBase", "cc4_brass", L, lx, lz, 0.05, 0, 0.38, segments=8)
    for i, (dx, dz) in enumerate([(-0.15, -0.95), (0.55, 0.55), (-0.2, 1.05)]):
        armchair(f"Lounge.Chair{i}", L, lx + dx, lz + dz, math.atan2(dx, dz))
    box("Lounge.SideTable", "cc4_wood", L, 5.45, 5.8, 0, 0.5, -1.75, -1.4)
    cylinder("Lounge.LampPole", "cc4_brass", L, 5.62, -1.57, 0.015, 0.5, 1.35, segments=6)
    cylinder("Lounge.LampShade", "cc4_cream", L, 5.62, -1.57, 0.14, 1.25, 1.45, segments=14)

    # Storage along the west glass: a low wood credenza with green doors and brass pulls.
    s = STORAGE
    St = "Floor 4 · Storage"
    box("Storage.Credenza", "cc4_wood", St, s["x0"], s["x1"], 0.08, 0.8, s["z0"], s["z1"], bevel=0.01)
    box("Storage.Plinth", "cc4_dark", St, s["x0"] + 0.03, s["x1"] - 0.03, 0, 0.08, s["z0"] + 0.03, s["z1"] - 0.03)
    n = 6
    for i in range(n):
        z0 = s["z0"] + 0.04 + i * (s["z1"] - s["z0"] - 0.08) / n
        z1 = z0 + (s["z1"] - s["z0"] - 0.08) / n - 0.02
        box(f"Storage.Door{i}", "cc4_green", St, s["x1"], s["x1"] + 0.015, 0.12, 0.76, z0, z1)
        box(f"Storage.Pull{i}", "cc4_brass", St, s["x1"] + 0.015, s["x1"] + 0.03, 0.62, 0.66, (z0 + z1) / 2 - 0.08, (z0 + z1) / 2 + 0.08)
    plant("Storage.PlantA", St, -5.67, -2.6, 0.55)
    plant("Storage.PlantB", St, -5.67, 1.9, 0.55)
    box("Storage.Books", "cc4_cream", St, -5.85, -5.5, 0.8, 1.02, -0.5, 0.2)

    # Planting: two planter boxes either side of the front door walk, five potted plants.
    P = "Floor 4 · Planting"
    for i, b in enumerate(PLANTERS):
        planter_box(f"Planter{i}", P, b)
    for i, (x, zz, hh) in enumerate(POTS):
        plant(f"Plant{i}", P, x, zz, hh)


def keepouts():
    """Named boxes Atlas checks its desks against (and an outline of the desk zone)."""
    Z = "Floor 4 · Zones"
    root = empty("zones", Z)
    empty("zone_desks", Z, props=DESK_ZONE, parent=root)
    boxes = {"keepout_core": CORE, "keepout_meeting": MEETING, "keepout_lounge": LOUNGE, "keepout_storage": STORAGE}
    for i, b in enumerate(PLANTERS):
        boxes[f"keepout_planter{i}"] = b
    for i, (x, z, h) in enumerate(POTS):
        r = 0.32 * h
        boxes[f"keepout_plant{i}"] = dict(x0=x - r, x1=x + r, z0=z - r, z1=z + r)
    for name, b in boxes.items():
        empty(name, Z, props=b, parent=root)
    return root


def build_kit():
    K = "Workstation kit"
    workstation_kit(K)
    for name, (x, y, z) in ANCHORS.items():
        empty(name, K, x, y, z)


def build_preview():
    """Context the app draws itself, for the Blender preview only: the floor slab and curtain wall
    of the floor plate, the wall display, the desks Atlas plans today with a seated figure each."""
    V = "Preview only (not exported)"
    pts = []
    for i in range(64):
        t = -i / 64 * math.pi * 2
        ct, st = math.cos(t), math.sin(t)
        pts.append((SHELL_A * math.copysign(abs(ct) ** (2 / SHELL_N), ct), SHELL_B * math.copysign(abs(st) ** (2 / SHELL_N), st)))
    bm = bmesh.new()
    verts = [bm.verts.new(to_blender(x, 0, z)) for x, z in pts]
    face = bm.faces.new(verts)
    face.normal_update()
    if face.normal.z < 0:
        face.normal_flip()
    down = bmesh.ops.extrude_face_region(bm, geom=[face])["geom"]
    bmesh.ops.translate(bm, vec=(0, 0, -0.14), verts=[v for v in down if isinstance(v, bmesh.types.BMVert)])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    mesh_object("Preview.Slab", bm, "pv_slab", V)
    # Curtain wall: tall at the back and west (front and east cut to a sill), as Atlas draws it.
    for i in range(64):
        f = i / 64
        tall = 0.07 < f < 0.62
        (ax, az), (bx, bz) = pts[i], pts[(i + 1) % 64]
        top = STOREY + (1.3 * (1 - (ax / SHELL_A + 1) / 2) if tall else 0) if tall else 0.34
        if not tall and az > 0 and min(ax, bx) < 0.82 and max(ax, bx) > -0.82:
            continue  # the glass door
        bm = bmesh.new()
        vs = [bm.verts.new(to_blender(*p)) for p in ((ax, 0, az), (bx, 0, bz), (bx, top, bz), (ax, top, az))]
        bm.faces.new(vs)
        mesh_object(f"Preview.Glass{i}", bm, "pv_curtain", V)
        box(f"Preview.Mullion{i}", "pv_mullion", V, ax - 0.025, ax + 0.025, 0, top, az - 0.025, az + 0.025)
    box("Preview.WallDisplay", "pv_screen", V, -1.25, 1.25, 0.95, 2.25, -PLAN_D / 2, -PLAN_D / 2 + 0.06)
    for i, (x, z) in enumerate(PREVIEW_DESKS):
        workstation_kit(V, x, z, prefix=f"Preview.Desk{i}")
        box(f"Preview.Desk{i}.Screen", "pv_screen", V, x - 0.39, x + 0.39, 0.96, 1.4, z - 0.22, z - 0.198)
        # A stand-in figure on the seat, so the scale reads; Atlas draws its own agents.
        box(f"Preview.Desk{i}.Body", "pv_shirt", V, x - 0.17, x + 0.17, 0.5, 1.05, z + 0.55, z + 0.78, bevel=0.06)
        blob(f"Preview.Desk{i}.Head", "pv_skin", V, x, 1.2, z + 0.64, 0.12, 0.13, 0.12)


def export_groups():
    """Join each group's objects by material into one mesh per material (few draw calls), parent
    them under the group's node and export. The editable objects stay separate in the .blend."""
    groups = {
        "static": ["Floor 4 · Static", "Floor 4 · Meeting room", "Floor 4 · Lounge", "Floor 4 · Storage", "Floor 4 · Planting"],
        "cutaway_back": ["Floor 4 · Service core"],
        "kit": ["Workstation kit"],
    }
    E = coll("Export (generated)")
    root = empty("command_center_floor4", "Export (generated)", props={
        "floor": FLOOR, "planW": PLAN_W, "planD": PLAN_D, "shellA": SHELL_A, "shellB": SHELL_B, "shellN": SHELL_N, "storey": STOREY,
    })
    made = [root]
    for group, colls in groups.items():
        node = empty(group, "Export (generated)", parent=root)
        made.append(node)
        by_mat = {}
        for cn in colls:
            for ob in COLLS[cn].objects:
                if ob.type == "MESH":
                    by_mat.setdefault(ob.data.materials[0].name, []).append(ob)
        for mat, obs in sorted(by_mat.items()):
            copies = []
            for ob in obs:
                cp = ob.copy()
                cp.data = ob.data.copy()
                E.objects.link(cp)
                copies.append(cp)
            bpy.ops.object.select_all(action="DESELECT")
            for cp in copies:
                cp.select_set(True)
            bpy.context.view_layer.objects.active = copies[0]
            bpy.ops.object.join()
            joined = bpy.context.view_layer.objects.active
            joined.name = joined.data.name = f"{group}_{mat.replace('cc4_', '')}"
            joined.parent = node
            made.append(joined)
        if group == "kit":
            for ob in COLLS["Workstation kit"].objects:
                if ob.type == "EMPTY":
                    # The export copy takes the anchor's own name; the editable one is renamed back after.
                    name = ob.name
                    ob.name = f"{name}.src"
                    cp = ob.copy()
                    E.objects.link(cp)
                    cp.name = name
                    cp.parent = node
                    made.append(cp)
    zones = keepouts()
    zones.parent = root
    made += [zones, *zones.children]
    bpy.ops.object.select_all(action="DESELECT")
    for ob in made:
        ob.select_set(True)
    os.makedirs(os.path.dirname(GLB), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=GLB, export_format="GLB", use_selection=True, export_extras=True, export_yup=True,
        export_apply=True, export_texcoords=False, export_normals=True, export_materials="EXPORT",
        export_cameras=False, export_lights=False, export_animations=False,
    )
    # The joined copies are rebuilt each time; keep the .blend to the editable objects.
    for ob in made:
        if ob.name != "zones" and not ob.name.startswith(("zone_", "keepout_")):
            bpy.data.objects.remove(ob, do_unlink=True)
    bpy.data.collections.remove(E)
    for ob in COLLS["Workstation kit"].objects:
        if ob.name.endswith(".src"):
            ob.name = ob.name[:-4]


def preview_camera():
    """A camera on the reference's angle (from the front, a little left, looking down at the
    back), lights and Cycles settings for the preview render."""
    sc = bpy.context.scene
    cam = bpy.data.cameras.new("Preview camera")
    cam.lens = 38
    ob = bpy.data.objects.new("Preview camera", cam)
    sc.collection.objects.link(ob)
    ob.location = to_blender(-6.5, 14.5, 15.5)
    tgt = empty("Preview target", "Preview only (not exported)", 0.2, 0.4, -0.6)
    con = ob.constraints.new("TRACK_TO")
    con.target = tgt
    sc.camera = ob
    # Atlas's own interior camera: 45 degrees round from the front right, looking down about 34 degrees.
    cam2 = bpy.data.cameras.new("Atlas camera")
    cam2.lens = 50
    ob2 = bpy.data.objects.new("Atlas camera", cam2)
    sc.collection.objects.link(ob2)
    r, phi, theta = 17.5, 0.98, math.pi / 4
    ob2.location = to_blender(r * math.sin(phi) * math.sin(theta), 0.7 + r * math.cos(phi), 0.2 + r * math.sin(phi) * math.cos(theta))
    tgt2 = empty("Atlas target", "Preview only (not exported)", 0, 0.7, 0.2)
    con2 = ob2.constraints.new("TRACK_TO")
    con2.target = tgt2
    sun = bpy.data.lights.new("Sun", "SUN")
    sun.energy = 3.2
    sun.angle = math.radians(8)
    sun.color = hex_rgb("#fff0d2")
    so = bpy.data.objects.new("Sun", sun)
    so.rotation_euler = (math.radians(40), math.radians(-18), math.radians(-35))
    sc.collection.objects.link(so)
    world = bpy.data.worlds.new("World")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (*hex_rgb("#efe9dc"), 1)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 1.0
    sc.world = world
    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"
    sc.cycles.samples = 48
    sc.cycles.use_denoising = True
    sc.render.resolution_x, sc.render.resolution_y = 1600, 1060
    sc.view_settings.view_transform = "AgX" if "AgX" in [t.identifier for t in type(sc.view_settings).bl_rna.properties["view_transform"].enum_items] else "Filmic"


def fingerprint(path):
    with open(path, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


def main():
    reset()
    build_floor()
    build_kit()
    build_preview()
    export_groups()
    preview_camera()
    # Kit sits at the origin, inside the floor; hide it in the .blend's view (it is a template).
    for ob in COLLS["Workstation kit"].objects:
        ob.hide_render = ob.hide_viewport = False
    COLLS["Workstation kit"].hide_render = True
    bpy.context.view_layer.layer_collection.children["Workstation kit"].hide_viewport = True
    os.makedirs(os.path.dirname(BLEND), exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=BLEND, compress=True)
    if RENDER:
        sc = bpy.context.scene
        for cam, suffix in (("Preview camera", "reference-angle"), ("Atlas camera", "atlas-angle")):
            sc.camera = bpy.data.objects[cam]
            sc.render.filepath = f"{RENDER}-{suffix}.png"
            bpy.ops.render.render(write_still=True)
        sc.camera = bpy.data.objects["Preview camera"]
    if STAMP:
        with open(STAMP, "w") as f:
            json.dump({
                "script": fingerprint(os.path.abspath(__file__)),
                "blend": fingerprint(BLEND),
                "glb": fingerprint(GLB),
                "glbBytes": os.path.getsize(GLB),
            }, f, indent=2)
            f.write("\n")
    print("built", BLEND, GLB, os.path.getsize(GLB), "bytes")


main()
