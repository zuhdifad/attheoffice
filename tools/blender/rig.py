"""The office doll: one chibi build shared by the whole cast.

Everything here is authored in game world units, not metres. One tile is 32 and
a standing body is 45, so a rig loaded beside a room needs no scale fiddle: the
floor is z=0 and the crown lands at 45.5.

The build is a doll, not a person: rigid parts layered on fixed anchors, each
part welded 100% to one bone. That is deliberate. A 5-head figure has no room
for smooth joint weights, and a rigid limb reads cleaner at 128x192 than a
pinched skin. Parts overlap at every joint so rotation never opens a seam.

Directions are not built into the mesh. The figure faces -Y and the baker
orbits the camera around +Z, which keeps handed props and lighting correct in
all four rows for free (see bake.py).

Run through bake.py; this module is imported inside Blender.
"""

import math

import bpy
from mathutils import Quaternion, Vector

# ---- proportions -----------------------------------------------------------
# 5 heads over 45 units, so a head is 9 and the whole cast shares a frame no
# matter how tall the person is: build variation is bone scale in build(), not
# a different mesh scale.
H = 45.0
HEAD = H / 5.0
HEAD_Z = H - HEAD * 0.5
HEAD_W = 4.3
HEAD_D = 4.3
HEAD_H = 4.6

SEAT_Z = 12.0          # chair seat surface, world units above the floor


def srgb(hex_color):
    """Blender colours are linear; the palette is authored in sRGB."""
    h = hex_color.lstrip("#")
    out = []
    for i in (0, 2, 4):
        u = int(h[i:i + 2], 16) / 255.0
        out.append(u / 12.92 if u <= 0.04045 else ((u + 0.055) / 1.055) ** 2.4)
    return tuple(out)


LOOKS = {
    "zuhdi": {
        "skin": "#c4885f",
        "hair": "#241d1a",
        "top": "#e9e6df",
        "bottom": "#3b3e49",
        "shoe": "#23242a",
        "trim": "#b9b4a9",
        "eye": "#221a15",
        "mouth": "#8d4a3e",
        "hair_style": "short",
        "scale": 1.0,
    },
    "alicia": {
        "skin": "#a77e5a", "hair": "#282828", "top": "#23242a",
        "bottom": "#23242a", "shoe": "#17181d", "trim": "#d9a441",
        "hair_style": "long", "scale": 0.97,
    },
    "anna": {
        "skin": "#885e46", "hair": "#282828", "top": "#8a2a1a",
        "bottom": "#d2c6ba", "shoe": "#1e121e",
        "hair_style": "long", "scale": 0.95,
    },
    "janice": {
        "skin": "#d19d7a", "hair": "#483828", "top": "#363636",
        "bottom": "#363636", "shoe": "#12121e",
        "hair_style": "long", "scale": 0.96,
    },
    "phat": {
        "skin": "#a77350", "hair": "#181818", "top": "#dedede",
        "bottom": "#2a2a2a", "shoe": "#5a362a",
        "hair_style": "short", "scale": 0.98,
    },
    "philip": {
        "skin": "#b27e5a", "hair": "#181818", "top": "#8a8a8a",
        "bottom": "#727272", "shoe": "#120612",
        "hair_style": "short", "scale": 1.0,
    },
    "suhendri": {
        "skin": "#b27e5a", "hair": "#181818", "top": "#5a1e2a",
        "bottom": "#666666", "shoe": "#2a2a2a",
        "hair_style": "short", "scale": 0.99,
    },
    "takuya": {
        "skin": "#c7926f", "hair": "#1e121e", "top": "#666666",
        "bottom": "#2a2a2a", "shoe": "#1e1e1e",
        "hair_style": "short", "scale": 0.97,
    },
    "tracy": {
        "skin": "#c78865", "hair": "#383838", "top": "#c6ae7e",
        "bottom": "#1e1e1e", "shoe": "#a27e4e",
        "hair_style": "long", "scale": 0.97,
    },
    "ayu": {
        "skin": "#c7926f", "hair": "#382818", "top": "#b45f6f",
        "bottom": "#121212", "shoe": "#121212",
        "hair_style": "long", "scale": 0.94,
    },
    "raja-aqilah": {
        "skin": "#c78865", "hair": "#1a1a1a", "top": "#1e1e1e",
        "bottom": "#1e1e1e", "shoe": "#121212",
        "hair_style": "hijab", "scale": 0.95,
    },
    "aaron": {
        "skin": "#bc8865", "hair": "#362a36", "top": "#1e1e1e",
        "bottom": "#1e1e1e", "shoe": "#121212",
        "hair_style": "short", "scale": 0.99,
    },
    "max": {
        "skin": "#bc8865", "hair": "#181818", "top": "#2a2a2a",
        "bottom": "#2a2a2a", "shoe": "#2a2a2a", "trim": "#2a3a5a",
        "hair_style": "short", "scale": 1.0,
    },
}

