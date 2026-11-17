"""Atlas Command Center: the map building, built in Blender from Khaneil's concept (2026-11-17).

Reproducible: this script is the source. It rebuilds the .blend and the GLB from nothing, so
every design change is made here and both files are rebuilt together:

    npm run model:command-center

(Blender from /Applications, or set BLENDER to its binary.) Edits made by hand in the .blend are
overwritten by the next build: make them here instead. build.json records a fingerprint of all
three files, and the tests fail when they drift apart.

Writes assets/command-center/command-center.blend (editable) and
public/models/map/command-center.glb (what the map loads).

Units are map units at k = 1 (AtlasHq scales the model by the tower's size). Dimensions are
written in Atlas's axes: x across the front, y up, z toward the viewer (+z is the entrance side);
they are converted to Blender's z-up on the way in, and the glTF exporter turns them back to y-up.
The numbers match src/views/map3d/commandCenterPlan.ts; src/views/map3d/atlasHq.test.ts reads
the GLB and checks its footprint and heights against that plan.

One object per material, so the map draws the whole building in eight draw calls. The map swaps
each material for its own by name (cc_glass, cc_lobby, cc_stone, ...); the colours here are
the same palette, so the GLB also looks right on its own. No textures in the file: the window
texture is drawn by the app (commandCenterTextures.ts), which reads the UVs laid here.
"""

import hashlib
import json
import math
import os

import bmesh
import bpy
from mathutils import Matrix

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, "..", ".."))
BLEND = os.path.join(HERE, "command-center.blend")
GLB = os.path.join(ROOT, "public", "models", "map", "command-center.glb")
# Written last, with a fingerprint of this script, the .blend and the GLB. atlasHq.test.ts checks
# it, so a design change to this script that was not rebuilt (or a .blend or GLB edited on its
# own) fails the tests until `npm run model:command-center` is run.
STAMP = os.path.join(HERE, "build.json")

# Storeys: the interior's own (lobby 3.3, floors 2.7) at 10 office units per map unit of plan. On
# the campus the map scales the model by about 2.35, so the roof stands about 3.3 map units up, with
# the Growth & Marketing Studio and the Vendor & Supplier Hub.
LOBBY = 3.3 / 10
STOREY = 2.7 / 10
FLOORS = 4
ROOF = LOBBY + FLOORS * STOREY

# Footprint (within the parcel's square: x -0.82..0.82, z -0.62..0.38). A taller glass wing on the right
# turns the front corner in a wide curve; the left wing stands a step back; the stone entrance bay
# covers the joint between them, as in the concept.
X0, X1, Z0, ZF_RIGHT, ZF_LEFT, JOINT = -0.82, 0.82, -0.62, 0.38, 0.31, -0.26
R_RIGHT, R_LEFT, ARC = 0.22, 0.12, 8

# The stone entrance bay (ccBay): proud of the front, rising above the roof.
BAY_HALF, BAY_PROUD, BAY_BACK, BAY_RISE, COPING = 0.26, 0.08, 0.12, 0.14, 0.02

# Floor slabs, spandrels, mullions, parapet, roof planting.
SLAB_OUT, SLAB_H = 0.035, 0.034
SILL_OUT, SILL_H = 0.006, 0.024
MULLION, MULLION_W, MULLION_D = 0.05, 0.006, 0.008
LOBBY_MULLION = 0.09
PARAPET_H, PARAPET_IN = 0.055, 0.02
PLANTER_IN, PLANTER_H = 0.07, 0.035

PALETTE = {
    "cc_glass": ("#86ab98", 0.25, 0.1),
    "cc_lobby": ("#f2d08c", 0.3, 0.1),
    "cc_stone": ("#e7dcc4", 0.8, 0.0),
    "cc_roof": ("#cdbf9f", 0.9, 0.0),
    "cc_frame": ("#2c4a3b", 0.5, 0.2),
    "cc_brass": ("#b08d52", 0.36, 0.65),
    "cc_hedge": ("#4f7a52", 0.9, 0.0),
    "cc_lawn": ("#8fae6a", 0.95, 0.0),
}


def arc(cx, cz, r, a0, a1, n=ARC):
    return [(cx + r * math.cos(a0 + (a1 - a0) * i / n), cz + r * math.sin(a0 + (a1 - a0) * i / n)) for i in range(n + 1)]


