// ---- The expression system: one shared face, every skin ----------------------
//
// No character owns face art. The face is three swappable layers — brows, eyes,
// mouth — each authored in a fixed 64x64 box (16x16 world units at 4 px/unit)
// anchored to the head pivot, plus a 24x24 overlay sprite (6x6 world units)
// hung off the head. Eight variants per layer; an expression is just a pick
// from each, a pose and an overlay:
//
//   EXPRESSION[name] = { brows, eyes, mouth, pose, overlay, weight }
//
// weight is how strongly the face reads: 0 is the resting face (the baked art
// shows through), 1 a hard expression. A hard expression — weight 1 or any
// overlay — owns the eyes: blinking never interrupts it.
//
// The box hangs from the head pivot: its top-left is (pivot.x - 8, pivot.y - 14)
// in world units, so on the normalized doll the brows land on the baked brow
// line, the eyes on the baked eyes and the mouth on the baked mouth. Features
// are painted on a 16x16 logical grid (one logical px = 4 authored px = one
// world unit) and tinted per skin tone: ink, lid and blush all come off the
// tone, so one set of features serves the whole cast.
//
// Mood rides on the actor: current, target, an eased t between them, a hold
// timer, a blink timer (3-6 s) and a gaze saccade (2-5 s). drawFace crossfades
// the two feature sets by t; poses crossfade the same way and are pure
// transforms on the doll — never a new sheet.
//
// ?faces=1 draws the contact sheet: every expression on every skin tone,
// through this same drawFace, so the sheet proves the production face path.

import { CHAR_W } from '../core/config.js?v=24';
import { canvas, px } from '../core/draw.js?v=24';
import { CHARACTERS } from './palette.js?v=24';

export const FACE_BOX = 64;      // authored px per feature layer
export const OVERLAY_BOX = 24;   // authored px per overlay sprite
export const FACE_UNITS = 16;    // the box in world units
export const OVERLAY_UNITS = 6;

// ---- skin tones ---------------------------------------------------------------
// Six tones across the cast. ink is the feature line colour, deep enough to
// read on its own base; blush is the cheek rose, warmed down on deeper tones.
export const SKINS = {
  porcelain: { base: '#f6d7c4', shade: '#e0b49b', light: '#fceadb', ink: '#6b4a3a', blush: 'rgba(226,110,120,0.50)' },
  fair:      { base: '#f0c8a8', shade: '#d5a17e', light: '#f8dcc2', ink: '#5f4032', blush: 'rgba(220,100,110,0.50)' },
  sand:      { base: '#e0b184', shade: '#c08c5e', light: '#edc79c', ink: '#54382a', blush: 'rgba(205,90,100,0.50)' },
  tan:       { base: '#c98d5e', shade: '#a67043', light: '#dca678', ink: '#462c1f', blush: 'rgba(190,80,90,0.55)' },
  brown:     { base: '#a06a42', shade: '#7f512d', light: '#b57e52', ink: '#33200f', blush: 'rgba(170,65,75,0.55)' },
  deep:      { base: '#7a4a2c', shade: '#5e361d', light: '#8f5a38', ink: '#241505', blush: 'rgba(150,55,65,0.60)' }
};

const SKIN_BY_ID = {
  zuhdi: 'tan', alicia: 'fair', anna: 'porcelain', janice: 'fair',
  phat: 'sand', philip: 'porcelain', suhendri: 'brown', takuya: 'sand',
  tracy: 'fair', ayu: 'tan', 'raja-aqilah': 'brown', aaron: 'tan', max: 'deep'
};
export const skinFor = (id) => SKIN_BY_ID[id] || 'sand';

const HAIR_BY_ID = {
  zuhdi: '#4a3a30', alicia: '#6e6a66', anna: '#a8703c', janice: '#3c3230',
  phat: '#2e2622', philip: '#8d8d90', suhendri: '#241c16', takuya: '#3a3230',
  tracy: '#7c5a3a', ayu: '#2c2420', 'raja-aqilah': '#2a2a30', aaron: '#201a16', max: '#4c4c50'
};
export const hairFor = (id) => HAIR_BY_ID[id] || '#3a3230';

