import { TILE, CHAR_H, VIEW_W, VIEW_H, SCREEN_W, SCREEN_H } from '../core/config.js';
import { isObject, blitCell, atlasImage } from '../art/tiles.js';
import { PAL } from '../art/palette.js';
import { drawChar } from '../art/characters.js';
import { text, px } from '../core/draw.js';
import { drawLight, drawGrade, drawTimeOfDay } from './lighting.js';
import { drawFx } from './fx.js';
import { activeTask, dayProgress } from '../game/day.js';

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

  const x0 = Math.floor(rcam.x / TILE);
  const y0 = Math.floor(rcam.y / TILE);
  const stacked = [];

  for (let y = y0; y <= y0 + VIEW_H; y++) {
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

  if (state.grid) drawGrid(g, rcam, x0, y0);
  if (state.hints) drawStations(g, state, rcam);

  // Contact shadows go down before anything stands on them.
  const people = [];
  for (const n of npcs) {
    if (n.px / TILE < x0 - 2 || n.px / TILE > x0 + VIEW_W + 2) continue;
    if (n.py / TILE < y0 - 2 || n.py / TILE > y0 + VIEW_H + 2) continue;
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

  const workBob = player.working && Math.floor(state.tick / 8) % 2 === 0 ? -1 : 0;
  const walkBob = player.moving && (player.frame === 1 || player.frame === 4) ? -1 : 0;
  stacked.push({
    foot: player.py + TILE + 1,
    kind: 'char',
    id: player.id,
    dir: player.dir,
    frame: player.frame,
    dx: Math.round(player.px - rcam.x),
    dy: Math.round(player.py - rcam.y - LIFT) + workBob + walkBob,
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
  drawTimeOfDay(g, state.phase === 'play' || state.phase === 'done' ? dayProgress(state) : 0);
  drawGrade(g);

  // Anything that talks to the player sits above the light pass.
  for (const n of people) if (n.say > 0) bubble(g, n, rcam);
  if (state.hints) compass(g, state, rcam);
  drawNameTags(g, state, rcam, people);
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

function drawGrid(g, cam, x0, y0) {
  g.save();
  g.strokeStyle = 'rgba(150,200,215,0.16)';
  g.lineWidth = 1;
  for (let x = x0; x <= x0 + VIEW_W + 1; x++) {
    const dx = Math.round(x * TILE - cam.x) + 0.5;
    g.beginPath();
    g.moveTo(dx, 0);
    g.lineTo(dx, SCREEN_H);
    g.stroke();
  }
  for (let y = y0; y <= y0 + VIEW_H + 1; y++) {
    const dy = Math.round(y * TILE - cam.y) + 0.5;
    g.beginPath();
    g.moveTo(0, dy);
    g.lineTo(SCREEN_W, dy);
    g.stroke();
  }
  g.restore();
}

// The active objective stands on the tileset's own green ring; the ones behind
// it in the day wear the red cross. Both are authored pieces, so the markers
// belong to the same art rather than to a UI layer bolted on top.
function drawStations(g, state, cam) {
  const atlas = atlasImage();
  const active = activeTask(state);
  for (const t of state.tasks) {
    const dx = t.x * TILE - cam.x;
    const dy = t.y * TILE - cam.y;
    if (dx < -TILE || dy < -TILE || dx > SCREEN_W || dy > SCREEN_H) continue;

    const isActive = active && t.id === active.id;
    const pulse = (Math.sin(state.tick * 0.08) + 1) / 2;

    g.save();
    if (t.done) {
      g.globalAlpha = 0.34;
      blitCell(g, atlas, 'O', dx, dy);
      g.globalAlpha = 0.85;
      g.strokeStyle = PAL.ok;
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(dx + 12, dy + 17);
      g.lineTo(dx + 15, dy + 21);
      g.lineTo(dx + 21, dy + 12);
      g.stroke();
      g.restore();
      continue;
    }

    g.globalAlpha = isActive ? 0.42 + pulse * 0.4 : 0.2;
    blitCell(g, atlas, isActive ? 'O' : 'X', dx, dy);

    if (isActive) {
      // A chevron floating over the tile, bobbing.
      const cy = dy - 6 - Math.round(pulse * 3);
      g.globalAlpha = 0.92;
      g.fillStyle = PAL.amber;
      g.beginPath();
      g.moveTo(dx + TILE / 2, cy + 7);
      g.lineTo(dx + TILE / 2 - 6, cy);
      g.lineTo(dx + TILE / 2 + 6, cy);
      g.closePath();
      g.fill();
    }
    g.restore();
  }
}

// When the objective is off screen, an arrow pinned to the edge points at it.
// The clamp keeps it clear of the name bar above and the objective strip below.
function compass(g, state, cam) {
  const t = activeTask(state);
  if (!t) return;
  const cx = t.x * TILE + TILE / 2 - cam.x;
  const cy = t.y * TILE + TILE / 2 - cam.y;
  const padX = 24;
  const top = 46;
  const bottom = SCREEN_H - 58;
  if (cx > padX && cx < SCREEN_W - padX && cy > top && cy < bottom) return;

  const ax = Math.max(padX, Math.min(SCREEN_W - padX, cx));
  const ay = Math.max(top, Math.min(bottom, cy));
  const ang = Math.atan2(cy - SCREEN_H / 2, cx - SCREEN_W / 2);
  const dist = Math.round(Math.hypot(t.x - state.player.tx, t.y - state.player.ty));

  g.save();
  g.translate(ax, ay);
  g.globalAlpha = 0.92;
  g.fillStyle = 'rgba(16,19,27,0.82)';
  g.beginPath();
  g.arc(0, 0, 13, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = PAL.amber;
  g.lineWidth = 1;
  g.stroke();

  g.rotate(ang);
  g.fillStyle = PAL.amber;
  g.beginPath();
  g.moveTo(9, 0);
  g.lineTo(1, -5);
  g.lineTo(1, 5);
  g.closePath();
  g.fill();
  g.rotate(-ang);

  text(g, `${dist}`, 0, 10, PAL.text, 'center', 7, 'rgba(0,0,0,0.7)');
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