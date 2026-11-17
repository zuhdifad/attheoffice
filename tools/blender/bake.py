"""Bake the office doll into engine sheets.

    /Applications/Blender.app/Contents/MacOS/Blender --background \
        --python tools/blender/bake.py -- --name zuhdi

Stage 1 scope: idle (4 frames) and walk (6) across the four direction rows,
packed at both LODs. Eleven actions is the target; the sheet is already 36
columns wide so adding the rest is a pose library, not a format change.

Camera: orthographic, pitched 12 degrees down, orbiting +Z. One camera pose per
row, so the four directions are real geometry views and handed props will stay
correct once they exist. The lights are parented to the camera, which keeps the
key on the same side of the face in every row.

Packing: native renders at 128x192 (near) and 64x96 (far), blitted 1:1 into a
4-row sheet. Nothing is upscaled or resampled — the near sheet is exactly what
the game draws at ppu 4, the far sheet exactly what it draws at ppu 2.

Pure stdlib for the pixel work: Blender 4.5.10's bundled numpy is broken on
this Intel/macOS build.
"""

import argparse
import json
import math
import os
import sys
from array import array

import bpy
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import rig  # noqa: E402  (lives beside this file)

CELLS_X = 47                       # idle4 walk6 sit5 sitidle4 type4 talk6 sip10 wave4 phone4
ROWS = [("down", 0), ("left", 90), ("right", 270), ("up", 180)]
ACTIONS = [("idle", 0, rig.IDLE_FRAMES), ("walk", 4, rig.WALK_FRAMES),
           ("sit", 10, rig.SIT_FRAMES), ("sitidle", 15, rig.SITIDLE_FRAMES),
           ("type", 19, rig.TYPE_FRAMES), ("talk", 23, rig.TALK_FRAMES),
           ("sip", 29, rig.SIP_FRAMES), ("wave", 39, rig.WAVE_FRAMES),
           ("phone", 43, rig.PHONE_FRAMES)]
LODS = {"near": (128, 192), "far": (64, 96)}
PITCH = 10.0
EXTENT = 48.0                      # 48 world units tall -> 192 px at 4 px/unit


def parse_args():
    argv = sys.argv
    argv = argv[argv.index("--") + 1:] if "--" in argv else []
    p = argparse.ArgumentParser(prog="bake")
    p.add_argument("--name", default="zuhdi")
    p.add_argument("--look", default=None, help="rig.LOOKS key; defaults to --name")
    p.add_argument("--out", default=os.path.join(HERE, "out"))
    p.add_argument("--samples", type=int, default=48)
    p.add_argument("--only", default="near,far", help="comma separated LODs")
    p.add_argument("--no-face", action="store_true",
                   help="skip baked eyes/brows/mouth; runtime expressions own the face")
    p.add_argument("--anchors-only", action="store_true",
                   help="pose every cell and write anchors.json without rendering")
    p.add_argument("--save-cells", action="store_true",
                   help="keep the per-frame renders beside the sheet")
    return p.parse_args(argv)


# ---- scene -----------------------------------------------------------------

def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = 48
    scene.cycles.use_adaptive_sampling = False
    scene.cycles.use_denoising = False
    scene.cycles.max_bounces = 2
    scene.cycles.diffuse_bounces = 2
    scene.cycles.glossy_bounces = 0
    scene.cycles.transmission_bounces = 0
    scene.cycles.transparent_max_bounces = 2
    scene.cycles.caustics_reflective = False
    scene.cycles.caustics_refractive = False
    scene.render.film_transparent = True
    scene.render.resolution_percentage = 100
    scene.render.filter_size = 0.01          # no anti-aliasing: hard pixels
    scene.render.dither_intensity = 0.0
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.image_settings.color_depth = "8"
    scene.render.image_settings.compression = 100
    scene.view_settings.view_transform = "Standard"   # literal palette
    scene.view_settings.look = "None"
    scene.view_settings.exposure = 0.0
    scene.view_settings.gamma = 1.0
    return scene


