import { SCREEN_W, SCREEN_H } from '../core/config.js';
import { heldDirection, readActions } from '../core/input.js';
import { updatePlayer } from '../entities/player.js';
import { updateNpcs } from '../entities/npc.js';
import { updateCamera } from '../world/camera.js';
import { drawWorld } from '../world/view.js';
import { drawHud } from '../ui/hud.js';
import { drawResults } from '../ui/results.js';
import { updateDay } from '../game/day.js';
import { updateFx, dust, steam, mote } from '../world/fx.js';
import { PAL } from '../art/palette.js';
import { sfx } from '../core/audio.js';

let reveal = 0;

export function reset() {
  reveal = 0;
}

export function update(state) {
  state.tick++;

  const input = readActions();
  const live = !state.paused && state.phase !== 'done';

  if (live) {
    updatePlayer(state.player, state.walkable, heldDirection());
    if (state.player.arrived) {
      dust(state.player.tx, state.player.ty);
      sfx.step(state.player.steps % 2 === 0);
    }
    updateNpcs(state);
    updateDay(state, input);
    ambience(state);
  } else if (state.phase === 'done' && !state.paused) {
    // The room keeps breathing behind the report.
    updateNpcs(state);
    reveal++;
  }

  updateFx();
  updateCamera(state);
  state.cam.shake *= 0.86;
  if (state.cam.shake < 0.05) state.cam.shake = 0;

  for (let i = state.toasts.length - 1; i >= 0; i--) {
    if (--state.toasts[i].life <= 0) state.toasts.splice(i, 1);
  }
}

// Small life: coffee steaming, dust in the window light. Both are tied to
// something you can see, so nothing reads as random noise.
function ambience(state) {
  if (state.tick % 11 === 0) {
    steam(23, 11);
    steam(23, 15);
  }
  if (state.tick % 9 === 0) {
    const x = state.cam.x + Math.random() * SCREEN_W;
    const y = state.cam.y + Math.random() * SCREEN_H * 0.7;
    mote(x, y, Math.random() < 0.5 ? PAL.floorLit : PAL.text);
  }
  // The booth hums while a call is actually in progress.
  const t = state.tasks[state.active];
  if (t && t.id === 'call' && state.work > 0 && state.tick % 20 === 0) steam(28, 4);
}

export function draw(g, state) {
  drawWorld(g, state);
  drawHud(g, state);
  if (state.phase === 'done') drawResults(g, state, reveal);
  if (state.paused) pauseCard(g);
}

function pauseCard(g) {
  g.save();
  g.fillStyle = 'rgba(8,11,17,0.66)';
  g.fillRect(0, 0, SCREEN_W, SCREEN_H);
  g.font = '12px ui-monospace, Menlo, monospace';
  g.textAlign = 'center';
  g.fillStyle = PAL.text;
  g.fillText('PAUSED', SCREEN_W / 2, SCREEN_H / 2 - 2);
  g.font = '7px ui-monospace, Menlo, monospace';
  g.fillStyle = PAL.textDim;
  g.fillText('P or the Pause button to resume', SCREEN_W / 2, SCREEN_H / 2 + 12);
  g.textAlign = 'left';
  g.restore();
}