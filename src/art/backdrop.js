import { BUFFER_W, BUFFER_H, SCREEN_W, SCREEN_H } from '../core/config.js?v=26';
import { px, vgrad } from '../core/draw.js?v=26';

// One cached vignette is shared by the menus and the world, which is what stops
// the start screen from looking like a different product than the room. It is
// baked at the buffer's size and drawn 1:1, so it never has to be stretched.

let vig = null;

function vignetteLayer() {
  if (vig) return vig;
  const c = document.createElement('canvas');
  c.width = BUFFER_W;
  c.height = BUFFER_H;
  const x = c.getContext('2d');
  const r = x.createRadialGradient(
    BUFFER_W / 2, BUFFER_H / 2, Math.min(BUFFER_W, BUFFER_H) * 0.30,
    BUFFER_W / 2, BUFFER_H / 2, BUFFER_W * 0.74
  );
  r.addColorStop(0, 'rgba(8,11,17,0)');
  r.addColorStop(0.55, 'rgba(8,11,17,0.10)');
  r.addColorStop(1, 'rgba(6,8,13,0.46)');
  x.fillStyle = r;
  x.fillRect(0, 0, BUFFER_W, BUFFER_H);
  vig = c;
  return c;
}

export function vignette(g, alpha = 1) {
  g.save();
  g.globalAlpha = alpha;
  g.drawImage(vignetteLayer(), 0, 0);
  g.restore();
}

// Full-screen wash, top to bottom. Menus use the same call with other stops.
export function wash(g, top = '#1e2430', bottom = '#12161f') {
  vgrad(g, 0, 0, SCREEN_W, SCREEN_H, [[0, top], [0.55, bottom], [1, '#0d1117']]);
}

// A raised surface: lit top and left, shaded bottom and right, plus the shadow
// it throws onto the wash behind it.
export function panel(g, x, y, w, h, fill = '#242a36') {
  px(g, x + 2, y + h, w - 2, 2, 'rgba(0,0,0,0.34)');
  px(g, x, y, w, h, fill);
  px(g, x, y, w, 1, 'rgba(255,255,255,0.09)');
  px(g, x, y, 1, h, 'rgba(255,255,255,0.06)');
  px(g, x, y + h - 1, w, 1, 'rgba(0,0,0,0.32)');
  px(g, x + w - 1, y, 1, h, 'rgba(0,0,0,0.24)');
}

// Recessed well, for anything that holds a value.
export function well(g, x, y, w, h, fill = '#0e1219') {
  px(g, x, y, w, h, fill);
  px(g, x, y, w, 1, 'rgba(0,0,0,0.55)');
  px(g, x, y, 1, h, 'rgba(0,0,0,0.40)');
  px(g, x, y + h - 1, w, 1, 'rgba(255,255,255,0.06)');
  px(g, x + w - 1, y, 1, h, 'rgba(255,255,255,0.04)');
}