# Bones, in parent-first order: name, head, tail, parent.
BONES = [
    ("root", (0, 0, 0), (0, 0, 3), None),
    ("hips", (0, 0, 20.5), (0, 0, 23.5), "root"),
    ("spine", (0, 0, 23.5), (0, 0, 27.5), "hips"),
    ("chest", (0, 0, 27.5), (0, 0, 34.2), "spine"),
    ("neck", (0, 0, 34.2), (0, 0, 36.4), "chest"),
    ("head", (0, 0, 36.4), (0, 0, 45.3), "neck"),
    ("shoulder.L", (1.8, 0, 33.5), (5.3, 0, 32.6), "chest"),
    ("upper_arm.L", (5.3, 0, 32.6), (6.5, 0, 27.2), "shoulder.L"),
    ("forearm.L", (6.5, 0, 27.2), (7.0, -0.2, 22.7), "upper_arm.L"),
    ("hand.L", (7.0, -0.2, 22.7), (7.1, -0.6, 20.6), "forearm.L"),
    ("thigh.L", (2.4, 0, 21.0), (2.55, 0, 11.9), "hips"),
    ("shin.L", (2.55, 0, 11.9), (2.6, -0.2, 3.6), "thigh.L"),
    ("foot.L", (2.6, -0.2, 3.6), (2.6, -4.5, 1.2), "shin.L"),
]

# Mirror the left side to the right. X flips; the name suffix does too.
for _n, _h, _t, _p in list(BONES):
    if _n.endswith(".L"):
        BONES.append((
            _n[:-2] + ".R",
            (-_h[0], _h[1], _h[2]),
            (-_t[0], _t[1], _t[2]),
            _p[:-2] + ".R" if _p and _p.endswith(".L") else _p,
        ))


# ---- materials -------------------------------------------------------------

def material(name, rgb, rough=0.95, emission=0.0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    mat.diffuse_color = (*rgb, 1.0)
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*rgb, 1.0)
    bsdf.inputs["Roughness"].default_value = rough
    for key in ("Specular IOR Level", "Specular"):
        if key in bsdf.inputs:
            bsdf.inputs[key].default_value = 0.0
    if emission > 0:
        for key in ("Emission Color", "Emission"):
            if key in bsdf.inputs:
                bsdf.inputs[key].default_value = (*rgb, 1.0)
                break
        if "Emission Strength" in bsdf.inputs:
            bsdf.inputs["Emission Strength"].default_value = emission
    return mat


# ---- meshes ----------------------------------------------------------------

def _obj(name, verts, faces, mat, bone, parts):
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.validate()
    me.update()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    ob.data.materials.append(mat)
    vg = ob.vertex_groups.new(name=bone)
    vg.add(list(range(len(verts))), 1.0, "REPLACE")
    parts.append(ob)
    return ob


