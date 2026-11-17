import { TILE, STEP_FRAMES } from '../core/config.js?v=24';
import { frameFor } from '../art/characters.js?v=24';
import { mulberry32, shuffle } from '../core/rng.js?v=24';
import { actorFor } from '../art/rig.js?v=24';
import { setMood } from '../art/expressions.js?v=24';
import { ACTIONS, framesOf, startAction, tickAction } from './actions.js?v=24';
import { doorPassable } from '../world/machines.js?v=24';

const DELTA = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
const DIRS = ['up', 'down', 'left', 'right'];
const OPP = { up: 'down', down: 'up', left: 'right', right: 'left' };

// A sit-down (or its reverse) is a step onto the chair played over the whole
// transition, so the doll glides into the seat while the sit track plays —
// never a teleport onto the pivot, never a standing sprite shifted six pixels.
const SIT_TICKS = ACTIONS.sitdown.hold * framesOf('sitdown');

const CHATTER = [
  'Morning!', 'Did you see the deck?', 'Coffee run?', 'Standup in five.',
  'That deploy went clean.', 'Ping me the doc.', 'Lunch at twelve?',
  'Nice work yesterday.', 'Wifi is fine now.', 'One more sprint…',
  'Ship it.', 'Who took my charger?', 'Teal carpet, bold choice.', 'Almost Friday.'
];

// The face each bubble carries, for exactly as long as the bubble is up.
const CHATTER_MOOD = [
  'happy', 'curious', 'curious', 'ambitious',
  'happy', 'neutral', 'happy',
  'happy', 'neutral', 'tired',
  'ambitious', 'curious', 'bored', 'happy'
];

// The mild faces a wanderer drifts through while milling: the floor reads as
// a room of moods, not a room of masks.
const IDLE_MOODS = ['bored', 'tired', 'lazy', 'curious', 'happy'];

// Seats come off the map, not off the grid: a chair is a prop with a footprint
// and a facing, so the crowd keeps working when the furniture moves. Which
// room a chair belongs to is read off where it stands, the same way the place
// itself is laid out.
const isDeskSeat = (s) => (s.kind === 'chair' || s.kind === 'chairOlive') && s.x <= 12 && s.y <= 18;
const isMeetingSeat = (s) => s.x >= 19 && s.x <= 25 && s.y >= 1 && s.y <= 6;
const isLoungeSeat = (s) => s.kind === 'sofa' || s.kind === 'armchair';

function openTiles(map) {
  const out = [];
  for (let y = 0; y < map.h; y++) {
    for (let x = 0; x < map.w; x++) {
      if (map.walkable(x, y)) out.push({ x, y });
    }
  }
  return out;
}

// Doorways and the tiles you work from are the two places a colleague must
// never loiter: a doorway with someone standing in it is a locked room, and a
// crowd on an objective is an objective you cannot reach.
function keepClearOf(place, map) {
  const out = new Set();
  for (const t of map.passages) out.add(`${t.x},${t.y}`);
  for (const s of place.stations) {
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) out.add(`${s.x + dx},${s.y + dy}`);
    }
  }
  return out;
}

// ---- schedules ----------------------------------------------------------------
// Every colleague works a seeded day: desk, then one outing — coffee, the
// meeting room, a phone booth, the lounge — back to the desk, and round again.
// The order and the dwell times come off the same mulberry32 stream as the
// placement, so the whole crowd's day is identical on every reload.
function makeSchedule(rand) {
  const order = shuffle(['coffee', 'meeting', 'booth', 'lounge'], rand);
  const sched = [];
  for (const kind of order) {
    sched.push({ kind: 'desk', dwell: 500 + Math.floor(rand() * 600) });
    sched.push({ kind, dwell: 240 + Math.floor(rand() * 360) });
  }
  sched.push({ kind: 'desk', dwell: 500 + Math.floor(rand() * 600) });
  return sched;
}

