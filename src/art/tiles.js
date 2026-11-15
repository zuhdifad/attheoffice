import { ATLAS_COLS, ATLAS_CELL_W, ATLAS_CELL_H, TILE } from '../core/config.js?v=8';
import { canvas } from '../core/draw.js?v=8';

// Every piece of the office comes out of the one atlas the art was authored in.
// A glyph names a cell; collision and draw order live next to it, because a desk
// that draws without being solid is a hole in the floor.
//
//   solid  — the player cannot enter the tile
//   object — drawn in the y-sorted pass, so people pass behind and in front of it
//   seat   — a colleague may occupy it even though the player may not
//   rot    — quarter turns clockwise, for pieces the plate runs north-south
//
// The source sheet is a 1024x1024 plate of 128px cells on a magenta chroma
// background. At load time it is keyed to alpha, despilled, trimmed and fitted
// into the 32x48 cell convention below: ground art fills the bottom 32 square so
// a floor laid from it has no seams; standing art keeps its aspect and sits on
// the tile foot. Cell indices are row*8+col of the source plate.
const G = (i, opts = {}) => ({ i, solid: false, object: false, seat: false, rot: 0, ...opts });
const PROP = (i, opts = {}) => G(i, { solid: true, object: true, ...opts });
// Flat art that lies on the floor but is not the floor itself: drawn over the
// derived ground, walkable, never lifted.
const FLAT = (i, opts = {}) => G(i, { object: true, ...opts });

export const GLYPHS = {
  // ---- ground -------------------------------------------------------------
  '.': G(0),    // beige large-format tile, warm
  ',': G(1),    // beige large-format tile, alt grain
  ':': G(2),    // quadrant slab
  ';': G(3),    // terrazzo, speckled
  z: G(63),     // terrazzo, fine speckle
  u: G(53),     // pale grey slab
  v: G(54),     // marbled grey slab
  O: G(59),     // green marker ring, painted on the floor
  X: G(58),     // red cross, painted on the floor

  // ---- flat floor pieces --------------------------------------------------
  '=': FLAT(42),  // floor vent grate
  m: FLAT(42),    // entrance mat / grate

  // ---- shell --------------------------------------------------------------
  '#': PROP(4),   // wall footing, beige with dark base
  k: PROP(61),    // wall footing, run
  K: PROP(62),    // wall footing, corner
  w: PROP(62),    // wall corner
  W: PROP(6),     // glass partition, two panes wide
  p: PROP(7),     // glass partition, single tall pane
  P: PROP(34),    // glass corner
  d: G(35, { object: true }),   // glass door, walkable
  D: G(60, { object: true }),   // glass door, swung open on its mat, walkable

  // ---- work floor ---------------------------------------------------------
  l: PROP(11),  // desk, monitor
  n: PROP(8),   // desk, clear top
  o: PROP(12),  // desk, monitor and keyboard
  b: PROP(13),  // bench desk, divider
  c: PROP(14),  // bench desk, divider, alt
  q: PROP(15),  // bench desk, divider, return
  r: PROP(17, { seat: true }),  // olive task chair, back to us (faces north)
  s: PROP(16, { seat: true }),  // mustard task chair, back to us (faces north)
  e: PROP(19, { seat: true }),  // olive task chair, front (faces south)
  f: PROP(18, { seat: true }),  // mustard task chair, front (faces south)
  '1': PROP(50, { seat: true }), // blue task chair
  '2': PROP(51, { seat: true }), // red task chair
  x: PROP(5),   // dark pillar
  '0': PROP(39), // whiteboard
  i: PROP(23),  // monitor, loose

  // ---- planting and storage ----------------------------------------------
  M: PROP(43),  // bushy plant, round pot
  N: PROP(44),  // snake plant, tall planter
  U: PROP(45),  // empty planter
  V: PROP(41),  // drawer cabinet, wood top
  Z: PROP(37),  // low sideboard
  h: PROP(36),  // tall locker
  B: PROP(40),  // trash bin
  C: PROP(46),  // wet-floor sign

  // ---- tables -------------------------------------------------------------
  y: PROP(48),  // walnut table
  A: PROP(49)   // steel table
};

const FALLBACK = GLYPHS['.'];

export function glyph(id) {
  return GLYPHS[id] || FALLBACK;
}

export function isSolid(id) {
  return glyph(id).solid;
}

export function isObject(id) {
  return glyph(id).object;
}

export function isSeat(id) {
  return glyph(id).seat;
}

// Where a glyph lives in the baked atlas. Ground is the bottom square of its
// cell; a standing piece is the whole cell, lifted by its headroom.
export function cell(id) {
  const { i, object, rot } = glyph(id);
  const sx = (i % ATLAS_COLS) * ATLAS_CELL_W;
  const sy = Math.floor(i / ATLAS_COLS) * ATLAS_CELL_H;
  return object
    ? { sx, sy, sw: ATLAS_CELL_W, sh: ATLAS_CELL_H, lift: ATLAS_CELL_H - TILE, rot }
    : { sx, sy: sy + (ATLAS_CELL_H - TILE), sw: TILE, sh: TILE, lift: 0, rot };
}