def box(name, center, size, mat, bone, parts, rot_x=0.0):
    cx, cy, cz = center
    sx, sy, sz = (s / 2.0 for s in size)
    corners = [(-sx, -sy, -sz), (sx, -sy, -sz), (sx, sy, -sz), (-sx, sy, -sz),
               (-sx, -sy, sz), (sx, -sy, sz), (sx, sy, sz), (-sx, sy, sz)]
    r = math.radians(rot_x)
    c, s = math.cos(r), math.sin(r)
    verts = []
    for x, y, z in corners:
        y, z = y * c - z * s, y * s + z * c
        verts.append((cx + x, cy + y, cz + z))
    faces = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4),
             (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    return _obj(name, verts, faces, mat, bone, parts)


def sphere(name, center, radii, mat, bone, parts, seg=12, rings=8):
    cx, cy, cz = center
    rx, ry, rz = radii
    verts = [(cx, cy, cz + rz)]
    for i in range(1, rings):
        phi = math.pi * i / rings
        sp, cp = math.sin(phi), math.cos(phi)
        for j in range(seg):
            th = 2 * math.pi * j / seg
            verts.append((cx + rx * sp * math.cos(th),
                          cy + ry * sp * math.sin(th),
                          cz + rz * cp))
    verts.append((cx, cy, cz - rz))
    bottom = len(verts) - 1
    faces = []
    for j in range(seg):
        faces.append((0, 1 + j, 1 + (j + 1) % seg))
    for i in range(rings - 2):
        a = 1 + i * seg
        b = a + seg
        for j in range(seg):
            jn = (j + 1) % seg
            faces.append((a + j, b + j, b + jn, a + jn))
    a = 1 + (rings - 2) * seg
    for j in range(seg):
        faces.append((bottom, a + (j + 1) % seg, a + j))
    return _obj(name, verts, faces, mat, bone, parts)


def prism(name, a, b, ra, rb, mat, bone, parts, sides=8, squash=(1.0, 1.0)):
    """Tapered limb between two joints; the octagon reads round at 4 px/unit."""
    a, b = Vector(a), Vector(b)
    axis = (b - a).normalized()
    ref = Vector((0, 0, 1)) if abs(axis.z) < 0.92 else Vector((0, 1, 0))
    u = axis.cross(ref).normalized()
    v = axis.cross(u).normalized()
    verts = []
    for centre, r in ((a, ra), (b, rb)):
        for i in range(sides):
            th = 2 * math.pi * i / sides
            verts.append(tuple(centre + u * (math.cos(th) * r * squash[0])
                               + v * (math.sin(th) * r * squash[1])))
    faces = []
    for i in range(sides):
        j = (i + 1) % sides
        faces.append((i, j, sides + j, sides + i))
    faces.append(tuple(reversed(range(sides))))
    faces.append(tuple(range(sides, 2 * sides)))
    return _obj(name, verts, faces, mat, bone, parts)


def face_oval(name, head_center, radii, az, el, r_az, r_el, mat, bone, parts,
              lift=0.012, n=12):
    """Oval decal on the skull. Used for eyes and mouth: a rounded mark reads
    as a feature at 64x96 where a rectangle reads as a pair of glasses."""
    cx, cy, cz = head_center
    rx, ry, rz = radii
    verts = [(cx + rx * (1 + lift) * math.cos(el) * math.cos(az),
              cy + ry * (1 + lift) * math.cos(el) * math.sin(az),
              cz + rz * (1 + lift) * math.sin(el))]
    for i in range(n):
        t = 2 * math.pi * i / n
        a = az + r_az * math.cos(t)
        e = el + r_el * math.sin(t)
        verts.append((cx + rx * (1 + lift) * math.cos(e) * math.cos(a),
                      cy + ry * (1 + lift) * math.cos(e) * math.sin(a),
                      cz + rz * (1 + lift) * math.sin(e)))
    faces = [(0, 1 + i, 1 + (i + 1) % n) for i in range(n)]
    return _obj(name, verts, faces, mat, bone, parts)


def face_patch(name, head_center, radii, az, el, d_az, d_el, mat, bone, parts,
               lift=0.012, nu=4, nv=4):
    """A decal that follows the skull, in head-ellipsoid angles (radians).

    Solid features read as goggles in the 90-degree row; a surface patch is
    visible from the front and collapses to a sliver in profile, which is what
    a painted eye does. `az` is measured from +X, so the face front is -pi/2.
    """
    cx, cy, cz = head_center
    rx, ry, rz = radii
    verts = []
    for iv in range(nv + 1):
        e = el + d_el * (iv / nv - 0.5)
        ce, se = math.cos(e), math.sin(e)
        for iu in range(nu + 1):
            a = az + d_az * (iu / nu - 0.5)
            verts.append((cx + rx * (1 + lift) * ce * math.cos(a),
                          cy + ry * (1 + lift) * ce * math.sin(a),
                          cz + rz * (1 + lift) * se))
    faces = []
    for iv in range(nv):
        for iu in range(nu):
            a = iv * (nu + 1) + iu
            b = a + nu + 1
            faces.append((a, a + 1, b + 1, b))
    return _obj(name, verts, faces, mat, bone, parts)


def hair_shell(name, center, radii, mat, bone, parts, seg=18, rings=7,
               rim=(4.45, 4.15, 4.7)):
    """A cap that follows the skull instead of a slab across the brow.

    The rim height varies with azimuth: high over the forehead, low at the nape,
    which is what a fringe looks like from every camera row. A second, tighter
    rim ring gives the edge visible thickness, so no view shows a paper cutout.
    """
    cx, cy, cz = center
    rx, ry, rz = radii

    def phi_max(theta):
        return math.radians(86.0 + 26.0 * math.sin(theta))

    def at(radii3, theta, phi):
        return (cx + radii3[0] * math.sin(phi) * math.cos(theta),
                cy + radii3[1] * math.sin(phi) * math.sin(theta),
                cz + radii3[2] * math.cos(phi))

    verts = [(cx, cy, cz + rz)]
    for i in range(1, rings + 1):
        t = i / rings
        for j in range(seg):
            th = 2 * math.pi * j / seg
            verts.append(at(radii, th, phi_max(th) * t))
    rim_start = len(verts)
    for j in range(seg):
        th = 2 * math.pi * j / seg
        verts.append(at(rim, th, phi_max(th)))

    faces = []
    for j in range(seg):
        faces.append((0, 1 + j, 1 + (j + 1) % seg))
    for i in range(rings - 1):
        a = 1 + i * seg
        b = a + seg
        for j in range(seg):
            jn = (j + 1) % seg
            faces.append((a + j, b + j, b + jn, a + jn))
    a = 1 + (rings - 1) * seg
    for j in range(seg):
        faces.append((a + j, rim_start + j, rim_start + (j + 1) % seg,
                      a + (j + 1) % seg))
    return _obj(name, verts, faces, mat, bone, parts)


def loft(name, rings, mat, bone, parts, sides=12):
    """Torso stack: (z, half-width, half-depth) rings, capped top and bottom."""
    verts = []
    for z, hw, hd in rings:
        for i in range(sides):
            th = 2 * math.pi * i / sides
            verts.append((math.cos(th) * hw, math.sin(th) * hd, z))
    faces = []
    for r in range(len(rings) - 1):
        a, b = r * sides, (r + 1) * sides
        for i in range(sides):
            j = (i + 1) % sides
            faces.append((a + i, a + j, b + j, b + i))
    faces.append(tuple(reversed(range(sides))))
    faces.append(tuple(range((len(rings) - 1) * sides, len(rings) * sides)))
    return _obj(name, verts, faces, mat, bone, parts)


# ---- build -----------------------------------------------------------------

def build(look="zuhdi", scale=None, face=True):
    """Build the doll in rest pose. Returns {'body', 'arm', 'mats'}.

    `scale` is build variation — a 0.96 taller/narrower or 1.04 heavier read —
    applied to the armature only, so the mesh follows the bones and every
    character still fits the same camera frame. Defaults to the look's preset.
    `face=False` drops the eyes/brows/mouth decals: the runtime expression
    layers own the face, and a baked feature underneath would double-draw.
    """
    spec = LOOKS[look]
    if scale is None:
        scale = spec.get("scale", 1.0)
    M = {
        "skin": material("skin", srgb(spec["skin"])),
        "hair": material("hair", srgb(spec["hair"])),
        "top": material("top", srgb(spec["top"])),
        "bottom": material("bottom", srgb(spec["bottom"])),
        "shoe": material("shoe", srgb(spec["shoe"])),
        "trim": material("trim", srgb(spec.get("trim", spec["top"]))),
        "eye": material("eye", srgb(spec.get("eye", "#221a15")), emission=0.35),
        "white": material("white", srgb("#f2ede2"), emission=0.45),
        "mouth": material("mouth", srgb(spec.get("mouth", "#8d4a3e")), emission=0.2),
        "sole": material("sole", srgb("#17181d")),
        "coffee": material("coffee", srgb("#5a3a26")),
        "phone": material("phone", srgb("#2b2f36")),
    }

    parts = []

    # torso: pelvis and shirt as separate rigid masses with an overlap band, so
    # the waist can twist without a hole opening at the seam
    loft("pelvis", [(20.2, 4.15, 3.1), (21.6, 4.45, 3.3), (23.4, 3.9, 2.9)],
         M["bottom"], "hips", parts)
    box("belt", (0, 0, 23.8), (8.6, 6.6, 0.9), M["shoe"], "hips", parts)
    loft("torso", [(23.0, 4.0, 2.9), (25.5, 3.95, 3.0), (29.0, 4.55, 3.3),
                   (32.2, 5.15, 3.5), (34.4, 4.7, 3.3)],
         M["top"], "chest", parts)
    prism("neck", (0, 0, 34.0), (0, 0, 36.5), 1.55, 1.45, M["skin"], "neck", parts)

    # head + face. Features are decals laid on the skull surface, so they read
    # from the front, collapse in profile and never break the silhouette. The
    # face materials are emissive so the light cannot shade the expression away
    # at 64x96.
    sphere("head", (0, -0.2, HEAD_Z), (HEAD_W, HEAD_D, HEAD_H),
           M["skin"], "head", parts, seg=14, rings=10)
    head_c = (0, -0.2, HEAD_Z)
    head_r = (HEAD_W, HEAD_D, HEAD_H)
    for sx in (-1, 1):
        sphere("ear", (sx * 4.18, -0.1, 40.4), (0.65, 1.05, 1.35),
               M["skin"], "head", parts, seg=8, rings=6)
        if face:
            az = -math.pi / 2 + sx * 0.407          # x = +-1.7 on the skull
            face_oval("eye", head_c, head_r, az, 0.011, 0.16, 0.20,
                      M["eye"], "head", parts, lift=0.012)
            face_oval("glint", head_c, head_r, az + sx * 0.05, 0.091,
                      0.035, 0.045, M["white"], "head", parts, lift=0.024, n=8)
            face_patch("brow", head_c, head_r, az, 0.356, 0.384, 0.07,
                       M["hair"], "head", parts, lift=0.018)
    sphere("nose", (0, -4.25, 39.65), (0.35, 0.42, 0.4),
           M["skin"], "head", parts, seg=8, rings=6)
    if face:
        face_oval("mouth", head_c, head_r, -math.pi / 2, -0.438, 0.14, 0.028,
                  M["mouth"], "head", parts, lift=0.02)

    # hair: a fitted cap, high over the brow and low at the nape, with volume
    # behind the crown. No boolean cuts, so it can never ship an open shell.
    hair_shell("hair", (0, -0.1, 40.55), (4.75, 4.75, 4.95),
               M["hair"], "head", parts)

    style = spec.get("hair_style", "short")
    if style == "long":
        box("hair_back", (0, 3.7, 35.6), (7.9, 2.3, 11.5), M["hair"], "head", parts)
        for sx, sfx in ((1, ".L"), (-1, ".R")):
            box("hair_side" + sfx, (sx * 4.15, -0.4, 37.2), (1.5, 3.6, 8.6),
                M["hair"], "head", parts)
    elif style == "hijab":
        box("hijab_back", (0, 3.5, 34.8), (9.6, 2.6, 13.5), M["hair"], "head", parts)
        for sx, sfx in ((1, ".L"), (-1, ".R")):
            box("hijab_side" + sfx, (sx * 4.35, -0.8, 36.6), (1.7, 4.8, 10.4),
                M["hair"], "head", parts)
        box("hijab_brow", (0, -3.9, 43.6), (8.2, 1.8, 1.5), M["hair"], "head", parts)
        box("hijab_drape", (0, 2.9, 30.6), (9.0, 2.2, 5.0), M["hair"], "chest", parts)

    # arms
    for sx, sfx in ((1, ".L"), (-1, ".R")):
        s = (sx * 5.1, 0, 32.4)
        e = (sx * 6.5, 0, 27.2)
        w = (sx * 7.0, -0.2, 22.7)
        sphere("shoulder" + sfx, s, (1.42, 1.42, 1.42), M["top"], "upper_arm" + sfx, parts)
        prism("upper_arm" + sfx, s, e, 1.55, 1.3, M["top"], "upper_arm" + sfx, parts)
        sphere("elbow" + sfx, e, (1.28, 1.28, 1.28), M["skin"], "upper_arm" + sfx, parts)
        prism("forearm" + sfx, e, w, 1.3, 1.05, M["skin"], "forearm" + sfx, parts)
        sphere("hand" + sfx, (sx * 7.1, -0.6, 21.4), (1.05, 1.2, 1.4),
               M["skin"], "hand" + sfx, parts, seg=8, rings=6)

    # legs
    for sx, sfx in ((1, ".L"), (-1, ".R")):
        hip = (sx * 2.4, 0, 21.0)
        knee = (sx * 2.55, 0, 11.9)
        ankle = (sx * 2.6, -0.2, 3.6)
        prism("thigh" + sfx, hip, knee, 2.15, 1.72, M["bottom"], "thigh" + sfx, parts)
        sphere("knee" + sfx, knee, (1.72, 1.72, 1.72), M["bottom"], "thigh" + sfx, parts)
        prism("shin" + sfx, knee, ankle, 1.72, 1.22, M["bottom"], "shin" + sfx, parts)
        sphere("ankle" + sfx, (sx * 2.6, -0.2, 2.9), (1.3, 1.3, 1.3),
               M["shoe"], "foot" + sfx, parts, seg=8, rings=6)
        box("shoe" + sfx, (sx * 2.6, -1.3, 1.35), (2.7, 5.8, 2.3),
            M["shoe"], "foot" + sfx, parts)
        box("sole" + sfx, (sx * 2.6, -1.3, 0.3), (2.85, 6.0, 0.6),
            M["sole"], "foot" + sfx, parts)

    # join the doll into one skinned mesh; vertex groups carry the rigidity
    bpy.ops.object.select_all(action="DESELECT")
    for ob in parts:
        ob.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    body = bpy.context.active_object
    body.name = "Body"

    # armature
    arm_data = bpy.data.armatures.new("Rig")
    arm = bpy.data.objects.new("Rig", arm_data)
    bpy.context.scene.collection.objects.link(arm)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="EDIT")
    edit = {}
    for name, head, tail, parent in BONES:
        eb = arm_data.edit_bones.new(name)
        eb.head = head
        eb.tail = tail
        eb.roll = 0.0
        eb.use_connect = False
        edit[name] = eb
    for name, _h, _t, parent in BONES:
        if parent:
            edit[name].parent = edit[parent]
    bpy.ops.object.mode_set(mode="OBJECT")

    if scale != 1.0:
        # uniform build variation: bones grow, the mesh follows, the camera
        # does not. One scale for the whole silhouette keeps the 5-head read.
        arm.scale = (scale, scale, scale)

    body.parent = arm
    mod = body.modifiers.new("Armature", "ARMATURE")
    mod.object = arm
    mod.use_vertex_groups = True

    # handheld props: separate objects weighted to the right hand so the baker
    # can show them only for the actions that carry them. They are NOT joined
    # into Body, so the ground clamp (which reads Body) ignores them.
    props = {}
    for pname, builder in (
        ("cup", lambda p: (
            box("cup", (-7.1, -2.6, 21.8), (2.0, 2.0, 2.6), M["white"], "hand.R", p),
            box("coffee", (-7.1, -2.6, 23.0), (1.6, 1.6, 0.3), M["coffee"], "hand.R", p))),
        ("phone", lambda p: (
            box("phone", (-7.4, -1.2, 22.2), (0.6, 1.8, 3.2), M["phone"], "hand.R", p))),
    ):
        pp = []
        builder(pp)
        bpy.ops.object.select_all(action="DESELECT")
        for ob in pp:
            ob.select_set(True)
        bpy.context.view_layer.objects.active = pp[0]
        bpy.ops.object.join()
        prop = bpy.context.active_object
        prop.name = pname
        prop.parent = arm
        pm = prop.modifiers.new("Armature", "ARMATURE")
        pm.object = arm
        pm.use_vertex_groups = True
        prop.hide_render = True
        props[pname] = prop

    return {"body": body, "arm": arm, "mats": M, "props": props}


