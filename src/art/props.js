import { TILE, ATLAS_COLS } from '../core/config.js?v=24';
import { canvas } from '../core/draw.js?v=24';
import { mulberry32 } from '../core/rng.js?v=24';
import { PAL } from './palette.js?v=24';

// A prop is a piece of furniture with a footprint and one or more layers. The
// footprint is what it costs the floor: a desk is three tiles wide and two deep,
// so all six tiles are solid and the walk keeps to the aisle beside them. The
// layers are what it costs the painter: each one is a slice of the plate dropped
// at its own point of the prop's box and sorted on its own `foot + bias`, so a
// tabletop can cover a sitter's legs while the far half of the same table stays
// behind them.
//
// Everything is measured in plate tiles — one plate tile is one world tile, and
// one cell of the 8x8 source plate is one plate tile square. `src` is the slice
// on the plate (an art box measured off the plate, never its whole cell),
// `dst` is where that slice lands inside the prop's own box, `bias` is added to
// the foot of the prop for the sort, `repeat`/`step` tile the same slice across
// a run, `flip` mirrors it and `cap` sends it to the pass that runs after every
// character (walls use it for the top slab).
const S = (cell, x = 0, y = 0, w = 1, h = 1) => ({
  x: (cell % ATLAS_COLS) + x,
  y: Math.floor(cell / ATLAS_COLS) + y,
  w,
  h
});
const L = (name, src, dst = {}, bias = 0, extra = {}) => {
  const box = { x: 0, y: 0, w: src.w, h: src.h, ...dst };
  // `extra` may name one axis of `repeat` or `step` on its own; the other keeps
  // its default, so a run of three modules is `{ x: 3 }` and not `{ x: 3, y: 1 }`.
  const { repeat = {}, step = {}, ...rest } = extra;
  return {
    name,
    src,
    dst: box,
    bias,
    repeat: { x: 1, y: 1, ...repeat },
    step: { x: box.w, y: box.h, ...step },
    flip: false,
    cap: false,
    ...rest
  };
};

// A painted layer: furniture the plate never drew. Same contract as a slice —
// a dst box in tiles from the footprint's top-left, a bias on the foot, a place
// in the one y-sorted pass — but the art is pixel rects laid down at draw time
// instead of a box cut out of the page. `paint(g, m)` runs with the transform
// already translated to the prop's box origin and scaled by the view's ppu, so
// every coordinate here is in world tiles; `m` carries the tick and the prop's
// own machine state, which is how a coffee machine brews and a booth door swings.
const P = (name, dst, bias, paint, extra = {}) => ({
  name,
  src: null,
  dst: { x: 0, y: 0, w: 1, h: 1, ...dst },
  bias,
  repeat: { x: 1, y: 1 },
  step: { x: 1, y: 1 },
  flip: false,
  cap: false,
  paint,
  ...extra
});
// Painted furniture snaps to the world pixel grid (1/32 tile), the same grid
// the plate slices round to, so a painted edge stays crisp at both LODs.
const R = (g, x, y, w, h, c) => {
  g.fillStyle = c;
  g.fillRect(Math.round(x * TILE) / TILE, Math.round(y * TILE) / TILE,
    Math.max(1, Math.round(w * TILE)) / TILE, Math.max(1, Math.round(h * TILE)) / TILE);
};

// ---- walls ----------------------------------------------------------------
// A wall is 2.5 tiles of painted face standing on a one-tile footprint. The
// face is the middle of the plate's beige panel stretched up its height — a flat
// painted surface, so a stretch reads as wall and not as a smear — the baseboard
// is the skirting the plate drew under it, and the cap is the dark top slab. The
// cap is drawn in a pass that runs after every character, which is what keeps a
// head from poking through a wall that stands behind it.
//
// The face slice takes the panel's flat middle and nothing of its edges: the
// plate draws a dark rim at the top of the band and the skirting at the bottom,
// and either of those repeated once per tile would ladder the wall instead of
// leaving it one surface (see `capped` in world/map.js — only the module at the
// back of a run shows its cap, so a run is one top, not one per tile).
export const WALL_H = 2.5;
const SKIRT = 0.196;
const CAP_H = 0.141;
// How far above its own tile the highest point of a wall reaches, cap included:
// the whole silhouette of the tallest thing in the room.
export const WALL_TOP = WALL_H + CAP_H;
// The part of that which hangs over the tile's top edge. A layer's `dst` is
// measured from the tile's top-left corner, so the art is lifted by WALL_TOP from
// the tile's own row and the row itself accounts for the last tile. The camera
// reads this: it is the headroom a floor needs at its top edge, and the exact
// amount by which a stop may look past the room's first row — no more, or the
// band over the cap is bare void.
export const WALL_RISE = WALL_TOP - 1;
const FACE = S(4, 0.10, 0.258, 0.80, 0.11);

const wallLayers = () => [
  // Edge to edge across the footprint: a wall module butts the next one, and a
  // panel inset by a few units would leave a hairline of void between them on
  // the run at the top of a room, where there is no wall behind to fill it.
  L('face', FACE, { x: 0, y: 1 - WALL_H, w: 1, h: WALL_H - SKIRT }),
  L('base', S(4, 0.047, 0.445, 0.914, 0.196), { x: 0, y: 1 - SKIRT, w: 1, h: SKIRT }, 0.25),
  L('cap', S(61, 0.031, 0.219, 0.93, 0.141), { x: 0, y: 1 - WALL_H - CAP_H, w: 1, h: CAP_H }, 0.5, { cap: true })
];

const shell = (name, extra = {}) => ({
  name,
  w: 1,
  h: 1,
  solid: true,
  seat: null,
  layers: wallLayers(),
  ...extra
});

// The near edge of a room is not a wall. A 2.5-tile wall on the side the camera
// stands on paints over everybody in the last row — and its cap runs after every
// character, so it would cut them in half. The south side is a sill instead: the
// same panel and skirting cut to a low ledge and biased a whole row behind the
// tile in front of it (-64), which sorts it before every character and every
// flat prop that can stand there. Walls keep the height; the near edge is a
// ledge you look over.
const SILL_H = 0.66;

const sillLayers = () => [
  L('face', FACE, { x: 0, y: 1 - SILL_H, w: 1, h: SILL_H - SKIRT }, -64),
  L('base', S(4, 0.047, 0.445, 0.914, 0.196), { x: 0, y: 1 - SKIRT, w: 1, h: SKIRT }, -63.75)
];

// A one-tile prop: its art box at the plate's own size, centred in the tile and
// standing on the tile's bottom edge.
const one = (name, src, extra = {}) => ({
  name,
  w: 1,
  h: 1,
  solid: true,
  seat: null,
  layers: [L('body', src, { x: (1 - src.w) / 2, y: 1 - src.h })],
  ...extra
});

// ---- chairs ---------------------------------------------------------------
// A chair is a seat plus a back, and which way the sitter faces decides where
// the back sorts. Facing away from us the sitter's back is between us and them,
// so the back is drawn over them at +10 and covers their lower back; facing us
// the back stands on the far side of the sitter, so it is drawn behind them at
// -40 (behind the table they sit at, too) and only the seat comes forward at +2.
const CHAIR_W = 0.58;

const backChair = (name, cell, x = 0.21) => ({
  name,
  w: 1,
  h: 1,
  solid: true,
  seat: 'up',
  layers: [
    L('seat', S(cell, x, 0.6, CHAIR_W, 0.291), { x, y: 0.709, w: CHAIR_W, h: 0.291 }, 2),
    L('back', S(cell, x, 0.164, CHAIR_W, 0.456), { x, y: 0.273, w: CHAIR_W, h: 0.456 }, 10)
  ]
});

const frontChair = (name, cell) => ({
  name,
  w: 1,
  h: 1,
  solid: true,
  seat: 'down',
  layers: [
    L('seat', S(cell, 0.21, 0.52, 0.59, 0.378), { x: 0.205, y: 0.622, w: 0.59, h: 0.378 }, 2),
    L('back', S(cell, 0.21, 0.07, 0.59, 0.482), { x: 0.205, y: 0.172, w: 0.59, h: 0.482 }, -40)
  ]
});

