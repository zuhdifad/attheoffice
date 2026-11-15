import { SCREEN_W } from '../core/config.js?v=9';
import { text, px } from '../core/draw.js?v=9';
import { now, weekday } from './wallclock.js?v=9';

// The only thing the room wears is the handheld's parchment clock, top-right:
// the calendar day and weekday over a 12-hour AM/PM time, all of it the device's
// real time. Under it sits the clocked-in chip — the one status the floor has.
// No score, no objectives — the floor is just a floor.

const INK = '#3a2c1a';
const BORDER = '#5a4632';
const PARCH = '#f7efd3';
const PARCH_HI = '#fbf6e4';
const LATE = '#b4472f';
const GREEN = '#3fae4a';
const AMBER = '#c98a17';

const TWO = (n) => String(n).padStart(2, '0');

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

export function drawHud(g, state) {
  const d = now();
  const h = d.getHours();
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  const mm = TWO(d.getMinutes());
  const late = h >= 18;

  const w = 80, hh = 30;
  const x = SCREEN_W - w - 4, y = 3;

  px(g, x + 1, y + 2, w, hh, 'rgba(10,10,6,0.35)');
  roundRect(g, x, y, w, hh, 3);
  g.fillStyle = PARCH;
  g.fill();
  g.lineWidth = 1;
  g.strokeStyle = BORDER;
  g.stroke();
  px(g, x + 2, y + 1, w - 4, 1, PARCH_HI);

  // Little calendar icon, top-left, like the reference's green page.
  px(g, x + 5, y + 4, 8, 8, GREEN);
  px(g, x + 5, y + 4, 8, 2, '#2f6f37');
  px(g, x + 7, y + 7, 4, 3, PARCH);

  text(g, `${d.getDate()} ${weekday(d)}`, x + w - 5, y + 11, INK, 'right', 8);
  text(g, ampm, x + 5, y + 25, late ? LATE : INK, 'left', 8);
  text(g, `${h12}:${mm}`, x + w - 5, y + 25, late ? LATE : INK, 'right', 9);

  // The clocked-in chip, tucked under the clock in the same parchment.
  const cw = 62, ch = 12;
  const cx = SCREEN_W - cw - 4, cy = y + hh + 3;
  const out = Boolean(state && state.clockedOut);

  px(g, cx + 1, cy + 1, cw, ch, 'rgba(10,10,6,0.28)');
  roundRect(g, cx, cy, cw, ch, 3);
  g.fillStyle = PARCH;
  g.fill();
  g.lineWidth = 1;
  g.strokeStyle = BORDER;
  g.stroke();
  px(g, cx + 2, cy + 1, cw - 4, 1, PARCH_HI);
  px(g, cx + 5, cy + 4, 5, 5, out ? AMBER : GREEN);
  text(g, out ? 'CLOCKED-OUT' : 'CLOCKED-IN', cx + 13, cy + 9, INK, 'left', 6);
}
