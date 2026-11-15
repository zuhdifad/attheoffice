import { TILE, STEP_FRAMES } from '../core/config.js?v=9';
import { isSeat, isSolid } from '../art/tiles.js?v=9';
import { frameFor } from '../art/characters.js?v=9';
import { mulberry32, shuffle } from '../core/rng.js?v=9';

const DELTA = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
const DIRS = ['up', 'down', 'left', 'right'];

const CHATTER = [
  'Morning!', 'Did you see the deck?', 'Coffee run?', 'Standup in five.',
  'That deploy went clean.', 'Ping me the doc.', 'Lunch at twelve?',
  'Nice work yesterday.', 'Wifi is fine now.', 'One more sprint…',
  'Ship it.', 'Who took my charger?', 'Teal carpet, bold choice.', 'Almost Friday.'
];

// A chair faces the prop it belongs to. Read it off the grid so the crowd keeps
// working when the furniture moves.
function seatFacing(place, x, y) {
  const at = (i, j) => (i < 0 || j < 0 || i >= place.w || j >= place.h ? '#' : place.grid[j][i]);
  const order = [['right', 1, 0], ['left', -1, 0], ['down', 0, 1], ['up', 0, -1]];
  for (const [dir, dx, dy] of order) {
    const id = at(x + dx, y + dy);
    if (isSolid(id) && !isSeat(id)) return dir;
  }
  return 'down';
}

function seats(place) {
  const out = [];
  for (let y = 1; y < place.h - 1; y++) {
    for (let x = 1; x < place.w - 1; x++) {
      if (isSeat(place.grid[y][x])) out.push({ x, y, dir: seatFacing(place, x, y) });
    }
  }
  return out;
}

function openTiles(place) {
  const out = [];
  for (let y = 1; y < place.h - 1; y++) {
    for (let x = 1; x < place.w - 1; x++) {
      if (!isSolid(place.grid[y][x])) out.push({ x, y });
    }
  }
  return out;
}

// Doorways and the tiles you work from are the two places a colleague must
// never loiter: a single-tile door with someone standing in it is a locked
// room, and a crowd on an objective is an objective you cannot reach.
function keepClearOf(place) {
  const out = new Set();
  for (let y = 0; y < place.h; y++) {
    for (let x = 0; x < place.w; x++) {
      const id = place.grid[y][x];
      if (id === 'd' || id === 'D') out.add(`${x},${y}`);
    }
  }
  for (const s of place.stations) {
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) out.add(`${s.x + dx},${s.y + dy}`);
    }
  }
  return out;
}

// Seeded so the same crowd sits at the same desks on every reload — otherwise
// every placement bug looks like a feature that keeps moving.
export function buildNpcs(place, characters, chosen, seed = 20261115) {
  const pick = mulberry32(seed);
  const others = shuffle(characters.filter((c) => c.id !== chosen.id), pick);

  const list = [];
  const occupied = new Set();
  const keepClear = keepClearOf(place);
  const chairs = shuffle(seats(place), pick);
  const floor = shuffle(openTiles(place), pick);

  // Four at their desks, the rest on their feet: the room reads as busy without
  // every aisle being blocked.
  const seatedCount = Math.min(4, others.length, chairs.length);
  let next = 0;

  for (const seat of chairs) {
    if (next >= seatedCount) break;
    // Keep the player's own approach to a station clear.
    if (place.stations.some((s) => Math.abs(s.x - seat.x) + Math.abs(s.y - seat.y) <= 1)) continue;
    const who = others[next++];
    list.push({
      id: who.id,
      name: who.name,
      tint: who.tint,
      x: seat.x,
      y: seat.y,
      tx: seat.x,
      ty: seat.y,
      px: seat.x * TILE,
      py: seat.y * TILE,
      dir: seat.dir,
      frame: 0,
      moving: false,
      step: 0,
      seated: true,
      home: { x: seat.x, y: seat.y },
      off: Math.floor(pick() * 240),
      wait: 0,
      say: 0,
      line: ''
    });
  }

  for (const spot of floor) {
    if (next >= others.length) break;
    const away = Math.max(Math.abs(spot.x - place.spawn.x), Math.abs(spot.y - place.spawn.y));
    if (away <= 3) continue;
    if (keepClear.has(`${spot.x},${spot.y}`)) continue;
    if (list.some((n) => Math.max(Math.abs(n.x - spot.x), Math.abs(n.y - spot.y)) < 2)) continue;

    const who = others[next++];
    list.push({
      id: who.id,
      name: who.name,
      tint: who.tint,
      x: spot.x,
      y: spot.y,
      tx: spot.x,
      ty: spot.y,
      px: spot.x * TILE,
      py: spot.y * TILE,
      dir: DIRS[Math.floor(pick() * 4)],
      frame: 0,
      moving: false,
      step: 0,
      seated: false,
      home: { x: spot.x, y: spot.y },
      off: Math.floor(pick() * 240),
      wait: 40 + Math.floor(pick() * 180),
      say: 0,
      line: '',
      rand: mulberry32(seed + next * 7919)
    });
    occupied.add(`${spot.x},${spot.y}`);
  }

  return { list, occupied, keepClear };
}