# ---- posing ----------------------------------------------------------------
# Angles are world-axis degrees applied in the bone's rest frame, so a leg
# swing is always about the same axis no matter how the bone points or what
# roll Blender gave it.
#   +X pitches a bone towards -Y (forward, since the doll faces -Y)
#   +Y rolls, +Z yaws.

def reset(arm):
    for pb in arm.pose.bones:
        pb.rotation_mode = "QUATERNION"
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.location = (0, 0, 0)
        pb.scale = (1, 1, 1)


def rot(arm, bone, x=0.0, y=0.0, z=0.0):
    pb = arm.pose.bones[bone]
    basis = pb.bone.matrix_local.to_3x3()
    inv = basis.inverted()
    q = Quaternion()
    for axis, angle in ((Vector((1, 0, 0)), x),
                        (Vector((0, 1, 0)), y),
                        (Vector((0, 0, 1)), z)):
        if angle:
            q = q @ Quaternion(inv @ axis, math.radians(angle))
    pb.rotation_mode = "QUATERNION"
    pb.rotation_quaternion = q


def move(arm, bone, v):
    pb = arm.pose.bones[bone]
    pb.location = pb.bone.matrix_local.to_3x3().inverted() @ Vector(v)


IDLE_FRAMES = 4
WALK_FRAMES = 6


