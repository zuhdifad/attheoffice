import { CHAR_W, CHAR_H, SHEET_COLS, DIR_ROW, WALK_FRAMES, RIG } from '../core/config.js?v=26';
import { CHARACTERS } from './palette.js?v=26';

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
  // onload fires before the raster is decoded; the first drawImage of a lazy
  // sheet would pay that decode inside a live frame. Force it here, off-frame.
  img.onload = () => (img.decode ? img.decode() : Promise.resolve()).then(() => resolve(img), () => resolve(img));
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
// the tile. The view hands it over snapped to the device pixel grid, so it is
// drawn exactly as given — rounding again in world units would knock a sprite a
// whole device pixel sideways at four pixels per unit.
export function drawChar(g, id, dir, frame, dx, dy) {
  const sheet = SHEETS.get(id);
  if (!sheet) return false;
  const row = DIR_ROW[dir] ?? 0;
  const col = Math.max(0, Math.min(SHEET_COLS - 1, frame));
  g.drawImage(sheet, col * CHAR_W, row * CHAR_H, CHAR_W, CHAR_H, dx, dy, CHAR_W, CHAR_H);
  return true;
}

// ---- Blender-baked rig -------------------------------------------------------
// One doll per character, nine actions on a 47-column sheet, two LODs. Only the
// characters that have been baked carry these; everyone else keeps the six-frame
// sheet above until their turn comes. The two LODs load and evict independently:
// a near sheet decodes to ~18.5MB against ~4.6MB for far, so world/residency.js
// keeps far for the whole cast and near only around the close view.
const RIG_SHEETS = { near: new Map(), far: new Map() };
const FLIGHT = { near: new Map(), far: new Map() };
const MISSING = { near: new Set(), far: new Set() };

function loadLod(id, lod) {
  if (RIG_SHEETS[lod].has(id)) return Promise.resolve(true);
  if (MISSING[lod].has(id)) return Promise.resolve(false);
  if (FLIGHT[lod].has(id)) return FLIGHT[lod].get(id);
  const p = load(`assets/chars/${id}-rig-${lod}.png`)
    .then((img) => {
      RIG_SHEETS[lod].set(id, img);
      return true;
    })
    .catch(() => {
      MISSING[lod].add(id);
      return false;
    })
    .finally(() => FLIGHT[lod].delete(id));
  FLIGHT[lod].set(id, p);
  return p;
}

export function loadRigNear(id) {
  return loadLod(id, 'near');
}

export function loadRigFar(id) {
  return loadLod(id, 'far');
}

export function loadRig(id) {
  return Promise.all([loadLod(id, 'near'), loadLod(id, 'far')]).then(() => true);
}

// Dropping the reference is the eviction: the decoded bitmap goes with it. The
// miss cache stays, so an evicted sheet reloads on demand but a baked-less id
// never retries its 404.
export function evictRigNear(id) {
  RIG_SHEETS.near.delete(id);
}

export function rigResidency() {
  return { near: [...RIG_SHEETS.near.keys()], far: [...RIG_SHEETS.far.keys()] };
}

export function rigFor(id, view) {
  return (RIG_SHEETS[view] || RIG_SHEETS.near).get(id) || null;
}

// action + frame address the rig sheet; the destination stays the same 32x48
// world box as drawChar, so the rig and the legacy sheet occupy identical floor
// space and the y-sort / lift maths never changes.
export function drawRigChar(g, id, dir, action, frame, dx, dy, view) {
  const sheet = rigFor(id, view);
  if (!sheet) return false;
  const [cw, ch] = (RIG[view] || RIG.near).cell;
  const [col0, count] = RIG.actions[action] || RIG.actions.idle;
  const col = col0 + Math.max(0, Math.min(count - 1, frame));
  const row = DIR_ROW[dir] ?? 0;
  g.drawImage(sheet, col * cw, row * ch, cw, ch, dx, dy, CHAR_W, CHAR_H);
  return true;
}