def outline():
    """The glass line, counter-clockwise seen from above (x right, z toward the viewer = down)."""
    h = math.pi / 2
    pts = [(JOINT, ZF_RIGHT)]
    pts += arc(X1 - R_RIGHT, ZF_RIGHT - R_RIGHT, R_RIGHT, h, 0)            # front-right corner
    pts += arc(X1 - R_RIGHT, Z0 + R_RIGHT, R_RIGHT, 0, -h)                 # back-right corner
    pts += arc(X0 + R_LEFT, Z0 + R_LEFT, R_LEFT, -h, -2 * h)               # back-left corner
    pts += arc(X0 + R_LEFT, ZF_LEFT - R_LEFT, R_LEFT, math.pi, h)          # front-left corner
    pts += [(JOINT, ZF_LEFT)]
    out = []
    for p in pts:  # drop repeats where arcs meet straight runs
        if not out or math.dist(out[-1], p) > 1e-6:
            out.append(p)
    if math.dist(out[0], out[-1]) < 1e-6:
        out.pop()
    return out


def centroid(pts):
    return (sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts))


def offset(pts, d):
    """Offset an outline outward by d (negative = inward), mitred so walls stay parallel."""
    n, c, out = len(pts), centroid(pts), []

    def edge_normal(a, b):
        dx, dz = b[0] - a[0], b[1] - a[1]
        l = math.hypot(dx, dz) or 1
        nx, nz = dz / l, -dx / l
        mx, mz = (a[0] + b[0]) / 2 - c[0], (a[1] + b[1]) / 2 - c[1]
        return (nx, nz) if nx * mx + nz * mz >= 0 else (-nx, -nz)

    for i in range(n):
        n0, n1 = edge_normal(pts[i - 1], pts[i]), edge_normal(pts[i], pts[(i + 1) % n])
        sx, sz = n0[0] + n1[0], n0[1] + n1[1]
        l = math.hypot(sx, sz) or 1
        sx, sz = sx / l, sz / l
        cos = max(0.5, sx * n1[0] + sz * n1[1])
        out.append((pts[i][0] + sx * d / cos, pts[i][1] + sz * d / cos))
    return out


class Builder:
    """Collects triangles per material in Atlas axes, with optional UVs."""

    def __init__(self):
        self.parts = {name: {"v": [], "f": [], "uv": []} for name in PALETTE}

    def _v(self, mat, p):
        part = self.parts[mat]
        part["v"].append((p[0], -p[2], p[1]))  # Atlas (x, y up, z front) -> Blender (x, -z, y)
        return len(part["v"]) - 1

    def quad(self, mat, a, b, c, d, uv=None, out=None):
        """A quad, turned so its front faces `out` (a direction) when one is given."""
        part = self.parts[mat]
        uv = uv or [(0, 0)] * 4
        pts = [a, b, c, d]
        if out is not None:
            u = [b[i] - a[i] for i in range(3)]
            v = [d[i] - a[i] for i in range(3)]
            n = (u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0])
            if sum(n[i] * out[i] for i in range(3)) < 0:
                pts, uv = pts[::-1], uv[::-1]
        idx = [self._v(mat, p) for p in pts]
        part["f"].append(idx)
        part["uv"].append(uv)

    def poly(self, mat, pts, y, up=True):
        part = self.parts[mat]
        # Shoelace sign in x/z: a positive sum turns the polygon's front downward in these axes.
        area = sum(pts[i][0] * pts[(i + 1) % len(pts)][1] - pts[(i + 1) % len(pts)][0] * pts[i][1] for i in range(len(pts)))
        order = pts[::-1] if (area > 0) == up else pts
        idx = [self._v(mat, (x, y, z)) for x, z in order]
        part["f"].append(idx)
        part["uv"].append([(0, 0)] * len(idx))

    def wall(self, mat, pts, y0, y1, uv=None, inward=False):
        """Vertical wall round a closed outline, facing out (or in). uv(run, y) gives texture coords."""
        n, run, c = len(pts), 0.0, centroid(pts)
        sign = -1 if inward else 1
        for i in range(n):
            a, b = pts[i], pts[(i + 1) % n]
            seg = math.dist(a, b)
            q = [(a[0], y0, a[1]), (b[0], y0, b[1]), (b[0], y1, b[1]), (a[0], y1, a[1])]
            coords = None
            if uv:
                coords = [uv(run, y0), uv(run + seg, y0), uv(run + seg, y1), uv(run, y1)]
            nx, nz = b[1] - a[1], -(b[0] - a[0])
            mx, mz = (a[0] + b[0]) / 2 - c[0], (a[1] + b[1]) / 2 - c[1]
            if nx * mx + nz * mz < 0:
                nx, nz = -nx, -nz
            self.quad(mat, *q, uv=coords, out=(sign * nx, 0, sign * nz))
            run += seg

    def ring(self, mat, outer, inner, y0, y1):
        """A solid band between two outlines: outer wall, inner wall, top and bottom."""
        self.wall(mat, outer, y0, y1)
        self.wall(mat, inner, y0, y1, inward=True)
        n = len(outer)
        for i in range(n):
            j = (i + 1) % n
            a, b, o0, o1 = inner[i], inner[j], outer[i], outer[j]
            self.quad(mat, (o0[0], y1, o0[1]), (o1[0], y1, o1[1]), (b[0], y1, b[1]), (a[0], y1, a[1]), out=(0, 1, 0))
            self.quad(mat, (o0[0], y0, o0[1]), (o1[0], y0, o1[1]), (b[0], y0, b[1]), (a[0], y0, a[1]), out=(0, -1, 0))

    def box(self, mat, cx, y0, cz, w, h, d, yaw=0.0):
        c, s = math.cos(yaw), math.sin(yaw)

        def p(x, y, z):
            return (cx + x * c + z * s, y, cz - x * s + z * c)

        x, z = w / 2, d / 2
        b = [p(-x, y0, -z), p(x, y0, -z), p(x, y0, z), p(-x, y0, z)]
        t = [p(-x, y0 + h, -z), p(x, y0 + h, -z), p(x, y0 + h, z), p(-x, y0 + h, z)]
        mid = (cx, y0 + h / 2, cz)
        for f in ((b[3], b[2], t[2], t[3]), (b[1], b[0], t[0], t[1]), (b[0], b[3], t[3], t[0]),
                  (b[2], b[1], t[1], t[2]), (t[3], t[2], t[1], t[0]), (b[0], b[1], b[2], b[3])):
            fc = [sum(q[i] for q in f) / 4 - mid[i] for i in range(3)]
            self.quad(mat, *f, out=fc)