// ---- the fourteen -------------------------------------------------------------
// brows: 0 flat, 1 raised, 2 determined, 3 sad, 4 worried, 5 one-raised,
//        6 furrowed, 7 low
// eyes:  0 open, 1 half, 2 closed-happy, 3 closed-sad, 4 wide, 5 squint,
//        6 shut-tight, 7 hearts
// mouth: 0 line, 1 smile, 2 laugh, 3 frown, 4 wail, 5 grit, 6 o, 7 smirk
export const EXPRESSION = {
  neutral:       { brows: 0, eyes: 0, mouth: 0, pose: 'neutral',      overlay: null,     weight: 0 },
  happy:         { brows: 0, eyes: 0, mouth: 1, pose: 'neutral',      overlay: 'blush',  weight: 0.85 },
  laughing:      { brows: 1, eyes: 2, mouth: 2, pose: 'head-back',    overlay: null,     weight: 1 },
  excited:       { brows: 1, eyes: 4, mouth: 2, pose: 'hands-up',     overlay: '!',      weight: 1 },
  sad:           { brows: 3, eyes: 1, mouth: 3, pose: 'slump',        overlay: null,     weight: 0.8 },
  crying:        { brows: 4, eyes: 3, mouth: 4, pose: 'hand-to-face', overlay: 'tears',  weight: 1 },
  angry:         { brows: 6, eyes: 5, mouth: 5, pose: 'lean-in',      overlay: 'steam',  weight: 1 },
  bored:         { brows: 7, eyes: 1, mouth: 0, pose: 'slump',        overlay: null,     weight: 0.6 },
  tired:         { brows: 7, eyes: 1, mouth: 3, pose: 'slump',        overlay: 'sweat',  weight: 0.8 },
  sleepy:        { brows: 0, eyes: 1, mouth: 6, pose: 'slump',        overlay: 'zzz',    weight: 0.85 },
  'in-love':     { brows: 1, eyes: 7, mouth: 1, pose: 'lean-in',      overlay: 'heart',  weight: 1 },
  lazy:          { brows: 5, eyes: 1, mouth: 7, pose: 'slump',        overlay: null,     weight: 0.6 },
  curious:       { brows: 1, eyes: 4, mouth: 6, pose: 'lean-in',      overlay: '?',      weight: 0.9 },
  ambitious:     { brows: 2, eyes: 0, mouth: 7, pose: 'lean-in',      overlay: null,     weight: 0.9 },
  'going-crazy': { brows: 6, eyes: 6, mouth: 2, pose: 'hands-up',     overlay: 'spiral', weight: 1 }
};

export const OVERLAYS = ['tears', 'blush', 'sweat', 'zzz', 'steam', 'heart', '?', '!', 'spiral'];

// ---- poses --------------------------------------------------------------------
// A pose is a transform on the whole doll around the foot pivot, optionally
// holding a frame of an anim the rig already owns (hands-up borrows wave,
// hand-to-face borrows sip). Nothing here is a new sheet.
export const POSES = {
  neutral:        { rot: 0,     dx: 0, dy: 0,    sy: 1 },
  'lean-in':      { rot: 0.07,  dx: 0, dy: 0.4,  sy: 1 },
  slump:          { rot: 0.03,  dx: 0, dy: 0.3,  sy: 0.93 },
  'head-back':    { rot: -0.06, dx: 0, dy: -0.5, sy: 1 },
  'hands-up':     { rot: 0,     dx: 0, dy: -0.4, sy: 1,    anim: 'wave', frame: 2 },
  'hand-to-face': { rot: 0.02,  dx: 0, dy: 0.2,  sy: 1,    anim: 'sip',  frame: 6 }
};

// ---- mood state ---------------------------------------------------------------