// Seeded so the same crowd sits at the same desks on every reload — otherwise
// every placement bug looks like a feature that keeps moving.
export function buildNpcs(place, map, characters, chosen, seed = 20261115) {
  const pick = mulberry32(seed);
  const others = shuffle(characters.filter((c) => c.id !== chosen.id), pick);

  const list = [];
  const occupied = new Set();
  const keepClear = keepClearOf(place, map);
  const floor = shuffle(openTiles(map), pick);
  const deskChairs = shuffle(map.seats.filter(isDeskSeat), pick);

  const mkNpc = (who, x, y, dir, rand) => ({
    id: who.id,
    name: who.name,
    tint: who.tint,
    x, y,
    tx: x, ty: y,
    px: x * TILE, py: y * TILE,
    dir,
    frame: 0,
    moving: false,
    step: 0,
    stepLen: STEP_FRAMES,
    seated: false,
    home: { x, y },
    off: Math.floor(pick() * 240),
    wait: 0,
    say: 0,
    line: '',
    rand,
    // The action state machine and the day it works through.
    action: 'idle',
    act: 0,
    seat: null,
    leaving: null,
    phase: 'travel',
    stopIdx: 0,
    schedule: makeSchedule(rand),
    dwell: 0,
    target: null,
    path: null,
    goalSeat: null,
    retry: 0
  });

  // Four at their desks, the rest on their feet: the room reads as busy without
  // every aisle being blocked. A sitter owns their chair from the first frame.
  const seatedCount = Math.min(4, others.length, deskChairs.length);
  let next = 0;

  for (const seat of deskChairs) {
    if (next >= seatedCount) break;
    // Keep the player's own approach to a station clear.
    if (place.stations.some((s) => Math.abs(s.x - seat.x) + Math.abs(s.y - seat.y) <= 1)) continue;
    const who = others[next++];
    const rand = mulberry32(seed + next * 7919);
    const n = mkNpc(who, seat.x, seat.y, seat.dir, rand);
    n.seated = true;
    n.seat = seat;
    n.home = { x: seat.x, y: seat.y };
    n.phase = 'dwell';
    n.dwell = 300 + Math.floor(rand() * 600);
    startAction(n, 'type');
    map.claimSeat(seat, who.id);
    list.push(n);
  }

  // Every wanderer still owns a desk to come back to; the first stop of the
  // day is that desk, so the floor settles into its routine on its own.
  const homes = deskChairs.filter((s) => !s.occupiedBy);
  let hi = 0;

  for (const spot of floor) {
    if (next >= others.length) break;
    const away = Math.max(Math.abs(spot.x - place.spawn.x), Math.abs(spot.y - place.spawn.y));
    if (away <= 3) continue;
    if (keepClear.has(`${spot.x},${spot.y}`)) continue;
    if (list.some((n) => Math.max(Math.abs(n.x - spot.x), Math.abs(n.y - spot.y)) < 2)) continue;

    const who = others[next++];
    const rand = mulberry32(seed + next * 7919);
    const n = mkNpc(who, spot.x, spot.y, DIRS[Math.floor(pick() * 4)], rand);
    if (homes.length) {
      const home = homes[hi++ % homes.length];
      n.home = { x: home.x, y: home.y };
    }
    n.wait = 40 + Math.floor(pick() * 180);
    list.push(n);
    occupied.add(`${spot.x},${spot.y}`);
  }

  return { list, occupied, keepClear };
}

// ---- pathfinding ----------------------------------------------------------------
// BFS over the base floor: doorways are planned through (the leaf's own machine
// opens them on approach), and the crowd's reserved tiles plus the player are
// the only moving obstacles. A target someone else holds is no path at all —
// the walker waits and replans rather than sharing a tile.
function findPath(state, n, target) {
  const { map, occupied, player } = state;
  if (!map.walkable(target.x, target.y)) return null;
  const busy = (x, y) =>
    occupied.has(`${x},${y}`) ||
    (player.tx === x && player.ty === y) ||
    (player.moving && player.to && player.to.x === x && player.to.y === y);
  if (busy(target.x, target.y)) return null;
  const start = `${n.tx},${n.ty}`;
  const goal = `${target.x},${target.y}`;
  if (start === goal) return [];
  const prev = new Map([[start, null]]);
  const queue = [[n.tx, n.ty]];
  while (queue.length) {
    const [x, y] = queue.shift();
    for (const d of DIRS) {
      const [dx, dy] = DELTA[d];
      const nx = x + dx, ny = y + dy;
      const k = `${nx},${ny}`;
      if (prev.has(k) || !map.walkable(nx, ny) || busy(nx, ny)) continue;
      prev.set(k, `${x},${y}`);
      if (k === goal) {
        const path = [];
        let cur = k;
        while (cur !== start) {
          const [cx, cy] = cur.split(',').map(Number);
          path.unshift({ x: cx, y: cy });
          cur = prev.get(cur);
        }
        return path;
      }
      queue.push([nx, ny]);
    }
  }
  return null;
}

