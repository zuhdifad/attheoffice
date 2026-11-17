"""Slice a baked monolithic rig sheet into the layered actor atlas.

    python3 tools/slice_rig.py --name zuhdi [--probe]

Reads assets/chars/<name>-rig-near.png (47 cols x 4 rows, 128x192 cells) and
-rig-far.png (64x96 cells) and writes assets/chars/<name>/:

    body@4.png  body@2.png  head@4.png  hair@4.png  face@4.png  meta.json

The runtime contract lives in src/art/rig.js. Layers share the body's cell and
anim grid, so compositing them at one origin reproduces the source cell pixel
for pixel -- the bake asserts that round trip before writing anything.

Only three directions are authored: down, side (the baked RIGHT row) and up.
Left is mirrored from side at draw time, so the baked left row is dropped.

Pure stdlib: Pillow is not installed on this machine, so PNG decode/encode is
done here with zlib (8-bit RGB/RGBA, non-interlaced, all five scanline filters).
"""

import argparse
import json
import os
import struct
import sys
import zlib

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Sheet layout, mirrored from src/core/config.js RIG and tools/blender/bake.py.
COLS = 47
ROW_DIRS = ["down", "left", "right", "up"]
ACTIONS = [
    ("idle", 0, 4), ("walk", 4, 6), ("sit", 10, 5), ("sitidle", 15, 4),
    ("type", 19, 4), ("talk", 23, 6), ("sip", 29, 10), ("wave", 39, 4),
    ("phone", 43, 4),
]
LODS = {"4": ("near", 128, 192), "2": ("far", 64, 96)}

# Free-running playback rates for the contact sheet and any future time-driven
# actor. In game the sim drives walk/idle frames, exactly as the legacy view
# does, so these only matter when nobody is holding the reins.
FPS = {"idle": 6, "walk": 30, "sit": 12, "sitidle": 6, "type": 8,
       "talk": 12, "sip": 12, "wave": 10, "phone": 8}
LOOP = {"idle": True, "walk": True, "sit": False, "sitidle": True, "type": True,
        "talk": True, "sip": False, "wave": False, "phone": True}


# ---- PNG codec ---------------------------------------------------------------

def read_png(path):
    with open(path, "rb") as fh:
        data = fh.read()
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise SystemExit(f"not a PNG: {path}")
    pos = 8
    idat = bytearray()
    w = h = depth = ctype = None
    while pos < len(data):
        (length,) = struct.unpack(">I", data[pos:pos + 4])
        tag = data[pos + 4:pos + 8]
        chunk = data[pos + 8:pos + 8 + length]
        if tag == b"IHDR":
            w, h, depth, ctype, comp, filt, inter = struct.unpack(">IIBBBBB", chunk)
            if depth not in (8, 16) or ctype not in (2, 6) or inter != 0:
                raise SystemExit(f"unsupported PNG format: {path}")
        elif tag == b"IDAT":
            idat += chunk
        elif tag == b"IEND":
            break
        pos += 12 + length
    channels = 4 if ctype == 6 else 3
    sample_bytes = depth // 8
    bpp = channels * sample_bytes
    raw = zlib.decompress(bytes(idat))
    stride = w * bpp
    out = bytearray(w * h * 4)
    prev = bytearray(stride)
    p = 0
    for y in range(h):
        f = raw[p]
        p += 1
        line = bytearray(raw[p:p + stride])
        p += stride
        if f == 1:
            for i in range(bpp, stride):
                line[i] = (line[i] + line[i - bpp]) & 255
        elif f == 2:
            for i in range(stride):
                line[i] = (line[i] + prev[i]) & 255
        elif f == 3:
            for i in range(stride):
                a = line[i - bpp] if i >= bpp else 0
                line[i] = (line[i] + ((a + prev[i]) >> 1)) & 255
        elif f == 4:
            for i in range(stride):
                a = line[i - bpp] if i >= bpp else 0
                b = prev[i]
                c = prev[i - bpp] if i >= bpp else 0
                pa, pb, pc = abs(b - c), abs(a - c), abs(a + b - 2 * c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[i] = (line[i] + pr) & 255
        elif f != 0:
            raise SystemExit(f"bad filter {f} in {path}")
        for x in range(w):
            s = x * bpp
            d = (y * w + x) * 4
            # 16-bit samples are downscaled by their high byte; Blender writes
            # the 8-bit palette value into both bytes, so this is lossless.
            out[d] = line[s]
            out[d + 1] = line[s + sample_bytes]
            out[d + 2] = line[s + 2 * sample_bytes]
            out[d + 3] = line[s + 3 * sample_bytes] if channels == 4 else 255
        prev = line
    return w, h, out


def write_png(path, w, h, px):
    stride = w * 4
    raw = bytearray()
    for y in range(h):
        raw.append(0)
        raw += px[y * stride:(y + 1) * stride]

    def chunk(tag, payload):
        return (struct.pack(">I", len(payload)) + tag + payload
                + struct.pack(">I", zlib.crc32(tag + payload) & 0xFFFFFFFF))

    ihdr = struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0)
    with open(path, "wb") as fh:
        fh.write(b"\x89PNG\r\n\x1a\n")
        fh.write(chunk(b"IHDR", ihdr))
        fh.write(chunk(b"IDAT", zlib.compress(bytes(raw), 9)))
        fh.write(chunk(b"IEND", b""))