def along(pts, step, skip=None):
    """Points every `step` along a closed outline, with the wall's direction there."""
    n, segs = len(pts), []
    total = 0.0
    for i in range(n):
        a, b = pts[i], pts[(i + 1) % n]
        segs.append((a, b, total))
        total += math.dist(a, b)
    count = max(1, round(total / step))
    out = []
    for k in range(count):
        s = k * total / count
        for a, b, start in segs:
            seg = math.dist(a, b)
            if start <= s < start + seg + 1e-9:
                t = (s - start) / seg if seg else 0
                x, z = a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t
                if not (skip and skip(x, z)):
                    out.append((x, z, math.atan2(-(b[1] - a[1]), b[0] - a[0])))
                break
    return out


def build():
    B = Builder()
    glass = outline()
    slab = offset(glass, SLAB_OUT)
    sill = offset(glass, SILL_OUT)
    bay_front = ZF_RIGHT + BAY_PROUD
    bay_back = ZF_RIGHT - BAY_BACK
    top = ROOF + BAY_RISE
    behind_bay = lambda x, z: abs(x) < BAY_HALF + 0.01 and z > bay_back - 0.02  # noqa: E731

    # Glass: gold-lit lobby, then the four office floors in one band. The app's window texture is
    # one tile of 8 panes by 4 storeys; u runs along the wall, v up the storeys.
    B.wall("cc_lobby", glass, 0, LOBBY, uv=lambda r, y: (r / (LOBBY_MULLION * 4), y / LOBBY))
    B.wall("cc_glass", glass, LOBBY, ROOF, uv=lambda r, y: (r / (MULLION * 8), (y - LOBBY) / (STOREY * 4)))

    # Cream stone floor slabs over the lobby and each office floor, with a dark green sill above.
    for i in range(FLOORS):
        y = LOBBY + i * STOREY
        B.ring("cc_stone", slab, glass, y - SLAB_H / 2, y + SLAB_H / 2)
        B.ring("cc_frame", sill, glass, y + SLAB_H / 2, y + SLAB_H / 2 + SILL_H)

    # Parapet with a stone coping, the roof, and planters right round its inner edge.
    inner = offset(glass, -PARAPET_IN)
    B.ring("cc_stone", slab, inner, ROOF - SLAB_H / 2, ROOF + PARAPET_H)
    B.poly("cc_roof", inner, ROOF + 0.004)
    planter_in = offset(glass, -PLANTER_IN)
    B.ring("cc_hedge", inner, planter_in, ROOF, ROOF + PLANTER_H)
    B.poly("cc_lawn", offset(glass, -PLANTER_IN - 0.01), ROOF + 0.012)
    # A low stone plant room set back on the roof, as in the concept.
    B.box("cc_stone", 0.28, ROOF, -0.3, 0.5, 0.07, 0.3)
    B.box("cc_roof", 0.28, ROOF + 0.07, -0.3, 0.53, 0.01, 0.33)

    # Mullions: slim dark green on the office floors, brass in the lobby.
    for x, z, yaw in along(glass, MULLION, behind_bay):
        B.box("cc_frame", x, LOBBY, z, MULLION_W, ROOF - LOBBY, MULLION_D, yaw)
    for x, z, yaw in along(glass, LOBBY_MULLION):
        B.box("cc_brass", x, 0, z, MULLION_W * 1.4, LOBBY, MULLION_D, yaw)

    # The stone entrance bay over the lobby, rising above the roof, with a coping cap.
    B.box("cc_stone", 0, LOBBY, (bay_front + bay_back) / 2, 2 * BAY_HALF, top - LOBBY, bay_front - bay_back)
    B.box("cc_stone", 0, top, (bay_front + bay_back) / 2, 2 * BAY_HALF + 0.03, COPING, bay_front - bay_back + 0.03)
    # A brass line under the bay's first stone course, over the canopy.
    B.box("cc_brass", 0, LOBBY - 0.012, bay_front + 0.002, 2 * BAY_HALF, 0.012, 0.006)

    # Shrubs along the roof planters, low icospheres showing over the parapet.
    shrubs = along(offset(glass, -(PARAPET_IN + PLANTER_IN) / 2), 0.075)
    return B, shrubs, top