// ---- desks and tables -----------------------------------------------------
// Three modules wide, two deep: two benches back to back with the screen spine
// down the middle. The near module is the one the sitters use, so its panel is
// split off the tabletop — the panel goes at the foot and the top is lifted by
// +6, the nudge that lets it win against a sitter whose own foot is only two
// units short of the desk's. The far module is drawn whole, one whole tile
// earlier (-32), which puts it after the sitter in the far row and before the
// one in the near row: each of them is covered by their own half of the desk.
const DESK_W = 3;
const NEAR_MODULE = 13; // desk, monitor, screen spine on its far edge
const FAR_MODULE = 8; // the same bench seen from the aisle behind it

const work = (name, far, near, farY, nearY) => ({
  name,
  w: DESK_W,
  h: 2,
  solid: true,
  seat: null,
  layers: [
    L('back', far, { y: 1 - farY, w: 1, h: farY }, -32, { repeat: { x: DESK_W } }),
    L('base', near.base, { y: 2 - near.base.h, w: 1, h: near.base.h }, 0, { repeat: { x: DESK_W } }),
    L('top', near.top, { y: 2 - nearY, w: 1, h: near.top.h }, 6, { repeat: { x: DESK_W } })
  ]
});

const deskLayers = {
  far: S(FAR_MODULE, 0.1016, 0.0938, 0.7734, 0.8281),
  base: S(NEAR_MODULE, 0.0469, 0.55, 0.8906, 0.3719),
  top: S(NEAR_MODULE, 0.0469, 0.1016, 0.8906, 0.4984)
};

const tableLayers = {
  far: S(48, 0.1094, 0.0781, 0.8281, 0.8203),
  base: S(48, 0.1094, 0.52, 0.8281, 0.3784),
  top: S(48, 0.1094, 0.0781, 0.8281, 0.492)
};

// ---- painted furniture ------------------------------------------------------
// The plate drew desks, chairs and glazing; the rest of an office — the coffee
// bar, the lounge, the print alcove — is painted here in the same register:
// flat banded surfaces, one light edge, one dark edge, no gradients except on
// glass and light pools. Every function draws in tiles from its layer's dst
// origin, so the numbers below are the furniture's own proportions.
const GLASS_TINT = 'rgba(150,200,226,0.38)';
const FROST = 'rgba(139,122,214,0.34)';

const glassFrame = (g) => {
  R(g, 0.02, 1 - 2.3, 0.08, 2.3, PAL.steel);
  R(g, 0.90, 1 - 2.3, 0.08, 2.3, PAL.steel);
  R(g, 0.02, 1 - 2.3, 0.96, 0.10, PAL.surfaceHi);
  R(g, 0.02, 0.92, 0.96, 0.08, PAL.steel);
};

// ---- the north window -------------------------------------------------------
// A window is the wall's own face with a glazed opening cut into it: an outside
// view behind glass, a steel frame with a mullion and a transom, and a sill
// that overhangs the face below. The outside is one seeded strip baked per LOD
// — sky, two depths of skyline, cloud — and the camera slides the source box a
// little against the frame, so leaning around the room shifts the view the way
// a real pane does. Every coordinate is a whole world pixel (1/32 tile), so
// both zoom stops land the glass on whole device pixels.
const WIN_X0 = 0.0625;             // opening left, 2 world px in from the edge
const WIN_W = 0.875;               // 28 world px of glass
const WIN_TOP = -1.3125;           // header line, 42 px above the tile
const WIN_H = 1.875;               // 60 px of opening down to the sill
const WIN_BOT = WIN_TOP + WIN_H;
const STRIP_W = 1.6;               // the baked view, wider than the opening
const STRIP_H = 2.2;               // so parallax has room to travel
const stripCache = new Map();

function outsideStrip(tilePx) {
  let c = stripCache.get(tilePx);
  if (c) return c;
  ({ c } = canvas(Math.round(STRIP_W * tilePx), Math.round(STRIP_H * tilePx)));
  const x = c.getContext('2d');
  // The strip is authored in tile units on a tilePx-sized canvas, so the bake
  // scale is tilePx — not the world ppu the chunk bakes use.
  x.scale(tilePx, tilePx);
  const rnd = mulberry32(22071);

  const sky = x.createLinearGradient(0, 0, 0, STRIP_H);
  sky.addColorStop(0, '#8fb8d8');
  sky.addColorStop(0.45, '#c6dce8');
  sky.addColorStop(0.72, '#e9e2cf');
  sky.addColorStop(1, '#d8cdb4');
  x.fillStyle = sky;
  x.fillRect(0, 0, STRIP_W, STRIP_H);

  // A low sun, kept pale: the room's daylight is the sky's, not a spotlight.
  const sun = x.createRadialGradient(1.18, 0.42, 0.02, 1.18, 0.42, 0.55);
  sun.addColorStop(0, 'rgba(255,240,210,0.6)');
  sun.addColorStop(1, 'rgba(255,240,210,0)');
  x.fillStyle = sun;
  x.fillRect(0.6, 0, 1.0, 1.0);

  // Cloud: three seeded banks of pixel blocks, one tone off the sky.
  x.fillStyle = 'rgba(243,241,236,0.75)';
  for (let i = 0; i < 3; i++) {
    const cx = 0.15 + rnd() * 1.2, cy = 0.18 + rnd() * 0.5;
    for (let b = 0; b < 5; b++) {
      const bw = 0.10 + rnd() * 0.16;
      x.fillRect(cx + b * 0.09 - 0.2, cy + (b % 2) * 0.045, bw, 0.06);
    }
  }

  // Two depths of skyline: the far band hazed steel, the near band cooler and
  // taller, a few lit windows in it. Seeded once, so it never shimmer.
  const horizon = 1.52;
  x.fillStyle = 'rgba(143,163,191,0.55)';
  for (let tx = -0.05; tx < STRIP_W; ) {
    const tw = 0.12 + rnd() * 0.16;
    const th = 0.22 + rnd() * 0.5;
    x.fillRect(tx, horizon - th, tw, th);
    tx += tw + 0.02 + rnd() * 0.05;
  }
  for (let tx = -0.08; tx < STRIP_W; ) {
    const tw = 0.16 + rnd() * 0.18;
    const th = 0.3 + rnd() * 0.85;
    x.fillStyle = 'rgba(93,114,145,0.85)';
    x.fillRect(tx, horizon + 0.1 - th, tw, th);
    x.fillStyle = 'rgba(242,177,52,0.5)';
    for (let wy = horizon + 0.1 - th + 0.06; wy < horizon + 0.02; wy += 0.11) {
      for (let wx = tx + 0.035; wx < tx + tw - 0.04; wx += 0.075) {
        if (rnd() < 0.4) x.fillRect(wx, wy, 0.03, 0.045);
      }
    }
    tx += tw + 0.03 + rnd() * 0.07;
  }
  // The street haze below the skyline, with a park block or two in it.
  x.fillStyle = '#c2bba8';
  x.fillRect(0, horizon + 0.1, STRIP_W, STRIP_H - horizon - 0.1);
  x.fillStyle = 'rgba(74,157,82,0.5)';
  for (let i = 0; i < 4; i++) x.fillRect(rnd() * STRIP_W, horizon + 0.14 + rnd() * 0.3, 0.18 + rnd() * 0.2, 0.08);

  stripCache.set(tilePx, c);
  return c;
}

// Boot-time warm: the first frame that shows glazing at either stop finds the
// outside view already baked, so neither the opening nor a zoom swap pays it.
export function primeGlazing(tilePx) {
  outsideStrip(tilePx);
}