# ---- cell helpers ------------------------------------------------------------

def cell(sheet, sw, cw, ch, col, row):
    """Copy one cell out of a packed sheet into its own cw*ch*4 buffer."""
    out = bytearray(cw * ch * 4)
    x0, y0 = col * cw, row * ch
    for y in range(ch):
        s = ((y0 + y) * sw + x0) * 4
        out[y * cw * 4:(y + 1) * cw * 4] = sheet[s:s + cw * 4]
    return out


def paste(sheet, sw, cw, ch, col, row, buf):
    x0, y0 = col * cw, row * ch
    for y in range(ch):
        d = ((y0 + y) * sw + x0) * 4
        sheet[d:d + cw * 4] = buf[y * cw * 4:(y + 1) * cw * 4]


def bbox_top(buf, cw, ch):
    for y in range(ch):
        row = buf[y * cw * 4:(y + 1) * cw * 4]
        if any(row[x * 4 + 3] > 0 for x in range(cw)):
            return y
    return None


def hex_rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def near(c, ref, tol):
    return abs(c[0] - ref[0]) <= tol and abs(c[1] - ref[1]) <= tol and abs(c[2] - ref[2]) <= tol


# ---- probe -------------------------------------------------------------------

def probe(name):
    """Dump a classified ASCII map of one cell so the split can be tuned."""
    path = os.path.join(ROOT, "assets", "chars", f"{name}-rig-near.png")
    sw, sh, sheet = read_png(path)
    cw, ch = 128, 192
    # rig.py imports bpy at module level; pull LOOKS out textually instead.
    src = open(os.path.join(ROOT, "tools", "blender", "rig.py")).read()
    ns = {}
    start = src.index("LOOKS = {")
    end = src.index("\n}", start) + 2
    exec(src[start:end], ns)
    look = ns["LOOKS"][name]
    refs = {k: hex_rgb(look[k]) for k in ("skin", "hair", "eye", "mouth", "top", "bottom", "shoe")}
    print("look refs:", refs)

    for (dir_row, col, label) in [(0, 0, "down idle0"), (0, 4, "down walk0"),
                                  (2, 0, "right idle0"), (3, 0, "up idle0"),
                                  (0, 19, "down type0"), (0, 15, "down sitidle0")]:
        buf = cell(sheet, sw, cw, ch, col, dir_row)
        top = bbox_top(buf, cw, ch)
        print(f"\n== {label}  bbox_top={top}")
        # column profile: for each row, count opaque px and dominant ref
        for y in range(top, min(top + 48, ch)):
            counts = {}
            xs = []
            for x in range(cw):
                d = (y * cw + x) * 4
                if buf[d + 3] <= 8:
                    continue
                c = (buf[d], buf[d + 1], buf[d + 2])
                xs.append(x)
                tag = "?"
                for k, ref in refs.items():
                    if near(c, ref, 26):
                        tag = k[0] if k != "skin" else "K"
                        if k == "shoe":
                            tag = "S"
                        if k == "bottom":
                            tag = "B"
                        if k == "top":
                            tag = "T"
                        if k == "hair":
                            tag = "H"
                        if k == "eye":
                            tag = "E"
                        if k == "mouth":
                            tag = "M"
                        break
                counts[tag] = counts.get(tag, 0) + 1
            dom = sorted(counts.items(), key=lambda kv: -kv[1])
            print(f"y={y:3d} x[{min(xs) if xs else '-':>3}..{max(xs) if xs else '-':>3}] "
                  + " ".join(f"{k}{v}" for k, v in dom))


