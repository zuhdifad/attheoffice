import { TILE } from '../core/config.js?v=8';
import { PAL } from '../art/palette.js?v=8';

// A fixed pool, so a long day never allocates its way into a stutter and a
// restart never leaves an emitter running. Everything is in world pixels.
const MAX = 320;
const pool = [];
for (let i = 0; i < MAX; i++) {
  pool.push({ live: false, x: 0, y: 0, vx: 0, vy: 0, g: 0, life: 0, max: 1, size: 1, color: '#fff', kind: 'dot' });
}
let cursor = 0;

export function resetFx() {
  for (const p of pool) p.live = false;
  cursor = 0;
}

function spawn(o) {
  // Round-robin over the pool: the oldest particle is the one recycled.
  for (let i = 0; i < MAX; i++) {
    const p = pool[(cursor + i) % MAX];
    if (p.live) continue;
    cursor = (cursor + i + 1) % MAX;
    Object.assign(p, { live: true, g: 0, kind: 'dot', size: 1 }, o);
    p.max = p.life;
    return p;
  }
  return null;
}

export function updateFx() {
  for (const p of pool) {
    if (!p.live) continue;
    p.life--;
    if (p.life <= 0) { p.live = false; continue; }
    p.x += p.vx;
    p.y += p.vy;
    p.vy += p.g;
    p.vx *= 0.97;
    if (p.kind === 'steam') p.vx += Math.sin((p.max - p.life) * 0.14) * 0.045;
  }
}

export function drawFx(g, cam) {
  for (const p of pool) {
    if (!p.live) continue;
    const t = p.life / p.max;
    const x = Math.round(p.x - cam.x);
    const y = Math.round(p.y - cam.y);
    g.globalAlpha = p.kind === 'steam' ? t * 0.42 : Math.min(1, t * 1.6);
    g.fillStyle = p.color;
    if (p.kind === 'ring') {
      const r = Math.round((1 - t) * p.size);
      g.globalAlpha = t * 0.7;
      g.strokeStyle = p.color;
      g.lineWidth = 1;
      g.beginPath();
      g.arc(x, y, Math.max(1, r), 0, Math.PI * 2);
      g.stroke();
    } else {
      const s = p.kind === 'confetti' ? p.size : Math.max(1, Math.round(p.size * t));
      g.fillRect(x - (s >> 1), y - (s >> 1), s, p.kind === 'confetti' ? Math.max(1, s - 1) : s);
    }
  }
  g.globalAlpha = 1;
}

// ---- emitters ---------------------------------------------------------------

export function dust(tx, ty) {
  const cx = tx * TILE + TILE / 2;
  const cy = ty * TILE + TILE - 3;
  for (let i = 0; i < 3; i++) {
    spawn({
      x: cx + (Math.random() - 0.5) * 10,
      y: cy + (Math.random() - 0.5) * 3,
      vx: (Math.random() - 0.5) * 0.5,
      vy: -0.15 - Math.random() * 0.25,
      g: 0.012,
      life: 16 + Math.random() * 10,
      size: 2,
      color: Math.random() < 0.5 ? PAL.floorLit : PAL.floorShade
    });
  }
}

export function sparkle(tx, ty, color = PAL.amber) {
  const cx = tx * TILE + TILE / 2;
  const cy = ty * TILE + TILE / 2;
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2 + Math.random() * 0.3;
    const sp = 0.9 + Math.random() * 1.5;
    spawn({
      x: cx, y: cy,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp - 0.5,
      g: 0.045,
      life: 22 + Math.random() * 16,
      size: 2,
      color: i % 3 === 0 ? PAL.text : color
    });
  }
  spawn({ x: cx, y: cy, vx: 0, vy: 0, life: 20, size: 26, color, kind: 'ring' });
}

export function confetti(tx, ty) {
  const cx = tx * TILE + TILE / 2;
  const cy = ty * TILE + TILE / 2;
  const colors = [PAL.tealLit, PAL.amber, PAL.coral, PAL.leaf, PAL.sky, PAL.grape, PAL.text];
  for (let i = 0; i < 46; i++) {
    const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.4;
    const sp = 1.4 + Math.random() * 3.0;
    spawn({
      x: cx + (Math.random() - 0.5) * 12,
      y: cy,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp,
      g: 0.10,
      life: 44 + Math.random() * 34,
      size: 2 + Math.floor(Math.random() * 2),
      color: colors[i % colors.length],
      kind: 'confetti'
    });
  }
  spawn({ x: cx, y: cy, vx: 0, vy: 0, life: 26, size: 40, color: PAL.ok, kind: 'ring' });
}

export function steam(tx, ty) {
  spawn({
    x: tx * TILE + TILE / 2 + (Math.random() - 0.5) * 8,
    y: ty * TILE + 8,
    vx: (Math.random() - 0.5) * 0.15,
    vy: -0.28 - Math.random() * 0.2,
    life: 40 + Math.random() * 24,
    size: 2 + Math.floor(Math.random() * 2),
    color: PAL.text,
    kind: 'steam'
  });
}

export function mote(x, y, color) {
  spawn({
    x, y,
    vx: (Math.random() - 0.5) * 0.22,
    vy: -0.06 - Math.random() * 0.12,
    life: 90 + Math.random() * 90,
    size: 1,
    color
  });
}

export function shake(cam, amount) {
  cam.shake = Math.min(7, cam.shake + amount);
}