def pose_idle(arm, f):
    p = 2 * math.pi * f / IDLE_FRAMES
    breath = math.sin(p)
    sway = math.cos(p)
    rot(arm, "chest", x=1.4 * breath, z=0.6 * sway)
    rot(arm, "spine", x=0.6 * breath)
    rot(arm, "head", x=-1.0 * breath, z=-0.8 * sway)
    rot(arm, "upper_arm.L", x=1.8 * breath, z=2.2)
    rot(arm, "upper_arm.R", x=1.8 * breath, z=-2.2)
    rot(arm, "forearm.L", x=-7)
    rot(arm, "forearm.R", x=-7)
    rot(arm, "thigh.L", y=1.2)
    rot(arm, "thigh.R", y=-1.2)


def pose_walk(arm, f):
    p = 2 * math.pi * f / WALK_FRAMES
    s = math.sin(p)

    # legs: thigh swings the stride, knee bends only through the swing half and
    # peaks just after toe-off, foot cancels most of the ankle angle so the
    # sole stays near the floor line in the contact poses
    th_l = -21.0 * s
    th_r = 21.0 * s
    kn_l = 30.0 * max(0.0, -math.sin(p - 0.9))
    kn_r = 30.0 * max(0.0, -math.sin(p + math.pi - 0.9))
    rot(arm, "thigh.L", x=th_l)
    rot(arm, "thigh.R", x=th_r)
    rot(arm, "shin.L", x=kn_l)
    rot(arm, "shin.R", x=kn_r)
    # the sole stays level: the rig has no IK, so cancelling the thigh+knee
    # angle keeps the shoe flat and lets the baker ground-clamp the stance foot
    rot(arm, "foot.L", x=-(th_l + kn_l))
    rot(arm, "foot.R", x=-(th_r + kn_r))

    # arms counter-swing the legs, elbows held with a little bend
    rot(arm, "upper_arm.L", x=20.0 * s, z=3.0)
    rot(arm, "upper_arm.R", x=-20.0 * s, z=-3.0)
    rot(arm, "forearm.L", x=-12 - 7 * max(0.0, -s))
    rot(arm, "forearm.R", x=-12 - 7 * max(0.0, s))

    # body: pelvis yaws with the stride, chest counters, small vertical bob at
    # the passing pose, constant forward lean
    rot(arm, "hips", z=5.0 * s)
    rot(arm, "spine", x=3.0, z=-2.0 * s)
    rot(arm, "chest", z=-4.0 * s)
    rot(arm, "head", x=-2.0, z=3.0 * s)
    # the ground clamp already drops the body as the legs angle away from
    # vertical; adding a hip drop on top doubles the bob, so only the lateral
    # weight shift is keyed here
    move(arm, "hips", (0.3 * s, 0, 0))