# ---- layer split -------------------------------------------------------------
# The doll is rigid parts under a camera-parented key, so rendered colours drift
# from the palette hexes but keep their relationships: hair is a dark connected
# mass hanging off the crown, skin is warm and bright, the rim light is white,
# and brows/eyes/mouth are dark islands enclosed by skin. The split is therefore
# geometric + connectivity, not hex matching:
#
#   * the neck line sits a fixed distance below the cell's own bbox top (the
#     head is rigid, so crown-to-shoulder is constant in every pose),
#   * anything below the neck, or outside the head's column band (raised arms),
#     is body,
#   * above the neck: white rim and skin are head, the dark mass connected to
#     the crown is hair, and dark islands below the hairline are face.
#
# The masks partition the cell, so body+head+hair+face composites back to the
# source pixel for pixel. The bake asserts that before writing.

NECK = {"4": 42, "2": 21}          # crown-to-shoulder distance, per LOD
FACE_START = {"4": 14, "2": 7}     # hairline: dark pixels above this are hair
HEAD_CELL_H = 96                   # head/hair/face cells are top crops of the
                                   # body cell: the deepest neck line across all
                                   # poses sits at y=83, so 96 covers every frame
                                   # and halves what those layers decode to.


def is_white(c):
    return c[0] > 240 and c[1] > 240 and c[2] > 240


def is_skin(c):
    r, g, b = c
    return r > 190 and g > 170 and b > 120 and r - b > 40


def split_cell(buf, cw, ch, lod):
    """Return {'body','head','hair','face'} masks as disjoint cw*ch*4 buffers."""
    top = bbox_top(buf, cw, ch)
    layers = {k: bytearray(cw * ch * 4) for k in ("body", "head", "hair", "face")}
    if top is None:
        return layers
    cut = min(top + NECK[lod], ch)

    # Head column band from the crown rows, where only hair exists.
    x0, x1 = cw, -1
    for y in range(top, min(top + 9, ch)):
        for x in range(cw):
            if buf[(y * cw + x) * 4 + 3] > 0:
                x0, x1 = min(x0, x), max(x1, x)
    x0, x1 = max(0, x0 - 1), min(cw - 1, x1 + 1)

    def opaque(x, y):
        return buf[(y * cw + x) * 4 + 3] > 0

    def color(x, y):
        d = (y * cw + x) * 4
        return (buf[d], buf[d + 1], buf[d + 2])

    def head_side(x, y):
        return y < cut and x0 <= x <= x1

    # Hair = non-skin, non-white pixels connected to the crown seed rows.
    hair = bytearray(cw * ch)
    stack = []
    for y in range(top, min(top + 12, cut)):
        for x in range(x0, x1 + 1):
            if opaque(x, y) and not is_white(color(x, y)) and not is_skin(color(x, y)):
                if not hair[y * cw + x]:
                    hair[y * cw + x] = 1
                    stack.append((x, y))
    while stack:
        x, y = stack.pop()
        for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
            if not (0 <= nx < cw and 0 <= ny < cut) or hair[ny * cw + nx]:
                continue
            if not opaque(nx, ny):
                continue
            c = color(nx, ny)
            if is_white(c) or is_skin(c):
                continue
            hair[ny * cw + nx] = 1
            stack.append((nx, ny))

    for y in range(ch):
        for x in range(cw):
            d = (y * cw + x) * 4
            if buf[d + 3] == 0:
                continue
            if not head_side(x, y):
                key = "body"
            elif hair[y * cw + x]:
                key = "hair"
            else:
                c = color(x, y)
                if is_white(c) or is_skin(c) or y < top + FACE_START[lod]:
                    key = "head"
                else:
                    key = "face"
            layers[key][d:d + 4] = buf[d:d + 4]
    return layers


def composite(layers, cw, ch):
    out = bytearray(cw * ch * 4)
    for key in ("body", "head", "hair", "face"):
        buf = layers[key]
        for d in range(0, cw * ch * 4, 4):
            if buf[d + 3]:
                out[d:d + 4] = buf[d:d + 4]
    return out


# ---- bake --------------------------------------------------------------------