const stepOk = (state, t) => {
  const { map, occupied, player } = state;
  return map.walkable(t.x, t.y) &&
    !occupied.has(`${t.x},${t.y}`) &&
    !(player.tx === t.x && player.ty === t.y) &&
    !(player.moving && player.to && player.to.x === t.x && player.to.y === t.y);
};

const dirOf = (x, y, nx, ny) =>
  nx > x ? 'right' : nx < x ? 'left' : ny > y ? 'down' : 'up';

// ---- the day, one stop at a time ------------------------------------------------

function freeSeat(state, n, match) {
  const { map, occupied, player } = state;
  for (const s of map.seats) {
    if (!match(s) || s.occupiedBy) continue;
    const a = s.approach;
    if (!map.walkable(a.x, a.y)) continue;
    if (occupied.has(`${a.x},${a.y}`) && !(n.tx === a.x && n.ty === a.y)) continue;
    if (player.tx === a.x && player.ty === a.y) continue;
    return s;
  }
  return null;
}

function targetFor(state, n, stop) {
  const { map } = state;
  if (stop.kind === 'desk') {
    n.goalSeat = map.seatAt(n.home.x, n.home.y);
    return n.goalSeat ? { ...n.goalSeat.approach } : { x: n.home.x, y: n.home.y };
  }
  if (stop.kind === 'meeting' || stop.kind === 'lounge') {
    n.goalSeat = freeSeat(state, n, stop.kind === 'meeting' ? isMeetingSeat : isLoungeSeat);
    if (n.goalSeat) return { ...n.goalSeat.approach };
    // No chair free: stand beside the room's own table for the dwell.
    return stop.kind === 'meeting' ? { x: 20, y: 5 } : { x: 12, y: 24 };
  }
  if (stop.kind === 'coffee') {
    const st = (state.place.stations || []).find((s) => s.id === 'coffee');
    return st ? { x: st.x, y: st.y } : { x: 19, y: 25 };
  }
  // booth: a free phone booth, or wait beside the spine until one empties.
  const b = map.props.find((p) => p.kind === 'booth' &&
    !state.occupied.has(`${p.x},${p.y}`) &&
    !(state.player.tx === p.x && state.player.ty === p.y));
  return b ? { x: b.x, y: b.y } : { x: 15, y: 10 };
}

function route(state, n) {
  n.phase = 'travel';
  n.target = targetFor(state, n, n.schedule[n.stopIdx]);
  n.path = findPath(state, n, n.target);
  n.retry = 0;
  if (n.action !== 'walk') startAction(n, 'idle');
}

