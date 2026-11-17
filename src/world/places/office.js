// The office, as data, at the new scale: one character to a tile, walls 2.5
// tiles of face on a one-tile footprint, aisles two tiles wide, 30 x 28 tiles
// of floor. Two desk banks of four 3x2 benches west, a glazed meeting room and
// a glazed manager office east, and a south band holding reception, the lounge,
// the pantry and the print alcove — every zone reached off a two-tile aisle.
//
// A place is { name, w, h, grid, accents, props, spawn, stations }: the grid
// names the slab under every tile, `accents` names the one inlay colour a zone
// carries (laid as a transition strip where two zones meet), and `props` lists
// the furniture with the footprint it occupies. Collision is derived from those
// footprints by world/map.js, so a desk three tiles wide blocks exactly three
// tiles and the walk keeps to the aisle.

const W = 30;
const H = 28;
const SPAWN = { x: 3, y: 25 };

// Desk banks: four 3x2 benches each, two columns by two rows, with x5..6 and
// y4..5 (y14..15 in bank B) left as the two-tile aisles between them.
const BANK_COLS = [2, 7];
const BANK_A_ROWS = [2, 6];
const BANK_B_ROWS = [12, 16];

// Zone rects, interior edges inclusive: material glyph and the one accent the
// zone carries. Circulation is the terrazzo everything else is cut out of.
export const ZONES = [
  { x: 1, y: 22, w: 8, h: 5, floor: 'z', accent: 'amber' },   // entry + reception
  { x: 1, y: 1, w: 12, h: 8, floor: 'c', accent: 'sky' },     // desk bank A
  { x: 1, y: 11, w: 12, h: 8, floor: 'c', accent: 'leaf' },   // desk bank B
  { x: 18, y: 1, w: 9, h: 7, floor: 'w', accent: 'grape' },   // meeting room
  { x: 21, y: 10, w: 6, h: 6, floor: 'w', accent: 'sand' },   // manager office
  { x: 18, y: 23, w: 7, h: 4, floor: 'p', accent: 'coral' },  // pantry + coffee bar
  { x: 10, y: 22, w: 6, h: 5, floor: 'C', accent: 'rose' },   // lounge
  { x: 25, y: 24, w: 4, h: 3, floor: 'u', accent: 'lime' },   // print alcove
  { x: 16, y: 10, w: 1, h: 1, floor: 'c', accent: 'plum' },   // phone booth 1
  { x: 16, y: 13, w: 1, h: 1, floor: 'c', accent: 'plum' }    // phone booth 2
];

// The north glazing: two-tile bands set over the aisles, so the daylight pass
// drops its shafts on walkable floor — the bank aisle x5..6, the spine x13..14,
// the meeting corridor x16..17 and the east aisle x27..28.
const NORTH_WINDOWS = [5, 6, 13, 14, 16, 17, 27, 28];

function ground() {
  const g = [];
  const a = [];
  for (let y = 0; y < H; y++) {
    const row = [];
    const acc = [];
    for (let x = 0; x < W; x++) {
      row.push('z');
      acc.push('steel');
    }
    g.push(row);
    a.push(acc);
  }
  for (const z of ZONES) {
    for (let y = z.y; y < z.y + z.h; y++) {
      for (let x = z.x; x < z.x + z.w; x++) {
        g[y][x] = z.floor;
        a[y][x] = z.accent;
      }
    }
  }
  return { grid: g, accents: a };
}

