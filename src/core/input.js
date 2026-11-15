const HELD = new Set();
const ORDER = [];

const KEY_DIRS = {
  arrowup: 'up', w: 'up',
  arrowdown: 'down', s: 'down',
  arrowleft: 'left', a: 'left',
  arrowright: 'right', d: 'right'
};

// Only the world screen walks, so the popups keep their default key behaviour.
let enabled = false;

// Touch mirrors the keyboard into the same state, so the game loop never has to
// know which one produced an input.
let padDir = null;
let padWork = false;
let syncTaps = 0;

export function setInputEnabled(on) {
  enabled = on;
  if (on) return;
  HELD.clear();
  ORDER.length = 0;
  padDir = null;
  padWork = false;
  syncTaps = 0;
}

export function setPadDirection(dir) {
  padDir = dir;
}

export function setPadWork(on) {
  padWork = on;
}

export function tapSync() {
  syncTaps++;
}

window.addEventListener('keydown', (e) => {
  if (!enabled) return;
  const k = e.key.toLowerCase();
  if (k === ' ' || k === 'spacebar') {
    e.preventDefault();
    if (!e.repeat) syncTaps++;
    return;
  }
  if (k === 'e') {
    e.preventDefault();
    HELD.add('e');
    return;
  }
  if (!KEY_DIRS[k]) return;
  e.preventDefault();
  if (e.repeat || HELD.has(k)) return;
  HELD.add(k);
  ORDER.push(k);
});

window.addEventListener('keyup', (e) => {
  const k = e.key.toLowerCase();
  if (k === 'e') { HELD.delete('e'); return; }
  HELD.delete(k);
  const i = ORDER.indexOf(k);
  if (i >= 0) ORDER.splice(i, 1);
});

// Losing focus must not leave a key stuck down.
window.addEventListener('blur', () => {
  HELD.clear();
  ORDER.length = 0;
  padDir = null;
  padWork = false;
});

// FireRed walks whichever direction you pressed last, so press order beats
// grid order when both axes are held.
export function heldDirection() {
  for (let i = ORDER.length - 1; i >= 0; i--) {
    const dir = KEY_DIRS[ORDER[i]];
    if (dir && HELD.has(ORDER[i])) return dir;
  }
  return padDir;
}

// Read once per simulated frame: the tap is consumed so one press can never
// score twice, and holding Space does nothing at all.
export function readActions() {
  const a = { work: HELD.has('e') || padWork, syncTap: syncTaps > 0 };
  syncTaps = 0;
  return a;
}