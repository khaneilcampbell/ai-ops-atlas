"""Business Operations HQ and its Vendor & Supplier Hub annex (Khaneil, 2026-11-24).

Builds the editable Blender source (.blend) and the runtime GLB the map loads
(public/models/map/business-operations-hq.glb). Reference: the HQ concept board
(green glass and warm stone mid-rise, central atrium, gold accents, terraces, lobby)
in docs/business-operations-hq/.

Units are Atlas map units. The origin is the centre of the HQ footprint at ground level;
Blender -Y is the map's +z (the street side), so the lobby faces -Y. Every part joins into
one mesh per material per building, so the whole model costs about a dozen draw calls.
Object names start with `hq_` (Business Operations HQ) or `annex_` (Vendor & Supplier Hub,
including the covered walkway); the map gives each prefix its own click target.

Run:  blender --background --python assets/business-operations-hq/build_business_operations_hq.py -- <out_dir>
  or: python -c "import bpy" with the bpy module (same script, `python <script> <out_dir>`).
"""
import math, os, sys
import bpy, bmesh

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
OUT = os.path.abspath(argv[0] if argv else os.path.join(os.path.dirname(__file__), "out"))
os.makedirs(OUT, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

# ---- Palette (concept board). Metals stay low: the map has no environment map, so a fully
# metallic gold or glass renders near black there. -------------------------------------------------------------
def material(name, color, metal=0.0, rough=0.5, emit=None, strength=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    p = m.node_tree.nodes["Principled BSDF"]
    p.inputs["Base Color"].default_value = (*color, 1)
    p.inputs["Metallic"].default_value = metal
    p.inputs["Roughness"].default_value = rough
    if emit:
        p.inputs["Emission Color"].default_value = (*emit, 1)
        p.inputs["Emission Strength"].default_value = strength
    return m

def srgb(h):
    h = h.lstrip("#"); c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)

MAT = {
    "glass": material("boh_green_glass", srgb("#1f5a4a"), metal=0.2, rough=0.15),
    "atrium": material("boh_atrium_glass", srgb("#2f6e5a"), metal=0.15, rough=0.1, emit=srgb("#ffd79a"), strength=0.06),
    "stone": material("boh_warm_stone", srgb("#e7dcc6"), rough=0.7),
    "gold": material("boh_gold", srgb("#d4a94c"), metal=0.35, rough=0.35),
    "green": material("boh_terrace_green", srgb("#5f9a3c"), rough=0.9),
    "frame": material("boh_dark_frame", srgb("#163b31"), metal=0.3, rough=0.45),
    "glow": material("boh_lobby_glow", srgb("#f3d9a6"), emit=srgb("#ffcf86"), strength=1.2),
    "asphalt": material("boh_asphalt", srgb("#4b5150"), rough=0.95),
    "bloom": material("boh_bloom", srgb("#9a6fc2"), rough=0.85),
}

parts = {}  # (building, material) -> list of objects

def box(building, mat, x0, x1, y0, y1, z0, z1):
    """Axis-aligned box from min/max corners (map units)."""
    bpy.ops.mesh.primitive_cube_add(size=1, location=((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2))
    o = bpy.context.active_object
    o.scale = (abs(x1 - x0), abs(y1 - y0), abs(z1 - z0))
    o.data.materials.append(MAT[mat])
    parts.setdefault((building, mat), []).append(o)
    return o

def cyl(building, mat, x, y, z0, z1, r, n=8):
    bpy.ops.mesh.primitive_cylinder_add(vertices=n, radius=r, depth=z1 - z0, location=(x, y, (z0 + z1) / 2))
    o = bpy.context.active_object; o.data.materials.append(MAT[mat])
    parts.setdefault((building, mat), []).append(o); return o

def tree(building, x, y, z, s=1.0):
    cyl(building, "frame", x, y, z, z + 0.28 * s, 0.035 * s, 5)
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=0.26 * s, location=(x, y, z + 0.42 * s))
    o = bpy.context.active_object; o.data.materials.append(MAT["green"])
    parts.setdefault((building, "green"), []).append(o)

def torus(building, mat, x, y, z, R, r, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_torus_add(major_radius=R, minor_radius=r, major_segments=16, minor_segments=4, location=(x, y, z), rotation=rot)
    o = bpy.context.active_object; o.data.materials.append(MAT[mat])
    parts.setdefault((building, mat), []).append(o)

# ---- Business Operations HQ --------------------------------------------------------------
F = 0.7                        # storey height
PW, PD, PH = 9.6, 6.0, 3 * F   # podium: width (x), depth (y), height
TW, TD, TY = 6.0, 4.2, 0.5     # tower: width, depth, centre offset toward the back (+Y)
TOP = PH + 9 * F               # tower roof
H = "hq"

# Podium: glass floors between stone slabs, stone corner piers, a gold fin rhythm on the front.
box(H, "glass", -PW / 2 + .05, PW / 2 - .05, -PD / 2 + .05, PD / 2 - .05, 0, PH)
for i in range(4):
    z = i * F
    box(H, "stone", -PW / 2 - .04, PW / 2 + .04, -PD / 2 - .04, PD / 2 + .04, z - (.04 if i else 0), z + .06)
for sx in (-1, 1):
    for sy in (-1, 1):
        box(H, "stone", sx * PW / 2 - .2, sx * PW / 2 + .2, sy * PD / 2 - .2, sy * PD / 2 + .2, 0, PH + .1)
for x in [-4.2, -3.5, -2.8, 2.8, 3.5, 4.2]:
    box(H, "gold", x - .035, x + .035, -PD / 2 - .09, -PD / 2 - .02, .08, PH)
for y in [-2.0, -1.0, 0.0, 1.0, 2.0]:
    for sx in (-1, 1):
        box(H, "gold", sx * PW / 2 + (.02 if sx > 0 else -.09), sx * PW / 2 + (.09 if sx > 0 else -.02), y - .035, y + .035, .08, PH)
# Lit offices behind the podium glass.
box(H, "glow", -PW / 2 + .2, PW / 2 - .2, -PD / 2 + .2, PD / 2 - .2, F + .1, F + .45)

# Podium roof terraces (east and west wings): paving, planters, small trees.
box(H, "stone", -PW / 2, PW / 2, -PD / 2, PD / 2, PH + .08, PH + .14)
for sx in (-1, 1):
    cx = sx * (PW / 2 - 1.15)
    box(H, "green", cx - .85, cx + .85, -PD / 2 + .3, -PD / 2 + .62, PH + .14, PH + .3)
    box(H, "green", sx * PW / 2 - sx * .25 - .16, sx * PW / 2 - sx * .25 + .16, -PD / 2 + .3, PD / 2 - .3, PH + .14, PH + .3)
    tree(H, cx - .45, -PD / 2 + .9, PH + .14, .9); tree(H, cx + .5, -PD / 2 + 1.3, PH + .14, .8); tree(H, sx * (PW / 2 - .5), 1.6, PH + .14, .85)
    box(H, "stone", sx * PW / 2 - .1 - .02, sx * PW / 2 + .1, -PD / 2, PD / 2, PH + .14, PH + .4)  # parapet
# Glass balustrades along the terrace fronts.
box(H, "atrium", -PW / 2, PW / 2, -PD / 2 - .02, -PD / 2 + .02, PH + .14, PH + .42)

# Tower: green glass with a stone band each storey and stone corner columns.
ty0, ty1 = TY - TD / 2, TY + TD / 2
box(H, "glass", -TW / 2 + .05, TW / 2 - .05, ty0 + .05, ty1 - .05, PH, TOP)
for i in range(10):
    z = PH + i * F
    box(H, "stone", -TW / 2 - .02, TW / 2 + .02, ty0 - .02, ty1 + .02, z - .02, z + .03)
for sx in (-1, 1):
    for sy in (ty0, ty1):
        box(H, "stone", sx * TW / 2 - .14, sx * TW / 2 + .14, sy - .14, sy + .14, PH, TOP + .16)
# Gold fins on the tower's east and west faces, dark mullions on the back.
for y in [ty0 + .8, ty0 + 1.6, ty0 + 2.4, ty0 + 3.2]:
    for sx in (-1, 1):
        box(H, "gold", sx * TW / 2 + (.0 if sx > 0 else -.08), sx * TW / 2 + (.08 if sx > 0 else 0), y - .03, y + .03, PH, TOP)
for x in [-2.0, -1.0, 0.0, 1.0, 2.0]:
    box(H, "frame", x - .03, x + .03, ty1, ty1 + .06, PH, TOP)
# Warm office floors seen through the tower glass.
for i in range(1, 9, 2):
    box(H, "glow", -TW / 2 + .15, TW / 2 - .15, ty0 + .15, ty1 - .15, PH + i * F + .1, PH + i * F + .4)

# Central atrium: full-height clear glass bay between two stone pylons, gold fins, a stone crown.
AX, AY0, AY1 = 1.5, -PD / 2 - .05, ty0
box(H, "atrium", -AX, AX, AY0, AY1, 0, TOP)
for x in [-1.0, -.5, 0.0, .5, 1.0]:
    box(H, "gold", x - .03, x + .03, AY0 - .06, AY0, 0, TOP)
for i in range(1, 12):
    box(H, "frame", -AX, AX, AY0 - .05, AY0, i * F - .02, i * F + .02)
for sx in (-1, 1):
    box(H, "stone", sx * AX, sx * (AX + .55), AY0 - .12, AY1, 0, TOP + .9)
box(H, "stone", -AX - .5, AX + .5, AY0 - .1, AY1 + .2, TOP, TOP + .84)            # crown
box(H, "gold", -.35, .35, AY0 - .16, AY0 - .1, TOP + .2, TOP + .7)                     # emblem
box(H, "frame", -.22, .22, AY0 - .19, AY0 - .15, TOP + .32, TOP + .58)
# Hanging gold rings in the atrium void.
for z in (3.0, 5.4):
    torus(H, "gold", 0, (AY0 + AY1) / 2, z, .7, .04)
# Lobby: lit double-height hall, gold canopy over the entrance, doors.
box(H, "glow", -AX + .1, AX - .1, AY0 + .15, AY1 - .1, .02, 1.25)
box(H, "gold", -AX - .7, AX + .7, AY0 - .85, AY0, 1.25, 1.33)
box(H, "frame", -.7, .7, AY0 - .03, AY0 - .01, 0, .9)

# Roof: stone parapet, terrace planting, a gold pergola and a dark plant room.
box(H, "stone", -TW / 2, TW / 2, ty0, ty1, TOP, TOP + .1)
box(H, "frame", .9, 2.7, ty0 + 2.2, ty1 - .25, TOP + .1, TOP + .75)
box(H, "green", -2.7, -.4, ty0 + .3, ty0 + .7, TOP + .1, TOP + .28)
box(H, "green", -2.7, -2.3, ty0 + .7, ty1 - .3, TOP + .1, TOP + .28)
tree(H, -2.2, ty0 + 1.4, TOP + .1, .8); tree(H, -1.3, ty1 - .7, TOP + .1, .75)
for x in (-1.9, -.3):
    for y in (ty0 + 1.1, ty0 + 2.6):
        box(H, "gold", x - .04, x + .04, y - .04, y + .04, TOP + .1, TOP + .85)
for y in [ty0 + 1.1 + k * .25 for k in range(7)]:
    box(H, "gold", -2.05, -.15, y - .03, y + .03, TOP + .85, TOP + .9)

# Forecourt toward the street: paving, a reflecting pool and a gold ring sculpture, planters.
box(H, "stone", -PW / 2 - .4, PW / 2 + .4, -PD / 2 - 3.1, -PD / 2, 0, .03)
box(H, "frame", -1.25, 1.25, -PD / 2 - 2.5, -PD / 2 - 1.3, .03, .1)
box(H, "atrium", -1.15, 1.15, -PD / 2 - 2.4, -PD / 2 - 1.4, .03, .11)
torus(H, "gold", 0, -PD / 2 - 1.9, .42, .3, .035, (math.pi / 2, 0, 0))
torus(H, "gold", 0, -PD / 2 - 1.9, .42, .3, .035, (math.pi / 2, 0, math.pi / 2))
for sx in (-1, 1):
    for x in (2.3, 3.6):
        box(H, "green", sx * x - .45, sx * x + .45, -PD / 2 - 2.2, -PD / 2 - 1.2, .03, .15)
        tree(H, sx * x, -PD / 2 - 1.7, .15, .9)

# ---- Vendor & Supplier Hub annex + covered walkway -----------------------------------------
A = "annex"
AXC, AYC, AW, AD, AF = 9.7, -1.2, 3.4, 3.2, 0.75   # centre (x, y), width, depth, storey
AH = 2 * AF
ax0, ax1, ay0, ay1 = AXC - AW / 2, AXC + AW / 2, AYC - AD / 2, AYC + AD / 2
box(A, "glass", ax0 + .05, ax1 - .05, ay0 + .05, ay1 - .05, 0, AH)
for i in range(3):
    z = i * AF
    box(A, "stone", ax0 - .04, ax1 + .04, ay0 - .04, ay1 + .04, z - (.05 if i else 0), z + .08)
box(A, "stone", ax0 - .04, ax1 + .04, ay0 - .04, ay1 + .04, AH, AH + .22)              # rounded-look roof band
for sx in (ax0, ax1):
    box(A, "stone", sx - .2, sx + .2, ay0 - .05, ay1 + .05, 0, AH + .22)
for x in [ax1 - .9 + k * .18 for k in range(5)]:
    box(A, "gold", x - .04, x + .04, ay0 - .1, ay0 - .03, .08, AH)                       # gold fin panel
box(A, "glow", ax0 + .2, ax1 - .2, ay0 + .2, ay1 - .2, .1, .55)
box(A, "gold", ax0 + .3, ax0 + 1.5, ay0 - .5, ay0, .75, .8)                              # entrance canopy
box(A, "green", ax0 + .2, ax1 - .2, ay0 + .2, ay1 - .2, AH + .22, AH + .3)               # green roof
box(A, "frame", AXC - .6, AXC + .6, AYC - .35, AYC + .55, AH + .3, AH + .48)            # skylight
tree(A, ax0 - .5, ay0 - .5, 0, .9)
# Covered walkway at first-floor level from the HQ podium's east face to the annex.
wx0, wx1, wy = PW / 2, ax0, AYC
box(A, "stone", wx0, wx1, wy - .4, wy + .4, .7, .8)
box(A, "atrium", wx0, wx1, wy - .36, wy + .36, .8, 1.32)
box(A, "frame", wx0, wx1, wy - .42, wy + .42, 1.32, 1.42)
for x in [wx0 + .8, wx1 - .8]:
    box(A, "stone", x - .1, x + .1, wy - .1, wy + .1, 0, .7)


# ---- Site (concept board surroundings) -----------------------------------------------------
# North of the annex: a service yard with a loading dock and box trucks, reached by a service road
# from the street down the annex's east side. North of the HQ: a low two-deck parking garage that
# opens onto the yard. South of the annex: a visitor lot. Lawns, hedges, flowering shrubs and trees
# fill the edges. Kept inside the corner plot: the railway runs about 2 units east and 1 north.
SX0, SX1, SY0, SY1 = -6.1, 13.55, -6.7, 6.95   # site extent (Blender x/y); businessHqPlan.ts BOH_MODEL.site

def cone(building, mat, x, y, z0, h, r, n=6):
    bpy.ops.mesh.primitive_cone_add(vertices=n, radius1=r, radius2=0, depth=h, location=(x, y, z0 + h / 2))
    o = bpy.context.active_object; o.data.materials.append(MAT[mat])
    parts.setdefault((building, mat), []).append(o)

def cypress(building, x, y, s=1.0):
    cyl(building, "frame", x, y, 0, .12 * s, .03 * s, 4)
    cone(building, "green", x, y, .1 * s, .75 * s, .17 * s)

def shrub(building, x, y, s=1.0, mat="green"):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=.13 * s, location=(x, y, .08 * s))
    o = bpy.context.active_object; o.scale = (1, 1, .75); o.data.materials.append(MAT[mat])
    parts.setdefault((building, mat), []).append(o)

def oriented(building, along):
    """Box helper in a vehicle's frame: u across, v along, mapped onto x/y."""
    def b(mat, u0, u1, v0, v1, z0, z1, cx, cy):
        if along == "y": box(building, mat, cx + u0, cx + u1, cy + v0, cy + v1, z0, z1)
        else: box(building, mat, cx + v0, cx + v1, cy + u0, cy + u1, z0, z1)
    return b

def truck(building, x, y, s=1, along="y"):
    """Box truck; (x, y) is the rear door, s = +1/-1 sets which way the cab points."""
    b = oriented(building, along)
    def v(a, c): return (min(s * a, s * c), max(s * a, s * c))
    b("stone", -.26, .26, *v(0, 1.18), .13, .74, x, y)                     # box body
    b("gold", -.27, .27, *v(.1, 1.08), .5, .56, x, y)                      # brand stripe
    b("frame", -.25, .25, *v(1.2, 1.62), .1, .5, x, y)                     # cab
    b("atrium", -.21, .21, *v(1.6, 1.64), .32, .48, x, y)                  # windscreen
    b("frame", -.2, .2, *v(-.04, 1.62), .03, .13, x, y)                    # chassis
    for w in (.22, .95, 1.45):
        for side in (-1, 1):
            b("frame", side * .28 - .04, side * .28 + .04, *v(w - .1, w + .1), 0, .17, x, y)

def car(building, x, y, mat, along="y", z=0.0):
    b = oriented(building, along)
    b(mat, -.12, .12, -.22, .22, z + .03, z + .14, x, y)
    b("atrium", -.1, .1, -.1, .12, z + .14, z + .21, x, y)

def lamp(building, x, y, h=.9):
    cyl(building, "frame", x, y, 0, h, .025, 4)
    box(building, "glow", x - .07, x + .07, y - .07, y + .07, h, h + .06)

# Service road and yard (asphalt), with stone kerbs and bay lines.
RX0, RX1 = 11.7, 12.9
box(H, "asphalt", RX0, RX1, SY0, 0.6, 0, .025)
box(H, "asphalt", 4.9, RX1, 0.6, 6.2, 0, .025)
for y in (SY0 + .4, -2.6, -.4):
    box(H, "stone", RX0 + .55, RX0 + .65, y, y + .7, .025, .03)                 # centre dashes
for x in (8.2, 9.2, 10.2, 11.2):
    box(H, "stone", x - .02, x + .02, 1.7, 4.0, .025, .03)                       # dock bays
# Loading dock on the annex's north face: stone shed, three lit roll-up doors, a gold canopy.
DY0, DY1 = ay1, ay1 + 1.2
box(A, "stone", 8.0, 11.4, DY0, DY1, 0, .95)
box(A, "green", 8.1, 11.3, DY0 + .1, DY1 - .1, .95, 1.0)
box(A, "stone", 8.0, 11.4, DY1, DY1 + .3, 0, .22)                                # dock apron
for x in (8.7, 9.7, 10.7):
    box(A, "frame", x - .34, x + .34, DY1 + .3 - .02, DY1 + .32, .22, .8)         # door
    box(A, "glow", x - .3, x + .3, DY1 + .32, DY1 + .34, .74, .78)                # door light
    box(A, "frame", x - .32, x + .32, DY1 + .3, DY1 + .5, .2, .24)                # bumper
box(A, "gold", 7.9, 11.5, DY1, DY1 + .7, .9, .95)                                 # canopy
TR = DY1 + .55
truck(A, 8.7, TR, 1); truck(A, 10.7, TR, 1)                                      # backed up to the dock
truck(A, 7.0, 5.4, -1, "x")                                                      # turning in the yard
# Parking garage behind the HQ: two open decks between stone slabs, a planted roof deck with cars,
# a gold band and an entry ramp onto the yard.
GX0, GX1, GY0, GY1 = -4.6, 4.5, 3.5, 6.3
box(H, "frame", GX0 + .15, GX1 - .15, GY0 + .15, GY1 - .15, 0, 1.0)              # shaded deck interior
for z in (0, .48, .94):
    box(H, "stone", GX0, GX1, GY0, GY1, z, z + .08)                               # deck slabs
for x in [GX0 + k * (GX1 - GX0) / 6 for k in range(7)]:
    for y in (GY0, GY1):
        box(H, "stone", x - .09, x + .09, y - .09, y + .09, 0, 1.02)              # columns
for y0, y1 in ((GY0 - .02, GY0 + .06), (GY1 - .06, GY1 + .02)):
    box(H, "gold", GX0 - .02, GX1 + .02, y0, y1, 1.02, 1.07)                       # roof band
box(H, "gold", GX1 - .06, GX1 + .02, GY0, GY1, 1.02, 1.07)
box(H, "green", GX0, GX1, GY1 - .2, GY1, 1.02, 1.16)                              # planter edge
box(H, "green", GX0, GX0 + .2, GY0, GY1, 1.02, 1.16)
box(H, "asphalt", GX1, GX1 + .45, GY0 + .5, GY1 - .5, 0, .03)                     # entry
box(H, "gold", GX1 - .02, GX1 + .02, GY0 + .4, GY0 + .9, .55, .9)                 # entry sign
for i, (x, mat) in enumerate(zip([-3.6, -2.7, -1.8, -.4, .5, 1.4, 2.8, 3.7], ["stone", "glass", "gold", "stone", "frame", "glass", "stone", "gold"])):
    car(H, x, 4.3 if i % 2 else 5.5, mat, z=1.02)                                 # roof deck
    car(H, x + .45, 5.5 if i % 2 else 4.3, ["frame", "stone", "glass"][i % 3], z=.48)  # first deck
    for y in (4.3, 5.5):
        box(H, "stone", x + .2, x + .23, y - .28, y + .28, 1.02, 1.025)           # bay lines
# Drop-off drive along the street side, from the street's end to the service road.
box(H, "asphalt", 1.3, RX0, -6.75, -6.15, 0, .025)
for x in (2.6, 4.4, 6.2, 8.0, 9.8):
    box(H, "stone", x, x + .7, -6.47, -6.43, .025, .03)
# Visitor lot south of the annex, opening onto the service road.
LX0, LY0, LY1 = 7.4, -5.95, -3.4
box(H, "asphalt", LX0, RX0, LY0, LY1, 0, .025)
for x in (7.95, 8.55, 9.15, 9.75, 10.35, 10.95):
    box(H, "stone", x - .29, x - .27, -4.4, -3.5, .025, .03)
for x, mat in ((7.95, "stone"), (8.55, "glass"), (9.75, "gold"), (10.35, "stone"), (10.95, "frame")):
    car(H, x, -3.95, mat)
box(H, "green", LX0, RX0, LY0 + .02, LY0 + .2, 0, .22)                            # hedge
box(H, "green", LX0 - .2, LX0, LY0, LY1, 0, .22)
# Lamps along the road, yard and lot.
for x, y in ((RX1 + .15, -5.0), (RX0 - .15, -2.2), (RX1 + .15, 1.0), (6.2, 6.0), (RX1 + .15, 4.4), (9.2, -5.2)):
    lamp(H, x, y)

# Trees and shrubs: a tree line on the road's east verge, cypresses behind the garage, a planted
# west edge toward the Investment Operations Center, lawns between the forecourt and the visitor lot.
for y in (-6.0, -4.4, -2.8, -1.2):
    tree(H, 13.3, y, 0, .85)
for y in (2.3, 3.9):
    cypress(H, 13.3, y, .9)
for x in (-5.8, -3.9, -2.0, -.1, 1.8, 3.7):
    cypress(H, x, 6.75, 1.0)
for y in (-5.6, -4.0, -2.2, -.4, 1.4, 3.2, 5.0):
    tree(H, -5.75, y, 0, .95 if y % 2 else .85)
for x, y, sc in ((6.1, -5.75, 1.0), (6.5, -4.4, .9), (6.0, -2.9, .85), (7.4, 2.6, .8), (5.6, 5.4, .8)):
    tree(H, x, y, 0, sc)
for x, y in ((5.6, -5.4), (6.9, -5.1), (5.7, -3.7), (7.0, -3.5), (-5.2, -6.3), (-5.2, -4.8), (-5.25, -3.1), (-5.25, -1.3),
             (-5.2, .5), (-5.2, 2.3), (-4.9, 6.75), (-2.95, 6.75), (-1.05, 6.75), (.85, 6.75), (2.75, 6.75),
             (ax0 - .2, ay0 - .25), (ax0 + .6, ay0 - .9), (-3.0, -6.4)):
    shrub(H, x, y, 1.0, "bloom")
for x, y in ((6.6, -5.7), (5.5, -4.5), (6.6, -3.0), (-5.3, -5.5), (-5.3, -2.2), (-5.3, 1.4), (-5.3, 4.1), (ax1 - .3, ay0 - .3),
             (4.95, 3.4), (4.95, 2.4), (-1.6, -6.45), (-4.4, -6.45)):
    shrub(H, x, y, 1.15)

# ---- Join per building and material, export ------------------------------------------------
for (b, m), objs in parts.items():
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    if len(objs) > 1: bpy.ops.object.join()
    o = bpy.context.active_object
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    o.name = o.data.name = f"{b}_{m}"

tris = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in bpy.data.objects if o.type == "MESH")
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, "business-operations-hq.blend"))
bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, "business-operations-hq.glb"), export_format="GLB",
                          export_apply=True, export_yup=True, export_cameras=False, export_lights=False,
                          export_extras=False, export_animations=False, export_texcoords=False)
print(f"BOH_BUILD meshes={len(bpy.data.objects)} triangles={tris} out={OUT}")