export function createMood(rand = Math.random) {
  return {
    current: 'neutral',
    target: 'neutral',
    t: 1,                          // eased blend current -> target
    hold: 0,                       // frames the target stays before decaying
    blinkIn: 180 + rand() * 180,   // 3-6 s at 60 fps
    blink: 0,                      // frames left of the closed lid
    gazeIn: 120 + rand() * 180,    // 2-5 s
    gaze: { x: 0, y: 0 },
    age: 0                         // frames lived, drives overlay animation
  };
}

// A settled mood with no timers: what the contact sheet poses each cell with.
// The hold is effectively forever so a sim step cannot decay it back to rest.
export function staticMood(name) {
  const m = createMood(() => 0.5);
  m.current = m.target = EXPRESSION[name] ? name : 'neutral';
  m.blinkIn = m.gazeIn = m.hold = 1e9;
  return m;
}

export function setMood(actor, name, hold = 240) {
  const m = actor.mood;
  if (!EXPRESSION[name]) name = 'neutral';
  if (m.target === name) {
    if (name !== 'neutral') m.hold = Math.max(m.hold, hold);
    return;
  }
  // Retargeting mid-ease keeps the old current as the fade-out side.
  m.target = name;
  m.t = 0;
  m.hold = name === 'neutral' ? 0 : hold;
}

const smooth = (t) => t * t * (3 - 2 * t);

// The two feature sets and how strongly each reads, plus whether the dominant
// side is hard (weight 1 or an overlay) — the blink gate.
export function faceBlend(m) {
  const from = EXPRESSION[m.current] || EXPRESSION.neutral;
  const to = EXPRESSION[m.target] || EXPRESSION.neutral;
  const k = smooth(Math.max(0, Math.min(1, m.t)));
  const alphaFrom = (1 - k) * from.weight;
  const alphaTo = k * to.weight;
  const dom = k >= 0.5 ? to : from;
  return {
    from, to, k, alphaFrom, alphaTo,
    presence: Math.max(alphaFrom, alphaTo),
    hard: dom.weight >= 1 || !!dom.overlay,
    dom
  };
}

const BLINKABLE = new Set([0, 1, 4, 5]);   // eyes with a lid that can close
const GAZE_DOWN = new Set(['sad', 'tired', 'sleepy', 'bored', 'lazy']);

export function updateMood(actor, dt) {
  const m = actor.mood;
  const f = dt * 60;
  m.age += f;

  if (m.t < 1) {
    m.t = Math.min(1, m.t + f / 18);       // 0.3 s crossfade
    if (m.t >= 1) m.current = m.target;
  }
  if (m.target !== 'neutral') {
    m.hold -= f;
    if (m.hold <= 0) setMood(actor, 'neutral', 0);
  }

  const b = faceBlend(m);
  // A hard expression or an overlay owns the eyes: no blink starts, and one
  // already in flight is cancelled rather than cutting across the face.
  if (b.hard) m.blink = 0;
  if (m.blink > 0) {
    m.blink -= f;
  } else {
    m.blinkIn -= f;
    if (m.blinkIn <= 0) {
      if (!b.hard && BLINKABLE.has(b.dom.eyes)) m.blink = 7;
      m.blinkIn = 180 + Math.random() * 180;
    }
  }

  m.gazeIn -= f;
  if (m.gazeIn <= 0) {
    const r = Math.random();
    const down = GAZE_DOWN.has(m.target) ? 0.45 : 0.12;
    m.gaze = r < 0.4 ? { x: 0, y: 0 }
      : r < 0.4 + down ? { x: 0, y: 1 }
      : r < 0.7 + down / 2 ? { x: -1, y: 0 }
      : r < 0.95 + down / 2 ? { x: 1, y: 0 }
      : { x: 0, y: -1 };
    m.gazeIn = 120 + Math.random() * 180;
  }
}

// ---- feature layers -----------------------------------------------------------
// Painted on the 16x16 logical grid into 64x64 canvases: one logical px is a
// 4x4 authored block, so the near view blits the layer 1:1 and the far view
// downscales 2:1 with smoothing off, exactly like the other @4 layers.