SIT_FRAMES = 5
SITIDLE_FRAMES = 4
TYPE_FRAMES = 4
TALK_FRAMES = 6
SIP_FRAMES = 10
WAVE_FRAMES = 4
PHONE_FRAMES = 4


def seated(arm, arms="thighs"):
    """Hips at SEAT_Z, thighs horizontal, shins vertical, soles flat. The chair
    itself is a world prop; the doll only supplies the body on top of it."""
    move(arm, "hips", (0, 0, -(20.5 * arm.scale[0] - SEAT_Z)))
    for sfx in (".L", ".R"):
        rot(arm, "thigh" + sfx, x=-88)
        rot(arm, "shin" + sfx, x=88)
        rot(arm, "foot" + sfx, x=0)
    rot(arm, "spine", x=3)
    if arms == "thighs":
        rot(arm, "upper_arm.L", x=-25, z=2)
        rot(arm, "upper_arm.R", x=-25, z=-2)
        rot(arm, "forearm.L", x=-55)
        rot(arm, "forearm.R", x=-55)
    elif arms == "type":
        rot(arm, "upper_arm.L", x=-45, z=2)
        rot(arm, "upper_arm.R", x=-45, z=-2)
        rot(arm, "forearm.L", x=-45)
        rot(arm, "forearm.R", x=-45)