def bake(name):
    out_dir = os.path.join(ROOT, "assets", "chars", name)
    os.makedirs(out_dir, exist_ok=True)
    sheets = {}
    for lod, (tag, cw, ch) in LODS.items():
        path = os.path.join(ROOT, "assets", "chars", f"{name}-rig-{tag}.png")
        sw, sh, sheet = read_png(path)
        if sw != COLS * cw or sh != 4 * ch:
            raise SystemExit(f"{path}: expected {COLS * cw}x{4 * ch}, got {sw}x{sh}")
        sheets[lod] = (sheet, sw, cw, ch)

    # Authored directions: down, side (the baked RIGHT row), up. Left is
    # mirrored from side at draw time and never stored.
    src_rows = {"down": 0, "side": 2, "up": 3}
    dir_list = ["down", "side", "up"]
    max_frames = max(n for _a, _c, n in ACTIONS)
    anims = {}
    for row, (action, _col0, frames) in enumerate(ACTIONS):
        anims[action] = {"row": row, "frames": frames, "fps": FPS[action],
                         "loop": LOOP[action], "dirStride": frames}

    for lod, (sheet, sw, cw, ch) in sheets.items():
        width = 3 * max_frames * cw
        height = len(ACTIONS) * ch
        head_h = HEAD_CELL_H
        head_height = len(ACTIONS) * head_h
        body = bytearray(width * height * 4)
        head = bytearray(width * head_height * 4) if lod == "4" else None
        hair = bytearray(width * head_height * 4) if lod == "4" else None
        face = bytearray(width * head_height * 4) if lod == "4" else None
        checked = 0
        for action, col0, frames in ACTIONS:
            a = anims[action]
            for di, dname in enumerate(dir_list):
                for f in range(frames):
                    src = cell(sheet, sw, cw, ch, col0 + f, src_rows[dname])
                    parts = split_cell(src, cw, ch, lod)
                    # Round trip: the four layers must rebuild the source cell.
                    if composite(parts, cw, ch) != src:
                        raise SystemExit(f"split lost pixels: {name} {lod} {dname} {action}{f}")
                    checked += 1
                    col = di * a["dirStride"] + f
                    paste(body, width, cw, ch, col, a["row"], parts["body"])
                    if lod == "4":
                        # Head-side layers are top crops: keep the first
                        # head_h rows, and prove nothing lives below them.
                        for key, dst in (("head", head), ("hair", hair), ("face", face)):
                            part = parts[key]
                            for y in range(head_h, ch):
                                row = part[y * cw * 4:(y + 1) * cw * 4]
                                if any(row[x * 4 + 3] for x in range(cw)):
                                    raise SystemExit(
                                        f"{key} below crop: {name} {dname} {action}{f} y={y}")
                            crop = bytearray(cw * head_h * 4)
                            for y in range(head_h):
                                crop[y * cw * 4:(y + 1) * cw * 4] = part[y * cw * 4:(y + 1) * cw * 4]
                            paste(dst, width, cw, head_h, col, a["row"], crop)
        write_png(os.path.join(out_dir, f"body@{lod}.png"), width, height, body)
        if lod == "4":
            write_png(os.path.join(out_dir, "head@4.png"), width, head_height, head)
            write_png(os.path.join(out_dir, "hair@4.png"), width, head_height, hair)
            # Face rides the same anim grid as the body, so a talking mouth
            # stays in sync. Expressions are vertical blocks of that grid:
            # face row = exprIndex * animRows + anim.row. Only neutral exists
            # in the source art today; new expressions append a block.
            write_png(os.path.join(out_dir, "face@4.png"), width, head_height, face)
        print(f"INFO {name} body@{lod}: {width}x{height}, {checked} cells round-tripped")

    meta = {
        "cell": [128, 192],
        "dirs": dir_list,
        "anims": anims,
        "pivots": {"head": [64, 46], "foot": [64, 188]},
        "mirror": True,
        "expressions": ["neutral"],
        "layerCells": {"head": [128, HEAD_CELL_H], "hair": [128, HEAD_CELL_H],
                       "face": [128, HEAD_CELL_H]},
        "layers": ["body", "head", "hair", "face"],
    }
    with open(os.path.join(out_dir, "meta.json"), "w") as fh:
        json.dump(meta, fh, indent=2)
    print(f"INFO meta.json -> {out_dir}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--name", default="zuhdi")
    ap.add_argument("--probe", action="store_true")
    args = ap.parse_args()
    if args.probe:
        probe(args.name)
    else:
        bake(args.name)