const U = FACE_BOX / FACE_UNITS;   // 4 authored px per logical px
const layerCache = new Map();

function layerCanvas(key, paint) {
  let c = layerCache.get(key);
  if (!c) {
    c = canvas(FACE_BOX, FACE_BOX).c;
    const g = c.getContext('2d');
    const r = (x, y, w, h, col) => px(g, x * U, y * U, w * U, h * U, col);
    paint(r, g);
    layerCache.set(key, c);
  }
  return c;
}

function paintBrows(r, v, ink) {
  const bar = (x, y, w, h) => r(x, y, w, h, ink);
  if (v === 0) { bar(5, 8, 2.5, 0.5); bar(8.5, 8, 2.5, 0.5); }
  else if (v === 1) { bar(5, 7, 2.5, 0.5); bar(8.5, 7, 2.5, 0.5); bar(5.5, 6.5, 1.5, 0.5); bar(9, 6.5, 1.5, 0.5); }
  else if (v === 2) { bar(5, 7.5, 2.5, 0.5); bar(8.5, 7.5, 2.5, 0.5); bar(6.5, 8, 1, 0.5); bar(8.5, 8, 1, 0.5); }
  else if (v === 3) { bar(5, 8.5, 2.5, 0.5); bar(8.5, 8.5, 2.5, 0.5); bar(6.5, 8, 1, 0.5); bar(8.5, 8, 1, 0.5); }
  else if (v === 4) { bar(5, 8, 2.5, 0.5); bar(8.5, 8, 2.5, 0.5); bar(6.5, 7.5, 1, 0.5); bar(8.5, 7.5, 1, 0.5); bar(5, 7.5, 1, 0.5); bar(10, 7.5, 1, 0.5); }
  else if (v === 5) { bar(5, 8, 2.5, 0.5); bar(8.5, 7, 2.5, 0.5); bar(9, 6.5, 1.5, 0.5); }
  else if (v === 6) { bar(5, 7.5, 2.5, 0.75); bar(8.5, 7.5, 2.5, 0.75); bar(6.5, 8.25, 1, 0.5); bar(8.5, 8.25, 1, 0.5); bar(7.75, 7, 0.5, 1.5); }
  else { bar(5, 8.75, 2.5, 0.75); bar(8.5, 8.75, 2.5, 0.75); }
}

function paintMouth(r, v, ink, skin) {
  const dark = '#4a2c22';
  const tongue = '#c96a6a';
  const teeth = '#fdf6ec';
  if (v === 0) r(7, 12.5, 2, 0.5, ink);
  else if (v === 1) { r(6.5, 12, 0.5, 0.5, ink); r(7, 12.5, 2, 0.5, ink); r(9, 12, 0.5, 0.5, ink); }
  else if (v === 2) { r(6.5, 11.5, 3, 2, dark); r(6.5, 11.5, 3, 0.5, teeth); r(7, 13, 2, 0.5, tongue); }
  else if (v === 3) { r(6.5, 12.5, 0.5, 0.5, ink); r(7, 12, 2, 0.5, ink); r(9, 12.5, 0.5, 0.5, ink); }
  else if (v === 4) { r(6.5, 11.5, 3, 2.5, dark); r(7, 13.25, 2, 0.75, tongue); }
  else if (v === 5) { r(6.5, 12, 3, 1, teeth); r(6.5, 11.75, 3, 0.25, ink); r(6.5, 13, 3, 0.25, ink); r(7.5, 12, 0.25, 1, ink); r(8.5, 12, 0.25, 1, ink); }
  else if (v === 6) { r(7.25, 12, 1.5, 1.5, dark); r(7.5, 12.25, 1, 1, '#2e1a14'); }
  else { r(6.5, 12.5, 2, 0.5, ink); r(8.5, 12, 1, 0.5, ink); r(9.5, 11.5, 0.5, 0.5, ink); }
}

