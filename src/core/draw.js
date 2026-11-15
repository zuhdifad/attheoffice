import { TILE } from './config.js?v=9';

// Every pixel in the game is authored through these helpers, so the
// no-smoothing rule only has to be written once.
export function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  return { c, ctx };
}

export function makeTile(paint) {
  const { c, ctx } = canvas(TILE, TILE);
  paint(ctx);
  return c;
}

export const px = (ctx, x, y, w, h, color) => {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
};

// Vertical ramp. Only where a surface reads as curved or lit: glass, polished
// metal, light shafts. Flat surfaces stay banded.
export function vgrad(ctx, x, y, w, h, stops) {
  const ramp = ctx.createLinearGradient(x, y, x, y + h);
  for (const [at, color] of stops) ramp.addColorStop(Math.max(0, Math.min(1, at)), color);
  ctx.fillStyle = ramp;
  ctx.fillRect(x, y, w, h);
}

// Light on the top and left, dark on the bottom and right.
export function bevel(ctx, x, y, w, h, light, dark) {
  px(ctx, x, y, w, 1, light);
  px(ctx, x, y, 1, h, light);
  px(ctx, x, y + h - 1, w, 1, dark);
  px(ctx, x + w - 1, y, 1, h, dark);
}

// The drop is drawn first so the glyph never loses weight on top of the world.
export function text(g, str, x, y, color = '#e8ecf4', align = 'left', size = 8, shadow = null) {
  g.font = `${size}px ui-monospace, Menlo, monospace`;
  g.textAlign = align;
  if (shadow) {
    g.fillStyle = shadow;
    g.fillText(str, x + 1, y + 1);
  }
  g.fillStyle = color;
  g.fillText(str, x, y);
  g.textAlign = 'left';
}
