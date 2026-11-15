import { SCREEN_W, SCREEN_H } from '../core/config.js';
import { text, px, vgrad } from '../core/draw.js';
import { PAL } from '../art/palette.js';
import { portraitFor } from '../art/characters.js';

// The end-of-day report, drawn into the same buffer as the room so it inherits
// the pixel grid and the vignette. The room keeps living behind it — colleagues
// still wander — which is what stops the day feeling like a hard cut.
export function drawResults(g, state, reveal) {
  const r = state.result;
  if (!r) return;
  const a = Math.min(1, reveal / 26);

  g.save();
  g.globalAlpha = a * 0.82;
  px(g, 0, 0, SCREEN_W, SCREEN_H, '#0a0d13');
  g.restore();

  const w = 320;
  const h = 208;
  const x = Math.round(SCREEN_W / 2 - w / 2);
  const y = Math.round(SCREEN_H / 2 - h / 2 + (1 - a) * 14);
  const accent = r.cleared ? PAL.ok : PAL.danger;

  g.save();
  g.globalAlpha = a;

  px(g, x + 3, y + 4, w, h, 'rgba(0,0,0,0.45)');
  vgrad(g, x, y, w, h, [[0, '#1a1f2b'], [0.5, '#151a24'], [1, '#10141c']]);
  px(g, x, y, w, 2, accent);
  px(g, x, y + h - 1, w, 1, 'rgba(0,0,0,0.6)');
  px(g, x, y, 1, h, 'rgba(255,255,255,0.06)');
  px(g, x + w - 1, y, 1, h, 'rgba(0,0,0,0.4)');

  text(g, r.cleared ? 'SHIFT COMPLETE' : 'OVERTIME', x + 14, y + 20, accent, 'left', 10, 'rgba(0,0,0,0.6)');
  text(g, `${r.difficulty.toUpperCase()} · CLOCKED ${r.clock}`, x + w - 14, y + 19, PAL.textFaint, 'right', 7);
  px(g, x + 14, y + 27, w - 28, 1, 'rgba(255,255,255,0.09)');

  // The worker, at picker scale, beside the rank they earned.
  const port = portraitFor(state.chosen.id);
  if (port) {
    px(g, x + 14, y + 36, 52, 74, 'rgba(255,255,255,0.04)');
    px(g, x + 14, y + 36, 52, 1, state.chosen.tint);
    g.drawImage(port, 0, 0, 64, 96, x + 16, y + 38, 48, 72);
  }

  text(g, state.chosen.name.toUpperCase(), x + 76, y + 48, PAL.text, 'left', 9, 'rgba(0,0,0,0.6)');
  text(g, state.chosen.role, x + 76, y + 59, PAL.textFaint, 'left', 7);
  text(g, r.title.toUpperCase(), x + 76, y + 80, PAL.amber, 'left', 12, 'rgba(0,0,0,0.6)');
  text(g, r.note, x + 76, y + 93, PAL.textDim, 'left', 7);
  text(g, `${r.done}/${r.total} objectives closed`, x + 76, y + 106, r.cleared ? PAL.ok : PAL.warn, 'left', 7);

  // Score counts up rather than appearing, so the number is an event.
  const shown = Math.round(r.score * Math.min(1, Math.max(0, (reveal - 14) / 40)));
  px(g, x + 14, y + 118, w - 28, 1, 'rgba(255,255,255,0.09)');
  text(g, 'FINAL SCORE', x + 14, y + 132, PAL.textFaint, 'left', 7);
  text(g, String(shown), x + w - 14, y + 136, PAL.amber, 'right', 18, 'rgba(0,0,0,0.6)');

  const stats = [
    ['SYNC HITS', String(r.perfect), PAL.tealLit],
    ['BEST STREAK', `×${r.bestCombo}`, PAL.grape],
    ['EARLY BONUS', `+${r.early}`, PAL.ok],
    ['STEPS', String(r.steps), PAL.sky]
  ];
  const cw = (w - 28) / stats.length;
  stats.forEach(([label, value, color], i) => {
    const sx = x + 14 + i * cw;
    px(g, sx, y + 146, cw - 6, 26, 'rgba(255,255,255,0.04)');
    px(g, sx, y + 146, cw - 6, 1, color);
    text(g, value, sx + (cw - 6) / 2, y + 160, color, 'center', 9, 'rgba(0,0,0,0.5)');
    text(g, label, sx + (cw - 6) / 2, y + 169, PAL.textFaint, 'center', 6);
  });

  const blink = Math.floor(state.tick / 24) % 2 === 0;
  text(g, 'R  RUN IT AGAIN', x + w / 2, y + 190, blink ? PAL.text : PAL.textDim, 'center', 8, 'rgba(0,0,0,0.6)');
  text(g, 'C  CHANGE WORKER', x + w / 2, y + 201, PAL.textFaint, 'center', 6);

  g.restore();
}