// Eyes are the one live layer: gaze and blink repaint them, so they go through
// a single shared scratch canvas keyed on what actually changed.
const eyeScratch = canvas(FACE_BOX, FACE_BOX);
let eyeKey = '';

function paintEyes(r, v, gaze, blink, skin) {
  const ink = skin.ink;
  const white = '#fdf6ec';
  const gx = gaze.x * 0.5, gy = gaze.y * 0.5;
  const closed = (x) => r(x, 9.75, 2, 0.5, ink);
  if (blink) { closed(5.5); closed(8.5); return; }
  if (v === 0) {
    r(5.5, 9, 2, 1.5, white); r(8.5, 9, 2, 1.5, white);
    r(6 + gx, 9.5 + gy, 1, 1, ink); r(9 + gx, 9.5 + gy, 1, 1, ink);
  } else if (v === 1) {
    r(5.5, 9.5, 2, 1, white); r(8.5, 9.5, 2, 1, white);
    r(6 + gx, 9.75 + gy * 0.5, 1, 0.75, ink); r(9 + gx, 9.75 + gy * 0.5, 1, 0.75, ink);
    r(5.5, 9, 2, 0.5, ink); r(8.5, 9, 2, 0.5, ink);
  } else if (v === 2) {
    r(5.5, 9.5, 0.5, 0.5, ink); r(6, 9, 1, 0.5, ink); r(7, 9.5, 0.5, 0.5, ink);
    r(8.5, 9.5, 0.5, 0.5, ink); r(9, 9, 1, 0.5, ink); r(10, 9.5, 0.5, 0.5, ink);
  } else if (v === 3) {
    r(5.5, 9, 0.5, 0.5, ink); r(6, 9.5, 1, 0.5, ink); r(7, 9, 0.5, 0.5, ink);
    r(8.5, 9, 0.5, 0.5, ink); r(9, 9.5, 1, 0.5, ink); r(10, 9, 0.5, 0.5, ink);
  } else if (v === 4) {
    r(5.5, 8.75, 2, 2, white); r(8.5, 8.75, 2, 2, white);
    r(6 + gx, 9.25 + gy, 1, 1, ink); r(9 + gx, 9.25 + gy, 1, 1, ink);
    r(6 + gx, 9.25 + gy, 0.5, 0.5, white); r(9 + gx, 9.25 + gy, 0.5, 0.5, white);
  } else if (v === 5) {
    r(5.5, 9.5, 2, 0.75, white); r(8.5, 9.5, 2, 0.75, white);
    r(6 + gx, 9.5, 1, 0.75, ink); r(9 + gx, 9.5, 1, 0.75, ink);
    r(5.5, 9, 2, 0.5, ink); r(8.5, 9, 2, 0.5, ink);
    r(5.5, 10.25, 2, 0.25, ink); r(8.5, 10.25, 2, 0.25, ink);
  } else if (v === 6) {
    r(5.5, 9, 0.5, 0.5, ink); r(6, 9.5, 0.5, 0.5, ink); r(5.5, 10, 0.5, 0.5, ink); r(6.5, 9.5, 0.5, 0.5, ink);
    r(10, 9, 0.5, 0.5, ink); r(9.5, 9.5, 0.5, 0.5, ink); r(10, 10, 0.5, 0.5, ink); r(9, 9.5, 0.5, 0.5, ink);
  } else {
    const rose = '#e2506a';
    const heart = (x) => {
      r(x, 9, 0.75, 0.75, rose); r(x + 1.25, 9, 0.75, 0.75, rose);
      r(x, 9.5, 2, 0.75, rose); r(x + 0.5, 10.25, 1, 0.5, rose); r(x + 0.75, 10.75, 0.5, 0.25, rose);
    };
    heart(5.5); heart(8.5);
  }
}

