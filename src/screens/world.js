import { SCREEN_W, SCREEN_H, BUFFER_W, BUFFER_H, VIEWS, FRAME_MS } from '../core/config.js?v=24';
import { heldDirection, readActions } from '../core/input.js?v=24';
import { updatePlayer, faceToward } from '../entities/player.js?v=24';
import { updateNpcs } from '../entities/npc.js?v=24';
import { ACTIONS, framesOf, startAction, tickAction } from '../entities/actions.js?v=24';
import { actorFor, updateActor } from '../art/rig.js?v=24';
import { updateCamera } from '../world/camera.js?v=24';
import { updateResidency } from '../world/residency.js?v=24';
import { drawWorld } from '../world/view.js?v=24';
import { drawHud } from '../ui/hud.js?v=24';
import { drawResults } from '../ui/results.js?v=24';
import { updateFx, dust, mote } from '../world/fx.js?v=24';
import { updateMachines, doorPassable } from '../world/machines.js?v=24';
import { PAL } from '../art/palette.js?v=24';
import { text, px } from '../core/draw.js?v=24';
import { sfx } from '../core/audio.js?v=24';
import { now, fmtHM } from '../ui/wallclock.js?v=24';
import { nearestTalkable, openDialogue, updateDialogue, closeDialogue, drawDialogue } from '../ui/dialogue.js?v=24';

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
      } else {
        useProp(state);
      }
    }

    if (!state.dialogue) {
      playerActionTick(state);
      updatePlayer(state.player, state.walkable, heldDirection());
      if (state.player.arrived) {
        dust(state.player.tx, state.player.ty);
        sfx.step(state.player.steps % 2 === 0);
      }
      updateNpcs(state);
    }
    updateMachines(state);
    ambience(state);
  } else if ((state.phase === 'done' || state.askingClockOut) && !state.paused) {
    // The room keeps breathing behind the receipt and behind the clock-out
    // question; only the player is rooted to the spot.
    if (state.dialogue) closeDialogue(state);
    updateNpcs(state);
    updateMachines(state);
    if (state.phase === 'done') reveal++;
  }

  updateFx();
  updateCamera(state);
  updateResidency(state);
  // Actors ride the same fixed step as the sim: updateActor keeps its own tick
  // in lockstep with state.tick, so the anim maths the view used to do at draw
  // time now happens here, once per step, for every colleague and the player.
  // Moods, blinks and gaze ride the same step — and freeze with the room on
  // pause, but keep easing while a conversation holds the crowd still.
  if (!state.paused) {
    const dt = FRAME_MS / 1000;
    updateActor(actorFor(state.player), dt);
    for (const n of state.npcs) updateActor(actorFor(n), dt);
  }
  state.cam.shake *= 0.86;
  if (state.cam.shake < 0.05) state.cam.shake = 0;
}

// Small life: dust in the window light. The coffee's steam belongs to the
// machine itself (world/machines.js), so it only rises while a brew is on.
function ambience(state) {
  if (state.tick % 9 === 0) {
    // Motes drift through the light over whatever slice of floor the current
    // view actually has on screen, not over the UI's design space.
    const { ppu } = VIEWS[state.view] || VIEWS.near;
    const x = state.cam.x + Math.random() * (BUFFER_W / ppu);
    const y = state.cam.y + Math.random() * (BUFFER_H / ppu) * 0.7;
    mote(x, y, Math.random() < 0.5 ? PAL.floorLit : PAL.text);
  }
}

// ---- the player's single-key actions -------------------------------------------
// One key (Z / the A pad) does the thing the floor beside you offers: talk to
// a colleague first, otherwise sit on a chair whose approach tile you stand
// on, sip beside the coffee things, or — once seated at a desk — open the
// laptop. A direction key while seated stands you up through the same glide
// the crowd uses, so the chair is released before the first stride lands.

const DELTA = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
const OPP = { up: 'down', down: 'up', left: 'right', right: 'left' };
const SIT_TICKS = ACTIONS.sitdown.hold * framesOf('sitdown');
const DRINK_KINDS = new Set(['coffeeMachine', 'kettle', 'waterCooler', 'mugShelf', 'mug']);

// A chair you can work at: the tile it faces belongs to a desk or a table.
function workSeat(state, seat) {
  if (!seat) return false;
  const [dx, dy] = DELTA[seat.dir] || DELTA.up;
  const fx = seat.x + dx, fy = seat.y + dy;
  return state.map.props.some((p) =>
    (p.kind === 'desk' || p.kind === 'table' || p.kind === 'highTable') &&
    fx >= p.x && fx < p.x + p.def.w && fy >= p.y && fy < p.y + p.def.h);
}

