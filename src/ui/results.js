import { SCREEN_W, SCREEN_H } from '../core/config.js?v=8';
import { text, px } from '../core/draw.js?v=8';
import { bustFor } from '../art/characters.js?v=8';

// The clock-out receipt, drawn into the same buffer as the room so it inherits
// the pixel grid. Parchment, like the conversation box: the day ends the same
// way it was spoken. The room keeps living behind it — colleagues still wander
// — which is what stops the visit feeling like a hard cut.

const INK = '#3a2c1a';
const BORDER = '#5a4632';
const FAINT = '#8a7454';
const PARCH = '#f7efd3';
const PARCH_HI = '#fbf6e4';
const PARCH_LO = '#e8dcb8';
const GREEN = '#3fae4a';

const TWO = (n) => String(n).padStart(2, '0');
const clock = (d) => `${TWO(d.getHours())}:${TWO(d.getMinutes())}:${TWO(d.getSeconds())}`;
const date = (d) => `${TWO(d.getDate())}/${TWO(d.getMonth() + 1)}/${d.getFullYear()}`;

function spent(a, b) {
  const s = Math.max(0, Math.round((b - a) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h) return `${h}h ${TWO(m)}m`;
  return `${m}m ${TWO(s % 60)}s`;
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

export function drawResults(g, state, reveal) {
  const r = state.result;
  if (!r) return;
  const a = Math.min(1, reveal / 26);

  g.save();
  g.globalAlpha = a * 0.62;
  px(g, 0, 0, SCREEN_W, SCREEN_H, '#0a0d13');
  g.restore();

  const w = 300;
  const h = 198;
  const x = Math.round(SCREEN_W / 2 - w / 2);
  const y = Math.round(SCREEN_H / 2 - h / 2 + (1 - a) * 14);

  g.save();
  g.globalAlpha = a;

  // Soft shadow, parchment body, brown border, inner bevel.
  roundRect(g, x + 2, y + 3, w, h, 6);
  g.fillStyle = 'rgba(10,8,4,0.45)';
  g.fill();
  roundRect(g, x, y, w, h, 6);
  g.fillStyle = PARCH;
  g.fill();
  g.lineWidth = 2;
  g.strokeStyle = BORDER;
  g.stroke();
  roundRect(g, x + 2, y + 2, w - 4, h - 4, 5);
  g.lineWidth = 1;
  g.strokeStyle = PARCH_HI;
  g.stroke();
  px(g, x + 3, y + h - 3, w - 6, 1, PARCH_LO);

  text(g, 'CLOCKED OUT', x + 14, y + 19, INK, 'left', 10);
  text(g, date(r.outAt), x + w - 14, y + 18, FAINT, 'right', 7);
  px(g, x + 14, y + 26, w - 28, 1, PARCH_LO);

  // The worker, framed like the dialogue bust, beside their record.
  const PX = x + 14, PY = y + 36, PS = 46;
  px(g, PX, PY, PS, PS, PARCH_HI);
  g.lineWidth = 2;
  g.strokeStyle = BORDER;
  g.strokeRect(PX + 1, PY + 1, PS - 2, PS - 2);
  const bust = bustFor(state.chosen.id);
  if (bust) g.drawImage(bust, 0, 0, bust.width, bust.height, PX + 4, PY + 4, PS - 8, PS - 8);

  text(g, state.chosen.name.toUpperCase(), x + 72, y + 48, INK, 'left', 9);
  text(g, state.chosen.role, x + 72, y + 60, FAINT, 'left', 7);
  text(g, state.floor || 'The office', x + 72, y + 72, GREEN, 'left', 7);

  const rows = [
    ['CLOCKED IN', clock(r.inAt)],
    ['CLOCKED OUT', clock(r.outAt)],
    ['ON THE FLOOR', spent(r.inAt, r.outAt)],
    ['STEPS', String(r.steps)],
    ['COLLEAGUES MET', `${r.talks}/${r.total}`]
  ];
  rows.forEach(([label, value], i) => {
    const ry = y + 98 + i * 13;
    text(g, label, x + 14, ry, FAINT, 'left', 7);
    text(g, value, x + w - 14, ry, INK, 'right', 8);
  });

  px(g, x + 14, y + 164, w - 28, 1, PARCH_LO);
  const blink = Math.floor(state.tick / 24) % 2 === 0;
  text(g, 'R  BACK TO THE FLOOR', x + w / 2, y + 178, blink ? INK : FAINT, 'center', 8);
  text(g, 'C  CHANGE WORKER', x + w / 2, y + 190, FAINT, 'center', 6);

  g.restore();
}