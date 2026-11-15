// Colours lifted off the new art itself: terrazzo grey, teal carpet, the wood
// slat wall, the yellow phone booth, the green and red chairs. Nothing here is a
// default grey — every neutral is warm or cool on purpose.
export const PAL = {
  // Shell and surfaces, cool side.
  ink: '#14171f',
  night: '#1b1f2a',
  surface: '#232836',
  surfaceHi: '#2e3446',
  overlay: 'rgba(20,23,31,0.86)',
  scrim: 'rgba(9,11,16,0.72)',

  // Terrazzo and concrete, warm side.
  floor: '#cdc9c2',
  floorShade: '#b9b5ad',
  floorLit: '#dedad3',

  // The dominant family: the teal carpet that carries the largest fields.
  teal: '#1f7f8c',
  tealLit: '#2ba3b0',
  tealDeep: '#155e68',

  // Accents, all pulled from a prop in the tileset.
  amber: '#f2b134',      // phone booth
  amberDeep: '#c98a17',
  wood: '#c08a4e',       // slat wall and desking
  woodDeep: '#8a5f31',
  leaf: '#4a9d52',       // green chair and planting
  leafDeep: '#2f6f37',
  coral: '#e2503f',      // red chair and stool
  sky: '#3d8fd6',        // blue chair and glazing
  grape: '#8b7ad6',      // the glass panes

  // Five more accents, one per new colleague, kept in the same register as the
  // props: brushed steel off the desk frames, sand off the slat wall, the rose
  // and plum of the lounge cushions, the lime of the planting under the lights.
  steel: '#8fa3bf',
  sand: '#d9c48f',
  rose: '#e07a8f',
  plum: '#b45fb0',
  lime: '#a9cf38',

  // Semantic.
  ok: '#4fd48a',
  warn: '#f2b134',
  danger: '#ef5b52',
  info: '#5fb8e8',

  // Type.
  text: '#f3f1ec',
  textDim: '#a9aEBB',
  textFaint: '#6f7686',

  shadow: 'rgba(12,14,20,0.34)'
};

// The roster. Thirteen colleagues. Each one carries four pieces of art baked
// from the same source: a 6x4 walk sheet for the floor, a portrait cut from its
// front frame, a full-length dossier cut-out and a bust for the picker and the
// title card. The dossier and the sprite can never disagree about who is who.
export const CHARACTERS = [
  {
    id: 'zuhdi', name: 'Zuhdi', role: 'Product Engineer', tint: PAL.sky,
    dept: 'Engineering', badge: 'DEF-0417', ext: '214', since: '2021', desk: 'Bank A · 03',
    note: 'Ships on Friday, apologises on Monday. Owns the deploy pipeline and the spare charger nobody can find.'
  },
  {
    id: 'alicia', name: 'Alicia', role: 'Account Director', tint: PAL.grape,
    dept: 'Client Services', badge: 'DEF-0102', ext: '101', since: '2019', desk: 'Booth side',
    note: 'Runs the client call at eleven and the room at ten past. Black suit, gold hoops, no wasted minutes.'
  },
  {
    id: 'anna', name: 'Anna', role: 'People Ops', tint: PAL.coral,
    dept: 'People', badge: 'DEF-0288', ext: '130', since: '2020', desk: 'Lounge end',
    note: 'Knows every birthday on the floor, and exactly who left the mug in the sink. Both get followed up.'
  },
  {
    id: 'janice', name: 'Janice', role: 'Finance Lead', tint: PAL.tealLit,
    dept: 'Finance', badge: 'DEF-0155', ext: '160', since: '2018', desk: 'Quiet corner',
    note: 'Approves the coffee budget, questions the coffee consumption. The report prints when she says it prints.'
  },
  {
    id: 'phat', name: 'Phat', role: 'Solutions Architect', tint: PAL.amber,
    dept: 'Solutions', badge: 'DEF-0331', ext: '240', since: '2022', desk: 'Bank B · 07',
    note: 'Draws the diagram before the meeting starts. White tee, cargo pockets, three pens, one of them working.'
  },
  {
    id: 'philip', name: 'Philip', role: 'Regional Manager', tint: PAL.steel,
    dept: 'Operations', badge: 'DEF-0007', ext: '100', since: '2016', desk: 'Walks the floor',
    note: 'Grey suit, calm voice, two laps of the floor a day. Asks how it is going and actually waits for the answer.'
  },
  {
    id: 'suhendri', name: 'Suhendri', role: 'Support Manager', tint: PAL.leaf,
    dept: 'Support', badge: 'DEF-0209', ext: '180', since: '2019', desk: 'Bank A · 06',
    note: 'First into the queue, last out of the stand-up. Maroon shirt, permanent headset tan, endless patience.'
  },
  {
    id: 'takuya', name: 'Takuya', role: 'Frontend Engineer', tint: PAL.sand,
    dept: 'Engineering', badge: 'DEF-0452', ext: '218', since: '2023', desk: 'Bank B · 02',
    note: 'Aligns the pixel, then aligns it again. Cardigan weather indoors, twelve months a year.'
  },
  {
    id: 'tracy', name: 'Tracy', role: 'Design Lead', tint: PAL.wood,
    dept: 'Design', badge: 'DEF-0263', ext: '222', since: '2020', desk: 'Meeting room',
    note: 'Brings the review deck and the good markers. Cream blazer, opinions held firmly and explained kindly.'
  },
  {
    id: 'ayu', name: 'Ayu', role: 'QA Analyst', tint: PAL.rose,
    dept: 'Quality', badge: 'DEF-0390', ext: '232', since: '2022', desk: 'Bank B · 05',
    note: 'Finds the bug in the happy path. Files it politely, reproduces it perfectly, attaches the video.'
  },
  {
    id: 'raja-aqilah', name: 'Raja Aqilah', role: 'Data Analyst', tint: PAL.plum,
    dept: 'Data', badge: 'DEF-0344', ext: '250', since: '2021', desk: 'Breakout',
    note: 'Turns the stand-up into a chart before the stand-up ends. Dark suit, black hijab, exact numbers.'
  },
  {
    id: 'aaron', name: 'Aaron', role: 'Sales Executive', tint: PAL.ok,
    dept: 'Sales', badge: 'DEF-0176', ext: '145', since: '2021', desk: 'Bank A · 01',
    note: 'Black suit, open collar, closes on the second call. Keeps the good coffee pods in his top drawer.'
  },
  {
    id: 'max', name: 'Max', role: 'Client Partner', tint: PAL.lime,
    dept: 'Partnerships', badge: 'DEF-0088', ext: '112', since: '2017', desk: 'Front of house',
    note: 'Charcoal suit, navy tie, early for the eleven o’clock. Signs off the review and remembers your name.'
  }
].map((c) => ({
  ...c,
  sheet: `assets/chars/${c.id}.png`,
  portrait: `assets/chars/${c.id}-portrait.png`,
  card: `assets/chars/${c.id}-card.png`,
  bust: `assets/chars/${c.id}-bust.png`
}));