def pose_sit(arm, f):
    t = (0.0, 0.25, 0.6, 0.9, 1.0)[f]
    move(arm, "hips", (0, 0, -(20.5 - SEAT_Z) * t))
    for sfx in (".L", ".R"):
        rot(arm, "thigh" + sfx, x=-88 * t)
        rot(arm, "shin" + sfx, x=88 * t)
        rot(arm, "foot" + sfx, x=0)
    rot(arm, "spine", x=3 * t)
    rot(arm, "upper_arm.L", x=-25 * t, z=2)
    rot(arm, "upper_arm.R", x=-25 * t, z=-2)
    rot(arm, "forearm.L", x=-55 * t)
    rot(arm, "forearm.R", x=-55 * t)
    rot(arm, "head", x=2 * t)


def pose_sitidle(arm, f):
    p = 2 * math.pi * f / SITIDLE_FRAMES
    breath = math.sin(p)
    seated(arm)
    rot(arm, "chest", x=1.2 * breath)
    rot(arm, "head", x=3 - 0.8 * breath)


def pose_type(arm, f):
    seated(arm, arms="type")
    tap = 4 if f % 2 == 0 else -4
    rot(arm, "forearm.L", x=-45 + tap)
    rot(arm, "forearm.R", x=-45 - tap)
    rot(arm, "head", x=8)
    rot(arm, "chest", x=2)