function sitDown(state, seat) {
  const p = state.player;
  if (!state.map.claimSeat(seat, p.id)) return;
  p.seat = seat;
  p.seated = true;
  p.dir = seat.dir; // face the prop the chair belongs to
  p.from = { x: p.tx, y: p.ty };
  p.to = { x: seat.x, y: seat.y };
  p.moving = true;
  p.step = 0;
  p.stepLen = SIT_TICKS;
  p.working = false;
  startAction(p, 'sitdown');
  sfx.ui();
}

function standUp(state) {
  const p = state.player;
  if (!p.seat || p.moving || p.action === 'standup' || p.action === 'sitdown') return;
  const a = p.seat.approach;
  if (!state.walkable(a.x, a.y)) return; // someone in the way: stay seated a beat
  p.leaving = p.seat;
  p.from = { x: p.tx, y: p.ty };
  p.to = { x: a.x, y: a.y };
  p.moving = true;
  p.step = 0;
  p.stepLen = SIT_TICKS;
  p.dir = OPP[p.seat.dir] || 'down';
  p.working = false;
  startAction(p, 'standup');
  sfx.ui();
}

function useProp(state) {
  const p = state.player;
  if (p.moving || state.dialogue) return;
  if (p.seated) {
    if (p.action === 'laptop') { startAction(p, 'sit'); return; }
    if (p.action === 'sit' && workSeat(state, p.seat)) { startAction(p, 'laptop'); return; }
    standUp(state);
    return;
  }
  if (p.action === 'drink' || p.action === 'door') return; // one-shot in flight
  // A chair whose approach tile is the one we stand on, still unclaimed.
  const seat = state.map.seats.find((s) =>
    s.approach.x === p.tx && s.approach.y === p.ty && !s.occupiedBy);
  if (seat) { sitDown(state, seat); return; }
  // The coffee things: one tile away, face them and take a sip.
  const prop = state.map.props.find((pr) => DRINK_KINDS.has(pr.kind) &&
    Math.abs(pr.x - p.tx) + Math.abs(pr.y - p.ty) === 1);
  if (prop) {
    faceToward(p, prop.x, prop.y);
    startAction(p, 'drink');
    p.working = true;
    sfx.ui();
  }
}

function playerActionTick(state) {
  const p = state.player;
  const held = heldDirection();

  // Locomotion reads off the same machine: a stride is the walk action, and
  // landing settles back to idle unless a chair or a sip owns the pose.
  if (p.moving && !p.seated && p.action !== 'walk' && p.action !== 'sitdown' && p.action !== 'standup') {
    startAction(p, 'walk');
  } else if (!p.moving && p.action === 'walk') {
    startAction(p, 'idle');
  }

  // A direction while seated is a stand-up, not a shove against the chair.
  if (held && p.seated && !p.moving && (p.action === 'sit' || p.action === 'laptop')) {
    standUp(state);
  }

  // A closed leaf in the way of the stride: work the door with a short reach
  // while its machine swings open on the approach, then walk on.
  if (held && !p.moving && !p.working && !p.seated && p.action !== 'door') {
    const [dx, dy] = DELTA[held];
    const nx = p.tx + dx, ny = p.ty + dy;
    const isDoor = state.map.doors.some((d) =>
      nx >= d.x && nx < d.x + d.def.w && ny >= d.y && ny < d.y + d.def.h);
    if (isDoor && !doorPassable(state.map, nx, ny)) {
      p.dir = held;
      startAction(p, 'door');
      p.working = true;
    }
  }

  const settled = tickAction(p);
  if (settled === 'sit') {
    p.working = true; // rooted on the chair until a key says otherwise
  } else if (settled === 'idle') {
    if (p.leaving) {
      state.map.releaseSeat(p.leaving, p.id);
      p.seat = null;
      p.leaving = null;
      p.seated = false;
    }
    p.working = false;
  }
}

export function draw(g, state) {
  drawWorld(g, state);

  // The HUD and every card are authored in the 480x288 design space and put on
  // the buffer with one transform, so their type and hairlines keep the design
  // grid however many device pixels the room is drawn with.
  g.save();
  g.scale(BUFFER_W / SCREEN_W, BUFFER_H / SCREEN_H);
  drawHud(g, state);
  if (state.dialogue) drawDialogue(g, state);
  if (state.phase === 'done') drawResults(g, state, reveal);
  if (state.paused) pauseDetails(g, state);
  g.restore();
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