function eyesCanvas(skinKey, skin, v, gaze, blink) {
  const key = `${skinKey}|${v}|${gaze.x},${gaze.y}|${blink ? 1 : 0}`;
  if (key !== eyeKey) {
    const g = eyeScratch.ctx;
    g.clearRect(0, 0, FACE_BOX, FACE_BOX);
    const r = (x, y, w, h, col) => px(g, x * U, y * U, w * U, h * U, col);
    paintEyes(r, v, gaze, blink, skin);
    eyeKey = key;
  }
  return eyeScratch.c;
}

// ---- overlays -----------------------------------------------------------------
// 24x24 sprites on a 6x6 logical grid, painted live in world units so their
// little animations (a falling tear, a rising Z) cost a handful of rects.

const OVERLAY_ANCHOR = {
  tears:  (p) => [p.x - 3, p.y - 6],
  blush:  (p) => [p.x - 3.5, p.y - 5],
  sweat:  (p) => [p.x + 3, p.y - 11],
  zzz:    (p) => [p.x + 2, p.y - 16],
  steam:  (p) => [p.x + 2.5, p.y - 15],
  heart:  (p) => [p.x + 2.5, p.y - 14],
  '?':    (p) => [p.x + 3, p.y - 14],
  '!':    (p) => [p.x + 3, p.y - 14],
  spiral: (p) => [p.x - 3, p.y - 17]
};

function paintOverlay(g, kind, skin, age) {
  const r = (x, y, w, h, col) => px(g, x, y, w, h, col);
  const t = age / 60;
  const drop = '#7fc4e8', shine = '#d8f0fa';
  if (kind === 'tears') {
    const f = (t * 1.6) % 1, f2 = (t * 1.6 + 0.5) % 1;
    r(1, 1.5 + f * 2.5, 0.75, 1.25, drop); r(1, 1.5 + f * 2.5, 0.25, 0.5, shine);
    r(4.25, 1.5 + f2 * 2.5, 0.75, 1.25, drop); r(4.25, 1.5 + f2 * 2.5, 0.25, 0.5, shine);
  } else if (kind === 'blush') {
    r(0.5, 2.5, 1.75, 1, skin.blush); r(3.75, 2.5, 1.75, 1, skin.blush);
    r(0.75, 2.75, 0.5, 0.5, skin.blush); r(4.5, 2.75, 0.5, 0.5, skin.blush);
  } else if (kind === 'sweat') {
    const f = (t * 0.9) % 1;
    r(3.5, 1 + f * 2, 1, 1.5, drop); r(3.75, 0.5 + f * 2, 0.5, 0.5, drop); r(3.75, 1.25 + f * 2, 0.25, 0.5, shine);
  } else if (kind === 'zzz') {
    const z = (x, y, s, col) => { r(x, y, s, 0.4, col); r(x + s - 0.4, y + 0.4, 0.4, 0.4, col); r(x + s / 2 - 0.2, y + 0.8, 0.4, 0.4, col); r(x, y + 1.2, s, 0.4, col); };
    const f = (t * 0.7) % 1;
    g.globalAlpha *= 1 - f * 0.5;
    z(3, 3 - f * 2, 2, '#cfd6e4'); z(1, 4.5 - f, 1.4, '#a9aebb'); z(0, 5.5 - f * 0.5, 1, '#8b90a0');
  } else if (kind === 'steam') {
    const f = Math.floor(t * 4) % 2;
    g.globalAlpha *= 0.8;
    r(1 + f * 0.5, 3.5, 0.75, 1.5, '#cfd6e4'); r(2.5 - f * 0.5, 1.5, 0.75, 1.5, '#cfd6e4'); r(1 + f * 0.5, 0, 0.75, 1, '#a9aebb');
    r(4 - f * 0.5, 2.5, 0.75, 1.5, '#cfd6e4'); r(4.5 + f * 0.5, 0.5, 0.75, 1.5, '#a9aebb');
  } else if (kind === 'heart') {
    const bob = Math.sin(t * 3) * 0.4;
    const rose = '#e2506a';
    r(1.5, 1.5 + bob, 1, 1, rose); r(3, 1.5 + bob, 1, 1, rose);
    r(1.5, 2.25 + bob, 2.5, 1, rose); r(2, 3.25 + bob, 1.5, 0.75, rose); r(2.5, 4 + bob, 0.5, 0.5, rose);
    r(1.75, 1.75 + bob, 0.5, 0.5, '#f490a4');
  } else if (kind === '?') {
    const amber = '#f2b134';
    r(1.5, 0.5, 2.5, 0.75, amber); r(3.5, 1, 0.75, 1.25, amber); r(2.5, 2, 1.25, 0.75, amber); r(2.5, 2.75, 0.75, 0.75, amber); r(2.5, 4, 0.75, 0.75, amber);
  } else if (kind === '!') {
    const amber = '#f2b134';
    const pop = Math.sin(t * 4) > 0 ? 0 : 0.25;
    r(2.5, 0.5 - pop, 1, 2.75, amber); r(2.5, 4 - pop, 1, 1, amber);
  } else {
    const plum = '#b45fb0';
    const f = Math.floor(t * 5) % 2;
    r(1, 1, 4, 0.75, plum); r(4.25, 1, 0.75, 3.25, plum); r(1, 3.5, 4, 0.75, plum); r(1, 2, 0.75, 2.25, plum);
    if (f) { r(2.25, 2.25, 1.75, 0.75, plum); r(2.25, 2.25, 0.75, 1.25, plum); }
    else { r(2.5, 2, 1.5, 0.75, plum); r(3.25, 2, 0.75, 1.5, plum); }
  }
}