// Reached the stop: claim the chair and board it, or stand to the activity.
function beginStop(state, n) {
  const stop = n.schedule[n.stopIdx];
  const { map } = state;
  if (stop.kind === 'desk' || stop.kind === 'meeting' || stop.kind === 'lounge') {
    let seat = n.goalSeat;
    const beside = (s) => s && !s.occupiedBy && Math.abs(n.tx - s.x) + Math.abs(n.ty - s.y) === 1;
    if (!beside(seat)) {
      seat = stop.kind === 'desk'
        ? map.seatAt(n.home.x, n.home.y)
        : freeSeat(state, n, stop.kind === 'meeting' ? isMeetingSeat : isLoungeSeat);
      if (!beside(seat)) seat = null;
    }
    if (seat && map.claimSeat(seat, n.id)) {
      // Boarding is one glide onto the pivot, facing the prop the chair
      // belongs to; the sit track plays over the whole move.
      n.seat = seat;
      n.dir = seat.dir;
      n.phase = 'board';
      n.from = { x: n.tx, y: n.ty };
      n.to = { x: seat.x, y: seat.y };
      n.moving = true;
      n.step = 0;
      n.stepLen = SIT_TICKS;
      n.seated = true;
      startAction(n, 'sitdown');
      return;
    }
    if (seat) { route(state, n); return; } // taken on the way: pick another
    n.phase = 'dwell';
    n.dwell = stop.dwell;
    startAction(n, 'idle');
    return;
  }
  if (stop.kind === 'coffee') {
    n.dir = 'down'; // face the counter the machine stands on
    n.phase = 'dwell';
    n.dwell = stop.dwell;
    startAction(n, 'drink');
    return;
  }
  // booth: stand inside; the booth's own machine reads the occupancy.
  n.phase = 'dwell';
  n.dwell = stop.dwell;
  startAction(n, 'idle');
}

// Leave a chair: the stand-up track plays over the glide back to the approach
// tile, and the claim is released only once the feet are off the seat.
function departSeated(state, n) {
  const { map, occupied, player } = state;
  if (!n.seat) {
    n.seated = false;
    n.stopIdx = (n.stopIdx + 1) % n.schedule.length;
    route(state, n);
    return;
  }
  const a = n.seat.approach;
  const busy = occupied.has(`${a.x},${a.y}`) ||
    (player.tx === a.x && player.ty === a.y) ||
    (player.moving && player.to && player.to.x === a.x && player.to.y === a.y);
  if (busy || !map.walkable(a.x, a.y) || !doorPassable(map, a.x, a.y)) {
    n.dwell = 24; // someone is in the way: settle back and try again shortly
    return;
  }
  n.leaving = n.seat;
  n.phase = 'alight';
  n.dir = OPP[n.seat.dir] || 'down';
  n.from = { x: n.tx, y: n.ty };
  n.to = { x: a.x, y: a.y };
  occupied.add(`${a.x},${a.y}`);
  n.moving = true;
  n.step = 0;
  n.stepLen = SIT_TICKS;
  startAction(n, 'standup');
}

function arrive(state, n) {
  const { map } = state;
  if (n.phase === 'board') {
    n.phase = 'dwell';
    n.dwell = n.schedule[n.stopIdx].dwell;
    startAction(n, n.schedule[n.stopIdx].kind === 'desk' ? 'type' : 'sit');
    return;
  }
  if (n.phase === 'alight') {
    map.releaseSeat(n.leaving, n.id);
    n.seat = null;
    n.leaving = null;
    n.seated = false;
    n.stopIdx = (n.stopIdx + 1) % n.schedule.length;
    route(state, n);
    return;
  }
  if (n.path && n.path.length) return;
  if (n.target && n.tx === n.target.x && n.ty === n.target.y) { beginStop(state, n); return; }
  n.path = null; // the plan broke mid-walk: replan from the tile we landed on
}

function chatter(state, n, ci) {
  n.say = 150;
  n.line = CHATTER[ci];
  setMood(actorFor(n), CHATTER_MOOD[ci], 150);
}

