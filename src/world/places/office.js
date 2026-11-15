// The office, as data, laid out from the scene plate: wood slat wall across the
// north, two desk banks down the left with a divider spine and chairs outboard,
// the lounge and the yellow booth across the top, two cafe tables in the middle,
// and the glass-partitioned meeting room and breakout down the right.
//
// A place is { name, w, h, grid, spawn, stations } and nothing else, so a second
// room is a second file like this one rather than an edit to the engine.

const W = 34;
const H = 26;
const SPAWN = { x: 16, y: 23 };

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

// A carpeted room: field, piped right edge, corner piece. The piping is what
// stops a large carpet reading as one flat rectangle.
function carpet(g, x, y, w, h, field, edge, corner) {
  fill(g, x, y, w, h, field);
  fill(g, x + w - 1, y, 1, h - 1, edge);
  put(g, x + w - 1, y + h - 1, corner);
}

export function office() {
  const g = make();

  // ---- ground -------------------------------------------------------------
  // Large-format stone tiles, laid as a checker so the slab has a grain.
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) g[y][x] = (x + y) % 2 === 0 ? '.' : ',';
  }
  // The circulation spine is poured smooth, which quietly routes the player
  // down the middle of the floor and across to the entrance.
  fill(g, 9, 1, 2, H - 2, ';');
  fill(g, 1, 21, 25, 1, ';');
  // The cafe quadrant sits on quadrant slabs, as in the plate.
  fill(g, 18, 11, 7, 10, ':');
  // The entrance lobby is poured speckled terrazzo, which marks the threshold
  // you spawn on without needing a wall to do it.
  fill(g, 13, 22, 8, 3, 'z');

  // ---- shell --------------------------------------------------------------
  fill(g, 0, 0, W, 1, '#');
  for (const x of [6, 11, 17, 22]) fill(g, x, 0, 3, 1, 'W');
  fill(g, 0, H - 1, W, 1, '#');
  fill(g, 0, 1, 1, H - 2, 'p');
  fill(g, W - 1, 1, 1, H - 2, 'p');
  put(g, 0, 0, 'P');
  put(g, W - 1, 0, 'P');
  put(g, 0, 1, 'w');
  put(g, W - 1, 1, 'w');
  put(g, 0, H - 1, 'k');
  put(g, W - 1, H - 1, 'K');
  // Entrance, on the south wall.
  fill(g, 16, H - 1, 2, 1, 'D');
  fill(g, 16, H - 2, 2, 1, 'm');
  put(g, 15, H - 2, '=');
  put(g, 18, H - 2, '=');

  // ---- north wall dressing ------------------------------------------------
  put(g, 3, 0, 'i');            // framed art, hung on the slat wall
  put(g, 2, 1, 'h');
  put(g, 3, 1, 'h');
  put(g, 5, 1, 'N');
  put(g, 8, 1, 'M');
  put(g, 19, 1, 'Q');
  put(g, 24, 1, 'R');

  // ---- lounge -------------------------------------------------------------
  carpet(g, 11, 2, 10, 6, 't', 'T', 'Y');
  put(g, 13, 3, 'a');
  put(g, 14, 3, 'b');
  put(g, 15, 3, 'c');
  put(g, 12, 5, 'e');
  put(g, 16, 5, 'e');
  put(g, 14, 5, 'f');
  put(g, 18, 6, '3');
  put(g, 11, 2, 'S');
  put(g, 20, 2, 'M');

  // ---- phone booth --------------------------------------------------------
  put(g, 21, 6, 'j');
  put(g, 21, 7, 'J');
  put(g, 23, 8, 'Q');

  // ---- desk banks ---------------------------------------------------------
  // Divider spine, desks both sides, task chairs outboard, alternating green
  // and yellow down the run — exactly the arrangement in the plate. Monitors
  // stagger between the two sides so the run reads as shared benching rather
  // than a row of identical boxes.
  for (const spine of [5, 14]) {
    for (let y = 8; y <= 20; y++) {
      put(g, spine, y, 'q');
      const kind = y % 2 === 0 ? 'l' : 'n';
      put(g, spine - 1, y, kind);
      put(g, spine + 1, y, kind === 'l' ? 'n' : 'l');
    }
    // The run is capped at each end by a return panel.
    put(g, spine - 1, 8, 'o');
    put(g, spine + 1, 20, 'o');
    let flip = 0;
    for (const y of [9, 12, 15, 18]) {
      put(g, spine - 2, y, flip % 2 ? 's' : 'r');
      put(g, spine + 2, y, flip % 2 ? 'r' : 's');
      flip++;
    }
    // Each bank ends in a concrete pillar and a planter, as drawn.
    put(g, spine, 21, 'x');
    put(g, spine + 2, 21, 'S');
    put(g, spine - 2, 21, 'M');
  }

  // ---- cafe ---------------------------------------------------------------
  for (const y of [13, 18]) {
    put(g, 20, y, 'y');
    put(g, 21, y, 'A');
    put(g, 22, y, 'B');
    for (const x of [20, 21, 22]) put(g, x, y + 1, 'C');
    put(g, 19, y, 'N');
    put(g, 23, y, 'S');
  }
  put(g, 24, 16, 'V');

  // ---- glass partition and meeting room -----------------------------------
  fill(g, 26, 1, 1, 24, 'p');
  put(g, 26, 8, 'd');
  put(g, 26, 20, 'd');
  fill(g, 26, 15, 7, 1, 'p');
  put(g, 26, 15, 'P');
  put(g, 29, 15, 'd');

  carpet(g, 27, 2, 6, 13, 'g', 'G', 'H');
  // Three caps make one boardroom table, with a chair at every place and one
  // at each head. The pieces are authored east-west, so the table runs that
  // way: turned north-south the top would end up narrower than a chair.
  put(g, 28, 7, 'E');
  put(g, 29, 7, 'F');
  put(g, 30, 7, 'I');
  for (const x of [28, 29, 30]) {
    put(g, x, 6, 'L');
    put(g, x, 8, 'L');
  }
  put(g, 27, 7, 'L');
  put(g, 31, 7, 'L');
  put(g, 31, 3, '0');
  put(g, 27, 2, 'N');
  put(g, 32, 2, 'Q');
  put(g, 31, 12, 'M');
  put(g, 27, 13, 'S');

  // ---- breakout, below the meeting room -----------------------------------
  carpet(g, 27, 16, 6, 9, 'v', 'v', 'v');
  put(g, 29, 18, 'V');
  put(g, 30, 18, 'Z');
  put(g, 32, 17, 'U');
  put(g, 28, 21, '1');
  put(g, 30, 21, '2');
  put(g, 29, 21, '3');
  put(g, 27, 20, 'M');
  put(g, 32, 23, 'Q');
  put(g, 27, 24, 'N');

  // ---- print corner -------------------------------------------------------
  fill(g, 2, 22, 8, 3, 'u');
  put(g, 3, 23, '0');
  put(g, 5, 23, 'V');
  put(g, 7, 23, '1');
  put(g, 8, 23, '2');
  put(g, 2, 24, 'R');
  put(g, 9, 24, 'S');

  // ---- loose dressing -----------------------------------------------------
  put(g, 2, 6, 'M');
  put(g, 2, 12, 'R');
  put(g, 2, 17, 'N');
  put(g, 8, 5, 'S');
  put(g, 12, 22, 'Q');
  put(g, 14, 23, 'M');
  put(g, 20, 23, 'N');
  put(g, 24, 22, 'S');
  put(g, 17, 10, 'R');
  put(g, 17, 16, 'M');
  put(g, 8, 2, '=');
  put(g, 24, 11, '=');
  put(g, 12, 21, '=');

  // ---- the day's stations -------------------------------------------------
  // Each one is a walkable tile beside the prop it belongs to, so the objective
  // always points at somewhere the player can actually stand.
  const stations = [
    { id: 'inbox', x: 8, y: 12, label: 'Clear the inbox', hint: 'Your desk, left bank', verb: 'Working', points: 120 },
    { id: 'standup', x: 14, y: 6, label: 'Run the stand-up', hint: 'Lounge, by the sofa', verb: 'Briefing', points: 140 },
    { id: 'call', x: 21, y: 8, label: 'Take the client call', hint: 'Yellow phone booth', verb: 'On a call', points: 160 },
    { id: 'coffee', x: 21, y: 12, label: 'Refill the coffee', hint: 'Cafe tables', verb: 'Brewing', points: 100 },
    { id: 'review', x: 29, y: 9, label: 'Present the sprint review', hint: 'Glass meeting room', verb: 'Presenting', points: 200 },
    { id: 'print', x: 5, y: 24, label: 'Print the report', hint: 'Print corner, bottom left', verb: 'Printing', points: 130 },
    { id: 'out', x: 16, y: 24, label: 'Clock out', hint: 'Front doors', verb: 'Clocking out', points: 250 }
  ];

  return { name: 'office', w: W, h: H, grid: g, spawn: SPAWN, stations };
}