// ---- the face pass -------------------------------------------------------------
// Called inside the actor's own transform (origin at the sprite box top-left,
// world units, flip already applied for left). pivot is the head pivot in the
// same space. patch backs the features with skin only where the baked doll
// carries its own face — a layered rig with a clean head layer needs none.

export function drawFace(g, actor, pivot, opts = {}) {
  const m = actor.mood;
  const b = faceBlend(m);
  if (b.presence <= 0.02) return;
  const skinKey = skinFor(actor.id);
  const skin = SKINS[skinKey];
  const bx = pivot.x - FACE_UNITS / 2;
  const by = pivot.y - 14;

  g.save();
  g.translate(bx, by);
  if (opts.patch) {
    // The baked face sits under a skin-toned mask while an expression reads,
    // so two faces never show at once. It fades with the expression.
    g.globalAlpha = b.presence;
    g.fillStyle = skin.base;
    g.beginPath();
    const x = 4.5, y = 6.5, w = 7, h = 7, rr = 1.5;
    g.moveTo(x + rr, y);
    g.arcTo(x + w, y, x + w, y + h, rr);
    g.arcTo(x + w, y + h, x, y + h, rr);
    g.arcTo(x, y + h, x, y, rr);
    g.arcTo(x, y, x + w, y, rr);
    g.closePath();
    g.fill();
    px(g, 5.5, 6.75, 5, 0.5, skin.light);
    px(g, 5.5, 12.75, 5, 0.5, skin.shade);
    g.globalAlpha = 1;
  }
  const blit = (img, alpha) => {
    if (alpha <= 0.02) return;
    g.globalAlpha = alpha;
    g.drawImage(img, 0, 0, FACE_BOX, FACE_BOX, 0, 0, FACE_UNITS, FACE_UNITS);
    g.globalAlpha = 1;
  };
  const set = (ex, alpha, live) => {
    if (alpha <= 0.02) return;
    blit(layerCanvas(`${skinKey}|b|${ex.brows}`, (r) => paintBrows(r, ex.brows, skin.ink)), alpha);
    const blink = live && m.blink > 0;
    blit(eyesCanvas(skinKey, skin, ex.eyes, m.gaze, blink), alpha);
    blit(layerCanvas(`${skinKey}|m|${ex.mouth}`, (r) => paintMouth(r, ex.mouth, skin.ink, skin)), alpha);
  };
  set(b.from, b.alphaFrom, b.k < 0.5);
  set(b.to, b.alphaTo, b.k >= 0.5);
  g.restore();

  // Overlays hang off the head and never mirror: a backwards Z or ? reads as
  // a glyph bug, so the flip is cancelled around their own box.
  const overlay = (ex, alpha) => {
    if (!ex.overlay || alpha <= 0.02) return;
    let [ax, ay] = OVERLAY_ANCHOR[ex.overlay](pivot);
    g.save();
    if (opts.flip) {
      g.translate(CHAR_W, 0);
      g.scale(-1, 1);
      ax = CHAR_W - ax - OVERLAY_UNITS;
    }
    g.translate(ax, ay);
    g.globalAlpha = alpha;
    paintOverlay(g, ex.overlay, skin, m.age);
    g.restore();
  };
  overlay(b.from, b.alphaFrom);
  overlay(b.to, b.alphaTo);
}

