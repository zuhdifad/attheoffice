import { SCREEN_W, SCREEN_H } from '../core/config.js?v=9';
import { heldDirection, readActions } from '../core/input.js?v=9';
import { updatePlayer } from '../entities/player.js?v=9';
import { updateNpcs } from '../entities/npc.js?v=9';
import { updateCamera } from '../world/camera.js?v=9';
import { drawWorld } from '../world/view.js?v=9';
import { drawHud } from '../ui/hud.js?v=9';
import { drawResults } from '../ui/results.js?v=9';
import { updateFx, dust, steam, mote } from '../world/fx.js?v=9';
import { PAL } from '../art/palette.js?v=9';
import { text, px } from '../core/draw.js?v=9';
import { sfx } from '../core/audio.js?v=9';
import { now, fmtHM } from '../ui/wallclock.js?v=9';
import { nearestTalkable, openDialogue, updateDialogue, closeDialogue, drawDialogue } from '../ui/dialogue.js?v=9';

let reveal = 0;

export function reset() {
  reveal = 0;
}

// The whole game: walk the floor, talk to whoever is beside you. No objectives,
// no score — the room is the content. The clock keeps real time inside it.
export function update(state) {
  state.tick++;

  const input = readActions();
  const live = !state.paused && state.phase === 'play' && !state.askingClockOut;

  if (live) {
    // A (Z), the TALK pad, or a click on the room beside a colleague opens a
    // conversation; B (X) backs out of one. While the box is up the player and
    // the crowd freeze.
    if (state.dialogue) {
      if (input.backTap) closeDialogue(state);
      else updateDialogue(state, input);
    } else if (input.workTap || input.confirmTap) {
      const n = nearestTalkable(state);
      if (n) {
        openDialogue(state, n);
        state.talks.add(n.id);
      }
    }

    if (!state.dialogue) {
      updatePlayer(state.player, state.walkable, heldDirection());
      if (state.player.arrived) {
        dust(state.player.tx, state.player.ty);
        sfx.step(state.player.steps % 2 === 0);
      }
      updateNpcs(state);
    }
    ambience(state);
  } else if ((state.phase === 'done' || state.askingClockOut) && !state.paused) {
    // The room keeps breathing behind the receipt and behind the clock-out
    // question; only the player is rooted to the spot.
    if (state.dialogue) closeDialogue(state);
    updateNpcs(state);
    if (state.phase === 'done') reveal++;
  }

  updateFx();
  updateCamera(state);
  state.cam.shake *= 0.86;
  if (state.cam.shake < 0.05) state.cam.shake = 0;
}

// Small life: coffee steaming, dust in the window light. Both are tied to
// something you can see, so nothing reads as random noise.
function ambience(state) {
  if (state.tick % 11 === 0) {
    steam(22, 14);
    steam(22, 9);
  }
  if (state.tick % 9 === 0) {
    const x = state.cam.x + Math.random() * SCREEN_W;
    const y = state.cam.y + Math.random() * SCREEN_H * 0.7;
    mote(x, y, Math.random() < 0.5 ? PAL.floorLit : PAL.text);
  }
}

export function draw(g, state) {
  drawWorld(g, state);
  drawHud(g, state);
  if (state.dialogue) drawDialogue(g, state);
  if (state.phase === 'done') drawResults(g, state, reveal);
  if (state.paused) pauseDetails(g, state);
}

// ---- pause details ------------------------------------------------------------
// Esc pauses the room and hands you the badge: who you clocked in as, where you
// sit, who came with you, how the day is going. Parchment, like everything the
// floor writes on.

const INK = '#3a2c1a';
const BORDER = '#5a4632';
const FAINT = '#8a7454';
const PARCH = '#f7efd3';
const PARCH_HI = '#fbf6e4';
const PARCH_LO = '#e8dcb8';

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function pauseDetails(g, state) {
  const d = now();
  const date = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;

  g.save();
  g.fillStyle = 'rgba(8,11,17,0.7)';
  g.fillRect(0, 0, SCREEN_W, SCREEN_H);

  const w = 300, h = 166;
  const x = Math.round(SCREEN_W / 2 - w / 2);
  const y = Math.round(SCREEN_H / 2 - h / 2);

  // Parchment body, brown border, inner bevel.
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

  text(g, 'PAUSED', x + 14, y + 19, INK, 'left', 10);
  text(g, date, x + w - 14, y + 18, FAINT, 'right', 7);
  px(g, x + 14, y + 26, w - 28, 1, PARCH_LO);

  const who = state.chosen;
  const rows = [
    ['NAME', state.playerName || (who ? who.name : '—')],
    ['ROLE', state.role || (who ? who.role : '—')],
    ['FLOOR / SEAT', [state.floor, state.seat].filter(Boolean).join(' · ') || '—'],
    ['PARTNER', state.partner || '—'],
    ['WORKER', who ? `${who.name} · ${who.dept}` : '—'],
    ['CLOCKED IN', state.clockedInAt ? fmtHM(state.clockedInAt) : '—'],
    ['COLLEAGUES', `${state.talks.size}/${state.npcs.length}`]
  ];
  rows.forEach(([label, value], i) => {
    const ry = y + 44 + i * 13;
    text(g, label, x + 14, ry, FAINT, 'left', 7);
    text(g, String(value), x + w - 14, ry, INK, 'right', 8);
  });

  px(g, x + 14, y + 140, w - 28, 1, PARCH_LO);
  const blink = Math.floor(state.tick / 24) % 2 === 0;
  text(g, 'ESC  RESUME', x + w / 2, y + 156, blink ? INK : FAINT, 'center', 8);

  g.restore();
}
