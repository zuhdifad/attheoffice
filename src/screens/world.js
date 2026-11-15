import { SCREEN_W, SCREEN_H } from '../core/config.js?v=8';
import { heldDirection, readActions } from '../core/input.js?v=8';
import { updatePlayer } from '../entities/player.js?v=8';
import { updateNpcs } from '../entities/npc.js?v=8';
import { updateCamera } from '../world/camera.js?v=8';
import { drawWorld } from '../world/view.js?v=8';
import { drawHud } from '../ui/hud.js?v=8';
import { drawResults } from '../ui/results.js?v=8';
import { updateFx, dust, steam, mote } from '../world/fx.js?v=8';
import { PAL } from '../art/palette.js?v=8';
import { sfx } from '../core/audio.js?v=8';
import { nearestTalkable, openDialogue, updateDialogue, closeDialogue, drawDialogue } from '../ui/dialogue.js?v=8';

let reveal = 0;

export function reset() {
  reveal = 0;
}

// The whole game: walk the floor, talk to whoever is beside you. No objectives,
// no score — the room is the content. The wall clock keeps real time above it.
export function update(state) {
  state.tick++;

  const input = readActions();
  const live = !state.paused && state.phase === 'play' && !state.askingClockOut;

  if (live) {
    // E, the TALK pad, or a click on the room beside a colleague opens a
    // conversation. While the box is up the player and the crowd freeze.
    if (state.dialogue) {
      updateDialogue(state, input);
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
  drawHud(g);
  if (state.dialogue) drawDialogue(g, state);
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