def pose_talk(arm, f):
    ua = (-15, -60, -85, -70, -40, -15)[f]
    fa = (-20, -50, -35, -55, -30, -20)[f]
    rot(arm, "upper_arm.R", x=ua, z=-3)
    rot(arm, "forearm.R", x=fa)
    rot(arm, "upper_arm.L", x=1.8, z=2.2)
    rot(arm, "forearm.L", x=-7)
    s = math.sin(2 * math.pi * f / TALK_FRAMES)
    rot(arm, "head", x=-2, z=3 * s)
    rot(arm, "chest", z=-2 * s)


def pose_sip(arm, f):
    ua, fa, hx, wx = (
        (-10, -20, 0, 0), (-30, -50, 0, 0), (-60, -80, -2, 0),
        (-95, -110, -6, -10), (-100, -115, -12, -20), (-100, -115, -12, -20),
        (-95, -110, -6, -10), (-60, -80, -2, 0), (-30, -50, 0, 0),
        (-10, -20, 0, 0))[f]
    rot(arm, "upper_arm.R", x=ua, z=-3)
    rot(arm, "forearm.R", x=fa)
    rot(arm, "hand.R", x=wx)
    rot(arm, "head", x=hx)
    rot(arm, "upper_arm.L", x=1.8, z=2.2)
    rot(arm, "forearm.L", x=-7)


def pose_wave(arm, f):
    ua = (-120, -160, -160, -160)[f]
    hz = (0, 25, -25, 25)[f]
    rot(arm, "upper_arm.R", x=ua, z=-6)
    rot(arm, "forearm.R", x=-15)
    rot(arm, "hand.R", z=hz)
    rot(arm, "head", z=-4)
    rot(arm, "upper_arm.L", x=1.8, z=2.2)
    rot(arm, "forearm.L", x=-7)


def pose_phone(arm, f):
    ua = (-60, -140, -140, -140)[f]
    fa = (-40, -70, -70, -70)[f]
    rot(arm, "upper_arm.R", x=ua, z=-4)
    rot(arm, "forearm.R", x=fa)
    rot(arm, "head", z=-6 if f else 0, x=-2 if f == 2 else 0)
    rot(arm, "upper_arm.L", x=1.8, z=2.2)
    rot(arm, "forearm.L", x=-7)


POSES = {
    "idle": (IDLE_FRAMES, pose_idle),
    "walk": (WALK_FRAMES, pose_walk),
    "sit": (SIT_FRAMES, pose_sit),
    "sitidle": (SITIDLE_FRAMES, pose_sitidle),
    "type": (TYPE_FRAMES, pose_type),
    "talk": (TALK_FRAMES, pose_talk),
    "sip": (SIP_FRAMES, pose_sip),
    "wave": (WAVE_FRAMES, pose_wave),
    "phone": (PHONE_FRAMES, pose_phone),
}

# which handheld prop each action shows
ACTION_PROP = {"sip": "cup", "phone": "phone"}