def add_world(scene):
    world = bpy.data.worlds.new("World")
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    bg.inputs[0].default_value = (0.42, 0.46, 0.56, 1.0)
    bg.inputs[1].default_value = 0.55
    scene.world = world


def add_camera(scene):
    data = bpy.data.cameras.new("Cam")
    data.type = "ORTHO"
    data.sensor_fit = "VERTICAL"
    data.ortho_scale = EXTENT
    data.clip_start = 1.0
    data.clip_end = 400.0
    cam = bpy.data.objects.new("Cam", data)
    scene.collection.objects.link(cam)
    scene.camera = cam
    return cam


def add_lights(cam):
    """Parented to the camera so every yaw gets the same relative key."""
    key = bpy.data.lights.new("Key", type="SUN")
    key.energy = 3.6
    key.angle = math.radians(9.0)
    ko = bpy.data.objects.new("Key", key)
    bpy.context.scene.collection.objects.link(ko)
    ko.parent = cam
    ko.rotation_euler = (math.radians(-42.0), 0.0, math.radians(-28.0))

    fill = bpy.data.lights.new("Fill", type="SUN")
    fill.energy = 1.35
    fill.angle = math.radians(35.0)
    fo = bpy.data.objects.new("Fill", fill)
    bpy.context.scene.collection.objects.link(fo)
    fo.parent = cam
    fo.rotation_euler = (math.radians(20.0), 0.0, math.radians(60.0))


def camera_pose(cam, yaw, target_z, distance=120.0):
    phi = math.radians(PITCH)
    theta = math.radians(yaw)
    base = Vector((0.0, -math.cos(phi) * distance, math.sin(phi) * distance))
    cam.location = Vector((0.0, 0.0, target_z)) + (Matrix.Rotation(theta, 4, "Z") @ base)
    cam.rotation_euler = (math.radians(90.0 - PITCH), 0.0, theta)


def target_height():
    # a pitched camera pushes the forward shoe toe down the cell by roughly
    # depth*sin(pitch); with the walk stride capped at 21 degrees the contact
    # toe clears the bottom edge by 5 px at 128x192 (2-3 px at 64x96)
    return (EXTENT / 2.0 - 2.0) / math.cos(math.radians(PITCH))


# ---- render ----------------------------------------------------------------

def lowest_z(body):
    """World z of the lowest deformed vertex of the posed doll."""
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    ev = body.evaluated_get(dg)
    me = ev.to_mesh()
    mw = ev.matrix_world
    z = min((mw @ v.co).z for v in me.vertices)
    ev.to_mesh_clear()
    return z


def ground(arm, body):
    """Drop or lift the whole rig so the lowest sole sits exactly on z=0.

    Without IK the walk pose can lift both feet at contact. Clamping per frame
    is deterministic, keeps the stance shoe on the floor line and turns the
    leftover geometry into the vertical bob the walk should have had.
    """
    z = lowest_z(body)
    rig.move(arm, "root", (0, 0, -z))
    bpy.context.view_layer.update()