const windowGlazing = (g, m) => {
  const tilePx = (m.ppu || 4) * TILE;
  const strip = outsideStrip(tilePx);
  // The parallax: the camera's drift against this window's own tile, damped to
  // a lean and clamped to the strip's margin. The source box moves in whole
  // bake pixels, so the view steps at the device grid, never at a half pixel.
  const winX = ((m.p && m.p.x) || 0) * TILE;
  const winY = ((m.p && m.p.y) || 0) * TILE;
  const camX = m.cam ? m.cam.x : winX;
  const camY = m.cam ? m.cam.y : winY;
  const px = Math.max(-0.32, Math.min(0.32, (camX - winX) * 0.045));
  const py = Math.max(-0.12, Math.min(0.12, (camY - winY) * 0.02));
  const sw = Math.round(WIN_W * tilePx);
  const sh = Math.round(WIN_H * tilePx);
  const sx = Math.max(0, Math.min(strip.width - sw, Math.round(((STRIP_W - WIN_W) / 2 + px) * tilePx)));
  const sy = Math.max(0, Math.min(strip.height - sh, Math.round(((STRIP_H - WIN_H) / 2 + py) * tilePx)));
  g.drawImage(strip, sx, sy, sw, sh, WIN_X0, WIN_TOP, WIN_W, WIN_H);

  // The glass itself: a faint grape tint and two diagonal reflections, clipped
  // to the opening so they read as sheen on the pane, not paint on the wall.
  R(g, WIN_X0, WIN_TOP, WIN_W, WIN_H, 'rgba(139,122,214,0.08)');
  g.save();
  g.beginPath();
  g.rect(WIN_X0, WIN_TOP, WIN_W, WIN_H);
  g.clip();
  g.fillStyle = 'rgba(243,241,236,0.10)';
  g.beginPath();
  g.moveTo(WIN_X0 + 0.16, WIN_TOP);
  g.lineTo(WIN_X0 + 0.34, WIN_TOP);
  g.lineTo(WIN_X0 + 0.06, WIN_BOT);
  g.lineTo(WIN_X0 - 0.12, WIN_BOT);
  g.closePath();
  g.fill();
  g.fillStyle = 'rgba(243,241,236,0.06)';
  g.beginPath();
  g.moveTo(WIN_X0 + 0.46, WIN_TOP);
  g.lineTo(WIN_X0 + 0.54, WIN_TOP);
  g.lineTo(WIN_X0 + 0.26, WIN_BOT);
  g.lineTo(WIN_X0 + 0.18, WIN_BOT);
  g.closePath();
  g.fill();
  g.restore();
  // The head of the opening sits in shadow under the header.
  R(g, WIN_X0, WIN_TOP, WIN_W, 0.0625, 'rgba(12,14,20,0.20)');

  // Frame: posts, header, mullion, transom — brushed steel off the desk frames.
  R(g, WIN_X0 - 0.0625, WIN_TOP, 0.0625, WIN_H + 0.03125, PAL.steel);
  R(g, WIN_X0 + WIN_W, WIN_TOP, 0.0625, WIN_H + 0.03125, PAL.steel);
  R(g, 0, WIN_TOP - 0.125, 1, 0.125, PAL.steel);
  R(g, 0, WIN_TOP - 0.125, 1, 0.03125, PAL.surfaceHi);
  R(g, 0.46875, WIN_TOP, 0.0625, WIN_H, PAL.steel);
  R(g, WIN_X0, -0.375, WIN_W, 0.03125, PAL.steel);

  // Sill: a lit top surface over a steel front, overhanging the face below,
  // with a soft lip of shadow under it so it reads as a ledge, not a stripe.
  R(g, WIN_X0 - 0.09375, WIN_BOT, WIN_W + 0.1875, 0.09375, PAL.surfaceHi);
  R(g, WIN_X0 - 0.09375, WIN_BOT + 0.09375, WIN_W + 0.1875, 0.125, PAL.steel);
  R(g, WIN_X0 - 0.0625, WIN_BOT + 0.21875, WIN_W + 0.125, 0.0625, 'rgba(12,14,20,0.25)');
};

const boothShell = (g) => {
  R(g, 0.0, 1 - 2.2, 0.10, 2.2, PAL.amberDeep);
  R(g, 0.90, 1 - 2.2, 0.10, 2.2, PAL.amberDeep);
  R(g, 0.0, 1 - 2.3, 1.0, 0.16, PAL.amber);
  R(g, 0.10, 1 - 2.14, 0.80, 2.06, GLASS_TINT);
  R(g, 0.30, 1 - 2.24, 0.40, 0.06, PAL.surfaceHi);
};

// The leaf swings on its hinge: `open` is 0 shut, 1 folded back against the
// jamb, so the doorway reads as passable exactly when the machine says it is.
const boothLeaf = (g, m) => {
  const open = m.anim.open || 0;
  const w = 0.80 * (1 - open * 0.82);
  R(g, 0.10, 1 - 2.14, w, 2.06, GLASS_TINT);
  R(g, 0.10 + w - 0.06, 1 - 2.14, 0.06, 2.06, PAL.steel);
  R(g, 0.10 + w - 0.14, 1 - 1.10, 0.06, 0.22, PAL.surfaceHi);
};

const boothGlow = (g, m) => {
  const on = m.anim.state === 'occupied';
  g.fillStyle = on ? 'rgba(242,177,52,0.12)' : 'rgba(79,212,138,0.07)';
  g.beginPath();
  g.ellipse(0.5, 1.0, 0.95, 0.45, 0, 0, Math.PI * 2);
  g.fill();
  R(g, 0.42, 1 - 2.24, 0.16, 0.06, on ? PAL.amber : PAL.ok);
};

// The entrance's two leaves swing on the same machine as the booth: `open` is
// 0 shut, 1 folded back against the jamb, so the doorway reads as passable
// exactly when the collider says it is. Each leaf keeps its hinge at the frame
// post and shrinks toward it, the handle riding the meeting stile.
const doorLeaf = (side) => (g, m) => {
  const open = m.anim.open || 0;
  const w = 0.4609 * (1 - open * 0.86);
  const x = side === 'L' ? 0.04 : 2 - 0.04 - w;
  R(g, x, 0.0547, w, 0.9453, GLASS_TINT);
  const stile = side === 'L' ? x + w - 0.06 : x;
  R(g, stile, 0.0547, 0.06, 0.9453, PAL.steel);
  R(g, side === 'L' ? x + w - 0.13 : x + 0.08, 0.46, 0.05, 0.14, PAL.surfaceHi);
};

// A glazed room's single leaf, hinged on the west post of its frame.
const glassLeaf = (g, m) => {
  const open = m.anim.open || 0;
  const w = 0.76 * (1 - open * 0.86);
  R(g, 0.12, 1 - 2.15, w, 2.10, GLASS_TINT);
  R(g, 0.12 + w - 0.06, 1 - 2.15, 0.06, 2.10, PAL.steel);
  R(g, 0.12 + w - 0.14, 1 - 1.15, 0.05, 0.16, PAL.surfaceHi);
};

const coffeeBody = (g, m) => {
  const phase = m.anim.phase || 'idle';
  R(g, 0.18, -0.50, 0.64, 0.72, PAL.surface);
  R(g, 0.18, -0.50, 0.64, 0.16, PAL.surfaceHi);
  R(g, 0.74, -0.46, 0.06, 0.06, phase === 'brewing' ? PAL.amber : phase === 'ready' ? PAL.ok : PAL.textFaint);
  R(g, 0.42, -0.34, 0.16, 0.10, PAL.steel);
  R(g, 0.30, 0.16, 0.40, 0.06, PAL.steel);
  R(g, 0.40, 0.02, 0.20, 0.14, PAL.text);
  if (phase === 'brewing') {
    R(g, 0.48, -0.24, 0.04, 0.26, '#6b4a2f');
    R(g, 0.42, 0.10 - (m.anim.fill || 0) * 0.06, 0.16, 0.04 + (m.anim.fill || 0) * 0.06, '#6b4a2f');
  } else if (phase === 'ready') {
    R(g, 0.42, 0.04, 0.16, 0.08, '#6b4a2f');
  }
};

