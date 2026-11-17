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
each material for its own by name (cc_glass, cc_lobby, cc_stone, ...) and takes this file's
textures onto them; the colours here are the same palette, so the GLB also looks right on its own.

Baked lighting and real materials (2026-11-17, after the concept close-up): Cycles bakes soft
ambient occlusion (shadow under each stone ledge, darker joints and corners, contact shadow at the
base) into the colour of every solid part, on a UV set laid for it. The stone is Poly Haven's
Marble 01 (CC0, assets/command-center/textures), box-mapped at its real 1.5 m tile and graded to
the palette's cream; the brass is brushed (vertical streaks, made here). A second bake lights the
stone and the green sills with the warm offices and gold lobby only, so the window glow spills onto
the slabs: the map shows it as emissive, softly by day and fully at night. Glass and lobby keep the
app's window texture on their first UVs and take an occlusion map on the second. Textures are
JPEG/PNG (not WebP): the map decodes them without blob: URLs, which the CSP does not allow.
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


# --- Baked lighting and materials -------------------------------------------------------------

TEX = os.path.join(HERE, "textures")
# Poly Haven "Marble 01" by Rob Tuytel (CC0): cream limestone cladding, a 1.5 m square tile.
STONE_TEX = os.path.join(TEX, "marble_01_diff_1k.jpg")
STONE_TILE = 1.5 / 10   # metres to map units (10 m per unit)
STONE_CONTRAST = 0.75   # veining kept subtle at map scale
AO_DISTANCE = 0.12      # how far occlusion reaches: a little more than three slab depths
SHADOW = (0.34, 0.31, 0.28)  # linear multiplier where the AO is fully closed (warm, never black)
# Baked texture size per part, in pixels (square). The stone carries the most visible detail.
BAKE_SIZE = {"cc_stone": 1024, "cc_frame": 512, "cc_roof": 512, "cc_glass": 512,
             "cc_lobby": 256, "cc_brass": 256, "cc_hedge": 256, "cc_lawn": 256}
SEE_THROUGH = ("cc_glass", "cc_lobby")  # keep the app's window texture; occlusion only
# Window light for the glow bake (colour, strength): warm offices, a brighter gold lobby.
WINDOW_LIGHT = {"cc_glass": ("#ffd49a", 3.0), "cc_lobby": ("#ffc46e", 7.0)}
GLOW_PARTS = ("cc_stone", "cc_frame")
GLOW_PERCENTILE = 85  # which lit stone texel the glow map scales to 1


