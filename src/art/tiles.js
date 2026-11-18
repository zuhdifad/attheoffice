import { ATLAS_COLS, ATLAS_CELL_TILES, ATLAS_LODS, TILE } from '../core/config.js?v=26';
import { canvas } from '../core/draw.js?v=26';
import { mulberry32 } from '../core/rng.js?v=26';
import { PAL } from './palette.js?v=26';

// The plate is the floor and nothing else now. Furniture is a prop with a
// footprint and layers (art/props.js); a glyph here only names the ground a
// tile is laid with, or a flat decal that lies on top of it. That split is the
// whole point: collision belongs to a footprint, not to the art under it.
//
// The source sheet is a 1024x1024 plate of 128px cells on a magenta chroma
// background. At load time it is keyed to alpha, despilled and trimmed, then
// blitted into the cell with one factor for the whole plate — k = tilePx / 128
// — so a slab keeps the size the plate drew it at. Each cell is a tile wide and
// four tiles tall; art is bottom-anchored inside it, which leaves the headroom
// a prop slice can reach into. Cell indices are row*8+col of the source plate.
const G = (i) => ({ i });

export const GLYPHS = {
  '.': G(0),    // beige large-format tile, warm
  ',': G(1),    // beige large-format tile, alt grain
  ':': G(2),    // quadrant slab
  ';': G(3),    // terrazzo, speckled
  z: G(63),     // terrazzo, fine speckle
  u: G(53),     // pale grey slab
  v: G(54),     // marbled grey slab
  O: G(59),     // green marker ring, painted on the floor
  X: G(58),     // red cross, painted on the floor
  // Materials the plate never drew. A paint glyph names a surface baked once
  // per LOD from a seeded grain, so the lounge carpet, the meeting wood and the
  // pantry tile lay edge to edge exactly like a slab — and never shimmer,
  // because the speckle is decided at bake time, not per frame.
  c: { paint: 'carpet' },     // teal contract carpet, the desk banks
  C: { paint: 'carpetDeep' }, // the same weave sunk a shade, the lounge
  w: { paint: 'wood' },       // plank floor, meeting room and manager office
  p: { paint: 'smallTile' }   // fine-format tile, the pantry
};

const FALLBACK = GLYPHS['.'];

export function glyph(id) {
  return GLYPHS[id] || FALLBACK;
}

// ---- baked paint ground -------------------------------------------------------
// One canvas per material per LOD, drawn at the plate's own device size so the
// world pass blits it 1:1 like every other ground cell. The grain is a seeded
// walk over 2px blocks: enough noise to read as fibre or grain, never a checker.
function paintCarpet(g, S, rnd, base, lit, deep) {
  g.fillStyle = base;
  g.fillRect(0, 0, S, S);
  const b = Math.max(1, S / 64);
  for (let y = 0; y < S; y += b) {
    for (let x = 0; x < S; x += b) {
      const r = rnd();
      if (r < 0.16) { g.fillStyle = deep; g.fillRect(x, y, b, b); }
      else if (r < 0.34) { g.fillStyle = lit; g.fillRect(x, y, b, b); }
    }
  }
  // A fleck every few blocks: the aggregate a contract carpet carries.
  for (let i = 0; i < S / 4; i++) {
    g.fillStyle = i % 3 ? lit : deep;
    g.fillRect(Math.floor(rnd() * S), Math.floor(rnd() * S), b, b);
  }
}

function paintWood(g, S, rnd) {
  const rows = 4;
  const rh = S / rows;
  for (let r = 0; r < rows; r++) {
    const tone = r % 2 ? PAL.wood : '#b78347';
    g.fillStyle = tone;
    g.fillRect(0, r * rh, S, rh);
    // Grain: a few long hairlines inside the plank, never across the joint.
    for (let i = 0; i < 5; i++) {
      const y = r * rh + 2 + Math.floor(rnd() * (rh - 4));
      g.fillStyle = i % 2 ? PAL.woodDeep : '#caa066';
      g.fillRect(Math.floor(rnd() * S * 0.4), y, Math.floor(S * (0.3 + rnd() * 0.5)), 1);
    }
    // Staggered butt joints, one per plank row.
    const jx = Math.floor(((r * 0.37 + 0.2) % 1) * S);
    g.fillStyle = PAL.woodDeep;
    g.fillRect(jx, r * rh, 1, rh);
    g.fillRect(0, r * rh, S, 1);
  }
}

