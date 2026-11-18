import { steam } from './fx.js?v=26';

// The room's small machines: the coffee bar's brew cycle, the printer's paper
// feed and the phone booths' door. Each one is a state machine living on the
// prop instance (`anim`, allocated by world/map.js), ticked here once per
// simulated frame and read by the prop's paint layers — so the art and the
// state can never disagree about whether the coffee is brewing or the booth is
// taken. Nothing here touches collision: a booth stays a walkable tile in every
// state, the door only says whether stepping in reads as entering.

const approach = (v, target, k = 0.22) => {
  const next = v + (target - v) * k;
  return Math.abs(next - target) < 0.02 ? target : next;
};

// Brew cycle lengths in frames: long enough to read as a machine doing a job,
// short enough that a visitor sees all three phases in one coffee run.
const BREW = { idle: 260, brewing: 200, ready: 160 };
const PRINT = { idle: 320, printing: 150 };

function coffee(p, a) {
  a.t++;
  if (a.t >= BREW[a.phase]) {
    a.phase = a.phase === 'idle' ? 'brewing' : a.phase === 'brewing' ? 'ready' : 'idle';
    a.t = 0;
    a.fill = 0;
  }
  if (a.phase === 'brewing') {
    a.fill = a.t / BREW.brewing;
    if (a.t % 9 === 0) steam(p.x, p.y);
  }
}

function printer(p, a) {
  a.t++;
  if (a.phase === 'printing') {
    a.paper = Math.min(1, a.t / PRINT.printing);
    if (a.t >= PRINT.printing) { a.phase = 'idle'; a.t = 0; }
  } else {
    // The sheet waits in the tray a beat, then is taken: the feed never loops
    // with paper hanging out of a machine nobody is using.
    if (a.t > 120) a.paper = approach(a.paper, 0, 0.3);
    if (a.t >= PRINT.idle) { a.phase = 'printing'; a.t = 0; a.paper = 0; }
  }
}

// vacant -> entering -> occupied -> leaving -> vacant. The door swings open to
// let the walker in, shuts behind them, and the header lamp burns amber for as
// long as the booth is taken. Stepping out reverses it through `leaving`.
function booth(p, a, inside) {
  const set = (s) => { a.state = s; a.t = 0; };
  if (a.state === 'idle') set('vacant');
  a.t++;
  switch (a.state) {
    case 'vacant':
      a.open = approach(a.open, 0);
      if (inside) set('entering');
      break;
    case 'entering':
      a.open = approach(a.open, 1);
      if (a.open >= 0.98) set('occupied');
      break;
    case 'occupied':
      a.open = approach(a.open, 0);
      if (!inside) set('leaving');
      break;
    case 'leaving':
      a.open = approach(a.open, 1);
      if (a.open >= 0.98 && !inside) set('vacant');
      break;
  }
}

// closed -> opening -> open -> closing. The trigger is the doorway's own tile
// plus the ring around it: anyone standing on or beside the leaf asks for it
// open, and the collider (doorPassable below) lets them through only once the
// swing has landed. Two rules keep it from trapping anyone: it never starts
// closing while a body is on the doorway, and a leaf mid-close reopens the
// moment someone asks again — a step committed into the frame always lands.
function door(p, a, near, on) {
  const set = (s) => { a.state = s; a.t = 0; };
  if (a.state === 'idle') set('closed');
  a.t++;
  switch (a.state) {
    case 'closed':
      a.open = approach(a.open, 0);
      if (near) set('opening');
      break;
    case 'opening':
      a.open = approach(a.open, 1);
      if (a.open >= 0.98) set('open');
      break;
    case 'open':
      a.open = approach(a.open, 1);
      if (near || on) a.t = 0;
      // A beat of hold after the last visitor leaves, so a tailgater is not
      // shut on mid-stride.
      else if (a.t > 40) set('closing');
      break;
    case 'closing':
      if (near || on) { set('opening'); break; }
      a.open = approach(a.open, 0);
      if (a.open <= 0.02) set('closed');
      break;
  }
}

// The live door collider: a doorway tile is passable only while its machine
// sits fully open. The base map stays door-agnostic — pathfinding and the
// floor's connectivity plan through doorways — and this is the layer that
// makes a closed leaf actually stop a step.
export function doorPassable(map, x, y) {
  for (const p of map.doors || []) {
    if (x >= p.x && x < p.x + p.def.w && y >= p.y && y < p.y + p.def.h) {
      return !!p.anim && p.anim.state === 'open';
    }
  }
  return true;
}

export function updateMachines(state) {
  const { map, player } = state;
  // Everyone the machines can see: the player, the guard and every live
  // colleague. A tile is asked for by a body on it or stepping into it, so a
  // door opens ahead of the stride that will cross it — on every client.
  const walkers = [player, ...(state.npcs || []), ...(state.remotes ? state.remotes.values() : [])];
  const on = (e, x, y) =>
    (e.tx === x && e.ty === y) ||
    (e.moving && e.to && e.to.x === x && e.to.y === y);
  const nearTile = (e, x, y) => Math.abs(e.tx - x) <= 1 && Math.abs(e.ty - y) <= 1;

  for (const p of map.props) {
    const a = p.anim;
    if (!a) continue;
    if (p.def.machine === 'coffee') coffee(p, a);
    else if (p.def.machine === 'printer') printer(p, a);
    else if (p.def.machine === 'booth') {
      booth(p, a, walkers.some((e) => on(e, p.x, p.y)));
    } else if (p.def.machine === 'door') {
      let near = false, body = false;
      for (let j = 0; j < p.def.h && !body; j++) {
        for (let i = 0; i < p.def.w && !body; i++) {
          const x = p.x + i, y = p.y + j;
          if (walkers.some((e) => on(e, x, y))) body = true;
          if (walkers.some((e) => nearTile(e, x, y))) near = true;
        }
      }
      door(p, a, near, body);
    }
  }
}