def head_anchor(scene, cam, arm, cw, ch):
    """Head pivot, face-box size and facing for one posed cell.

    Normalised 0..1 cell coordinates (y down), so one table serves both LODs:
    the camera framing is identical at 128x192 and 64x96. The pivot is the
    skull centre carried by the head bone, so it tracks every pose and the
    ground clamp. facing is the skull's -Y forward dotted with the view ray:
    ~1 face-on, ~0 profile, negative means the back of the head.
    """
    bpy.context.view_layer.update()
    pb = arm.pose.bones["head"]
    # pose delta in world space: rest-space points ride the bone correctly
    delta = arm.matrix_world @ pb.matrix @ pb.bone.matrix_local.inverted()
    pivot = delta @ Vector((0.0, -0.2, rig.HEAD_Z))
    ndc = world_to_camera_view(scene, cam, pivot)
    right = cam.matrix_world.to_quaternion() @ Vector((1, 0, 0))
    up = cam.matrix_world.to_quaternion() @ Vector((0, 1, 0))
    s = arm.scale[0]
    rx, ry, rz = rig.HEAD_W * s, rig.HEAD_D * s, rig.HEAD_H * s
    # exact projected half-extent of the skull ellipsoid on each camera axis
    bx = 2 * math.sqrt((rx * right.x) ** 2 + (ry * right.y) ** 2 + (rz * right.z) ** 2)
    by = 2 * math.sqrt((rx * up.x) ** 2 + (ry * up.y) ** 2 + (rz * up.z) ** 2)
    forward = (delta.to_3x3() @ Vector((0, -1, 0))).normalized()
    view = (cam.location - pivot).normalized()
    # ortho_scale is vertical-fit: the cell spans EXTENT * cw/ch world units
    # horizontally, so x normalises against that, y against EXTENT
    return {
        "pivot": [round(ndc.x, 4), round(1.0 - ndc.y, 4)],
        "box": [round(bx * ch / (EXTENT * cw), 4), round(by / EXTENT, 4)],
        "facing": round(forward.dot(view), 3),
    }


def render_cell(scene, path, w, h):
    scene.render.resolution_x = w
    scene.render.resolution_y = h
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    if not os.path.exists(path):
        raise SystemExit(f"render produced nothing: {path}")
    return path


def read_png(path):
    img = bpy.data.images.load(path)
    w, h = img.size
    px = array("f", bytes(w * h * 4 * 4))
    img.pixels.foreach_get(px)
    cs = img.colorspace_settings.name
    bpy.data.images.remove(img)
    return w, h, px, cs


def bbox(w, h, px):
    minx, miny, maxx, maxy, solid = w, h, -1, -1, 0
    for y in range(h):
        row = y * w * 4
        for x in range(w):
            if px[row + x * 4 + 3] > 0.02:
                solid += 1
                minx = min(minx, x)
                maxx = max(maxx, x)
                miny = min(miny, y)
                maxy = max(maxy, y)
    if maxx < 0:
        return None, 0
    # convert bottom-up Blender rows to top-down sprite rows
    return [minx, h - 1 - maxy, maxx, h - 1 - miny], solid


def save_image(path, w, h, px, colorspace):
    img = bpy.data.images.new(os.path.basename(path), width=w, height=h,
                              alpha=True, float_buffer=True)
    img.colorspace_settings.name = colorspace
    img.pixels.foreach_set(px)
    img.filepath_raw = path
    img.file_format = "PNG"
    img.save()
    bpy.data.images.remove(img)


def pack_sheet(cells, cell_w, cell_h, preview_cols, out_path, preview_path):
    sheet_w = CELLS_X * cell_w
    sheet_h = len(ROWS) * cell_h
    sheet = array("f", bytes(sheet_w * sheet_h * 4 * 4))
    cs = "sRGB"

    for dir_index, _yaw in enumerate(ROWS):
        y_base = (len(ROWS) - 1 - dir_index) * cell_h   # row 0 is the top row
        for action, col0, frames in ACTIONS:
            for f in range(frames):
                col = col0 + f
                w, h, px, cs = cells[(dir_index, action, f)]
                if w != cell_w or h != cell_h:
                    raise SystemExit(f"cell size drift: {action}{f} is {w}x{h}")
                for y in range(h):
                    src = y * w * 4
                    dst = ((y_base + y) * sheet_w + col * cell_w) * 4
                    sheet[dst:dst + w * 4] = px[src:src + w * 4]

    save_image(out_path, sheet_w, sheet_h, sheet, cs)

    pw, ph = preview_cols * cell_w, sheet_h
    preview = array("f", bytes(pw * ph * 4 * 4))
    for y in range(ph):
        src = (y * sheet_w) * 4
        dst = (y * pw) * 4
        preview[dst:dst + pw * 4] = sheet[src:src + pw * 4]
    save_image(preview_path, pw, ph, preview, cs)
    return sheet_w, sheet_h


def variance(values):
    return max(values) - min(values) if values else 0