def lin(hexa):
    rgb = [int(hexa[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    return [c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in rgb]


def select_only(ob):
    for o in bpy.context.view_layer.objects:
        o.select_set(o == ob)
    bpy.context.view_layer.objects.active = ob


def new_image(name, size, float_buffer=True, srgb=False):
    img = bpy.data.images.new(name, size, size, alpha=False, float_buffer=float_buffer)
    img.colorspace_settings.name = "sRGB" if srgb else "Non-Color"
    return img


def pixels(img):
    import numpy as np
    a = np.empty(img.size[0] * img.size[1] * 4, np.float32)
    img.pixels.foreach_get(a)
    return a.reshape(-1, 4)


def to_srgb(a):
    import numpy as np
    a = np.clip(a, 0, 1)
    return np.where(a <= 0.0031308, a * 12.92, 1.055 * np.power(a, 1 / 2.4) - 0.055)


def final_image(name, linear, size, srgb=True):
    """A packed 8-bit image from linear float pixels: what the GLB carries."""
    img = new_image(name, size, float_buffer=False, srgb=srgb)
    out = linear.copy()
    out[:, :3] = to_srgb(out[:, :3]) if srgb else out[:, :3].clip(0, 1)
    out[:, 3] = 1
    img.pixels.foreach_set(out.ravel())
    img.pack()
    return img


def bake_uvs(ob):
    """A non-overlapping UV set for the bake: the only one on solid parts, the second on the glass."""
    me = ob.data
    if ob.name not in SEE_THROUGH:
        while me.uv_layers:
            me.uv_layers.remove(me.uv_layers[0])
        # Cut each slab ring's top and bottom into quarters: a ring is one hollow island that wastes
        # the middle of the texture, quarters pack tightly. Shape and shading are unchanged.
        cy = -(Z0 + ZF_RIGHT) / 2
        bm = bmesh.new()
        bm.from_mesh(me)
        bm.normal_update()

        quarters = {}
        for f in bm.faces:
            if abs(f.normal.z) > 0.9:
                c = f.calc_center_median()
                quarters.setdefault((c.x > 0, c.y > cy), []).append(f)
        for faces in quarters.values():
            bmesh.ops.split(bm, geom=faces, use_only_faces=False)
        bm.to_mesh(me)
        bm.free()
    layer = me.uv_layers.new(name="Bake" if ob.name in SEE_THROUGH else "UVMap")
    me.uv_layers.active = layer
    select_only(ob)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.004, scale_to_bounds=True)
    # Concave packing nests the small islands inside the slab rings' empty middles.
    bpy.ops.uv.select_all(action="SELECT")
    bpy.ops.uv.pack_islands(udim_source="CLOSEST_UDIM", rotate=True, shape_method="CONCAVE",
                            margin_method="SCALED", margin=0.004)
    bpy.ops.object.mode_set(mode="OBJECT")
    return layer.name


def graded_stone():
    """Marble 01 in linear float, contrast eased and its average graded to the palette's cream."""
    src = bpy.data.images.load(STONE_TEX)
    src.colorspace_settings.name = "sRGB"
    a = pixels(src)  # sRGB-encoded bytes as floats
    rgb = a[:, :3]
    rgb = (rgb <= 0.04045) * rgb / 12.92 + (rgb > 0.04045) * ((rgb + 0.055) / 1.055) ** 2.4
    mean = rgb.mean(axis=0)
    rgb = (mean + (rgb - mean) * STONE_CONTRAST) * (lin(PALETTE["cc_stone"][0]) / mean)
    a[:, :3] = rgb
    img = new_image("cc_stone_albedo", src.size[0])
    img.pixels.foreach_set(a.ravel())
    bpy.data.images.remove(src)
    return img


def albedo(nt, name, stone):
    """The part's colour as a shader socket: box-mapped marble, brushed brass, or the palette."""
    n, link = nt.nodes, nt.links
    if name == "cc_stone":
        tc, mp, tex = n.new("ShaderNodeTexCoord"), n.new("ShaderNodeMapping"), n.new("ShaderNodeTexImage")
        mp.inputs["Scale"].default_value = (1 / STONE_TILE,) * 3
        tex.image, tex.projection, tex.projection_blend = stone, "BOX", 0.25
        link.new(tc.outputs["Object"], mp.inputs["Vector"])
        link.new(mp.outputs["Vector"], tex.inputs["Vector"])
        return tex.outputs["Color"], None
    if name == "cc_brass":
        # Fine vertical streaks: noise stretched up the mullions.
        tc, mp, noise = n.new("ShaderNodeTexCoord"), n.new("ShaderNodeMapping"), n.new("ShaderNodeTexNoise")
        mp.inputs["Scale"].default_value = (900, 900, 6)
        noise.inputs["Detail"].default_value = 6
        link.new(tc.outputs["Object"], mp.inputs["Vector"])
        link.new(mp.outputs["Vector"], noise.inputs["Vector"])
        tint = n.new("ShaderNodeMix")
        tint.data_type = "RGBA"
        tint.inputs["A"].default_value = (*[c * 0.78 for c in lin(PALETTE[name][0])], 1)
        tint.inputs["B"].default_value = (*[min(1, c * 1.2) for c in lin(PALETTE[name][0])], 1)
        link.new(noise.outputs["Fac"], tint.inputs["Factor"])
        rough = n.new("ShaderNodeMapRange")
        rough.inputs["To Min"].default_value, rough.inputs["To Max"].default_value = 0.26, 0.5
        link.new(noise.outputs["Fac"], rough.inputs["Value"])
        return tint.outputs["Result"], rough.outputs["Result"]
    rgb = n.new("ShaderNodeRGB")
    rgb.outputs[0].default_value = (*lin(PALETTE[name][0]), 1)
    return rgb.outputs[0], None


def run_bake(ob, img, kind, uv, **kw):
    nt = ob.active_material.node_tree
    node = nt.nodes.new("ShaderNodeTexImage")
    node.image = img
    nt.nodes.active = node
    select_only(ob)
    bpy.ops.object.bake(type=kind, uv_layer=uv, margin=4, use_clear=True, **kw)
    nt.nodes.remove(node)


def gltf_output(nt):
    """The exporter's glTF Material Output group, for the occlusion map."""
    g = bpy.data.node_groups.get("glTF Material Output")
    if not g:
        g = bpy.data.node_groups.new("glTF Material Output", "ShaderNodeTree")
        g.interface.new_socket("Occlusion", in_out="INPUT", socket_type="NodeSocketFloat")
    node = nt.nodes.new("ShaderNodeGroup")
    node.node_tree = g
    return node


def bake(scene, coll):
    import numpy as np
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = 128
    scene.render.bake.margin_type = "EXTEND"
    world = bpy.data.worlds.new("bake")
    world.use_nodes = True
    scene.world = world
    world.light_settings.distance = AO_DISTANCE
    sky = world.node_tree.nodes["Background"]

    # A ground for the bake only, so the base darkens where it meets the plaza.
    gm = bpy.data.meshes.new("bake_ground")
    gm.from_pydata([(-4, -4, 0), (4, -4, 0), (4, 4, 0), (-4, 4, 0)], [], [(0, 1, 2, 3)])
    ground = bpy.data.objects.new("bake_ground", gm)
    scene.collection.objects.link(ground)
    gmat = bpy.data.materials.new("bake_ground")
    gmat.use_nodes = True
    gmat.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (*lin("#c9c3b4"), 1)
    gm.materials.append(gmat)

    obs = {o.name: o for o in coll.objects}
    uv = {name: bake_uvs(ob) for name, ob in obs.items()}
    stone = graded_stone()
    sources = {}
    for name, ob in obs.items():
        nt = ob.active_material.node_tree
        bsdf = nt.nodes["Principled BSDF"]
        col, rough = albedo(nt, name, stone)
        sources[name] = (col, rough)
        nt.links.new(col, bsdf.inputs["Base Color"])
        if rough:
            nt.links.new(rough, bsdf.inputs["Roughness"])

    # 1. Soft occlusion for every part.
    ao = {}
    for name, ob in obs.items():
        ao[name] = new_image(f"{name}_ao_bake", BAKE_SIZE[name])
        run_bake(ob, ao[name], "AO", uv[name])

    # 2. Window glow alone: a black sky, the offices and lobby lit warm.
    sky.inputs["Strength"].default_value = 0
    for name, (hexa, strength) in WINDOW_LIGHT.items():
        b = obs[name].active_material.node_tree.nodes["Principled BSDF"]
        b.inputs["Emission Color"].default_value = (*lin(hexa), 1)
        b.inputs["Emission Strength"].default_value = strength
    scene.cycles.samples = 256
    glow = {}
    for name in GLOW_PARTS:
        glow[name] = new_image(f"{name}_glow_bake", BAKE_SIZE[name])
        run_bake(obs[name], glow[name], "DIFFUSE", uv[name], pass_filter={"DIRECT", "INDIRECT", "COLOR"})
    # One scale for both, so the stone and the sills glow alike. The typical lit slab face reaches
    # full warmth (the bay right over the lobby is brighter still and clips), so the spill reads
    # on every floor at night, not only by the entrance.
    stone_glow = pixels(glow["cc_stone"])[:, :3]
    lum = stone_glow.max(axis=1)
    peak = float(np.percentile(lum[lum > 1e-3], GLOW_PERCENTILE)) if (lum > 1e-3).any() else 1.0
    for name in WINDOW_LIGHT:
        obs[name].active_material.node_tree.nodes["Principled BSDF"].inputs["Emission Strength"].default_value = 0

    # 3. The final colour: the part's albedo darkened by its occlusion, baked through an emission.
    finals = {}
    for name, ob in obs.items():
        size = BAKE_SIZE[name]
        if name in SEE_THROUGH:
            finals[name] = {"ao": final_image(f"{name}_occlusion", pixels(ao[name]), size, srgb=False)}
            continue
        nt = ob.active_material.node_tree
        n, link = nt.nodes, nt.links
        aon, uvn = n.new("ShaderNodeTexImage"), n.new("ShaderNodeUVMap")
        aon.image, uvn.uv_map = ao[name], uv[name]
        link.new(uvn.outputs["UV"], aon.inputs["Vector"])
        shade = n.new("ShaderNodeMix")
        shade.data_type = "RGBA"
        shade.inputs["A"].default_value = (*SHADOW, 1)
        shade.inputs["B"].default_value = (1, 1, 1, 1)
        link.new(aon.outputs["Color"], shade.inputs["Factor"])
        mul = n.new("ShaderNodeMix")
        mul.data_type, mul.blend_type = "RGBA", "MULTIPLY"
        mul.inputs["Factor"].default_value = 1
        link.new(sources[name][0], mul.inputs["A"])
        link.new(shade.outputs["Result"], mul.inputs["B"])
        emit, out = n.new("ShaderNodeEmission"), n.new("ShaderNodeOutputMaterial")
        link.new(mul.outputs["Result"], emit.inputs["Color"])
        link.new(emit.outputs["Emission"], out.inputs["Surface"])
        nt.nodes.active = out
        out.is_active_output = True
        color = new_image(f"{name}_color_bake", size)
        run_bake(ob, color, "EMIT", uv[name])
        finals[name] = {"color": final_image(f"{name}_color", pixels(color), size)}
        if sources[name][1]:
            link.new(sources[name][1], emit.inputs["Color"])
            rough = new_image(f"{name}_rough_bake", size)
            run_bake(ob, rough, "EMIT", uv[name])
            finals[name]["rough"] = final_image(f"{name}_roughness", pixels(rough), size, srgb=False)
        if name in glow:
            g = pixels(glow[name])
            g[:, :3] /= peak
            finals[name]["glow"] = final_image(f"{name}_glow", g, size)

    # 4. Final materials: the baked maps on the bake UVs, the palette's roughness and metalness.
    for name, ob in obs.items():
        hexa, r, m = PALETTE[name]
        mat = ob.active_material
        nt = mat.node_tree
        nt.nodes.clear()
        n, link = nt.nodes, nt.links
        bsdf, out = n.new("ShaderNodeBsdfPrincipled"), n.new("ShaderNodeOutputMaterial")
        link.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
        bsdf.inputs["Base Color"].default_value = (*lin(hexa), 1)
        bsdf.inputs["Roughness"].default_value = r
        bsdf.inputs["Metallic"].default_value = m
        uvn = n.new("ShaderNodeUVMap")
        uvn.uv_map = uv[name]

        def tex(img, socket, channel=None):
            t = n.new("ShaderNodeTexImage")
            t.image = img
            link.new(uvn.outputs["UV"], t.inputs["Vector"])
            if channel is None:
                link.new(t.outputs["Color"], socket)
            else:
                sep = n.new("ShaderNodeSeparateColor")
                link.new(t.outputs["Color"], sep.inputs["Color"])
                link.new(sep.outputs[channel], socket)

        f = finals[name]
        if "color" in f:
            tex(f["color"], bsdf.inputs["Base Color"])
        if "rough" in f:
            tex(f["rough"], bsdf.inputs["Roughness"], "Green")
        if "glow" in f:
            tex(f["glow"], bsdf.inputs["Emission Color"])
            bsdf.inputs["Emission Strength"].default_value = 1
        if "ao" in f:
            tex(f["ao"], gltf_output(nt).inputs["Occlusion"], "Red")

    # Only the packed finals stay in the file.
    keep = {img for f in finals.values() for img in f.values()}
    for img in list(bpy.data.images):
        if img not in keep:
            bpy.data.images.remove(img)
    bpy.data.objects.remove(ground)
    bpy.data.meshes.remove(gm)
    bpy.data.materials.remove(gmat)
    bpy.data.worlds.remove(world)


def fix_occlusion_uvs(path):
    """The exporter writes the glass's occlusion map on its first UVs (the window grid); point it at
    the second, the bake UVs. Only the GLB's JSON chunk changes."""
    import struct
    with open(path, "rb") as f:
        data = f.read()
    n = struct.unpack_from("<I", data, 12)[0]
    gltf = json.loads(data[20:20 + n])
    for m in gltf["materials"]:
        if m["name"] in SEE_THROUGH and "occlusionTexture" in m:
            m["occlusionTexture"]["texCoord"] = 1
    text = json.dumps(gltf, separators=(",", ":")).encode()
    text += b" " * (-len(text) % 4)
    rest = data[20 + n:]
    out = struct.pack("<III", 0x46546C67, 2, 12 + 8 + len(text) + len(rest)) + struct.pack("<II", len(text), 0x4E4F534A) + text + rest
    with open(path, "wb") as f:
        f.write(out)


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

    bake(scene, coll)

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
        export_image_format="JPEG",
        export_image_quality=88,
        export_cameras=False,
        export_lights=False,
        export_extras=False,
        export_animations=False,
        export_draco_mesh_compression_enable=False,
    )
    fix_occlusion_uvs(GLB)
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
