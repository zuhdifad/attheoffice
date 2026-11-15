import { ATLAS_COLS, ATLAS_CELL_W, ATLAS_CELL_H, TILE } from '../core/config.js';

// Every piece of the office comes out of the one atlas the art was authored in.
// A glyph names a cell; collision and draw order live next to it, because a desk
// that draws without being solid is a hole in the floor.
//
//   solid  — the player cannot enter the tile
//   object — drawn in the y-sorted pass, so people pass behind and in front of it
//   seat   — a colleague may occupy it even though the player may not
//   rot    — quarter turns clockwise, for pieces the plate runs north-south
//
// Ground glyphs are stretched to a full tile at bake time, so a floor laid from
// them has no seams. Standing glyphs keep their aspect and sit on the tile foot.
const G = (i, opts = {}) => ({ i, solid: false, object: false, seat: false, rot: 0, ...opts });
const PROP = (i, opts = {}) => G(i, { solid: true, object: true, ...opts });

export const GLYPHS = {
  // ---- ground -------------------------------------------------------------
  '.': G(0),    // concrete, warm
  ',': G(1),    // concrete, cool
  ':': G(2),    // quadrant slab
  ';': G(3),    // terrazzo
  z: G(63),     // terrazzo, speckled
  t: G(4),      // teal carpet
  T: G(5),      // teal carpet, piped edge
  Y: G(6),      // teal carpet, corner
  g: G(7),      // green carpet
  G: G(8),      // green carpet, piped edge
  H: G(9),      // green carpet, corner
  u: G(52),     // grey carpet tile
  v: G(53),     // blue carpet tile
  '=': G(54),   // floor vent
  m: G(55),     // door mat
  k: PROP(61),  // wall footing, left
  K: PROP(62),  // wall footing, right
  O: G(59),     // green marker ring, painted on the floor
  X: G(58),     // red cross, painted on the floor

  // ---- shell --------------------------------------------------------------
  '#': PROP(10),  // wood slat wall
  w: PROP(11),    // wood slat wall, end
  W: PROP(12),    // window, three panes
  p: PROP(13),    // glass pane
  P: PROP(14),    // glass corner
  d: G(15, { object: true }),   // glass door, walkable
  D: G(60, { object: true }),   // double glass doors, walkable

  // ---- lounge -------------------------------------------------------------
  a: PROP(16),  // sofa, left arm
  b: PROP(17),  // sofa, middle
  c: PROP(18),  // sofa, right arm
  e: PROP(19, { seat: true }),  // armchair
  f: PROP(20),  // coffee table, books and plant
  h: PROP(21),  // bookshelf
  i: PROP(22),  // framed art
  '3': PROP(51), // low walnut table

  // ---- work floor ---------------------------------------------------------
  j: PROP(23),  // phone booth, canopy
  J: PROP(24),  // phone booth, door
  l: PROP(25),  // desk, monitor and keyboard
  n: PROP(26),  // desk, clear top
  o: PROP(27),  // desk, return panel
  q: PROP(28, { rot: 1 }),  // fabric divider, turned to run north-south
  r: PROP(29, { seat: true }),  // green task chair
  s: PROP(30, { seat: true }),  // yellow task chair
  '1': PROP(49, { seat: true }), // blue task chair
  '2': PROP(50, { seat: true }), // red task chair
  x: PROP(31),  // concrete pillar
  '0': PROP(48), // whiteboard

  // ---- cafe ---------------------------------------------------------------
  y: PROP(32),  // high table, narrow
  A: PROP(33),  // high table
  B: PROP(34),  // high table, wide
  C: PROP(35, { seat: true }),  // red stool

  // ---- meeting room -------------------------------------------------------
  E: PROP(36),  // oval table, left cap
  F: PROP(37),  // oval table, middle
  I: PROP(38),  // oval table, right cap
  L: PROP(39, { seat: true }),  // teal meeting chair

  // ---- planting and storage ----------------------------------------------
  M: PROP(40),  // bushy plant, round pot
  N: PROP(41),  // snake plant
  Q: PROP(42),  // broad-leaf plant
  R: PROP(43),  // trailing plant
  S: PROP(44),  // small plant, round pot
  U: PROP(45),  // empty planter
  V: PROP(46),  // sideboard
  Z: PROP(47)   // sideboard with art
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

// Where a glyph lives in the atlas. Ground is the bottom square of its cell;
// a standing piece is the whole cell, lifted by its headroom.
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

let atlas = null;
let loading = null;
export function loadAtlas() {
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => { atlas = img; resolve(img); };
    img.onerror = () => reject(new Error('atlas failed to load'));
    img.src = 'assets/tiles/atlas.png';
  });
  return loading;
}

export function atlasImage() {
  return atlas;
}