# ---- main ------------------------------------------------------------------

def check_and_write_anchors(out_dir, name, face, anchors):
    """Gate the anchor table, then write <name>-anchors.json beside the sheet.

    A pivot outside the cell or a wrong facing sign means the camera or the
    pose moved and the runtime face would land off the skull.
    """
    bad = []
    for dname, actions in anchors.items():
        for action, frames in actions.items():
            for f, a in enumerate(frames):
                px_, py_ = a["pivot"]
                if not (0.0 <= px_ <= 1.0 and 0.0 <= py_ <= 1.0):
                    bad.append(f"{dname}/{action}{f} pivot off-cell {a['pivot']}")
                if dname == "down" and a["facing"] < 0.8:
                    bad.append(f"{dname}/{action}{f} facing {a['facing']} (want ~1)")
                if dname == "up" and a["facing"] > -0.8:
                    bad.append(f"{dname}/{action}{f} facing {a['facing']} (want ~-1)")
    if bad:
        raise SystemExit("anchor QA failed:\n  " + "\n  ".join(bad))
    down_idle = anchors["down"]["idle"][0]
    print(f"INFO anchors: {sum(len(v) for acts in anchors.values() for v in acts.values())} cells, "
          f"down idle0 pivot {down_idle['pivot']} box {down_idle['box']} "
          f"facing {down_idle['facing']}")
    anchors_path = os.path.join(out_dir, f"{name}-anchors.json")
    with open(anchors_path, "w") as fh:
        json.dump({"name": name, "face": face,
                   "space": "normalized-cell, y down", "dirs": anchors}, fh, indent=2)
    print(f"INFO anchors -> {anchors_path}")