const sinkBasin = (g) => {
  R(g, 0.72, -0.16, 0.06, 0.30, PAL.steel);
  R(g, 0.58, -0.16, 0.20, 0.06, PAL.steel);
  R(g, 0.15, 0.16, 0.70, 0.20, PAL.steel);
  R(g, 0.20, 0.20, 0.60, 0.12, PAL.surfaceHi);
};

const fridgeBody = (g) => {
  // A white appliance on the pale pantry checker needs its own ink outline,
  // or the body disappears into the light squares of the floor.
  R(g, 0.10, 0.13, 0.80, 1.89, PAL.ink);
  R(g, 0.14, 0.17, 0.72, 1.81, PAL.text);
  R(g, 0.82, 0.17, 0.04, 1.81, PAL.floorShade);
  R(g, 0.14, 0.90, 0.72, 0.05, PAL.floorShade);
  R(g, 0.74, 0.45, 0.06, 0.30, PAL.steel);
  R(g, 0.74, 1.00, 0.06, 0.30, PAL.steel);
};

const coolerBody = (g) => {
  R(g, 0.30, -0.35, 0.40, 0.45, 'rgba(95,184,232,0.65)');
  R(g, 0.34, -0.31, 0.10, 0.30, 'rgba(243,241,236,0.5)');
  R(g, 0.42, 0.10, 0.16, 0.10, PAL.steel);
  R(g, 0.23, 0.18, 0.54, 0.84, PAL.ink);
  R(g, 0.27, 0.22, 0.46, 0.76, PAL.text);
  R(g, 0.44, 0.40, 0.12, 0.08, PAL.sky);
  R(g, 0.27, 0.92, 0.46, 0.06, PAL.floorShade);
};

const kettleBody = (g) => {
  R(g, 0.30, 0.00, 0.40, 0.30, PAL.surfaceHi);
  R(g, 0.34, -0.06, 0.32, 0.08, PAL.steel);
  R(g, 0.68, 0.02, 0.08, 0.20, PAL.ink);
  R(g, 0.26, 0.28, 0.48, 0.06, PAL.ink);
};

const MUGS = [PAL.coral, PAL.sky, PAL.amber, PAL.leaf, PAL.rose, PAL.tealLit];
const mugShelfBody = (g) => {
  R(g, 0.10, -0.60, 0.08, 1.60, PAL.woodDeep);
  R(g, 0.82, -0.60, 0.08, 1.60, PAL.woodDeep);
  for (let s = 0; s < 3; s++) {
    const y = -0.20 + s * 0.50;
    R(g, 0.10, y, 0.80, 0.08, PAL.wood);
    for (let i = 0; i < 4; i++) {
      R(g, 0.18 + i * 0.18, y - 0.16, 0.12, 0.16, MUGS[(s * 4 + i) % MUGS.length]);
    }
  }
};

const stoolBody = (g) => {
  R(g, 0.20, 0.25, 0.60, 0.14, PAL.coral);
  R(g, 0.44, 0.39, 0.12, 0.40, PAL.steel);
  R(g, 0.30, 0.60, 0.40, 0.05, PAL.steel);
  R(g, 0.25, 0.79, 0.50, 0.08, PAL.surface);
};

const highTableBody = (g) => {
  R(g, 0, 0.15, 2, 0.16, PAL.wood);
  R(g, 0, 0.31, 2, 0.06, PAL.woodDeep);
  R(g, 0.15, 0.37, 0.12, 0.60, PAL.surface);
  R(g, 1.73, 0.37, 0.12, 0.60, PAL.surface);
};

const lowTableBody = (g) => {
  R(g, 0, 0.45, 2, 0.14, PAL.wood);
  R(g, 0, 0.59, 2, 0.05, PAL.woodDeep);
  R(g, 0.12, 0.64, 0.10, 0.34, PAL.surface);
  R(g, 1.78, 0.64, 0.10, 0.34, PAL.surface);
};

const sofaSeat = (g) => {
  R(g, 0, 0.45, 3, 0.55, PAL.plum);
  for (let i = 0; i < 3; i++) R(g, 0.28 + i * 0.85, 0.42, 0.72, 0.20, PAL.rose);
  R(g, 0, 0.94, 3, 0.06, '#8a4a86');
};
const sofaBack = (g) => {
  R(g, 0, 0.10, 3, 0.38, PAL.plum);
  R(g, 0, 0.10, 3, 0.06, '#c76fc2');
  R(g, 0, 0.15, 0.22, 0.85, PAL.plum);
  R(g, 2.78, 0.15, 0.22, 0.85, PAL.plum);
};
const armSeat = (g) => {
  R(g, 0.10, 0.45, 0.80, 0.55, PAL.plum);
  R(g, 0.16, 0.42, 0.68, 0.20, PAL.rose);
};
const armBack = (g) => {
  R(g, 0.05, 0.10, 0.90, 0.40, PAL.plum);
  R(g, 0.05, 0.10, 0.90, 0.06, '#c76fc2');
  R(g, 0, 0.15, 0.15, 0.85, PAL.plum);
  R(g, 0.85, 0.15, 0.15, 0.85, PAL.plum);
};

const rugBody = (g) => {
  // A sand field, not plum: the sofa and armchair standing on it are plum,
  // and a rug the same colour as its furniture swallows them whole.
  R(g, 0, 0, 4, 3, PAL.plum);
  R(g, 0.18, 0.18, 3.64, 2.64, PAL.sand);
  R(g, 0.36, 0.36, 3.28, 2.28, '#e6d6ac');
  for (let i = 0; i < 4; i++) {
    R(g, 0.7 + i * 0.8, 1.3, 0.3, 0.3, PAL.plum);
  }
  R(g, 0, 0, 4, 0.06, PAL.rose);
  R(g, 0, 2.94, 4, 0.06, PAL.rose);
};

const magazines = (g) => {
  R(g, 0.30, 0.35, 0.40, 0.06, PAL.coral);
  R(g, 0.32, 0.29, 0.36, 0.06, PAL.sky);
  R(g, 0.34, 0.23, 0.32, 0.06, PAL.text);
};

const BOOKS = [PAL.coral, PAL.sky, PAL.leaf, PAL.amber, PAL.grape, PAL.tealLit, PAL.rose, PAL.sand];
const bookshelfBody = (g) => {
  R(g, 0, 0.10, 2, 1.90, PAL.woodDeep);
  for (let s = 0; s < 4; s++) {
    const y = 0.22 + s * 0.44;
    R(g, 0.08, y + 0.30, 1.84, 0.08, PAL.wood);
    for (let i = 0; i < 9; i++) {
      const h = 0.22 + ((s * 9 + i) % 3) * 0.04;
      R(g, 0.14 + i * 0.20, y + 0.30 - h, 0.14, h, BOOKS[(s * 9 + i) % BOOKS.length]);
    }
  }
};

const counterBody = (g) => {
  R(g, 0, 0.35, 4, 0.65, PAL.surface);
  R(g, 0, 0.25, 4, 0.12, PAL.floorLit);
  R(g, 0, 0.37, 4, 0.04, PAL.floorShade);
  for (let i = 0; i < 4; i++) R(g, 0.98 + i, 0.45, 0.04, 0.50, PAL.surfaceHi);
};

const printerBody = (g, m) => {
  R(g, 0.10, 0.35, 1.80, 0.60, PAL.floorLit);
  R(g, 0.10, 0.25, 1.80, 0.12, PAL.surfaceHi);
  R(g, 0.50, 0.42, 1.00, 0.06, PAL.ink);
  R(g, 1.60, 0.30, 0.20, 0.06, m.anim.phase === 'printing' ? PAL.ok : PAL.textFaint);
  R(g, 0.10, 0.89, 1.80, 0.06, PAL.floorShade);
};
const printerPaper = (g, m) => {
  const p = m.anim.paper || 0;
  if (p <= 0) return;
  const h = 0.08 + p * 0.34;
  R(g, 0.60, 0.44, 0.80, h, PAL.text);
  for (let i = 0; i < 3; i++) {
    if (0.44 + 0.06 + i * 0.08 < 0.44 + h - 0.04) R(g, 0.66, 0.48 + i * 0.08, 0.68, 0.02, PAL.textFaint);
  }
};

