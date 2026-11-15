import { TILE, CHAR_H, VIEW_W, SCREEN_W, SCREEN_H, WORLD_SY, VIEW_PX_H } from '../core/config.js?v=9';
import { isObject, blitCell, atlasImage } from '../art/tiles.js?v=9';
import { PAL } from '../art/palette.js?v=9';
import { drawChar } from '../art/characters.js?v=9';
import { text, px } from '../core/draw.js?v=9';
import { drawLight, drawGrade, drawTimeOfDay } from './lighting.js?v=9';
import { drawFx } from './fx.js?v=9';
import { now } from '../ui/wallclock.js?v=9';

const LIFT = CHAR_H - TILE;

// Ground first, then one y-sorted pass holding every prop and every person, so
// you walk behind a desk and in front of the one below it without any layer
// bookkeeping. This is the web stand-in for Unity's sorting layers.
export function drawWorld(g, state) {
  const { map, npcs, player, cam } = state;
  const atlas = atlasImage();

  // Camera shake rides on top of the smoothed camera and decays in world.js.
  const s = cam.shake;
  const rcam = s > 0.05
    ? { x: Math.round(cam.x + (Math.random() - 0.5) * s), y: Math.round(cam.y + (Math.random() - 0.5) * s) }
    : { x: Math.round(cam.x), y: Math.round(cam.y) };

  g.fillStyle = PAL.ink;
  g.fillRect(0, 0, SCREEN_W, SCREEN_H);
  if (!atlas) return;

  // The whole world pass is drawn into a vertically foreshortened slice so a
  // floor square reads wider than tall — the fixed 3/4 oblique of the reference.
  // Lighting that belongs to the room rides inside the same transform; the
  // full-screen grade and time wash are applied afterwards, in screen space.
  g.save();
  g.scale(1, WORLD_SY);

  const x0 = Math.floor(rcam.x / TILE);
  const y0 = Math.floor(rcam.y / TILE);
  const rows = Math.ceil(VIEW_PX_H / TILE) + 1;
  const stacked = [];

  for (let y = y0; y <= y0 + rows; y++) {
    for (let x = x0; x <= x0 + VIEW_W; x++) {
      if (x < 0 || y < 0 || x >= map.w || y >= map.h) continue;
      const id = map.get(x, y);
      const dx = x * TILE - rcam.x;
      const dy = y * TILE - rcam.y;
      // Ground goes down everywhere, including under the props, so a desk sits
      // on the same stone as the aisle beside it.
      blitCell(g, atlas, map.floorAt(x, y), dx, dy);
      if (isObject(id)) stacked.push({ foot: (y + 1) * TILE, kind: 'tile', id, dx, dy });
    }
  }

  drawGrout(g, rcam, x0, y0, rows, map);

  // Contact shadows go down before anything stands on them.
  const people = [];
  for (const n of npcs) {
    if (n.px / TILE < x0 - 2 || n.px / TILE > x0 + VIEW_W + 2) continue;
    if (n.py / TILE < y0 - 2 || n.py / TILE > y0 + rows + 2) continue;
    people.push(n);
  }
  for (const n of people) shadow(g, n.px - rcam.x, n.py - rcam.y, n.seated ? 11 : 13);
  shadow(g, player.px - rcam.x, player.py - rcam.y, 14, PAL.shadow);

  for (const n of people) {
    const bob = n.seated
      ? (Math.floor((state.tick + n.off) / 22) % 2 === 0 ? 0 : -1)
      : (n.moving && n.frame === 3 ? -1 : 0);
    stacked.push({
      foot: n.py + TILE + (n.seated ? -2 : 0),
      kind: 'char',
      id: n.id,
      dir: n.dir,
      frame: n.frame,
      dx: Math.round(n.px - rcam.x),
      dy: Math.round(n.py - rcam.y - LIFT + (n.seated ? 6 : 0) + bob)
    });
  }

  const walkBob = player.moving && (player.frame === 1 || player.frame === 4) ? -1 : 0;
  stacked.push({
    foot: player.py + TILE + 1,
    kind: 'char',
    id: player.id,
    dir: player.dir,
    frame: player.frame,
    dx: Math.round(player.px - rcam.x),
    dy: Math.round(player.py - rcam.y - LIFT) + walkBob,
    hero: true
  });

  stacked.sort((a, b) => a.foot - b.foot);
  for (const o of stacked) {
    if (o.kind === 'tile') {
      blitCell(g, atlas, o.id, o.dx, o.dy);
    } else {
      if (o.hero) heroRing(g, state, o.dx, o.dy + LIFT);
      drawChar(g, o.id, o.dir, o.frame, o.dx, o.dy);
    }
  }

  drawFx(g, rcam);
  drawLight(g, { map, cam: rcam });

  // Anything that talks to the player sits above the light pass but still in
  // world space, so it tracks the sprite it belongs to.
  for (const n of people) if (n.say > 0) bubble(g, n, rcam);
  drawNameTags(g, state, rcam, people);

  g.restore();

  // The room's light follows the device's own day: cool before mid-morning,
  // amber once the evening comes on.
  const d = now();
  const dayT = Math.max(0, Math.min(1, (d.getHours() + d.getMinutes() / 60 - 7) / 12));
  drawTimeOfDay(g, dayT);
  drawGrade(g);
}