def main():
    args = parse_args()
    look = args.look or args.name
    if look not in rig.LOOKS:
        raise SystemExit(f"no look {look!r}; have {sorted(rig.LOOKS)}")
    out_dir = os.path.join(os.path.abspath(args.out), args.name)
    cell_dir = os.path.join(out_dir, "cells")
    os.makedirs(cell_dir, exist_ok=True)

    scene = reset_scene()
    scene.cycles.samples = args.samples
    add_world(scene)
    cam = add_camera(scene)
    add_lights(cam)

    doll = rig.build(look=look, face=not args.no_face)
    arm = doll["arm"]
    body = doll["body"]
    tz = target_height()
    print(f"INFO rig built: {len(arm.pose.bones)} bones, frame z "
          f"{tz - EXTENT / 2:.2f}..{tz + EXTENT / 2:.2f}, "
          f"face {'baked' if not args.no_face else 'runtime'}")

    if args.anchors_only:
        # Anchors are pure posed geometry: the table for sheets already on
        # disk regenerates in seconds, no pixels touched.
        cw, ch = LODS["near"]
        anchors = {}
        for dname, yaw in ROWS:
            camera_pose(cam, yaw, tz)
            for action, col0, frames in ACTIONS:
                for f in range(frames):
                    rig.reset(arm)
                    rig.POSES[action][1](arm, f)
                    ground(arm, body)
                    anchors.setdefault(dname, {}).setdefault(action, []).append(
                        head_anchor(scene, cam, arm, cw, ch))
        check_and_write_anchors(out_dir, args.name,
                                "runtime" if args.no_face else "baked", anchors)
        return

    lods = [l for l in args.only.split(",") if l in LODS]
    manifest = {
        "name": args.name,
        "look": look,
        "units": {"height": rig.H, "head": rig.HEAD, "heads": 5,
                  "seat_z": rig.SEAT_Z, "tile": 32},
        "camera": {"mode": "ortho", "pitch_deg": PITCH, "extent": EXTENT,
                   "target_z": round(tz, 3),
                   "frame_bottom_z": round(tz - EXTENT / 2, 3),
                   "frame_top_z": round(tz + EXTENT / 2, 3)},
        "rows": [{"dir": d, "yaw": y} for d, y in ROWS],
        "actions": {a: {"col": c, "frames": n} for a, c, n in ACTIONS},
        "sheet_cols": CELLS_X,
        "face": "runtime" if args.no_face else "baked",
        "anchors": {},
        "lod": {},
        "qa": {},
        "files": [],
    }

    for lod_index, lod in enumerate(lods):
        cw, ch = LODS[lod]
        cells = {}
        qa = []
        for dir_index, (dname, yaw) in enumerate(ROWS):
            camera_pose(cam, yaw, tz)
            for action, col0, frames in ACTIONS:
                for f in range(frames):
                    rig.reset(arm)
                    rig.POSES[action][1](arm, f)
                    for pname, prop in doll["props"].items():
                        prop.hide_render = rig.ACTION_PROP.get(action) != pname
                    ground(arm, body)
                    # Anchors are normalised and the framing is LOD-free, so
                    # one pass computes the table both sheets share.
                    if lod_index == 0:
                        manifest["anchors"].setdefault(dname, {}).setdefault(action, [])
                        manifest["anchors"][dname][action].append(
                            head_anchor(scene, cam, arm, cw, ch))
                    stem = f"{dname}_{action}_{f}"
                    path = os.path.join(cell_dir, f"{stem}_{lod}.png")
                    render_cell(scene, path, cw, ch)
                    w, h, px, cs = read_png(path)
                    box, solid = bbox(w, h, px)
                    if solid == 0:
                        print(f"WARN: {lod} {stem} is empty")
                    qa.append({"dir": dname, "action": action, "frame": f,
                               "box": box, "solid": solid})
                    cells[(dir_index, action, f)] = (w, h, px, cs)
                    if not args.save_cells:
                        os.remove(path)
            print(f"INFO {lod}: row {dname} rendered")

        sheet_path = os.path.join(out_dir, f"{args.name}-{lod}.png")
        preview_path = os.path.join(out_dir, f"preview-{lod}.png")
        used_cols = max(c + n for _a, c, n in ACTIONS)
        sw, sh = pack_sheet(cells, cw, ch, used_cols, sheet_path, preview_path)
        manifest["lod"][lod] = {"cell": [cw, ch], "sheet": [sw, sh],
                                "ppu": cw / 32.0, "file": os.path.basename(sheet_path),
                                "preview": os.path.basename(preview_path)}
        manifest["files"] += [os.path.basename(sheet_path),
                              os.path.basename(preview_path)]

        # feet on the floor line and head pivot steady are the two checks that
        # catch camera drift before it reaches the engine
        rows_qa = {}
        for dname, _yaw in ROWS:
            sel = [q for q in qa if q["dir"] == dname and q["box"]]
            rows_qa[dname] = {
                "top_rows": [q["box"][1] for q in sel],
                "foot_rows": [q["box"][3] for q in sel],
                "top_spread": variance([q["box"][1] for q in sel]),
                "foot_spread": variance([q["box"][3] for q in sel]),
                "solid_min": min((q["solid"] for q in sel), default=0),
                "solid_max": max((q["solid"] for q in sel), default=0),
            }
        manifest["qa"][lod] = {"rows": rows_qa, "cells": qa}
        print(f"INFO {lod}: sheet {sw}x{sh} -> {sheet_path}")
        for dname, r in rows_qa.items():
            print(f"     {dname:5s} head_top {r['top_rows']} (spread {r['top_spread']}px) "
                  f"foot {r['foot_rows']} (spread {r['foot_spread']}px)")

    # Anchor gates: a pivot outside the cell or a wrong facing sign means the
    # camera or the pose moved and the runtime face would land off the skull.
    check_and_write_anchors(out_dir, args.name, manifest["face"], manifest["anchors"])
    manifest["files"].append(f"{args.name}-anchors.json")

    with open(os.path.join(out_dir, f"{args.name}-sheet.json"), "w") as fh:
        json.dump(manifest, fh, indent=2)
    print(f"INFO manifest -> {os.path.join(out_dir, args.name + '-sheet.json')}")


if __name__ == "__main__":
    main()