const shredderBody = (g) => {
  R(g, 0.20, 0.30, 0.60, 0.70, PAL.surface);
  R(g, 0.15, 0.22, 0.70, 0.10, PAL.surfaceHi);
  R(g, 0.30, 0.26, 0.40, 0.04, PAL.ink);
  R(g, 0.34, 0.62, 0.05, 0.30, PAL.text);
  R(g, 0.46, 0.62, 0.05, 0.26, PAL.text);
  R(g, 0.58, 0.62, 0.05, 0.32, PAL.text);
};

const paperStack = (g) => {
  R(g, 0.25, 0.55, 0.50, 0.10, PAL.text);
  R(g, 0.27, 0.45, 0.46, 0.10, PAL.floorLit);
  R(g, 0.29, 0.35, 0.42, 0.10, PAL.text);
};

const extinguisher = (g) => {
  R(g, 0.30, -0.70, 0.40, 0.06, PAL.steel);
  R(g, 0.35, -0.90, 0.30, 0.55, PAL.coral);
  R(g, 0.42, -0.98, 0.16, 0.10, PAL.ink);
  R(g, 0.62, -0.85, 0.06, 0.30, PAL.ink);
  R(g, 0.39, -0.80, 0.22, 0.16, PAL.text);
};

const firstAid = (g) => {
  R(g, 0.25, -1.00, 0.50, 0.50, PAL.text);
  R(g, 0.25, -1.00, 0.50, 0.05, PAL.floorShade);
  R(g, 0.45, -0.90, 0.10, 0.30, PAL.leaf);
  R(g, 0.35, -0.80, 0.30, 0.10, PAL.leaf);
};

const exitSign = (g) => {
  // Seated on the door frame's header, not a tile above it: over the south
  // sill there is no wall face behind, so a gap reads as a floating board.
  R(g, 0.55, -1.64, 0.90, 0.30, PAL.leafDeep);
  R(g, 0.62, -1.58, 0.16, 0.18, PAL.ok);
  R(g, 0.84, -1.56, 0.30, 0.05, PAL.ok);
  R(g, 0.84, -1.46, 0.22, 0.05, PAL.ok);
};