function paintSmallTile(g, S, rnd) {
  const n = 4;
  const t = S / n;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      g.fillStyle = (x + y) % 2 ? PAL.floorLit : PAL.floor;
      g.fillRect(x * t, y * t, t, t);
      if (rnd() < 0.4) {
        g.fillStyle = PAL.floorShade;
        g.fillRect(x * t + 2 + Math.floor(rnd() * (t - 4)), y * t + 2 + Math.floor(rnd() * (t - 4)), 1, 1);
      }
    }
  }
  g.fillStyle = PAL.floorShade;
  for (let i = 1; i < n; i++) {
    g.fillRect(i * t - 1, 0, 1, S);
    g.fillRect(0, i * t - 1, S, 1);
  }
}

const PAINTERS = {
  carpet: (g, S, rnd) => paintCarpet(g, S, rnd, PAL.teal, PAL.tealLit, PAL.tealDeep),
  carpetDeep: (g, S, rnd) => paintCarpet(g, S, rnd, PAL.tealDeep, PAL.teal, '#0f4750'),
  wood: paintWood,
  smallTile: paintSmallTile
};

const groundCache = new Map();

function groundTile(name, tilePx) {
  let byName = groundCache.get(tilePx);
  if (!byName) { byName = {}; groundCache.set(tilePx, byName); }
  if (byName[name]) return byName[name];
  const paint = PAINTERS[name];
  if (!paint) return null;
  const { c, ctx } = canvas(tilePx, tilePx);
  paint(ctx, tilePx, mulberry32(name.length * 7919 + name.charCodeAt(0)));
  byName[name] = c;
  return c;
}

// Draw one ground cell with its foot on the bottom edge of the tile at (dx, dy).
// The page is read straight: one box out, one box in, and the only scale is the
// one the page was baked with, so a slab is laid exactly as the plate drew it.
export function blitCell(g, page, id, dx, dy) {
  const gl = glyph(id);
  if (gl.paint) {
    const t = groundTile(gl.paint, page.tilePx);
    if (!t) return false;
    g.drawImage(t, dx, dy, TILE, TILE);
    return true;
  }
  const b = page.cells[gl.i];
  if (!b) return false;
  const s = TILE / page.tilePx;
  const ox = (gl.i % ATLAS_COLS) * page.cellW;
  const oy = Math.floor(gl.i / ATLAS_COLS) * page.cellH;
  const w = b.w * s;
  const h = b.h * s;
  const x = dx + b.x * s;
  const y = dy + TILE - page.cellH * s + b.y * s;
  g.drawImage(page.img, ox + b.x, oy + b.y, b.w, b.h, x, y, w, h);
  return true;
}

// ---- the bake ---------------------------------------------------------------
// A laid floor has to read as one surface, so a ground cell is the only kind of
// cell whose square is backed out to the tile's edge. Everything else keeps its
// authored size, aspect and margins.
const GROUND_CELLS = new Set([0, 1, 2, 3, 52, 53, 54, 55, 63, 58, 59]);
// Cells that paint a marking on the floor rather than a slab of it.
const MARKS = new Set([58, 59]);
const SRC_CELL = 128;
// A prop is cut where the art ends: above this alpha the plate has drawn a rim,
// below it is the key's own fringe. art/props.js measures its slices against
// this box, so the two files agree on where a piece of furniture begins.
const TRIM_ALPHA = 128;
// A slab is cut at the rim itself, so no anti-aliased pixel of the plate — and
// no despilled magenta — can lay a coloured hairline between two tiles. The
// tone the floor is backed with is sampled inside the very same box.
const SLAB_ALPHA = 248;
// Sampled well inside the rim, so the plate's own bevel cannot tint the fill.
const TONE_INSET = 10;
// Pixels of a slab's rim to leave out of the surface it is laid on, so the
// joint is the rim and nothing but the rim.
const SLAB_PAD = 3;

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