// ---- the contact sheet ----------------------------------------------------------
// ?faces=1: every expression on every skin tone, each cell drawn through the
// same drawFace the world uses, over a shared procedural head tinted per tone.

// The grid leaves the top-right and bottom-left corners of the buffer clear:
// the sound and zoom pills are DOM chrome over those corners, and a header or
// a caption under a pill is a header nobody can read.
export const FACE_SHEET = { x0: 92, y0: 26, cw: 80, ch: 53 };

function sheetHead(g, id) {
  const skin = SKINS[skinFor(id)];
  const hair = hairFor(id);
  g.fillStyle = skin.base;
  g.beginPath();
  const x = 4, y = 1.5, w = 8, h = 10, rr = 2.5;
  g.moveTo(x + rr, y);
  g.arcTo(x + w, y, x + w, y + h, rr);
  g.arcTo(x + w, y + h, x, y + h, rr);
  g.arcTo(x, y + h, x, y, rr);
  g.arcTo(x, y, x + w, y, rr);
  g.closePath();
  g.fill();
  px(g, 3.25, 6, 1, 2, skin.base); px(g, 11.75, 6, 1, 2, skin.base);
  px(g, 7, 11, 2, 2.5, skin.shade);
  px(g, 4, 0.5, 8, 2.5, hair);
  px(g, 3.5, 1.5, 1, 3, hair); px(g, 11.5, 1.5, 1, 3, hair);
  px(g, 5, 0.5, 6, 0.5, '#ffffff22');
}

export function drawContactSheet(g, t) {
  const names = Object.keys(EXPRESSION).filter((k) => k !== 'neutral');
  const { x0, y0, cw, ch } = FACE_SHEET;
  g.fillStyle = '#14171f';
  g.fillRect(0, 0, 1280, 720);
  g.font = '7px ui-monospace, Menlo, monospace';
  g.textAlign = 'center';
  names.forEach((n, c) => {
    g.fillStyle = '#f3f1ec';
    g.fillText(n, x0 + c * cw + cw / 2, 16);
  });
  g.textAlign = 'left';
  CHARACTERS.forEach((who, r) => {
    const cy = y0 + r * ch;
    g.fillStyle = who.tint;
    g.fillText(who.name, 8, cy + 24);
    g.fillStyle = '#6f7686';
    g.fillText(skinFor(who.id), 8, cy + 34);
    names.forEach((n, c) => {
      const cx = x0 + c * cw + cw / 2;
      g.save();
      g.translate(cx - 16, cy + ch / 2 - 15);
      g.scale(2, 2);
      sheetHead(g, who.id);
      const actor = { id: who.id, mood: staticMood(n) };
      actor.mood.age = t * 60 + r * 13 + c * 7;
      drawFace(g, actor, { x: 8, y: 12 }, { patch: false, flip: false });
      g.restore();
    });
  });
  g.fillStyle = '#6f7686';
  g.textAlign = 'right';
  g.fillText('expressions x skin tones — shared features, tinted per tone', 1272, 714);
  g.textAlign = 'left';
}