// Draw one cell with its foot on the bottom of the tile at (dx, dy). A turned
// piece rotates about the tile centre and only uses the tile square of its
// cell, so it stays centred on the same footprint instead of sliding half a
// tile sideways. `size` lets the floor plan reuse this exact path at 6px.
export function blitCell(g, img, id, dx, dy, size = TILE) {
  const c = cell(id);
  const k = size / TILE;
  if (!c.rot) {
    g.drawImage(img, c.sx, c.sy, c.sw, c.sh, dx, dy - c.lift * k, c.sw * k, c.sh * k);
    return;
  }
  g.save();
  g.translate(dx + size / 2, dy + size / 2);
  g.rotate((c.rot * Math.PI) / 2);
  g.drawImage(img, c.sx, c.sy + (ATLAS_CELL_H - TILE), TILE, TILE, -size / 2, -size / 2, size, size);
  g.restore();
}

// ---- the bake ---------------------------------------------------------------
// Cells whose art is a floor (or a painted floor marker) are stretched to the
// full 32 square so they tile seamlessly. Everything else keeps its aspect.
const GROUND_CELLS = new Set([0, 1, 2, 3, 52, 53, 54, 55, 63, 58, 59]);
const SRC_CELL = 128;

// Magenta has both red and blue far above green; a red prop or a blue chair
// never does, so min(r,b)-g separates the chroma from the art cleanly. Edge
// pixels that are part art, part chroma get a proportional alpha and a despill
// so no pink fringe survives the key.
function keyChroma(data) {
  const px = data.data;
  for (let i = 0; i < px.length; i += 4) {
    const r = px[i], g = px[i + 1], b = px[i + 2];
    const d = Math.min(r, b) - g;
    if (d > 150) { px[i + 3] = 0; continue; }
    if (d > 20) {
      const a = 1 - (d - 20) / 130;
      px[i + 3] = Math.round(px[i + 3] * a);
      const s = d * 0.6;
      px[i] = Math.max(0, r - s);
      px[i + 2] = Math.max(0, b - s);
    } else if (d > 0) {
      const s = d * 0.35;
      px[i] = r - s;
      px[i + 2] = b - s;
    }
  }
}

function trimBounds(data, cx, cy) {
  const px = data.data;
  const W = data.width;
  let minX = SRC_CELL, minY = SRC_CELL, maxX = -1, maxY = -1;
  for (let y = 0; y < SRC_CELL; y++) {
    for (let x = 0; x < SRC_CELL; x++) {
      const a = px[((cy + y) * W + (cx + x)) * 4 + 3];
      if (a > 12) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

function bake(img) {
  const src = canvas(img.width, img.height);
  src.ctx.drawImage(img, 0, 0);
  const data = src.ctx.getImageData(0, 0, img.width, img.height);
  keyChroma(data);
  src.ctx.putImageData(data, 0, 0);

  const out = canvas(ATLAS_COLS * ATLAS_CELL_W, ATLAS_COLS * ATLAS_CELL_H);
  // The source is a smooth render, so the downscale is filtered once here; the
  // buffer is then integer-upscaled with smoothing off and stays crisp.
  out.ctx.imageSmoothingEnabled = true;
  out.ctx.imageSmoothingQuality = 'high';

  for (let i = 0; i < ATLAS_COLS * ATLAS_COLS; i++) {
    const cx = (i % ATLAS_COLS) * SRC_CELL;
    const cy = Math.floor(i / ATLAS_COLS) * SRC_CELL;
    const t = trimBounds(data, cx, cy);
    if (!t) continue;
    const dx = (i % ATLAS_COLS) * ATLAS_CELL_W;
    const dy = Math.floor(i / ATLAS_COLS) * ATLAS_CELL_H;
    if (GROUND_CELLS.has(i)) {
      // The plate draws a dark outline around every slab. Cropping it off
      // before the stretch keeps a laid floor continuous, the way the
      // reference reads; the hairline joint is drawn by the view instead.
      const inset = Math.min(6, Math.floor(t.w / 4), Math.floor(t.h / 4));
      out.ctx.drawImage(src.c, cx + t.x + inset, cy + t.y + inset, t.w - inset * 2, t.h - inset * 2, dx, dy + (ATLAS_CELL_H - TILE), TILE, TILE);
    } else {
      const k = Math.min(ATLAS_CELL_W / t.w, ATLAS_CELL_H / t.h);
      const dw = t.w * k, dh = t.h * k;
      out.ctx.drawImage(src.c, cx + t.x, cy + t.y, t.w, t.h, dx + (ATLAS_CELL_W - dw) / 2, dy + ATLAS_CELL_H - dh, dw, dh);
    }
  }
  return out.c;
}

let atlas = null;
let loading = null;
export function loadAtlas() {
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => { atlas = bake(img); resolve(atlas); };
    img.onerror = () => reject(new Error('atlas failed to load'));
    img.src = 'assets/tiles/level22_office-desks-tileset-atlas.png';
  });
  return loading;
}

export function atlasImage() {
  return atlas;
}