function shadow(g, dx, dy, w, color = 'rgba(12,14,20,0.26)') {
  g.save();
  g.fillStyle = color;
  g.beginPath();
  g.ellipse(dx + TILE / 2, dy + TILE - 3, w / 2, w / 4.6, 0, 0, Math.PI * 2);
  g.fill();
  g.restore();
}

// A quiet ring under the player, in their own accent, so you never lose
// yourself in a crowd of seven identical silhouettes.
function heroRing(g, state, dx, dy) {
  const pulse = 0.42 + Math.sin(state.tick * 0.07) * 0.12;
  g.save();
  g.globalAlpha = pulse;
  g.strokeStyle = state.chosen.tint;
  g.lineWidth = 1;
  g.beginPath();
  g.ellipse(dx + TILE / 2, dy + TILE - 3, 9, 4, 0, 0, Math.PI * 2);
  g.stroke();
  g.restore();
}

// Large-format slabs meet in a hairline joint, light enough that the floor
// reads as one continuous surface instead of a checkerboard.
function drawGrout(g, cam, x0, y0, rows, map) {
  const xa = Math.max(x0, 0), xb = Math.min(x0 + VIEW_W + 1, map.w);
  const ya = Math.max(y0, 0), yb = Math.min(y0 + rows + 1, map.h);
  g.save();
  g.strokeStyle = 'rgba(104,96,82,0.20)';
  g.lineWidth = 1;
  g.beginPath();
  for (let x = xa; x <= xb; x++) {
    const dx = Math.round(x * TILE - cam.x) + 0.5;
    g.moveTo(dx, ya * TILE - cam.y);
    g.lineTo(dx, yb * TILE - cam.y);
  }
  for (let y = ya; y <= yb; y++) {
    const dy = Math.round(y * TILE - cam.y) + 0.5;
    g.moveTo(xa * TILE - cam.x, dy);
    g.lineTo(xb * TILE - cam.x, dy);
  }
  g.stroke();
  g.restore();
}

function bubble(g, n, cam) {
  const dx = Math.round(n.px - cam.x) + TILE / 2;
  const dy = Math.round(n.py - cam.y) - LIFT - 4;
  g.font = '7px ui-monospace, Menlo, monospace';
  const w = Math.min(150, Math.ceil(g.measureText(n.line).width) + 10);
  const x = Math.max(2, Math.min(SCREEN_W - w - 2, dx - w / 2));
  const y = Math.max(14, dy - 14);
  const fade = Math.min(1, n.say / 30);

  g.save();
  g.globalAlpha = fade * 0.94;
  px(g, x, y, w, 13, 'rgba(243,241,236,0.94)');
  px(g, x, y + 12, w, 1, 'rgba(20,23,31,0.30)');
  g.fillStyle = 'rgba(243,241,236,0.94)';
  g.beginPath();
  g.moveTo(dx - 3, y + 13);
  g.lineTo(dx + 3, y + 13);
  g.lineTo(dx, y + 17);
  g.closePath();
  g.fill();
  text(g, n.line, x + w / 2, y + 9, PAL.ink, 'center', 7);
  g.restore();
}

// Names only appear near the player, so the room stays readable instead of
// wearing seven floating labels at once.
function drawNameTags(g, state, cam, people) {
  const p = state.player;
  for (const n of people) {
    if (n.say > 0) continue;
    const d = Math.abs(n.tx - p.tx) + Math.abs(n.ty - p.ty);
    if (d > 2) continue;
    const dx = Math.round(n.px - cam.x) + TILE / 2;
    const dy = Math.round(n.py - cam.y) - LIFT - 2;
    g.save();
    g.globalAlpha = Math.max(0, 1 - (d - 1) * 0.4);
    text(g, n.name, dx, dy, n.tint, 'center', 7, 'rgba(8,10,15,0.85)');
    g.restore();
  }
}