// ---- the per-tick walk ----------------------------------------------------------
// One action tick, then one of: a stride in flight, a path to follow, a stop to
// dwell at. Every tile change is a reserved step on the player's own cadence,
// so nobody slides and nobody teleports — the only snaps are the sit glides,
// and those are played over the transition's own frames.
export function updateNpcs(state) {
  const { npcs, map, occupied } = state;

  for (const n of npcs) {
    if (n.say > 0) n.say--;
    if (n.wait > 0) { n.wait--; continue; }

    // A sitter staged onto a chair from outside (a screenshot, a test) is
    // adopted into a dwell on that tile rather than walked off its mark.
    if (n.seated && !n.moving && !n.seat) {
      const s = map.seatAt(n.tx, n.ty);
      if (s && map.claimSeat(s, n.id)) n.seat = s;
      n.phase = 'dwell';
      if (n.dwell <= 0) n.dwell = 100000;
      if (n.action !== 'type' && n.action !== 'sit') startAction(n, 'type');
    }

    tickAction(n);

    if (n.moving) {
      n.step++;
      const t = Math.min(n.step / n.stepLen, 1);
      n.px = (n.from.x + (n.to.x - n.from.x) * t) * TILE;
      n.py = (n.from.y + (n.to.y - n.from.y) * t) * TILE;
      n.frame = frameFor(n.step, n.stepLen, true);
      if (n.step >= n.stepLen) {
        // The destination was reserved when the step began, so only the tile
        // being vacated is released here.
        occupied.delete(`${n.from.x},${n.from.y}`);
        n.tx = n.to.x;
        n.ty = n.to.y;
        n.x = n.tx;
        n.y = n.ty;
        n.px = n.tx * TILE;
        n.py = n.ty * TILE;
        n.moving = false;
        n.step = 0;
        n.frame = 0;
        n.stepLen = STEP_FRAMES;
        if (n.phase === 'travel' && n.rand() < 0.06) {
          chatter(state, n, Math.floor(n.rand() * CHATTER.length));
        } else if (n.phase === 'travel' && n.rand() < 0.1) {
          setMood(actorFor(n), IDLE_MOODS[Math.floor(n.rand() * IDLE_MOODS.length)], 150);
        }
        arrive(state, n);
      }
      continue;
    }

    if (n.phase === 'travel') {
      if (!n.target) { route(state, n); continue; }
      if ((!n.path || !n.path.length) && n.tx === n.target.x && n.ty === n.target.y) {
        beginStop(state, n);
        continue;
      }
      if (!n.path || !n.path.length) {
        n.retry = (n.retry || 0) + 1;
        if (n.retry < 12) continue;
        n.retry = 0;
        n.path = findPath(state, n, n.target);
        if (!n.path) {
          if (n.action !== 'idle') startAction(n, 'idle');
          continue;
        }
      }
      const next = n.path[0];
      if (!stepOk(state, next)) { n.path = null; n.retry = 10; continue; }
      if (!doorPassable(map, next.x, next.y)) {
        // A closed leaf: work the door with a short reach while its machine
        // swings open on our approach, then step through.
        if (n.action !== 'door') startAction(n, 'door');
        continue;
      }
      n.path.shift();
      n.retry = 0;
      n.dir = dirOf(n.tx, n.ty, next.x, next.y);
      n.from = { x: n.tx, y: n.ty };
      n.to = { x: next.x, y: next.y };
      // Claim the destination for the whole step. Without this two colleagues
      // can pick the same tile and land on top of each other.
      occupied.add(`${n.to.x},${n.to.y}`);
      n.moving = true;
      n.step = 0;
      n.stepLen = STEP_FRAMES;
      startAction(n, 'walk');
      continue;
    }

    if (n.phase === 'dwell') {
      const stop = n.schedule[n.stopIdx];
      if (n.seated) {
        if (n.seat && (n.tx !== n.seat.x || n.ty !== n.seat.y)) {
          // Displaced from the claim (staged elsewhere): rejoin the floor
          // from where we actually stand, never from where the seat is.
          map.releaseSeat(n.seat, n.id);
          n.seat = null;
          n.seated = false;
          route(state, n);
          continue;
        }
        if (!n.say && (state.tick + n.off) % 900 === 0) {
          chatter(state, n, (n.off + state.tick / 900) % CHATTER.length | 0);
        }
      } else if (stop.kind === 'coffee' && n.action === 'idle') {
        startAction(n, 'drink'); // another sip while the coffee stop runs
      }
      n.dwell--;
      if (n.dwell <= 0) {
        if (n.seated) departSeated(state, n);
        else {
          n.stopIdx = (n.stopIdx + 1) % n.schedule.length;
          route(state, n);
        }
      }
      continue;
    }

    // Any phase the day does not know (a fresh spawn, a restored state):
    // plan the current stop and go.
    route(state, n);
  }
}