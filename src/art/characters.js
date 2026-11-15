import { CHAR_W, CHAR_H, SHEET_COLS, DIR_ROW, WALK_FRAMES } from '../core/config.js';
import { CHARACTERS } from './palette.js';

export { CHARACTERS };

// The sheets arrive already cut out: magenta keyed, silhouette trimmed, every
// colleague normalised to the same height at bake time. So loading one is just
// loading one image, and the picker and the floor read the same pixels.
// The dossier card and the bust are the same person at photograph scale, cut
// from the model sheet with the studio backdrop removed, so they sit on any
// tint the picker chooses without a grey box around them.
const SHEETS = new Map();
const PORTRAITS = new Map();
const CARDS = new Map();
const BUSTS = new Map();

const load = (src) => new Promise((resolve, reject) => {
  const img = new Image();
  img.onload = () => resolve(img);
  img.onerror = () => reject(new Error(`sprite failed to load: ${src}`));
  img.src = src;
});

let ready = null;

export function loadRoster() {
  if (ready) return ready;
  ready = Promise.all(CHARACTERS.map(async (c) => {
    const [sheet, portrait, card, bust] = await Promise.all([
      load(c.sheet), load(c.portrait), load(c.card), load(c.bust)
    ]);
    SHEETS.set(c.id, sheet);
    PORTRAITS.set(c.id, portrait);
    CARDS.set(c.id, card);
    BUSTS.set(c.id, bust);
  })).then(() => true);
  return ready;
}

export function sheetFor(id) {
  return SHEETS.get(id) || null;
}

export function portraitFor(id) {
  return PORTRAITS.get(id) || null;
}

export function cardFor(id) {
  return CARDS.get(id) || null;
}

export function bustFor(id) {
  return BUSTS.get(id) || null;
}

// Which of the six frames a walker is on. The cycle is held still on the contact
// pose while standing, so nobody moonwalks on the spot.
export function frameFor(step, stepFrames, moving) {
  if (!moving) return 0;
  const t = Math.min(step / stepFrames, 0.999);
  return Math.floor(t * WALK_FRAMES) % WALK_FRAMES;
}

// dx/dy is the top-left of the sprite box, already lifted so the feet land on
// the tile. Everything is drawn 1:1 — the whole buffer is scaled once, at the end.
export function drawChar(g, id, dir, frame, dx, dy) {
  const sheet = SHEETS.get(id);
  if (!sheet) return false;
  const row = DIR_ROW[dir] ?? 0;
  const col = Math.max(0, Math.min(SHEET_COLS - 1, frame));
  g.drawImage(sheet, col * CHAR_W, row * CHAR_H, CHAR_W, CHAR_H, Math.round(dx), Math.round(dy), CHAR_W, CHAR_H);
  return true;
}