// Wanderers mill around their own patch of floor. They step one tile at a time
// on the same cadence as the player, so nobody slides.
export function updateNpcs(state) {
  const { npcs, map, occupied, player, keepClear } = state;

  for (const n of npcs) {
    if (n.say > 0) n.say--;

    if (n.seated) {
      // Typing: a two-frame nudge on the chair, decorrelated per desk.
      n.frame = Math.floor((state.tick + n.off) / 22) % 2 === 0 ? 0 : 1;
      if (!n.say && (state.tick + n.off) % 900 === 0) {
        n.say = 150;
        n.line = CHATTER[(n.off + state.tick / 900) % CHATTER.length | 0];
      }
      continue;
    }

    if (n.moving) {
      n.step++;
      const t = Math.min(n.step / STEP_FRAMES, 1);
      n.px = (n.from.x + (n.to.x - n.from.x) * t) * TILE;
      n.py = (n.from.y + (n.to.y - n.from.y) * t) * TILE;
      n.frame = frameFor(n.step, STEP_FRAMES, true);
      if (n.step >= STEP_FRAMES) {
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
        n.wait = 30 + Math.floor(n.rand() * 200);
        if (n.rand() < 0.22) {
          n.say = 150;
          n.line = CHATTER[Math.floor(n.rand() * CHATTER.length)];
        }
      }
      continue;
    }

    if (n.wait > 0) { n.wait--; continue; }

    // Bias back toward home once they have drifted, so the floor never empties
    // into one corner over a long day.
    const dxh = n.home.x - n.tx;
    const dyh = n.home.y - n.ty;
    const far = Math.abs(dxh) + Math.abs(dyh) > 5;
    // The player owns the tile they are on and the one they are stepping into,
    // otherwise a colleague walks straight through you mid-stride.
    const busy = (x, y) =>
      occupied.has(`${x},${y}`) ||
      (x === player.tx && y === player.ty) ||
      (player.moving && player.to && x === player.to.x && y === player.to.y);
    let choices = DIRS.filter((d) => {
      const [dx, dy] = DELTA[d];
      const nx = n.tx + dx;
      const ny = n.ty + dy;
      if (!map.walkable(nx, ny)) return false;
      if (busy(nx, ny)) return false;
      if (keepClear && keepClear.has(`${nx},${ny}`)) return false;
      if (far && (dx * dxh + dy * dyh) <= 0) return false;
      return true;
    });
    if (!choices.length) choices = DIRS.filter((d) => {
      const [dx, dy] = DELTA[d];
      const nx = n.tx + dx;
      const ny = n.ty + dy;
      return map.walkable(nx, ny) && !busy(nx, ny);
    });
    if (!choices.length) { n.wait = 60; continue; }

    const dir = choices[Math.floor(n.rand() * choices.length)];
    const [dx, dy] = DELTA[dir];
    n.dir = dir;
    n.from = { x: n.tx, y: n.ty };
    n.to = { x: n.tx + dx, y: n.ty + dy };
    // Claim the destination for the whole step. Without this two colleagues
    // can pick the same tile and land on top of each other, and the player can
    // be blocked halfway through a stride they were told was clear.
    occupied.add(`${n.to.x},${n.to.y}`);
    n.moving = true;
    n.step = 0;
  }
}