def material(name):
    hexa, rough, metal = PALETTE[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes["Principled BSDF"]
    rgb = [int(hexa[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    lin = [c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in rgb]
    bsdf.inputs["Base Color"].default_value = (*lin, 1)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    return m


def to_object(name, part, coll):
    me = bpy.data.meshes.new(name)
    me.from_pydata(part["v"], [], part["f"])
    uv = me.uv_layers.new(name="UVMap")
    li = 0
    for face_uv in part["uv"]:
        for u, v in face_uv:
            uv.data[li].uv = (u, v)
            li += 1
    me.validate()
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bmesh.ops.triangulate(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    me.shade_smooth()
    me.set_sharp_from_angle(angle=math.radians(35))
    me.materials.append(bpy.data.materials.get(name) or material(name))
    ob = bpy.data.objects.new(name, me)
    coll.objects.link(ob)
    return ob


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.preferences.filepaths.save_version = 0  # no .blend1 backup next to the source
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    coll = bpy.data.collections.new("CommandCenter")
    scene.collection.children.link(coll)

    B, shrubs, _ = build()
    # Shrubs join the hedge mesh: one low icosphere each, varied a little in size.
    bm = bmesh.new()
    for i, (x, z, _) in enumerate(shrubs):
        s = 0.022 + 0.006 * ((i * 7) % 3) / 2
        bmesh.ops.create_icosphere(bm, subdivisions=1, radius=1, matrix=(
            Matrix.Translation((x, -z, ROOF + PLANTER_H + s * 0.4)) @ Matrix.Diagonal((s, s, s * 0.8, 1))))
    hedge = B.parts["cc_hedge"]
    base = len(hedge["v"])
    bm.verts.ensure_lookup_table()
    for v in bm.verts:
        hedge["v"].append(tuple(v.co))
    for f in bm.faces:
        hedge["f"].append([base + v.index for v in f.verts])
        hedge["uv"].append([(0, 0)] * len(f.verts))
    bm.free()

    for name, part in B.parts.items():
        if part["f"]:
            to_object(name, part, coll)

    os.makedirs(os.path.dirname(GLB), exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=BLEND, compress=True)
    bpy.ops.export_scene.gltf(
        filepath=GLB,
        export_format="GLB",
        export_yup=True,
        export_apply=True,
        export_texcoords=True,
        export_normals=True,
        export_materials="EXPORT",
        export_image_format="NONE",
        export_cameras=False,
        export_lights=False,
        export_extras=False,
        export_animations=False,
        export_draco_mesh_compression_enable=False,
    )
    tris = sum(len(o.data.polygons) for o in coll.objects)

    def sha(path):
        with open(path, "rb") as f:
            return hashlib.sha256(f.read()).hexdigest()

    with open(STAMP, "w") as f:
        json.dump({"blender": bpy.app.version_string, "script": sha(os.path.abspath(__file__)), "blend": sha(BLEND),
                   "glb": sha(GLB), "triangles": tris}, f, indent=1)
        f.write("\n")
    print(f"COMMAND_CENTER_OK objects={len(coll.objects)} triangles={tris} glb={os.path.getsize(GLB)}")


main()