const wallClock = (g, m) => {
  g.fillStyle = PAL.text;
  g.beginPath();
  g.arc(0.5, -1.50, 0.28, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = PAL.ink;
  g.lineWidth = 0.05;
  g.stroke();
  const a = (m.tick || 0) * 0.002;
  g.strokeStyle = PAL.ink;
  g.lineWidth = 0.04;
  g.beginPath();
  g.moveTo(0.5, -1.50);
  g.lineTo(0.5 + Math.sin(a) * 0.20, -1.50 - Math.cos(a) * 0.20);
  g.moveTo(0.5, -1.50);
  g.lineTo(0.5 + Math.sin(a / 12 + 2) * 0.13, -1.50 - Math.cos(a / 12 + 2) * 0.13);
  g.stroke();
};

const framedArt = (g) => {
  R(g, 0.20, -1.60, 0.60, 0.80, PAL.woodDeep);
  R(g, 0.26, -1.54, 0.48, 0.68, PAL.sky);
  R(g, 0.26, -1.20, 0.48, 0.34, PAL.teal);
  R(g, 0.40, -1.44, 0.16, 0.16, PAL.amber);
};

const directory = (g) => {
  R(g, 0.12, -1.80, 0.76, 1.10, PAL.surface);
  R(g, 0.12, -1.80, 0.76, 0.16, PAL.amber);
  for (let i = 0; i < 5; i++) R(g, 0.20, -1.54 + i * 0.17, 0.60, 0.05, PAL.textDim);
};

const badgeReader = (g) => {
  R(g, 0.32, -1.00, 0.36, 0.50, PAL.surface);
  R(g, 0.38, -0.92, 0.24, 0.16, PAL.ok);
  R(g, 0.38, -0.70, 0.24, 0.10, PAL.surfaceHi);
};

// A lamp's pooled light is not painted here: the def carries a `lamp` tone and
// the light pass lays one baked additive pool on the floor around its foot, so
// the light falls over whoever stands in it and never greys the surface it lit.
const ceilLampHead = (g) => {
  R(g, 0.44, -2.60, 0.12, 0.16, PAL.ink);
  R(g, 0.30, -2.45, 0.40, 0.12, PAL.surfaceHi);
  R(g, 0.32, -2.33, 0.36, 0.06, '#fff6d8');
};
const pendantHead = (g) => {
  R(g, 0.48, -2.60, 0.04, 0.50, PAL.ink);
  R(g, 0.30, -2.10, 0.40, 0.20, PAL.amberDeep);
  R(g, 0.36, -1.90, 0.28, 0.06, '#fff6d8');
};
const floorLampBody = (g) => {
  R(g, 0.46, -0.90, 0.08, 1.70, PAL.ink);
  R(g, 0.25, -1.10, 0.50, 0.30, PAL.sand);
  R(g, 0.30, -0.80, 0.40, 0.05, '#fff6d8');
  R(g, 0.30, 0.80, 0.40, 0.10, PAL.ink);
};

const privacyScreen = (g) => {
  R(g, 0.08, 1 - 2.0, 2.84, 1.90, FROST);
  R(g, 0.02, 1 - 2.0, 0.06, 2.0, PAL.steel);
  R(g, 2.92, 1 - 2.0, 0.06, 2.0, PAL.steel);
  R(g, 0.02, 1 - 2.0, 2.96, 0.08, PAL.steel);
  R(g, 0.02, 0.92, 2.96, 0.08, PAL.steel);
};

const laptopBody = (g) => {
  R(g, 0.25, 0.05, 0.50, 0.30, PAL.surface);
  R(g, 0.28, 0.08, 0.44, 0.24, PAL.sky);
  R(g, 0.20, 0.35, 0.60, 0.10, PAL.steel);
};
const mugBody = (g) => {
  R(g, 0.38, 0.24, 0.20, 0.20, PAL.coral);
  R(g, 0.58, 0.28, 0.06, 0.10, PAL.coral);
  R(g, 0.40, 0.24, 0.16, 0.04, '#6b4a2f');
};
const papersBody = (g) => {
  R(g, 0.62, 0.26, 0.32, 0.22, PAL.text);
  R(g, 0.66, 0.22, 0.28, 0.20, PAL.floorLit);
  R(g, 0.70, 0.28, 0.20, 0.02, PAL.textFaint);
  R(g, 0.70, 0.34, 0.16, 0.02, PAL.textFaint);
};
const deskLampBody = (g) => {
  R(g, 0.72, 0.40, 0.16, 0.06, PAL.ink);
  R(g, 0.78, 0.10, 0.05, 0.30, PAL.ink);
  R(g, 0.70, 0.05, 0.20, 0.10, PAL.amber);
  R(g, 0.72, 0.15, 0.16, 0.04, '#fff6d8');
};
const waterJugBody = (g) => {
  R(g, 0.34, 0.02, 0.32, 0.36, 'rgba(95,184,232,0.55)');
  R(g, 0.38, 0.06, 0.08, 0.24, 'rgba(243,241,236,0.5)');
  R(g, 0.66, 0.10, 0.08, 0.16, PAL.steel);
  R(g, 0.32, 0.38, 0.36, 0.06, PAL.steel);
};
const phoneBody = (g) => {
  R(g, 0.30, 0.35, 0.40, 0.12, PAL.surface);
  R(g, 0.28, 0.30, 0.44, 0.08, PAL.ink);
  R(g, 0.36, 0.38, 0.06, 0.04, PAL.textDim);
  R(g, 0.46, 0.38, 0.06, 0.04, PAL.textDim);
  R(g, 0.56, 0.38, 0.06, 0.04, PAL.textDim);
};
const noticeBoard = (g) => {
  R(g, 0.10, -1.70, 0.80, 0.90, PAL.wood);
  R(g, 0.10, -1.70, 0.80, 0.06, PAL.woodDeep);
  R(g, 0.18, -1.56, 0.26, 0.30, PAL.text);
  R(g, 0.52, -1.50, 0.26, 0.24, PAL.amber);
  R(g, 0.24, -1.16, 0.30, 0.22, PAL.sky);
  R(g, 0.60, -1.14, 0.20, 0.26, PAL.text);
};
const trunking = (g) => {
  R(g, 0, 0.60, 3, 0.16, PAL.surfaceHi);
  R(g, 0, 0.60, 3, 0.04, PAL.steel);
  for (let i = 0; i < 3; i++) R(g, 0.4 + i, 0.58, 0.08, 0.20, PAL.surface);
};
const threshold = (g) => {
  R(g, 0, 0.72, 2, 0.28, PAL.floorShade);
  R(g, 0, 0.72, 2, 0.06, PAL.steel);
};
const doorFrame = (g) => {
  R(g, 0.00, 1 - 2.3, 0.10, 2.3, PAL.steel);
  R(g, 1.90, 1 - 2.3, 0.10, 2.3, PAL.steel);
  R(g, 0.00, 1 - 2.3, 2.00, 0.14, PAL.steel);
};

// ---- the catalog ----------------------------------------------------------
export const PROPS = {
  wall: shell('wall'),
  // The near edge, drawn as a ledge rather than a wall. Same footprint, same
  // collision, no cap, and it sorts behind the row in front of it.
  sill: shell('sill', { layers: sillLayers() }),
  // The north wall is glazed in places: the same wall with a framed opening
  // standing in its face — outside view, glass, sill — and the one thing the
  // light pass reads as a source.
  window: shell('window', {
    light: true,
    layers: [
      ...wallLayers(),
      P('glazing', { x: -0.09375, y: WIN_TOP - 0.125, w: 1.1875, h: WIN_BOT + 0.28125 - (WIN_TOP - 0.125) }, 0.3, windowGlazing)
    ]
  }),

  glass: one('glass', S(32, 0.0703, 0.0313, 0.8906, 0.9453), { light: false }),

  // A two-tile doorway: walkable in the base map, so the floor stays connected
  // and a path can plan through it — the live collider (world/machines.js)
  // holds it shut until the door machine swings the leaves open. Two leaves,
  // hinged on the frame posts, meeting on the middle line when closed.
  door: {
    name: 'door',
    w: 2,
    h: 1,
    solid: false,
    door: true,
    seat: null,
    machine: 'door',
    layers: [
      P('leafL', { x: 0.04, y: 0.0547, w: 0.4609, h: 0.9453 }, -20, doorLeaf('L')),
      P('leafR', { x: 2 - 0.04 - 0.4609, y: 0.0547, w: 0.4609, h: 0.9453 }, -20, doorLeaf('R'))
    ]
  },

  desk: work('desk', deskLayers.far, deskLayers, 0.8281, 0.8203),
  table: work('table', tableLayers.far, tableLayers, 0.8203, 0.8203),

  chair: backChair('chair', 16),
  chairOlive: backChair('chairOlive', 17, 0.203),
  chairFront: frontChair('chairFront', 18),
  chairFrontOlive: frontChair('chairFrontOlive', 19),
  chairBlue: frontChair('chairBlue', 50),
  chairRed: frontChair('chairRed', 51),

  // A locker is two modules stacked: the head is the same slab, lifted a tile
  // and drawn after the foot so the seam can never show the wall behind it.
  locker: {
    name: 'locker',
    w: 1,
    h: 2,
    solid: true,
    seat: null,
    layers: [
      L('foot', S(36, 0.25, 0.0234, 0.4922, 0.9375), { x: 0.254, y: 1.0625, w: 0.4922, h: 0.9375 }),
      L('head', S(36, 0.25, 0.0234, 0.4922, 0.9375), { x: 0.254, y: 0.125, w: 0.4922, h: 0.9375 }, 1)
    ]
  },

  // A board hangs in the tile the wall occupies, at eye height on a 2.5-tile
  // wall, so it is walk-through and never has a footprint of its own. It sorts
  // a hair after the wall face it is mounted on and long before the cap.
  board: {
    name: 'board',
    w: 1,
    h: 1,
    solid: false,
    seat: null,
    layers: [L('face', S(39, 0.1328, 0.0703, 0.7422, 0.8359), { x: 0.129, y: 1 - 0.8359 - 1.55 }, 1)]
  },

  // Flat things: they lie on the floor and are walked over, so they sort before
  // anyone standing in their tile.
  mat: one('mat', S(47, 0.0313, 0.1875, 0.9141, 0.5781), { solid: false, layers: [L('body', S(47, 0.0313, 0.1875, 0.9141, 0.5781), { x: 0.043, y: 0.4219 }, -20)] }),
  vent: one('vent', S(42, 0.0625, 0.3906, 0.8906, 0.3828), { solid: false, layers: [L('body', S(42, 0.0625, 0.3906, 0.8906, 0.3828), { x: 0.055, y: 0.6172 }, -20)] }),

  divider: one('divider', S(34, 0.0781, 0.125, 0.8281, 0.8281)),
  pillar: one('pillar', S(5, 0.2813, 0.0703, 0.4297, 0.875)),
  cabinet: one('cabinet', S(41, 0.2422, 0.0781, 0.5625, 0.8359)),
  sideboard: one('sideboard', S(37, 0.1016, 0.2188, 0.7734, 0.75)),
  bin: one('bin', S(40, 0.2734, 0.125, 0.4609, 0.7422)),
  sign: one('sign', S(46, 0.2109, 0.1328, 0.5781, 0.7656)),
  plant: one('plant', S(43, 0.2188, 0.1641, 0.5781, 0.7109)),
  snakePlant: one('snakePlant', S(44, 0.2344, 0.0469, 0.5078, 0.9063)),
  planter: one('planter', S(45, 0.2422, 0.2422, 0.5078, 0.6406)),
  tableSmall: one('tableSmall', S(49, 0.1016, 0.0781, 0.8359, 0.8125)),

  // ---- glazing and doors ----------------------------------------------------
  // A partition module: the plate's pane stretched to the wall's own height,
  // because glass is a flat surface and a stretch reads as glass. The frame is
  // painted posts and rails, so a run of modules butts into one continuous
  // glazed wall with a door leaf wherever a room is entered.
  glassWall: {
    name: 'glassWall', w: 1, h: 1, solid: true, seat: null,
    layers: [
      L('pane', S(33, 0.13, 0.06, 0.74, 0.88), { x: 0.08, y: 1 - 2.2, w: 0.84, h: 2.06 }, 0),
      P('frame', { x: 0, y: 1 - 2.3, w: 1, h: 2.3 }, 0.2, glassFrame)
    ]
  },
  // The same module read as a window: a light source for the daylight pass.
  glazed: {
    name: 'glazed', w: 1, h: 1, solid: true, seat: null, light: true,
    layers: [
      L('pane', S(33, 0.13, 0.06, 0.74, 0.88), { x: 0.08, y: 1 - 2.2, w: 0.84, h: 2.06 }, 0),
      P('frame', { x: 0, y: 1 - 2.3, w: 1, h: 2.3 }, 0.2, glassFrame)
    ]
  },
  glassDoor: {
    name: 'glassDoor', w: 1, h: 1, solid: false, door: true, seat: null, machine: 'door',
    layers: [
      P('leaf', { x: 0.12, y: 1 - 2.15, w: 0.76, h: 2.10 }, -20, glassLeaf),
      P('frame', { x: 0, y: 1 - 2.3, w: 1, h: 2.3 }, -19, glassFrame)
    ]
  },
  // A phone booth: one walkable tile behind a glass door that swings on a state
  // machine (world/machines.js). The glow lies on the floor behind whoever
  // stands in it; the shell and leaf sort just before the doorway's walker.
  booth: {
    name: 'booth', w: 1, h: 1, solid: false, door: true, seat: null, machine: 'booth',
    layers: [
      P('glow', { x: -0.45, y: 0.1, w: 1.9, h: 1.4 }, -20, boothGlow),
      P('shell', { x: 0, y: 1 - 2.3, w: 1, h: 2.3 }, -19, boothShell),
      P('leaf', { x: 0, y: 1 - 2.2, w: 1, h: 2.2 }, -18, boothLeaf)
    ]
  },
  doorFrame: {
    name: 'doorFrame', w: 2, h: 1, solid: false, seat: null,
    layers: [P('frame', { x: 0, y: 1 - 2.3, w: 2, h: 2.3 }, -19, doorFrame)]
  },
  threshold: {
    name: 'threshold', w: 2, h: 1, solid: false, seat: null,
    layers: [P('strip', { x: 0, y: 0.7, w: 2, h: 0.3 }, -21, threshold)]
  },
  exitSign: {
    name: 'exitSign', w: 2, h: 1, solid: false, seat: null,
    layers: [P('sign', { x: 0.5, y: -1.64, w: 1, h: 0.3 }, 0.4, exitSign)]
  },

  // ---- desk dressing ---------------------------------------------------------
  // Non-solid slices and paints that stand on a desk's own tiles: the monitor
  // on the far bench, the small things on the near top at +7, a hair over the
  // tabletop's +6 so they sit on it instead of under it.
  monitor: {
    name: 'monitor', w: 1, h: 1, solid: false, seat: null,
    layers: [L('body', S(23, 0.06, 0.10, 0.88, 0.80), { x: 0.06, y: -0.45, w: 0.88, h: 0.80 }, -30)]
  },
  tv: {
    name: 'tv', w: 1, h: 1, solid: false, seat: null,
    layers: [L('body', S(23, 0.06, 0.10, 0.88, 0.80), { x: 0.05, y: -1.95, w: 0.90, h: 0.80 }, 0.3)]
  },
  keyboard: {
    name: 'keyboard', w: 1, h: 1, solid: false, seat: null,
    layers: [L('body', S(47, 0.0313, 0.1875, 0.9141, 0.5781), { x: 0.06, y: 0.30, w: 0.50, h: 0.30 }, 7)]
  },
  laptop: {
    name: 'laptop', w: 1, h: 1, solid: false, seat: null,
    layers: [P('body', { x: 0.2, y: 0.05, w: 0.6, h: 0.4 }, 7, laptopBody)]
  },
  mug: {
    name: 'mug', w: 1, h: 1, solid: false, seat: null,
    layers: [P('body', { x: 0.35, y: 0.2, w: 0.3, h: 0.26 }, 7, mugBody)]
  },
  papers: {
    name: 'papers', w: 1, h: 1, solid: false, seat: null,
    layers: [P('body', { x: 0.6, y: 0.21, w: 0.36, h: 0.3 }, 7, papersBody)]
  },
  deskLamp: {
    name: 'deskLamp', w: 1, h: 1, solid: false, seat: null,
    layers: [P('body', { x: 0.66, y: 0.0, w: 0.34, h: 0.5 }, 7, deskLampBody)]
  },
  drawer: {
    name: 'drawer', w: 1, h: 1, solid: false, seat: null,
    layers: [L('body', S(41, 0.2422, 0.0781, 0.5625, 0.8359), { x: 0.22, y: 1.16, w: 0.56, h: 0.84 }, 1)]
  },
  cableTray: {
    name: 'cableTray', w: 3, h: 1, solid: false, seat: null,
    layers: [L('body', S(42, 0.0625, 0.3906, 0.8906, 0.3828), { x: 0.05, y: 0.55, w: 0.90, h: 0.38 }, -20, { repeat: { x: 3 } })]
  },
  trunking: {
    name: 'trunking', w: 3, h: 1, solid: false, seat: null,
    layers: [P('run', { x: 0, y: 0.58, w: 3, h: 0.2 }, -20, trunking)]
  },
  // Two tiles of frosted privacy between the facing halves of a bench: tall
  // enough to hide a sitter's screen, walk-through because it stands on the
  // desk's own spine and never on an aisle.
  screen: {
    name: 'screen', w: 3, h: 1, solid: false, seat: null,
    layers: [P('panel', { x: 0, y: 1 - 2.0, w: 3, h: 2.0 }, -30, privacyScreen)]
  },

  // ---- meeting and manager ---------------------------------------------------
  bench: {
    name: 'bench', w: 2, h: 1, solid: true, seat: null,
    layers: [L('body', S(9, 0.06, 0.10, 0.88, 0.80), { x: 0.06, y: 0.20, w: 0.88, h: 0.80 }, 0, { repeat: { x: 2 }, step: { x: 0.88 } })]
  },
  whiteboard: {
    name: 'whiteboard', w: 2, h: 1, solid: false, seat: null,
    layers: [L('face', S(39, 0.1328, 0.0703, 0.7422, 0.8359), { x: 0.06, y: 1 - 0.8359 - 1.55, w: 0.94, h: 0.8359 }, 1, { repeat: { x: 2 }, step: { x: 0.94 } })]
  },
  phone: {
    name: 'phone', w: 1, h: 1, solid: false, seat: null,
    layers: [P('body', { x: 0.25, y: 0.3, w: 0.5, h: 0.25 }, 7, phoneBody)]
  },
  waterJug: {
    name: 'waterJug', w: 1, h: 1, solid: false, seat: null,
    layers: [P('body', { x: 0.3, y: 0.0, w: 0.44, h: 0.45 }, 7, waterJugBody)]
  },
  bookshelf: {
    name: 'bookshelf', w: 2, h: 2, solid: true, seat: null,
    layers: [P('body', { x: 0, y: 0.1, w: 2, h: 1.9 }, 0, bookshelfBody)]
  },

  // ---- pantry ----------------------------------------------------------------
  counter: {
    name: 'counter', w: 4, h: 1, solid: true, seat: null,
    layers: [P('body', { x: 0, y: 0.25, w: 4, h: 0.75 }, 0, counterBody)]
  },
  coffeeMachine: {
    name: 'coffeeMachine', w: 1, h: 1, solid: false, seat: null, machine: 'coffee',
    layers: [P('body', { x: 0.15, y: -0.5, w: 0.7, h: 0.8 }, 6, coffeeBody)]
  },
  sink: {
    name: 'sink', w: 1, h: 1, solid: false, seat: null,
    layers: [P('body', { x: 0.1, y: -0.2, w: 0.8, h: 0.6 }, 6, sinkBasin)]
  },
  fridge: {
    name: 'fridge', w: 1, h: 2, solid: true, seat: null,
    layers: [P('body', { x: 0, y: 0.15, w: 1, h: 1.85 }, 0, fridgeBody)]
  },
  waterCooler: {
    name: 'waterCooler', w: 1, h: 1, solid: true, seat: null,
    layers: [P('body', { x: 0, y: -0.35, w: 1, h: 1.35 }, 0, coolerBody)]
  },
  kettle: {
    name: 'kettle', w: 1, h: 1, solid: false, seat: null,
    layers: [P('body', { x: 0.25, y: -0.1, w: 0.55, h: 0.45 }, 6, kettleBody)]
  },
  mugShelf: {
    name: 'mugShelf', w: 1, h: 1, solid: true, seat: null,
    layers: [P('body', { x: 0, y: -0.6, w: 1, h: 1.6 }, 0, mugShelfBody)]
  },
  stool: {
    name: 'stool', w: 1, h: 1, solid: true, seat: 'up',
    layers: [P('body', { x: 0, y: 0.25, w: 1, h: 0.62 }, 2, stoolBody)]
  },
  highTable: {
    name: 'highTable', w: 2, h: 1, solid: true, seat: null,
    layers: [P('body', { x: 0, y: 0.15, w: 2, h: 0.82 }, 0, highTableBody)]
  },
  noticeBoard: {
    name: 'noticeBoard', w: 1, h: 1, solid: false, seat: null,
    layers: [P('face', { x: 0.1, y: -1.7, w: 0.8, h: 0.9 }, 0.3, noticeBoard)]
  },

  // ---- lounge ----------------------------------------------------------------
  sofa: {
    name: 'sofa', w: 3, h: 1, solid: true, seat: 'up',
    layers: [
      P('seat', { x: 0, y: 0.4, w: 3, h: 0.6 }, 2, sofaSeat),
      P('back', { x: 0, y: 0.05, w: 3, h: 0.95 }, 10, sofaBack)
    ]
  },
  armchair: {
    name: 'armchair', w: 1, h: 1, solid: true, seat: 'up',
    layers: [
      P('seat', { x: 0, y: 0.4, w: 1, h: 0.6 }, 2, armSeat),
      P('back', { x: 0, y: 0.05, w: 1, h: 0.95 }, 10, armBack)
    ]
  },
  lowTable: {
    name: 'lowTable', w: 2, h: 1, solid: true, seat: null,
    layers: [P('body', { x: 0, y: 0.45, w: 2, h: 0.53 }, 0, lowTableBody)]
  },
  rug: {
    name: 'rug', w: 4, h: 3, solid: false, seat: null,
    layers: [P('body', { x: 0, y: 0, w: 4, h: 3 }, -70, rugBody)]
  },
  magazines: {
    name: 'magazines', w: 1, h: 1, solid: false, seat: null,
    layers: [P('body', { x: 0.3, y: 0.2, w: 0.4, h: 0.25 }, 6, magazines)]
  },
  floorLamp: {
    name: 'floorLamp', w: 1, h: 1, solid: true, seat: null, lamp: 'warm',
    layers: [
      P('body', { x: 0, y: -1.1, w: 1, h: 2.0 }, 0, floorLampBody)
    ]
  },

  // ---- print alcove ------------------------------------------------------------
  printer: {
    name: 'printer', w: 2, h: 1, solid: true, seat: null, machine: 'printer',
    layers: [
      P('body', { x: 0, y: 0.25, w: 2, h: 0.7 }, 0, printerBody),
      P('paper', { x: 0.5, y: 0.3, w: 1, h: 0.6 }, 6, printerPaper)
    ]
  },
  shredder: {
    name: 'shredder', w: 1, h: 1, solid: true, seat: null,
    layers: [P('body', { x: 0.15, y: 0.22, w: 0.7, h: 0.78 }, 0, shredderBody)]
  },
  paperStack: {
    name: 'paperStack', w: 1, h: 1, solid: false, seat: null,
    layers: [P('body', { x: 0.25, y: 0.35, w: 0.5, h: 0.3 }, 1, paperStack)]
  },

  // ---- circulation dressing -----------------------------------------------------
  extinguisher: {
    name: 'extinguisher', w: 1, h: 1, solid: false, seat: null,
    layers: [P('body', { x: 0.3, y: -0.98, w: 0.4, h: 0.63 }, 0.3, extinguisher)]
  },
  firstAid: {
    name: 'firstAid', w: 1, h: 1, solid: false, seat: null,
    layers: [P('body', { x: 0.25, y: -1.0, w: 0.5, h: 0.5 }, 0.3, firstAid)]
  },
  wallClock: {
    name: 'wallClock', w: 1, h: 1, solid: false, seat: null,
    layers: [P('face', { x: 0.2, y: -1.8, w: 0.6, h: 0.6 }, 0.3, wallClock)]
  },
  framedArt: {
    name: 'framedArt', w: 1, h: 1, solid: false, seat: null,
    layers: [P('face', { x: 0.2, y: -1.6, w: 0.6, h: 0.8 }, 0.3, framedArt)]
  },
  directory: {
    name: 'directory', w: 1, h: 1, solid: false, seat: null,
    layers: [P('face', { x: 0.12, y: -1.8, w: 0.76, h: 1.1 }, 0.3, directory)]
  },
  badgeReader: {
    name: 'badgeReader', w: 1, h: 1, solid: false, seat: null,
    layers: [P('face', { x: 0.32, y: -1.0, w: 0.36, h: 0.5 }, 0.3, badgeReader)]
  },
  ceilLamp: {
    name: 'ceilLamp', w: 1, h: 1, solid: false, seat: null, lamp: 'cool',
    layers: [
      P('head', { x: 0.3, y: -2.6, w: 0.4, h: 0.33 }, 40, ceilLampHead)
    ]
  },
  pendantLamp: {
    name: 'pendantLamp', w: 1, h: 1, solid: false, seat: null, lamp: 'warm',
    layers: [
      P('head', { x: 0.3, y: -2.6, w: 0.4, h: 0.76 }, 40, pendantHead)
    ]
  }
};

// The box every layer of a prop paints into, in its own tiles: the view culls on
// this instead of on the footprint, because a wall paints two and a half tiles
// above the tile it stands on.
for (const def of Object.values(PROPS)) {
  let left = Infinity;
  let right = -Infinity;
  let top = Infinity;
  let bottom = -Infinity;
  for (const v of def.layers) {
    const x1 = v.dst.x + (v.repeat.x - 1) * v.step.x;
    const y1 = v.dst.y + (v.repeat.y - 1) * v.step.y;
    left = Math.min(left, v.dst.x, x1);
    right = Math.max(right, x1 + v.dst.w);
    top = Math.min(top, v.dst.y, y1);
    bottom = Math.max(bottom, y1 + v.dst.h);
  }
  def.box = { left, right, top, bottom };
}

export function propFor(name) {
  return name ? PROPS[name] || null : null;
}

export function layersOf(name) {
  const def = propFor(name);
  return def ? def.layers : [];
}

// Draw one layer of one prop. (ox, oy) is the world point of the prop's box
// top-left, already snapped to the device grid; every dst inside the layer is
// measured from there, in tiles.
export function blitPropLayer(g, page, l, ox, oy) {
  if (!page || !l.src) return false;
  const px = page.tilePx;
  const col = Math.floor(l.src.x);
  const row = Math.floor(l.src.y);
  const at = row * ATLAS_COLS + col;
  const box = page.cells[at];
  const org = page.orig[at];
  if (!box || !org) return false;
  // The bake stands a cell's art on the bottom tile of its four-tile page cell
  // and centres it there, so a slice is mapped through the box the bake
  // returned and through where the art began inside its plate cell — never
  // through the cell's own edge, which sits above the art by however much the
  // plate left blank.
  const sx = Math.round(col * page.cellW + box.x + (l.src.x - col - org.x) * px);
  const sy = Math.round(row * page.cellH + box.y + (l.src.y - row - org.y) * px);
  const sw = Math.max(1, Math.round(l.src.w * px));
  const sh = Math.max(1, Math.round(l.src.h * px));
  const w = Math.max(1, Math.round(l.dst.w * TILE));
  const h = Math.max(1, Math.round(l.dst.h * TILE));

  // No smoothing toggle here: the buffer is authored with smoothing off once,
  // and flipping it inside a frame is exactly the kind of state churn that
  // makes a blit shimmer. Every box below is already on whole world pixels.
  for (let j = 0; j < l.repeat.y; j++) {
    for (let i = 0; i < l.repeat.x; i++) {
      const x = Math.round(ox + (l.dst.x + i * l.step.x) * TILE);
      const y = Math.round(oy + (l.dst.y + j * l.step.y) * TILE);
      if (!l.flip) {
        g.drawImage(page.img, sx, sy, sw, sh, x, y, w, h);
        continue;
      }
      g.save();
      g.translate(x + w, y);
      g.scale(-1, 1);
      g.drawImage(page.img, sx, sy, sw, sh, 0, 0, w, h);
      g.restore();
    }
  }
  return true;
}