function trimBounds(data, cx, cy, threshold) {
  const px = data.data;
  const W = data.width;
  let minX = SRC_CELL, minY = SRC_CELL, maxX = -1, maxY = -1;
  for (let y = 0; y < SRC_CELL; y++) {
    for (let x = 0; x < SRC_CELL; x++) {
      // The plate runs a dark magenta gutter around every cell; the key leaves it
      // almost transparent, so the threshold decides whether a box ends at the
      // art or takes the soft edge in with it.
      const a = px[((cy + y) * W + (cx + x)) * 4 + 3];
      if (a > threshold) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  return { sx: cx + minX, sy: cy + minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

// The surface a ground cell is laid on. Sampled from the middle of the slab and
// never from its rim: the rim carries the plate's anti-aliasing, which is a few
// shades lighter and green enough to draw a lattice over a field of slabs. This
// tone is what the gap between one slab and its neighbour is backed with.
function slabTone(data, t) {
  const px = data.data;
  const W = data.width;
  let r = 0, g = 0, b = 0, opaque = 0, seen = 0;
  const x0 = t.sx + TONE_INSET, y0 = t.sy + TONE_INSET;
  const x1 = t.sx + t.w - TONE_INSET, y1 = t.sy + t.h - TONE_INSET;
  for (let y = y0; y < y1; y += 2) {
    for (let x = x0; x < x1; x += 2) {
      const o = (y * W + x) * 4;
      seen++;
      if (px[o + 3] < SLAB_ALPHA) continue;
      r += px[o]; g += px[o + 1]; b += px[o + 2];
      opaque++;
    }
  }
  if (!opaque) return null;
  return {
    r: Math.round(r / opaque),
    g: Math.round(g / opaque),
    b: Math.round(b / opaque),
    coverage: opaque / Math.max(1, seen)
  };
}

// A ground cell is the bottom tile square of the cell, laid edge to edge. The
// slab keeps every authored pixel 1:1 — it is never inset, cropped or stretched
// — and the square underneath it is laid with the slab's own surface, wrapped at
// its own size, so the plate's margin is filled with the same grain the slab is
// made of. The only line between two tiles is then the rim the plate drew round
// each slab: a hairline, not a grid. A cell that paints a marker rather than a
// slab is laid on the plain slab's surface instead: paint lies on the floor, it
// does not become one.
function bakeGround(ctx, img, t, k, fill, tex, cell) {
  const box = { x: cell.x, y: cell.y + cell.h - cell.w, w: cell.w, h: cell.w };
  if (fill) {
    ctx.fillStyle = `rgb(${fill.r},${fill.g},${fill.b})`;
    ctx.fillRect(box.x, box.y, box.w, box.h);
  }
  const w = Math.max(1, Math.round(t.w * k));
  const h = Math.max(1, Math.round(t.h * k));
  const x = box.x + Math.round((box.w - w) / 2);
  const y = box.y + box.h - h;
  ctx.imageSmoothingEnabled = k < 1;
  if (tex) {
    // The surface is drawn as a wrap of the slab's own grain at 1:1 — no scale,
    // no smear, no mirror — so the margin reads as more floor rather than as a
    // band of one colour beside it.
    const sx = tex.sx + SLAB_PAD;
    const sy = tex.sy + SLAB_PAD;
    const sw = tex.w - SLAB_PAD * 2;
    const sh = tex.h - SLAB_PAD * 2;
    const tw = Math.max(1, Math.round(sw * k));
    const th = Math.max(1, Math.round(sh * k));
    ctx.save();
    ctx.beginPath();
    ctx.rect(box.x, box.y, box.w, box.h);
    ctx.clip();
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        ctx.drawImage(img, sx, sy, sw, sh, x + ox * tw, y + oy * th, tw, th);
      }
    }
    ctx.restore();
  }
  ctx.drawImage(img, t.sx, t.sy, t.w, t.h, x, y, w, h);
  ctx.imageSmoothingEnabled = false;
  return { x: 0, y: cell.h - cell.w, w: cell.w, h: cell.w };
}

// A standing cell is the plate at its own scale: k is the plate's factor, never
// the cell's, so a chair draws small and a locker draws tall. The box is
// centred on the footprint and stands on the cell's bottom edge; the four tiles
// of headroom above it stay empty unless the art reaches up into them.
function bakeProp(ctx, img, t, k, cell) {
  const w = Math.max(1, Math.round(t.w * k));
  const h = Math.max(1, Math.round(t.h * k));
  const x = cell.x + Math.round((cell.w - w) / 2);
  const y = cell.y + cell.h - h;
  ctx.imageSmoothingEnabled = k < 1;
  ctx.drawImage(img, t.sx, t.sy, t.w, t.h, x, y, w, h);
  ctx.imageSmoothingEnabled = false;
  return { x: x - cell.x, y: y - cell.y, w, h };
}

// One LOD of the plate. `tilePx` is device pixels per world tile: 128 for the
// near view, 64 for the far one, which is why both of them blit 1:1.
function bakePlate(img, trims, slabs, tones, tilePx) {
  const cellW = tilePx;
  const cellH = tilePx * ATLAS_CELL_TILES;
  const k = tilePx / SRC_CELL;
  const { c, ctx } = canvas(ATLAS_COLS * cellW, ATLAS_COLS * cellH);
  const cells = new Array(ATLAS_COLS * ATLAS_COLS).fill(null);
  // Where each cell's art begins inside its own plate cell, in cell fractions.
  // A standing cell is baked to the bottom of its four-tile page cell and
  // centred there, so the two are not the same origin: a prop slice has to be
  // mapped through this, or every slice lands as far above the art as the plate
  // left room under it.
  const orig = new Array(ATLAS_COLS * ATLAS_COLS).fill(null);
  // One plain slab backs every ground cell, including the painted ones.
  const slabIdx = tones.findIndex((t, i) => t && GROUND_CELLS.has(i) && !MARKS.has(i));
  const slab = slabIdx < 0 ? null : tones[slabIdx];
  const slabTex = slabIdx < 0 ? null : slabs[slabIdx];
  for (let i = 0; i < cells.length; i++) {
    const ground = GROUND_CELLS.has(i);
    const t = ground ? slabs[i] : trims[i];
    if (!t) continue;
    const cell = {
      x: (i % ATLAS_COLS) * cellW,
      y: Math.floor(i / ATLAS_COLS) * cellH,
      w: cellW,
      h: cellH
    };
    orig[i] = {
      x: (t.sx - (i % ATLAS_COLS) * SRC_CELL) / SRC_CELL,
      y: (t.sy - Math.floor(i / ATLAS_COLS) * SRC_CELL) / SRC_CELL
    };
    if (!ground) {
      cells[i] = bakeProp(ctx, img, t, k, cell);
      continue;
    }
    const own = tones[i];
    const laid = own && own.coverage > 0.55;
    cells[i] = bakeGround(ctx, img, t, k, laid ? own : slab, laid ? t : slabTex, cell);
  }
  return { img: c, tilePx, cellW, cellH, cells, orig };
}

let pages = [];
let loading = null;

export function loadAtlas() {
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const src = canvas(img.width, img.height);
      src.ctx.drawImage(img, 0, 0);
      const data = src.ctx.getImageData(0, 0, img.width, img.height);
      keyChroma(data);
      src.ctx.putImageData(data, 0, 0);
      // Keyed and trimmed once, then both LODs are cut from the same pixels, so
      // the two plates can never disagree about where a cell's art begins. Props
      // are cut at their art and slabs at their rim; the two boxes differ by the
      // plate's anti-aliasing, and only the slab's rim is allowed on the floor.
      const trims = [];
      const slabs = [];
      for (let i = 0; i < ATLAS_COLS * ATLAS_COLS; i++) {
        const cx = (i % ATLAS_COLS) * SRC_CELL;
        const cy = Math.floor(i / ATLAS_COLS) * SRC_CELL;
        trims.push(trimBounds(data, cx, cy, TRIM_ALPHA));
        slabs.push(trimBounds(data, cx, cy, SLAB_ALPHA));
      }
      const tones = slabs.map((t) => (t ? slabTone(data, t) : null));
      pages = ATLAS_LODS.map((tilePx) => bakePlate(src.c, trims, slabs, tones, tilePx));
      resolve(pages);
    };
    img.onerror = () => reject(new Error('atlas failed to load'));
    img.src = 'assets/tiles/level22_office-desks-tileset-atlas.png';
  });
  return loading;
}

// The plate that matches this zoom: a tile covers exactly TILE * ppu device
// pixels either way, so the view blits 1:1 at 4 and at 2 and never samples a
// half-pixel. Anything in between takes whichever plate is closer.
export function atlasFor(ppu) {
  if (!pages.length) return null;
  const want = TILE * ppu;
  let best = pages[0];
  for (const p of pages) {
    if (Math.abs(p.tilePx - want) < Math.abs(best.tilePx - want)) best = p;
  }
  return best;
}

export function atlasPages() {
  return pages;
}