// The office, as data, laid out from the scene plate: a beige checker floor,
// two desk clusters (top and bottom), each two rows of four wooden desks with a
// monitor, a task chair on BOTH the north and south side of every desk, a wide
// empty circulation aisle across the middle, a tall glass partition with a door
// down the right edge, and a dark entrance door at the bottom-left.
//
// A place is { name, w, h, grid, spawn, stations } and nothing else, so a second
// room is a second file like this one rather than an edit to the engine.

const W = 24;
const H = 26;
const SPAWN = { x: 3, y: 23 };

function make() {
  const g = [];
  for (let y = 0; y < H; y++) g.push(new Array(W).fill('.'));
  return g;
}

function fill(g, x, y, w, h, id) {
  for (let j = y; j < y + h; j++) {
    for (let i = x; i < x + w; i++) {
      if (j >= 0 && j < H && i >= 0 && i < W) g[j][i] = id;
    }
  }
}

function put(g, x, y, id) {
  if (y >= 0 && y < H && x >= 0 && x < W) g[y][x] = id;
}

// One row of four desks with a chair on each side. The north chair is authored
// front-on (it faces south, at the desk); the south chair is authored from the
// back (it faces north). Mustard and olive alternate down the run, exactly the
// rhythm of the plate.
function deskRow(g, y, kind) {
  for (let x = 7; x <= 10; x++) {
    const mustard = (x + y) % 2 === 0;
    put(g, x, y, kind);
    put(g, x, y - 1, mustard ? 'f' : 'e');
    put(g, x, y + 1, mustard ? 's' : 'r');
  }
}

export function office() {
  const g = make();

  // ---- ground -------------------------------------------------------------
  // Large-format beige tiles, laid as a checker so the slab has a grain.
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) g[y][x] = (x + y) % 2 === 0 ? '.' : ',';
  }
  // The entrance threshold is poured speckled terrazzo, marking the door you
  // spawn at without needing a wall to do it.
  fill(g, 1, 22, 5, 3, 'z');

  // ---- shell --------------------------------------------------------------
  fill(g, 0, 0, W, 1, '#');
  fill(g, 0, H - 1, W, 1, '#');
  fill(g, 0, 1, 1, H - 2, '#');
  fill(g, W - 1, 1, 1, H - 2, '#');
  put(g, 0, 0, 'K');
  put(g, W - 1, 0, 'K');
  put(g, 0, H - 1, 'K');
  put(g, W - 1, H - 1, 'K');
  // North glazing: the daylight the light pass throws down the floor.
  put(g, 6, 0, 'W');
  put(g, 7, 0, 'W');
  put(g, 16, 0, 'W');
  put(g, 17, 0, 'W');
  // Entrance, bottom-left, a swung glass door on its mat.
  put(g, 2, H - 1, 'D');
  put(g, 3, H - 1, 'D');
  put(g, 2, H - 2, 'm');
  put(g, 3, H - 2, 'm');

  // ---- glass partition down the right edge --------------------------------
  // Two tiles of side room beyond the glass: a walkable lane at x=21 and the
  // props against the east wall at x=22, so nothing blocks the corridor.
  fill(g, 20, 6, 1, 13, 'p');
  put(g, 20, 12, 'd');
  put(g, 20, 6, 'P');
  put(g, 20, 18, 'P');

  // ---- the two desk clusters ----------------------------------------------
  deskRow(g, 4, 'l');
  deskRow(g, 8, 'o');
  deskRow(g, 17, 'l');
  deskRow(g, 21, 'o');

  // ---- sparse dressing ----------------------------------------------------
  put(g, 12, 2, 'x');            // pillar, top
  put(g, 12, 23, 'x');           // pillar, bottom
  put(g, 14, 1, '0');            // whiteboard on the north wall
  put(g, 18, 2, 'V');            // drawer cabinet
  put(g, 20, 2, 'h');            // tall locker
  put(g, 1, 1, 'M');
  put(g, 1, 23, 'N');
  put(g, 20, 24, 'N');
  put(g, 5, 24, 'B');            // trash bin by the entrance
  put(g, 12, 12, 'C');           // wet-floor sign mid-aisle
  put(g, 5, 20, 'V');            // cabinet the report prints from
  put(g, 14, 13, 'A');           // stand-up table in the aisle

  // ---- the glass side room ------------------------------------------------
  put(g, 22, 1, 'N');
  put(g, 22, 9, 'y');
  put(g, 22, 11, '1');
  put(g, 22, 14, 'A');
  put(g, 22, 16, '2');
  put(g, 22, 20, 'U');

  // ---- the day's stations -------------------------------------------------
  // Each one is a walkable tile beside the prop it belongs to, so the objective
  // always points at somewhere the player can actually stand.
  const stations = [
    { id: 'inbox', x: 6, y: 4, label: 'Clear the inbox', hint: 'Top cluster, left desk', verb: 'Working', points: 120 },
    { id: 'standup', x: 13, y: 13, label: 'Run the stand-up', hint: 'Aisle table', verb: 'Briefing', points: 140 },
    { id: 'call', x: 21, y: 11, label: 'Take the client call', hint: 'Glass side room', verb: 'On a call', points: 160 },
    { id: 'coffee', x: 21, y: 14, label: 'Refill the coffee', hint: 'Side room, steel table', verb: 'Brewing', points: 100 },
    { id: 'review', x: 14, y: 2, label: 'Present the sprint review', hint: 'Whiteboard, north wall', verb: 'Presenting', points: 200 },
    { id: 'print', x: 5, y: 21, label: 'Print the report', hint: 'Cabinet, bottom left', verb: 'Printing', points: 130 },
    { id: 'out', x: 3, y: 24, label: 'Clock out', hint: 'Entrance, bottom left', verb: 'Clocking out', points: 250 }
  ];

  return { name: 'office', w: W, h: H, grid: g, spawn: SPAWN, stations };
}