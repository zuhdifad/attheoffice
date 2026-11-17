import { TILE } from '../core/config.js?v=24';
import { canvas } from '../core/draw.js?v=24';
import { PROPS } from './props.js?v=24';

// Every solid prop carries one baked shadow: a soft contact pool at its feet
// and a directional cast thrown to the south-east, the way the north glazing
// lights the room. The offset is (0.35, 0.55) times the prop's height above the
// floor, so a tall wall throws a long wash and a chair a short one. Both shapes
// are gradients laid down once per prop per LOD — the frame pays a single 1:1
// drawImage and ctx.shadowBlur is never touched at all.
//
// Furniture keeps its shadow as a sprite blitted with the prop's own layers.
// The shell — wall, sill, window — never moves, so its shadow is baked straight
// into the ground chunks (world/ground.js) instead: a run of eighty modules
// costs eighty bake-time fills once, not eighty alpha blits every frame.
//
// A sprite's box is snapped outward to the device grid at bake time, so the
// view can blit it at (prop origin + sprite offset) with both terms already on
// whole device pixels: no rounding inside the frame, no half-pixel seam.
const DIR_X = 0.35;
const DIR_Y = 0.55;
const INK = '12,14,20';

// A bench's art spans two footprint rows, but the object itself stands under a
// tile tall: the cast is measured off the surface, not off the far aisle row.
const HEIGHT = { desk: 0.85, table: 0.85 };

// Glazing lets the daylight through: a window or a glass partition keeps a
// faint contact seat only, never a cast that would contradict its own beam.
const GLASSY = new Set(['window', 'glazed', 'glassWall', 'glassDoor']);

// The room's shell: its shadow belongs to the ground bake, not to a sprite.
export const SHELL = new Set(['wall', 'sill', 'window']);

const cache = new WeakMap();

// The shadow itself, in world units with the prop's box top-left at (ox, oy).
// Shared by the sprite bake and the ground chunk bake, so a chair's seat and a
// wall's wash are the same shapes wherever they are laid.
export function paintShadow(ctx, def, ox, oy) {
  const w = def.w;
  const h = def.h;
  const H = HEIGHT[def.name] ?? (def.box.bottom - def.box.top);
  const glass = GLASSY.has(def.name);
  const dx = DIR_X * H;
  const dy = DIR_Y * H;

  ctx.save();
  ctx.translate(ox, oy);

  // The cast first, so the contact pool seats on top of its near end.
  if (!glass && dy > 0.02) {
    const grad = ctx.createLinearGradient(0, h, dx, h + dy);
    grad.addColorStop(0, `rgba(${INK},0.18)`);
    grad.addColorStop(0.6, `rgba(${INK},0.07)`);
    grad.addColorStop(1, `rgba(${INK},0)`);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(0, h);
    ctx.lineTo(w, h);
    ctx.lineTo(w + dx, h + dy);
    ctx.lineTo(dx, h + dy);
    ctx.closePath();
    ctx.fill();
  }

  // Contact: furniture seats on a soft ellipse under its front edge; a wall
  // module seats on a full-width strip, so a run of them lays one continuous
  // sink instead of a scalloped row of overlapping pools.
  if (SHELL.has(def.name)) {
    const d = 0.22;
    const grad = ctx.createLinearGradient(0, h, 0, h + d);
    grad.addColorStop(0, `rgba(${INK},${glass ? 0.12 : 0.2})`);
    grad.addColorStop(1, `rgba(${INK},0)`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, h, w, d);
  } else {
    const cx = w / 2;
    const cy = h - 0.06;
    const rx = w / 2 + 0.10;
    const ry = 0.16 + h * 0.05;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(rx, ry);
    const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    grad.addColorStop(0, `rgba(${INK},${glass ? 0.12 : 0.22})`);
    grad.addColorStop(0.65, `rgba(${INK},${glass ? 0.06 : 0.1})`);
    grad.addColorStop(1, `rgba(${INK},0)`);
    ctx.fillStyle = grad;
    ctx.fillRect(-1, -1, 2, 2);
    ctx.restore();
  }

  ctx.restore();
}

function bakeShadow(def, tilePx) {
  const ppu = tilePx / TILE;
  const w = def.w;
  const h = def.h;
  const H = HEIGHT[def.name] ?? (def.box.bottom - def.box.top);
  const glass = GLASSY.has(def.name);
  const ox = DIR_X * H;
  const oy = DIR_Y * H;

  let minX = 0, maxX = w, minY = h - 0.1, maxY = h;
  if (SHELL.has(def.name)) {
    maxY = h + 0.22;
  } else {
    const rx = w / 2 + 0.10;
    const ry = 0.16 + h * 0.05;
    minX = Math.min(minX, w / 2 - rx);
    maxX = Math.max(maxX, w / 2 + rx);
    minY = Math.min(minY, h - 0.06 - ry);
    maxY = Math.max(maxY, h - 0.06 + ry);
  }
  if (!glass) {
    maxX = Math.max(maxX, w + ox);
    maxY = Math.max(maxY, h + oy);
  }
  const pad = 2 / ppu;
  const x0 = Math.floor((minX - pad) * ppu) / ppu;
  const y0 = Math.floor((minY - pad) * ppu) / ppu;
  const cw = Math.ceil((maxX + pad - x0) * ppu);
  const ch = Math.ceil((maxY + pad - y0) * ppu);

  const { c, ctx } = canvas(cw, ch);
  ctx.scale(ppu, ppu);
  paintShadow(ctx, def, -x0, -y0);

  return { img: c, x: x0, y: y0, w: cw / ppu, h: ch / ppu };
}

// The shadow sprite for one prop at one LOD, or null for anything that does
// not stand on the floor — and for the shell, whose shadow the ground already
// carries. Cached on the definition, so every chair shares the one bake.
export function shadowFor(def, tilePx) {
  if (!def.solid || SHELL.has(def.name)) return null;
  let byLod = cache.get(def);
  if (!byLod) { byLod = new Map(); cache.set(def, byLod); }
  let s = byLod.get(tilePx);
  if (!s) { s = bakeShadow(def, tilePx); byLod.set(tilePx, s); }
  return s;
}

// Warm every standing prop's sprite at this LOD before the first frame draws.
export function primeShadows(tilePx) {
  for (const def of Object.values(PROPS)) shadowFor(def, tilePx);
}