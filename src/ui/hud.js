import { SCREEN_W, SCREEN_H } from '../core/config.js';
import { text, px, vgrad } from '../core/draw.js';
import { PAL } from '../art/palette.js';
import { activeTask, atStation, dayClock, dayProgress, tasksLeft } from '../game/day.js';

// The device's own local time, so the office clock agrees with whatever the
// player's computer shows. Used on the clock-in receipt; the shift itself runs
// on the day clock below.
export function wallClock() {
  const d = new Date();
  const two = (n) => String(n).padStart(2, '0');
  return `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;
}

const BAR_H = 22;

// Top bar. Drawn last so it sits above the y-sorted world and above the light
// pass. Translucent, so it reads as glass over the room rather than a black
// strip: who you are, what the time is, and what you are meant to be doing.
export function drawHud(g, state) {
  const p = state.player;
  const task = activeTask(state);
  const t = dayProgress(state);
  const late = t > 0.8;

  vgrad(g, 0, 0, SCREEN_W, BAR_H, [
    [0, 'rgba(20,24,34,0.90)'],
    [1, 'rgba(11,14,21,0.66)']
  ]);
  px(g, 0, 0, SCREEN_W, 1, 'rgba(150,200,215,0.16)');
  px(g, 0, BAR_H, SCREEN_W, 1, 'rgba(6,8,13,0.45)');

  // Who. The accent chip is the same colour as the ring under the sprite.
  px(g, 5, 6, 3, 11, state.chosen.tint);
  text(g, p.name.toUpperCase(), 13, 12, PAL.text, 'left', 8, 'rgba(0,0,0,0.6)');
  text(g, state.chosen.role, 13, 19, PAL.textFaint, 'left', 6);

  // The shift clock, with a hairline of the day underneath it.
  const clock = dayClock(state);
  text(g, clock, SCREEN_W - 6, 12, late ? PAL.danger : PAL.text, 'right', 9, 'rgba(0,0,0,0.6)');
  const gw = 62;
  const gx = SCREEN_W - 6 - gw;
  px(g, gx, 16, gw, 3, 'rgba(255,255,255,0.10)');
  px(g, gx, 16, Math.round(gw * t), 3, late ? PAL.danger : PAL.tealLit);
  text(g, `${state.tasks.length - tasksLeft(state)}/${state.tasks.length}`, gx - 6, 19, PAL.textDim, 'right', 7);

  // Score, centre, with the streak beside it when there is one.
  text(g, String(state.score).padStart(4, '0'), SCREEN_W / 2, 12, PAL.amber, 'center', 9, 'rgba(0,0,0,0.6)');
  if (state.combo > 1) {
    text(g, `SYNC ×${state.combo}`, SCREEN_W / 2, 19, PAL.ok, 'center', 6);
  } else {
    text(g, 'POINTS', SCREEN_W / 2, 19, PAL.textFaint, 'center', 6);
  }

  if (state.phase === 'play' && task) objective(g, state, task);
  toasts(g, state);
  if (state.tick < 168 && state.phase === 'play') introCard(g, state);
}

// The bottom strip: what to do, where, and the work bar while you are doing it.
function objective(g, state, task) {
  const near = atStation(state, task);
  const h = state.work > 0 || near ? 40 : 24;
  const y = SCREEN_H - h;

  vgrad(g, 0, y, SCREEN_W, h, [
    [0, 'rgba(11,14,21,0.62)'],
    [1, 'rgba(16,20,29,0.92)']
  ]);
  px(g, 0, y, SCREEN_W, 1, 'rgba(150,200,215,0.13)');

  px(g, 6, y + 7, 3, 10, near ? PAL.ok : PAL.amber);
  text(g, task.label, 14, y + 12, PAL.text, 'left', 8, 'rgba(0,0,0,0.6)');
  text(g, task.hint, 14, y + 20, PAL.textFaint, 'left', 6);

  if (!near) {
    text(g, state.hints ? 'Follow the marker' : '', SCREEN_W - 8, y + 14, PAL.textDim, 'right', 7);
    return;
  }

  if (state.work <= 0) {
    const blink = Math.floor(state.tick / 26) % 2 === 0;
    text(g, 'HOLD  E', SCREEN_W - 8, y + 14, blink ? PAL.amber : PAL.textDim, 'right', 8, 'rgba(0,0,0,0.6)');
    px(g, SCREEN_W - 58, y + 17, 50, 1, 'rgba(255,255,255,0.10)');
    text(g, task.verb, SCREEN_W - 8, y + 26, PAL.textFaint, 'right', 6);
    return;
  }

  // Work bar.
  const bx = 14;
  const bw = SCREEN_W - 28;
  const by = y + 25;
  const pct = Math.min(1, state.work / task.need);
  px(g, bx, by, bw, 6, 'rgba(255,255,255,0.09)');
  px(g, bx, by, Math.round(bw * pct), 6, PAL.tealLit);
  px(g, bx, by, Math.round(bw * pct), 1, 'rgba(255,255,255,0.30)');
  text(g, `${task.verb.toUpperCase()}  ${Math.round(pct * 100)}%`, bx, y + 20, PAL.tealLit, 'left', 7, 'rgba(0,0,0,0.6)');
  text(g, `SYNC ${task.hits}/3`, SCREEN_W - 14, y + 20, task.hits ? PAL.amber : PAL.textFaint, 'right', 7);

  // The sync band sits on the same bar: tap Space while the needle is inside it.
  const s = state.sync;
  if (s && task.hits < 3) {
    const bandX = bx + Math.round((s.band - s.width / 2) * bw);
    const bandW = Math.max(3, Math.round(s.width * bw));
    px(g, bandX, by - 1, bandW, 8, 'rgba(242,177,52,0.34)');
    px(g, bandX, by - 1, 1, 8, PAL.amber);
    px(g, bandX + bandW - 1, by - 1, 1, 8, PAL.amber);
    const nx = bx + Math.round(s.pos * bw);
    px(g, nx - 1, by - 3, 2, 12, PAL.text);
    text(g, 'SPACE', bx + bw / 2, y + 38, PAL.textDim, 'center', 6);
  }
}

function toasts(g, state) {
  let y = BAR_H + 8;
  for (const t of state.toasts) {
    const age = t.max - t.life;
    const slide = age < 10 ? (10 - age) * 1.4 : 0;
    const fade = t.life < 26 ? t.life / 26 : 1;
    g.save();
    g.globalAlpha = fade;
    g.font = '8px ui-monospace, Menlo, monospace';
    const w = Math.max(
      g.measureText(t.text).width,
      g.measureText(t.sub).width * 0.82
    ) + 20;
    const x = SCREEN_W / 2 - w / 2 + slide;
    const h = t.sub ? 26 : 17;
    px(g, x, y, w, h, 'rgba(14,18,26,0.90)');
    px(g, x, y, 2, h, t.color);
    px(g, x, y, w, 1, 'rgba(255,255,255,0.08)');
    text(g, t.text, x + w / 2 + 1, y + 11, t.color, 'center', 8, 'rgba(0,0,0,0.6)');
    if (t.sub) text(g, t.sub, x + w / 2 + 1, y + 21, PAL.textDim, 'center', 6);
    g.restore();
    y += h + 4;
  }
}

// A card that names the shift, then gets out of the way. Play is already
// running underneath it, so it never blocks the first input.
function introCard(g, state) {
  const t = state.tick;
  const fade = t < 18 ? t / 18 : t > 132 ? Math.max(0, (168 - t) / 36) : 1;
  if (fade <= 0) return;
  g.save();
  g.globalAlpha = fade;
  const w = 190;
  const h = 54;
  const x = SCREEN_W / 2 - w / 2;
  const y = SCREEN_H / 2 - h / 2 - 8;
  px(g, x, y, w, h, 'rgba(12,16,23,0.92)');
  px(g, x, y, w, 1, PAL.tealLit);
  px(g, x, y + h - 1, w, 1, 'rgba(0,0,0,0.5)');
  text(g, 'MONDAY · DEF PROJECT', x + w / 2, y + 15, PAL.textFaint, 'center', 7);
  text(g, '09:00  SHIFT START', x + w / 2, y + 30, PAL.text, 'center', 10, 'rgba(0,0,0,0.6)');
  text(g, `${state.tasks.length} objectives · clock out by 17:00`, x + w / 2, y + 44, PAL.tealLit, 'center', 7);
  g.restore();
}