function furniture() {
  const p = [];
  const add = (kind, x, y) => p.push({ kind, x, y });

  // ---- shell --------------------------------------------------------------
  for (let x = 0; x < W; x++) {
    add(NORTH_WINDOWS.includes(x) ? 'window' : 'wall', x, 0);
  }
  for (let y = 1; y < H - 1; y++) {
    add('wall', 0, y);
    add('wall', W - 1, y);
  }
  // The near edge is a sill, not a wall: a 2.5-tile wall on the camera's side
  // would paint over the last row of the floor. The entrance is a two-tile
  // doorway in it, on its threshold and mat, under a frame and an exit sign.
  for (let x = 0; x < W; x++) {
    if (x < 2 || x > 3) add(x === 0 || x === W - 1 ? 'wall' : 'sill', x, H - 1);
  }
  add('door', 2, H - 1);
  add('doorFrame', 2, H - 1);
  add('threshold', 2, H - 1);
  add('exitSign', 2, H - 1);
  add('mat', 2, H - 2);
  add('mat', 3, H - 2);

  // ---- desk banks ----------------------------------------------------------
  for (const rows of [BANK_A_ROWS, BANK_B_ROWS]) {
    for (const y of rows) {
      for (const x of BANK_COLS) {
        add('desk', x, y);
        // Two sitters per bench, on the near row inside the footprint: the row
        // the tabletop is measured against, so the desk covers a lap, never a head.
        add((x + y) % 2 ? 'chair' : 'chairOlive', x, y + 1);
        add((x + y) % 2 ? 'chairOlive' : 'chair', x + 2, y + 1);
        // The privacy screen stands on the bench's own spine, two tiles tall,
        // between the facing halves — never on an aisle, so it blocks nothing.
        add('screen', x, y);
        add('monitor', x + 1, y);
        add('laptop', x, y);
        add('mug', x + 2, y);
        add('keyboard', x + 1, y + 1);
        add('papers', x + 1, y + 1);
        add('deskLamp', x, y + 1);
        add('drawer', x + 2, y + 1);
        add('cableTray', x, y + 2);
      }
    }
  }

  // ---- meeting room ---------------------------------------------------------
  // Glazed on three sides, entered through a one-tile glass door off the
  // corridor; the north side is the room's own wall, carrying TV and board.
  for (let y = 1; y <= 7; y++) add(y === 4 ? 'glassDoor' : 'glassWall', 18, y);
  for (let x = 19; x <= 26; x++) add('glassWall', x, 7);
  for (let y = 1; y <= 6; y++) add('glassWall', 26, y);
  add('table', 21, 3);
  for (let i = 0; i < 3; i++) {
    add(i % 2 ? 'chair' : 'chairOlive', 21 + i, 4);
    add(i % 2 ? 'chairFrontOlive' : 'chairFront', 21 + i, 2);
  }
  add('tv', 22, 0);
  add('whiteboard', 24, 0);
  add('phone', 21, 3);
  add('waterJug', 23, 3);
  add('pendantLamp', 22, 3);

  // ---- manager office --------------------------------------------------------
  // Glazed west, north and east; the south side opens onto the cross aisle, so
  // the room is entered from two directions and no corner of it is a pocket.
  for (let y = 10; y <= 15; y++) add(y === 13 ? 'glassDoor' : 'glassWall', 21, y);
  for (let x = 22; x <= 26; x++) {
    add(x === 23 || x === 24 ? 'glazed' : 'glassWall', x, 10);
  }
  for (let y = 11; y <= 15; y++) add('glassWall', 26, y);
  add('desk', 23, 12);
  add('chairFront', 23, 11);
  add('chairFrontOlive', 24, 11);
  add('bookshelf', 24, 14);
  add('plant', 25, 11);
  add('monitor', 24, 12);
  add('laptop', 23, 12);
  add('mug', 25, 12);
  add('keyboard', 24, 13);
  add('papers', 24, 13);
  add('deskLamp', 23, 13);
  add('drawer', 25, 13);

  // ---- phone booths -----------------------------------------------------------
  add('booth', 16, 10);
  add('booth', 16, 13);

  // ---- pantry and coffee bar ---------------------------------------------------
  add('counter', 19, 26);
  add('coffeeMachine', 19, 26);
  add('sink', 21, 26);
  add('kettle', 22, 26);
  add('fridge', 24, 24);
  add('waterCooler', 18, 24);
  add('mugShelf', 18, 25);
  add('highTable', 20, 23);
  add('stool', 20, 24);
  add('stool', 21, 24);
  add('noticeBoard', 29, 22);

  // ---- lounge -------------------------------------------------------------------
  add('rug', 11, 23);
  add('sofa', 11, 25);
  add('armchair', 14, 24);
  add('lowTable', 12, 23);
  add('magazines', 12, 23);
  add('plant', 10, 22);
  add('floorLamp', 15, 22);

  // ---- print alcove ----------------------------------------------------------------
  add('printer', 26, 25);
  add('cabinet', 28, 24);
  add('shredder', 25, 25);
  add('paperStack', 25, 24);

  // ---- reception ---------------------------------------------------------------------
  add('bench', 5, 25);
  add('plant', 7, 22);
  add('directory', 0, 23);
  add('badgeReader', 0, 25);
  add('sign', 4, 23);
  add('ceilLamp', 4, 24);
  add('bin', 1, 26);

  // ---- circulation dressing ------------------------------------------------------------
  add('extinguisher', 0, 12);
  add('firstAid', 29, 18);
  add('wallClock', 10, 0);
  add('framedArt', 0, 8);
  add('framedArt', 0, 19);
  add('framedArt', 29, 8);
  add('trunking', 2, 9);
  add('trunking', 7, 9);
  add('trunking', 2, 19);
  add('trunking', 7, 19);
  add('vent', 13, 5);
  return p;
}

export function office() {
  const { grid, accents } = ground();
  // Each station is a walkable tile beside the prop it belongs to, so the
  // objective always points at somewhere the player can actually stand.
  const stations = [
    { id: 'inbox', x: 5, y: 3, label: 'Clear the inbox', hint: 'Bank A, left desk', verb: 'Working', points: 120 },
    { id: 'standup', x: 20, y: 4, label: 'Run the stand-up', hint: 'Meeting table', verb: 'Briefing', points: 140 },
    { id: 'call', x: 15, y: 10, label: 'Take the client call', hint: 'Phone booth, east corridor', verb: 'On a call', points: 160 },
    { id: 'coffee', x: 19, y: 25, label: 'Refill the coffee', hint: 'Coffee bar, pantry', verb: 'Brewing', points: 100 },
    { id: 'review', x: 24, y: 1, label: 'Present the sprint review', hint: 'Whiteboard, meeting room', verb: 'Presenting', points: 200 },
    { id: 'print', x: 26, y: 24, label: 'Print the report', hint: 'Print alcove', verb: 'Printing', points: 130 },
    { id: 'out', x: 3, y: 26, label: 'Clock out', hint: 'Entrance mat', verb: 'Clocking out', points: 250 }
  ];

  return {
    name: 'office',
    w: W,
    h: H,
    grid,
    accents,
    props: furniture(),
    spawn: SPAWN,
    stations
  };
}